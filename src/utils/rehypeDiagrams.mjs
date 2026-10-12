/**
 * Replaces diagram placeholders in tool write-ups with inline SVG.
 *
 * In the markdown, a line such as
 *
 *   <div data-diagram="lb-request-flow"></div>
 *
 * becomes <figure class="diagram">…svg…<figcaption>…</figcaption></figure>,
 * drawn by the matching entry in src/diagrams with the labels for the page's
 * language (taken from the file path: content/tools/en/… or …/ja/…).
 *
 * Astro runs rehype-raw after user plugins, so at this point the placeholder
 * is still a `raw` node holding the HTML text; we rewrite that text and let
 * rehype-raw parse the SVG.
 */
import { diagrams } from '../diagrams/index.mjs';
import { esc } from '../diagrams/svg.mjs';

const PLACEHOLDER = /^\s*<div\s+data-diagram="([\w-]+)"\s*>\s*<\/div>\s*$/;

function walk(node, visit) {
  if (!node.children) return;
  for (const child of node.children) {
    visit(child);
    walk(child, visit);
  }
}

export default function rehypeDiagrams() {
  return (tree, file) => {
    const path = String(file.path ?? file.history?.[0] ?? '').replace(/\\/g, '/');
    if (!path.includes('/src/content/tools/')) return;
    const lang = /\/content\/tools\/(en|ja)\//.exec(path)?.[1] ?? 'en';

    walk(tree, (node) => {
      if (node.type !== 'raw') return;
      const match = PLACEHOLDER.exec(node.value);
      if (!match) return;
      const name = match[1];
      const diagram = diagrams[name];
      if (!diagram) throw new Error(`Unknown diagram "${name}" in ${path}`);
      const labels = diagram.labels[lang] ?? diagram.labels.en;
      const { svg, caption } = diagram.render(labels);
      node.value =
        `<figure class="diagram" data-diagram="${name}">${svg}` +
        (caption ? `<figcaption>${esc(caption)}</figcaption>` : '') +
        `</figure>`;
    });
  };
}
