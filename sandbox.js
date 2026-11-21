// Sandbox: one table, a shelf of loose pieces, and two things to do: Tinker (free play) or Build a sentence (suggested
// sentences with a checker). Uses CATEGORIES / MODES (data.js) and buildShapeGroup / fitShapeLabels (shapes.js).
// XP or X′ mode decides what may join what (the game's own legal edges); a wrong join glows red.
// Sizes follow the physical whiteboard kit: phrase 30 mm, bar 24 mm, head 18 mm, sticks of 20 / 40 / 60 mm.
(() => {
'use strict';

// ------------------------------------------------------------------ constants
const S = 3.2;                                    // px per mm (world units)
const MM = v => v * S;
const R_MM = { phrase: 15, bar: 12, head: 9 };
const LENGTHS = [20, 40, 60].map(MM);
const SNAP = MM(38);
const WORD_H = MM(10);
const wordW = t => MM(Math.max(18, 4 * t.length + 6));
const CAT_ORDER = ['C', 'T', 'V', 'D', 'N', 'P', 'Adj', 'Adv'];
const ABBR = { small: [56, 26], large: [104, 32] };
const STORE = 'shapes-sandbox-v2';
const MODE_NAME = { prex: 'XP mode', xbar: 'X′ mode' };
const SHAPE_BOUNDS = {
  square: [-1, -1, 1, 1], rectangle: [-1.35, -.78, 1.35, .78], circle: [-1, -1, 1, 1],
  triangle: [-.996, -1.07, .996, .655], pentagon: [-1.065, -1.06, 1.065, .966], diamond: [-1.2, -1.2, 1.2, 1.2],
  star: [-1.094, -1.15, 1.094, .93], heart: [-.915, -.85, .915, .935],
};
const levelKind = lv => (lv === 1 ? 'phrase' : lv === 1.5 ? 'bar' : 'head');
const isNarrow = () => window.matchMedia('(max-width: 899px)').matches;

// bottom cups per piece, per mode: the most children any structure of that mode gives it (the game's own fragments)
const PORTS = {};
for (const id of Object.keys(MODES)) {
  PORTS[id] = {};
  for (const st of MODES[id].structures) {
    const k = st.shape + st.number;
    PORTS[id][k] = Math.max(PORTS[id][k] || 0, st.children.length);
  }
}

// ------------------------------------------------------------------ state
let state = null;     // { mode, labels, activity, task:{type, idx}, items, view, nextId }
let undoStack = [], redoStack = [];
let sel = null;
let drag = null;
let lastTap = { id: null, t: 0 };
const nodeCache = new Map();
const $ = id => document.getElementById(id);
const board = $('board'), world = $('world');
const layerPieces = $('layer-pieces'), layerSticks = $('layer-sticks'), layerWords = $('layer-words'), layerGhost = $('layer-ghost');

function fresh() {
  return { mode: 'xbar', labels: 'letters', activity: 'tinker', task: { type: 'declarative', idx: 0 }, items: [], view: null, nextId: 1 };
}
function load() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE) || localStorage.getItem('shapes-sandbox-v1'));
    if (s) {
      const st = Object.assign(fresh(), s);
      if (s.boards && !s.items) { st.items = (s.boards.table && s.boards.table.items) || []; st.view = (s.boards.table && s.boards.table.view) || null; delete st.boards; delete st.box; delete st.tab; }
      st.items = st.items || [];
      return st;
    }
  } catch (e) { /* ignore */ }
  return fresh();
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (e) { /* full or blocked */ } }, 150);
}
const items = () => state.items;
const byId = id => state.items.find(i => i.id === id);
const newId = () => state.nextId++;
function defaultView() {
  const r = board.getBoundingClientRect();
  const k = r.width < 640 ? 1.15 : 1;
  return { x: r.width / 2, y: 50 * k, k };
}
const view = () => (state.view || (state.view = defaultView()));

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
  const b = SHAPE_BOUNDS[CATEGORIES[it.cat].shape].map(v => v * r);
  const n = PORTS[state.mode][it.cat + it.level] || 0;
  const pitch = Math.min(MM(9), 0.3 * (b[2] - b[0]));
  const bots = [];
  for (let i = 0; i < n; i++) bots.push({ x: (i - (n - 1) / 2) * pitch, y: b[3] - MM(3.2) });
  return { b, top: { x: 0, y: b[1] + MM(3.2) }, bots, r };
}
const isTile = it => it.kind === 'tile' || it.kind === 'abbr';
const portPos = (it, which) => {
  const g = geom(it);
  const p = which === 'top' ? g.top : (g.bots[which] || { x: 0, y: g.b[3] - MM(3.2) });
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
function bounds(list) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const it of list) {
    if (it.kind === 'word') { const w = wordW(it.text); x0 = Math.min(x0, it.x - w / 2); x1 = Math.max(x1, it.x + w / 2); y0 = Math.min(y0, it.y - WORD_H / 2); y1 = Math.max(y1, it.y + WORD_H / 2); }
    else { const g = geom(it); x0 = Math.min(x0, it.x + g.b[0]); x1 = Math.max(x1, it.x + g.b[2]); y0 = Math.min(y0, it.y + g.b[1]); y1 = Math.max(y1, it.y + g.b[3]); }
  }
  return { x0, y0, x1, y1 };
}

