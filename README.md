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
physiclaw/PhysiClaw   docs/         →   physiclaw-docs/   →   src/content/docs/{en,zh}   →   dist/
(content, bilingual)   checkout          scripts/sync-docs.mjs        Starlight build
```

## Documentation conventions

### Where docs live & i18n

Docs are authored in the **code repo** at `docs/`, with translations **co-located by filename suffix** —
`intro.mdx` (English) sits next to `intro.zh.mdx` (简体中文). `scripts/sync-docs.mjs` splits these into
Starlight's per-locale layout (`src/content/docs/en/`, `src/content/docs/zh/`), stripping the `.zh`
suffix. The default language is a single `DEFAULT_LOCALE` constant in `astro.config.mjs`.

### Authoring — write plain Markdown, no imports

Docs read like Markdown, not code. Authors **never write `import` statements**.

- **Callouts** use native directives: `:::note`, `:::tip[Title]`, `:::caution`, `:::danger`.
- **Components** ([Card, CardGrid, Steps, Tabs, FileTree, LinkCard, …](https://starlight.astro.build/components/))
  are written as bare tags in `.mdx` files — `scripts/sync-docs.mjs` injects the
  `@astrojs/starlight/components` import during sync. Use `.md` for prose, `.mdx` when you reach for a
  component.
- **Sidebar order** comes from each doc's `sidebar.order` frontmatter; the sidebar is auto-generated.

## Local development

Requires **Node ≥ 22.12.0** and **pnpm**.

```sh
git clone https://github.com/physiclaw/docs-site.git
cd docs-site
pnpm install

# Check out the code repo's docs/ into physiclaw-docs/
git clone --depth 1 https://github.com/physiclaw/PhysiClaw.git /tmp/physiclaw
cp -r /tmp/physiclaw/docs physiclaw-docs

pnpm dev            # syncs, then serves at http://localhost:4321
```

Re-run `pnpm sync:docs` after editing anything in `physiclaw-docs/`.

| Command          | Action                                              |
| ---------------- | --------------------------------------------------- |
| `pnpm dev`       | Sync + serve at `localhost:4321`                    |
| `pnpm sync:docs` | Split `physiclaw-docs/` → `src/content/docs/{en,zh}` |
| `pnpm build`     | Sync + build the static site to `./dist/`           |
| `pnpm preview`   | Preview the production build                        |
| `pnpm test`      | Run the `sync-docs` unit tests                      |

## Project structure

```
physiclaw-docs/          # Original docs checked out from the code repo — gitignored
src/
├── content/docs/        # Split output (en/ + zh/), Starlight reads this — gitignored
├── content.config.ts    # Starlight docs collection (stock docsLoader)
├── styles/docs.css       # Material-flavored brand theme (PhysiClaw orange)
└── assets/crab.svg       # logo
scripts/
├── sync-docs.mjs         # split physiclaw-docs → src/content/docs/{en,zh} + inject imports
└── sync-docs.test.mjs    # unit tests (node:test)
public/favicon.svg
astro.config.mjs          # Starlight: locales, redirect, sidebar, brand
```

## Deployment

Builds to static `dist/` — deploy anywhere. Targeted at the `docs.physiclaw.ai` Vercel project.
A docs change in `physiclaw/PhysiClaw` (under `docs/**`) triggers a rebuild here (e.g. via a
`repository_dispatch` Action or Vercel Deploy Hook).

## License

MIT
