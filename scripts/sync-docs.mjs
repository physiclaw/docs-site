#!/usr/bin/env node
// Splits the co-located bilingual docs in `physiclaw-docs/` into the per-locale
// layout Starlight expects, under its default content path `src/content/docs/`:
//
//   physiclaw-docs/intro.mdx      → src/content/docs/en/intro.mdx
//   physiclaw-docs/intro.zh.mdx   → src/content/docs/zh/intro.mdx   (.zh trimmed)
//
// Writing to the default path lets Starlight's docsLoader() + sidebar
// autogenerate work without a custom loader. Non-markdown assets are copied
// into every locale. The output dir is wiped first so the build is idempotent.
//
// Authors write import-free Markdown: .mdx files are preprocessed here to inject
// the `@astrojs/starlight/components` import for whatever components they use.

import { readdir, readFile, writeFile, mkdir, copyFile, rm, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// The single source of truth for the authoring convention.
// '' (no suffix) is the default language; '.zh' marks the Chinese sibling.
export const LOCALE_BY_SUFFIX = { '': 'en', '.zh': 'zh' };

const MARKDOWN = new Set(['.md', '.mdx']);

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
 * @param {{ src: string, out: string }} opts
 * @returns {Promise<Record<string, number>>} count of markdown docs per locale
 */
export async function syncDocs({ src, out }) {
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

    if (MARKDOWN.has(ext)) {
      // Markdown: route to one locale, trimming the .zh suffix.
      const { locale, outName } = classify(name);
      const dest = join(out, locale, ...parts, outName);
      await ensureDir(dirname(dest));
      if (ext === '.mdx') {
        // Preprocess: inject component imports so authoring stays import-free.
        await writeFile(dest, injectComponentImports(await readFile(file, 'utf8')));
      } else {
        await copyFile(file, dest);
      }
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
  const src = process.env.DOCS_SRC || 'physiclaw-docs';
  // Starlight's default content location, so docsLoader() + autogenerate work.
  const out = process.env.DOCS_OUT || 'src/content/docs';

  try {
    await stat(src);
  } catch {
    console.error(`✗ sync-docs: source "${src}" not found.`);
    console.error(`  Check out the code repo's docs/ into ${src}/ first (see README).`);
    process.exit(1);
  }

  const counts = await syncDocs({ src, out });
  const summary = Object.entries(counts)
    .map(([l, n]) => `${l}:${n}`)
    .join('  ');
  console.log(`✓ sync-docs: ${src} → ${out}  (${summary})`);
}
