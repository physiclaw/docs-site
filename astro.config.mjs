// @ts-check
// Standalone Starlight docs site for PhysiClaw → docs.physiclaw.ai.
// Content is authored in physiclaw/PhysiClaw under docs/. The build reads it from
// ./docs (the CI-synced mirror; resolveDocsSrc), while `pnpm dev` reads it live
// from the sibling ../PhysiClaw/docs checkout (DOCS_SRC, set by scripts/dev.mjs).
// Either way it's split into src/content/docs/{en,zh} by scripts/sync-docs.mjs.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'astro/config';
import { unified } from '@astrojs/markdown-remark';
import starlight from '@astrojs/starlight';
import { loadDocsConfig, resolveDocsSrc } from './scripts/docs-config.mjs';

const DEFAULT_LOCALE = 'en'; // ← change this one value to switch the default language

// Navigation lives WITH the content, not in this renderer: <docs-src>/docs.json
// (authored in the code repo alongside the docs) declares the sidebar sections and
// the order of pages within them, so editing the nav is a docs change, not a
// renderer change. The docs source is resolved by resolveDocsSrc (./docs in
// production; ../PhysiClaw/docs under `pnpm dev`, via DOCS_SRC). The loader validates
// docs.json and maps slugs → Starlight links; see docs.schema.json for the schema.
const DOCS_SRC = resolveDocsSrc();
const { sidebar: SIDEBAR, orphans, strayTranslations } = loadDocsConfig({
  src: DOCS_SRC,
  baseUrl: import.meta.url,
});
if (orphans.length > 0) {
  console.warn(
    `⚠ docs.json: ${orphans.length} page(s) are not listed in any sidebar section ` +
      `and will be unreachable from the nav: ${orphans.join(', ')}`
  );
}
if (strayTranslations.length > 0) {
  console.warn(
    `⚠ docs: ${strayTranslations.length} translation(s) have no default-locale (en) source — ` +
      `they can't fall back or appear in the nav; add the source or remove them: ${strayTranslations.join(', ')}`
  );
}

// Custom code headers: show the language (BASH, JSON5, …) as the frame
// title where Expressive Code would otherwise draw terminal dots / a blank tab.
// CSS (docs.css) then hides the dots, strips the tab chrome, and left-aligns it.
const codeLanguageLabel = {
  name: 'code-language-label',
  hooks: {
    /** @param {{ codeBlock: { language: string, props: { title?: string } } }} ctx */
    preprocessMetadata({ codeBlock }) {
      if (codeBlock.props.title) return; // respect explicit title="…"
      /** @type {Record<string, string>} */
      const alias = { sh: 'bash', shell: 'bash', shellscript: 'bash', zsh: 'bash', console: 'bash' };
      const lang = alias[codeBlock.language] || codeBlock.language;
      if (!lang || ['plaintext', 'text', 'txt', 'ansi'].includes(lang)) return;
      codeBlock.props.title = lang;
    },
  },
};

const LOCALES = {
  en: { label: 'English', lang: 'en' },
  zh: { label: '简体中文', lang: 'zh-CN' },
};

// Open outbound links in a new tab. A link is "internal" (stays in the same tab)
// when it's relative or points at physiclaw.ai (or any subdomain — docs./www.);
// everything else (GitHub, vendor stores, …) opens in a new tab with safe rel.
// Dependency-free rehype plugin so there's nothing new to install.
/** @param {string} host */
const isInternalHost = (host) => host === 'physiclaw.ai' || host.endsWith('.physiclaw.ai');
function rehypeExternalLinksNewTab() {
  /** @param {any} node */
  const walk = (node) => {
    if (node.tagName === 'a' && node.properties && typeof node.properties.href === 'string') {
      const href = node.properties.href;
      if (/^https?:\/\//i.test(href)) {
        let host = '';
        try { host = new URL(href).hostname.toLowerCase(); } catch { /* malformed → leave as-is */ }
        if (host && !isInternalHost(host)) {
          node.properties.target = '_blank';
          node.properties.rel = ['noopener', 'noreferrer'];
        }
      }
    }
    if (node.children) for (const child of node.children) walk(child);
  };
  return (/** @type {any} */ tree) => walk(tree);
}

