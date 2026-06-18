# PhysiClaw Docs Site

The documentation site for [**PhysiClaw**](https://github.com/physiclaw/PhysiClaw) — a robotic arm
that gives AI agents a physical body to operate any phone.

**Live:** [docs.physiclaw.ai](https://docs.physiclaw.ai) · **Landing page:** [physiclaw.ai](https://physiclaw.ai) ([physiclaw/PhysiClaw-site](https://github.com/physiclaw/PhysiClaw-site))

Built with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build).

## What this repo is

This repo is the **renderer**, not the content. The documentation Markdown lives next to the code in
[`physiclaw/PhysiClaw`](https://github.com/physiclaw/PhysiClaw) under `docs/`, so docs ship in the same
pull request as the code they describe. This repo turns that Markdown into the static site.

```
physiclaw/PhysiClaw   docs/      →   docs/        →   src/content/docs/{en,zh}   →   dist/
(content, bilingual)   mirror         (this repo)      scripts/sync-docs.mjs         Starlight build
```

## Docs source: `docs/` vs `physiclaw-docs/`

The build reads the authored docs from one directory, chosen by `resolveDocsSrc()`
(`scripts/docs-config.mjs`):

| Directory          | Tracked?           | Used when                       | Purpose                                  |
| ------------------ | ------------------ | ------------------------------- | ---------------------------------------- |
| `docs/`            | **yes**            | always preferred when present   | the production mirror CI syncs PhysiClaw/docs into |
| `physiclaw-docs/`  | no (gitignored)    | fallback, when `docs/` is absent | a local-dev checkout                     |

Override with `DOCS_SRC=<dir>` (e.g. `DOCS_SRC=physiclaw-docs pnpm dev`).

## Documentation conventions

### Where docs live & i18n

Docs are authored in the **code repo** at `docs/`, with translations **co-located by filename suffix** —
`intro.mdx` (English) sits next to `intro.zh.mdx` (简体中文). `scripts/sync-docs.mjs` splits these into
Starlight's per-locale layout (`src/content/docs/en/`, `src/content/docs/zh/`), stripping the `.zh`
suffix. The default language is a single `DEFAULT_LOCALE` constant in `astro.config.mjs`.

Every page needs a **default-locale (English) source**; a `.zh` sibling is an optional translation.
A missing `.zh` falls back to the English content; a `.zh` file with no English source is flagged at
build time.

### Authoring — write plain Markdown, no imports

Docs read like Markdown, not code. Authors **never write `import` statements**.

- **Callouts** use native directives: `:::note`, `:::tip[Title]`, `:::caution`, `:::danger`.
- **Components** ([Card, CardGrid, Steps, Tabs, FileTree, LinkCard, …](https://starlight.astro.build/components/))
  are written as bare tags in `.mdx` files — `scripts/sync-docs.mjs` injects the
  `@astrojs/starlight/components` import during sync. Use `.md` for prose, `.mdx` when you reach for a
  component.
- **Frontmatter** is just `title` + `description` — no `sidebar` field.

### Navigation — `docs.json`

The sidebar is data-driven from **`docs.json`** at the docs root (schema: `docs.schema.json`). Each
section lists its pages **in order**, by slug:

```json
{
  "sidebar": [
    { "label": "Start", "translations": { "zh-CN": "开始" },
      "items": ["start/introduction", "start/installation", "start/quickstart"] }
  ]
}
```

`scripts/docs-config.mjs` validates it at build time (clear errors for unknown/duplicate slugs, a
missing default-locale source, etc.) and warns about pages not listed in any section. Reordering or
adding a page is a one-line edit in `docs.json` — no renderer change.

## Local development

Requires **Node ≥ 22.12.0** and **pnpm**.

```sh
git clone https://github.com/physiclaw/docs-site.git
cd docs-site
pnpm install

# Check out the code repo's docs/ into physiclaw-docs/ (the local-dev source)
git clone --depth 1 https://github.com/physiclaw/PhysiClaw.git /tmp/physiclaw
cp -r /tmp/physiclaw/docs physiclaw-docs

pnpm dev            # syncs, then serves at http://localhost:4321
```

Re-run `pnpm sync:docs` after editing anything in the docs source.

| Command          | Action                                                |
| ---------------- | ----------------------------------------------------- |
| `pnpm dev`       | Sync + serve at `localhost:4321`                      |
| `pnpm sync:docs` | Split the docs source → `src/content/docs/{en,zh}`    |
| `pnpm build`     | Sync + build the static site to `./dist/`             |
| `pnpm preview`   | Preview the production build                          |
| `pnpm test`      | Run the `sync-docs` + `docs-config` unit tests        |

## Project structure

```
docs/                     # Production docs mirror (CI syncs PhysiClaw/docs here) — TRACKED
physiclaw-docs/           # Local-dev docs checkout — gitignored
src/
├── components/           # Starlight component overrides (Header, ThemeSelect, …)
├── content/docs/         # Split output (en/ + zh/), Starlight reads this — gitignored
├── content.config.ts     # Starlight docs collection (stock docsLoader)
├── styles/docs.css       # openclaw theme (warm near-black, coral accent)
└── assets/crab.svg       # logo
scripts/
├── sync-docs.mjs         # split docs source → src/content/docs/{en,zh} + inject imports
├── docs-config.mjs       # resolve docs source + validate docs.json → sidebar
└── *.test.mjs            # unit tests (node:test)
deploy/                   # GitHub Action template + deploy guide for the PhysiClaw repo
astro.config.mjs          # Starlight: locales, redirect, sidebar (from docs.json), brand
vercel.json               # buildCommand: pnpm build (so the sync prebuild runs)
```

## Deployment

The static site builds to `dist/` and is served by the `docs.physiclaw.ai` Vercel project. In
production, a GitHub Action in the **PhysiClaw** repo mirrors `PhysiClaw/docs` into this repo's
tracked `docs/`, commits, and pushes; Vercel's Git integration builds and deploys the commit. See
[`deploy/`](./deploy/) for the workflow and one-time setup.

## License

MIT
