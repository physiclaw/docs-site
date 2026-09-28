import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isExternal, rehypeExternalLinksNewTab } from './external-links.mjs';

const plugin = rehypeExternalLinksNewTab();
/** @param {string} href */
const a = (href) => ({ type: 'element', tagName: 'a', properties: { href }, children: [] });
/** @param {string} href @param {string} [name] */
const jsx = (href, name = 'LinkCard') => ({
  type: 'mdxJsxFlowElement',
  name,
  attributes: [{ type: 'mdxJsxAttribute', name: 'href', value: href }],
  children: [],
});
/** @param {{ attributes: { name: string, value?: unknown }[] }} node */
const attrs = (node) => Object.fromEntries(node.attributes.map((x) => [x.name, x.value]));

test('isExternal: absolute http(s) to another host only', () => {
  assert.equal(isExternal('https://www.bilibili.com/video/BV1b7av68E77/'), true);
  assert.equal(isExternal('http://github.com/physiclaw'), true);
  assert.equal(isExternal('https://docs.physiclaw.ai/en/'), false);
  assert.equal(isExternal('https://physiclaw.ai/'), false);
  assert.equal(isExternal('/downloads/physiclaw_assembly_3d.zip'), false);
  assert.equal(isExternal('mailto:hi@physiclaw.ai'), false);
  assert.equal(isExternal('https://'), false); // malformed → left alone
  assert.equal(isExternal(undefined), false);
});

test('an external Markdown link, however deep, opens in a new tab; an internal one is left alone', () => {
  const external = a('https://youtu.be/Acmta1kzEko');
  const internal = a('/en/hardware/manual/');
  plugin({ type: 'root', children: [{ type: 'element', tagName: 'p', properties: {}, children: [external, internal] }] });

  assert.deepEqual(external.properties, { href: 'https://youtu.be/Acmta1kzEko', target: '_blank', rel: 'noopener noreferrer' });
  assert.deepEqual(internal.properties, { href: '/en/hardware/manual/' });
});

test('any MDX tag with an external string href gets the same target and rel', () => {
  for (const name of ['LinkCard', 'LinkButton', 'a']) {
    const node = jsx('https://www.bilibili.com/video/BV1b7av68E77/', name);
    plugin(node);
    assert.deepEqual(attrs(node), {
      href: 'https://www.bilibili.com/video/BV1b7av68E77/',
      target: '_blank',
      rel: 'noopener noreferrer',
    });
  }
  const internal = jsx('/downloads/physiclaw_manual.pdf');
  plugin(internal);
  assert.deepEqual(attrs(internal), { href: '/downloads/physiclaw_manual.pdf' });
});

test('an author-set target or rel wins, on either node kind', () => {
  const card = jsx('https://youtu.be/x');
  card.attributes.push({ type: 'mdxJsxAttribute', name: 'target', value: '_self' });
  plugin(card);
  assert.deepEqual(attrs(card), { href: 'https://youtu.be/x', target: '_self', rel: 'noopener noreferrer' });

  const link = a('https://youtu.be/x');
  link.properties.rel = 'me';
  plugin(link);
  assert.deepEqual(link.properties, { href: 'https://youtu.be/x', rel: 'me', target: '_blank' });
});
