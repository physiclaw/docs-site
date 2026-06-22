#!/usr/bin/env node
// Splits the co-located bilingual docs from the docs source into the per-locale
// layout Starlight expects, under its default content path `src/content/docs/`:
//
//   <docs-src>/intro.mdx      → src/content/docs/en/intro.mdx
//   <docs-src>/intro.zh.mdx   → src/content/docs/zh/intro.mdx   (.zh trimmed)
//
// The docs source is ./docs in production (CI mirrors PhysiClaw/docs into it) or
// ./physiclaw-docs in local dev — resolved by resolveDocsSrc().
//
// Writing to the default path lets Starlight's docsLoader() find the content and
// the docs.json sidebar slugs resolve, without a custom loader. Non-markdown assets
// are copied into every locale. The output dir is wiped first so builds are idempotent.
//
// Authors write import-free Markdown: .mdx files are preprocessed here to inject
// the `@astrojs/starlight/components` import for whatever components they use.

import { readdir, readFile, writeFile, mkdir, copyFile, rm, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NON_CONTENT_FILES, resolveDocsSrc } from './docs-config.mjs';

// The single source of truth for the authoring convention.
// '' (no suffix) is the default language; '.zh' marks the Chinese sibling.
export const LOCALE_BY_SUFFIX = { '': 'en', '.zh': 'zh' };

const MARKDOWN = new Set(['.md', '.mdx']);

// Base for the "Edit page" links. Docs are authored co-located in the PhysiClaw
// repo (docs/intro.mdx + docs/intro.zh.mdx), so the edit link must point back to
// that real source path. We inject it per-page as frontmatter `editUrl` (see
// injectEditUrl) because Starlight would otherwise append the split content path
// (src/content/docs/en/…), which doesn't exist in the source repo.
export const EDIT_BASE_URL =
  process.env.EDIT_BASE_URL || 'https://github.com/physiclaw/PhysiClaw/edit/main/docs/';

// Starlight components an author may use without importing them — the sync step
// injects the import so docs read like plain Markdown.
export const STARLIGHT_COMPONENTS = [
  'Aside', 'Badge', 'Card', 'CardGrid', 'Code', 'FileTree',
  'Icon', 'LinkButton', 'LinkCard', 'Steps', 'TabItem', 'Tabs',
];

// One detection regex, compiled once. Longest names first so `CardGrid` wins
// over its `Card` prefix.
const COMPONENT_TAG = new RegExp(
  `<(${[...STARLIGHT_COMPONENTS].sort((a, b) => b.length - a.length).join('|')})(?=[\\s/>])`,
  'g'
);

/**
 * Inject the `@astrojs/starlight/components` import for whichever components an
 * .mdx file references, right after its frontmatter. No-op when none are used
 * or an import is already present. Component tags shown inside code spans/blocks
 * are ignored — a lightweight heuristic that fits prose docs; reach for a remark
 * AST pass only if docs ever need finer control.
 * @param {string} content
 * @returns {string}
 */
