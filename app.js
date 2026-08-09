// ---------------------------------------------------------------------------
// App orchestration: name gate, mode select, level select, Level 1
// sub-levels (tutorial, build, and the final free-text reveal), the Level
// 2-4 games, points, and localStorage persistence.
// ---------------------------------------------------------------------------

const POINTS_TUTORIAL = 20;
const POINTS_TREE = 40;
const POINTS_REVEAL_SLOT = 10;
const POINTS_SENTENCE = 30;
const POINTS_STREAK_COMPLETE = 50;

let player = null;   // {name, code, key}
// { points, modes: { <modeId>: {
//     trees:[ids], sentences:[ids], constituency:[ids], categoryid:[ids],
//     reveal:{shapes:{}, numbers:{}}        -- current answers on screen, reset-able via Redo,
//     revealSolved:{shapes:{}, numbers:{}}  -- permanent "ever gotten this right" record
//   } } }
// Points are deliberately shared across modes (one running total for the
// student); everything else is per-mode, so working through Tree Basics
// doesn't mark X-bar as done or vice versa.
let state = null;

// ---------------- storage ----------------
function storageKey(name, code) {
  return `stb:${name.trim().toLowerCase()}|${code.trim().toLowerCase()}`;
}
function defaultModeProgress() {
  return {
    trees: [], sentences: [], constituency: [], categoryid: [],
    reveal: { shapes: {}, numbers: {} },
    revealSolved: { shapes: {}, numbers: {} },
  };
}
function defaultState() {
  return { points: 0, modes: {} };
}

function normalizeModeProgress(src = {}) {
  const base = defaultModeProgress();
  return {
    trees: Array.isArray(src.trees) ? src.trees : base.trees,
    sentences: Array.isArray(src.sentences) ? src.sentences : base.sentences,
    constituency: Array.isArray(src.constituency) ? src.constituency : base.constituency,
    categoryid: Array.isArray(src.categoryid) ? src.categoryid : base.categoryid,
    reveal: {
      shapes: { ...(src.reveal?.shapes || {}) },
      numbers: { ...(src.reveal?.numbers || {}) },
    },
    revealSolved: {
      shapes: { ...(src.revealSolved?.shapes || {}) },
      numbers: { ...(src.revealSolved?.numbers || {}) },
    },
  };
}

function loadState(key) {
  const st = defaultState();
  let parsed = null;
  try {
    const raw = localStorage.getItem(key);
    parsed = raw ? JSON.parse(raw) : null;
  } catch { parsed = null; }

  if (parsed) st.points = Number(parsed.points) || 0;
  // Saves written before modes existed have their progress lists sitting at
  // the top level, and everything in them was X-bar -- that was the only
  // thing the game had. Fold them into the X-bar slot so nobody loses a
  // completed playthrough to this change.
  const legacy = parsed && !parsed.modes ? parsed : null;
  for (const id of MODE_IDS) {
    const src = (parsed && parsed.modes && parsed.modes[id]) || (id === 'xbar' ? legacy : null);
    const prog = normalizeModeProgress(src || {});
    // Backfill revealSolved from whatever's filled in on reveal -- covers
    // saves from before revealSolved existed, and is a harmless no-op
    // otherwise (only ever sets true, never clears), so a Redo's reset of
    // reveal can never un-solve something already earned.
    for (const k of Object.keys(prog.reveal.shapes)) if (prog.reveal.shapes[k]) prog.revealSolved.shapes[k] = true;
    for (const n of Object.keys(prog.reveal.numbers)) if (prog.reveal.numbers[n]) prog.revealSolved.numbers[n] = true;
    st.modes[id] = prog;
  }
  return st;
}
function saveState() {
  localStorage.setItem(player.key, JSON.stringify(state));
}
// Progress for whichever mode is currently active.
function prog() {
  if (!state.modes[MODE.id]) state.modes[MODE.id] = defaultModeProgress();
  return state.modes[MODE.id];
}

// ---------------- navigation / browser back button ----------------
// On a phone, the system back gesture is the instinctive "get me out of
// here" -- and without this it left the site entirely from the middle of a
// puzzle. Every forward step registers an undo, so back always walks one
// step back through the app instead.
const navStack = [];
function pushNav(undo) {
  navStack.push(undo);
  history.pushState({ depth: navStack.length }, '');
}
// Every close/back control in the UI routes through here rather than
// closing things directly, so our stack and the browser's history can't
// drift apart.
function navBack() {
  if (navStack.length) history.back();
}
function resetNav() {
  navStack.length = 0;
}
window.addEventListener('popstate', () => {
  const undo = navStack.pop();
  if (undo) undo();
});

// ---------------- screens ----------------
const SCREEN_SPEECH = {
  name: "Hi! What's your name?",
  levels: 'Pick a level to start!',
  level1: 'Choose a sub-level below!',
  level2: 'Choose a sentence below!',
  level3: 'Choose a sub-level below!',
  level4: 'Choose a sub-level below!',
  reveal: 'Type what you think each shape and number means!',
};
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById('screen-' + id).classList.remove('hidden');
  if (SCREEN_SPEECH[id]) setMascotSpeech(SCREEN_SPEECH[id]);
  window.scrollTo(0, 0);
}

function gotoLevels() { renderLevelSelect(); showScreen('levels'); }