// ------------------------------------------------------------------ what may join what
const keyOf = it => it.cat + it.level;
function edgeLegal(parent, child) {
  const edges = MODES[state.mode].legalEdges, pk = keyOf(parent);
  if (child.kind === 'abbr') return Object.keys(CATEGORIES).some(c => edges.has(pk + '>' + c + '1'));
  return edges.has(pk + '>' + keyOf(child));
}
function slotExists(parent, slot) { return slot < geom(parent).bots.length; }
function analyze(list = items()) {
  const bad = new Set(), badEdges = new Set();
  const get = id => list.find(i => i.id === id);
  for (const it of list) {
    if (isTile(it) && it.parent) {
      const p = get(it.parent.id);
      if (!p) continue;
      if (p.kind === 'abbr' || !edgeLegal(p, it) || !slotExists(p, it.parent.slot)) { bad.add(p.id); bad.add(it.id); badEdges.add(it.id); }
    } else if (it.kind === 'word' && it.owner) {
      const o = get(it.owner);
      if (o && !(o.kind === 'abbr' || (o.kind === 'tile' && o.level === 2))) { bad.add(it.id); bad.add(o.id); }
    }
  }
  return { bad, badEdges, count: badEdges.size + list.filter(i => i.kind === 'word' && bad.has(i.id)).length };
}

// ------------------------------------------------------------------ building the SVG pieces
function buildPiece(it) {
  const g = svgEl('g', { class: 'piece', 'data-id': it.id });
  const gm = geom(it);
  if (it.kind === 'abbr') {
    const [w, h] = ABBR[it.size].map(MM);
    g.appendChild(svgEl('polygon', { class: 'abbr-shape node-shape', points: `0,${-h / 2} ${w / 2},${h / 2} ${-w / 2},${h / 2}` }));
  } else {
    g.appendChild(buildShapeGroup(it.cat, label(it), gm.r));
  }
  for (const c of [gm.top, ...gm.bots]) g.appendChild(svgEl('circle', { class: 'cup', cx: c.x, cy: c.y, r: MM(2.7) }));
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
  const v = view();
  world.setAttribute('transform', `translate(${v.x},${v.y}) scale(${v.k})`);
}
function render() {
  layoutWords();
  const list = items();
  const A = analyze(list);
  const live = new Set(list.map(i => i.id));
  for (const [id, node] of nodeCache) if (!live.has(id)) { node.remove(); nodeCache.delete(id); }
  for (const it of list) {
    let node = nodeCache.get(it.id);
    if (!node) {
      node = it.kind === 'word' ? buildWord(it) : buildPiece(it);
      (it.kind === 'word' ? layerWords : layerPieces).appendChild(node);
      if (it.kind === 'tile') fitShapeLabels(node);
      nodeCache.set(it.id, node);
    }
    node.setAttribute('transform', `translate(${it.x},${it.y})`);
    node.classList.toggle('selected', sel === it.id);
    node.classList.toggle('bad', A.bad.has(it.id));
    node.classList.toggle('dragging', !!(drag && drag.ids && drag.ids.has(it.id) && drag.moved));
  }
  layerSticks.textContent = '';
  for (const it of list) {
    if (!isTile(it) || !it.parent) continue;
    const p = byId(it.parent.id);
    if (!p) continue;
    const a = portPos(p, it.parent.slot), b = portPos(it, 'top');
    const wrong = A.badEdges.has(it.id);
    layerSticks.appendChild(svgEl('line', { class: 'stick' + (wrong ? ' bad' : ''), x1: a.x, y1: a.y, x2: b.x, y2: b.y, 'stroke-width': MM(4) }));
    for (const q of [a, b]) {
      layerSticks.appendChild(svgEl('circle', { class: 'ball' + (wrong ? ' bad' : ''), cx: q.x, cy: q.y, r: MM(3) }));
      layerSticks.appendChild(svgEl('circle', { class: 'ball-hi', cx: q.x - MM(.9), cy: q.y - MM(.9), r: MM(.9) }));
    }
  }
  const chip = $('status');
  chip.className = A.count ? 'bad' : (list.some(i => i.parent || i.owner) ? 'ok' : '');
  chip.textContent = A.count ? (A.count === 1 ? `⚠ 1 join doesn’t fit ${MODE_NAME[state.mode]}` : `⚠ ${A.count} joins don’t fit ${MODE_NAME[state.mode]}`) : (chip.className ? `✓ every join fits ${MODE_NAME[state.mode]}` : '');
  updateSelBar();
  $('btn-undo').disabled = !undoStack.length;
}
function clearNodes() { nodeCache.clear(); layerPieces.textContent = ''; layerWords.textContent = ''; }
function front(ids) { for (const id of ids) { const n = nodeCache.get(id); if (n) n.parentNode.appendChild(n); } }

// ------------------------------------------------------------------ undo
const snap = () => JSON.stringify({ items: state.items, nextId: state.nextId });
function pushUndo(pre) { undoStack.push(pre); if (undoStack.length > 80) undoStack.shift(); redoStack = []; }
function restore(json) { const s = JSON.parse(json); state.items = s.items; state.nextId = s.nextId; sel = null; clearNodes(); render(); }
function undo() { if (!undoStack.length) return; redoStack.push(snap()); restore(undoStack.pop()); save(); }
function redo() { if (!redoStack.length) return; undoStack.push(snap()); restore(redoStack.pop()); save(); }

