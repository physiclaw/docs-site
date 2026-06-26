#!/usr/bin/env node
// Fetches the latest PhysiClaw hardware GitHub release at build time and lays its
// artifacts into public/ so they deploy as plain static files. The release lives
// in physiclaw/PhysiClaw, NOT in this repo's source — so it must be pulled fresh
// on every build (locally and in CI).
//
// What it serves (stable URLs the PhysiClaw docs can link to — same locale-prefixed
// /<locale>/hardware/<slug>/ pattern as the rest of the site):
//
//   /en/hardware/manual/         build manual, English  (HTML + assets/*.svg)
//   /zh/hardware/manual/         build manual, 中文
//   /en/hardware/sourcing-guide/   sourcing guide, English
//   /zh/hardware/sourcing-guide/   sourcing guide, 中文
//   /downloads/physiclaw_manual.pdf         English manual PDF download
//   /downloads/physiclaw装配手册.pdf         中文 manual PDF download
//   /downloads/physiclaw_custom_parts.zip   the 9 custom STEP parts
//   /downloads/physiclaw_assembly_3d.zip    assembled 3D model (.step), repackaged from the camera-frame asset
//   src/assets/gallery/{thumb,full}/         pre-optimized build photos, shown at /{en,zh}/hardware-gallery
//
// `sourcing-guide` (not `sourcing`) avoids colliding with the existing Starlight
// `hardware/sourcing` map page's generated route.
//
// The sourcing guide ships a hardcoded link to the custom-parts zip on a *pinned*
// release tag; we rewrite it to the site-relative /downloads/... path so it always
// points at the parts we actually serve (see rewriteCustomPartsLink).
//
// Release selection (robust, overridable):
//   - default: list releases, keep tags matching `physiclaw-hardware-v<semver>`,
//     pick the highest version (newest hardware release wins).
//   - PHYSICLAW_RELEASE_TAG=physiclaw-hardware-v0.2  pins an exact tag.
//   - GITHUB_TOKEN / GH_TOKEN, when set, authenticates the API calls (higher rate
//     limit — useful on shared CI IPs).
//   - SKIP_FETCH_RELEASE=1 skips entirely (content-only iteration).
//   - FETCH_RELEASE_FORCE=1 ignores the cache and re-downloads.
//
// Downloads are cached under .release-cache/<tag>/ so repeat dev runs are instant;
// if the API is unreachable but a cached copy exists, we fall back to it instead
// of failing the build.

import { spawnSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import {
  readdir, readFile, writeFile, mkdir, copyFile, rm, access,
} from 'node:fs/promises';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { basename, dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildZip } from './zip.mjs';

export const REPO = process.env.PHYSICLAW_REPO || 'physiclaw/PhysiClaw';
export const TAG_PREFIX = 'physiclaw-hardware-v';

// Release asset filenames, and where each lands. `customPartsUrl` is the
// site-relative path the sourcing guide's download link is rewritten to.
export const ASSET_MANUAL = 'physiclaw-assembly-manual.zip';
export const ASSET_SOURCING = 'physiclaw-sourcing-guide.zip';
export const ASSET_PARTS = 'physiclaw_custom_parts.zip';
export const ASSET_ASSEMBLY_3D = 'physiclaw_camera_frame_assembled.zip';
export const CUSTOM_PARTS_URL = '/downloads/physiclaw_custom_parts.zip';

const dirName = (zipName) => zipName.replace(/\.zip$/, '');

// Release assets and how each is handled:
//  - `extract: true` archives are unzipped into the workspace and laid down;
//  - `download` assets are copied verbatim into /downloads/ under that name
//    (the release filename and the served filename may differ);
//  - `repackage` single-file archives are re-zipped so the inner file's stem
//    matches the served zip's stem.
const ASSETS = [
  { file: ASSET_MANUAL, extract: true },
  { file: ASSET_SOURCING, extract: true },
  { file: ASSET_PARTS, download: ASSET_PARTS },
  { file: ASSET_ASSEMBLY_3D, repackage: 'physiclaw_assembly_3d.zip' },
];

// ── Pure helpers (unit-tested) ──────────────────────────────────────────────

/**
 * Parse a hardware release tag into a numeric version, or null if it doesn't
 * match the `physiclaw-hardware-v<n>.<n>…` convention.
 * @param {string} tag
 * @returns {number[] | null}
 */
export function parseHardwareVersion(tag) {
  if (typeof tag !== 'string' || !tag.startsWith(TAG_PREFIX)) return null;
  const rest = tag.slice(TAG_PREFIX.length);
  if (!/^\d+(\.\d+)*$/.test(rest)) return null;
  return rest.split('.').map(Number);
}

/**
 * Compare two numeric version arrays. Returns >0 if a is newer, <0 if older,
 * 0 if equal. Shorter versions are zero-padded (v0.2 === v0.2.0).
 * @param {number[]} a
 * @param {number[]} b
 */
export function compareVersions(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const d = (a[i] || 0) - (b[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * Pick the newest hardware release from a GitHub releases list.
 * @param {Array<{tag_name: string, draft?: boolean, prerelease?: boolean, assets?: any[]}>} releases
 * @param {{ prefix?: string, allowPrerelease?: boolean }} [opts]
 * @returns {object | null}
 */
export function pickLatestRelease(releases, { allowPrerelease = false } = {}) {
  let best = null;
  let bestVer = null;
  for (const rel of releases || []) {
    if (rel.draft) continue;
    if (rel.prerelease && !allowPrerelease) continue;
    const ver = parseHardwareVersion(rel.tag_name);
    if (!ver) continue;
    if (!bestVer || compareVersions(ver, bestVer) > 0) {
      best = rel;
      bestVer = ver;
    }
  }
  return best;
}

/** ASCII-only string? Used to tell the English file (ascii name) from 中文. */
export function isAscii(s) {
  return /^[\x00-\x7F]*$/.test(s);
}

/**
 * Rewrite the sourcing guide's hardcoded custom-parts download link (which points
 * at a pinned release tag) to our site-relative path. Matches any pinned tag so
 * it keeps working as releases roll forward.
 * @param {string} html
 * @param {string} [url]
 * @returns {string}
 */
export function rewriteCustomPartsLink(html, url = CUSTOM_PARTS_URL) {
  const re = new RegExp(
    'https://github\\.com/[^"\'\\s]*/releases/download/' +
      TAG_PREFIX.replace(/[-]/g, '\\$&') +
      '[^"\'\\s/]+/' +
      ASSET_PARTS.replace(/[.]/g, '\\$&'),
    'g',
  );
  return html.replace(re, url);
}

// ── IO ──────────────────────────────────────────────────────────────────────

function authHeaders() {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const headers = {
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'physiclaw-docs-site-build',
    'X-GitHub-Api-Version': '2022-11-28',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function listReleases() {
  const url = `https://api.github.com/repos/${REPO}/releases?per_page=100`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

async function getReleaseByTag(tag) {
  const url = `https://api.github.com/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`;
  const res = await fetch(url, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(`GitHub API ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

function pickAsset(release, name) {
  const asset = (release.assets || []).find((a) => a.name === name);
  if (!asset) {
    throw new Error(`release ${release.tag_name} is missing asset "${name}"`);
  }
  return asset;
}

async function exists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest, attempts = 3) {
  await mkdir(dirname(dest), { recursive: true });
  let lastErr;
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'physiclaw-docs-site-build' },
        redirect: 'follow',
      });
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status} ${res.statusText}`);
      }
      await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
      return;
    } catch (err) {
      lastErr = err;
      if (i < attempts) console.warn(`  ⚠ download attempt ${i}/${attempts} failed (${err.message}) — retrying`);
    }
  }
  throw new Error(`download failed after ${attempts} attempts for ${url}: ${lastErr.message}`);
}

function unzip(zip, dest) {
  const r = spawnSync('unzip', ['-o', '-q', zip, '-d', dest], { stdio: 'inherit' });
  if (r.error && r.error.code === 'ENOENT') {
    throw new Error('`unzip` not found on PATH — install it (e.g. apt-get install unzip).');
  }
  if (r.status !== 0) throw new Error(`unzip failed (${r.status}) for ${zip}`);
}

/** Recursively collect every file path under dir. */
async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

/**
 * Re-zip a single-file archive so the inner file's stem matches the output zip's
 * stem (keeping the inner file's extension): e.g. camera_40_frame_assembled.step
 * inside physiclaw_camera_frame_assembled.zip becomes physiclaw_assembly_3d.step
 * inside physiclaw_assembly_3d.zip. Throws if the source isn't a single file.
 */
async function repackageZip(srcZip, destZip, workDir) {
  const stem = basename(destZip, '.zip');
  const tmp = join(workDir, stem);
  await rm(tmp, { recursive: true, force: true });
  unzip(srcZip, tmp);

  const inner = await walk(tmp);
  if (inner.length !== 1) {
    throw new Error(`repackage: expected one file in ${basename(srcZip)}, found ${inner.length}`);
  }
  const data = await readFile(inner[0]);
  await mkdir(dirname(destZip), { recursive: true });
  await writeFile(destZip, buildZip([{ name: stem + extname(inner[0]), data }]));
}

/**
 * Split a list of file paths into the English (ascii basename) and 中文 file for
 * a given extension. Throws if either is missing — a malformed release should
 * fail the build loudly, not deploy a half-built manual.
 */
function splitByLocale(files, ext, label) {
  const matches = files.filter((f) => extname(f).toLowerCase() === ext);
  const en = matches.find((f) => isAscii(basename(f)));
  const zh = matches.find((f) => !isAscii(basename(f)));
  if (!en || !zh) {
    throw new Error(
      `expected an English and a 中文 ${label} (${ext}); found: ${matches.map(basename).join(', ') || 'none'}`,
    );
  }
  return { en, zh };
}

async function copyInto(src, dest) {
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const CACHE = join(ROOT, '.release-cache');
const MARKER = join(PUBLIC, '.release-version');

const LOCALES = ['en', 'zh'];

// Served under the same locale-prefixed /<locale>/hardware/<slug>/ route pattern as
// the rest of the site. `sourcing-guide` (not `sourcing`) so it never collides with
// the existing Starlight `hardware/sourcing` map page's generated route.
const MANUAL_SLUG = 'manual';
const SOURCING_SLUG = 'sourcing-guide';
const pageDir = (locale, slug) => join(PUBLIC, locale, 'hardware', slug);
// Probe file used to tell whether output is already present (cache/skip logic).
const MANUAL_PROBE = join(pageDir('en', MANUAL_SLUG), 'index.html');

// Output dirs this script owns and regenerates. Wiped before each lay-down so
// stale files from an older release never linger.
const OWNED = [
  ...LOCALES.flatMap((l) => [pageDir(l, MANUAL_SLUG), pageDir(l, SOURCING_SLUG)]),
  join(PUBLIC, 'downloads'),
];

// The build-photo gallery is a SEPARATE, fixed-tag release (physiclaw-hardware-gallery),
// updated in place. Its zip holds images ALREADY optimized once by scripts/optimize-gallery.mjs
// (thumb/ + full/ webp), so the build just downloads (~small) and unzips into src/assets/gallery/
// — NO image processing. Cache is keyed on the asset's upload time.
const GALLERY_TAG = 'physiclaw-hardware-gallery';
const ASSET_GALLERY = 'physiclaw_hardware_gallery.zip';
const GALLERY_DIR = join(ROOT, 'src', 'assets', 'gallery');
const GALLERY_MARKER = join(GALLERY_DIR, '.gallery-version');
const IMAGE_RE = /\.(png|jpe?g|webp|avif|gif)$/i;

async function layDownManual(extractDir) {
  const files = await walk(extractDir);
  const assets = files.filter((f) => /(^|[\\/])assets[\\/]/.test(f));
  if (assets.length === 0) throw new Error('manual: no assets/ found in archive');
  const html = splitByLocale(files, '.html', 'manual page');
  const pdf = splitByLocale(files, '.pdf', 'manual PDF');

  for (const locale of LOCALES) {
    const out = pageDir(locale, MANUAL_SLUG);
    await copyInto(html[locale], join(out, 'index.html'));
    for (const a of assets) {
      await copyInto(a, join(out, 'assets', basename(a)));
    }
    // PDFs are downloads, so they live under /downloads/ alongside the parts zip.
    // Keep each release filename verbatim (English `physiclaw_manual.pdf`, 中文
    // `physiclaw装配手册.pdf`) so the browser saves it under that name.
    await copyInto(pdf[locale], join(PUBLIC, 'downloads', basename(pdf[locale])));
  }
}

async function layDownSourcing(extractDir) {
  const files = await walk(extractDir);
  const html = splitByLocale(files, '.html', 'sourcing page');
  for (const locale of LOCALES) {
    const fixed = rewriteCustomPartsLink(await readFile(html[locale], 'utf8'));
    const dest = join(pageDir(locale, SOURCING_SLUG), 'index.html');
    await mkdir(dirname(dest), { recursive: true });
    await writeFile(dest, fixed);
  }
}

/**
 * Fetch the pre-optimized build-photo gallery (its own fixed-tag release) and unzip
 * it into src/assets/gallery/ (preserving its thumb/ + full/ layout). The tag is
 * stable but its zip is replaced in place, so the cache is keyed on the asset's
 * upload time. Throws before touching the output dir on the offline path, so a
 * previously fetched gallery survives.
 */
async function fetchGallery(force) {
  const release = await getReleaseByTag(GALLERY_TAG);
  const asset = pickAsset(release, ASSET_GALLERY);
  const version = String(asset.updated_at || asset.id);

  const current = (await exists(GALLERY_MARKER)) ? (await readFile(GALLERY_MARKER, 'utf8')).trim() : null;
  const haveImages =
    (await exists(GALLERY_DIR)) && (await walk(GALLERY_DIR)).some((f) => IMAGE_RE.test(f));
  if (!force && current === version && haveImages) {
    console.log('✓ fetch-release: gallery up to date — skipping.');
    return;
  }

  console.log(`• fetch-release: gallery → ${GALLERY_TAG}`);
  const cacheDir = join(CACHE, 'gallery');
  const zip = join(cacheDir, ASSET_GALLERY);
  if (force || current !== version || !(await exists(zip))) {
    console.log(`  ↓ ${ASSET_GALLERY}`);
    await download(asset.browser_download_url, zip);
  }
  await rm(GALLERY_DIR, { recursive: true, force: true });
  await mkdir(GALLERY_DIR, { recursive: true });
  unzip(zip, GALLERY_DIR);

  const count = (await walk(GALLERY_DIR)).filter((f) => IMAGE_RE.test(f)).length;
  if (count === 0) throw new Error(`no images found in ${ASSET_GALLERY}`);
  await writeFile(GALLERY_MARKER, version + '\n');
  console.log(`✓ fetch-release: served ${count} gallery image(s) → src/assets/gallery/`);
}

async function main() {
  if (process.env.SKIP_FETCH_RELEASE) {
    console.log('• fetch-release: SKIP_FETCH_RELEASE set — skipping.');
    return;
  }

  const pinned = process.env.PHYSICLAW_RELEASE_TAG;
  const force = !!process.env.FETCH_RELEASE_FORCE;

  // Build-photo gallery (separate fixed-tag release of pre-optimized images).
  // Non-fatal: a gallery hiccup shouldn't fail the whole docs build.
  try {
    await fetchGallery(force);
  } catch (err) {
    console.warn(`⚠ fetch-release: gallery skipped — ${err.message}`);
  }

  // What we've already served — read once, used by both the cache-skip and the
  // offline-fallback paths below.
  const cachedTag = (await exists(MARKER)) ? (await readFile(MARKER, 'utf8')).trim() : null;
  const haveOutput = await exists(MANUAL_PROBE);

  // Resolve which release to use. Fall back to the cached copy if the API is down.
  let release;
  let tag;
  try {
    release = pinned ? await getReleaseByTag(pinned) : pickLatestRelease(await listReleases());
    if (!release) {
      throw new Error(`no release matching "${TAG_PREFIX}*" found in ${REPO}`);
    }
    tag = release.tag_name;
  } catch (err) {
    if (cachedTag && !force && haveOutput) {
      console.warn(`⚠ fetch-release: ${err.message}`);
      console.warn(`  using already-served release ${cachedTag} from public/.`);
      return;
    }
    throw err;
  }

  // Already up to date? (marker matches and output is present)
  if (!force && cachedTag === tag && haveOutput) {
    console.log(`✓ fetch-release: ${tag} already served — skipping (FETCH_RELEASE_FORCE=1 to refresh).`);
    return;
  }

  console.log(`• fetch-release: ${REPO} → ${tag}`);

  // Download (cached per tag) + extract into a fresh per-tag workspace.
  const cacheDir = join(CACHE, tag);
  const workDir = join(cacheDir, 'extract');
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  // Downloads are independent — fetch concurrently (cold builds are dominated by
  // the ~18MB manual). Extraction is CPU-bound, so it stays sequential after.
  await Promise.all(ASSETS.map(async ({ file }) => {
    const zip = join(cacheDir, file);
    if (force || !(await exists(zip))) {
      console.log(`  ↓ ${file}`);
      await download(pickAsset(release, file).browser_download_url, zip);
    }
  }));
  for (const { file, extract } of ASSETS) {
    if (extract) unzip(join(cacheDir, file), join(workDir, dirName(file)));
  }

  // Lay everything down fresh.
  for (const dir of OWNED) await rm(dir, { recursive: true, force: true });
  await layDownManual(join(workDir, dirName(ASSET_MANUAL)));
  await layDownSourcing(join(workDir, dirName(ASSET_SOURCING)));
  for (const { file, download, repackage } of ASSETS) {
    if (download) await copyInto(join(cacheDir, file), join(PUBLIC, 'downloads', download));
    if (repackage) await repackageZip(join(cacheDir, file), join(PUBLIC, 'downloads', repackage), workDir);
  }

  await writeFile(MARKER, tag + '\n');
  console.log(`✓ fetch-release: served ${tag} → /{en,zh}/hardware/{manual,sourcing-guide}/ + /downloads/`);
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(`✗ fetch-release: ${err.message}`);
    process.exit(1);
  });
}