// Which version of the game this page is: read once, from the URL. Two
// URLs rather than an in-app chooser, because a chooser has to describe
// the versions to be useful and the descriptions ("phrase", "head",
// "bar", DP/D′/D⁰) are precisely the Mystery Level's answers.
//   index.html              -> Tree Basics
//   index.html?mode=xbar    -> X-bar
// Both live on the same origin, so a student's saved points and progress
// follow them across both without anything extra.
function modeIdFromUrl() {
  const requested = new URLSearchParams(location.search).get('mode');
  return MODE_IDS.includes(requested) ? requested : DEFAULT_MODE_ID;
}
function urlForMode(id) {
  return location.pathname + (id === DEFAULT_MODE_ID ? '' : '?mode=' + id);
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('hidden'), 2600);
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

// A modal's close link turns into a big, hard-to-miss button the moment its
// puzzle/sentence is actually finished -- the small "x close" is easy to
// miss (and fine while still working), but once there's nothing left to do,
// the exit should be the obvious next tap.
function setModalDoneState(btn, done) {
  if (done) {
    btn.textContent = 'Done — back to the list';
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
  syncMascotBarHeight();
}

// The mascot bar's actual rendered height (which varies with how long its
// current text is) feeds --mascot-bar-h, which main and .overlay use to
// reserve exactly that much space at the bottom of the screen -- so
// nothing else ever needs to know or care how tall the bar currently is.
function syncMascotBarHeight() {
  const el = document.querySelector('.mascot-wrap');
  if (!el) return;
  document.documentElement.style.setProperty('--mascot-bar-h', el.offsetHeight + 'px');
}
window.addEventListener('resize', syncMascotBarHeight);

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
  resetNav();
  gotoLevels();
}

// ---------------- confirm dialog ----------------
// Start over and switch player both used to destroy work on a single
// mis-tap with no warning. A native confirm() would prevent that, but it
// renders as a browser-chrome security prompt ("this site says…"), which is
// exactly the sort of thing that makes a nervous user bail out of the page.
let confirmResolver = null;
function askConfirm({ title, message, okLabel = 'Yes', cancelLabel = 'No, go back' }) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-ok').textContent = okLabel;
  document.getElementById('confirm-cancel').textContent = cancelLabel;
  document.getElementById('confirm-overlay').classList.remove('hidden');
  return new Promise(resolve => { confirmResolver = resolve; });
}
function settleConfirm(answer) {
  document.getElementById('confirm-overlay').classList.add('hidden');
  const resolve = confirmResolver;
  confirmResolver = null;
  if (resolve) resolve(answer);
}
document.getElementById('confirm-ok').addEventListener('click', () => settleConfirm(true));
document.getElementById('confirm-cancel').addEventListener('click', () => settleConfirm(false));

// ---------------- how to play ----------------
// Every screen with a gesture in it gets a plain-language explanation on
// demand. The mascot bubble carries a one-line hint, but it's small, it
// fades, and it gets replaced -- there was nowhere to look things up if you
// missed it the first time.
const CANVAS_HELP = `
  <li><strong>Lost the pieces?</strong> Tap <strong>Fit</strong> at the bottom-right of the
      canvas. That always brings everything back into view, however far off you've wandered.</li>
  <li>Drag the <em>empty space</em> between pieces to move the whole canvas around.
      Use <strong>−</strong> and <strong>+</strong> to zoom.</li>`;
const HELP = {
  general: {
    title: 'How Shapes works',
    html: `<ul>
      <li>Work through the levels in order. Each one unlocks when you finish the one before it.</li>
      <li>Your points are saved automatically on this device, under your name and class code.
          You can close the page at any time and pick up where you left off.</li>
      <li><strong>Nothing you do here can break anything.</strong> If something goes wrong,
          close the puzzle and open it again — you'll never lose points you've already earned.</li>
      <li>Tap <strong>🔊</strong> at the top of the screen to turn the sounds off.</li>
      <li>Tap <strong>?</strong> on any screen for help with that screen.</li>
    </ul>`,
  },
  editor: {
    title: 'Level 1 — Shapes',
    html: `<ul>
      <li>Drag one piece onto another. If they belong together they <strong>snap</strong>,
          and you'll see the target piece glow green just before they do.</li>
      <li>Two pieces only join if their <strong>shape and number both match</strong>, and one of
          them has an empty branch free. If a drop doesn't work, the message at the top says why.</li>
      <li>The <strong>✂️ scissors</strong> button pulls a joint apart again: tap the scissors,
          then tap a piece outlined in red. Tap empty canvas to cancel.</li>
      ${CANVAS_HELP}
      <li><strong>Start over</strong> scatters the pieces again from scratch. It asks first.</li>
    </ul>`,
  },
  wordmatch: {
    title: 'Level 2 — Words',
    html: `<ul>
      <li>One word at a time appears in the bottom-left corner. Drag it onto the piece it belongs to.</li>
      <li>Wrong piece? The word shakes and bounces back — nothing is lost, just try another piece.</li>
      <li>Stuck on a word? Tap <strong>Skip this word</strong> and it goes to the back of the queue.</li>
      <li>A piece marked <strong>∅</strong> has no word at all, so it's never a target.</li>
      ${CANVAS_HELP}
    </ul>`,
  },
  quiz3: {
    title: 'Level 3 — Constituents',
    html: `<ul>
      <li>Some words in the sentence are highlighted. Answer whether that highlighted string is
          a <strong>constituent</strong> — everything that hangs under one single piece of the tree,
          with nothing left over.</li>
      <li>The tree below is there to check against. Scroll and zoom it as much as you like.</li>
      <li>Right answers build your streak; a wrong one sends it back to zero, so it's worth
          checking the tree rather than guessing.</li>
      <li>After a wrong answer the explanation stays up until you tap <strong>Next question</strong>.</li>
      ${CANVAS_HELP}
    </ul>`,
  },
  quiz4: {
    title: 'Level 4 — Categories',
    html: `<ul>
      <li>Some words are highlighted. Tap the sticker for the <strong>category</strong> that
          highlighted piece is.</li>
      <li>Each category has two stickers: the <strong>top row is the whole phrase</strong>,
          the <strong>bottom row is the single word</strong>. One highlighted word means
          you want the bottom row.</li>
      <li>After a wrong answer the explanation stays up until you tap <strong>Next question</strong>.</li>
      ${CANVAS_HELP}
    </ul>`,
  },
};
function openHelp(key) {
  const entry = HELP[key] || HELP.general;
  document.getElementById('help-title').textContent = entry.title;
  document.getElementById('help-body').innerHTML = entry.html;
  document.getElementById('help-overlay').classList.remove('hidden');
}
function closeHelp() {
  document.getElementById('help-overlay').classList.add('hidden');
}
document.getElementById('help-close').addEventListener('click', closeHelp);
document.getElementById('btn-help').addEventListener('click', () => {
  // The generic panel from the header; modals pass their own key.
  openHelp('general');
});
document.querySelectorAll('[data-help]').forEach(btn => {
  btn.addEventListener('click', (ev) => { ev.stopPropagation(); openHelp(btn.dataset.help); });
});
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (!document.getElementById('help-overlay').classList.contains('hidden')) { closeHelp(); return; }
  if (!document.getElementById('confirm-overlay').classList.contains('hidden')) settleConfirm(false);
});

