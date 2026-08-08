// ---------------------------------------------------------------------------
// App orchestration: name gate, level select, Level 1 sub-levels (tutorial,
// build, and the final free-text reveal), points, and localStorage
// persistence.
// ---------------------------------------------------------------------------

const POINTS_TUTORIAL = 20;
const POINTS_TREE = 40;
const POINTS_REVEAL_SLOT = 10;
const POINTS_SENTENCE = 30;

let player = null;   // {name, code, key}
// {points, trees:[ids], sentences:[ids],
//  reveal:{shapes:{}, numbers:{}} -- current answers shown on screen, reset-able via Redo,
//  revealSolved:{shapes:{}, numbers:{}} -- permanent "ever gotten this one right" record}
let state = null;

// ---------------- storage ----------------
function storageKey(name, code) {
  return `stb:${name.trim().toLowerCase()}|${code.trim().toLowerCase()}`;
}
function defaultState() {
  return {
    points: 0, trees: [], sentences: [],
    reveal: { shapes: {}, numbers: {} },
    revealSolved: { shapes: {}, numbers: {} },
  };
}
function loadState(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaultState();
    const merged = { ...defaultState(), ...JSON.parse(raw) };
    // Backfill revealSolved from whatever's already filled in on state.reveal
    // -- covers saves from before revealSolved existed, and is a harmless
    // no-op otherwise (only ever sets true, never clears it), so a Redo's
    // reset of state.reveal can never un-solve something already earned.
    for (const k of Object.keys(CATEGORIES)) if (merged.reveal.shapes[k]) merged.revealSolved.shapes[k] = true;
    for (const n of [1, 2, 3]) if (merged.reveal.numbers[n]) merged.revealSolved.numbers[n] = true;
    return merged;
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
  level2: 'Choose a sentence below!',
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
function celebrateComplete() { mascotPulse('dancing', 1350); playChimeSound(); }

// A modal's close link turns into a big, hard-to-miss "Return to levels"
// button the moment its puzzle/sentence is actually finished -- the small
// "x close" is easy to miss (and fine while still working), but once
// there's nothing left to do, the exit should be the obvious next tap.
function setModalDoneState(btn, done) {
  if (done) {
    btn.textContent = 'Return to levels';
    btn.className = 'btn-primary btn-return';
  } else {
    btn.textContent = '× close';
    btn.className = 'link-btn';
  }
}

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
// Whether the CURRENT on-screen attempt is fully filled in -- drives the
// tree-reveal visual and the "you cracked the code" message, and resets
// (goes back to false) whenever Redo clears state.reveal.
function revealComplete() {
  return Object.keys(CATEGORIES).every(k => state.reveal.shapes[k]) && [1, 2, 3].every(n => state.reveal.numbers[n]);
}
// Whether it's EVER been fully solved -- permanent, drives Level 2's lock
// and the sub-level's own done/locked state, so a Redo (for practice) can
// never re-lock Level 2 or take back an already-earned sub-level.
function revealEverSolved() {
  return Object.keys(CATEGORIES).every(k => state.revealSolved.shapes[k]) && [1, 2, 3].every(n => state.revealSolved.numbers[n]);
}
function isSubComplete(sub) {
  return sub.kind === 'reveal' ? revealEverSolved() : state.trees.includes(sub.id);
}

// ---------------- level select ----------------
// Level 2 assumes the category system Level 1 teaches, so its card stays a
// blank "🔒 Locked" tile (same as the greyed-out roadmap ahead of it) --
// title and description included -- until every Level 1 sub-level is done.
function renderLevelSelect() {
  const doneCount = LEVEL1_SUBLEVELS.filter(isSubComplete).length;
  document.getElementById('progress-1').textContent = `${doneCount} / ${LEVEL1_SUBLEVELS.length} sub-levels done`;

  const level2Card = document.getElementById('level2-card');
  const level2Unlocked = LEVEL1_SUBLEVELS.every(isSubComplete);
  level2Card.classList.toggle('locked', !level2Unlocked);
  if (level2Unlocked) {
    const doneCount2 = LEVEL2_SUBLEVELS.filter(isL2SubComplete).length;
    level2Card.innerHTML =
      '<div class="level-num">Level 2</div>' +
      '<div class="level-title">Words</div>' +
      '<p>Drag real English words onto the pieces of an already-labeled sentence tree.</p>' +
      `<div class="level-progress">${doneCount2} / ${LEVEL2_SUBLEVELS.length} sentences done</div>`;
  } else {
    level2Card.innerHTML = '<div class="level-num">Level 2</div><div class="lock-badge">🔒 Locked</div>';
  }

  const roadmap = document.getElementById('roadmap');
  roadmap.innerHTML = '';
  ROADMAP.forEach((topic, i) => {
    const card = document.createElement('div');
    card.className = 'level-card locked';
    const num = document.createElement('div');
    num.className = 'level-num';
    num.textContent = `Level ${i + 3}`;
    card.appendChild(num);
    const lock = document.createElement('div');
    lock.className = 'lock-badge';
    lock.textContent = '🔒 Locked';
    card.appendChild(lock);
    roadmap.appendChild(card);
  });
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
  // The editor modal now fills essentially the whole viewport (16px overlay
  // padding, plus the header on top) rather than a capped-width box, so
  // these margins only need to cover that chrome, not a big unused margin.
  const availW = window.innerWidth - (isNarrow ? 24 : 40);
  const availH = window.innerHeight - (isNarrow ? 130 : 95);
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
  setModalDoneState(document.getElementById('editor-close'), false);
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
  setModalDoneState(document.getElementById('editor-close'), true);
  // Stay open on the finished puzzle -- the mascot's dance is the "you're
  // done" signal, the student closes manually whenever they're ready.
}

function openTutorialEditor(sub) {
  const items = sub.pieceIds.map(id => STRUCTURES.find(s => s.id === id));
  openEditor({
    title: sub.name,
    hint: 'Drag the two pieces together until they snap. Then tap the scissors and click the joint to pull them apart again.',
    items,
    viewW: 800, viewH: 700,
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
    viewW: 1600, viewH: 1000,
    onCheck: () => {
      const forest = editor.toForest();
      const ok = editor.nodes.length === total && forest.length === 1 && matchesPattern(forest[0], sub.root);
      if (!ok) return;
      editor.setFeedback('Complete!', 'ok');
      markSubDone(sub, POINTS_TREE);
    },
  });
}

// ================= LEVEL 2: word matching =================
function isL2SubComplete(sub) {
  return state.sentences.includes(sub.id);
}

function renderLevel2Grid() {
  const grid = document.getElementById('wordmatch-grid');
  grid.innerHTML = '';
  LEVEL2_SUBLEVELS.forEach((sub, i) => {
    const done = isL2SubComplete(sub);
    const locked = i > 0 && !isL2SubComplete(LEVEL2_SUBLEVELS[i - 1]);
    const card = document.createElement('div');
    card.className = 'target-card' + (done ? ' done' : '') + (locked ? ' locked' : '');

    const h3 = document.createElement('h3');
    h3.textContent = locked ? `${i + 1}. Locked` : `${i + 1}. ${done ? '✓ ' : ''}${sub.name}`;
    card.appendChild(h3);

    if (!locked) {
      const p = document.createElement('p');
      p.textContent = sub.description;
      card.appendChild(p);
    }

    if (locked) {
      const note = document.createElement('p');
      note.className = 'lock-note';
      note.textContent = 'Locked — finish the previous sentence first.';
      card.appendChild(note);
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn-primary';
      btn.textContent = done ? 'Rebuild' : 'Build this';
      btn.addEventListener('click', () => openWordMatch(sub));
      card.appendChild(btn);
    }
    grid.appendChild(card);
  });
}

function markL2SubDone(sub, points) {
  const already = state.sentences.includes(sub.id);
  if (!already) {
    state.sentences.push(sub.id);
    state.points += points;
    saveState();
    toast(`✓ ${sub.name} complete — +${points} pts`);
  } else {
    toast(`✓ ${sub.name} — already completed, nice practice!`);
  }
  celebrateComplete();
  updateHeader();
  renderLevel2Grid();
  setModalDoneState(document.getElementById('wordmatch-close'), true);
}

let wordMatch = null;
let currentL2Sub = null;
function ensureWordMatch() {
  if (!wordMatch) wordMatch = new WordMatchEditor(document.getElementById('wordmatch-canvas'));
  return wordMatch;
}

// Reads the sentence-so-far off the tree itself (each filled/blank word in
// its `pos` order) rather than keeping a separate copy of it, so it can
// never drift out of sync with what's actually been placed.
function renderWmSentence(root) {
  const el = document.getElementById('wordmatch-sentence');
  el.innerHTML = '';
  const tokens = [];
  (function walk(n) {
    if (n.word && n.pos) tokens.push(n);
    n.children.forEach(walk);
  })(root);
  tokens.sort((a, b) => a.pos - b.pos).forEach(n => {
    const span = document.createElement('span');
    span.className = 'wm-word' + (n._filled ? ' filled' : '');
    span.textContent = n._filled ? n.word : '_____';
    el.appendChild(span);
  });
}

function openWordMatch(sub) {
  ensureWordMatch();
  currentL2Sub = sub;
  document.getElementById('wordmatch-title').textContent = sub.name;
  setMascotSpeech(sub.hint);
  const fit = fitCanvasSize(1100, 800);
  wordMatch.open(sub.root, fit.w);
  renderWmSentence(sub.root);
  setModalDoneState(document.getElementById('wordmatch-close'), false);
  wordMatch.onPlace = () => { celebrateCorrect(); renderWmSentence(sub.root); };
  wordMatch.onComplete = () => { markL2SubDone(sub, POINTS_SENTENCE); };
  document.getElementById('wordmatch-overlay').classList.remove('hidden');
}

function closeWordMatch() {
  document.getElementById('wordmatch-overlay').classList.add('hidden');
  currentL2Sub = null;
  setMascotSpeech(SCREEN_SPEECH.level2);
}

document.getElementById('wordmatch-close').addEventListener('click', closeWordMatch);
document.getElementById('wordmatch-clear').addEventListener('click', () => {
  if (!wordMatch || !currentL2Sub) return;
  wordMatch.open(currentL2Sub.root, wordMatch.viewW);
  renderWmSentence(currentL2Sub.root);
  setModalDoneState(document.getElementById('wordmatch-close'), false);
});

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
      hint: SHAPE_HINTS[key],
    })),
    onCorrect: (key, val) => {
      state.reveal.shapes[key] = val;
      if (!state.revealSolved.shapes[key]) {
        state.revealSolved.shapes[key] = true;
        state.points += POINTS_REVEAL_SLOT;
      }
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
      hint: LEVEL_HINTS[n],
      looseNote: (val) => looseAnswerNote(n, val),
    })),
    onCorrect: (key, val) => {
      state.reveal.numbers[key] = val;
      if (!state.revealSolved.numbers[key]) {
        state.revealSolved.numbers[key] = true;
        state.points += POINTS_REVEAL_SLOT;
      }
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
    const wrap = document.createElement('div');
    wrap.className = 'legend-item';

    const row = document.createElement('div');
    const isDone = !!item.correctMap[item.key];
    row.className = 'legend-slot' + (isDone ? ' filled correct' : '');
    item.render(row);
    wrap.appendChild(row);

    if (isDone) {
      // Keep the student's own answer on screen (not just a checkmark) --
      // legacy saves from before this stored a bare `true` here, so fall
      // back to a plain check for those instead of printing "true".
      const val = item.correctMap[item.key];
      const fill = document.createElement('span');
      fill.className = 'slot-fill';
      fill.textContent = typeof val === 'string' ? `✓ ${val}` : '✓';
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
          playCorrectSound();
          const note = item.looseNote && item.looseNote(val);
          onCorrect(item.key, val);
          if (note) toast(note);
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

      if (item.hint) {
        const hintText = document.createElement('p');
        hintText.className = 'hint-text hidden';
        hintText.textContent = item.hint;

        const hintBtn = document.createElement('button');
        hintBtn.type = 'button';
        hintBtn.className = 'link-btn hint-btn';
        hintBtn.textContent = 'Hint';
        hintBtn.addEventListener('click', () => {
          hintText.classList.remove('hidden');
          hintBtn.classList.add('hidden');
        });
        row.appendChild(hintBtn);
        wrap.appendChild(hintText);
      }
    }
    slotsWrap.appendChild(wrap);
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

document.getElementById('btn-redo-reveal').addEventListener('click', () => {
  // Only resets the CURRENT on-screen attempt -- revealSolved (points,
  // Level 2's unlock) is untouched, same as "Rebuild" elsewhere never
  // takes back an already-earned sub-level.
  state.reveal = { shapes: {}, numbers: {} };
  saveState();
  renderReveal();
});

document.querySelectorAll('.level-card[data-level]').forEach(card => {
  card.addEventListener('click', () => {
    if (card.classList.contains('locked')) return;
    if (card.dataset.level === '2') { renderLevel2Grid(); showScreen('level2'); }
    else { renderTargetGrid(); showScreen('level1'); }
  });
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
