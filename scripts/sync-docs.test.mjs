import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  classify,
  syncDocs,
  LOCALE_BY_SUFFIX,
  injectComponentImports,
} from './sync-docs.mjs';

// ── classify(): maps a source filename → { locale, outName } ──────────────────

test('classify: unsuffixed file is the default locale (en)', () => {
  assert.deepEqual(classify('intro.mdx'), { locale: 'en', outName: 'intro.mdx' });
  assert.deepEqual(classify('guide.md'), { locale: 'en', outName: 'guide.md' });
});

test('classify: .zh suffix → zh locale with the suffix trimmed', () => {
  assert.deepEqual(classify('intro.zh.mdx'), { locale: 'zh', outName: 'intro.mdx' });
  assert.deepEqual(classify('guide.zh.md'), { locale: 'zh', outName: 'guide.md' });
});

test('classify: only the locale segment is stripped, dotted names survive', () => {
  assert.deepEqual(classify('a.b.zh.md'), { locale: 'zh', outName: 'a.b.md' });
  assert.deepEqual(classify('a.b.mdx'), { locale: 'en', outName: 'a.b.mdx' });
});

test('classify: a bare "zh.md" is content, not a locale marker', () => {
  assert.deepEqual(classify('zh.md'), { locale: 'en', outName: 'zh.md' });
});

test('LOCALE_BY_SUFFIX is the single source of truth for the mapping', () => {
  assert.equal(LOCALE_BY_SUFFIX[''], 'en');
  assert.equal(LOCALE_BY_SUFFIX['.zh'], 'zh');
});

// ── injectComponentImports(): import-free authoring ──────────────────────────

const FM = '---\ntitle: Test\n---\n';

test('injectComponentImports: adds an import for the components used', () => {
  const out = injectComponentImports(`${FM}\n<CardGrid>\n  <Card title="x" />\n</CardGrid>\n`);
  assert.match(out, /import \{ Card, CardGrid \} from '@astrojs\/starlight\/components';/);
});

test('injectComponentImports: import goes right after the frontmatter', () => {
  const out = injectComponentImports(`${FM}\n<Steps>1. a</Steps>\n`);
  assert.match(out, /^---\ntitle: Test\n---\n\nimport \{ Steps \}/);
});

test('injectComponentImports: no components → unchanged', () => {
  const src = `${FM}\nJust prose and a :::tip\nhi\n:::\n`;
  assert.equal(injectComponentImports(src), src);
});

test('injectComponentImports: does not confuse <Card> with <CardGrid>', () => {
  const out = injectComponentImports(`${FM}\n<CardGrid></CardGrid>\n`);
  assert.match(out, /import \{ CardGrid \}/);
  assert.doesNotMatch(out, /\bCard,/);
});

test('injectComponentImports: idempotent when an import already exists', () => {
  const src = `${FM}\nimport { Card } from '@astrojs/starlight/components';\n\n<Card/>\n`;
  assert.equal(injectComponentImports(src), src);
});

test('injectComponentImports: ignores components shown inside a code block', () => {
  const src = `${FM}\nExample:\n\n\`\`\`mdx\n<Steps>1. a</Steps>\n\`\`\`\n`;
  assert.equal(injectComponentImports(src), src); // no real usage → no import
});

test('injectComponentImports: ignores components inside inline code', () => {
  const src = `${FM}\nUse \`<Card />\` to add a card.\n`;
  assert.equal(injectComponentImports(src), src);
});

test('injectComponentImports: still imports real usage next to a code example', () => {
  const out = injectComponentImports(`${FM}\n<Steps>\n1. run \`pnpm i\`\n</Steps>\n`);
  assert.match(out, /import \{ Steps \}/);
});

// ── syncDocs(): splits a source tree into per-locale dirs ─────────────────────

async function scratch() {
  const root = await mkdtemp(join(tmpdir(), 'physiclaw-sync-'));
  const src = join(root, 'src');
  const out = join(root, 'out');
  await mkdir(src, { recursive: true });
  return { root, src, out };
}

test('syncDocs: splits en/zh and preserves nested paths', async () => {
  const { root, src, out } = await scratch();
  await writeFile(join(src, 'intro.mdx'), 'EN intro');
  await writeFile(join(src, 'intro.zh.mdx'), 'ZH intro');
  await mkdir(join(src, 'guides'), { recursive: true });
  await writeFile(join(src, 'guides', 'setup.mdx'), 'EN setup');
  await writeFile(join(src, 'guides', 'setup.zh.mdx'), 'ZH setup');

  await syncDocs({ src, out });

  assert.equal(await readFile(join(out, 'en', 'intro.mdx'), 'utf8'), 'EN intro');
  assert.equal(await readFile(join(out, 'zh', 'intro.mdx'), 'utf8'), 'ZH intro');
  assert.equal(await readFile(join(out, 'en', 'guides', 'setup.mdx'), 'utf8'), 'EN setup');
  assert.equal(await readFile(join(out, 'zh', 'guides', 'setup.mdx'), 'utf8'), 'ZH setup');

  await rm(root, { recursive: true, force: true });
});

test('syncDocs: non-markdown assets are copied into every locale', async () => {
  const { root, src, out } = await scratch();
  await mkdir(join(src, 'images'), { recursive: true });
  await writeFile(join(src, 'images', 'arm.svg'), '<svg/>');
  await writeFile(join(src, 'intro.mdx'), 'EN');

  await syncDocs({ src, out });

  assert.equal(await readFile(join(out, 'en', 'images', 'arm.svg'), 'utf8'), '<svg/>');
  assert.equal(await readFile(join(out, 'zh', 'images', 'arm.svg'), 'utf8'), '<svg/>');

  await rm(root, { recursive: true, force: true });
});

test('syncDocs: output is cleaned first — stale files do not survive', async () => {
  const { root, src, out } = await scratch();
  await mkdir(join(out, 'en'), { recursive: true });
  await writeFile(join(out, 'en', 'stale.mdx'), 'old');
  await writeFile(join(src, 'intro.mdx'), 'EN');

  await syncDocs({ src, out });

  await assert.rejects(stat(join(out, 'en', 'stale.mdx')), 'stale file should be gone');
  assert.equal(await readFile(join(out, 'en', 'intro.mdx'), 'utf8'), 'EN');

  await rm(root, { recursive: true, force: true });
});

test('syncDocs: .mdx output has component imports injected', async () => {
  const { root, src, out } = await scratch();
  await writeFile(join(src, 'page.mdx'), '---\ntitle: P\n---\n\n<Steps>1. a</Steps>\n');

  await syncDocs({ src, out });

  const written = await readFile(join(out, 'en', 'page.mdx'), 'utf8');
  assert.match(written, /import \{ Steps \} from '@astrojs\/starlight\/components';/);

  await rm(root, { recursive: true, force: true });
});

test('syncDocs: returns a manifest of written docs per locale', async () => {
  const { root, src, out } = await scratch();
  await writeFile(join(src, 'intro.mdx'), 'EN');
  await writeFile(join(src, 'intro.zh.mdx'), 'ZH');

  const result = await syncDocs({ src, out });

  assert.equal(result.en, 1);
  assert.equal(result.zh, 1);

  await rm(root, { recursive: true, force: true });
});