// ---------------- sound toggle ----------------
function renderSoundButton() {
  const btn = document.getElementById('btn-sound');
  const muted = isSoundMuted();
  btn.textContent = muted ? '🔇' : '🔊';
  btn.title = muted ? 'Turn sound on' : 'Turn sound off';
  btn.setAttribute('aria-label', btn.title);
  // Deliberately not the .active (red) treatment the scissors button uses --
  // muted is a preference, not an error state.
  btn.classList.toggle('btn-icon-off', muted);
}
document.getElementById('btn-sound').addEventListener('click', () => {
  setSoundMuted(!isSoundMuted());
  renderSoundButton();
  toast(isSoundMuted() ? 'Sound off' : 'Sound on');
  if (!isSoundMuted()) playCorrectSound();
});

// ---------------- sub-level completion ----------------
// Whether the CURRENT on-screen attempt is fully filled in -- drives the
// tree-reveal visual and the "you cracked the code" message, and resets
// (goes back to false) whenever Redo clears reveal.
function revealComplete() {
  const p = prog();
  return Object.keys(CATEGORIES).every(k => p.reveal.shapes[k]) && LEVEL_NUMBERS.every(n => p.reveal.numbers[n]);
}
// Whether it's EVER been fully solved -- permanent, drives Level 2's lock
// and the sub-level's own done/locked state, so a Redo (for practice) can
// never re-lock Level 2 or take back an already-earned sub-level.
function revealEverSolved() {
  const p = prog();
  return Object.keys(CATEGORIES).every(k => p.revealSolved.shapes[k]) && LEVEL_NUMBERS.every(n => p.revealSolved.numbers[n]);
}
function isSubComplete(sub) {
  return sub.kind === 'reveal' ? revealEverSolved() : prog().trees.includes(sub.id);
}