// ------------------------------------------------------------------ the sentences
const TYPES = [
  { id: 'declarative', label: 'Basic statement', blurb: 'A plain statement (a declarative).' },
  { id: 'question', label: 'Question', blurb: 'A question: the verb moves up to C and leaves a crossed-out trace in T.' },
  { id: 'passive', label: 'Passive', blurb: 'The thing acted on becomes the subject, and the doer comes in a “by” phrase.' },
];
const H = (s, w, extra) => Object.assign({ shape: s, number: 2, children: [], word: w || null }, extra || {});
const N_ = (s, n, ...c) => ({ shape: s, number: n, children: c, word: null });
// a noun phrase in each mode: the determiner is inside NP in XP mode, and heads a DP in X′ mode
function np(mode, det, noun) {
  return mode === 'prex'
    ? N_('N', 1, H('D', det), H('N', noun))
    : N_('D', 1, N_('D', 1.5, H('D', det), N_('N', 1, N_('N', 1.5, H('N', noun)))));
}
function declarative(mode, subj, verb, obj) {
  return mode === 'prex'
    ? N_('T', 1, np(mode, 'the', subj), H('T', null, { silent: true }), N_('V', 1, H('V', verb), np(mode, 'the', obj)))
    : N_('T', 1, np(mode, 'the', subj), N_('T', 1.5, H('T', null, { silent: true }), N_('V', 1, N_('V', 1.5, H('V', verb), np(mode, 'the', obj)))));
}
function passive(mode, subj, verb, agent) {
  return mode === 'prex'
    ? N_('T', 1, np(mode, 'the', subj), H('T', 'was'), N_('V', 1, H('V', verb), N_('P', 1, H('P', 'by'), np(mode, 'the', agent))))
    : N_('T', 1, np(mode, 'the', subj), N_('T', 1.5, H('T', 'was'), N_('V', 1, N_('V', 1.5, H('V', verb), N_('P', 1, N_('P', 1.5, H('P', 'by'), np(mode, 'the', agent)))))));
}
function fromGame(mode, id) {
  const e = MODES[mode].level2.find(x => x.id === id);
  return e && e.root ? e.root : null;
}
const clone = o => JSON.parse(JSON.stringify(o));
function sentencesFor(type, mode) {
  const list = [];
  const add = (tree, text) => { if (tree) list.push({ tree: clone(tree), text }); };
  if (type === 'declarative') {
    add(fromGame(mode, 'the-cat-chased-the-mouse'), 'The cat chased the mouse.');
    add(declarative(mode, 'mouse', 'chased', 'cat'), 'The mouse chased the cat.');
    if (mode === 'prex') add(fromGame(mode, 'the-fluffy-cat-will-jump'), 'The fluffy cat will jump.');
  } else if (type === 'question') {
    if (mode === 'xbar') {
      add(fromGame(mode, 'did-the-cat-chase-the-mouse'), 'Did the cat chase the mouse?');
      add(fromGame(mode, 'which-mouse-did-the-cat-chase'), 'Which mouse did the cat chase?');
    }
  } else if (type === 'passive') {
    add(passive(mode, 'mouse', 'chased', 'cat'), 'The mouse was chased by the cat.');
    add(passive(mode, 'cat', 'chased', 'mouse'), 'The cat was chased by the mouse.');
  }
  return list;
}
const leaves = (n, out = []) => { if (!n.children.length) out.push(n); n.children.forEach(c => leaves(c, out)); return out; };
const overtWords = n => leaves(n).filter(l => l.word && !l.silent && !l.isTrace).map(l => l.word);
function currentTask() {
  const list = sentencesFor(state.task.type, state.mode);
  if (!list.length) return null;
  const i = ((state.task.idx % list.length) + list.length) % list.length;
  return Object.assign({ index: i, count: list.length }, list[i]);
}
function taskWords(task) {
  const set = [];
  for (const l of leaves(task.tree)) { if (l.silent) { if (!set.includes('Ø')) set.push('Ø'); } else if (l.word && !set.includes(l.word)) set.push(l.word); }
  // a fixed shuffle, so the shelf does not give the order away
  return set.map((w, i) => [w, (i * 7 + w.length * 3) % 11]).sort((a, b) => a[1] - b[1]).map(a => a[0]);
}
function taskNote(task) {
  const bits = [];
  const ls = leaves(task.tree);
  if (ls.some(l => l.silent)) bits.push('Some heads are silent here: use the Ø magnet under them.');
  if (ls.some(l => l.isTrace)) bits.push('A crossed-out word is a trace: use the word twice, and double-tap one to cross it out.');
  bits.push('Words go under heads (or an abbreviation triangle).');
  return bits.join(' ');
}

