// @ts-check
// Standalone Starlight docs site for PhysiClaw → docs.physiclaw.ai.
// Content is authored in physiclaw/PhysiClaw under docs/, checked out into
// physiclaw-docs/, and split into src/content/docs/{en,zh} by scripts/sync-docs.mjs.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { loadDocsConfig } from './scripts/docs-config.mjs';

const DEFAULT_LOCALE = 'en'; // ← change this one value to switch the default language

// Navigation lives WITH the content, not in this renderer: physiclaw-docs/docs.json
// (authored in the code repo alongside the docs) declares the sidebar sections and
// the order of pages within them, so editing the nav is a docs change, not a
// renderer change. The loader validates it and maps slugs → Starlight sidebar links;
// see physiclaw-docs/docs.schema.json for the authoring schema.
const DOCS_SRC = process.env.DOCS_SRC || 'physiclaw-docs';
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

// openclaw-style code headers: show the language (BASH, JSON5, …) as the frame
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

export default defineConfig({
  site: 'https://docs.physiclaw.ai',
  redirects: { '/': `/${DEFAULT_LOCALE}/` },
  integrations: [
    starlight({
      title: 'PhysiClaw Doc',
      tagline: 'The AI that physically uses your phone.',
      logo: { src: './src/assets/crab.svg', alt: 'PhysiClaw' },
      favicon: '/favicon.svg',
      defaultLocale: DEFAULT_LOCALE,
      locales: LOCALES,
      customCss: ['./src/styles/docs.css'],
      // PageTitle: breadcrumb path above the title.
      // ThemeSelect: a two-state light/dark toggle (no "auto", no dropdown).
      // Header: moves the language select next to the site title.
      // LanguageSelect: a custom, styled dropdown menu (not a native <select>).
      // Head: adds Astro's ClientRouter for smooth view-transition navigation.
      components: {
        PageTitle: './src/components/PageTitle.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
        Header: './src/components/Header.astro',
        LanguageSelect: './src/components/LanguageSelect.astro',
        Head: './src/components/Head.astro',
      },
      // Code blocks, openclaw-style: GitHub syntax palette (the colors openclaw
      // uses) on its dark #101010 / light surface, 9px rounded, soft elevation.
      // Background/border/shadow are CSS vars so they track the theme toggle.
      expressiveCode: {
        themes: ['github-dark-default', 'github-light-default'],
        plugins: [codeLanguageLabel],
        styleOverrides: {
          borderRadius: '9px',
          borderColor: 'var(--oc-code-border)',
          codeBackground: 'var(--oc-code-block)',
          codePaddingBlock: '12px',
          codePaddingInline: '14px',
          frames: {
            frameBoxShadowCssValue: 'var(--oc-code-shadow)',
            editorTabBarBackground: 'var(--oc-code-block)',
            editorActiveTabBackground: 'var(--oc-code-block)',
            terminalBackground: 'var(--oc-code-block)',
            terminalTitlebarBackground: 'var(--oc-code-block)',
          },
        },
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/physiclaw/PhysiClaw' },
      ],
      editLink: {
        baseUrl: 'https://github.com/physiclaw/PhysiClaw/edit/main/docs/',
      },
      // No web fonts — the theme uses the system monospace/sans stacks
      // (ui-monospace / ui-sans-serif), matching openclaw's zero-font-load setup.
      // Sidebar sections come from physiclaw-docs/docs.json (see SIDEBAR above);
      // pages within each section are auto-generated from the docs tree and
      // ordered by each doc's `sidebar.order` frontmatter.
      sidebar: SIDEBAR,
    }),
  ],
});