// ---------------- the other version ----------------
// Nothing about the other version is mentioned until the Mystery Level in
// THIS one has been solved. Before that, saying "there's also a version
// with a bar level in it" would hand over two of the answers; after it,
// the category system is common knowledge and pointing at the next step
// is just useful. Rendered as a real link so it can be bookmarked, copied
// and handed out by a teacher.
function renderModeSwitch() {
  const wrap = document.getElementById('levels-switch');
  wrap.innerHTML = '';
  const otherId = MODE_IDS.find(id => id !== MODE.id);
  if (!otherId || !revealEverSolved()) { wrap.classList.add('hidden'); return; }
  wrap.classList.remove('hidden');

  const other = MODES[otherId];
  const p = state.modes[otherId] || defaultModeProgress();
  const started = p.trees.length || p.sentences.length ||
    Object.keys(p.revealSolved.shapes).length;

  const heading = document.createElement('h2');
  heading.textContent = 'Another version to try';
  wrap.appendChild(heading);

  const link = document.createElement('a');
  link.className = 'mode-switch-card';
  link.href = urlForMode(otherId);
  link.innerHTML =
    `<div class="level-num">${other.tagline}</div>` +
    `<div class="level-title">${other.name}</div>` +
    `<p>${other.blurb}</p>` +
    `<div class="level-progress">${started ? 'In progress — your points come with you' : 'Not started yet'}</div>`;
  wrap.appendChild(link);

  const note = document.createElement('p');
  note.className = 'muted small';
  note.textContent = `You're playing ${MODE.name}. Progress in each version is kept separately; your points are shared.`;
  wrap.appendChild(note);
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

  const level3Card = document.getElementById('level3-card');
  const level3Unlocked = level2Unlocked && LEVEL2_SUBLEVELS.every(isL2SubComplete);
  level3Card.classList.toggle('locked', !level3Unlocked);
  if (level3Unlocked) {
    const doneCount3 = QUIZ_SUBLEVELS.filter(isL3SubComplete).length;
    level3Card.innerHTML =
      '<div class="level-num">Level 3</div>' +
      '<div class="level-title">Constituents</div>' +
      '<p>Is this string of words a constituent? Prove it with a run of correct answers.</p>' +
      `<div class="level-progress">${doneCount3} / ${QUIZ_SUBLEVELS.length} sub-levels done</div>`;
  } else {
    level3Card.innerHTML = '<div class="level-num">Level 3</div><div class="lock-badge">🔒 Locked</div>';
  }

  const level4Card = document.getElementById('level4-card');
  const level4Unlocked = level3Unlocked && QUIZ_SUBLEVELS.every(isL3SubComplete);
  level4Card.classList.toggle('locked', !level4Unlocked);
  if (level4Unlocked) {
    const doneCount4 = QUIZ_SUBLEVELS.filter(isL4SubComplete).length;
    level4Card.innerHTML =
      '<div class="level-num">Level 4</div>' +
      '<div class="level-title">Categories</div>' +
      '<p>Click the category sticker that matches the highlighted constituent.</p>' +
      `<div class="level-progress">${doneCount4} / ${QUIZ_SUBLEVELS.length} sub-levels done</div>`;
  } else {
    level4Card.innerHTML = '<div class="level-num">Level 4</div><div class="lock-badge">🔒 Locked</div>';
  }

  const roadmap = document.getElementById('roadmap');
  roadmap.innerHTML = '';
  ROADMAP.forEach((topic, i) => {
    const card = document.createElement('div');
    card.className = 'level-card locked';
    const num = document.createElement('div');
    num.className = 'level-num';
    num.textContent = `Level ${i + 5}`;
    card.appendChild(num);
    const lock = document.createElement('div');
    lock.className = 'lock-badge';
    lock.textContent = '🔒 Locked';
    card.appendChild(lock);
    roadmap.appendChild(card);
  });

  renderModeSwitch();
}

// What a locked level is waiting for -- said out loud, because a tap that
// does literally nothing reads as a broken button.
function lockedLevelReason(level) {
  if (level === 2) return 'Level 2 unlocks when all of Level 1 is done — including the Mystery Level.';
  if (level === 3) return 'Level 3 unlocks when every Level 2 sentence is done.';
  if (level === 4) return 'Level 4 unlocks when every Level 3 sub-level is done.';
  return 'Finish the previous level first.';
}

// ---------------- shared editor modal ----------------
let editor = null;
let activeCheck = null;  // function() -> void, checked automatically after every move
let currentItems = null; // flat list of STRUCTURES items for the open sub-level, so Start over can re-scatter them

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
  pushNav(closeEditor);
}

function closeEditor() {
  document.getElementById('editor-overlay').classList.add('hidden');
  activeCheck = null;
  setMascotSpeech(SCREEN_SPEECH.level1);
}

document.getElementById('editor-close').addEventListener('click', navBack);
document.getElementById('editor-clear').addEventListener('click', async () => {
  if (!editor || !currentItems) return;
  // Only worth interrupting them over if there's actually something to
  // lose -- a confirm on an untouched puzzle is just noise.
  if (editor.snapCount > 0) {
    const ok = await askConfirm({
      title: 'Start this puzzle over?',
      message: 'The pieces you\'ve joined will come apart and be scattered again. Your points are safe either way.',
      okLabel: 'Yes, start over',
    });
    if (!ok) return;
  }
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
        else { renderReveal(); pushNav(() => { renderTargetGrid(); showScreen('level1'); }); showScreen('reveal'); }
      });
      card.appendChild(btn);
    }
    grid.appendChild(card);
  });
}

