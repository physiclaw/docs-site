#!/usr/bin/env node
// Local dev orchestrator for `pnpm dev`. Unlike the prod build (which reads the
// tracked ./docs mirror), dev reads the docs LIVE from a sibling PhysiClaw
// checkout and hot-reloads on every edit there:
//
//   • Docs source: ../PhysiClaw/docs by default — the code repo checked out next
//     to this one — so edits show up without copying anything in. Override with
//     DOCS_SRC=<dir>; falls back to resolveDocsSrc() (./docs or ./physiclaw-docs)
//     when the sibling checkout isn't present.
//   • Hardware-release artifacts: fetched only when missing. If they're already
//     present locally (served under public/ + gallery images), the fetch is
//     skipped entirely — no network. Otherwise `fetch-release.mjs` runs as usual.
//   • Initial docs sync, then WATCH the source and re-sync on any change; Starlight
//     hot-reloads the split content under src/content/docs. A full re-sync (the
//     output dir is wiped + rebuilt) covers adds, edits, renames & deletes.
//   • Then `astro dev`.
//
// Note: docs.json (the sidebar) is read once at astro-config load, so changing it
// needs a dev-server restart — Astro only reloads on its own config's change.

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, watch } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EDIT_BASE_URL, syncDocs } from './sync-docs.mjs';
import { resolveDocsSrc } from './docs-config.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIBLING = '../PhysiClaw/docs'; // the code repo, checked out next door
const OUT = process.env.DOCS_OUT || 'src/content/docs';

// Prefer an explicit DOCS_SRC; else the sibling PhysiClaw checkout if present;
// else whatever resolveDocsSrc() picks (./docs or ./physiclaw-docs).
const DOCS_SRC =
  process.env.DOCS_SRC ||
  (existsSync(resolve(ROOT, SIBLING)) ? SIBLING : resolveDocsSrc());

if (!existsSync(resolve(ROOT, DOCS_SRC))) {
  console.error(`✗ dev: docs source "${DOCS_SRC}" not found.`);
  console.error(`  Check out the code repo next door so ${SIBLING} exists, or set DOCS_SRC=<dir>.`);
  process.exit(1);
}

// astro.config + sync both resolve the source from DOCS_SRC, so make our choice
// authoritative for every child process.
const env = { ...process.env, DOCS_SRC };

// Are the hardware-release artifacts already laid down locally? (the build-manual
// page + at least one gallery image). If so, dev skips the fetch entirely — no
// network. Delete public/ + src/assets/gallery to force a re-fetch.
const GALLERY_DIR = resolve(ROOT, 'src/assets/gallery');
function artifactsPresent() {
  const manual = existsSync(resolve(ROOT, 'public/en/hardware/manual/index.html'));
  const gallery =
    existsSync(GALLERY_DIR) &&
    readdirSync(GALLERY_DIR, { recursive: true }).some((p) =>
      /\.(png|jpe?g|webp|avif|gif)$/i.test(String(p)),
    );
  return manual && gallery;
}

async function sync() {
  const counts = await syncDocs({ src: DOCS_SRC, out: OUT, editBaseUrl: EDIT_BASE_URL });
  const summary = Object.entries(counts).map(([l, n]) => `${l}:${n}`).join('  ');
  console.log(`✓ sync-docs: ${DOCS_SRC} → ${OUT}  (${summary})`);
}

// ── Teardown ────────────────────────────────────────────────────────────────
const children = [];
let watcher = null;
let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (watcher) watcher.close();
  for (const c of children) c.kill('SIGTERM');
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// 1. Hardware-release artifacts — fetch only when they aren't already here.
//    Non-fatal: a release hiccup shouldn't block content iteration.
if (artifactsPresent()) {
  console.log('• dev: release artifacts already present — skipping fetch.');
} else {
  await new Promise((res) => {
    spawn('node', ['scripts/fetch-release.mjs'], { cwd: ROOT, stdio: 'inherit', env }).on('exit', res);
  });
}

// 2. Initial sync (fail fast if the source is unreadable).
await sync();

// 3. Watch the source; debounce a full re-sync on any change.
let timer = null;
let busy = false;
let pending = false;
async function resync() {
  if (busy) { pending = true; return; } // coalesce changes that land mid-sync
  busy = true;
  try { await sync(); } catch (err) { console.error(`✗ sync-docs: ${err.message}`); }
  busy = false;
  if (pending) { pending = false; resync(); }
}
watcher = watch(resolve(ROOT, DOCS_SRC), { recursive: true }, () => {
  clearTimeout(timer);
  timer = setTimeout(resync, 120);
});
console.log(`• dev: watching ${DOCS_SRC} for changes…`);

// 4. Astro dev server. When it exits (Ctrl-C, crash), tear everything down.
const astro = spawn(join(ROOT, 'node_modules/.bin/astro'), ['dev'], {
  cwd: ROOT,
  stdio: 'inherit',
  env,
});
children.push(astro);
astro.on('exit', (code) => shutdown(code ?? 0));
