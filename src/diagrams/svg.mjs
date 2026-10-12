/**
 * Tiny helpers for hand-drawn SVG diagrams in the write-ups.
 *
 * Diagrams are plain strings of SVG built at build time (see rehypeDiagrams).
 * They carry no colours of their own: every shape has a `d-*` class that
 * ToolLayout styles with the site's CSS variables, so one drawing works in
 * both themes. Text uses the page font (monospace) via `font-family: inherit`.
 */

export const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A run of text. `parts` may be a string or [{ t, cls }] for mixed styling on one line */
export function text(x, y, parts, cls = 'd-text', attrs = '') {
  const inner = Array.isArray(parts)
    ? parts.map((p) => (p.cls ? `<tspan class="${p.cls}">${esc(p.t)}</tspan>` : esc(p.t))).join('')
    : esc(parts);
  return `<text x="${x}" y="${y}" class="${cls}" ${attrs}>${inner}</text>`;
}

/** A rounded box with a centred title and optional muted subtitle */
export function box(x, y, w, h, { title, sub, cls = 'd-box' } = {}) {
  const cy = y + h / 2;
  const parts = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" class="${cls}" />`];
  if (title) parts.push(text(x + w / 2, sub ? cy - 3 : cy + 4, title, 'd-title', 'text-anchor="middle"'));
  if (sub) parts.push(text(x + w / 2, cy + 14, sub, 'd-muted', 'text-anchor="middle"'));
  return parts.join('');
}

/**
 * A card with a title and rows of `label  value`. Each row is
 * { label, value } where value is a string or [{ t, cls }]. Returns { svg, h }.
 */
export function card(x, y, w, title, rows, { titleCls = 'd-title', labelW = 52 } = {}) {
  const rowH = 17;
  const h = 44 + rows.length * rowH;
  const parts = [
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" class="d-card" />`,
    text(x + 12, y + 20, title, titleCls),
  ];
  rows.forEach((row, i) => {
    const ry = y + 42 + i * rowH;
    if (row.label) parts.push(text(x + 12, ry, row.label, 'd-muted'));
    parts.push(text(x + 12 + labelW, ry, row.value, 'd-text'));
  });
  return { svg: parts.join(''), h };
}

/** A straight line with optional arrowheads. `cls` adds a colour: primary, secondary, pink */
export function line(x1, y1, x2, y2, { cls = '', start = false, end = true, dashed = false, markerId } = {}) {
  const classes = ['d-line', cls, dashed ? 'd-dashed' : ''].filter(Boolean).join(' ');
  const m = [];
  if (markerId && start) m.push(`marker-start="url(#${markerId})"`);
  if (markerId && end) m.push(`marker-end="url(#${markerId})"`);
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${classes}" ${m.join(' ')} />`;
}

/** An arrowhead marker; `orient="auto-start-reverse"` lets one marker serve both ends */
export function marker(id, cls = '') {
  return (
    `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">` +
    `<path d="M0 0 L10 5 L0 10 z" class="d-arrow ${cls}" /></marker>`
  );
}

export function svg(w, h, inner, { label, defs = '' } = {}) {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(label)}">` +
    (defs ? `<defs>${defs}</defs>` : '') +
    inner +
    `</svg>`
  );
}
