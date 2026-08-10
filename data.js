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

// Locked, numbered cards shown after the last live level, so the growth
// path stays visible. Only the COUNT is rendered -- a title would name what
// a later level exists to teach. Empty now that the twelve levels run all
// the way from a first pair of shapes to a full X-bar tree built one node
// at a time; add entries here when there is more to come.
const ROADMAP = [];

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
  // Only the X-bar phase has a Level 9: combining phrases means choosing
  // between a specifier and a complement, and the flat basic phase has
  // neither. The default keeps every phase-agnostic caller honest.
  mode.level9 = spec.level9 || [];
  mode.level10 = spec.level10 || [];
  mode.level11 = spec.level11 || [];
  mode.level12 = spec.level12 || [];

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
    name: 'Full Sentence',
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
    // Named for its position in the level, not its contents. The card sits
    // in a list you read before you open it, so anything it says about the
    // words is a spoiler for the puzzle underneath -- the same reason the
    // X-bar level's cards only ever count pieces.
    name: 'Another Sentence',
    description: 'A different handful of pieces, doing the same job.',
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
    name: 'Last Sentence',
    description: 'The most pieces in this level. Take your time with it.',
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
// LEVEL 9 -- combining whole phrases.
//
// Every earlier level hands over pieces that already say what goes under
// what. Here a piece is a whole phrase with its empty positions showing,
// and the student decides which phrase fills which position.
//
// A `slot` child is one of those empty positions. `accepts` lists what may
// fill it, keyed shape+number -- and that list IS the grammar of this level:
// C′ selects a TP, T′ selects a VP, V′ and P′ select a DP, and a specifier
// takes a DP. Nothing about selection is written into the editor, so the
// only way to change what fits where is to change the data here.
// ===========================================================================

const SPEC = (accepts) => ({ slot: 'spec', accepts });
const COMP = (accepts) => ({ slot: 'comp', accepts });
// A head position standing empty. Only Level 10 uses one: it is where an
// auxiliary lands when it raises to C.
const HEAD = (accepts) => ({ slot: 'head', accepts });

// A complete DP -- "the cat", or the bare shape of one when no words are in
// play. It has no slots of its own, which makes it the universal plug: the
// only thing any specifier will take, and the only thing a verb or a
// preposition will take as its complement.
function cbDP(det, noun, opts = {}) {
  const d = { shape: 'D', number: 2, children: [] };
  const n = { shape: 'N', number: 2, children: [] };
  if (det) d.word = det;
  if (noun) n.word = noun;
  const dp = { shape: 'D', number: 1, children: [
    { shape: 'D', number: 1.5, children: [
      d,
      { shape: 'N', number: 1, children: [ { shape: 'N', number: 1.5, children: [ n ] } ] },
    ] },
  ] };
  // Level 10 marks the DP that fronts in a wh-question. `movable` is what
  // may be carried to a landing site; `mustMove` is what the round isn't
  // finished without.
  if (opts.movable) dp.movable = true;
  if (opts.mustMove) dp.mustMove = true;
  return dp;
}
function cbTP(t0 = { shape: 'T', number: 2, children: [] }) {
  return { shape: 'T', number: 1, children: [
    SPEC(['D1']),
    { shape: 'T', number: 1.5, children: [ t0, COMP(['V1']) ] },
  ] };
}
function cbCP(c0 = { shape: 'C', number: 2, children: [] }) {
  return { shape: 'C', number: 1, children: [
    SPEC(['D1']),
    { shape: 'C', number: 1.5, children: [ c0, COMP(['T1']) ] },
  ] };
}
function cbVP(word) {
  const v = { shape: 'V', number: 2, children: [] };
  if (word) v.word = word;
  return { shape: 'V', number: 1, children: [
    { shape: 'V', number: 1.5, children: [ v, COMP(['D1']) ] },
  ] };
}
// An intransitive VP: no complement position at all, so it is complete as
// it stands. Its job in Level 9 is to be something that can only ever go
// INTO a slot, never receive one.
function cbVPbare(word) {
  const v = { shape: 'V', number: 2, children: [] };
  if (word) v.word = word;
  return { shape: 'V', number: 1, children: [
    { shape: 'V', number: 1.5, children: [ v ] },
  ] };
}

