// ---------------------------------------------------------------------------
// Core data model for the Syntax Tree Builder.
//
// Everything here mirrors the physical "shapes + paperclips + magnets"
// activity: a SHAPE is a grammatical category, a NUMBER is an X-bar level.
// Students never see the CATEGORIES/LEVELS mapping until Level 3 unlocks it.
// ---------------------------------------------------------------------------

const CATEGORIES = {
  C: { shape: 'star',      color: '#e8b400', name: 'Complementizer' },
  T: { shape: 'square',    color: '#3f9d5c', name: 'Tense' },
  V: { shape: 'heart',     color: '#e2657c', name: 'Verb' },
  D: { shape: 'circle',    color: '#d84a3b', name: 'Determiner' },
  N: { shape: 'triangle',  color: '#3f8fd0', name: 'Noun' },
  P: { shape: 'rectangle', color: '#9b59b6', name: 'Preposition' },
};

// Distractor category names shown alongside the real ones in the Level 3
// legend game, so matching isn't just "6 slots, 6 leftover labels".
const CATEGORY_DISTRACTORS = ['Adjective', 'Adverb'];

const XBAR_LEVELS = {
  1: { code: 'XP', name: 'Phrase (maximal projection)' },
  2: { code: "X′", name: 'Bar level (intermediate projection)' },
  3: { code: 'X⁰', name: 'Head (terminal / lexical item)' },
};

// ---------------------------------------------------------------------------
// The 19 buildable fragments (Level 1), in the same order/numbering as the
// physical "Week 10 Seminar handout". `parent` is the root node of the
// fragment; `children` are its direct daughters (already-resolved heads are
// listed inline with no further children of their own).
// ---------------------------------------------------------------------------

const STRUCTURES = [
  { id: 1,  shape: 'T', number: 1, children: [ { shape: 'D', number: 1 }, { shape: 'T', number: 2 } ], rule: "XP → Spec + X′" },
  { id: 2,  shape: 'T', number: 2, children: [ { shape: 'T', number: 3 }, { shape: 'V', number: 1 } ], rule: "X′ → X⁰ + Complement" },
  { id: 3,  shape: 'V', number: 1, children: [ { shape: 'V', number: 2 } ], rule: "XP → X′ (no specifier)" },
  { id: 4,  shape: 'V', number: 2, children: [ { shape: 'V', number: 2 }, { shape: 'P', number: 1 } ], rule: "X′ → X′ + Adjunct" },
  { id: 5,  shape: 'V', number: 2, children: [ { shape: 'V', number: 3 } ], rule: "X′ → X⁰ (intransitive)" },
  { id: 6,  shape: 'V', number: 2, children: [ { shape: 'V', number: 3 }, { shape: 'D', number: 1 } ], rule: "X′ → X⁰ + Complement" },
  { id: 7,  shape: 'D', number: 1, children: [ { shape: 'D', number: 2 } ], rule: "XP → X′ (no specifier)" },
  { id: 8,  shape: 'D', number: 2, children: [ { shape: 'D', number: 3 }, { shape: 'N', number: 1 } ], rule: "X′ → X⁰ + Complement" },
  { id: 9,  shape: 'N', number: 1, children: [ { shape: 'N', number: 2 } ], rule: "XP → X′ (no specifier)" },
  { id: 10, shape: 'N', number: 2, children: [ { shape: 'N', number: 3 } ], rule: "X′ → X⁰" },
  { id: 11, shape: 'C', number: 1, children: [ { shape: 'D', number: 1 }, { shape: 'C', number: 2 } ], rule: "XP → Spec + X′" },
  { id: 12, shape: 'C', number: 2, children: [ { shape: 'C', number: 3 }, { shape: 'T', number: 1 } ], rule: "X′ → X⁰ + Complement" },
  { id: 13, shape: 'P', number: 1, children: [ { shape: 'P', number: 2 } ], rule: "XP → X′ (no specifier)" },
  { id: 14, shape: 'P', number: 2, children: [ { shape: 'P', number: 3 }, { shape: 'D', number: 1 } ], rule: "X′ → X⁰ + Complement" },
  { id: 15, shape: 'C', number: 3, children: [], rule: "X⁰ (bare head)" },
  { id: 16, shape: 'T', number: 3, children: [], rule: "X⁰ (bare head)" },
  { id: 17, shape: 'D', number: 3, children: [], rule: "X⁰ (bare head)" },
  { id: 18, shape: 'N', number: 3, children: [], rule: "X⁰ (bare head)" },
  { id: 19, shape: 'P', number: 3, children: [], rule: "X⁰ (bare head)" },
];