// Dev-only: the hardware manual/sourcing-guide are static HTML laid into public/
// by fetch-release.mjs (e.g. public/en/hardware/manual/index.html). Astro's dev
// server serves public/ files by exact path but doesn't resolve a directory URL
// (/en/hardware/manual/) to its index.html — so those pages 404 in `astro dev`,
// though Vercel serves them in production. Rewrite a trailing-slash request to
// index.html WHEN that public file exists, so dev matches prod. Scoped by the
// existsSync check: Starlight's own routes have no public index.html, so they're
// untouched. apply:'serve' keeps this out of the build.
const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));
function serveStaticDirIndex() {
  return {
    name: 'physiclaw:serve-static-dir-index',
    apply: /** @type {'serve'} */ ('serve'),
    /** @param {any} server */
    configureServer(server) {
      server.middlewares.use((/** @type {any} */ req, /** @type {any} */ _res, /** @type {any} */ next) => {
        const [path, query] = (req.url || '').split('?');
        // path starts with '/', PUBLIC_DIR has none, so concatenation is a clean join.
        if (path.endsWith('/') && existsSync(`${PUBLIC_DIR}${path}index.html`)) {
          req.url = `${path}index.html${query ? `?${query}` : ''}`;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  site: 'https://docs.physiclaw.ai',
  redirects: {
    '/': `/${DEFAULT_LOCALE}/`,
    '/hardware-gallery': `/${DEFAULT_LOCALE}/hardware-gallery/`,
  },
  // Astro 6.4+ markdown processor (the default unified() pipeline) with our
  // rehype plugin. Starlight appends its own remark/rehype plugins onto this
  // processor, so gfm/smartypants/asides/anchors are preserved.
  markdown: { processor: unified({ rehypePlugins: [rehypeExternalLinksNewTab] }) },
  // Dev-only: serve the fetched static hardware pages at their directory URL
  // (/en/hardware/manual/ → its index.html); see serveStaticDirIndex above.
  vite: { plugins: [serveStaticDirIndex()] },
  integrations: [
    starlight({
      title: { en: 'PhysiClaw Docs', 'zh-CN': 'PhysiClaw 文档' },
      tagline: 'The agent that interacts with you in the real world.',
      logo: { src: './src/assets/crab.svg', alt: 'PhysiClaw' },
      favicon: '/favicon.svg',
      defaultLocale: DEFAULT_LOCALE,
      locales: LOCALES,
      customCss: ['./src/styles/docs.css'],
      // PageTitle: breadcrumb path above the title.
      // ThemeSelect: a two-state light/dark toggle (no "auto", no dropdown).
      // Header: moves the language select next to the site title.
      // LanguageSelect: a custom, styled dropdown menu (not a native <select>).
      components: {
        PageTitle: './src/components/PageTitle.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        Header: './src/components/Header.astro',
        LanguageSelect: './src/components/LanguageSelect.astro',
      },
      // Code blocks: the GitHub syntax palette on a dark #101010 / light
      // surface, 9px rounded, soft elevation.
      // Background/border/shadow are CSS vars so they track the theme toggle.
      expressiveCode: {
        themes: ['github-dark-default', 'github-light-default'],
        plugins: [codeLanguageLabel],
        styleOverrides: {
          borderRadius: '9px',
          borderColor: 'var(--pc-code-border)',
          codeBackground: 'var(--pc-code-block)',
          codePaddingBlock: '12px',
          codePaddingInline: '14px',
          frames: {
            frameBoxShadowCssValue: 'var(--pc-code-shadow)',
            editorTabBarBackground: 'var(--pc-code-block)',
            editorActiveTabBackground: 'var(--pc-code-block)',
            terminalBackground: 'var(--pc-code-block)',
            terminalTitlebarBackground: 'var(--pc-code-block)',
          },
        },
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/physiclaw/PhysiClaw' },
      ],
      // "Edit page" links are injected per-page as frontmatter `editUrl` by
      // scripts/sync-docs.mjs (EDIT_BASE_URL), pointing at the real co-located
      // source in the PhysiClaw repo (docs/<path>.mdx / .zh.mdx). Starlight's
      // editLink.baseUrl is intentionally unset: it would append the split
      // content path (src/content/docs/en/…), which doesn't exist upstream.
      // No web fonts — the theme uses the system monospace/sans stacks
      // (ui-monospace / ui-sans-serif) for a zero-font-load setup.
      // Sidebar sections and the page order within them come from the docs
      // source's docs.json (validated + mapped into SIDEBAR above).
      sidebar: SIDEBAR,
    }),
  ],
});