// `goal` is what finishes a round:
//   'connect'   every piece joined into one tree. Leftover empty slots are
//               fine -- you were not given a piece for them. This is the
//               only honest test for the abstract rounds, several of which
//               have more than one correct answer.
//   'sentence'  one tree, no empty positions left, and the words come out
//               in the right order. Reversing the two DPs in a transitive
//               sentence builds a perfectly well-formed tree of the wrong
//               sentence, and that is exactly the mistake worth catching.
const XBAR_LEVEL9 = [
  {
    id: 'combine-two',
    name: 'Two Pieces',
    description: 'Two phrases at a time. Find the one position each fits.',
    goal: 'connect',
    rounds: [
      { hint: 'Drag one phrase into the empty position it fits. Only one of them can move into the other.',
        pieces: [ cbVP(), cbDP() ] },
      { hint: 'Same DP, different piece. This one has two empty positions — only one of them takes a DP.',
        pieces: [ cbTP(), cbDP() ] },
      { hint: 'Neither of these is a DP, so the specifier stays empty this time.',
        pieces: [ cbTP(), cbVPbare() ] },
      { hint: 'One of these two goes inside the other. Which one is big enough to hold the other?',
        pieces: [ cbCP(), cbTP() ] },
    ],
  },
  {
    id: 'combine-three',
    name: 'Three Pieces',
    description: 'Three phrases. Some of these have more than one right answer.',
    goal: 'connect',
    rounds: [
      { hint: 'All three stack up in a chain — each one is the complement of the one above it.',
        pieces: [ cbCP(), cbTP(), cbVPbare() ] },
      { hint: 'The DP has two positions it could legally fill here. Either is a real structure — pick one.',
        pieces: [ cbTP(), cbVP(), cbDP() ] },
      { hint: 'No complement position here will take a DP, so it has to go to a specifier — but whose?',
        pieces: [ cbCP(), cbTP(), cbDP() ] },
    ],
  },
  {
    id: 'combine-sentence',
    name: 'A Whole Sentence',
    description: 'Now the pieces carry words. Build the sentence you are shown.',
    goal: 'sentence',
    rounds: [
      {
        sentence: 'the cat chased the mouse',
        hint: 'Both DPs fit both empty positions — the words are what tell you which goes where.',
        pieces: [
          cbTP({ shape: 'T', number: 2, children: [], silent: true }),
          cbDP('the', 'cat'),
          cbVP('chased'),
          cbDP('the', 'mouse'),
        ],
      },
      {
        sentence: 'the dog will chase the cat',
        hint: 'This one has a real auxiliary in T instead of a silent one. Everything else works the same.',
        pieces: [
          cbTP({ shape: 'T', number: 2, children: [], word: 'will' }),
          cbDP('the', 'dog'),
          cbVP('chase'),
          cbDP('the', 'cat'),
        ],
      },
    ],
  },
];

// ===========================================================================
// LEVELS 11 AND 12 -- one node at a time.
//
// Level 9 hands over ready-made phrases and asks which goes where. These
// two take the last thing away: every node arrives on its own, holding
// nothing but its own empty positions, and the phrase has to be built from
// the bottom up. Pieces are generated exactly as Level 9's are -- from a
// finished tree -- just broken all the way down instead of down to phrases.
//
// Most nodes come with two empty positions, because most nodes in an X-bar
// tree have two daughters: XP takes a specifier and a bar level, X' takes a
// head and a complement, and an adjunction takes a bar level and its
// adjunct. The ones that don't branch get one, so that a finished tree here
// is the same tree the student has been building since Level 5 rather than
// that tree plus a scattering of positions left permanently empty.
//
// The two levels differ in what a wrong join costs, and that is the ramp.
// Level 11 only ever CORRECTS: a wrong join is refused and explained, and
// three in a row still light up a pair that fits, exactly as everywhere
// else. It is a hard enough level already -- being handed loose nodes for
// the first time is the new thing, and a penalty on top would be punishing
// someone for the wrong reason.
//
// Level 12 has an ALLOWANCE. Nothing is being introduced there: every rule
// in play has been used for six levels, so the question has stopped being
// "can you work it out" and become "do you know it". Run the allowance out
// and the round is dealt again. The allowance grows with the tree, since a
// wrong join is a fixed cost and a forty-piece sentence is not: roughly one
// try per six joins the round asks for.
// ===========================================================================

// Which position a daughter occupies, worked out from the shapes rather
// than declared: a daughter of the same category is the projection itself
// (the head under a bar level, the bar level under a phrase, or the inner
// bar level of an adjunction), and anything else is named by what its
// sibling is.
const PHRASE_LEVEL = 1, HEAD_LEVEL = 2;
function slotRoleFor(parent, child, siblings) {
  if (child.shape === parent.shape) return child.number === HEAD_LEVEL ? 'head' : 'bar';
  const projection = siblings.find(s => s !== child && s.shape === parent.shape);
  if (!projection) return 'comp';
  if (projection.number === HEAD_LEVEL) return 'comp';       // sibling of the head
  return parent.number === PHRASE_LEVEL ? 'spec' : 'adjunct'; // sibling of a bar level
}