// ------------------------------------------------------------------ checking a tree
const lbl = (shape, number) => shape + (number === 1 ? 'P' : number === 1.5 ? '′' : '⁰');
const lblItem = it => it.kind === 'abbr' ? 'a triangle' : lbl(it.cat, it.level);
function boardTree() {
  const list = items();
  const mk = t => ({ it: t, kids: childrenOf(t.id).sort((a, b) => a.parent.slot - b.parent.slot).map(mk), words: wordsOf(t.id) });
  return { roots: list.filter(i => isTile(i) && !i.parent).map(mk), loose: list.filter(i => i.kind === 'word' && !i.owner) };
}
function compare(target, node, path) {
  const here = lbl(target.shape, target.number);
  if (node.it.kind === 'abbr') {
    if (target.number !== 1) return `A triangle can only stand for a whole phrase, not ${here}.`;
    if (node.kids.length) return 'Nothing can hang from a triangle.';
    const want = overtWords(target).join(' ').toLowerCase();
    const have = node.words.filter(w => !w.crossed).map(w => w.text).join(' ').toLowerCase();
    return want === have ? null : `The words under the triangle (for the ${here} under ${path}) aren’t right.`;
  }
  if (node.it.cat !== target.shape || node.it.level !== target.number) return `Under ${path}, I expected a ${here} but found a ${lblItem(node.it)}.`;
  if (!target.children.length) {                     // a head
    if (node.kids.length) return `${here} should be a head: nothing hangs from it.`;
    const ws = node.words;
    if (target.silent) return ws.length === 1 && /^[Ø∅]$/.test(ws[0].text) && !ws[0].crossed ? null : `${here} is silent in this sentence: put the Ø magnet under it.`;
    if (!ws.length) return `${here} needs a word under it.`;
    if (ws.length > 1) return `${here} should have just one word under it.`;
    if (ws[0].text.toLowerCase() !== target.word.toLowerCase()) return `The word under ${here} isn’t right.`;
    if (!!ws[0].crossed !== !!target.isTrace) return target.isTrace ? `The “${ws[0].text}” under ${here} should be crossed out (it is a trace).` : `The “${ws[0].text}” under ${here} shouldn’t be crossed out.`;
    return null;
  }
  if (node.words.length) return `Words go under heads, not under ${here}.`;
  if (node.kids.length !== target.children.length) return `${here} should have ${target.children.length} piece${target.children.length > 1 ? 's' : ''} hanging from it, but it has ${node.kids.length}.`;
  for (let i = 0; i < target.children.length; i++) {
    const err = compare(target.children[i], node.kids[i], here);
    if (err) return err;
  }
  return null;
}
function checkTree() {
  const task = currentTask();
  if (!task) return { ok: false, msg: 'There is no sentence of this kind in this mode.' };
  if (!items().length) return { ok: false, msg: 'Nothing on the table yet. Build the tree for the sentence above.' };
  const A = analyze();
  if (A.count) return { ok: false, msg: 'Some joins glow red: they don’t fit this mode. Fix those first.' };
  const t = boardTree();
  if (t.loose.length) return { ok: false, msg: `Some words aren’t under a head yet: ${t.loose.map(w => '“' + w.text + '”').join(', ')}.` };
  if (t.roots.length > 1) return { ok: false, msg: 'There are separate pieces on the table. Join everything into one tree (or put the extra pieces away).' };
  const err = compare(task.tree, t.roots[0], 'the top');
  return err ? { ok: false, msg: err } : { ok: true, msg: '✓ Built correctly! Every join fits and every word is in place.' };
}

// ------------------------------------------------------------------ the task strip, the answer, the shelf
function setResult(msg, cls) {
  $('task-result').textContent = msg || ''; $('task-result').className = cls || '';
  $('task-note').hidden = !!msg;                       // the result replaces the hint while it is showing
}
function renderTask() {
  const on = state.activity === 'sentence';
  for (const b of document.querySelectorAll('#seg-activity button')) b.classList.toggle('on', b.dataset.activity === state.activity);
  for (const el of document.querySelectorAll('.sent-only')) el.hidden = !on;
  $('taskline').hidden = !on;
  if (!on) return;
  const chips = $('type-chips'); chips.textContent = '';
  const SHORT = { declarative: 'Statement', question: 'Question', passive: 'Passive' };
  for (const t of TYPES) {
    const b = document.createElement('button');
    b.textContent = SHORT[t.id]; b.title = t.blurb; b.className = state.task.type === t.id ? 'on' : '';
    const avail = sentencesFor(t.id, state.mode).length > 0;
    b.disabled = !avail;
    if (!avail) b.title = 'Questions need the complementizer (C), which XP mode doesn’t have. Try X′ mode.';
    b.addEventListener('click', () => { state.task = { type: t.id, idx: 0 }; setResult(''); renderTask(); renderShelf(); save(); });
    chips.appendChild(b);
  }
  const task = currentTask();
  $('task-sentence').textContent = task ? task.text : 'No sentence of this kind in this mode.';
  $('task-note').textContent = task ? taskNote(task) : '';
  $('task-sentence').title = task ? TYPES.find(t => t.id === state.task.type).blurb : '';
  $('btn-check').disabled = !task; $('btn-answer').disabled = !task; $('btn-next').disabled = !task || task.count < 2;
}
function ensureTaskValid() {
  if (!sentencesFor(state.task.type, state.mode).length) state.task = { type: 'declarative', idx: 0 };
}
function treeLayout(node, depth, xs) {
  node._d = depth;
  if (!node.children.length) { node._x = xs.n++; return; }
  node.children.forEach(c => treeLayout(c, depth + 1, xs));
  node._x = (node.children[0]._x + node.children[node.children.length - 1]._x) / 2;
}
function answerSvg(tree) {
  const r = 24, gx = 66, gy = 62;
  const t = clone(tree); const xs = { n: 0 };
  treeLayout(t, 0, xs);
  const depth = (n) => 1 + Math.max(0, ...n.children.map(depth));
  const w = Math.max(xs.n, 1) * gx + 40, h = depth(t) * gy + 70;
  const svg = svgEl('svg', { viewBox: `0 0 ${w} ${h}`, width: w, height: h });
  const edges = svgEl('g'), nodes = svgEl('g');
  svg.appendChild(edges); svg.appendChild(nodes);
  (function walk(n) {
    const x = 20 + n._x * gx + gx / 2, y = 30 + n._d * gy;
    n._px = x; n._py = y;
    for (const c of n.children) { walk(c); edges.appendChild(svgEl('line', { x1: x, y1: y + r * .6, x2: c._px, y2: c._py - r * .6, stroke: '#4b5563', 'stroke-width': 2.4 })); }
    const g = buildShapeGroup(n.shape, lbl(n.shape, n.number), r * (n.number === 1 ? 1 : n.number === 1.5 ? .85 : .65));
    g.setAttribute('transform', `translate(${x},${y})`); nodes.appendChild(g);
    if (!n.children.length) {
      const text = n.silent ? 'Ø' : n.word;
      if (text) {
        const tt = svgEl('text', { x, y: y + r * .65 + 14, 'text-anchor': 'middle', 'font-family': 'Georgia, serif', 'font-size': 15, fill: n.isTrace ? '#6b7280' : '#111' });
        tt.textContent = text; nodes.appendChild(tt);
        if (n.isTrace) nodes.appendChild(svgEl('line', { x1: x - 16, x2: x + 16, y1: y + r * .65 + 9, y2: y + r * .65 + 9, stroke: '#b91c1c', 'stroke-width': 1.6 }));
      }
    }
  })(t);
  return svg;
}
function showAnswer() {
  const task = currentTask(); if (!task) return;
  $('answer-title').textContent = task.text;
  const body = $('answer-body'); body.textContent = '';
  const svg = answerSvg(task.tree); body.appendChild(svg); fitShapeLabels(body);
  const p = document.createElement('p'); p.textContent = 'This is one correct way to build it, in ' + MODE_NAME[state.mode] + '. A crossed-out word is a trace; Ø is a silent head.'; body.appendChild(p);
  $('answer').showModal();
}