// Every legal (parent -> child) plug derived from the 19 fragments above.
// A connection in the app is only allowed if it appears in this set -- this
// is what makes "shortcut" clips impossible: there is no legal edge that
// skips an intermediate projection.
const LEGAL_EDGES = new Set();
for (const s of STRUCTURES) {
  for (const c of s.children) {
    LEGAL_EDGES.add(`${s.shape}${s.number}>${c.shape}${c.number}`);
  }
}
function isLegalEdge(parentShape, parentNumber, childShape, childNumber) {
  return LEGAL_EDGES.has(`${parentShape}${parentNumber}>${childShape}${childNumber}`);
}

// ---------------------------------------------------------------------------
// Level 2 target trees, built compositionally from the same fragments so
// every edge in every target is guaranteed legal.
// ---------------------------------------------------------------------------

function NP_() {
  return { shape: 'N', number: 1, children: [
    { shape: 'N', number: 2, children: [ { shape: 'N', number: 3, children: [] } ] },
  ] };
}
function DP_() {
  return { shape: 'D', number: 1, children: [
    { shape: 'D', number: 2, children: [ { shape: 'D', number: 3, children: [] }, NP_() ] },
  ] };
}
function PP_() {
  return { shape: 'P', number: 1, children: [
    { shape: 'P', number: 2, children: [ { shape: 'P', number: 3, children: [] }, DP_() ] },
  ] };
}
function VP_adjoined() {
  return { shape: 'V', number: 1, children: [
    { shape: 'V', number: 2, children: [
      { shape: 'V', number: 2, children: [ { shape: 'V', number: 3, children: [] }, DP_() ] },
      PP_(),
    ] },
  ] };
}
function TP_(vp) {
  return { shape: 'T', number: 1, children: [
    DP_(),
    { shape: 'T', number: 2, children: [ { shape: 'T', number: 3, children: [] }, vp ] },
  ] };
}
function CP_(tp) {
  return { shape: 'C', number: 1, children: [
    DP_(),
    { shape: 'C', number: 2, children: [ { shape: 'C', number: 3, children: [] }, tp ] },
  ] };
}

// A bare partial pattern used by the "four pieces" sub-level: T1 with a
// subject slot and a T' slot, where the subject and the verb both stop one
// level short of being fully resolved (their branches are deliberately left
// open -- that's the point of this checkpoint).
function partialTDV() {
  return { shape: 'T', number: 1, children: [
    { shape: 'D', number: 1, children: [ { shape: 'D', number: 2, children: [] } ] },
    { shape: 'T', number: 2, children: [
      { shape: 'T', number: 3, children: [] },
      { shape: 'V', number: 1, children: [ { shape: 'V', number: 2, children: [] } ] },
    ] },
  ] };
}