export function injectComponentImports(content) {
  if (/from ['"]@astrojs\/starlight\/components['"]/.test(content)) return content;

  const prose = content.replace(/```[\s\S]*?```/g, '').replace(/`[^`]*`/g, '');
  const used = [...new Set(Array.from(prose.matchAll(COMPONENT_TAG), (m) => m[1]))].sort();
  if (used.length === 0) return content;

  const importLine = `import { ${used.join(', ')} } from '@astrojs/starlight/components';\n`;
  const frontmatter = content.match(/^---\n[\s\S]*?\n---\n/);
  if (frontmatter) {
    const at = frontmatter[0].length;
    return content.slice(0, at) + '\n' + importLine + content.slice(at);
  }
  return importLine + '\n' + content;
}

/**
 * Insert an `editUrl` into a markdown file's frontmatter so Starlight's "Edit
 * page" link points at the real co-located source in the code repo
 * (e.g. .../docs/start/intro.zh.mdx), not the per-locale split path under
 * src/content/docs that Starlight derives by default. No-op when the file has
 * no frontmatter or already declares `editUrl` (an author override wins).
 * @param {string} content
 * @param {string} editUrl
 * @returns {string}
 */
export function injectEditUrl(content, editUrl) {
  const m = content.match(/^(---\n[\s\S]*?\n)(---\n)/);
  if (!m) return content; // no frontmatter — nothing to extend
  if (/^editUrl:/m.test(m[1])) return content; // author set it explicitly
  return m[1] + `editUrl: ${JSON.stringify(editUrl)}\n` + m[2] + content.slice(m[0].length);
}

/**
 * Map a source filename to its target locale and output filename.
 * @param {string} filename e.g. "intro.zh.mdx"
 * @returns {{ locale: string, outName: string }}
 */
export function classify(filename) {
  const ext = extname(filename);
  const base = filename.slice(0, -ext.length || undefined);

  for (const [suffix, locale] of Object.entries(LOCALE_BY_SUFFIX)) {
    if (suffix && base.endsWith(suffix)) {
      return { locale, outName: base.slice(0, -suffix.length) + ext };
    }
  }
  return { locale: LOCALE_BY_SUFFIX[''], outName: filename };
}

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
 * Split a source docs tree into per-locale directories.
 * @param {{ src: string, out: string, editBaseUrl?: string }} opts
 *   `editBaseUrl`, when set, is prefixed to each doc's source path (relative to
 *   `src`, '/'-separated, .zh suffix preserved) and injected as frontmatter
 *   `editUrl` so the "Edit page" link targets the real co-located source.
 * @returns {Promise<Record<string, number>>} count of markdown docs per locale
 */
export async function syncDocs({ src, out, editBaseUrl }) {
  await rm(out, { recursive: true, force: true });

  const locales = [...new Set(Object.values(LOCALE_BY_SUFFIX))];
  const counts = Object.fromEntries(locales.map((l) => [l, 0]));

  const madeDirs = new Set();
  const ensureDir = async (dir) => {
    if (madeDirs.has(dir)) return;
    await mkdir(dir, { recursive: true });
    madeDirs.add(dir);
  };

  for (const file of await walk(src)) {
    const rel = relative(src, file);
    const parts = rel.split(sep);
    const name = parts.pop();
    const ext = extname(name);

    // Skip root-level config files (docs.json etc.) — they're read by the
    // renderer, not part of the content.
    if (parts.length === 0 && NON_CONTENT_FILES.has(name)) continue;

    if (MARKDOWN.has(ext)) {
      // Markdown: route to one locale, trimming the .zh suffix.
      const { locale, outName } = classify(name);
      const dest = join(out, locale, ...parts, outName);
      await ensureDir(dirname(dest));
      // Preprocess: point the edit link at the real co-located source, then
      // (for .mdx) inject component imports so authoring stays import-free.
      let text = await readFile(file, 'utf8');
      if (editBaseUrl) text = injectEditUrl(text, editBaseUrl + rel.split(sep).join('/'));
      if (ext === '.mdx') text = injectComponentImports(text);
      await writeFile(dest, text);
      counts[locale] += 1;
    } else {
      // Asset: shared across every locale so relative links resolve.
      for (const locale of locales) {
        const dest = join(out, locale, ...parts, name);
        await ensureDir(dirname(dest));
        await copyFile(file, dest);
      }
    }
  }
  return counts;
}

// ── CLI ───────────────────────────────────────────────────────────────────
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const src = resolveDocsSrc();
  // Starlight's default content location, so docsLoader() picks it up.
  const out = process.env.DOCS_OUT || 'src/content/docs';

  try {
    await stat(src);
  } catch {
    console.error(`✗ sync-docs: docs source "${src}" not found.`);
    console.error(`  Production: CI mirrors PhysiClaw/docs into ./docs.`);
    console.error(`  Local dev: check out the docs into ./physiclaw-docs (see README).`);
    process.exit(1);
  }

  const counts = await syncDocs({ src, out, editBaseUrl: EDIT_BASE_URL });
  const summary = Object.entries(counts)
    .map(([l, n]) => `${l}:${n}`)
    .join('  ');
  console.log(`✓ sync-docs: ${src} → ${out}  (${summary})`);
}
