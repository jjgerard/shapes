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
// The conventional X-bar notation with the actual category substituted in
// -- "NP"/"N′"/"N⁰" rather than a generic "XP" plus a separate caption
// naming the category.
function xbarLabel(shape, number) {
  return XBAR_LEVELS[number].code.replace('X', shape);
}

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
    description: 'Combine every piece into one connected shape, fully resolved, with one extra piece branching off and one more layer on top.',
    root: CP_(TP_(VP_adjoined())),
  },
  {
    id: 'name-them',
    kind: 'reveal',
    name: 'Mystery Level',
    description: '',
    root: CP_(TP_(VP_adjoined())),
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
  1: ['xp', 'x-bar phrase', 'phrase', 'phrase level', 'maximal projection', 'maximal phrase'],
  2: ["x'", 'x bar', 'x-bar', 'xbar', 'bar level', 'bar'],
  3: ['x0', 'xzero', 'x-zero', 'head', 'word'],
};
// Answers that are accepted but not the term we actually want students to
// land on -- still marked correct, just paired with a gentle nudge toward
// the more precise vocabulary.
const LEVEL_ANSWER_NOTES = {
  3: { word: 'Good instinct -- the precise term for this is "head."' },
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
function looseAnswerNote(number, answer) {
  const notes = LEVEL_ANSWER_NOTES[number];
  return notes ? notes[normalizeAnswer(answer)] : undefined;
}

// Hints for the Mystery Level's optional "Hint" button -- a conceptual
// nudge, not the accepted answer itself.
const SHAPE_HINTS = {
  C: 'Introduces a subordinate clause, like "that" or "if."',
  T: "Carries the sentence's tense/agreement -- an auxiliary like \"will\" or \"did\" lives here.",
  V: "The action or state word -- what's happening.",
  D: 'Picks out a specific referent -- "the," "a," "this," "my."',
  N: 'The thing being talked about.',
  P: 'Relates a phrase to something else in space, time, etc. -- "in," "on," "with."',
};
const LEVEL_HINTS = {
  1: 'The biggest, outermost layer of a piece -- everything else it needs is inside it.',
  2: 'A layer in between -- bigger than a bare word, smaller than the whole phrase.',
  3: "The smallest layer -- an actual word, not built out of anything smaller.",
};

// ---------------------------------------------------------------------------
// Level 2 sentences: pre-made, already-labeled X-bar trees (word matching --
// the category system is no longer a secret by this point, so every piece
// shows its full "DP / D′ / D⁰"-style label). Every head that gets a word
// dragged onto it carries `word` (the correct answer); `pos` additionally
// marks its place in the linear sentence, for the sentence-so-far readout --
// a head that's just the moved-away copy of another word (`isTrace: true`)
// still has to be matched like anything else, it just isn't part of the
// pronounced sentence, so it has no `pos` and reveals itself struck through
// once filled instead of taking on its category's color. A head with no
// audible content at all (tense with no auxiliary to carry it) shows
// `silent: true` (∅) and is never a match target.
// ---------------------------------------------------------------------------

// A DP "det + noun" (e.g. "the cat"), reused for every subject/object across
// the Level 2 sentences. `opts.detTrace`/`opts.nounTrace` mark the det/noun
// as a moved-away trace instead of a pronounced word, for the object DP left
// behind by wh-movement.
function wmDP(detWord, detPos, nounWord, nounPos, opts = {}) {
  const det = opts.detTrace
    ? { shape: 'D', number: 3, children: [], word: detWord, isTrace: true }
    : { shape: 'D', number: 3, children: [], word: detWord, pos: detPos };
  const noun = opts.nounTrace
    ? { shape: 'N', number: 3, children: [], word: nounWord, isTrace: true }
    : { shape: 'N', number: 3, children: [], word: nounWord, pos: nounPos };
  return { shape: 'D', number: 1, children: [
    { shape: 'D', number: 2, children: [
      det,
      { shape: 'N', number: 1, children: [ { shape: 'N', number: 2, children: [ noun ] } ] },
    ] },
  ] };
}

const LEVEL2_SUBLEVELS = [
  {
    id: 'the-cat',
    name: 'First Phrase',
    description: "Two pieces, matched by category alone -- you won't see the sentence until you've placed them.",
    hint: 'Drag each word onto the piece it belongs to.',
    root: wmDP('the', 1, 'cat', 2),
  },
  {
    id: 'the-cat-chased-the-mouse',
    name: '4 Pieces',
    description: 'The same idea, just with more pieces to match.',
    hint: "There's no auxiliary in this sentence, so Tense has no word of its own (∅) -- its tense just rides along on the verb.",
    root: {
      shape: 'T', number: 1, children: [
        wmDP('the', 1, 'cat', 2),
        { shape: 'T', number: 2, children: [
          { shape: 'T', number: 3, children: [], silent: true },
          { shape: 'V', number: 1, children: [
            { shape: 'V', number: 2, children: [
              { shape: 'V', number: 3, children: [], word: 'chased', pos: 3 },
              wmDP('the', 4, 'mouse', 5),
            ] },
          ] },
        ] },
      ],
    },
  },
  {
    id: 'did-the-cat-chase-the-mouse',
    name: 'More Pieces',
    description: 'A question this time -- one piece moves, and leaves a crossed-out trace behind where it started.',
    hint: 'For a yes/no question, Tense hops up into Complementizer, and leaves a crossed-out copy of itself behind in T.',
    root: {
      shape: 'C', number: 1, children: [
        { shape: 'C', number: 2, children: [
          { shape: 'C', number: 3, children: [], word: 'did', pos: 1 },
          { shape: 'T', number: 1, children: [
            wmDP('the', 2, 'cat', 3),
            { shape: 'T', number: 2, children: [
              { shape: 'T', number: 3, children: [], word: 'did', isTrace: true },
              { shape: 'V', number: 1, children: [
                { shape: 'V', number: 2, children: [
                  { shape: 'V', number: 3, children: [], word: 'chase', pos: 4 },
                  wmDP('the', 5, 'mouse', 6),
                ] },
              ] },
            ] },
          ] },
        ] },
      ],
    },
  },
  {
    id: 'which-mouse-did-the-cat-chase',
    name: 'Even More Pieces',
    description: 'A bigger question -- more than one piece moves this time, each leaving its own trace behind.',
    hint: 'The question phrase in the object position fronts all the way to Spec-CP, leaving a crossed-out copy of itself right where the verb needed it.',
    root: {
      shape: 'C', number: 1, children: [
        wmDP('which', 1, 'mouse', 2),
        { shape: 'C', number: 2, children: [
          { shape: 'C', number: 3, children: [], word: 'did', pos: 3 },
          { shape: 'T', number: 1, children: [
            wmDP('the', 4, 'cat', 5),
            { shape: 'T', number: 2, children: [
              { shape: 'T', number: 3, children: [], word: 'did', isTrace: true },
              { shape: 'V', number: 1, children: [
                { shape: 'V', number: 2, children: [
                  { shape: 'V', number: 3, children: [], word: 'chase', pos: 6 },
                  wmDP('which', null, 'mouse', null, { detTrace: true, nounTrace: true }),
                ] },
              ] },
            ] },
          ] },
        ] },
      ],
    },
  },
];

// ---------------------------------------------------------------------------
// Levels 3 & 4 both quiz against the SURFACE (pronounced) string of a
// sentence, reusing the exact same trees as Level 2. A node's "surface
// yield" is the sorted list of sentence positions (`pos`) of its
// pos-bearing descendants -- traces and silent heads contribute nothing,
// since they're not pronounced. If that yield is contiguous (no gaps) and
// covers 2+ words, that span of the sentence is a genuine constituent
// (whichever node/category produced it); every other 2+-word contiguous
// span in the sentence is NOT a constituent. Single words are always
// trivially constituents (every word is its own X⁰), so they're excluded
// from both pools -- testing them wouldn't be an interesting question.
// ---------------------------------------------------------------------------
function surfacePositions(node) {
  if (node.pos) return [node.pos];
  if (node.isTrace || node.silent) return [];
  const out = [];
  for (const c of node.children) out.push(...surfacePositions(c));
  return out;
}

// [{start, end, shape}], one entry per unique contiguous 2+-word span that
// some node's surface yield produces exactly (deduped by span; category is
// consistent across every node that shares a span, since bar-level never
// changes what category a node is).
function computeConstituentSpans(root) {
  const bySpan = new Map();
  (function walk(node) {
    const positions = surfacePositions(node).slice().sort((a, b) => a - b);
    if (positions.length >= 2) {
      const min = positions[0], max = positions[positions.length - 1];
      if (max - min + 1 === positions.length) bySpan.set(`${min}-${max}`, { start: min, end: max, shape: node.shape });
    }
    node.children.forEach(walk);
  })(root);
  return [...bySpan.values()];
}

// The linear surface sentence itself -- [{word, pos}], sorted -- read
// straight off the tree so it can never drift out of sync with it.
function surfaceTokens(root) {
  const out = [];
  (function walk(node) {
    if (node.pos) out.push({ word: node.word, pos: node.pos });
    node.children.forEach(walk);
  })(root);
  return out.sort((a, b) => a.pos - b.pos);
}

// Every possible 2+-word contiguous span of a sentence of this length --
// the constituent pool is a subset of this; non-constituents are the rest.
function allSpans(sentenceLength) {
  const out = [];
  for (let start = 1; start <= sentenceLength; start++) {
    for (let end = start + 1; end <= sentenceLength; end++) out.push({ start, end });
  }
  return out;
}

// Precomputed once per tree: the sentence, and the constituent /
// non-constituent span pools to sample questions from.
function buildQuizPools(root) {
  const tokens = surfaceTokens(root);
  const sentenceLength = tokens.length;
  const constituents = computeConstituentSpans(root);
  const constituentKeys = new Set(constituents.map(c => `${c.start}-${c.end}`));
  const nonConstituents = allSpans(sentenceLength).filter(s => !constituentKeys.has(`${s.start}-${s.end}`));
  return { tokens, sentenceLength, constituents, nonConstituents };
}

// Levels 3 & 4 both walk the same 3 Level 2 trees, in the same order,
// skipping "the cat" (id 'the-cat') -- with only 2 words, every possible
// span is trivially a constituent, so it can't support a real yes/no (or
// "which category") question at all.
const QUIZ_SUBLEVELS = LEVEL2_SUBLEVELS.filter(s => s.id !== 'the-cat').map(sub => {
  const pools = buildQuizPools(sub.root);
  return {
    id: sub.id,
    name: sub.name === '4 Pieces' ? 'The Cat Chased The Mouse'
      : sub.name === 'More Pieces' ? 'Did The Cat Chase The Mouse'
      : 'Which Mouse Did The Cat Chase',
    sentence: pools.tokens.map(t => t.word).join(' '),
    root: sub.root,
    pools,
  };
});

// Roadmap shown (greyed out) on the level-select screen so the growth path
// toward the full Carnie syllabus is visible even though only 1-3 are live.
const ROADMAP = [
  'Adjectives & Adverbs',
  'Embedded clauses (CP recursion)',
  'Raising',
  'Control',
];