function markSubDone(sub, points) {
  const already = prog().trees.includes(sub.id);
  if (!already) {
    prog().trees.push(sub.id);
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
  return prog().sentences.includes(sub.id);
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
  const already = prog().sentences.includes(sub.id);
  if (!already) {
    prog().sentences.push(sub.id);
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

function setWmFeedback(msg, kind) {
  const el = document.getElementById('wordmatch-feedback');
  el.textContent = msg || '';
  el.className = 'wm-feedback' + (kind ? ' ' + kind : '');
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
  wordMatch.open(sub.root, fit.w, fit.h);
  renderWmSentence(sub.root);
  setWmFeedback('');
  setModalDoneState(document.getElementById('wordmatch-close'), false);
  wordMatch.onPlace = () => { celebrateCorrect(); setWmFeedback('Nice — that one fits.', 'ok'); renderWmSentence(sub.root); };
  wordMatch.onReject = (msg) => setWmFeedback(msg);
  wordMatch.onComplete = () => { markL2SubDone(sub, POINTS_SENTENCE); };
  document.getElementById('wordmatch-overlay').classList.remove('hidden');
  pushNav(closeWordMatch);
}

function closeWordMatch() {
  document.getElementById('wordmatch-overlay').classList.add('hidden');
  // The floating word chip lives outside the modal box, so it has to be
  // put away explicitly or it hangs over the level list after closing.
  if (wordMatch) wordMatch.chipEl.classList.add('hidden');
  currentL2Sub = null;
  setMascotSpeech(SCREEN_SPEECH.level2);
}

document.getElementById('wordmatch-close').addEventListener('click', navBack);
document.getElementById('wordmatch-clear').addEventListener('click', async () => {
  if (!wordMatch || !currentL2Sub) return;
  const placed = wordMatch.slotNodes.filter(n => n._filled).length;
  if (placed > 0) {
    const ok = await askConfirm({
      title: 'Start this sentence over?',
      message: `You'll lose the ${placed} word${placed === 1 ? '' : 's'} you've already placed. Your points are safe either way.`,
      okLabel: 'Yes, start over',
    });
    if (!ok) return;
  }
  wordMatch.open(currentL2Sub.root, wordMatch.viewW, wordMatch.viewH);
  renderWmSentence(currentL2Sub.root);
  setWmFeedback('');
  setModalDoneState(document.getElementById('wordmatch-close'), false);
});
document.getElementById('wordmatch-skip').addEventListener('click', () => {
  if (!wordMatch) return;
  if (wordMatch.skipCurrentWord()) setWmFeedback('Skipped — that word will come back around.', 'ok');
  else setWmFeedback('That\'s the last word left, so there\'s nothing to skip to.');
});

// ================= LEVEL 3: constituency yes/no =================
function isL3SubComplete(sub) {
  return prog().constituency.includes(sub.id);
}

function renderConstituencyGrid() {
  const grid = document.getElementById('constituency-grid');
  grid.innerHTML = '';
  QUIZ_SUBLEVELS.forEach((sub, i) => {
    const done = isL3SubComplete(sub);
    const locked = i > 0 && !isL3SubComplete(QUIZ_SUBLEVELS[i - 1]);
    const card = document.createElement('div');
    card.className = 'target-card' + (done ? ' done' : '') + (locked ? ' locked' : '');

    const h3 = document.createElement('h3');
    h3.textContent = locked ? `${i + 1}. Locked` : `${i + 1}. ${done ? '✓ ' : ''}${sub.name}`;
    card.appendChild(h3);

    if (!locked) {
      const p = document.createElement('p');
      p.textContent = `"${sub.sentence}"`;
      card.appendChild(p);
    }

    if (locked) {
      const note = document.createElement('p');
      note.className = 'lock-note';
      note.textContent = 'Locked — finish the previous sub-level first.';
      card.appendChild(note);
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn-primary';
      btn.textContent = done ? 'Practice again' : 'Start';
      btn.addEventListener('click', () => openConstituencyQuiz(sub));
      card.appendChild(btn);
    }
    grid.appendChild(card);
  });
}

function markL3SubDone(sub) {
  const already = prog().constituency.includes(sub.id);
  if (!already) {
    prog().constituency.push(sub.id);
    state.points += POINTS_STREAK_COMPLETE;
    saveState();
    toast(`✓ ${sub.name} complete — +${POINTS_STREAK_COMPLETE} pts`);
  } else {
    toast(`✓ ${sub.name} — already completed, nice practice!`);
  }
  celebrateComplete();
  updateHeader();
  renderConstituencyGrid();
  setModalDoneState(document.getElementById('constituency-close'), true);
}

let constituencyViewer = null;
let currentL3Sub = null;
let l3Game = null;
let l3CurrentQuestion = null; // {span: {start,end}, isConstituent}
let l3AdvanceTimer = null;    // pending "load next question" timeout

function ensureConstituencyViewer() {
  if (!constituencyViewer) constituencyViewer = new TreeViewer(document.getElementById('constituency-canvas'));
  return constituencyViewer;
}

// Shared by Level 3 and Level 4 -- `prefix` is 'constituency' or the Level 4
// modal's id prefix ('categoryid'), each with its own -streak-fill/-label.
// Reads the target off the game itself, not a flat constant, since it
// varies per sub-level.
function renderStreakBar(prefix, game) {
  const fill = document.getElementById(`${prefix}-streak-fill`);
  const label = document.getElementById(`${prefix}-streak-label`);
  fill.style.width = `${Math.round(game.streak / game.target * 100)}%`;
  label.textContent = `${game.streak} / ${game.target} in a row — ${game.multiplier()}x bonus`;
}

function renderQuizSentence(elId, tokens, span) {
  const el = document.getElementById(elId);
  el.innerHTML = '';
  tokens.forEach(t => {
    const word = document.createElement('span');
    word.className = 'quiz-word' + (t.pos >= span.start && t.pos <= span.end ? ' highlighted' : '');
    word.textContent = t.word;
    el.appendChild(word);
  });
}

// After a wrong answer the answer controls are swapped for a Next button,
// so the explanation of what the right answer was stays on screen until
// it's actually been read. Correct answers still auto-advance.
function setQuizAwaitingNext(prefix, awaiting) {
  const panel = document.getElementById(`${prefix}-overlay`);
  const next = document.getElementById(`${prefix}-next`);
  next.classList.toggle('hidden', !awaiting);
  const answers = panel.querySelector('.quiz-answer-row') || panel.querySelector('.quiz-category-matrix');
  if (answers) answers.classList.toggle('hidden', awaiting);
}

function nextConstituencyQuestion() {
  setQuizAwaitingNext('constituency', false);
  const pools = currentL3Sub.pools;
  const wantConstituent = Math.random() < 0.5;
  // Every QUIZ_SUBLEVELS tree has both pools non-empty -- any sentence
  // short enough to have no non-constituent spans at all was excluded from
  // this level entirely.
  const pool = wantConstituent ? pools.constituents : pools.nonConstituents;
  const span = pool[Math.floor(Math.random() * pool.length)];
  l3CurrentQuestion = { span, isConstituent: wantConstituent };
  renderQuizSentence('constituency-sentence', pools.tokens, span);
  const feedback = document.getElementById('constituency-feedback');
  feedback.textContent = '';
  feedback.className = 'quiz-feedback';
}

// Correct answers get just enough of a beat to see the "+N pts" land.
const QUIZ_CORRECT_DELAY_MS = 900;

function answerConstituencyQuestion(saidYes) {
  if (!l3CurrentQuestion) return;
  clearTimeout(l3AdvanceTimer);
  const question = l3CurrentQuestion;
  l3CurrentQuestion = null; // blocks re-answering the same question during the feedback delay
  const correct = saidYes === question.isConstituent;
  const result = l3Game.answer(correct);
  state.points = Math.max(0, state.points + result.pointsDelta);
  saveState(); updateHeader();
  renderStreakBar('constituency', l3Game);

  const feedback = document.getElementById('constituency-feedback');
  if (correct) {
    feedback.textContent = `Correct! ${result.pointsDelta >= 0 ? '+' : ''}${result.pointsDelta} pts`;
    feedback.className = 'quiz-feedback ok';
    playCorrectSound();
    if (!result.complete) celebrateCorrect();
  } else {
    feedback.textContent = `Not quite — that ${question.isConstituent ? 'IS' : "isn't"} a constituent. ${result.pointsDelta} pts`;
    feedback.className = 'quiz-feedback err';
    playWrongSound();
  }

  if (result.complete) {
    markL3SubDone(currentL3Sub);
    return;
  }
  if (correct) l3AdvanceTimer = setTimeout(nextConstituencyQuestion, QUIZ_CORRECT_DELAY_MS);
  else setQuizAwaitingNext('constituency', true);
}

function openConstituencyQuiz(sub) {
  ensureConstituencyViewer();
  currentL3Sub = sub;
  l3Game = new StreakGame(sub.streakTarget);
  document.getElementById('constituency-title').textContent = sub.name;
  setMascotSpeech(`Is the highlighted string of words a constituent -- the whole yield of some single piece? ${sub.streakTarget} in a row to finish.`);
  const fit = fitCanvasSize(1100, 800);
  constituencyViewer.open(sub.root, fit.w, fit.h);
  renderStreakBar('constituency', l3Game);
  setModalDoneState(document.getElementById('constituency-close'), false);
  nextConstituencyQuestion();
  document.getElementById('constituency-overlay').classList.remove('hidden');
  pushNav(closeConstituencyQuiz);
}

function closeConstituencyQuiz() {
  clearTimeout(l3AdvanceTimer);
  document.getElementById('constituency-overlay').classList.add('hidden');
  currentL3Sub = null;
  l3CurrentQuestion = null;
  setMascotSpeech(SCREEN_SPEECH.level3);
}

document.getElementById('constituency-close').addEventListener('click', navBack);
document.getElementById('constituency-yes').addEventListener('click', () => answerConstituencyQuestion(true));
document.getElementById('constituency-no').addEventListener('click', () => answerConstituencyQuestion(false));
document.getElementById('constituency-next').addEventListener('click', nextConstituencyQuestion);

// ================= LEVEL 4: category ID =================
function isL4SubComplete(sub) {
  return prog().categoryid.includes(sub.id);
}

function renderCategoryIdGrid() {
  const grid = document.getElementById('categoryid-grid');
  grid.innerHTML = '';
  QUIZ_SUBLEVELS.forEach((sub, i) => {
    const done = isL4SubComplete(sub);
    const locked = i > 0 && !isL4SubComplete(QUIZ_SUBLEVELS[i - 1]);
    const card = document.createElement('div');
    card.className = 'target-card' + (done ? ' done' : '') + (locked ? ' locked' : '');

    const h3 = document.createElement('h3');
    h3.textContent = locked ? `${i + 1}. Locked` : `${i + 1}. ${done ? '✓ ' : ''}${sub.name}`;
    card.appendChild(h3);

    if (!locked) {
      const p = document.createElement('p');
      p.textContent = `"${sub.sentence}"`;
      card.appendChild(p);
    }

    if (locked) {
      const note = document.createElement('p');
      note.className = 'lock-note';
      note.textContent = 'Locked — finish the previous sub-level first.';
      card.appendChild(note);
    } else {
      const btn = document.createElement('button');
      btn.className = 'btn-primary';
      btn.textContent = done ? 'Practice again' : 'Start';
      btn.addEventListener('click', () => openCategoryQuiz(sub));
      card.appendChild(btn);
    }
    grid.appendChild(card);
  });
}

function markL4SubDone(sub) {
  const already = prog().categoryid.includes(sub.id);
  if (!already) {
    prog().categoryid.push(sub.id);
    state.points += POINTS_STREAK_COMPLETE;
    saveState();
    toast(`✓ ${sub.name} complete — +${POINTS_STREAK_COMPLETE} pts`);
  } else {
    toast(`✓ ${sub.name} — already completed, nice practice!`);
  }
  celebrateComplete();
  updateHeader();
  renderCategoryIdGrid();
  setModalDoneState(document.getElementById('categoryid-close'), true);
}

let categoryViewer = null;
let currentL4Sub = null;
let l4Game = null;
let l4Pool = null;            // the concatenated question pool for the open sub-level
let l4CurrentQuestion = null; // {span: {start,end,shape}, shape, isHead}
let l4AdvanceTimer = null;    // pending "load next question" timeout

function ensureCategoryViewer() {
  if (!categoryViewer) categoryViewer = new TreeViewer(document.getElementById('categoryid-canvas'));
  return categoryViewer;
}

// Always every category, every sub-level -- not scaffolded down to just
// whatever's in the current sentence, since by Level 4 the whole system has
// already been taught. TWO stickers per category -- phrase-level and
// head-level -- since questions are drawn from both pools; offering only
// the phrase-level sticker would leave head-level questions (like a single
// "the") with no correct option to pick. Which numbers those two levels
// are is mode-dependent: 1 and 3 in X-bar, 1 and 2 in Tree Basics.
function buildCategoryMatrix() {
  const matrix = document.getElementById('categoryid-matrix');
  matrix.innerHTML = '';
  Object.keys(CATEGORIES).forEach(key => {
    [{ isHead: false, level: PHRASE_NUMBER }, { isHead: true, level: HEAD_NUMBER }].forEach(({ isHead, level }) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'quiz-sticker';
      btn.title = `${CATEGORIES[key].name} (${isHead ? 'head' : 'phrase'})`;
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('viewBox', '-30 -30 60 60');
      svg.appendChild(buildShapeGroup(key, nodeLabel(key, level), 26));
      btn.appendChild(svg);
      btn.addEventListener('click', () => answerCategoryQuestion(key, isHead));
      matrix.appendChild(btn);
    });
  });
}

function nextCategoryQuestion() {
  setQuizAwaitingNext('categoryid', false);
  const pools = currentL4Sub.pools;
  const span = l4Pool[Math.floor(Math.random() * l4Pool.length)];
  l4CurrentQuestion = { span, shape: span.shape, isHead: span.start === span.end };
  renderQuizSentence('categoryid-sentence', pools.tokens, span);
  const feedback = document.getElementById('categoryid-feedback');
  feedback.textContent = '';
  feedback.className = 'quiz-feedback';
}

function answerCategoryQuestion(chosenShape, chosenIsHead) {
  if (!l4CurrentQuestion) return;
  clearTimeout(l4AdvanceTimer);
  const question = l4CurrentQuestion;
  l4CurrentQuestion = null; // blocks re-answering the same question during the feedback delay
  const correct = chosenShape === question.shape && chosenIsHead === question.isHead;
  const result = l4Game.answer(correct);
  state.points = Math.max(0, state.points + result.pointsDelta);
  saveState(); updateHeader();
  renderStreakBar('categoryid', l4Game);

  const feedback = document.getElementById('categoryid-feedback');
  const answerLabel = nodeLabel(question.shape, question.isHead ? HEAD_NUMBER : PHRASE_NUMBER);
  if (correct) {
    feedback.textContent = `Correct! ${result.pointsDelta >= 0 ? '+' : ''}${result.pointsDelta} pts`;
    feedback.className = 'quiz-feedback ok';
    playCorrectSound();
    if (!result.complete) celebrateCorrect();
  } else {
    feedback.textContent = `Not quite — that's ${CATEGORIES[question.shape].name} (${answerLabel}). ${result.pointsDelta} pts`;
    feedback.className = 'quiz-feedback err';
    playWrongSound();
  }

  if (result.complete) {
    markL4SubDone(currentL4Sub);
    return;
  }
  if (correct) l4AdvanceTimer = setTimeout(nextCategoryQuestion, QUIZ_CORRECT_DELAY_MS);
  else setQuizAwaitingNext('categoryid', true);
}

function openCategoryQuiz(sub) {
  ensureCategoryViewer();
  currentL4Sub = sub;
  // Phrase-level (2+ words) and head-level (single word) constituents both
  // count as fair game here -- every entry in either pool is a genuine
  // constituent, just at a different projection level.
  l4Pool = sub.pools.constituents.concat(sub.pools.headConstituents);
  // Never demand a longer streak than the sentence has distinct questions
  // to ask: a short sentence would otherwise be guaranteed to repeat
  // itself before the streak could ever be finished.
  const target = Math.min(sub.streakTarget, l4Pool.length);
  l4Game = new StreakGame(target);
  document.getElementById('categoryid-title').textContent = sub.name;
  setMascotSpeech(`Click the category sticker that matches the highlighted constituent. ${target} in a row to finish.`);
  buildCategoryMatrix();
  const fit = fitCanvasSize(1100, 800);
  categoryViewer.open(sub.root, fit.w, fit.h);
  renderStreakBar('categoryid', l4Game);
  setModalDoneState(document.getElementById('categoryid-close'), false);
  nextCategoryQuestion();
  document.getElementById('categoryid-overlay').classList.remove('hidden');
  pushNav(closeCategoryQuiz);
}

function closeCategoryQuiz() {
  clearTimeout(l4AdvanceTimer);
  document.getElementById('categoryid-overlay').classList.add('hidden');
  currentL4Sub = null;
  l4CurrentQuestion = null;
  setMascotSpeech(SCREEN_SPEECH.level4);
}

document.getElementById('categoryid-close').addEventListener('click', navBack);
document.getElementById('categoryid-next').addEventListener('click', nextCategoryQuestion);

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
      correctMap: prog().reveal.shapes,
      hint: SHAPE_HINTS[key],
    })),
    onCorrect: (key, val) => {
      prog().reveal.shapes[key] = val;
      if (!prog().revealSolved.shapes[key]) {
        prog().revealSolved.shapes[key] = true;
        state.points += POINTS_REVEAL_SLOT;
      }
      saveState(); updateHeader();
      revealComplete() ? celebrateComplete() : celebrateCorrect();
      renderReveal();
    },
  }));

  lists.appendChild(buildRevealGroup({
    heading: 'What does each number mean?',
    items: LEVEL_NUMBERS.map(n => ({
      key: n,
      render: (el) => {
        const b = document.createElement('span');
        b.className = 'slot-label';
        b.textContent = n;
        el.appendChild(b);
      },
      isCorrect: (val) => isCorrectLevelAnswer(n, val),
      correctMap: prog().reveal.numbers,
      hint: levelHint(n),
      looseNote: (val) => looseAnswerNote(n, val),
    })),
    onCorrect: (key, val) => {
      prog().reveal.numbers[key] = val;
      if (!prog().revealSolved.numbers[key]) {
        prog().revealSolved.numbers[key] = true;
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
      // Phone keyboards otherwise capitalise and "helpfully" rewrite short
      // linguistic abbreviations mid-typing, which turns a correct answer
      // into a wrong one between the keystroke and the tap on Check.
      input.setAttribute('autocapitalize', 'none');
      input.setAttribute('autocorrect', 'off');
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
function showNameError(msg, focusEl) {
  const el = document.getElementById('name-error');
  el.textContent = msg;
  el.classList.remove('hidden');
  if (focusEl) { focusEl.classList.add('invalid'); focusEl.focus(); }
}
function clearNameError() {
  document.getElementById('name-error').classList.add('hidden');
  document.getElementById('input-name').classList.remove('invalid');
  document.getElementById('input-code').classList.remove('invalid');
}

function attemptStart() {
  const nameEl = document.getElementById('input-name');
  const codeEl = document.getElementById('input-code');
  const name = nameEl.value.trim();
  const code = codeEl.value.trim();
  clearNameError();
  if (!name) return showNameError('Type your name in the first box, then press Start building.', nameEl);
  if (!code) return showNameError('You still need the class code — your teacher will have given you one.', codeEl);
  loginAs(name, code);
}
document.getElementById('btn-start').addEventListener('click', attemptStart);
// Pressing Enter in either field starts the game. Without this, typing a
// name and hitting Enter -- the single most natural thing to do on a form
// -- did absolutely nothing.
['input-name', 'input-code'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') attemptStart(); });
  el.addEventListener('input', clearNameError);
});

document.getElementById('btn-switch-player').addEventListener('click', async () => {
  const ok = await askConfirm({
    title: 'Switch to a different player?',
    message: `${player.name}'s ${state.points} points stay saved on this device. Typing the same name and class code again brings them straight back.`,
    okLabel: 'Yes, switch player',
    cancelLabel: 'No, stay here',
  });
  if (!ok) return;
  localStorage.removeItem('stb:lastPlayer');
  player = null; state = null;
  updateHeader();
  resetNav();
  document.getElementById('input-name').value = '';
  document.getElementById('input-code').value = '';
  clearNameError();
  showScreen('name');
});

document.getElementById('btn-redo-reveal').addEventListener('click', async () => {
  const ok = await askConfirm({
    title: 'Clear your answers and try again?',
    message: 'The answers you typed will be wiped so you can have another go. Points you\'ve already earned are kept, and this sub-level stays finished.',
    okLabel: 'Yes, clear them',
  });
  if (!ok) return;
  // Only resets the CURRENT on-screen attempt -- revealSolved (points,
  // Level 2's unlock) is untouched, same as "Rebuild" elsewhere never
  // takes back an already-earned sub-level.
  prog().reveal = { shapes: {}, numbers: {} };
  saveState();
  renderReveal();
});

document.querySelectorAll('.level-card[data-level]').forEach(card => {
  card.addEventListener('click', () => {
    const level = Number(card.dataset.level);
    // A locked card used to swallow the tap in silence. Say what it's
    // waiting for instead.
    if (card.classList.contains('locked')) { toast(lockedLevelReason(level)); return; }
    pushNav(gotoLevels);
    if (level === 2) { renderLevel2Grid(); showScreen('level2'); }
    else if (level === 3) { renderConstituencyGrid(); showScreen('level3'); }
    else if (level === 4) { renderCategoryIdGrid(); showScreen('level4'); }
    else { renderTargetGrid(); showScreen('level1'); }
  });
});
document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', navBack);
});

// ---------------- boot ----------------
(function boot() {
  history.replaceState({ depth: 0 }, '');
  renderSoundButton();
  setMode(modeIdFromUrl());

  // Wire the on-canvas zoom/fit controls once. The getters are lazy, so
  // it's fine that none of the view objects exist yet.
  attachCanvasControls(document.querySelector('#editor-overlay .canvas-stage'), () => editor);
  attachCanvasControls(document.querySelector('#wordmatch-overlay .canvas-stage'), () => wordMatch);
  attachCanvasControls(document.querySelector('#constituency-overlay .canvas-stage'), () => constituencyViewer);
  attachCanvasControls(document.querySelector('#categoryid-overlay .canvas-stage'), () => categoryViewer);

  const last = JSON.parse(localStorage.getItem('stb:lastPlayer') || 'null');
  if (last && last.name && last.code) {
    document.getElementById('input-name').value = last.name;
    document.getElementById('input-code').value = last.code;
    loginAs(last.name, last.code);
  } else {
    showScreen('name');
  }
})();