function trayTiles() {
  const m = MODES[state.mode];
  const have = new Set();
  for (const st of m.structures) { have.add(st.shape + '|' + st.number); for (const c of st.children) have.add(c.shape + '|' + c.number); }
  const out = [];
  for (const k of have) { const [cat, n] = k.split('|'); out.push({ cat, level: Number(n) }); }
  out.sort((a, b) => CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat) || a.level - b.level);
  return out;
}
function allWords() {
  const set = new Set();
  const walk = n => { if (n.word) set.add(n.word); (n.children || []).forEach(walk); };
  for (const id of [state.mode, ...Object.keys(MODES).filter(k => k !== state.mode)]) for (const x of MODES[id].level2) if (x.root) walk(x.root);
  return [...set];
}
// a template picture; every piece of a row is drawn in the same box (the category's phrase tile), so a head looks smaller than its phrase
function templateSvg(spec, box) {
  const it = Object.assign({ x: 0, y: 0 }, spec);
  const pad = 4;
  const hx = box.hx + pad, hy = box.hy + pad;
  const svg = svgEl('svg', { viewBox: `${-hx} ${-hy} ${2 * hx} ${2 * hy}`, 'aria-hidden': 'true' });
  svg.appendChild(buildPiece(it));
  return svg;
}
function boxFor(cat) {
  const b = geom({ kind: 'tile', cat, level: 1, x: 0, y: 0 }).b;
  return { hx: Math.max(Math.abs(b[0]), Math.abs(b[2])), hy: Math.max(Math.abs(b[1]), Math.abs(b[3])) };
}
function renderShelf() {
  const root = $('shelf-scroll');
  root.textContent = '';
  const mk = (tag, cls, text) => { const d = document.createElement(tag); if (cls) d.className = cls; if (text) d.textContent = text; return d; };
  const tiles = trayTiles();
  const levels = [1, 1.5, 2].filter(l => tiles.some(t => t.level === l));
  root.style.setProperty('--cols', levels.length);
  const legend = mk('div', 'legend');
  for (const l of levels) legend.appendChild(mk('span', '', state.labels === 'numbers' ? String(l) : (l === 1 ? 'XP' : l === 1.5 ? 'X′' : 'X⁰')));
  root.appendChild(legend);
  // one row per category: the phrase, the bar and the head of the same shape
  for (const cat of CAT_ORDER) {
    if (!tiles.some(t => t.cat === cat)) continue;
    const row = mk('div', 'cat-row'), box = boxFor(cat);
    for (const l of levels) {
      if (!tiles.some(t => t.cat === cat && t.level === l)) { row.appendChild(mk('div', 'tpl-empty')); continue; }
      const spec = { kind: 'tile', cat, level: l };
      const d = mk('div', 'tpl'); d.title = label(spec); d.setAttribute('role', 'button'); d.setAttribute('aria-label', 'Add ' + label(spec) + ' to the table');
      d.appendChild(templateSvg(spec, box));
      bindShelfItem(d, spec);
      row.appendChild(d);
    }
    root.appendChild(row);
  }
  root.appendChild(mk('div', 'group-title', 'Triangles'));
  const tri = mk('div', 'stack'), tbox = { hx: ABBR.large[0] * S / 2, hy: ABBR.large[1] * S / 2 };
  for (const size of ['small', 'large']) {
    const spec = { kind: 'abbr', size };
    const d = mk('div', 'tpl'); d.title = size + ' abbreviation triangle'; d.setAttribute('role', 'button'); d.setAttribute('aria-label', 'Add a ' + size + ' abbreviation triangle');
    d.appendChild(templateSvg(spec, tbox));
    bindShelfItem(d, spec); tri.appendChild(d);
  }
  root.appendChild(tri);
  root.appendChild(mk('div', 'group-title', 'Words'));
  const wrow = mk('div', 'words');
  const words = state.activity === 'sentence' && currentTask() ? taskWords(currentTask()) : ['Ø', ...allWords()];
  const addWord = w => {
    const d = mk('div', 'word', w); d.setAttribute('role', 'button'); d.setAttribute('aria-label', 'Add the word ' + w);
    if (w === 'Ø') d.title = 'a silent head';
    bindShelfItem(d, { kind: 'word', text: w }); wrow.appendChild(d);
  };
  words.forEach(addWord);
  root.appendChild(wrow);
  if (state.activity !== 'sentence') {
    const add = mk('div', 'add-word');
    add.innerHTML = '<input placeholder="add a word" maxlength="24" aria-label="Add your own word"><button>Add</button>';
    const doAdd = () => { const i = add.querySelector('input'); const v = i.value.trim(); if (!v) return; i.value = ''; addWord(v); };
    add.querySelector('button').addEventListener('click', doAdd);
    add.querySelector('input').addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
    root.appendChild(add);
  }
  fitShapeLabels(root);
}

