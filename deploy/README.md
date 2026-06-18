# Production deploy

The **`PhysiClaw`** repo owns the code *and* the docs (`docs/`). Engineers edit code
and docs together there. When `docs/` changes, a GitHub Action mirrors the docs into
this renderer's **tracked `docs/`** directory and pushes; Vercel's Git integration then
builds and deploys. This renderer is a pure **consumer** — it authors no content.

```
PhysiClaw/docs/  ──(Action: rsync mirror + commit)──►  docs-site/docs/   (tracked)
                                                          │  Vercel Git build:
                                                          │  pnpm build
                                                          │   ├─ sync-docs.mjs → src/content/docs/{en,zh}
                                                          │   └─ astro build   → dist/
                                                          ▼
                                                        docs.physiclaw.ai
```

## Two docs sources (resolved by `scripts/docs-config.mjs` → `resolveDocsSrc`)

| Directory | Tracked? | Used when | Purpose |
| --- | --- | --- | --- |
| `docs/` | **yes** | always preferred when present | the production mirror CI syncs PhysiClaw/docs into |
| `physiclaw-docs/` | no (gitignored) | fallback, when `docs/` is absent | a local-dev checkout for editing against upstream |

Override either with `DOCS_SRC=<dir>` (e.g. `DOCS_SRC=physiclaw-docs pnpm dev`).

## Setup (one time)

1. **Copy the workflow into the PhysiClaw repo:**
   `deploy/deploy-docs.yml` → `PhysiClaw/.github/workflows/deploy-docs.yml`.

2. **Add a secret to the PhysiClaw repo** (Settings → Secrets and variables → Actions):
   | Secret | What it is |
   | --- | --- |
   | `DOCS_SITE_TOKEN` | a PAT / fine-grained token with **write (contents)** access to `physiclaw/docs-site`, so the mirror commit can push |

3. **Keep Vercel's Git integration ON** for the docs-site repo. Because `docs/` is
   tracked, Vercel can build straight from git on each mirror commit. `vercel.json`
   pins `buildCommand: pnpm build` so the `prebuild` sync step always runs.

## Required: `docs.json` lives with the content

The sidebar is data-driven from **`docs.json`** at the docs root, validated against
`docs.schema.json`. Commit both in the PhysiClaw repo at **`docs/docs.json`** and
**`docs/docs.schema.json`** (the latter gives editors validation) so they're mirrored in
and the build can read the nav. Without `docs.json` the build fails fast with a clear
message.
