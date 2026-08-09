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

// Which level number is currently open, for headings on the reveal screen
// and for returning to the right list.
let currentLevel = null;

// ---------------------------------------------------------------------------
// The whole game, in order. Levels 1-4 run the flat basic phase and 5-8 the
// X-bar phase; `phase` is which set of shapes, rules and sentences a level
// draws on, and each level activates its own before rendering.
//
// The switch at Level 5 is the point of the whole thing: it is where a
// syntax course stops using flat phrase-structure rules and starts using
// X-bar, so the game does the same, on trees the student has already built
// once. It is not a separate version to choose between, and there is no
// picker -- picking would mean describing both, and describing them gives
// away answers Level 1 spends its whole time withholding.
//
// `kind` says which of the four activities a level is, and so which screen
// and which progress list it uses. Each activity appears twice, once per
// phase, which is deliberate: by Level 6 the task is already familiar, so
// the only new thing to take in is the structure.
// ---------------------------------------------------------------------------
const GAME_LEVELS = [
  { n: 1, phase: 'prex', kind: 'build', title: 'Shapes',
    blurb: 'Combine a set inventory of pieces into a single connected shape. No shortcuts allowed.' },
  { n: 2, phase: 'prex', kind: 'words', title: 'Words',
    blurb: 'Drag real English words onto the pieces of an already-labeled sentence tree.' },
  { n: 3, phase: 'prex', kind: 'constituents', title: 'Constituents',
    blurb: 'Is this string of words a constituent? Prove it with a run of correct answers.' },
  { n: 4, phase: 'prex', kind: 'categories', title: 'Categories',
    blurb: 'Click the category sticker that matches the highlighted constituent.' },
  // Deliberately says nothing about what is new. Any description of the
  // pieces hands over the answer to this level's own Mystery Level.
  { n: 5, phase: 'xbar', kind: 'build', title: 'Back to Shapes',
    blurb: 'A new inventory, and a fresh Mystery Level.' },
  { n: 6, phase: 'xbar', kind: 'words', title: 'Back to Words',
    blurb: 'Words onto trees, now with the middle layer — and sentences where a word moves and leaves a copy behind.' },
  { n: 7, phase: 'xbar', kind: 'constituents', title: 'Back to Constituents',
    blurb: 'The same question, on the bigger trees.' },
  { n: 8, phase: 'xbar', kind: 'categories', title: 'Back to Categories',
    blurb: 'The same stickers, on the bigger trees.' },
];

const ACTIVITY_SCREEN = { build: 'level1', words: 'level2', constituents: 'level3', categories: 'level4' };

function levelByNumber(n) { return GAME_LEVELS.find(l => l.n === n); }

// Progress for a phase, read without disturbing whichever one is active --
// the level select has to report on both at once.
function phaseProgress(phase) {
  if (!state.modes[phase]) state.modes[phase] = defaultModeProgress();
  return state.modes[phase];
}

// Whether a level is finished, judged against its own phase's data rather
// than whatever happens to be loaded.
function isLevelComplete(level) {
  const mode = MODES[level.phase];
  const p = phaseProgress(level.phase);
  if (level.kind === 'build') {
    return mode.level1.every(sub => sub.kind === 'reveal'
      ? mode.categories.every(k => p.revealSolved.shapes[k]) && mode.numbers.every(n => p.revealSolved.numbers[n])
      : p.trees.includes(sub.id));
  }
  if (level.kind === 'words') return mode.level2.every(sub => p.sentences.includes(sub.id));
  if (level.kind === 'constituents') return mode.quizConstituency.every(sub => p.constituency.includes(sub.id));
  return mode.quiz.every(sub => p.categoryid.includes(sub.id));
}

