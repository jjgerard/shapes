// Sandbox: loose pieces -> assemblies -> a box of saved assemblies -> trees on a table.
// Uses CATEGORIES / MODES (data.js) and buildShapeGroup / fitShapeLabels (shapes.js) from the game.
// Nothing here is enforced: any piece can be joined to any other. Sizes follow the physical whiteboard kit
// (physical/WHITEBOARD.md): phrase 30 mm, bar 24 mm, head 18 mm, sticks of 20 / 40 / 60 mm.
(() => {
'use strict';

// ------------------------------------------------------------------ constants
const S = 3.2;                                    // px per mm
const MM = v => v * S;
const R_MM = { phrase: 15, bar: 12, head: 9 };    // tile half-size by level (the shape functions in shapes.js scale from this)
const LENGTHS = [20, 40, 60].map(MM);             // stick lengths, port to port
const SNAP = MM(38);                              // how close a cup must be to the other to join
const WORD_H = MM(10);
const wordW = t => MM(Math.max(18, 4 * t.length + 6));
const CAT_ORDER = ['C', 'T', 'V', 'D', 'N', 'P', 'Adj', 'Adv'];
const ABBR = { small: [56, 26], large: [104, 32] };   // base, height (mm)
const STORE = 'shapes-sandbox-v1';

// bounding boxes of each silhouette in units of r (from the geometry in shapes.js)
const SHAPE_BOUNDS = {
  square: [-1, -1, 1, 1], rectangle: [-1.35, -.78, 1.35, .78], circle: [-1, -1, 1, 1],
  triangle: [-.996, -1.07, .996, .655], pentagon: [-1.065, -1.06, 1.065, .966], diamond: [-1.2, -1.2, 1.2, 1.2],
  star: [-1.094, -1.15, 1.094, .93], heart: [-.915, -.85, .915, .935],
};

const levelKind = lv => (lv === 1 ? 'phrase' : lv === 1.5 ? 'bar' : 'head');

// bottom cups per piece: the most children any game structure gives that piece, over both modes
const PORTS = {};
for (const id of Object.keys(MODES)) {
  for (const st of MODES[id].structures) {
    const k = st.shape + st.number;
    PORTS[k] = Math.max(PORTS[k] || 0, st.children.length);
  }
}

// ------------------------------------------------------------------ state
let state = null;     // { mode, labels, tab, boards:{bench,table}, box:[], nextId }
let undoStack = [], redoStack = [];
let sel = null;       // id of the selected item (a tile / abbr / word)
let drag = null;
const nodeCache = new Map();   // id -> <g>, for the current board

const $ = id => document.getElementById(id);
const board = $('board'), world = $('world');
const layerPieces = $('layer-pieces'), layerSticks = $('layer-sticks'), layerWords = $('layer-words'), layerGhost = $('layer-ghost');

function fresh() {
  return {
    mode: 'xbar', labels: 'letters', tab: 'bench', nextId: 1, box: [],
    boards: { bench: { items: [], view: { x: 160, y: 90, k: 1 } }, table: { items: [], view: { x: 160, y: 90, k: 1 } } },
  };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s && s.boards && s.boards.bench && s.boards.table) return Object.assign(fresh(), s);
  } catch (e) { /* ignore */ }
  return fresh();
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* full or blocked */ } }, 150);
}
const cur = () => state.boards[state.tab];
const items = () => cur().items;
const byId = id => items().find(i => i.id === id);
const newId = () => state.nextId++;

