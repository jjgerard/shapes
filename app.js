// ---------------------------------------------------------------------------
// App orchestration: name gate, level select, Level 1 sub-levels (tutorial,
// build, and the final free-text reveal), points, and localStorage
// persistence.
// ---------------------------------------------------------------------------

const POINTS_TUTORIAL = 20;
const POINTS_TREE = 40;
const POINTS_REVEAL_SLOT = 10;

let player = null;   // {name, code, key}
let state = null;    // {points, trees:[ids], reveal:{shapes:{}, numbers:{}}}

// ---------------- storage ----------------
function storageKey(name, code) {
  return `stb:${name.trim().toLowerCase()}|${code.trim().toLowerCase()}`;
}
function defaultState() {
  return { points: 0, trees: [], reveal: { shapes: {}, numbers: {} } };
}
function loadState(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultState();
    return { ...defaultState(), ...JSON.parse(raw) };
  } catch { return defaultState(); }
}
function saveState() {
  localStorage.setItem(player.key, JSON.stringify(state));
}

// ---------------- navigation ----------------
const SCREEN_SPEECH = {
  name: "Hi! What's your name?",
  levels: 'Pick a level to start!',
  level1: 'Choose a sub-level below!',
  reveal: 'Type what you think each shape and number means!',
};
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById('screen-' + id).classList.remove('hidden');
  if (SCREEN_SPEECH[id]) setMascotSpeech(SCREEN_SPEECH[id]);
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 1900);
}

// ---------------- mascot ----------------
function mascotPulse(className, duration) {
  const el = document.getElementById('mascot');
  if (!el) return;
  el.classList.remove(className);
  void el.offsetWidth; // force reflow so re-adding the class restarts the animation mid-streak
  el.classList.add(className);
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove(className), duration);
}
function celebrateCorrect() { mascotPulse('jumping', 650); }
function celebrateComplete() { mascotPulse('dancing', 1350); }

function setMascotSpeech(text) {
  const bubble = document.getElementById('mascot-bubble');
  if (!bubble) return;
  bubble.textContent = text || '';
  bubble.classList.toggle('visible', !!text);
}

function updateHeader() {
  const info = document.getElementById('player-info');
  if (!player) { info.classList.add('hidden'); return; }
  info.classList.remove('hidden');
  document.getElementById('player-name-display').textContent = `${player.name} (${player.code})`;
  document.getElementById('player-points').textContent = `${state.points} pts`;
}

function loginAs(name, code) {
  player = { name, code, key: storageKey(name, code) };
  state = loadState(player.key);
  localStorage.setItem('stb:lastPlayer', JSON.stringify({ name, code }));
  updateHeader();
  showScreen('levels');
  renderLevelSelect();
}

// ---------------- sub-level completion ----------------
function revealComplete() {
  return Object.keys(CATEGORIES).every(k => state.reveal.shapes[k]) && [1, 2, 3].every(n => state.reveal.numbers[n]);
}
function isSubComplete(sub) {
  return sub.kind === 'reveal' ? revealComplete() : state.trees.includes(sub.id);
}

// ---------------- level select ----------------
function renderLevelSelect() {
  const doneCount = LEVEL1_SUBLEVELS.filter(isSubComplete).length;
  document.getElementById('progress-1').textContent = `${doneCount} / ${LEVEL1_SUBLEVELS.length} sub-levels done`;

  const roadmap = document.getElementById('roadmap');
  roadmap.innerHTML = '';
  ROADMAP.forEach((topic, i) => {
    const card = document.createElement('div');
    card.className = 'level-card locked';
    const num = document.createElement('div');
    num.className = 'level-num';
    num.textContent = `Level ${i + 2}`;
    card.appendChild(num);
    const lock = document.createElement('div');
    lock.className = 'lock-badge';
    lock.textContent = '🔒 Locked';
    card.appendChild(lock);
    roadmap.appendChild(card);
  });
}

