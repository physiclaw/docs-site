// Open outbound links in a new tab. Dependency-free rehype plugin so there's
// nothing new to install.
//
// Two kinds of node carry an external href when the plugin runs: a Markdown
// link, already an `a` element with `properties`, and anything written as a
// tag in MDX — a Starlight `<LinkCard>` / `<LinkButton>`, or a raw `<a>` —
// still a JSX node with an `attributes` list, which the Starlight components
// spread onto their own `a`. The same target/rel land on both, so an external
// card behaves like an external link. An author-set target or rel is kept.

/**
 * @typedef {{ type: string, name: string, value?: unknown }} MdxAttribute
 * @typedef {{
 *   type?: string,
 *   tagName?: string,
 *   name?: string,
 *   properties?: Record<string, unknown>,
 *   attributes?: MdxAttribute[],
 *   children?: Node[],
 * }} Node
 */

const INTERNAL_HOST = 'physiclaw.ai';
const MARK = { target: '_blank', rel: 'noopener noreferrer' };

/**
 * An absolute http(s) href to a host other than physiclaw.ai or one of its
 * subdomains (docs., www.). Relative paths, other schemes, non-strings and
 * malformed URLs are not external and are left alone.
 * @param {unknown} href
 */
export function isExternal(href) {
  if (typeof href !== 'string' || !/^https?:\/\//i.test(href)) return false;
  try {
    const host = new URL(href).hostname;
    return host !== INTERNAL_HOST && !host.endsWith(`.${INTERNAL_HOST}`);
  } catch {
    return false;
  }
}

/** @param {Node} node */
const isJsx = (node) => node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement';

/** @param {Node} node @param {string} name */
const attribute = (node, name) =>
  node.attributes?.find((a) => a.type === 'mdxJsxAttribute' && a.name === name);

/**
 * The href a node links to, whichever shape it is; undefined for the rest.
 * @param {Node} node
 */
function hrefOf(node) {
  if (node.tagName === 'a') return node.properties?.href;
  if (isJsx(node)) return attribute(node, 'href')?.value;
  return undefined;
}

/** @param {Node} node */
function mark(node) {
  for (const [name, value] of Object.entries(MARK)) {
    if (node.properties) {
      node.properties[name] ??= value;
    } else if (node.attributes && !attribute(node, name)) {
      node.attributes.push({ type: 'mdxJsxAttribute', name, value });
    }
  }
}

export function rehypeExternalLinksNewTab() {
  /** @param {Node} node */
  const walk = (node) => {
    if (isExternal(hrefOf(node))) mark(node);
    for (const child of node.children ?? []) walk(child);
  };
  return walk;
}