// How far through a level, for the card's footer line.
function levelProgressLabel(level) {
  const mode = MODES[level.phase];
  const p = phaseProgress(level.phase);
  if (level.kind === 'build') {
    const done = mode.level1.filter(sub => sub.kind === 'reveal'
      ? mode.categories.every(k => p.revealSolved.shapes[k]) && mode.numbers.every(n => p.revealSolved.numbers[n])
      : p.trees.includes(sub.id)).length;
    return `${done} / ${mode.level1.length} sub-levels done`;
  }
  if (level.kind === 'words') {
    return `${mode.level2.filter(s => p.sentences.includes(s.id)).length} / ${mode.level2.length} sentences done`;
  }
  if (level.kind === 'constituents') {
    return `${mode.quizConstituency.filter(s => p.constituency.includes(s.id)).length} / ${mode.quizConstituency.length} sub-levels done`;
  }
  return `${mode.quiz.filter(s => p.categoryid.includes(s.id)).length} / ${mode.quiz.length} sub-levels done`;
}

function toast(msg) {
  flashMascotSpeech(msg, 3800);
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
  // Mark the whole row, not just the button: once the puzzle is finished
  // the working controls (scissors, Start over) stand down so the way out
  // can have the space. All four buttons plus a long "Done" label made the
  // row 518px wide inside a 360px phone, so the Done button was running
  // ~180px off the right edge -- the one control that has to be reachable.
  const actions = btn.closest('.editor-actions');
  if (actions) actions.classList.toggle('done', done);
  if (done) {
    btn.textContent = 'Done — back to the list';
    btn.className = 'btn-primary btn-return';
  } else {
    btn.textContent = '× close';
    btn.className = 'link-btn';
  }
}

// The mascot bar is the ONLY place feedback is ever shown. It carries two
// kinds of message at once, so they need to not clobber each other:
//
//   base  -- the standing instruction for wherever you are ("drag every
//            piece together...", "you're in snip mode..."). Changes when
//            the screen or mode does.
//   flash -- a transient reaction to what you just did ("Snapped
//            together", "those two don't fit"). Shows for a few seconds,
//            then hands the bar back to whatever the base is by then.
let mascotBase = '';
let mascotFlashTimer = null;

function renderMascotBubble(text) {
  const bubble = document.getElementById('mascot-bubble');
  if (!bubble) return;
  bubble.textContent = text || '';
  bubble.classList.toggle('visible', !!text);
  syncMascotBarHeight();
}

// Set the standing instruction. By default this does NOT interrupt a
// flash -- a mode change in the same tick as a result message (a snip does
// both) would otherwise wipe the result before it could be read; the new
// base is simply what the flash reverts to when it expires.
//
// `interrupt` is for the opposite case: an instruction the student just
// asked for by pressing something. Arming the scissors right after a snap
// has to show you how to use them now, not once "Snapped together" has
// finished its three seconds.
function setMascotSpeech(text, { interrupt = false } = {}) {
  mascotBase = text || '';
  if (mascotFlashTimer && !interrupt) return;
  clearTimeout(mascotFlashTimer);
  mascotFlashTimer = null;
  renderMascotBubble(mascotBase);
}

function flashMascotSpeech(text, ms = 3400) {
  if (!text) return;
  clearTimeout(mascotFlashTimer);
  renderMascotBubble(text);
  mascotFlashTimer = setTimeout(() => {
    mascotFlashTimer = null;
    renderMascotBubble(mascotBase);
  }, ms);
}

// Drop any transient message immediately -- on closing a modal, so the
// puzzle's last message doesn't linger over the level list behind it.
function clearMascotFlash() {
  clearTimeout(mascotFlashTimer);
  mascotFlashTimer = null;
  renderMascotBubble(mascotBase);
}

