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
function buildShapeGroup(categoryKey, number, r = 26) {
  const cat = CATEGORIES[categoryKey];
  const g = svgEl('g');
  const shapeEl = SHAPE_FACTORY[cat.shape](r);
  shapeEl.setAttribute('class', 'node-shape');
  shapeEl.setAttribute('fill', cat.color);
  g.appendChild(shapeEl);
  const label = svgEl('text', { x: 0, y: 1 });
  label.textContent = number;
  label.style.cssText =
    `font-size:${Math.round(r * 0.5)}px; font-weight:700; fill:#fff; ` +
    'text-anchor:middle; dominant-baseline:middle; pointer-events:none; user-select:none;';
  g.appendChild(label);
  return g;
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
function paintStaticTree(svg, root, { r = 26, reveal = false, xOffset = 0 } = {}) {
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
    const g = buildShapeGroup(node.shape, reveal ? xbarLabel(node.shape, node.number) : node.number, r);
    g.setAttribute('transform', `translate(${node._x + xOffset},${node._y})`);
    nodeLayer.appendChild(g);
    node.children.forEach(walk);
  })(root);
}
