/**
 * Makes the sections of a tool write-up collapsible.
 *
 * Each h2 and h3 heading, together with everything up to the next heading of
 * the same or a higher level, is wrapped in a native <details> element with
 * the heading inside its <summary>, so clicking the heading folds the section.
 * h3 sections nest inside their h2 section. Sections start open, and the
 * markup works without JavaScript; ToolLayout adds a script that opens a
 * folded section when a link points inside it.
 *
 * Only runs on files under src/content/tools, so project and blog posts are
 * untouched.
 *
 *   <details class="fold" open>
 *     <summary><h3 id="load-balancer">Load balancer</h3></summary>
 *     <div class="fold-body">…</div>
 *   </details>
 */

const FOLD_LEVELS = [2, 3];

function headingLevel(node) {
  if (node.type !== 'element') return null;
  const match = /^h([1-6])$/.exec(node.tagName);
  return match ? Number(match[1]) : null;
}

function foldSections(nodes, level) {
  if (!FOLD_LEVELS.includes(level)) return nodes;
  const out = [];
  let i = 0;
  while (i < nodes.length) {
    const node = nodes[i];
    if (headingLevel(node) !== level) {
      out.push(node);
      i += 1;
      continue;
    }
    // Collect the section body: everything until the next heading at this level or above
    const body = [];
    let j = i + 1;
    while (j < nodes.length) {
      const depth = headingLevel(nodes[j]);
      if (depth !== null && depth <= level) break;
      body.push(nodes[j]);
      j += 1;
    }
    out.push({
      type: 'element',
      tagName: 'details',
      properties: { className: ['fold', `fold-${level}`], open: true },
      children: [
        { type: 'element', tagName: 'summary', properties: {}, children: [node] },
        {
          type: 'element',
          tagName: 'div',
          properties: { className: ['fold-body'] },
          children: foldSections(body, level + 1),
        },
      ],
    });
    i = j;
  }
  return out;
}

export default function rehypeFoldSections() {
  return (tree, file) => {
    const path = String(file.path ?? file.history?.[0] ?? '').replace(/\\/g, '/');
    if (!path.includes('/src/content/tools/')) return;
    tree.children = foldSections(tree.children, 2);
  };
}