// Hints stay up longer than reactions: they're something to act on, not
// just something to notice.
function relayFeedback(msg, kind) {
  if (!msg) { clearMascotFlash(); return; }
  flashMascotSpeech(msg, kind === 'hint' ? 7000 : 3400);
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

// The header carries the brand and the points, and nothing else. Who you
// are and the three occasional controls live in the menu.
function updateHeader() {
  const pts = document.getElementById('player-points');
  pts.classList.toggle('hidden', !player);
  if (player) pts.textContent = `${state.points} pts`;

  const who = document.getElementById('menu-player');
  who.classList.toggle('hidden', !player);
  if (player) who.textContent = `Playing as ${player.name} — class ${player.code}`;
  document.getElementById('menu-switch').classList.toggle('hidden', !player);
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
    title: 'How Shape Snap works',
    html: `<ul>
      <li>Work through the levels in order. Each one unlocks when you finish the one before it.</li>
      <li>Your points are saved automatically on this device, under your name and class code.
          You can close the page at any time and pick up where you left off.</li>
      <li><strong>Nothing you do here can break anything.</strong> If something goes wrong,
          close the puzzle and open it again — you'll never lose points you've already earned.</li>
      <li>Tap <strong>☰ Menu</strong> at the top right to turn the sounds off, get help,
          or switch to a different player.</li>
      <li>Tap <strong>?</strong> inside any puzzle for help with that puzzle.</li>
    </ul>`,
  },
  editor: {
    title: 'Level 1 — Shapes',
    html: `<ul>
      <li>Drag one piece onto another. If they belong together they <strong>snap</strong>,
          and you'll see the target piece glow green just before they do.</li>
      <li>Two pieces only join if their <strong>shape and number both match</strong>, and one of
          them has an empty branch free. If a drop doesn't work, the message at the bottom of the screen says why.</li>
      <li><strong>Stuck?</strong> After three tries that don't work, two pieces that do fit start
          glowing amber. Drag either one onto the other.</li>
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
      <li><strong>Stuck?</strong> After three wrong pieces for the same word, the piece it actually
          belongs on starts glowing amber.</li>
      <li>Or tap <strong>Skip this word</strong> to come back to it later.</li>
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
document.querySelectorAll('[data-help]').forEach(btn => {
  btn.addEventListener('click', (ev) => { ev.stopPropagation(); openHelp(btn.dataset.help); });
});
document.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Escape') return;
  if (!document.getElementById('help-overlay').classList.contains('hidden')) { closeHelp(); return; }
  if (!document.getElementById('menu-overlay').classList.contains('hidden')) { closeMenu(); return; }
  if (!document.getElementById('confirm-overlay').classList.contains('hidden')) settleConfirm(false);
});

// ---------------- menu ----------------
// Says what the setting IS, not what tapping will do to it -- "Sound is
// off" can't be misread the way a lone speaker icon can.
function renderSoundButton() {
  const btn = document.getElementById('menu-sound');
  if (!btn) return;
  btn.textContent = isSoundMuted() ? '🔇 Sound is off' : '🔊 Sound is on';
}
function openMenu() {
  renderSoundButton();
  document.getElementById('menu-overlay').classList.remove('hidden');
}
function closeMenu() {
  document.getElementById('menu-overlay').classList.add('hidden');
}
document.getElementById('btn-menu').addEventListener('click', openMenu);
document.getElementById('menu-close').addEventListener('click', closeMenu);
document.getElementById('menu-sound').addEventListener('click', () => {
  setSoundMuted(!isSoundMuted());
  renderSoundButton();
  if (!isSoundMuted()) playCorrectSound();
});
document.getElementById('menu-help').addEventListener('click', () => {
  closeMenu();
  openHelp('general');
});

// ---------------- sub-level completion ----------------
// Whether the CURRENT on-screen attempt is fully filled in -- drives the
// tree-reveal visual and the "you cracked the code" message, and resets
// (goes back to false) whenever Redo clears reveal.
function revealComplete() {
  const p = prog();
  return MODE_CATEGORIES.every(k => p.reveal.shapes[k]) && LEVEL_NUMBERS.every(n => p.reveal.numbers[n]);
}
// Whether it's EVER been fully solved -- permanent, drives Level 2's lock
// and the sub-level's own done/locked state, so a Redo (for practice) can
// never re-lock Level 2 or take back an already-earned sub-level.
function revealEverSolved() {
  const p = prog();
  return MODE_CATEGORIES.every(k => p.revealSolved.shapes[k]) && LEVEL_NUMBERS.every(n => p.revealSolved.numbers[n]);
}
function isSubComplete(sub) {
  return sub.kind === 'reveal' ? revealEverSolved() : prog().trees.includes(sub.id);
}

// ---------------- level select ----------------
// One chain of eight: each unlocks when the one before it is finished. A
// locked card shows nothing but its number -- its title and description
// would otherwise name things a later level exists to teach.
function renderLevelSelect() {
  const grid = document.getElementById('level-grid');
  grid.innerHTML = '';

  GAME_LEVELS.forEach((level, i) => {
    const locked = i > 0 && !isLevelComplete(GAME_LEVELS[i - 1]);
    const done = !locked && isLevelComplete(level);
    const card = document.createElement('button');
    card.className = 'level-card' + (locked ? ' locked' : '') + (done ? ' level-done' : '');
    card.dataset.level = level.n;

    const num = document.createElement('div');
    num.className = 'level-num';
    num.textContent = `Level ${level.n}`;
    card.appendChild(num);

    if (locked) {
      const lock = document.createElement('div');
      lock.className = 'lock-badge';
      lock.textContent = '🔒 Locked';
      card.appendChild(lock);
    } else {
      const title = document.createElement('div');
      title.className = 'level-title';
      title.textContent = (done ? '✓ ' : '') + level.title;
      card.appendChild(title);

      const blurb = document.createElement('p');
      blurb.textContent = level.blurb;
      card.appendChild(blurb);

      const prog = document.createElement('div');
      prog.className = 'level-progress';
      prog.textContent = levelProgressLabel(level);
      card.appendChild(prog);
    }

    card.addEventListener('click', () => {
      if (locked) { toast(lockedLevelReason(level)); return; }
      openLevel(level);
    });
    grid.appendChild(card);
  });

  const roadmap = document.getElementById('roadmap');
  roadmap.innerHTML = '';
  ROADMAP.forEach((topic, i) => {
    const card = document.createElement('div');
    card.className = 'level-card locked';
    const num = document.createElement('div');
    num.className = 'level-num';
    num.textContent = `Level ${GAME_LEVELS.length + i + 1}`;
    card.appendChild(num);
    const lock = document.createElement('div');
    lock.className = 'lock-badge';
    lock.textContent = '🔒 Locked';
    card.appendChild(lock);
    roadmap.appendChild(card);
  });
}

// Entering a level switches the game over to that level's phase first --
// everything downstream (which pieces exist, which sentences, how many
// projection levels there are) reads from whichever phase is active.
function openLevel(level) {
  currentLevel = level;
  setMode(level.phase);
  const screen = ACTIVITY_SCREEN[level.kind];
  document.getElementById(`${screen}-heading`).textContent = `Level ${level.n} — ${level.title}`;
  pushNav(gotoLevels);
  if (level.kind === 'build') { renderTargetGrid(); showScreen('level1'); }
  else if (level.kind === 'words') { renderLevel2Grid(); showScreen('level2'); }
  else if (level.kind === 'constituents') { renderConstituencyGrid(); showScreen('level3'); }
  else { renderCategoryIdGrid(); showScreen('level4'); }
}

// What a locked level is waiting for -- said out loud, because a tap that
// does literally nothing reads as a broken button.
function lockedLevelReason(level) {
  const prev = levelByNumber(level.n - 1);
  if (!prev) return 'Finish the previous level first.';
  if (prev.kind === 'build') {
    return `Level ${level.n} unlocks when all of Level ${prev.n} is done — including the Mystery Level.`;
  }
  return `Level ${level.n} unlocks when every part of Level ${prev.n} is done.`;
}

// ---------------- shared editor modal ----------------
let editor = null;
let activeCheck = null;  // function() -> void, checked automatically after every move
let currentItems = null; // flat list of STRUCTURES items for the open sub-level, so Start over can re-scatter them

// The standing instruction for the open sub-level, so snip mode has
// something to hand the bar back to when it's switched off.
let editorBaseHint = '';
const SNIP_HINT = 'Snip mode: tap a piece outlined in red to pull it apart. Tap empty canvas to cancel.';

function ensureEditor() {
  if (!editor) editor = new TreeEditor(document.getElementById('editor-canvas'));
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
  editorBaseHint = hint;
  clearMascotFlash();
  setMascotSpeech(hint);
  currentItems = items;
  const fit = fitCanvasSize(viewW, viewH);
  editor.open(fit.w, fit.h);
  editor.scatterAll(items);
  setSnipButtonActive(false);
  setModalDoneState(document.getElementById('editor-close'), false);
  editor.onSnipModeChange = (on) => {
    setSnipButtonActive(on);
    // Arming takes the bar immediately; disarming is usually the tail of a
    // snip whose result is still worth reading, so it only sets the
    // fallback and lets that result finish showing.
    setMascotSpeech(on ? SNIP_HINT : editorBaseHint, { interrupt: on });
  };
  editor.onFeedback = relayFeedback;
  editor.onSnap = celebrateCorrect;
  // No Check button here -- a sub-level finishes itself the moment the last
  // correct move is made. onChange fires after every snap/snip; check
  // silently each time, and only act when it's actually complete.
  editor.onChange = () => { if (activeCheck) activeCheck(true); };
  activeCheck = onCheck;
  const editorOverlay = document.getElementById('editor-overlay');
  editorOverlay.classList.remove('hidden');
  // Labels can only be measured once they're actually displayed -- inside
  // a display:none subtree getComputedTextLength() is 0 and the fit
  // silently does nothing, leaving every label at its unfitted size.
  fitShapeLabels(editorOverlay);
  pushNav(closeEditor);
}

function closeEditor() {
  document.getElementById('editor-overlay').classList.add('hidden');
  activeCheck = null;
  setMascotSpeech(SCREEN_SPEECH.level1);
  clearMascotFlash();
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
        else {
          renderReveal();
          pushNav(() => { renderTargetGrid(); showScreen('level1'); });
          showScreen('reveal');
          fitShapeLabels(document.getElementById('screen-reveal'));
        }
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

// Same single destination as the editor's: the mascot bar, never a line
// wedged into the modal chrome.
function setWmFeedback(msg, kind) {
  relayFeedback(msg, kind);
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
  clearMascotFlash();
  setMascotSpeech(sub.hint);
  const fit = fitCanvasSize(1100, 800);
  wordMatch.open(sub.root, fit.w, fit.h);
  renderWmSentence(sub.root);
  setWmFeedback('');
  setModalDoneState(document.getElementById('wordmatch-close'), false);
  wordMatch.onPlace = () => { celebrateCorrect(); setWmFeedback('Nice — that one fits.', 'ok'); renderWmSentence(sub.root); };
  wordMatch.onReject = (msg, kind) => setWmFeedback(msg, kind);
  wordMatch.onComplete = () => { markL2SubDone(sub, POINTS_SENTENCE); };
  const wmOverlay = document.getElementById('wordmatch-overlay');
  wmOverlay.classList.remove('hidden');
  fitShapeLabels(wmOverlay);
  pushNav(closeWordMatch);
}

function closeWordMatch() {
  document.getElementById('wordmatch-overlay').classList.add('hidden');
  // The floating word chip lives outside the modal box, so it has to be
  // put away explicitly or it hangs over the level list after closing.
  if (wordMatch) wordMatch.chipEl.classList.add('hidden');
  currentL2Sub = null;
  setMascotSpeech(SCREEN_SPEECH.level2);
  clearMascotFlash();
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
  QUIZ_CONSTITUENCY_SUBLEVELS.forEach((sub, i) => {
    const done = isL3SubComplete(sub);
    const locked = i > 0 && !isL3SubComplete(QUIZ_CONSTITUENCY_SUBLEVELS[i - 1]);
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
let l3LastKey = null;         // previous span, so the same string is never asked twice running

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

// Pick from `pool`, avoiding whatever was just asked. Being asked the
// identical string twice running reads as the quiz being broken -- but a
// pool with only one entry has nothing else to offer, so it falls through
// rather than looping.
function sampleAvoidingRepeat(pool, lastKey) {
  const fresh = pool.filter(s => `${s.start}-${s.end}` !== lastKey);
  const from = fresh.length ? fresh : pool;
  return from[Math.floor(Math.random() * from.length)];
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
  const span = sampleAvoidingRepeat(pool, l3LastKey);
  l3LastKey = `${span.start}-${span.end}`;
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
  l3LastKey = null;
  document.getElementById('constituency-title').textContent = sub.name;
  setMascotSpeech(`Is the highlighted string of words a constituent -- the whole yield of some single piece? ${sub.streakTarget} in a row to finish.`);
  const fit = fitCanvasSize(1100, 800);
  constituencyViewer.open(sub.root, fit.w, fit.h);
  renderStreakBar('constituency', l3Game);
  setModalDoneState(document.getElementById('constituency-close'), false);
  nextConstituencyQuestion();
  const c3Overlay = document.getElementById('constituency-overlay');
  c3Overlay.classList.remove('hidden');
  fitShapeLabels(c3Overlay);
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
let l4LastKey = null;         // previous span, so the same string is never asked twice running

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
  MODE_CATEGORIES.forEach(key => {
    [{ isHead: false, level: PHRASE_NUMBER }, { isHead: true, level: HEAD_NUMBER }].forEach(({ isHead, level }) => {
      // A category that never heads a phrase in this phase gets a blank
      // cell rather than a sticker, so the column grid stays aligned.
      if (!isHead && !MODE_PHRASE_CATEGORIES.has(key)) {
        matrix.appendChild(document.createElement('span'));
        return;
      }
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
  fitShapeLabels(matrix);
}

function nextCategoryQuestion() {
  setQuizAwaitingNext('categoryid', false);
  const pools = currentL4Sub.pools;
  const span = sampleAvoidingRepeat(l4Pool, l4LastKey);
  l4LastKey = `${span.start}-${span.end}`;
  // `alsoPhrase` marks a single word that is a whole phrase in its own
  // right -- "jump" is both a VP and a V⁰ -- so either sticker is right.
  l4CurrentQuestion = { span, shape: span.shape, isHead: span.start === span.end, alsoPhrase: !!span.alsoPhrase };
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
  const correct = chosenShape === question.shape
    && (chosenIsHead === question.isHead || (question.alsoPhrase && !chosenIsHead));
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
    feedback.textContent = question.alsoPhrase
      ? `Not quite — that's ${CATEGORIES[question.shape].name}. It's one word, so either ${nodeLabel(question.shape, PHRASE_NUMBER)} or ${answerLabel} counts. ${result.pointsDelta} pts`
      : `Not quite — that's ${CATEGORIES[question.shape].name} (${answerLabel}). ${result.pointsDelta} pts`;
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
  l4LastKey = null;
  document.getElementById('categoryid-title').textContent = sub.name;
  setMascotSpeech(`Click the category sticker that matches the highlighted constituent. ${target} in a row to finish.`);
  buildCategoryMatrix();
  const fit = fitCanvasSize(1100, 800);
  categoryViewer.open(sub.root, fit.w, fit.h);
  renderStreakBar('categoryid', l4Game);
  setModalDoneState(document.getElementById('categoryid-close'), false);
  nextCategoryQuestion();
  const c4Overlay = document.getElementById('categoryid-overlay');
  c4Overlay.classList.remove('hidden');
  fitShapeLabels(c4Overlay);
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
// Wrong guesses per slot, for this session only. The Mystery Level is the
// one gate in the game with no way around it -- Level 2 stays locked until
// every slot is right -- so a student who simply cannot land on the word
// "complementizer" was stuck for good, with a conceptual Hint button that
// deliberately never says the answer. After HINT_AFTER_ATTEMPTS wrong
// guesses on a slot, it just tells them.
//
// Deliberately not persisted: coming back to it another day starts you
// fresh, which is the kinder default for something that is trying to
// teach the vocabulary rather than test it once.
const revealAttempts = { shapes: {}, numbers: {} };

let revealViewer = null;
function ensureRevealViewer() {
  if (!revealViewer) revealViewer = new TreeViewer(document.getElementById('reveal-canvas'), { reveal: false });
  return revealViewer;
}

function renderReveal() {
  const sub = LEVEL1_SUBLEVELS.find(s => s.kind === 'reveal');

  // The tree canvas outlives each render: every correct answer re-renders
  // the lists, and re-opening the viewer each time would throw away
  // whatever the student had zoomed in on. Only a genuinely different tree
  // (a mode switch) re-frames the view.
  const viewer = ensureRevealViewer();
  viewer.reveal = revealComplete();
  if (viewer.root !== sub.root) viewer.open(sub.root);
  else viewer.render();

  document.getElementById('reveal-win').classList.toggle('hidden', !revealComplete());

  const lists = document.getElementById('reveal-lists');
  lists.innerHTML = '';

  lists.appendChild(buildRevealGroup({
    heading: 'What is each shape?',
    items: MODE_CATEGORIES.map(key => ({
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
      attempts: revealAttempts.shapes,
      answer: shapeCanonicalAnswer(key),
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
      attempts: revealAttempts.numbers,
      answer: levelCanonicalAnswer(n),
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

  // The Mystery Level is a screen rather than a modal, so it never got the
  // finished-state "Done" button the puzzle modals have -- the only way
  // back was the small "← Levels" link at the very top, which on a phone
  // is a full tree's worth of scrolling above where you finish. Put an
  // exit at the bottom, where the last answer is actually typed.
  const footer = document.getElementById('reveal-footer');
  footer.innerHTML = '';
  const back = document.createElement('button');
  back.type = 'button';
  if (revealComplete()) {
    back.className = 'btn-primary btn-return';
    back.textContent = 'Done — back to the levels';
  } else {
    back.className = 'btn-secondary';
    back.textContent = '← Back to the levels';
  }
  back.addEventListener('click', navBack);
  footer.appendChild(back);
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

      // Shown once this slot has been missed enough times. Fills the answer
      // in as well as naming it, so the way forward is a single tap on
      // Check rather than copying a word like "complementizer" by eye.
      let hintBtn = null;
      const answerText = document.createElement('p');
      answerText.className = 'answer-text hidden';
      const revealTheAnswer = (prefill) => {
        if (!item.answer) return;
        answerText.textContent = `The answer is "${item.answer}". Press Check to carry on.`;
        answerText.classList.remove('hidden');
        if (prefill) input.value = item.answer;
        if (hintBtn) hintBtn.classList.add('hidden'); // a nudge is redundant next to the answer
      };

      const attempt = () => {
        const val = input.value.trim();
        if (!val) return;
        if (item.isCorrect(val)) {
          playCorrectSound();
          const note = item.looseNote && item.looseNote(val);
          onCorrect(item.key, val);
          if (note) toast(note);
          return;
        }
        row.classList.add('incorrect');
        setTimeout(() => row.classList.remove('incorrect'), 700);
        if (!item.attempts) return;
        item.attempts[item.key] = (item.attempts[item.key] || 0) + 1;
        if (item.attempts[item.key] >= HINT_AFTER_ATTEMPTS) revealTheAnswer(true);
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

        hintBtn = document.createElement('button');
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

      wrap.appendChild(answerText);
      // Every correct answer re-renders the whole list, so a slot that had
      // already given up its answer has to say so again rather than
      // silently reverting to "type your answer".
      if (item.attempts && (item.attempts[item.key] || 0) >= HINT_AFTER_ATTEMPTS) revealTheAnswer(false);
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

document.getElementById('menu-switch').addEventListener('click', async () => {
  closeMenu();
  const ok = await askConfirm({
    title: 'Switch to a different player?',
    message: `${player.name}'s ${state.points} points stay saved on this device under class ${player.code}. Typing the same name and class code again brings them straight back.`,
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

document.querySelectorAll('[data-back]').forEach(btn => {
  btn.addEventListener('click', navBack);
});

// ---------------- boot ----------------
(function boot() {
  history.replaceState({ depth: 0 }, '');
  renderSoundButton();
  setMode(GAME_LEVELS[0].phase);

  // Wire the on-canvas zoom/fit controls once. The getters are lazy, so
  // it's fine that none of the view objects exist yet.
  attachCanvasControls(document.querySelector('#editor-overlay .canvas-stage'), () => editor);
  attachCanvasControls(document.querySelector('#wordmatch-overlay .canvas-stage'), () => wordMatch);
  attachCanvasControls(document.querySelector('#constituency-overlay .canvas-stage'), () => constituencyViewer);
  attachCanvasControls(document.querySelector('#categoryid-overlay .canvas-stage'), () => categoryViewer);
  attachCanvasControls(document.querySelector('#screen-reveal .canvas-stage'), () => revealViewer);

  const last = JSON.parse(localStorage.getItem('stb:lastPlayer') || 'null');
  if (last && last.name && last.code) {
    document.getElementById('input-name').value = last.name;
    document.getElementById('input-code').value = last.code;
    loginAs(last.name, last.code);
  } else {
    showScreen('name');
  }
})();
