// SVG shape geometry for the 6 category shapes. Every function returns an
// <svg> child element (unattached) sized around local origin (0,0), meant to
// sit inside a <g transform="translate(x,y)">.

const SVG_NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function polygonPoints(cx, cy, r, sides, rotationDeg = -90) {
  const pts = [];
  for (let i = 0; i < sides; i++) {
    const a = (rotationDeg + (360 / sides) * i) * (Math.PI / 180);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts.map(p => p.join(',')).join(' ');
}

function starPoints(cx, cy, rOuter, rInner, points = 5, rotationDeg = -90) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? rOuter : rInner;
    const a = (rotationDeg + (180 / points) * i) * (Math.PI / 180);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts.map(p => p.join(',')).join(' ');
}

const HEART_D = 'M16,29.3 C16,29.3 2,18 2,10.5 C2,5.8 5.6,2 10,2 C12.6,2 15,3.4 16,5.6 ' +
  'C17,3.4 19.4,2 22,2 C26.4,2 30,5.8 30,10.5 C30,18 16,29.3 16,29.3 Z';

// shape -> element factory. `r` is the nominal radius/half-size.
const SHAPE_FACTORY = {
  square: (r) => svgEl('rect', { x: -r, y: -r, width: 2 * r, height: 2 * r, rx: r * 0.12 }),
  // Adjective and adverb. Both silhouettes had to stay legible at a
  // phone-sized r and distinct from the six already in use -- which rules
  // out an octagon or a hexagon, since at this size either is a circle,
  // and D is already the circle. A pentagon reads as pointed-top-flat-
  // bottom and a diamond as a square stood on its corner; neither can be
  // confused with anything else in the set at a glance.
  pentagon: (r) => svgEl('polygon', { points: polygonPoints(0, r * 0.06, r * 1.12, 5, -90) }),
  diamond: (r) => svgEl('polygon', { points: polygonPoints(0, 0, r * 1.2, 4, -90) }),
  rectangle: (r) => svgEl('rect', { x: -r * 1.35, y: -r * 0.78, width: 2.7 * r, height: 1.56 * r, rx: r * 0.12 }),
  circle: (r) => svgEl('circle', { cx: 0, cy: 0, r }),
  triangle: (r) => svgEl('polygon', { points: polygonPoints(0, r * 0.08, r * 1.15, 3, -90) }),
  star: (r) => svgEl('polygon', { points: starPoints(0, 0, r * 1.15, r * 0.5, 5, -90) }),
  heart: (r) => {
    const p = svgEl('path', { d: HEART_D });
    const s = r / 15.3;
    p.setAttribute('transform', `scale(${s}) translate(-16,-15)`);
    return p;
  },
};

// Build a full <g class="tree-node"> for a data node {shape, number}.
// `shape` here is the CATEGORY KEY (C/T/V/D/N/P) -- callers pass CATEGORIES[key].
// The label's font-size is derived from r (rather than fixed in CSS) so it
// scales along with the shape everywhere this is used -- the interactive
// canvas (where r varies by device, see editor.js SIZING) as well as the
// static reveal/legend trees.
// How much room each silhouette actually has for text across its middle,
// as a fraction of r. A rectangle is nearly twice as generous as a star,
// whose points mean the usable area is only the little pentagon at its
// centre, so one shared font size either overflows the tight shapes or
// wastes most of the roomy ones. fitShapeLabels() below grows every label
// to whatever its own shape allows.
// Measured at the TOP of the text, not at the shape's midline: a triangle
// or a star is narrowing as you move up from its centre, so a label sized
// to the width available at its middle has its capitals poking out through
// the slanted edges.
const SHAPE_TEXT_ROOM = {
  square: 0.86, rectangle: 1.15, circle: 0.80, triangle: 0.45,
  star: 0.42, heart: 0.70, pentagon: 0.76, diamond: 0.68,
};