// Break a finished tree into one piece per node: an empty position per
// daughter, accepting exactly the category that daughter is.
//
// A head's WORD comes out as a piece of its own too, and the head gets an
// empty position waiting for it. Knowing that "the" is a determiner and
// "quickly" is an adverb is a step in its own right -- it is what Level 2
// spends its whole time on -- and leaving the word already attached would
// be doing that step for the student on the one level that should be
// asking for everything at once.
function explodeNodes(root) {
  const pieces = [];
  (function walk(n) {
    const piece = { shape: n.shape, number: n.number, children: [] };
    if (n.silent) piece.silent = true;
    for (const c of n.children) {
      piece.children.push({
        slot: slotRoleFor(n, c, n.children),
        accepts: [`${c.shape}${c.number}`],
      });
    }
    if (n.word) {
      piece.children.push({ slot: 'word', accepts: [`w:${n.word}`] });
      pieces.push({ word: n.word });
    }
    pieces.push(piece);
    n.children.forEach(walk);
  })(root);
  return pieces;
}

// ===========================================================================
// LEVEL 10 -- movement.
//
// The same canvas as Level 9 with one thing added: some nodes are marked
// `movable`, and moving one leaves a crossed-out copy of itself behind.
// Landing sites are ordinary empty slots, so C⁰ and Spec-CP need no special
// machinery -- raising an auxiliary and fronting a wh-phrase are the same
// gesture as every connection made in Level 9.
//
// Each round starts from a statement built in Level 9 plus a bare CP to put
// on top, and turns it into a question. The order that forces itself is the
// real derivation: join the CP on, then move, because until the CP is
// attached there is nowhere in the tree for anything to move to.
//
// ---------------------------------------------------------------------------
// One thing here is a deliberate asymmetry rather than an oversight.
//
// A SUBJECT question has no do-support and no auxiliary in C: it is "Who
// chased the mouse?", never "*Who did chase the mouse?" -- so the rounds in
// `Subject Questions` leave T silent and non-insertable, and C empty. An
// OBJECT question has both. That contrast is the most valuable thing in the
// level, so tapping the silent T in a subject question says why nothing
// happens instead of doing nothing (see `silentNote`): `do` is a last
// resort, and it appears only when something has to move past the subject.
// ===========================================================================

// The CP that turns a statement into a question: an empty specifier for a
// wh-phrase to front into, an empty head for an auxiliary to raise into,
// and a complement waiting for the statement itself.
function mvCP() {
  return { shape: 'C', number: 1, children: [
    SPEC(['D1']),
    { shape: 'C', number: 1.5, children: [ HEAD(['T2']), COMP(['T1']) ] },
  ] };
}

// A finished transitive statement, words and all -- what Level 9's last
// sub-level ends up with.
function mvTP({ t0, subject, verb, object }) {
  return { shape: 'T', number: 1, children: [
    subject,
    { shape: 'T', number: 1.5, children: [
      t0,
      { shape: 'V', number: 1, children: [
        { shape: 'V', number: 1.5, children: [
          { shape: 'V', number: 2, children: [], word: verb },
          object,
        ] },
      ] },
    ] },
  ] };
}

// A tense with no auxiliary of its own, which CAN take `do` -- and, when it
// does, takes the tense off the verb with it ("chased" becomes "chase").
const mvSilentT = (word, verb) =>
  ({ shape: 'T', number: 2, children: [], silent: true, mustMove: true, insertable: { word, verb } });
// A tense with no auxiliary that stays silent and stays put: a subject
// question has nothing for `do` to do.
const mvBareT = () => ({ shape: 'T', number: 2, children: [], silent: true });
// A real auxiliary. It raises in a yes/no or object question, and sits
// still in a subject question.
const mvAux = (word, opts = {}) =>
  ({ shape: 'T', number: 2, children: [], word, ...(opts.moves ? { movable: true, mustMove: true } : {}) });

const NO_DO_NOTE =
  'Nothing has to get past the subject here, so there is no job for “do” — this stays empty.';