// Every sub-level of Level 1, in play order. `kind` drives how the app
// handles it:
//   'tutorial' -- no target shape; just do at least one snap and one snip.
//   'build'    -- assemble the exact `root` pattern from a fixed inventory.
//   'reveal'   -- show a finished tree and ask the student to name shapes
//                 and numbers themselves (no word bank).
const LEVEL1_SUBLEVELS = [
  {
    id: 'first-join',
    kind: 'tutorial',
    name: 'First Join',
    description: 'Snap two pieces together, then use the scissors to pull them apart again.',
    pieceIds: [3, 5],
  },
  {
    id: 'four-pieces',
    kind: 'build',
    name: 'Four Pieces',
    description: 'Combine four pieces into one connected shape.',
    root: partialTDV(),
  },
  {
    id: 'one-more-branch',
    kind: 'build',
    name: 'More Pieces',
    description: 'Combine every piece into one connected shape, fully resolved, with one extra piece branching off.',
    root: TP_(VP_adjoined()),
  },
  {
    id: 'name-them',
    kind: 'reveal',
    name: 'Mystery Level',
    description: 'Type what you think each shape and number stands for.',
    root: TP_(VP_adjoined()),
  },
];

// Count fragment-usage for a 'build' sub-level, for an in-app hint ("this
// shape uses pieces #1, #2, #3...") without revealing category names.
function fragmentIdFor(node) {
  return STRUCTURES.find(s =>
    s.shape === node.shape && s.number === node.number &&
    s.children.length === node.children.length &&
    s.children.every((c, i) => c.shape === node.children[i].shape && c.number === node.children[i].number)
  )?.id;
}
function collectFragmentIds(node, out = new Set()) {
  const id = fragmentIdFor(node);
  if (id) out.add(id);
  for (const c of node.children) collectFragmentIds(c, out);
  return out;
}
// The actual pre-built pieces (handout item numbers) needed to assemble a
// target, with counts -- e.g. two separate DP chains (subject + object) both
// need their own copies of items 7/8/9/10. A leaf with no children of its
// own is never counted separately: it's already part of whichever cluster
// built it (e.g. item 2's T0 child is baked into item 2), OR -- as with the
// "four pieces" checkpoint -- it's deliberately left unresolved for now.
function collectFragmentUsage(node, counts = {}) {
  if (node.children.length > 0) {
    const id = fragmentIdFor(node);
    if (id) counts[id] = (counts[id] || 0) + 1;
  }
  for (const c of node.children) collectFragmentUsage(c, counts);
  return counts;
}
for (const s of LEVEL1_SUBLEVELS) {
  if (s.kind !== 'build') continue;
  s.fragmentIds = [...collectFragmentIds(s.root)].sort((a, b) => a - b);
  const counts = collectFragmentUsage(s.root);
  s.inventory = Object.entries(counts)
    .map(([id, count]) => ({ id: Number(id), count }))
    .sort((a, b) => a.id - b.id);
}

// Accepted free-text answers for the final reveal (case-insensitive, any
// one of these counts as correct).
const SHAPE_ANSWERS = {
  C: ['c', 'comp', 'complementizer'],
  T: ['t', 'tense'],
  V: ['v', 'verb'],
  D: ['d', 'det', 'determiner'],
  N: ['n', 'noun'],
  P: ['p', 'prep', 'preposition'],
};
const LEVEL_ANSWERS = {
  1: ['xp', 'x-bar phrase', 'phrase', 'maximal projection', 'maximal phrase'],
  2: ["x'", 'x bar', 'x-bar', 'xbar', 'bar level', 'bar'],
  3: ['x0', 'xzero', 'x-zero', 'head'],
};
function normalizeAnswer(s) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}
function isCorrectShapeAnswer(catKey, answer) {
  return SHAPE_ANSWERS[catKey].includes(normalizeAnswer(answer));
}
function isCorrectLevelAnswer(number, answer) {
  return LEVEL_ANSWERS[number].includes(normalizeAnswer(answer));
}

// Roadmap shown (greyed out) on the level-select screen so the growth path
// toward the full Carnie syllabus is visible even though only 1-3 are live.
const ROADMAP = [
  'Adjectives & Adverbs',
  'Auxiliaries & do-support',
  'Wh-movement & questions',
  'Embedded clauses (CP recursion)',
  'Raising',
  'Control',
];