// ------------------------------------------------------------------ creating, deleting
function makeItem(spec, x, y) {
  const it = Object.assign({ id: newId(), x, y, parent: null }, spec);
  if (it.kind === 'word') { it.owner = null; it.ord = 0; it.crossed = false; delete it.parent; }
  return it;
}
function toWorld(cx, cy) {
  const r = board.getBoundingClientRect(), v = view();
  return { x: (cx - r.left - v.x) / v.k, y: (cy - r.top - v.y) / v.k };
}
function toast(msg) {
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2200);
}
function deleteTree(id) {
  const ids = subtree(id);
  state.items = items().filter(i => !ids.has(i.id));
  if (sel && ids.has(sel)) sel = null;
}
// tap on a shelf piece: it lands in the middle of what you can see, on a free spot
function addAtCenter(spec) {
  const pre = snap();
  const r = board.getBoundingClientRect();
  const c = toWorld(r.left + r.width / 2, r.top + r.height / 2);
  let x = c.x, y = c.y, tries = 0;
  const taken = (px, py) => items().some(i => Math.hypot(i.x - px, i.y - py) < MM(16));
  while (taken(x, y) && tries < 40) { tries++; const a = tries * 2.4, rad = MM(12) * Math.sqrt(tries); x = c.x + Math.cos(a) * rad; y = c.y + Math.sin(a) * rad; }
  const it = makeItem(spec, x, y);
  items().push(it); sel = it.id;
  pushUndo(pre); render(); save();
}

// ------------------------------------------------------------------ dragging
function beginDrag(e, it, opts = {}) {
  drag = { pre: opts.pre || snap(), id: it.id, ids: null, moved: !!opts.moved, startX: e.clientX, startY: e.clientY, last: toWorld(e.clientX, e.clientY), snapTo: null, pointer: e.pointerId, touchLift: !!opts.touchLift };
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
  if (!drag || e.pointerId !== drag.pointer) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
    drag.moved = true; prepareDrag();
  }
  const w = toWorld(e.clientX, e.clientY);
  const dx = w.x - drag.last.x, dy = w.y - drag.last.y;
  drag.last = w;
  for (const id of drag.ids) { const i = byId(id); if (i) { i.x += dx; i.y += dy; } }
  const over = hitShelf(e);
  $('shelf').classList.toggle('drop-target', over);
  drag.snapTo = over ? null : findSnap();
  showGhost();
  render();
}
function hitShelf(e) {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  return !!(el && el.closest('#shelf'));
}
function onUp(e) {
  if (drag && e.pointerId !== drag.pointer) return;
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onUp);
  $('shelf').classList.remove('drop-target');
  layerGhost.textContent = '';
  const d = drag; drag = null;
  if (!d) return;
  if (!d.moved) {                                   // a tap on a piece: select it (a quick second tap on a word crosses it out)
    const it = byId(d.id);
    if (it && it.kind === 'word') {
      const now = Date.now();
      if (lastTap.id === it.id && now - lastTap.t < 380) { toggleCross(it); lastTap = { id: null, t: 0 }; return; }
      lastTap = { id: it.id, t: now };
    }
    render(); return;
  }
  const it = byId(d.id);
  if (it && hitShelf(e)) deleteTree(d.id);          // put away
  else if (it) { if (it.kind === 'word') attachWord(it); else if (d.snapTo) applySnap(d.snapTo, d.ids); }
  if (snap() !== d.pre) pushUndo(d.pre);
  render(); save();
}
function toggleCross(it) {
  const pre = snap(); it.crossed = !it.crossed;
  const n = nodeCache.get(it.id); if (n) { n.remove(); nodeCache.delete(it.id); }
  pushUndo(pre); render(); save();
}
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
  const tp = portPos(root, 'top');
  for (const t of others) for (const s of freeSlots(t)) {
    const p = portPos(t, s); const d = Math.hypot(p.x - tp.x, p.y - tp.y);
    if (d < SNAP) consider({ kind: 'child', root: root.id, parent: t.id, slot: s, d, at: p });
  }
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
  if (drag && drag.snapTo) {
    const c = drag.snapTo;
    const par = byId(c.parent), chi = byId(c.kind === 'child' ? c.root : c.child);
    const ok = par && chi && par.kind !== 'abbr' && edgeLegal(par, chi) && slotExists(par, c.slot);
    layerGhost.appendChild(svgEl('circle', { class: 'snap-ghost' + (ok ? '' : ' bad'), cx: c.at.x, cy: c.at.y, r: MM(7) }));
  }
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
    if (!isTile(t) || childrenOf(t.id).length) continue;
    const g = geom(t); const ax = t.x, ay = t.y + g.b[3] + MM(2) + WORD_H / 2;
    const d = Math.hypot(w.x - ax, w.y - ay);
    if (d < MM(34) && (!best || d < best.d)) best = { t, d };
  }
  if (best) { w.owner = best.t.id; w.ord = w.x; }
}