// `goal: 'question'` finishes when the pieces are one tree, everything
// marked as having to move has moved, and the words come out in the order
// the question is actually said in.
const XBAR_LEVEL10 = [
  {
    id: 'move-yesno',
    name: 'Yes/No Questions',
    description: 'Put a CP on top of a statement, and raise the tense into it.',
    goal: 'question',
    rounds: [
      {
        sentence: 'did the cat chase the mouse',
        hint: 'Join the two pieces first. Then tap the empty tense to give it a word, and carry that word up into the empty head above it.',
        pieces: [ mvCP(), mvTP({
          t0: mvSilentT('did', 'chase'),
          subject: cbDP('the', 'cat'), verb: 'chased', object: cbDP('the', 'mouse'),
        }) ],
      },
      {
        sentence: 'will the dog chase the cat',
        hint: 'This one already has an auxiliary, so there is nothing to add — it just has to get up to the top.',
        pieces: [ mvCP(), mvTP({
          t0: mvAux('will', { moves: true }),
          subject: cbDP('the', 'dog'), verb: 'chase', object: cbDP('the', 'cat'),
        }) ],
      },
    ],
  },
  {
    id: 'move-subject',
    name: 'Subject Questions',
    description: 'Ask about the subject. Watch what does NOT happen this time.',
    goal: 'question',
    silentNote: NO_DO_NOTE,
    rounds: [
      {
        sentence: 'which cat chased the mouse',
        hint: 'Join the pieces, then carry the subject up into the empty specifier. The tense stays exactly where it is.',
        pieces: [ mvCP(), mvTP({
          t0: mvBareT(),
          subject: cbDP('which', 'cat', { movable: true, mustMove: true }),
          verb: 'chased', object: cbDP('the', 'mouse'),
        }) ],
      },
      {
        sentence: 'which dog will chase the cat',
        hint: 'There is an auxiliary this time, and it still does not move. Only the subject does.',
        pieces: [ mvCP(), mvTP({
          t0: mvAux('will'),
          subject: cbDP('which', 'dog', { movable: true, mustMove: true }),
          verb: 'chase', object: cbDP('the', 'cat'),
        }) ],
      },
    ],
  },
  {
    id: 'move-object',
    name: 'Object Questions',
    description: 'Ask about the object. Now two things have to move.',
    goal: 'question',
    rounds: [
      {
        sentence: 'which mouse did the cat chase',
        hint: 'Two moves this time: the object has to get to the front, and the tense has to get past the subject — which is exactly when “do” is needed.',
        pieces: [ mvCP(), mvTP({
          t0: mvSilentT('did', 'chase'),
          subject: cbDP('the', 'cat'), verb: 'chased',
          object: cbDP('which', 'mouse', { movable: true, mustMove: true }),
        }) ],
      },
      {
        sentence: 'which cat will the dog chase',
        hint: 'Same two moves, but the auxiliary is already there, so nothing needs adding.',
        pieces: [ mvCP(), mvTP({
          t0: mvAux('will', { moves: true }),
          subject: cbDP('the', 'dog'), verb: 'chase',
          object: cbDP('which', 'cat', { movable: true, mustMove: true }),
        }) ],
      },
    ],
  },
];

// ---------------------------------------------------------------------------
// Level 11: one phrase at a time, built from nothing but single nodes.
// ---------------------------------------------------------------------------
const XBAR_LEVEL11 = [
  {
    id: 'nodes-dp',
    name: 'One Phrase',
    description: 'Every node on its own. Build one phrase from the bottom up.',
    goal: 'connect',
    rounds: [ { hint: 'Start at the bottom: find the node each empty position is asking for.',
                pieces: explodeNodes(DP_()) } ],
  },
  {
    id: 'nodes-pp',
    name: 'A Phrase Inside a Phrase',
    description: 'The same again, with one whole phrase sitting inside another.',
    goal: 'connect',
    rounds: [ { hint: 'One of these phrases ends up entirely inside the other. Build the inside one first.',
                pieces: explodeNodes(PP_()) } ],
  },
  {
    id: 'nodes-clause',
    name: 'A Whole Clause',
    description: 'A subject, a tense and a verb — every node separate.',
    goal: 'connect',
    rounds: [ { hint: 'Three phrases to build, and then to put together. Take the small ones first.',
                pieces: explodeNodes(TP_({ shape: 'V', number: 1, children: [
                  { shape: 'V', number: 1.5, children: [ { shape: 'V', number: 2, children: [] } ] },
                ] })) } ],
  },
];