// ------------------------------------------------------------------ geometry
function label(it) {
  if (it.kind === 'word') return it.text;
  if (state.labels === 'numbers') return String(it.level);
  return it.cat + (it.level === 1 ? 'P' : it.level === 1.5 ? '′' : '⁰');
}
function geom(it) {
  if (it.kind === 'abbr') {
    const [w, h] = ABBR[it.size].map(MM);
    return { b: [-w / 2, -h / 2, w / 2, h / 2], top: { x: 0, y: -h / 2 + MM(7) }, bots: [], r: null };
  }
  const r = MM(R_MM[levelKind(it.level)]);
  const sb = SHAPE_BOUNDS[CATEGORIES[it.cat].shape];
  const b = sb.map(v => v * r);
  const n = PORTS[it.cat + it.level] || 0;
  const pitch = Math.min(MM(9), 0.3 * (b[2] - b[0]));
  const bots = [];
  for (let i = 0; i < n; i++) bots.push({ x: (i - (n - 1) / 2) * pitch, y: b[3] - MM(3.2) });
  return { b, top: { x: 0, y: b[1] + MM(3.2) }, bots, r };
}
const isTile = it => it.kind === 'tile' || it.kind === 'abbr';
const portPos = (it, which) => {
  const g = geom(it);
  const p = which === 'top' ? g.top : g.bots[which];
  return { x: it.x + p.x, y: it.y + p.y };
};
const childrenOf = id => items().filter(i => isTile(i) && i.parent && i.parent.id === id);
const wordsOf = id => items().filter(i => i.kind === 'word' && i.owner === id).sort((a, b) => a.ord - b.ord);
function subtree(rootId) {
  const out = new Set([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop();
    for (const c of childrenOf(id)) if (!out.has(c.id)) { out.add(c.id); stack.push(c.id); }
  }
  for (const w of items()) if (w.kind === 'word' && w.owner && out.has(w.owner)) out.add(w.id);
  return out;
}
// where an owner's word row sits, and each word's centre
function layoutWords() {
  for (const it of items()) {
    if (!isTile(it)) continue;
    const ws = wordsOf(it.id);
    if (!ws.length) continue;
    const g = geom(it);
    const total = ws.reduce((a, w) => a + wordW(w.text), 0) + MM(4) * (ws.length - 1);
    let x = it.x - total / 2;
    const y = it.y + g.b[3] + MM(2) + WORD_H / 2;
    for (const w of ws) { const ww = wordW(w.text); w.x = x + ww / 2; w.y = y; x += ww + MM(4); }
  }
}

// ------------------------------------------------------------------ building the SVG pieces
function buildPiece(it) {
  const g = svgEl('g', { class: 'piece', 'data-id': it.id });
  const gm = geom(it);
  if (it.kind === 'abbr') {
    const [w, h] = ABBR[it.size].map(MM);
    g.appendChild(svgEl('polygon', { class: 'abbr-shape node-shape', points: `0,${-h / 2} ${w / 2},${h / 2} ${-w / 2},${h / 2}` }));
  } else {
    const inner = buildShapeGroup(it.cat, label(it), gm.r);
    g.appendChild(inner);
  }
  const cups = [gm.top, ...gm.bots];
  for (const c of cups) g.appendChild(svgEl('circle', { class: 'cup', cx: c.x, cy: c.y, r: MM(2.7) }));
  return g;
}
function buildWord(it) {
  const g = svgEl('g', { class: 'piece word-piece', 'data-id': it.id });
  const w = wordW(it.text);
  g.appendChild(svgEl('rect', { class: 'magnet-box' + (it.crossed ? ' crossed' : ''), x: -w / 2, y: -WORD_H / 2, width: w, height: WORD_H, rx: MM(1.5) }));
  const t = svgEl('text', { class: 'magnet-text' + (it.crossed ? ' crossed' : ''), x: 0, y: 1 });
  t.style.fontSize = MM(5.6) + 'px';
  t.textContent = it.text;
  g.appendChild(t);
  if (it.crossed) g.appendChild(svgEl('line', { class: 'magnet-strike', x1: -w / 2 + MM(2), x2: w / 2 - MM(2), y1: 0, y2: 0 }));
  return g;
}

function applyView() {
  const v = cur().view;
  world.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`);
}

function render() {
  layoutWords();
  const list = items();
  const live = new Set(list.map(i => i.id));
  for (const [id, node] of nodeCache) if (!live.has(id)) { node.remove(); nodeCache.delete(id); }
  for (const it of list) {
    let node = nodeCache.get(it.id);
    if (!node) {
      node = it.kind === 'word' ? buildWord(it) : buildPiece(it);
      (it.kind === 'word' ? layerWords : layerPieces).appendChild(node);
      if (it.kind !== 'word' && it.kind !== 'abbr') fitShapeLabels(node);
      nodeCache.set(it.id, node);
    }
    node.setAttribute('transform', `translate(${it.x},${it.y})`);
    node.classList.toggle('selected', sel === it.id);
    node.classList.toggle('dragging', !!(drag && drag.ids && drag.ids.has(it.id) && drag.moved));
  }
  // sticks
  layerSticks.textContent = '';
  for (const it of list) {
    if (!isTile(it) || !it.parent) continue;
    const p = byId(it.parent.id);
    if (!p) continue;
    const a = portPos(p, it.parent.slot), b = portPos(it, 'top');
    layerSticks.appendChild(svgEl('line', { class: 'stick', x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'stroke-width': MM(4) }));
    for (const q of [a, b]) {
      layerSticks.appendChild(svgEl('circle', { class: 'ball', cx: q.x, cy: q.y, r: MM(3) }));
      layerSticks.appendChild(svgEl('circle', { class: 'ball-hi', cx: q.x - MM(.9), cy: q.y - MM(.9), r: MM(.9) }));
    }
  }
  updateSelBar();
  $('btn-undo').disabled = !undoStack.length;
  $('btn-redo').disabled = !redoStack.length;
}
function clearNodes() { nodeCache.clear(); layerPieces.textContent = ''; layerWords.textContent = ''; }
function front(ids) {
  for (const id of ids) {
    const n = nodeCache.get(id);
    if (n) n.parentNode.appendChild(n);
  }
}

// ------------------------------------------------------------------ undo
const snap = () => JSON.stringify({ boards: state.boards, box: state.box, nextId: state.nextId });
function pushUndo(pre) {
  undoStack.push(pre); if (undoStack.length > 80) undoStack.shift();
  redoStack = [];
}
function restore(json) {
  const s = JSON.parse(json);
  state.boards = s.boards; state.box = s.box; state.nextId = s.nextId;
  sel = null; clearNodes(); renderAll();
}
function undo() { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); save(); }
function redo() { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); save(); }

// ------------------------------------------------------------------ the shelves
function trayTiles() {
  const m = MODES[state.mode];
  const have = new Set();
  for (const st of m.structures) { have.add(st.shape + '|' + st.number); for (const c of st.children) have.add(c.shape + '|' + c.number); }
  const out = [];
  for (const k of have) { const [cat, n] = k.split('|'); out.push({ cat, level: Number(n) }); }
  out.sort((a, b) => CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat) || a.level - b.level);
  return out;
}
function modeWords() {
  // every word in the game's sentences, in both modes (the sandbox does not tie a word to a mode)
  const set = new Set();
  const walk = n => { if (n.word) set.add(n.word); (n.children || []).forEach(walk); };
  const first = MODES[state.mode];
  for (const id of [state.mode, ...Object.keys(MODES).filter(k => k !== state.mode)]) for (const x of MODES[id].level2) if (x.root) walk(x.root);
  return [...set];
}
function templateSvg(spec, scale) {
  const it = Object.assign({ x: 0, y: 0 }, spec);
  const gm = geom(it);
  const pad = 4;
  const w = (gm.b[2] - gm.b[0]) * scale + pad * 2, h = (gm.b[3] - gm.b[1]) * scale + pad * 2;
  const svg = svgEl('svg', { width: Math.ceil(w), height: Math.ceil(h), viewBox: `${(gm.b[0]) - pad / scale} ${gm.b[1] - pad / scale} ${w / scale} ${h / scale}` });
  svg.appendChild(it.kind === 'abbr' ? buildPiece(it) : buildPiece(it));
  return svg;
}
function renderParts() {
  const root = $('parts-scroll');
  root.textContent = '';
  const mk = (cls, text) => { const d = document.createElement('div'); d.className = cls; if (text) d.textContent = text; return d; };
  const tiles = trayTiles();
  const groups = [['Phrases', 1], ['Bars', 1.5], ['Heads', 2]];
  for (const [title, lv] of groups) {
    const sel_ = tiles.filter(t => t.level === lv);
    if (!sel_.length) continue;
    root.appendChild(mk('group-title', title));
    const row = mk('tiles');
    for (const t of sel_) {
      const spec = { kind: 'tile', cat: t.cat, level: t.level };
      const d = mk('tpl'); d.title = label(Object.assign({ kind: 'tile' }, spec));
      d.appendChild(templateSvg(spec, 0.62));
      d.addEventListener('pointerdown', e => startFromShelf(e, spec));
      row.appendChild(d);
    }
    root.appendChild(row);
  }
  root.appendChild(mk('group-title', 'Abbreviation triangles'));
  const row = mk('tiles');
  for (const size of ['small', 'large']) {
    const spec = { kind: 'abbr', size };
    const d = mk('tpl'); d.title = size + ' triangle: stands for a stretch of words you do not analyse further';
    d.appendChild(templateSvg(spec, size === 'large' ? 0.42 : 0.62));
    d.addEventListener('pointerdown', e => startFromShelf(e, spec));
    row.appendChild(d);
  }
  root.appendChild(row);
  root.appendChild(mk('group-title', 'Words'));
  const wrow = mk('tiles');
  for (const w of ['Ø', ...modeWords()]) {
    const d = mk('word', w); if (w === 'Ø') d.title = 'a silent head';
    d.addEventListener('pointerdown', e => startFromShelf(e, { kind: 'word', text: w }));
    wrow.appendChild(d);
  }
  root.appendChild(wrow);
  const add = mk('add-word');
  add.innerHTML = '<input id="word-in" placeholder="add a word" maxlength="24"><button>Add</button>';
  root.appendChild(add);
  const doAdd = () => {
    const v = $('word-in').value.trim();
    if (!v) return;
    $('word-in').value = '';
    const d = mk('word', v);
    d.addEventListener('pointerdown', e => startFromShelf(e, { kind: 'word', text: v }));
    wrow.appendChild(d);
  };
  add.querySelector('button').addEventListener('click', doAdd);
  add.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  root.appendChild(mk('hint', 'Drag a piece onto the board. Drag it back here to put it away.'));
  fitShapeLabels(root);
}

function renderBox() {
  const list = $('box-list');
  list.textContent = '';
  if (!state.box.length) {
    const d = document.createElement('div'); d.className = 'empty';
    d.textContent = 'Empty. Build something on the Workbench, select it and press “Put in the box”, or drag it here. Copies come out onto either board.';
    list.appendChild(d);
    return;
  }
  for (const entry of state.box) {
    const d = document.createElement('div'); d.className = 'boxed';
    d.appendChild(boxThumb(entry));
    const nm = document.createElement('input'); nm.className = 'name'; nm.value = entry.name; nm.title = 'Rename';
    nm.addEventListener('pointerdown', e => e.stopPropagation());
    nm.addEventListener('input', () => { entry.name = nm.value; save(); });
    d.appendChild(nm);
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.title = 'Remove from the box';
    x.addEventListener('pointerdown', e => e.stopPropagation());
    x.addEventListener('click', () => { const pre = snap(); state.box = state.box.filter(b => b.id !== entry.id); pushUndo(pre); renderBox(); save(); });
    d.appendChild(x);
    d.addEventListener('pointerdown', e => startFromBox(e, entry));
    list.appendChild(d);
  }
  fitShapeLabels(list);
}
// a small picture of a boxed assembly
function boxThumb(entry) {
  const svg = svgEl('svg', {});
  const tmp = entry.items.map(i => Object.assign({}, i));
  // lay out in a scratch board so words and sticks can reuse the same code
  const saveTab = state.tab; const scratch = { items: tmp, view: { x: 0, y: 0, k: 1 } };
  const real = state.boards[saveTab];
  state.boards[saveTab] = scratch;
  try {
    layoutWords();
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const grow = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    const g = svgEl('g', {});
    for (const it of tmp) {
      if (it.kind === 'word') {
        const n = buildWord(it); n.setAttribute('transform', `translate(${it.x},${it.y})`); g.appendChild(n);
        const w = wordW(it.text); grow(it.x - w / 2, it.y - WORD_H / 2); grow(it.x + w / 2, it.y + WORD_H / 2);
      } else {
        const n = buildPiece(it); n.setAttribute('transform', `translate(${it.x},${it.y})`); g.appendChild(n);
        const gm = geom(it); grow(it.x + gm.b[0], it.y + gm.b[1]); grow(it.x + gm.b[2], it.y + gm.b[3]);
      }
    }
    const sticks = svgEl('g', {});
    for (const it of tmp) {
      if (!isTile(it) || !it.parent) continue;
      const p = tmp.find(q => q.id === it.parent.id);
      if (!p) continue;
      const a = portPos(p, it.parent.slot), b = portPos(it, 'top');
      sticks.appendChild(svgEl('line', { class: 'stick', x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'stroke-width': MM(4) }));
    }
    svg.appendChild(g); svg.appendChild(sticks);
    const pad = 10;
    svg.setAttribute('viewBox', `${x0 - pad} ${y0 - pad} ${x1 - x0 + 2 * pad} ${y1 - y0 + 2 * pad}`);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  } finally { state.boards[saveTab] = real; }
  return svg;
}

// ------------------------------------------------------------------ creating, boxing, deleting
function makeItem(spec, x, y) {
  const it = Object.assign({ id: newId(), x, y, parent: null }, spec);
  if (it.kind === 'word') { it.owner = null; it.ord = 0; it.crossed = false; delete it.parent; }
  return it;
}
function toWorld(cx, cy) {
  const r = board.getBoundingClientRect(), v = cur().view;
  return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 1800);
}
function describe(rootId) {
  const root = byId(rootId); if (!root) return 'assembly';
  const ids = subtree(rootId);
  const words = items().filter(i => i.kind === 'word' && ids.has(i.id)).sort((a, b) => a.x - b.x).map(w => w.text);
  const name = root.kind === 'abbr' ? 'Triangle' : label(root);
  return words.length ? `${name}: ${words.join(' ')}` : name;
}
function saveToBox(rootId, preSnap) {
  const root = byId(rootId); if (!root) return;
  const ids = subtree(rootId);
  const pre = preSnap || snap();
  const entry = { id: 'b' + newId(), name: describe(rootId), items: [] };
  const map = new Map();
  const list = items().filter(i => ids.has(i.id));
  list.forEach((i, n) => map.set(i.id, n + 1));
  for (const i of list) {
    const c = JSON.parse(JSON.stringify(i));
    c.id = map.get(i.id); c.x = i.x - root.x; c.y = i.y - root.y;
    if (c.parent) c.parent = ids.has(c.parent.id) && c.id !== map.get(rootId) ? { id: map.get(c.parent.id), slot: c.parent.slot } : null;
    if (c.owner) c.owner = map.get(c.owner) || null;
    entry.items.push(c);
  }
  cur().items = items().filter(i => !ids.has(i.id));
  state.box.push(entry);
  pushUndo(pre); sel = null;
  renderBox(); render(); save();
  toast('Put in the box: ' + entry.name);
}
function instantiate(entry, x, y) {
  const map = new Map();
  for (const i of entry.items) map.set(i.id, newId());
  const out = [];
  for (const i of entry.items) {
    const c = JSON.parse(JSON.stringify(i));
    c.id = map.get(i.id); c.x = x + i.x; c.y = y + i.y;
    if (c.parent) c.parent = { id: map.get(c.parent.id), slot: c.parent.slot };
    if (c.owner) c.owner = map.get(c.owner);
    out.push(c);
  }
  const rootItem = out.find(i => !i.parent && isTile(i)) || out[0];
  for (const c of out) items().push(c);
  return rootItem;
}
function deleteTree(id) {
  const ids = subtree(id);
  cur().items = items().filter(i => !ids.has(i.id));
  if (sel && ids.has(sel)) sel = null;
}

// ------------------------------------------------------------------ dragging
function beginDrag(e, it, opts = {}) {
  const w = toWorld(e.clientX, e.clientY);
  drag = {
    pre: opts.pre || snap(), id: it.id, ids: null, moved: !!opts.moved, startX: e.clientX, startY: e.clientY,
    last: w, panning: false, snapTo: null, pointer: e.pointerId, fromShelf: !!opts.fromShelf,
  };
  if (drag.moved) prepareDrag();
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}
function prepareDrag() {
  const it = byId(drag.id);
  if (!it) return;
  if (it.kind === 'word') { it.owner = null; drag.ids = new Set([it.id]); }
  else { it.parent = null; drag.ids = subtree(it.id); }
  front(drag.ids);
}
function onMove(e) {
  if (!drag) return;
  if (drag.panning) {
    const v = cur().view; v.x += e.movementX; v.y += e.movementY; applyView(); return;
  }
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 5) return;
    drag.moved = true; prepareDrag();
  }
  const w = toWorld(e.clientX, e.clientY);
  const dx = w.x - drag.last.x, dy = w.y - drag.last.y;
  drag.last = w;
  for (const id of drag.ids) { const i = byId(id); if (i) { i.x += dx; i.y += dy; } }
  const target = hitPanel(e);
  $('box').classList.toggle('drop-target', target === 'box' && isTile(byId(drag.id)));
  $('parts').classList.toggle('drop-target', target === 'parts');
  drag.snapTo = target ? null : findSnap();
  showGhost();
  render();
}
function hitPanel(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  if (!el) return null;
  if (el.closest('#box')) return 'box';
  if (el.closest('#parts')) return 'parts';
  return null;
}
function onUp(e) {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
  $('box').classList.remove('drop-target'); $('parts').classList.remove('drop-target');
  layerGhost.textContent = '';
  const d = drag; drag = null;
  if (!d) return;
  if (d.panning) { save(); return; }
  if (!d.moved) { render(); return; }           // a plain click: just select
  const it = byId(d.id);
  const target = hitPanel(e);
  if (it && (target === 'parts' || (target === 'box' && it.kind === 'word'))) {                // put away
    deleteTree(d.id);
  } else if (it && target === 'box' && isTile(it)) {
    saveToBox(d.id, d.pre);                      // undo goes back to before the drag
    return;
  } else if (it) {
    if (it.kind === 'word') attachWord(it); else if (d.snapTo) applySnap(d.snapTo, d.ids);
  }
  if (snap() !== d.pre) pushUndo(d.pre);
  render(); save();
}
// ---- joining
function freeSlots(t) {
  const g = geom(t), used = new Set(childrenOf(t.id).map(c => c.parent.slot));
  return g.bots.map((_, i) => i).filter(i => !used.has(i));
}
function findSnap() {
  const root = byId(drag.id);
  if (!root || !isTile(root)) return null;
  const dset = drag.ids;
  let best = null;
  const consider = c => { if (!best || c.d < best.d) best = c; };
  const others = items().filter(i => isTile(i) && !dset.has(i.id));
  // the dragged piece hangs from a free bottom cup
  const tp = portPos(root, 'top');
  for (const t of others) for (const s of freeSlots(t)) {
    const p = portPos(t, s); const d = Math.hypot(p.x - tp.x, p.y - tp.y);
    if (d < SNAP) consider({ kind: 'child', root: root.id, parent: t.id, slot: s, d, at: p });
  }
  // something in the dragged assembly takes another piece (a loose top) hanging from it
  const roots = others.filter(t => !t.parent);
  for (const id of dset) {
    const dt = byId(id); if (!dt || !isTile(dt)) continue;
    for (const s of freeSlots(dt)) {
      const p = portPos(dt, s);
      for (const r of roots) {
        const q = portPos(r, 'top'); const d = Math.hypot(p.x - q.x, p.y - q.y);
        if (d < SNAP) consider({ kind: 'parent', parent: dt.id, slot: s, child: r.id, d, at: q });
      }
    }
  }
  return best;
}
function showGhost() {
  layerGhost.textContent = '';
  if (drag && drag.snapTo) layerGhost.appendChild(svgEl('circle', { class: 'snap-ghost', cx: drag.snapTo.at.x, cy: drag.snapTo.at.y, r: MM(7) }));
}
function nearestLength(d) { return LENGTHS.reduce((a, b) => (Math.abs(b - d) < Math.abs(a - d) ? b : a)); }
function applySnap(c, dset) {
  const move = (dx, dy) => { for (const id of dset) { const i = byId(id); if (i) { i.x += dx; i.y += dy; } } };
  if (c.kind === 'child') {
    const root = byId(c.root), p = byId(c.parent);
    const pp = portPos(p, c.slot), tp = portPos(root, 'top');
    let vx = tp.x - pp.x, vy = tp.y - pp.y; let d = Math.hypot(vx, vy);
    if (d < 1) { vx = 0; vy = 1; d = 1; }
    const L = nearestLength(d);
    move(pp.x + (vx / d) * L - tp.x, pp.y + (vy / d) * L - tp.y);
    root.parent = { id: p.id, slot: c.slot };
  } else {
    const dt = byId(c.parent), r = byId(c.child);
    const pp = portPos(dt, c.slot), tp = portPos(r, 'top');
    let vx = tp.x - pp.x, vy = tp.y - pp.y; let d = Math.hypot(vx, vy);
    if (d < 1) { vx = 0; vy = 1; d = 1; }
    const L = nearestLength(d);
    move(tp.x - (vx / d) * L - pp.x, tp.y - (vy / d) * L - pp.y);
    r.parent = { id: dt.id, slot: c.slot };
  }
}
function attachWord(w) {
  let best = null;
  for (const t of items()) {
    if (!isTile(t) || childrenOf(t.id).length) continue;           // heads and triangles take words
    const g = geom(t); const ax = t.x, ay = t.y + g.b[3] + MM(2) + WORD_H / 2;
    const d = Math.hypot(w.x - ax, w.y - ay);
    if (d < MM(32) && (!best || d < best.d)) best = { t, d };
  }
  if (best) { w.owner = best.t.id; w.ord = w.x; }
}

// ---- starting a drag from the shelf, from the box, or on the board
function startFromShelf(e, spec) {
  e.preventDefault();
  const pre = snap();
  const w = toWorld(e.clientX, e.clientY);
  const it = makeItem(spec, w.x, w.y);
  items().push(it); sel = it.id;
  render();
  beginDrag(e, it, { moved: true, pre, fromShelf: true });
}
function startFromBox(e, entry) {
  e.preventDefault();
  const pre = snap();
  const w = toWorld(e.clientX, e.clientY);
  const rootItem = instantiate(entry, w.x, w.y);
  sel = rootItem.id; render();
  beginDrag(e, rootItem, { moved: true, pre });
}
board.addEventListener('pointerdown', e => {
  const node = e.target.closest('[data-id]');
  if (!node) {                                  // the background: pan, and clear the selection
    sel = null; render();
    drag = { panning: true, moved: true };
    board.classList.add('panning');
    window.addEventListener('pointermove', onMove);
    const up = () => { board.classList.remove('panning'); window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', up); drag = null; save(); };
    window.addEventListener('pointerup', up);
    return;
  }
  e.preventDefault();
  const it = byId(Number(node.dataset.id));
  if (!it) return;
  sel = it.id; render();
  beginDrag(e, it, {});
});
board.addEventListener('dblclick', e => {
  const node = e.target.closest('[data-id]'); if (!node) return;
  const it = byId(Number(node.dataset.id));
  if (it && it.kind === 'word') { const pre = snap(); it.crossed = !it.crossed; nodeCache.get(it.id).remove(); nodeCache.delete(it.id); pushUndo(pre); render(); save(); }
});
board.addEventListener('wheel', e => {
  e.preventDefault();
  zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12);
}, { passive: false });
function zoomAt(cx, cy, f) {
  const v = cur().view, r = board.getBoundingClientRect();
  const k = Math.min(2.5, Math.max(0.25, v.k * f)), a = k / v.k;
  const px = cx - r.left, py = cy - r.top;
  v.x = px - (px - v.x) * a; v.y = py - (py - v.y) * a; v.k = k;
  applyView(); save();
}
function fit() {
  layoutWords();
  const list = items();
  if (!list.length) { cur().view = { x: 160, y: 90, k: 1 }; applyView(); return; }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const it of list) {
    if (it.kind === 'word') { const w = wordW(it.text); x0 = Math.min(x0, it.x - w / 2); x1 = Math.max(x1, it.x + w / 2); y0 = Math.min(y0, it.y - WORD_H / 2); y1 = Math.max(y1, it.y + WORD_H / 2); }
    else { const g = geom(it); x0 = Math.min(x0, it.x + g.b[0]); x1 = Math.max(x1, it.x + g.b[2]); y0 = Math.min(y0, it.y + g.b[1]); y1 = Math.max(y1, it.y + g.b[3]); }
  }
  const r = board.getBoundingClientRect(), pad = 70;
  const k = Math.min(1.4, Math.max(0.25, Math.min((r.width - 2 * pad) / (x1 - x0), (r.height - 2 * pad - 40) / (y1 - y0))));
  cur().view = { k, x: (r.width - (x1 - x0) * k) / 2 - x0 * k, y: (r.height - (y1 - y0) * k) / 2 - y0 * k + 20 };
  applyView(); save();
}

// ------------------------------------------------------------------ selection bar
function updateSelBar() {
  const it = sel != null ? byId(sel) : null;
  const bar = $('sel-bar');
  bar.classList.toggle('show', !!it && !(drag && drag.moved));
  if (!it) return;
  $('sel-box').style.display = isTile(it) ? '' : 'none';
  $('sel-cross').style.display = it.kind === 'word' ? '' : 'none';
  $('sel-dup').style.display = isTile(it) ? '' : 'none';
}
$('sel-box').addEventListener('click', () => { if (sel != null && byId(sel)) saveToBox(sel); });
$('sel-del').addEventListener('click', () => { if (sel == null) return; const pre = snap(); deleteTree(sel); pushUndo(pre); render(); save(); });
$('sel-cross').addEventListener('click', () => {
  const it = byId(sel); if (!it || it.kind !== 'word') return;
  const pre = snap(); it.crossed = !it.crossed; nodeCache.get(it.id).remove(); nodeCache.delete(it.id); pushUndo(pre); render(); save();
});
$('sel-dup').addEventListener('click', () => {
  const it = byId(sel); if (!it || !isTile(it)) return;
  const pre = snap(); const ids = subtree(it.id);
  const entry = { items: [] }, map = new Map(); const list = items().filter(i => ids.has(i.id));
  list.forEach((i, n) => map.set(i.id, n + 1));
  for (const i of list) {
    const c = JSON.parse(JSON.stringify(i)); c.id = map.get(i.id); c.x = i.x - it.x; c.y = i.y - it.y;
    if (c.parent) c.parent = c.id === map.get(it.id) ? null : { id: map.get(c.parent.id), slot: c.parent.slot };
    if (c.owner) c.owner = map.get(c.owner);
    entry.items.push(c);
  }
  const r = instantiate(entry, it.x + MM(22), it.y + MM(22)); sel = r.id;
  pushUndo(pre); render(); save();
});
window.addEventListener('keydown', e => {
  if (e.target && /input|textarea/i.test(e.target.tagName)) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel != null) { e.preventDefault(); $('sel-del').click(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
});

// ------------------------------------------------------------------ toolbar
function syncControls() {
  for (const b of document.querySelectorAll('#seg-mode button')) b.classList.toggle('on', b.dataset.mode === state.mode);
  for (const b of document.querySelectorAll('#seg-labels button')) b.classList.toggle('on', b.dataset.labels === state.labels);
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === state.tab);
}
for (const b of document.querySelectorAll('#seg-mode button')) b.addEventListener('click', () => { state.mode = b.dataset.mode; syncControls(); renderParts(); save(); });
for (const b of document.querySelectorAll('#seg-labels button')) b.addEventListener('click', () => { state.labels = b.dataset.labels; syncControls(); clearNodes(); renderParts(); renderBox(); render(); save(); });
for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => { state.tab = b.dataset.tab; sel = null; clearNodes(); syncControls(); applyView(); render(); save(); });
$('btn-undo').addEventListener('click', undo);
$('btn-redo').addEventListener('click', redo);
$('btn-zoom-in').addEventListener('click', () => { const r = board.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.2); });
$('btn-zoom-out').addEventListener('click', () => { const r = board.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.2); });
$('btn-fit').addEventListener('click', fit);
$('btn-help').addEventListener('click', () => $('help').showModal());
$('btn-clear').addEventListener('click', () => {
  if (!items().length) return;
  if (!confirm('Clear everything on the ' + (state.tab === 'bench' ? 'Workbench' : 'Table') + '? (Undo brings it back.)')) return;
  const pre = snap(); cur().items = []; sel = null; pushUndo(pre); render(); save();
});
$('btn-export').addEventListener('click', () => {
  layoutWords();
  const list = items(); if (!list.length) { toast('Nothing on the board to save'); return; }
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const it of list) {
    if (it.kind === 'word') { const w = wordW(it.text); x0 = Math.min(x0, it.x - w / 2); x1 = Math.max(x1, it.x + w / 2); y0 = Math.min(y0, it.y - WORD_H / 2); y1 = Math.max(y1, it.y + WORD_H / 2); }
    else { const g = geom(it); x0 = Math.min(x0, it.x + g.b[0]); x1 = Math.max(x1, it.x + g.b[2]); y0 = Math.min(y0, it.y + g.b[1]); y1 = Math.max(y1, it.y + g.b[3]); }
  }
  const pad = 24, w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
  const style = '.node-shape{stroke:#1f2937;stroke-width:1.2;stroke-linejoin:round}.cup{fill:rgba(255,255,255,.55);stroke:rgba(0,0,0,.35);stroke-width:.8}' +
    '.abbr-shape{fill:#d1d5db;stroke:#1f2937;stroke-width:1.2;stroke-linejoin:round}.magnet-box{fill:#f4ecd8;stroke:#8a8372;stroke-width:1}.magnet-box.crossed{fill:#ece6d6}' +
    '.magnet-text{font-family:Georgia,serif;fill:#111;text-anchor:middle;dominant-baseline:middle}.magnet-text.crossed{fill:#6b7280}.magnet-strike{stroke:#b91c1c;stroke-width:1.6}' +
    '.stick{stroke:#4b5563}.ball{fill:#c7ccd3;stroke:#4b5563;stroke-width:1}.ball-hi{fill:#fff;opacity:.8}';
  const svg = svgEl('svg', { xmlns: SVG_NS, width: Math.round(w), height: Math.round(h), viewBox: `${x0 - pad} ${y0 - pad} ${w} ${h}` });
  const st = svgEl('style', {}); st.textContent = style; svg.appendChild(st);
  svg.appendChild(svgEl('rect', { x: x0 - pad, y: y0 - pad, width: w, height: h, fill: '#fbfbf9' }));
  for (const n of layerPieces.children) { const c = n.cloneNode(true); c.classList.remove('selected'); svg.appendChild(c); }
  svg.appendChild(layerSticks.cloneNode(true));
  svg.appendChild(layerWords.cloneNode(true));
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tree-' + state.tab + '.svg';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});

// ------------------------------------------------------------------ start
function renderAll() { syncControls(); renderParts(); renderBox(); applyView(); render(); }
state = load();
renderAll();
if (!localStorage.getItem(STORE + '-seen')) { try { localStorage.setItem(STORE + '-seen', '1'); } catch (e) { /* ignore */ } setTimeout(() => $('help').showModal(), 300); }

// for tests and tinkering in the console
window.sandbox = { get state() { return state; }, items, render, geom, portPos, subtree, saveToBox, MM, S, LENGTHS, fit };
})();