function buildShapeGroup(categoryKey, number, r = 26, fontScale = 0.5) {
  const cat = CATEGORIES[categoryKey];
  const g = svgEl('g');
  g.dataset.shape = cat.shape;
  g.dataset.r = r;
  const shapeEl = SHAPE_FACTORY[cat.shape](r);
  shapeEl.setAttribute('class', 'node-shape');
  shapeEl.setAttribute('fill', cat.color);
  g.appendChild(shapeEl);
  const label = svgEl('text', { x: 0, y: 1 });
  label.textContent = number;
  // Labels vary in length far more than they used to: a bare "1" in Level
  // 1, "1.5" once the bar level exists, and "AdjP"/"Adv⁰" for the two
  // three-letter categories. A single font size tuned for two characters
  // overflows the narrower shapes (the diamond especially) at four, so
  // step it down as the label grows.
  const len = String(number).length;
  const fitted = len <= 2 ? fontScale : len === 3 ? fontScale * 0.78 : fontScale * 0.62;
  label.style.cssText =
    `font-size:${Math.round(r * fitted)}px; font-weight:700; fill:#fff; ` +
    'text-anchor:middle; dominant-baseline:middle; pointer-events:none; user-select:none;';
  g.appendChild(label);
  return g;
}

// Grow every label already in `root` to the largest size its own shape can
// hold. Measured after the fact rather than guessed from character count:
// "NP" and "W" are both short and nothing like the same width, and the
// answer differs per shape anyway. Requires the elements to be in the
// document, so callers run it once painting is finished.
function fitShapeLabels(root) {
  for (const g of root.querySelectorAll('g[data-shape]')) {
    const text = g.querySelector('text');
    if (!text || !text.textContent) continue;
    const r = Number(g.dataset.r) || 26;
    const room = SHAPE_TEXT_ROOM[g.dataset.shape] ?? 0.7;
    let width;
    try { width = text.getComputedTextLength(); } catch { continue; }
    if (!width) continue;
    const current = parseFloat(text.style.fontSize) || r * 0.5;
    // Scale to exactly fill the available width, then stop short of the
    // shape's own height so nothing pokes out the top or bottom.
    const size = Math.min(current * ((2 * r * room) / width), r * 0.95);
    text.style.fontSize = `${size}px`;
  }
}

// ---------------------------------------------------------------------------
// Shared static (read-only) tree layout + paint -- used by the Level 1
// Mystery Level reveal and the Level 2 word-match trees. `nodeGap`/`levelGap`
// default to the sizes the reveal tree has always used; word-match passes
// its own (device-scaled) gaps so bigger mobile pieces don't overlap.
// ---------------------------------------------------------------------------
function layoutTree(root, nodeGap = 82, levelGap = 86) {
  let leafX = 0;
  (function assign(node, depth) {
    node._depth = depth;
    if (!node.children.length) {
      node._x = leafX * nodeGap;
      leafX++;
    } else {
      node.children.forEach(c => assign(c, depth + 1));
      const xs = node.children.map(c => c._x);
      node._x = (Math.min(...xs) + Math.max(...xs)) / 2;
    }
    node._y = depth * levelGap + 30;
  })(root, 0);
  return { width: Math.max(leafX * nodeGap, nodeGap), height: (maxDepth(root) + 1) * levelGap + 40 };
}
function maxDepth(node) {
  return node.children.length ? 1 + Math.max(...node.children.map(maxDepth)) : 0;
}
function paintStaticTree(svg, root, { r = 26, reveal = false, xOffset = 0, fontScale = 0.5 } = {}) {
  while (svg.firstChild) svg.removeChild(svg.firstChild);
  const edgeLayer = svgEl('g');
  const nodeLayer = svgEl('g');
  svg.appendChild(edgeLayer);
  svg.appendChild(nodeLayer);
  (function walk(node) {
    for (const c of node.children) {
      const path = svgEl('path', {
        class: 'tree-edge',
        d: `M ${node._x + xOffset} ${node._y + r} C ${node._x + xOffset} ${(node._y + c._y) / 2}, ${c._x + xOffset} ${(node._y + c._y) / 2}, ${c._x + xOffset} ${c._y - r}`,
      });
      edgeLayer.appendChild(path);
      walk(c);
    }
  })(root);
  (function walk(node) {
    const g = buildShapeGroup(node.shape, reveal ? nodeLabel(node.shape, node.number) : node.number, r, fontScale);
    g.setAttribute('transform', `translate(${node._x + xOffset},${node._y})`);
    nodeLayer.appendChild(g);
    node.children.forEach(walk);
  })(root);
  fitShapeLabels(nodeLayer);
}