// ---------------- shared static (read-only) tree layout + paint ----------------
function layoutTree(root) {
  const NODE_GAP = 82, LEVEL_GAP = 86;
  let leafX = 0;
  (function assign(node, depth) {
    node._depth = depth;
    if (!node.children.length) {
      node._x = leafX * NODE_GAP;
      leafX++;
    } else {
      node.children.forEach(c => assign(c, depth + 1));
      const xs = node.children.map(c => c._x);
      node._x = (Math.min(...xs) + Math.max(...xs)) / 2;
    }
    node._y = depth * LEVEL_GAP + 30;
  })(root, 0);
  return { width: Math.max(leafX * NODE_GAP, NODE_GAP), height: (maxDepth(root) + 1) * LEVEL_GAP + 40 };
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
    const g = buildShapeGroup(node.shape, reveal ? XBAR_LEVELS[node.number].code : node.number, r);
    g.setAttribute('transform', `translate(${node._x + xOffset},${node._y})`);
    nodeLayer.appendChild(g);
    if (reveal) {
      const label = svgEl('text', { x: node._x + xOffset, y: node._y + r + 14, 'text-anchor': 'middle', fill: '#262220', 'font-size': 11, 'font-weight': 700 });
      label.textContent = node.shape;
      nodeLayer.appendChild(label);
    }
    node.children.forEach(walk);
  })(root);
}

// ---------------- shared editor modal ----------------
let editor = null;
let activeCheck = null;  // function() -> void, checked automatically after every move
let currentItems = null; // flat list of STRUCTURES items for the open sub-level, so Clear can re-scatter them

function ensureEditor() {
  if (!editor) {
    editor = new TreeEditor(document.getElementById('editor-canvas'), document.getElementById('editor-feedback'));
  }
  return editor;
}

// Expand an inventory ([{id,count}]) into one STRUCTURES item per physical
// piece -- what scatterAll() lays out on the canvas.
function expandInventory(inventory) {
  const items = [];
  for (const g of inventory) {
    const item = STRUCTURES.find(s => s.id === g.id);
    for (let i = 0; i < g.count; i++) items.push(item);
  }
  return items;
}

// Fit the canvas to the actual screen instead of a fixed desktop size, so
// the puzzle is scattered where a small phone screen can actually reach it.
// This is just the STARTING size -- the editor grows it dynamically from
// there as pieces get dragged around.
function fitCanvasSize(maxW, maxH) {
  const isNarrow = window.innerWidth < 640;
  const availW = window.innerWidth - (isNarrow ? 24 : 60);
  const availH = window.innerHeight - (isNarrow ? 130 : 110);
  return {
    w: Math.max(300, Math.min(maxW, availW)),
    h: Math.max(360, Math.min(maxH, availH)),
  };
}

function setSnipButtonActive(on) {
  document.getElementById('editor-snip').classList.toggle('active', on);
}

function openEditor({ title, hint, items, viewW, viewH, onCheck }) {
  ensureEditor();
  document.getElementById('editor-title').textContent = title;
  setMascotSpeech(hint);
  currentItems = items;
  const fit = fitCanvasSize(viewW, viewH);
  editor.open(fit.w, fit.h);
  editor.scatterAll(items);
  setSnipButtonActive(false);
  editor.onSnipModeChange = setSnipButtonActive;
  editor.onSnap = celebrateCorrect;
  // No Check button here -- a sub-level finishes itself the moment the last
  // correct move is made. onChange fires after every snap/snip; check
  // silently each time, and only act when it's actually complete.
  editor.onChange = () => { if (activeCheck) activeCheck(true); };
  activeCheck = onCheck;
  document.getElementById('editor-overlay').classList.remove('hidden');
}

function closeEditor() {
  document.getElementById('editor-overlay').classList.add('hidden');
  activeCheck = null;
  setMascotSpeech(SCREEN_SPEECH.level1);
}

document.getElementById('editor-close').addEventListener('click', closeEditor);
document.getElementById('editor-clear').addEventListener('click', () => {
  if (!editor || !currentItems) return;
  editor.clear();
  editor.scatterAll(currentItems);
  setSnipButtonActive(false);
});
document.getElementById('editor-snip').addEventListener('click', () => {
  if (!editor) return;
  editor.setSnipMode(!editor.snipMode);
});

// ---------------- pattern matching ----------------
function countNodes(pattern) {
  return 1 + pattern.children.reduce((sum, c) => sum + countNodes(c), 0);
}
function matchesPattern(actual, pattern) {
  if (!actual || actual.shape !== pattern.shape || actual.number !== pattern.number) return false;
  if (actual.children.length !== pattern.children.length) return false;
  const remaining = [...actual.children];
  for (const pc of pattern.children) {
    const idx = remaining.findIndex(rc => matchesPattern(rc, pc));
    if (idx === -1) return false;
    remaining.splice(idx, 1);
  }
  return true;
}

