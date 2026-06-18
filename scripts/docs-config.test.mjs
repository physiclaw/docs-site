import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildSidebar, findStrayTranslations, resolveDocsSrc } from './docs-config.mjs';

// A page-exists predicate that accepts a fixed allow-list of slugs.
const allow = (...slugs) => {
  const set = new Set(slugs);
  return (slug) => set.has(slug);
};

const valid = {
  sidebar: [
    { label: 'Start', translations: { 'zh-CN': '开始' }, items: ['start/intro', 'start/install'] },
    { label: 'Reference', items: ['reference/tools'] },
  ],
};

test('maps slugs to Starlight { slug } links, preserving order', () => {
  const { sidebar, slugs } = buildSidebar(valid, {
    pageExists: allow('start/intro', 'start/install', 'reference/tools'),
  });
  assert.deepEqual(
    sidebar.map((g) => g.label),
    ['Start', 'Reference']
  );
  assert.deepEqual(sidebar[0].items, [{ slug: 'start/intro' }, { slug: 'start/install' }]);
  assert.deepEqual(sidebar[0].translations, { 'zh-CN': '开始' });
  assert.equal(sidebar[1].translations, undefined);
  assert.deepEqual(slugs, ['start/intro', 'start/install', 'reference/tools']);
});

test('a non-string item passes through as a raw Starlight item (escape hatch)', () => {
  const link = { label: 'Changelog', link: 'https://example.com', attrs: { target: '_blank' } };
  const { sidebar } = buildSidebar({ sidebar: [{ label: 'More', items: [link] }] });
  assert.deepEqual(sidebar[0].items[0], link);
});

test('skips the page-exists check when no predicate is supplied', () => {
  // Pure shape validation should still pass without filesystem access.
  const { slugs } = buildSidebar(valid);
  assert.equal(slugs.length, 3);
});

const rejects = {
  'non-object config': [42, /top-level object/],
  'missing sidebar': [{}, /"sidebar" must be a non-empty array/],
  'empty sidebar': [{ sidebar: [] }, /non-empty array/],
  'section without label': [{ sidebar: [{ items: ['a'] }] }, /needs a non-empty "label"/],
  'blank label': [{ sidebar: [{ label: '  ', items: ['a'] }] }, /non-empty "label"/],
  'bad translations': [
    { sidebar: [{ label: 'S', translations: [], items: ['a'] }] },
    /invalid "translations"/,
  ],
  'empty items': [{ sidebar: [{ label: 'S', items: [] }] }, /needs a non-empty "items"/],
  'leading slash': [{ sidebar: [{ label: 'S', items: ['/a/b'] }] }, /no leading "\/"/],
  'has extension': [{ sidebar: [{ label: 'S', items: ['a/b.mdx'] }] }, /omit the \.md\/\.mdx/],
  'duplicate slug': [
    { sidebar: [{ label: 'S', items: ['a/b', 'a/b'] }] },
    /listed more than once/,
  ],
};

for (const [name, [config, pattern]] of Object.entries(rejects)) {
  test(`rejects: ${name}`, () => {
    assert.throws(() => buildSidebar(config), pattern);
  });
}

test('rejects a translation-only slug with a helpful message', () => {
  assert.throws(
    () => buildSidebar({ sidebar: [{ label: 'S', items: ['ghost/page'] }] }, { pageExists: allow() }),
    /no default-locale page.*translation-only/s
  );
});

test('findStrayTranslations: flags .zh files with no default sibling', () => {
  const files = [
    'start/intro.mdx',
    'start/intro.zh.mdx', // paired → fine
    'start/onlyzh.zh.mdx', // stray
    'guide.md',
    'guide.zh.md', // paired (.md) → fine
    'lonely.zh.md', // stray
  ];
  assert.deepEqual(findStrayTranslations(files).sort(), ['lonely.zh.md', 'start/onlyzh.zh.mdx']);
});

test('findStrayTranslations: en-only and fully-paired trees have none', () => {
  assert.deepEqual(findStrayTranslations(['a/b.mdx', 'c.mdx', 'c.zh.mdx']), []);
});

test('resolveDocsSrc: DOCS_SRC env overrides everything', () => {
  assert.equal(resolveDocsSrc({ DOCS_SRC: 'custom/path' }, '/nonexistent'), 'custom/path');
});

test('resolveDocsSrc: prefers ./docs over ./physiclaw-docs', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-'));
  mkdirSync(join(dir, 'docs'));
  mkdirSync(join(dir, 'physiclaw-docs'));
  try {
    assert.equal(resolveDocsSrc({}, dir), 'docs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('resolveDocsSrc: falls back to physiclaw-docs when docs/ is absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ds-'));
  mkdirSync(join(dir, 'physiclaw-docs'));
  try {
    assert.equal(resolveDocsSrc({}, dir), 'physiclaw-docs');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