// ---------------------------------------------------------------------------
// Level 12: the sentences from Level 2, as full X-bar trees.
//
// The same four sentences the student met at the very start, when a tree
// was flat and a determiner lived inside NP -- now drawn the way they have
// been drawing them since Level 5, and built one node at a time. This is
// also where the three categories the X-bar levels have never used come
// back: the adjective, the adverb and the preposition were all learned in
// the first Mystery Level and have been waiting since.
// ---------------------------------------------------------------------------
const xHead = (shape, word) => {
  const h = { shape, number: 2, children: [] };
  if (word === null) h.silent = true;
  else if (word) h.word = word;
  return h;
};
// A phrase with nothing in its specifier: XP -> X' -> X0, plus whatever the
// head takes as a complement.
const xBare = (shape, word, comp) => ({
  shape, number: 1, children: [
    { shape, number: 1.5, children: comp ? [ xHead(shape, word), comp ] : [ xHead(shape, word) ] },
  ],
});
const xAdjP = (word) => xBare('Adj', word);
const xAdvP = (word) => xBare('Adv', word);
const xPP = (prep, dp) => xBare('P', prep, dp);
const xDP = (det, noun) => ({
  shape: 'D', number: 1, children: [
    { shape: 'D', number: 1.5, children: [ xHead('D', det), xBare('N', noun) ] },
  ],
});
// "the fluffy cat": the adjective phrase adjoins to N', which is why the
// noun keeps a bar level of its own underneath it.
const xDPAdj = (det, adj, noun) => ({
  shape: 'D', number: 1, children: [
    { shape: 'D', number: 1.5, children: [
      xHead('D', det),
      { shape: 'N', number: 1, children: [
        { shape: 'N', number: 1.5, children: [
          xAdjP(adj),
          { shape: 'N', number: 1.5, children: [ xHead('N', noun) ] },
        ] },
      ] },
    ] },
  ],
});
const xClause = (subject, tenseWord, vp) => ({
  shape: 'T', number: 1, children: [
    subject,
    { shape: 'T', number: 1.5, children: [ xHead('T', tenseWord), vp ] },
  ],
});

const XBAR_LEVEL12 = [
  {
    id: 'tree-chased',
    name: 'The Full Sentence',
    description: 'A sentence you have built before, now one node and one word at a time. Four tries.',
    goal: 'sentence',
    lives: 4,
    rounds: [ {
      sentence: 'the cat chased the mouse',
      hint: 'Nothing new here — just more of it, and no wrong joins allowed.',
      pieces: explodeNodes(xClause(
        xDP('the', 'cat'), null,
        xBare('V', 'chased', xDP('the', 'mouse')))),
    } ],
  },
  {
    id: 'tree-fluffy',
    name: 'With an Adjective',
    description: 'An adjective joins in. It needs a phrase of its own. Four tries.',
    goal: 'sentence',
    lives: 4,
    rounds: [ {
      sentence: 'the fluffy cat will jump',
      hint: 'The adjective is a whole phrase, and it hangs off the noun\'s bar level rather than sitting beside the noun.',
      pieces: explodeNodes(xClause(
        xDPAdj('the', 'fluffy', 'cat'), 'will',
        xBare('V', 'jump'))),
    } ],
  },
  {
    id: 'tree-quickly',
    name: 'Everything At Once',
    description: 'An adjective, an adverb and a preposition, in the longest sentence in the game. Six tries.',
    goal: 'sentence',
    lives: 6,
    rounds: [ {
      sentence: 'the fluffy cat quickly jumped on the table',
      hint: 'The adjective describes the cat, so it goes inside the subject. The adverb and the prepositional phrase describe the jumping, so they go inside the verb phrase.',
      pieces: explodeNodes(xClause(
        xDPAdj('the', 'fluffy', 'cat'), null,
        { shape: 'V', number: 1, children: [
          { shape: 'V', number: 1.5, children: [
            xAdvP('quickly'),
            { shape: 'V', number: 1.5, children: [
              { shape: 'V', number: 1.5, children: [ xHead('V', 'jumped') ] },
              xPP('on', xDP('the', 'table')),
            ] },
          ] },
        ] })),
    } ],
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
    level9: XBAR_LEVEL9,
    level10: XBAR_LEVEL10,
    level11: XBAR_LEVEL11,
    level12: XBAR_LEVEL12,
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
let LEVEL9_SUBLEVELS = [];              // combining phrases -- X-bar phase only
let LEVEL10_SUBLEVELS = [];             // movement -- X-bar phase only
let LEVEL11_SUBLEVELS = [];             // phrases from single nodes
let LEVEL12_SUBLEVELS = [];             // whole sentences from single nodes
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
  LEVEL9_SUBLEVELS = MODE.level9;
  LEVEL10_SUBLEVELS = MODE.level10;
  LEVEL11_SUBLEVELS = MODE.level11;
  LEVEL12_SUBLEVELS = MODE.level12;
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
