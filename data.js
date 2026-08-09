// ---------------------------------------------------------------------------
// Core data model for the Syntax Tree Builder.
//
// Everything here mirrors the physical "shapes + paperclips + magnets"
// activity: a SHAPE is a grammatical category, a NUMBER is a projection
// level. Students never see the CATEGORIES/level mapping until they earn it
// in the Mystery Level.
//
// The game ships in two MODES, which share every bit of engine code and
// differ only in the data below:
//
//   'prex'  Tree Basics -- two levels only, phrase (1) and head (2). Flat
//           trees in the style of Carnie's chapter 3, with the determiner
//           inside NP rather than heading a DP of its own, and no movement.
//           This is where the *idea* of a tree gets solid.
//   'xbar'  X-bar -- phrase (1), bar (1.5) and head (2), with an
//           intermediate projection inside every phrase, plus the movement
//           sentences. Carnie reaches this at chapter 6 and doesn't reach
//           movement until chapter 10.
//
// The bar level is 1.5 rather than 2 quite deliberately: a phrase is 1 and
// a head is 2 for the entire game, so switching phases never takes back
// something a student has already learned, and the number of the new layer
// says where it sits.
//
// A mode is a self-contained bundle: its own fragment inventory, its own
// legal-edge set, its own sub-levels, sentences and answer keys. setMode()
// swaps the module-level bindings the rest of the app reads, so no other
// file needs to know modes exist at all.
// ---------------------------------------------------------------------------

// Every category the game knows about. Which of them a given phase
// actually uses is a per-mode list (see `categories` in the specs below):
// the basic phase has no Complementizer -- nothing in its sentences needs
// one, and a shape with no example to attach it to is pure memorisation --
// while the X-bar phase has no Adjective or Adverb, since none of its
// sentences contain any. So the two new colours never have to sit next to
// the gold star, and the palette stays as far apart as it was with six.
const CATEGORIES = {
  C:   { shape: 'star',      color: '#e8b400', name: 'Complementizer' },
  T:   { shape: 'square',    color: '#3f9d5c', name: 'Tense' },
  V:   { shape: 'heart',     color: '#e2657c', name: 'Verb' },
  D:   { shape: 'circle',    color: '#d84a3b', name: 'Determiner' },
  N:   { shape: 'triangle',  color: '#3f8fd0', name: 'Noun' },
  P:   { shape: 'rectangle', color: '#9b59b6', name: 'Preposition' },
  Adj: { shape: 'pentagon',  color: '#e07b39', name: 'Adjective' },
  Adv: { shape: 'diamond',   color: '#14a0a0', name: 'Adverb' },
};

// Accepted free-text answers for the Mystery Level's shape slots
// (case-insensitive, any one of these counts). Shared by both modes -- what
// a shape MEANS doesn't change between them, only how many levels each one
// projects through.
const SHAPE_ANSWERS = {
  C: ['c', 'comp', 'complementizer'],
  T: ['t', 'tense'],
  V: ['v', 'verb'],
  D: ['d', 'det', 'determiner'],
  N: ['n', 'noun'],
  P: ['p', 'prep', 'preposition'],
  Adj: ['adj', 'adjective'],
  Adv: ['adv', 'adverb'],
};
const SHAPE_HINTS = {
  C: 'Introduces a subordinate clause, like "that" or "if."',
  T: "Carries the sentence's tense/agreement -- an auxiliary like \"will\" or \"did\" lives here.",
  V: "The action or state word -- what's happening.",
  D: 'Picks out a specific referent -- "the," "a," "this," "my."',
  N: 'The thing being talked about.',
  P: 'Relates a phrase to something else in space, time, etc. -- "in," "on," "with."',
  Adj: 'Describes a thing -- "fluffy," "red," "enormous."',
  Adv: 'Describes how, when or where something happens -- "quickly," "yesterday."',
};

// Roadmap shown (greyed out) on the level-select screen so the growth path
// toward the full syllabus is visible even though only 1-4 are live.
const ROADMAP = [
  'Adjectives & Adverbs',
  'Embedded clauses (CP recursion)',
  'Raising',
  'Control',
];