// ---- starting a drag from the shelf (a tap adds the piece; a drag places it; on a touch screen drag sideways, towards the table)
function bindShelfItem(el, spec) {
  el.addEventListener('pointerdown', e => {
    if (e.button) return;
    const st = { x: e.clientX, y: e.clientY, id: e.pointerId, type: e.pointerType, started: false };
    const cleanup = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); };
    const mv = ev => {
      if (ev.pointerId !== st.id || st.started) return;
      const dx = ev.clientX - st.x, dy = ev.clientY - st.y;
      if (Math.hypot(dx, dy) < 8) return;
      const go = st.type !== 'touch' || Math.abs(dx) > Math.abs(dy);          // the shelf scrolls up and down, so a sideways move picks a piece up
      cleanup();
      if (go) { st.started = true; startFromShelf(ev, spec, st.type === 'touch'); }
    };
    const up = ev => { if (ev.pointerId !== st.id) return; cleanup(); if (!st.started) addAtCenter(spec); };
    const cancel = () => cleanup();
    window.addEventListener('pointermove', mv); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  });
}
function startFromShelf(e, spec, touch) {
  const pre = snap();
  const w = toWorld(e.clientX, e.clientY);
  const it = makeItem(spec, w.x, w.y - (touch ? 46 / view().k : 0));          // a finger would hide the piece, so it rides above it
  items().push(it); sel = it.id;
  render();
  beginDrag(e, it, { moved: true, pre });
  drag.last = toWorld(e.clientX, e.clientY);
}

// ---- the board: pick a piece up, or pan and pinch on the empty table
const bgPtr = new Map(); let bgState = null;
board.addEventListener('pointerdown', e => {
  const node = e.target.closest('[data-id]');
  if (node && !bgPtr.size && !drag) {
    e.preventDefault();
    const it = byId(Number(node.dataset.id));
    if (!it) return;
    sel = it.id; render();
    beginDrag(e, it, {});
    return;
  }
  if (drag) return;
  if (!bgPtr.size) { sel = null; render(); board.classList.add('panning'); window.addEventListener('pointermove', bgMove); window.addEventListener('pointerup', bgUp); window.addEventListener('pointercancel', bgUp); }
  bgPtr.set(e.pointerId, { x: e.clientX, y: e.clientY });
  bgState = null;
});
function bgMove(e) {
  const p = bgPtr.get(e.pointerId); if (!p) return;
  const v = view();
  const before = [...bgPtr.values()].map(q => ({ ...q }));
  p.x = e.clientX; p.y = e.clientY;
  if (bgPtr.size === 1) { const o = before[0]; v.x += p.x - o.x; v.y += p.y - o.y; applyView(); return; }
  const [a, b] = [...bgPtr.values()];
  const d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
  if (bgState) {
    const r = board.getBoundingClientRect();
    const k = Math.min(2.5, Math.max(0.25, v.k * (d / bgState.d))), f = k / v.k;
    const px = bgState.cx - r.left, py = bgState.cy - r.top;
    v.x = px - (px - v.x) * f + (cx - bgState.cx); v.y = py - (py - v.y) * f + (cy - bgState.cy); v.k = k;
    applyView();
  }
  bgState = { d, cx, cy };
}
function bgUp(e) {
  bgPtr.delete(e.pointerId); bgState = null;
  if (!bgPtr.size) { board.classList.remove('panning'); window.removeEventListener('pointermove', bgMove); window.removeEventListener('pointerup', bgUp); window.removeEventListener('pointercancel', bgUp); save(); }
}
board.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.12 : 1 / 1.12); }, { passive: false });
function zoomAt(cx, cy, f) {
  const v = view(), r = board.getBoundingClientRect();
  const k = Math.min(2.5, Math.max(0.25, v.k * f)), a = k / v.k;
  const px = cx - r.left, py = cy - r.top;
  v.x = px - (px - v.x) * a; v.y = py - (py - v.y) * a; v.k = k;
  applyView(); save();
}
function fit() {
  layoutWords();
  const list = items();
  if (!list.length) { state.view = defaultView(); applyView(); return; }
  const b = bounds(list), r = board.getBoundingClientRect(), pad = 40;
  const k = Math.min(1.4, Math.max(0.25, Math.min((r.width - 2 * pad) / (b.x1 - b.x0), (r.height - 2 * pad - 50) / (b.y1 - b.y0))));
  state.view = { k, x: (r.width - (b.x1 - b.x0) * k) / 2 - b.x0 * k, y: (r.height - (b.y1 - b.y0) * k) / 2 - b.y0 * k + 20 };
  applyView(); save();
}

