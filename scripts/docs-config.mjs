// Loads and validates the doc-owned navigation config (<docs-src>/docs.json) and
// maps it into Starlight's `sidebar` shape. Kept separate from astro.config so the
// validation has unit tests and the renderer config stays declarative.
//
// docs.json is authored WITH the content (see the docs source's docs.schema.json):
// each section lists its pages, in order, by slug — e.g. "start/introduction".
// The docs source is ./docs in production or ./physiclaw-docs in local dev
// (resolveDocsSrc).

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, sep } from 'node:path';

const SLUG_EXT = /\.mdx?$/;
const ZH_SUFFIX = /\.zh\.mdx?$/;

/**
 * Resolve which directory holds the authored docs. Precedence:
 *   1. an explicit `DOCS_SRC` env var (override — e.g. `DOCS_SRC=physiclaw-docs` for
 *      local dev against a separate checkout);
 *   2. `./docs` — the tracked production mirror that CI syncs PhysiClaw/docs into;
 *   3. `./physiclaw-docs` — the local-dev checkout (gitignored), used when `docs/`
 *      isn't present.
 * @param {NodeJS.ProcessEnv} [env]
 * @param {string} [cwd]
 * @returns {string}
 */
export function resolveDocsSrc(env = process.env, cwd = process.cwd()) {
  if (env.DOCS_SRC) return env.DOCS_SRC;
  if (existsSync(join(cwd, 'docs'))) return 'docs';
  return 'physiclaw-docs';
}

/**
 * Validate a parsed docs config and map it to Starlight's `sidebar` array.
 *
 * Pure and filesystem-free: page existence is delegated to an injected
 * `pageExists(slug)` predicate so the mapping/validation can be unit-tested
 * without touching disk. Throws an `Error` with an actionable message on any
 * invalid input; the first problem found wins.
 *
 * @param {unknown} config  parsed docs.json
 * @param {{ pageExists?: (slug: string) => boolean }} [opts]
 * @returns {{ sidebar: any[], slugs: string[] }}
 */
export function buildSidebar(config, { pageExists } = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('docs.json: expected a top-level object.');
  }
  const sidebar = /** @type {any} */ (config).sidebar;
  if (!Array.isArray(sidebar) || sidebar.length === 0) {
    throw new Error('docs.json: "sidebar" must be a non-empty array.');
  }

  const seen = new Set();
  const slugs = [];

  const out = sidebar.map((group, gi) => {
    const where = `sidebar[${gi}]`;
    if (!group || typeof group !== 'object' || Array.isArray(group)) {
      throw new Error(`docs.json: ${where} must be an object.`);
    }
    if (typeof group.label !== 'string' || !group.label.trim()) {
      throw new Error(`docs.json: ${where} needs a non-empty "label".`);
    }
    if (
      group.translations !== undefined &&
      (typeof group.translations !== 'object' ||
        group.translations === null ||
        Array.isArray(group.translations))
    ) {
      throw new Error(`docs.json: section "${group.label}" has an invalid "translations" (expected an object).`);
    }
    if (!Array.isArray(group.items) || group.items.length === 0) {
      throw new Error(`docs.json: section "${group.label}" needs a non-empty "items" array.`);
    }

    const items = group.items.map((entry, ii) => {
      // Escape hatch: a non-string entry is passed through as a raw Starlight item.
      if (typeof entry !== 'string') return entry;
      const slug = entry;
      if (!slug.trim()) throw new Error(`docs.json: section "${group.label}" item ${ii} is empty.`);
      if (slug.startsWith('/')) {
        throw new Error(`docs.json: item "${slug}" must be a bare slug (no leading "/").`);
      }
      if (SLUG_EXT.test(slug)) {
        throw new Error(`docs.json: item "${slug}" must omit the .md/.mdx extension.`);
      }
      if (seen.has(slug)) throw new Error(`docs.json: item "${slug}" is listed more than once.`);
      if (pageExists && !pageExists(slug)) {
        throw new Error(
          `docs.json: item "${slug}" has no default-locale page (expected ${slug}.mdx). ` +
            `A translation-only page (e.g. ${slug}.zh.mdx) can't be listed — add the default-locale source first.`
        );
      }
      seen.add(slug);
      slugs.push(slug);
      return { slug };
    });

    return { label: group.label, translations: group.translations, items };
  });

  return { sidebar: out, slugs };
}

/**
 * Find translation files (`*.zh.mdx`) that have no default-locale sibling
 * (`*.mdx`/`*.md`). These "stray translations" build at their localized URL but
 * have no source to fall back from and can't be reached from the default-locale
 * nav — usually an authoring mistake (renamed the source, forgot the original).
 *
 * @param {string[]} files  markdown paths relative to the docs root, '/'-separated
 * @returns {string[]} the stray translation paths
 */
export function findStrayTranslations(files) {
  const set = new Set(files);
  const stray = [];
  for (const file of set) {
    const m = file.match(/^(.+)\.zh\.(mdx?)$/);
    if (!m) continue;
    if (!set.has(`${m[1]}.mdx`) && !set.has(`${m[1]}.md`)) stray.push(file);
  }
  return stray;
}

/**
 * Read `<src>/docs.json`, validate it against the source tree, and return the
 * Starlight sidebar plus two advisory (non-fatal) lists:
 *   - `orphans`: default-locale pages present in the source but in no section.
 *   - `strayTranslations`: `*.zh.mdx` files with no default-locale sibling.
 *
 * @param {{ src: string, baseUrl: string | URL }} opts
 * @returns {{ sidebar: any[], orphans: string[], strayTranslations: string[] }}
 */
export function loadDocsConfig({ src, baseUrl }) {
  const srcUrl = new URL(`${src}/`, baseUrl);
  const configUrl = new URL('docs.json', srcUrl);

  let parsed;
  try {
    parsed = JSON.parse(readFileSync(configUrl, 'utf8'));
  } catch (err) {
    throw new Error(
      `Could not read ${src}/docs.json (the doc-owned nav config). ` +
        `Check out the code repo's docs/ into ${src}/ first (see README).\n` +
        /** @type {Error} */ (err).message
    );
  }

  // Scan the source tree once.
  const files = readdirSync(srcUrl, { recursive: true })
    .map((p) => String(p).split(sep).join('/'))
    .filter((p) => SLUG_EXT.test(p));
  const defaultSlugs = new Set(
    files.filter((p) => !ZH_SUFFIX.test(p)).map((p) => p.replace(SLUG_EXT, ''))
  );

  // A page "exists" only if it has a default-locale (en) source — translations
  // are optional fallbacks, never the primary. (existsSync kept for parity.)
  const pageExists = (slug) =>
    defaultSlugs.has(slug) || ['.mdx', '.md'].some((ext) => existsSync(new URL(`${slug}${ext}`, srcUrl)));

  const { sidebar, slugs } = buildSidebar(parsed, { pageExists });

  const referenced = new Set(slugs);
  const orphans = [...defaultSlugs].filter((slug) => slug !== 'index' && !referenced.has(slug));
  const strayTranslations = findStrayTranslations(files);

  return { sidebar, orphans, strayTranslations };
}