// ================= LEVEL 1: sub-levels =================
function renderTargetGrid() {
  const grid = document.getElementById('target-grid');
  grid.innerHTML = '';
  LEVEL1_SUBLEVELS.forEach((sub, i) => {
    const done = isSubComplete(sub);
    const locked = i > 0 && !isSubComplete(LEVEL1_SUBLEVELS[i - 1]);
    const card = document.createElement('div');
    card.className = 'target-card' + (done ? ' done' : '') + (locked ? ' locked' : '');

    const h3 = document.createElement('h3');
    h3.textContent = locked ? `${i + 1}. Locked` : `${i + 1}. ${done ? '✓ ' : ''}${sub.name}`;
    card.appendChild(h3);

    if (!locked) {
      if (sub.description) {
        const p = document.createElement('p');
        p.textContent = sub.description;
        card.appendChild(p);
      }

      if (sub.kind === 'build') {
        const count = document.createElement('div');
        count.className = 'frag-ids';
        const pieceCount = sub.inventory.reduce((s, g) => s + g.count, 0);
        count.textContent = `${pieceCount} pieces`;
        card.appendChild(count);
      }
    }

    if (locked) {
      const note = document.createElement('p');
      note.className = 'lock-note';
      note.textContent = 'Locked — finish the previous sub-level first.';
      card.appendChild(note);
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn-primary';
      btn.textContent = sub.kind === 'reveal' ? (done ? 'View' : 'Open') : (done ? 'Rebuild' : (sub.kind === 'tutorial' ? 'Try it' : 'Build this'));
      btn.addEventListener('click', () => {
        if (sub.kind === 'tutorial') openTutorialEditor(sub);
        else if (sub.kind === 'build') openTargetEditor(sub);
        else { renderReveal(); showScreen('reveal'); }
      });
      card.appendChild(btn);
    }
    grid.appendChild(card);
  });
}

function markSubDone(sub, points) {
  const already = state.trees.includes(sub.id);
  if (!already) {
    state.trees.push(sub.id);
    state.points += points;
    saveState();
    toast(`✓ ${sub.name} complete — +${points} pts`);
  } else {
    toast(`✓ ${sub.name} — already completed, nice practice!`);
  }
  celebrateComplete();
  updateHeader();
  renderTargetGrid();
  // Stay open on the finished puzzle -- the mascot's dance is the "you're
  // done" signal, the student closes manually whenever they're ready.
}

function openTutorialEditor(sub) {
  const items = sub.pieceIds.map(id => STRUCTURES.find(s => s.id === id));
  openEditor({
    title: sub.name,
    hint: 'Drag the two pieces together until they snap. Then tap the scissors and click the joint to pull them apart again.',
    items,
    viewW: 620, viewH: 560,
    onCheck: (silent) => {
      if (editor.snapCount < 1 || editor.snipCount < 1) return;
      editor.setFeedback('Nice work!', 'ok');
      markSubDone(sub, POINTS_TUTORIAL);
    },
  });
}

function openTargetEditor(sub) {
  const total = countNodes(sub.root);
  openEditor({
    title: sub.name,
    hint: `Drag every piece together until it's one connected shape of ${total}.`,
    items: expandInventory(sub.inventory),
    viewW: 1150, viewH: 800,
    onCheck: () => {
      const forest = editor.toForest();
      const ok = editor.nodes.length === total && forest.length === 1 && matchesPattern(forest[0], sub.root);
      if (!ok) return;
      editor.setFeedback('Complete!', 'ok');
      markSubDone(sub, POINTS_TREE);
    },
  });
}