// ------------------------------------------------------------------ the selection bar and keys
function updateSelBar() {
  const it = sel != null ? byId(sel) : null;
  $('sel-bar').classList.toggle('show', !!it && !(drag && drag.moved));
  if (!it) return;
  $('sel-cross').style.display = it.kind === 'word' ? '' : 'none';
  $('sel-dup').style.display = isTile(it) ? '' : 'none';
}
$('sel-del').addEventListener('click', () => { if (sel == null) return; const pre = snap(); deleteTree(sel); pushUndo(pre); render(); save(); });
$('sel-cross').addEventListener('click', () => { const it = byId(sel); if (it && it.kind === 'word') toggleCross(it); });
$('sel-dup').addEventListener('click', () => {
  const it = byId(sel); if (!it || !isTile(it)) return;
  const pre = snap(); const ids = subtree(it.id); const map = new Map();
  const list = items().filter(i => ids.has(i.id));
  list.forEach(i => map.set(i.id, newId()));
  let root = null;
  for (const i of list) {
    const c = JSON.parse(JSON.stringify(i)); c.id = map.get(i.id); c.x = i.x + MM(24); c.y = i.y + MM(24);
    if (c.parent) c.parent = i.id === it.id ? null : { id: map.get(c.parent.id), slot: c.parent.slot };
    if (c.owner) c.owner = map.get(c.owner);
    if (i.id === it.id) root = c;
    state.items.push(c);
  }
  sel = root.id; pushUndo(pre); render(); save();
});
window.addEventListener('keydown', e => {
  if (e.target && /input|textarea/i.test(e.target.tagName)) return;
  if ((e.key === 'Delete' || e.key === 'Backspace') && sel != null) { e.preventDefault(); $('sel-del').click(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
});

// ------------------------------------------------------------------ controls
function syncControls() {
  for (const b of document.querySelectorAll('#seg-mode button')) b.classList.toggle('on', b.dataset.mode === state.mode);
  for (const b of document.querySelectorAll('#seg-labels button')) b.classList.toggle('on', b.dataset.labels === state.labels);
  $('sb').classList.toggle('shelf-closed', !!state.shelfClosed);
}
for (const b of document.querySelectorAll('#seg-mode button')) b.addEventListener('click', () => {
  state.mode = b.dataset.mode; ensureTaskValid(); sel = null; clearNodes();
  syncControls(); renderTask(); renderShelf(); render(); save();
  setResult('');
});
for (const b of document.querySelectorAll('#seg-labels button')) b.addEventListener('click', () => { state.labels = b.dataset.labels; syncControls(); clearNodes(); renderShelf(); render(); save(); });
for (const b of document.querySelectorAll('#seg-activity button')) b.addEventListener('click', () => {
  state.activity = b.dataset.activity;
  setResult('');
  renderTask(); renderShelf(); save();
  if (state.activity === 'sentence') $('btn-check').scrollIntoView({ inline: 'nearest', block: 'nearest' });
  setTimeout(() => render(), 0);
});
$('shelf-toggle').addEventListener('click', () => { state.shelfClosed = true; syncControls(); save(); });
$('shelf-open').addEventListener('click', () => { state.shelfClosed = false; syncControls(); save(); });
$('btn-check').addEventListener('click', () => {
  const r = checkTree(); const out = $('task-result');
  setResult(r.msg, r.ok ? 'ok' : 'bad');
  if (r.ok) toast('Correct!');
});
$('btn-answer').addEventListener('click', showAnswer);
$('btn-next').addEventListener('click', () => { state.task.idx++; setResult(''); renderTask(); renderShelf(); save(); });
$('btn-undo').addEventListener('click', undo);
$('btn-menu').addEventListener('click', () => $('menu').showModal());
$('m-redo').addEventListener('click', () => { redo(); });
$('m-help').addEventListener('click', () => { $('menu').close(); $('help').showModal(); });
$('m-clear').addEventListener('click', () => {
  $('menu').close();
  if (!items().length) return;
  if (!confirm('Clear everything on the table? (Undo brings it back.)')) return;
  const pre = snap(); state.items = []; sel = null; pushUndo(pre); render(); save();
});
$('btn-zoom-in').addEventListener('click', () => { const r = board.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1.25); });
$('btn-zoom-out').addEventListener('click', () => { const r = board.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, 1 / 1.25); });
$('btn-fit').addEventListener('click', fit);
$('m-export').addEventListener('click', () => {
  $('menu').close();
  layoutWords();
  const list = items(); if (!list.length) { toast('Nothing on the table to save'); return; }
  const b = bounds(list); const pad = 24, w = b.x1 - b.x0 + 2 * pad, h = b.y1 - b.y0 + 2 * pad;
  const style = '.node-shape{stroke:#1f2937;stroke-width:1.2;stroke-linejoin:round}.cup{fill:rgba(255,255,255,.55);stroke:rgba(0,0,0,.35);stroke-width:.8}' +
    '.abbr-shape{fill:#d1d5db;stroke:#1f2937;stroke-width:1.2;stroke-linejoin:round}.magnet-box{fill:#f4ecd8;stroke:#8a8372;stroke-width:1}.magnet-box.crossed{fill:#ece6d6}' +
    '.magnet-text{font-family:Georgia,serif;fill:#111;text-anchor:middle;dominant-baseline:middle}.magnet-text.crossed{fill:#6b7280}.magnet-strike{stroke:#b91c1c;stroke-width:1.6}' +
    '.stick{stroke:#4b5563}.ball{fill:#c7ccd3;stroke:#4b5563;stroke-width:1}.ball-hi{fill:#fff;opacity:.8}';
  const svg = svgEl('svg', { xmlns: SVG_NS, width: Math.round(w), height: Math.round(h), viewBox: `${b.x0 - pad} ${b.y0 - pad} ${w} ${h}` });
  const st = svgEl('style', {}); st.textContent = style; svg.appendChild(st);
  svg.appendChild(svgEl('rect', { x: b.x0 - pad, y: b.y0 - pad, width: w, height: h, fill: '#fbfbf9' }));
  for (const n of layerPieces.children) { const c = n.cloneNode(true); c.classList.remove('selected'); svg.appendChild(c); }
  svg.appendChild(layerSticks.cloneNode(true));
  svg.appendChild(layerWords.cloneNode(true));
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'tree.svg';
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
window.addEventListener('resize', () => { if (!items().length && !state.view) applyView(); });

// ------------------------------------------------------------------ start
state = load();
ensureTaskValid();
syncControls();
renderShelf(); renderTask(); applyView(); render();
if (!items().length) { state.view = defaultView(); applyView(); }
if (!localStorage.getItem(STORE + '-seen')) { try { localStorage.setItem(STORE + '-seen', '1'); } catch (e) { /* ignore */ } setTimeout(() => $('help').showModal(), 300); }

window.sandbox = { get state() { return state; }, items, render, geom, portPos, subtree, analyze, edgeLegal, checkTree, currentTask, sentencesFor, MM, S, LENGTHS, fit, TYPES, leaves, compare };
})();