function normalizeAnswer(s) {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Movement is marked by tagging BOTH ends with the same id: `traceOf` on
// the position it moved out of, `moved` on the position it ended up in.
// Once every word inside both ends has been placed, Level 2 draws the
// movement -- an arrow from the gap to the landing site, plus an outline
// around each end when what moved was a whole phrase.
//
// Tagging the ends explicitly (rather than working them out from the shape
// of the tree) is what keeps this identical however the trees are drawn:
// the things that move are the same nodes either way, and a bar level
// merely inserts nodes in between, which movement doesn't touch.
//
// Nothing in the basic phase uses these -- it has no movement at all,
// following Carnie, where movement doesn't arrive until well after X-bar.
// ---------------------------------------------------------------------------
function movedTo(node, id) { node.moved = id; return node; }
function traceFor(node, id) { node.traceOf = id; return node; }

// How many wrong attempts in a row before Levels 1 and 2 stop letting you
// flounder and just show you one that works. Counted per "thing you're
// currently stuck on" -- since the last successful join in Level 1, and
// per word in Level 2 -- so it resets the moment you get somewhere, rather
// than accumulating across a whole puzzle.
const HINT_AFTER_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// Generic tree helpers -- these work on any {shape, number, children} node
// and any fragment list, so both modes share them.
// ---------------------------------------------------------------------------

// Which handout fragment does this node correspond to? Matched on category,
// level, and its exact ordered child list.
function fragmentIdFor(structures, node) {
  return structures.find(s =>
    s.shape === node.shape && s.number === node.number &&
    s.children.length === node.children.length &&
    s.children.every((c, i) => c.shape === node.children[i].shape && c.number === node.children[i].number)
  )?.id;
}
function collectFragmentIds(structures, node, out = new Set()) {
  const id = fragmentIdFor(structures, node);
  if (id) out.add(id);
  for (const c of node.children) collectFragmentIds(structures, c, out);
  return out;
}
// The actual pre-built pieces (handout item numbers) needed to assemble a
// target, with counts -- e.g. two separate DP chains (subject + object) both
// need their own copies. A leaf with no children of its own is never counted
// separately: it's already part of whichever piece built it (a head is baked
// into its phrase), OR it's a branch deliberately left unresolved.
function collectFragmentUsage(structures, node, counts = {}) {
  if (node.children.length > 0) {
    const id = fragmentIdFor(structures, node);
    if (id) counts[id] = (counts[id] || 0) + 1;
  }
  for (const c of node.children) collectFragmentUsage(structures, c, counts);
  return counts;
}

// ---------------------------------------------------------------------------
// Levels 3 & 4 both quiz against the SURFACE (pronounced) string of a
// sentence, reusing the exact same trees as Level 2. A node's "surface
// yield" is the sorted list of sentence positions (`pos`) of its
// pos-bearing descendants -- traces and silent heads contribute nothing,
// since they're not pronounced. If that yield is contiguous (no gaps) and
// covers 2+ words, that span of the sentence is a genuine constituent
// (whichever node/category produced it); every other 2+-word contiguous
// span in the sentence is NOT a constituent. Single words are always
// trivially constituents (every word is its own head), so they're excluded
// from Level 3's yes/no pools -- but Level 4 asks WHICH CATEGORY, so a
// single word is a perfectly good (and different) question there.
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
// consistent across every node that shares a span, since projection level
// never changes what category a node is).
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

// The linear surface sentence itself -- [{word, pos, shape}], sorted --
// read straight off the tree so it can never drift out of sync with it.
function surfaceTokens(root) {
  const out = [];
  (function walk(node) {
    if (node.pos) out.push({ word: node.word, pos: node.pos, shape: node.shape });
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
// Positions where a PHRASE covers exactly one word -- "jump" in "the
// fluffy cat will jump" is both a VP and a V⁰. Level 4 accepts either
// sticker for these, because both are genuinely right; Level 3 still
// leaves single words alone, since every one of them is a constituent
// (at minimum its own head) and so "one word, say yes" would be a
// winning shortcut rather than a question.
function computeOneWordPhrases(root) {
  const out = new Set();
  (function walk(node) {
    if (node.number === 1) {
      const positions = surfacePositions(node);
      if (positions.length === 1) out.add(positions[0]);
    }
    node.children.forEach(walk);
  })(root);
  return out;
}

function buildQuizPools(root) {
  const tokens = surfaceTokens(root);
  const sentenceLength = tokens.length;
  const constituents = computeConstituentSpans(root);
  const constituentKeys = new Set(constituents.map(c => `${c.start}-${c.end}`));
  const nonConstituents = allSpans(sentenceLength).filter(s => !constituentKeys.has(`${s.start}-${s.end}`));
  const oneWordPhrases = computeOneWordPhrases(root);
  const headConstituents = tokens.map(t => ({
    start: t.pos, end: t.pos, shape: t.shape, alsoPhrase: oneWordPhrases.has(t.pos),
  }));
  return { tokens, sentenceLength, constituents, nonConstituents, headConstituents };
}

function titleCase(sentence) {
  return sentence.replace(/\b\w/g, ch => ch.toUpperCase());
}

// ---------------------------------------------------------------------------
// Mode assembly: takes a mode spec (the raw data below) and precomputes
// everything derived from it -- the legal-edge set, each build sub-level's
// piece inventory, and the quiz pools for each sentence.
// ---------------------------------------------------------------------------
function buildMode(spec) {
  const mode = { ...spec };

  // Every legal (parent -> child) plug derived from this mode's fragments.
  // A connection is only allowed if it appears in this set -- this is what
  // makes "shortcut" clips impossible: there is no legal edge that skips an
  // intermediate projection the mode believes in.
  mode.legalEdges = new Set();
  for (const s of mode.structures) {
    for (const c of s.children) mode.legalEdges.add(`${s.shape}${s.number}>${c.shape}${c.number}`);
  }

  for (const sub of mode.level1) {
    if (sub.kind !== 'build') continue;
    sub.fragmentIds = [...collectFragmentIds(mode.structures, sub.root)].sort((a, b) => a - b);
    const counts = collectFragmentUsage(mode.structures, sub.root);
    sub.inventory = Object.entries(counts)
      .map(([id, count]) => ({ id: Number(id), count }))
      .sort((a, b) => a.id - b.id);
  }

  // Levels 3 & 4 walk the same Level 2 trees, in the same order, skipping
  // any sentence short enough that EVERY possible span is trivially a
  // constituent -- with no non-constituent pool there's no real yes/no
  // question to ask.
  // `skipConstituency` keeps a sentence out of Level 3 while leaving it in
  // Level 4 -- for a sentence whose only multi-word constituents are the
  // subject and the whole clause, Level 3 would ask the same two questions
  // over and over, but Level 4 still has every word to ask about.
  mode.quiz = mode.level2
    .filter(sub => buildQuizPools(sub.root).nonConstituents.length > 0)
    .map(sub => {
      const pools = buildQuizPools(sub.root);
      const sentence = pools.tokens.map(t => t.word).join(' ');
      return {
        id: sub.id,
        name: titleCase(sentence),
        sentence,
        root: sub.root,
        pools,
        skipConstituency: !!sub.skipConstituency,
        // How many in a row finish the sub-level. Level 4 additionally caps
        // this at the size of its own question pool when the quiz opens, so
        // a short sentence can never demand more distinct questions than it
        // actually has.
        streakTarget: sub.streakTarget || 10,
      };
    });

  // Level 3 draws from a subset of Level 4's sentences (see
  // `skipConstituency`), so the two levels have their own lists.
  mode.quizConstituency = mode.quiz.filter(q => !q.skipConstituency);

  // Which categories actually head a phrase in this phase. In the basic
  // phase the determiner never does -- Carnie's chapter 3 rule is
  // NP → D N, and the DP hypothesis doesn't arrive until chapter 7, after
  // X-bar -- so Level 4 must not offer a "DP" sticker there. Offering an
  // option that can never be right would teach the thing this phase is
  // specifically not teaching yet.
  mode.phraseCategories = new Set();
  for (const s of mode.structures) {
    if (s.number === 1) mode.phraseCategories.add(s.shape);
    for (const c of s.children) if (c.number === 1) mode.phraseCategories.add(c.shape);
  }
  mode.numbers = Object.keys(mode.levels).map(Number).sort((a, b) => a - b);
  mode.phraseNumber = mode.numbers[0];
  mode.headNumber = mode.numbers[mode.numbers.length - 1];
  return mode;
}

// ===========================================================================
// MODE 1 -- "Tree Basics" (pre-X). Two levels: phrase and head. Trees are
// flat, in the traditional phrase-structure style: TP -> DP T VP, with no
// intermediate projection anywhere. The point of this mode is that a
// student can get the whole idea of a tree -- what dominates what, what
// counts as a unit -- without also having to hold the bar level in mind.
// ===========================================================================

const PREX_LEVELS = {
  1: { code: 'XP', name: 'Phrase' },
  2: { code: 'X⁰', name: 'Head (the word itself)' },
};

// Carnie's chapter 3 rules, as far as these sentences need them. Note NP
// with the determiner INSIDE it, not DP: the DP hypothesis is chapter 7,
// i.e. after X-bar, so a student meeting flat trees for the first time
// shouldn't be seeing it yet. No complementizer either -- nothing here
// needs one.
const PREX_STRUCTURES = [
  { id: 1,  shape: 'N', number: 1, children: [ { shape: 'D', number: 2 }, { shape: 'N', number: 2 } ], rule: 'NP → D + N' },
  { id: 2,  shape: 'N', number: 1, children: [ { shape: 'D', number: 2 }, { shape: 'Adj', number: 1 }, { shape: 'N', number: 2 } ], rule: 'NP → D + AdjP + N' },
  { id: 3,  shape: 'Adj', number: 1, children: [ { shape: 'Adj', number: 2 } ], rule: 'AdjP → Adj' },
  { id: 4,  shape: 'Adv', number: 1, children: [ { shape: 'Adv', number: 2 } ], rule: 'AdvP → Adv' },
  { id: 5,  shape: 'V', number: 1, children: [ { shape: 'V', number: 2 } ], rule: 'VP → V' },
  { id: 6,  shape: 'V', number: 1, children: [ { shape: 'V', number: 2 }, { shape: 'N', number: 1 } ], rule: 'VP → V + NP' },
  { id: 7,  shape: 'V', number: 1, children: [ { shape: 'Adv', number: 1 }, { shape: 'V', number: 2 }, { shape: 'P', number: 1 } ], rule: 'VP → AdvP + V + PP' },
  { id: 8,  shape: 'P', number: 1, children: [ { shape: 'P', number: 2 }, { shape: 'N', number: 1 } ], rule: 'PP → P + NP' },
  { id: 9,  shape: 'T', number: 1, children: [ { shape: 'N', number: 1 }, { shape: 'T', number: 2 }, { shape: 'V', number: 1 } ], rule: 'TP → NP + T + VP' },
  { id: 10, shape: 'T', number: 2, children: [], rule: 'T (bare head)' },
  { id: 11, shape: 'V', number: 2, children: [], rule: 'V (bare head)' },
  { id: 12, shape: 'D', number: 2, children: [], rule: 'D (bare head)' },
  { id: 13, shape: 'N', number: 2, children: [], rule: 'N (bare head)' },
  { id: 14, shape: 'P', number: 2, children: [], rule: 'P (bare head)' },
  { id: 15, shape: 'Adj', number: 2, children: [], rule: 'Adj (bare head)' },
  { id: 16, shape: 'Adv', number: 2, children: [], rule: 'Adv (bare head)' },
];

const pxHead = (shape, extra = {}) => ({ shape, number: 2, children: [], ...extra });
function pxNP(det, noun) {
  return { shape: 'N', number: 1, children: [ det, noun ] };
}
function pxNPAdj(det, adj, noun) {
  return { shape: 'N', number: 1, children: [ det, { shape: 'Adj', number: 1, children: [ adj ] }, noun ] };
}
function pxAdvP(adv) { return { shape: 'Adv', number: 1, children: [ adv ] }; }
function pxPP(prep, np) { return { shape: 'P', number: 1, children: [ prep, np ] }; }
function pxTP(np, t, vp) { return { shape: 'T', number: 1, children: [ np, t, vp ] }; }

// Level 1 is abstract shapes only -- no words -- but its targets are the
// shapes of the sentences Level 2 goes on to use, so nothing is ever built
// that never turns up again.
function pxBareNP() { return pxNP(pxHead('D'), pxHead('N')); }
function pxBareNPAdj() { return pxNPAdj(pxHead('D'), pxHead('Adj'), pxHead('N')); }
function pxSimpleClause() {
  return pxTP(pxBareNP(), pxHead('T'), { shape: 'V', number: 1, children: [ pxHead('V'), pxBareNP() ] });
}
function pxFullClause() {
  return pxTP(
    pxBareNPAdj(),
    pxHead('T'),
    { shape: 'V', number: 1, children: [ pxAdvP(pxHead('Adv')), pxHead('V'), pxPP(pxHead('P'), pxBareNP()) ] },
  );
}

const PREX_LEVEL1 = [
  {
    id: 'first-join',
    kind: 'tutorial',
    name: 'First Join',
    description: 'Snap two pieces together, then use the scissors to pull them apart again.',
    pieceIds: [6, 1],
  },
  {
    id: 'four-pieces',
    kind: 'build',
    name: 'Four Pieces',
    description: 'Combine four pieces into one connected shape.',
    root: pxSimpleClause(),
  },
  {
    id: 'one-more-branch',
    kind: 'build',
    name: 'More Pieces',
    description: 'Combine every piece into one connected shape, with two extra pieces branching off.',
    root: pxFullClause(),
  },
  {
    id: 'name-them',
    kind: 'reveal',
    name: 'Mystery Level',
    description: '',
    root: pxFullClause(),
  },
];

const PREX_LEVEL2 = [
  {
    id: 'the-cat',
    name: 'First Phrase',
    description: "Two pieces, matched by category alone -- you won't see the phrase until you've placed them.",
    hint: 'Drag each word onto the piece it belongs to.',
    root: pxNP(pxHead('D', { word: 'the', pos: 1 }), pxHead('N', { word: 'cat', pos: 2 })),
  },
  {
    id: 'the-cat-chased-the-mouse',
    name: '4 Pieces',
    description: 'The same idea, just with more pieces to match.',
    hint: "There's no auxiliary in this sentence, so Tense has no word of its own (∅) -- its tense just rides along on the verb.",
    root: pxTP(
      pxNP(pxHead('D', { word: 'the', pos: 1 }), pxHead('N', { word: 'cat', pos: 2 })),
      pxHead('T', { silent: true }),
      { shape: 'V', number: 1, children: [
        pxHead('V', { word: 'chased', pos: 3 }),
        pxNP(pxHead('D', { word: 'the', pos: 4 }), pxHead('N', { word: 'mouse', pos: 5 })),
      ] },
    ),
  },
  {
    // Kept out of Level 3: its only multi-word constituents are the subject
    // and the whole clause, so a yes/no quiz would ask the same two
    // questions forever. Level 4 still uses it -- "will" against "jump" is
    // exactly the Tense/Verb contrast it exists to show.
    id: 'the-fluffy-cat-will-jump',
    name: 'Tense and Verb',
    description: 'This one has a word sitting in Tense of its own, right next to the verb.',
    hint: '"Will" isn\'t the action -- it carries the tense. The action is "jump". They are two different pieces.',
    skipConstituency: true,
    streakTarget: 5,
    root: pxTP(
      pxNPAdj(pxHead('D', { word: 'the', pos: 1 }), pxHead('Adj', { word: 'fluffy', pos: 2 }), pxHead('N', { word: 'cat', pos: 3 })),
      pxHead('T', { word: 'will', pos: 4 }),
      { shape: 'V', number: 1, children: [ pxHead('V', { word: 'jump', pos: 5 }) ] },
    ),
  },
  {
    id: 'the-fluffy-cat-quickly-jumped-on-the-table',
    name: 'Describing Words',
    description: 'Two describing words in one sentence -- one describes the cat, the other describes the jumping.',
    hint: '"Fluffy" describes the cat, so it sits inside the noun phrase. "Quickly" describes the jumping, so it sits inside the verb phrase.',
    root: pxTP(
      pxNPAdj(pxHead('D', { word: 'the', pos: 1 }), pxHead('Adj', { word: 'fluffy', pos: 2 }), pxHead('N', { word: 'cat', pos: 3 })),
      pxHead('T', { silent: true }),
      { shape: 'V', number: 1, children: [
        pxAdvP(pxHead('Adv', { word: 'quickly', pos: 4 })),
        pxHead('V', { word: 'jumped', pos: 5 }),
        pxPP(pxHead('P', { word: 'on', pos: 6 }),
             pxNP(pxHead('D', { word: 'the', pos: 7 }), pxHead('N', { word: 'table', pos: 8 }))),
      ] },
    ),
  },
];

// ===========================================================================
// MODE 2 -- "X-bar". The full three-level system, exactly as the physical
// Week 10 seminar handout has it.
// ===========================================================================

// The bar level is numbered 1.5, not 2, so nothing a student learned in
// the basic phase is taken back: a phrase is 1 and a head is 2 for the
// whole game, and the new layer slots in between with a number that says
// exactly that. Renumbering the head from 2 to 3 partway through would
// mean telling someone the one thing they had finally got is now wrong.
const XBAR_LEVELS = {
  1: { code: 'XP', name: 'Phrase (maximal projection)' },
  1.5: { code: "X′", name: 'Bar level (intermediate projection)' },
  2: { code: 'X⁰', name: 'Head (terminal / lexical item)' },
};

// The 19 buildable fragments, in the same order/numbering as the physical
// handout. `parent` is the root node of the fragment; `children` are its
// direct daughters (already-resolved heads are listed inline with no
// further children of their own).
const XBAR_STRUCTURES = [
  { id: 1,  shape: 'T', number: 1, children: [ { shape: 'D', number: 1 }, { shape: 'T', number: 1.5 } ], rule: "XP → Spec + X′" },
  { id: 2,  shape: 'T', number: 1.5, children: [ { shape: 'T', number: 2 }, { shape: 'V', number: 1 } ], rule: "X′ → X⁰ + Complement" },
  { id: 3,  shape: 'V', number: 1, children: [ { shape: 'V', number: 1.5 } ], rule: "XP → X′ (no specifier)" },
  { id: 4,  shape: 'V', number: 1.5, children: [ { shape: 'V', number: 1.5 }, { shape: 'P', number: 1 } ], rule: "X′ → X′ + Adjunct" },
  { id: 5,  shape: 'V', number: 1.5, children: [ { shape: 'V', number: 2 } ], rule: "X′ → X⁰ (intransitive)" },
  { id: 6,  shape: 'V', number: 1.5, children: [ { shape: 'V', number: 2 }, { shape: 'D', number: 1 } ], rule: "X′ → X⁰ + Complement" },
  { id: 7,  shape: 'D', number: 1, children: [ { shape: 'D', number: 1.5 } ], rule: "XP → X′ (no specifier)" },
  { id: 8,  shape: 'D', number: 1.5, children: [ { shape: 'D', number: 2 }, { shape: 'N', number: 1 } ], rule: "X′ → X⁰ + Complement" },
  { id: 9,  shape: 'N', number: 1, children: [ { shape: 'N', number: 1.5 } ], rule: "XP → X′ (no specifier)" },
  { id: 10, shape: 'N', number: 1.5, children: [ { shape: 'N', number: 2 } ], rule: "X′ → X⁰" },
  { id: 11, shape: 'C', number: 1, children: [ { shape: 'D', number: 1 }, { shape: 'C', number: 1.5 } ], rule: "XP → Spec + X′" },
  { id: 12, shape: 'C', number: 1.5, children: [ { shape: 'C', number: 2 }, { shape: 'T', number: 1 } ], rule: "X′ → X⁰ + Complement" },
  { id: 13, shape: 'P', number: 1, children: [ { shape: 'P', number: 1.5 } ], rule: "XP → X′ (no specifier)" },
  { id: 14, shape: 'P', number: 1.5, children: [ { shape: 'P', number: 2 }, { shape: 'D', number: 1 } ], rule: "X′ → X⁰ + Complement" },
  { id: 15, shape: 'C', number: 2, children: [], rule: "X⁰ (bare head)" },
  { id: 16, shape: 'T', number: 2, children: [], rule: "X⁰ (bare head)" },
  { id: 17, shape: 'D', number: 2, children: [], rule: "X⁰ (bare head)" },
  { id: 18, shape: 'N', number: 2, children: [], rule: "X⁰ (bare head)" },
  { id: 19, shape: 'P', number: 2, children: [], rule: "X⁰ (bare head)" },
];

function NP_() {
  return { shape: 'N', number: 1, children: [
    { shape: 'N', number: 1.5, children: [ { shape: 'N', number: 2, children: [] } ] },
  ] };
}
function DP_() {
  return { shape: 'D', number: 1, children: [
    { shape: 'D', number: 1.5, children: [ { shape: 'D', number: 2, children: [] }, NP_() ] },
  ] };
}
function PP_() {
  return { shape: 'P', number: 1, children: [
    { shape: 'P', number: 1.5, children: [ { shape: 'P', number: 2, children: [] }, DP_() ] },
  ] };
}
function VP_adjoined() {
  return { shape: 'V', number: 1, children: [
    { shape: 'V', number: 1.5, children: [
      { shape: 'V', number: 1.5, children: [ { shape: 'V', number: 2, children: [] }, DP_() ] },
      PP_(),
    ] },
  ] };
}
function TP_(vp) {
  return { shape: 'T', number: 1, children: [
    DP_(),
    { shape: 'T', number: 1.5, children: [ { shape: 'T', number: 2, children: [] }, vp ] },
  ] };
}
function CP_(tp) {
  return { shape: 'C', number: 1, children: [
    DP_(),
    { shape: 'C', number: 1.5, children: [ { shape: 'C', number: 2, children: [] }, tp ] },
  ] };
}

// A bare partial pattern used by the "four pieces" sub-level: T1 with a
// subject slot and a T' slot, where the subject and the verb both stop one
// level short of being fully resolved (their branches are deliberately left
// open -- that's the point of this checkpoint).
function partialTDV() {
  return { shape: 'T', number: 1, children: [
    { shape: 'D', number: 1, children: [ { shape: 'D', number: 1.5, children: [] } ] },
    { shape: 'T', number: 1.5, children: [
      { shape: 'T', number: 2, children: [] },
      { shape: 'V', number: 1, children: [ { shape: 'V', number: 1.5, children: [] } ] },
    ] },
  ] };
}

const XBAR_LEVEL1 = [
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

// A DP "det + noun" (e.g. "the cat"), reused for every subject/object across
// the X-bar Level 2 sentences.
function wmDP(detWord, detPos, nounWord, nounPos, opts = {}) {
  const det = opts.detTrace
    ? { shape: 'D', number: 2, children: [], word: detWord, isTrace: true }
    : { shape: 'D', number: 2, children: [], word: detWord, pos: detPos };
  const noun = opts.nounTrace
    ? { shape: 'N', number: 2, children: [], word: nounWord, isTrace: true }
    : { shape: 'N', number: 2, children: [], word: nounWord, pos: nounPos };
  return { shape: 'D', number: 1, children: [
    { shape: 'D', number: 1.5, children: [
      det,
      { shape: 'N', number: 1, children: [ { shape: 'N', number: 1.5, children: [ noun ] } ] },
    ] },
  ] };
}

const XBAR_LEVEL2 = [
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
        { shape: 'T', number: 1.5, children: [
          { shape: 'T', number: 2, children: [], silent: true },
          { shape: 'V', number: 1, children: [
            { shape: 'V', number: 1.5, children: [
              { shape: 'V', number: 2, children: [], word: 'chased', pos: 3 },
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
        { shape: 'C', number: 1.5, children: [
          movedTo({ shape: 'C', number: 2, children: [], word: 'did', pos: 1 }, 'aux'),
          { shape: 'T', number: 1, children: [
            wmDP('the', 2, 'cat', 3),
            { shape: 'T', number: 1.5, children: [
              traceFor({ shape: 'T', number: 2, children: [], word: 'did', isTrace: true }, 'aux'),
              { shape: 'V', number: 1, children: [
                { shape: 'V', number: 1.5, children: [
                  { shape: 'V', number: 2, children: [], word: 'chase', pos: 4 },
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
    streakTarget: 5,
    root: {
      shape: 'C', number: 1, children: [
        movedTo(wmDP('which', 1, 'mouse', 2), 'wh'),
        { shape: 'C', number: 1.5, children: [
          movedTo({ shape: 'C', number: 2, children: [], word: 'did', pos: 3 }, 'aux'),
          { shape: 'T', number: 1, children: [
            wmDP('the', 4, 'cat', 5),
            { shape: 'T', number: 1.5, children: [
              traceFor({ shape: 'T', number: 2, children: [], word: 'did', isTrace: true }, 'aux'),
              { shape: 'V', number: 1, children: [
                { shape: 'V', number: 1.5, children: [
                  { shape: 'V', number: 2, children: [], word: 'chase', pos: 6 },
                  traceFor(wmDP('which', null, 'mouse', null, { detTrace: true, nounTrace: true }), 'wh'),
                ] },
              ] },
            ] },
          ] },
        ] },
      ],
    },
  },
];

// ===========================================================================
// The mode registry.
// ===========================================================================

const MODES = {
  prex: buildMode({
    id: 'prex',
    name: 'Tree Basics',
    tagline: 'Phrases and words',
    blurb: 'Two levels only: a phrase, and the word at the bottom of it. Start here to get the idea of a tree solid.',
    levels: PREX_LEVELS,
    categories: ['T', 'V', 'D', 'N', 'P', 'Adj', 'Adv'],
    structures: PREX_STRUCTURES,
    level1: PREX_LEVEL1,
    level2: PREX_LEVEL2,
    levelAnswers: {
      1: ['xp', 'phrase', 'phrase level', 'a phrase', 'maximal projection', 'group', 'unit'],
      2: ['x0', 'xzero', 'x-zero', 'head', 'word', 'the word', 'terminal'],
    },
    // Accepted but not the term we want them to land on -- marked correct,
    // then nudged toward the more precise vocabulary.
    levelAnswerNotes: {
      1: { group: 'That\'s the idea -- the precise term is "phrase."', unit: 'That\'s the idea -- the precise term is "phrase."' },
      2: { word: 'Good instinct -- the precise term for this is "head."', 'the word': 'Good instinct -- the precise term for this is "head."' },
    },
    levelHints: {
      1: 'The bigger layer -- a whole group of words that behaves as one unit.',
      2: 'The smaller layer -- one actual word, not built out of anything smaller.',
    },
    // The one wording to show when the Mystery Level gives up and tells
    // you the answer. Must itself be an accepted answer above, or being
    // told the answer would leave you unable to enter it.
    levelCanonical: { 1: 'Phrase', 2: 'Head' },
  }),
  xbar: buildMode({
    id: 'xbar',
    name: 'X-bar',
    tagline: 'Phrase, bar and head',
    blurb: 'The full three-level system, with an intermediate bar level inside every phrase.',
    levels: XBAR_LEVELS,
    categories: ['C', 'T', 'V', 'D', 'N', 'P'],
    structures: XBAR_STRUCTURES,
    level1: XBAR_LEVEL1,
    level2: XBAR_LEVEL2,
    levelAnswers: {
      1: ['xp', 'x-bar phrase', 'phrase', 'phrase level', 'maximal projection', 'maximal phrase'],
      1.5: ["x'", 'x bar', 'x-bar', 'xbar', 'bar level', 'bar', 'in between', 'middle'],
      2: ['x0', 'xzero', 'x-zero', 'head', 'word'],
    },
    levelAnswerNotes: {
      1.5: {
        'in between': 'That\'s exactly it -- the name for this layer is "bar."',
        middle: 'That\'s exactly it -- the name for this layer is "bar."',
      },
      2: { word: 'Good instinct -- the precise term for this is "head."' },
    },
    levelHints: {
      1: 'The biggest, outermost layer of a piece -- everything else it needs is inside it.',
      1.5: 'A layer in between -- bigger than a bare word, smaller than the whole phrase. Its number says so.',
      2: 'The smallest layer -- an actual word, not built out of anything smaller.',
    },
    levelCanonical: { 1: 'Phrase', 1.5: 'Bar level', 2: 'Head' },
  }),
};
const MODE_IDS = ['prex', 'xbar'];
const DEFAULT_MODE_ID = 'prex';

// ---------------------------------------------------------------------------
// The active mode. setMode() rebinds the names every other file reads, so
// nothing outside this file has to know which mode is running.
// ---------------------------------------------------------------------------
let MODE = null;
let STRUCTURES = [];
let LEVEL1_SUBLEVELS = [];
let LEVEL2_SUBLEVELS = [];
let QUIZ_SUBLEVELS = [];
let QUIZ_CONSTITUENCY_SUBLEVELS = [];   // Level 3's subset (see skipConstituency)
let MODE_CATEGORIES = [];               // which categories this phase actually uses
let MODE_PHRASE_CATEGORIES = new Set(); // ...and which of them head a phrase in it
let PROJECTION_LEVELS = {};   // number -> {code, name}
let LEVEL_NUMBERS = [];       // e.g. [1,2] (pre-X) or [1,2,3] (X-bar)
let PHRASE_NUMBER = 1;
let HEAD_NUMBER = 2;

function setMode(id) {
  MODE = MODES[id] || MODES[DEFAULT_MODE_ID];
  STRUCTURES = MODE.structures;
  LEVEL1_SUBLEVELS = MODE.level1;
  LEVEL2_SUBLEVELS = MODE.level2;
  QUIZ_SUBLEVELS = MODE.quiz;
  QUIZ_CONSTITUENCY_SUBLEVELS = MODE.quizConstituency;
  MODE_CATEGORIES = MODE.categories;
  MODE_PHRASE_CATEGORIES = MODE.phraseCategories;
  PROJECTION_LEVELS = MODE.levels;
  LEVEL_NUMBERS = MODE.numbers;
  PHRASE_NUMBER = MODE.phraseNumber;
  HEAD_NUMBER = MODE.headNumber;
  return MODE;
}

// The conventional notation with the actual category substituted in --
// "NP"/"N′"/"N⁰" rather than a generic "XP" plus a separate caption naming
// the category.
function nodeLabel(shape, number) {
  const level = PROJECTION_LEVELS[number];
  return level ? level.code.replace('X', shape) : `${shape}${number}`;
}

function isLegalEdge(parentShape, parentNumber, childShape, childNumber) {
  return MODE.legalEdges.has(`${parentShape}${parentNumber}>${childShape}${childNumber}`);
}

function isCorrectShapeAnswer(catKey, answer) {
  return SHAPE_ANSWERS[catKey].includes(normalizeAnswer(answer));
}
function isCorrectLevelAnswer(number, answer) {
  return (MODE.levelAnswers[number] || []).includes(normalizeAnswer(answer));
}
function looseAnswerNote(number, answer) {
  const notes = MODE.levelAnswerNotes[number];
  return notes ? notes[normalizeAnswer(answer)] : undefined;
}
function levelHint(number) {
  return MODE.levelHints[number];
}
// The answer to show once the Mystery Level stops asking and just tells
// you. Shapes use their full category name, which every SHAPE_ANSWERS list
// already accepts.
function levelCanonicalAnswer(number) {
  return MODE.levelCanonical[number];
}
function shapeCanonicalAnswer(catKey) {
  return CATEGORIES[catKey].name;
}