// ================= REVEAL: fill in what the shapes mean =================
function renderReveal() {
  const body = document.getElementById('reveal-body');
  body.innerHTML = '';
  const sub = LEVEL1_SUBLEVELS.find(s => s.kind === 'reveal');

  const layout = document.createElement('div');
  layout.className = 'legend-layout';

  const treeWrap = document.createElement('div');
  treeWrap.className = 'legend-tree';
  const svg = document.createElementNS(SVG_NS, 'svg');
  treeWrap.appendChild(svg);
  layout.appendChild(treeWrap);

  const dims = layoutTree(sub.root);
  svg.setAttribute('viewBox', `0 0 ${dims.width + 40} ${dims.height}`);
  paintStaticTree(svg, sub.root, { r: 26, reveal: revealComplete(), xOffset: 20 });

  const lists = document.createElement('div');
  lists.className = 'legend-lists';

  lists.appendChild(buildRevealGroup({
    heading: 'What is each shape?',
    items: Object.keys(CATEGORIES).map(key => ({
      key,
      render: (el) => {
        const mini = document.createElementNS(SVG_NS, 'svg');
        mini.setAttribute('viewBox', '-30 -30 60 60');
        mini.appendChild(buildShapeGroup(key, '', 26));
        el.appendChild(mini);
      },
      isCorrect: (val) => isCorrectShapeAnswer(key, val),
      correctMap: state.reveal.shapes,
    })),
    onCorrect: (key) => {
      state.reveal.shapes[key] = true;
      state.points += POINTS_REVEAL_SLOT;
      saveState(); updateHeader();
      revealComplete() ? celebrateComplete() : celebrateCorrect();
      renderReveal();
    },
  }));

  lists.appendChild(buildRevealGroup({
    heading: 'What does each number mean?',
    items: [1, 2, 3].map(n => ({
      key: n,
      render: (el) => {
        const b = document.createElement('span');
        b.className = 'slot-label';
        b.textContent = n;
        el.appendChild(b);
      },
      isCorrect: (val) => isCorrectLevelAnswer(n, val),
      correctMap: state.reveal.numbers,
    })),
    onCorrect: (key) => {
      state.reveal.numbers[key] = true;
      state.points += POINTS_REVEAL_SLOT;
      saveState(); updateHeader();
      revealComplete() ? celebrateComplete() : celebrateCorrect();
      renderReveal();
    },
  }));

  layout.appendChild(lists);
  body.appendChild(layout);

  if (revealComplete()) {
    const win = document.createElement('p');
    win.innerHTML = '<strong>You\'ve cracked the code!</strong> The shape on the left now shows the real labels.';
    body.insertBefore(win, layout);
  }
}

function buildRevealGroup({ heading, items, onCorrect }) {
  const group = document.createElement('div');
  group.className = 'legend-group';
  const h3 = document.createElement('h3');
  h3.textContent = heading;
  group.appendChild(h3);

  const slotsWrap = document.createElement('div');
  slotsWrap.className = 'legend-slots';
  group.appendChild(slotsWrap);

  for (const item of items) {
    const row = document.createElement('div');
    const isDone = !!item.correctMap[item.key];
    row.className = 'legend-slot' + (isDone ? ' filled correct' : '');
    item.render(row);

    if (isDone) {
      const fill = document.createElement('span');
      fill.className = 'slot-fill';
      fill.textContent = '✓';
      row.appendChild(fill);
    } else {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'reveal-input';
      input.placeholder = 'type your answer';
      input.autocomplete = 'off';
      input.spellcheck = false;
      const attempt = () => {
        const val = input.value.trim();
        if (!val) return;
        if (item.isCorrect(val)) {
          onCorrect(item.key);
        } else {
          row.classList.add('incorrect');
          setTimeout(() => row.classList.remove('incorrect'), 700);
        }
      };
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') attempt(); });
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn-secondary';
      btn.textContent = 'Check';
      btn.addEventListener('click', attempt);
      row.appendChild(input);
      row.appendChild(btn);
    }
    slotsWrap.appendChild(row);
  }

  return group;
}

// ---------------- wiring ----------------
document.getElementById('btn-start').addEventListener('click', () => {
  const name = document.getElementById('input-name').value.trim();
  const code = document.getElementById('input-code').value.trim();
  if (!name || !code) { toast('Enter a name and a class code.'); return; }
  loginAs(name, code);
});
document.getElementById('btn-switch-player').addEventListener('click', () => {
  localStorage.removeItem('stb:lastPlayer');
  player = null; state = null;
  updateHeader();
  document.getElementById('input-name').value = '';
  document.getElementById('input-code').value = '';
  showScreen('name');
});

document.querySelectorAll('.level-card').forEach(card => {
  card.addEventListener('click', () => { renderTargetGrid(); showScreen('level1'); });
});
document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', () => { renderLevelSelect(); showScreen('levels'); });
});

// ---------------- boot ----------------
(function boot() {
  const last = JSON.parse(localStorage.getItem('stb:lastPlayer') || 'null');
  if (last && last.name && last.code) {
    document.getElementById('input-name').value = last.name;
    document.getElementById('input-code').value = last.code;
    loginAs(last.name, last.code);
  } else {
    showScreen('name');
  }
})();
