# Shapes and Language

A browser game for learning to build syntactic structure, written to sit alongside an
introductory syntax course rather than replace one. It runs on a phone, needs no
account, stores nothing on a server, and has no build step.

**Play it:** https://jjgerard.github.io/shapes/

---

## What it's for

The game exists because a few things reliably fail to stick in a first syntax course,
and they fail in ways that are invisible until much later:

- **The head/phrase distinction.** Students who can label a tree fluently often turn out,
  when pressed, to think a head *is* a small phrase. Everything downstream — selection,
  movement, c-command — is built on the distinction, so nothing downstream works.
- **Missing intermediate projections.** A student can assemble a correct X-bar structure
  from prepared pieces and then, asked to draw one from scratch, produce phrases with the
  bar level quietly absent. Being able to *complete* a structure and being able to
  *produce* one are different skills, and only the first gets practised.
- **Finding the category of a word at all.** The student who cannot locate the verb in a
  sentence cannot begin, and usually stops asking.

These are not conceptual difficulties so much as under-practice. A seminar gives a
student perhaps five trees; the misconception survives all five because there is no
mechanism that makes it fail visibly. This game's job is to be that mechanism, several
hundred times, in a form nobody minds repeating.

## The design, and why

**The pieces make illegal structures impossible.** Every connection is checked against a
rule set derived from the structures themselves, so there is no way to skip a projection
level, and no way to hang a phrase where a head belongs. A student who tries is told
which of the two things they tried to do was wrong — never just "no".

**The categories are a secret you have to break.** Levels 1–4 never use the words
*noun*, *verb* or *phrase*. Pieces are a shape and a number, and the game is pure
structure. The last sub-level of Level 1 — the **Mystery Level** — shows a tree the
student built and asks them to work out what each shape and each number stands for, in
their own words, before anything else unlocks. Getting the vocabulary *as a reward for
noticing a pattern* turns out to be very different from getting it on a slide in week 2.

**Numbering says where a layer sits.** A phrase is `1` and a head is `2` for the whole
game. When the bar level arrives at Level 5 it is `1.5`, not `2` — so nothing a student
has already learned is taken back, and the number itself says the layer sits between the
other two.

**Two phases, one progression.** Levels 1–4 use flat phrase structure in the style of
Carnie's chapter 3, with the determiner inside NP. Levels 5–12 use X-bar. The switch
happens at Level 5, where a syllabus puts it, and the student is never asked to choose
between them — choosing would mean describing both, and describing them gives away the
Mystery Level.

**Mobile first, and tech-phobia-proof.** Every canvas pans and zooms and has a visible
**Fit** button that always brings everything back. Nothing can be lost, every refusal is
explained in words, every destructive action asks first, and the system back gesture
walks back through the app instead of leaving it.

## The twelve levels

| | Level | What it asks |
|---|---|---|
| **1** | Shapes | Combine a fixed set of pieces into one connected structure. Ends with the **Mystery Level**. |
| **2** | Words | One word at a time, in random order, onto the piece it belongs to. No word list to read the sentence off. |
| **3** | Constituents | Is this string of words a constituent? Proved with a run of correct answers. |
| **4** | Categories | Tap the category sticker for the highlighted constituent. Two rows: phrase and head — which is where the head/phrase conflation shows up. |
| **5–8** | The same four, in X-bar | A new inventory, a fresh Mystery Level, and an intermediate projection inside every phrase. |
| **9** | Building | Whole phrases with their empty positions showing. Which phrase fills which position — i.e. selection. |
| **10** | Moving | Turn those statements into questions. T-to-C, do-support, subject and object wh-movement, with traces and movement arrows the student draws themselves. |
| **11** | One at a Time | Every node arrives on its own, and the empty positions are unlabelled. Build a phrase from the bottom up. |
| **12** | The Whole Thing | The Level 2 sentences as full X-bar trees, one node and one word at a time — adjectives, adverbs and prepositions included. |

Levels 11 and 12 are the ones that test *production* rather than completion, and Level 12
is the only place in the game where a student is asked to do everything at once.

**Do-support is a last resort, and the game says so.** A subject wh-question offers no
*do* anywhere on the board, because there is no job for one; tapping the empty tense
explains why rather than doing nothing. The object questions, immediately after, have
both moves. That contrast is the most valuable thing in Level 10.

**Mistakes cost differently by level.** Up to Level 11 a wrong move is refused and
explained, and three in a row lights up something that fits. Level 12 gives a fixed
allowance of tries, shown as hearts — nothing new is being introduced there, so the
question has stopped being "can you work it out" and become "do you know it". Shuffling
pieces around the canvas is never a mistake; only a drop onto an empty position counts.

## Running it

It's a static site with no dependencies and no build:

```sh
git clone https://github.com/jjgerard/shapes
cd shapes
python3 -m http.server 8123      # then open http://localhost:8123
```

Deployment is GitHub Pages from `main`. Assets carry a `?v=NN` query string that is
bumped on every change, so nobody is ever stuck on a stale cached copy.

## The code

| File | What's in it |
|---|---|
| `data.js` | Every structure, sentence, sub-level and answer key. Both phases are data; the engine knows nothing about either. |
| `app.js` | Screens, progress, points, the level select, and each level's own logic. |
| `editor.js` | Levels 1 and 5 — the drag-and-snap piece canvas. |
| `wordmatch.js` | Levels 2 and 6 — dragging words onto a finished tree. |
| `combine.js` | Levels 9–12 — the slot canvas: connecting, moving, tracing, and building from single nodes. |
| `shapes.js` | Shape geometry, label fitting, and the shared static tree painter. |
| `treeviewer.js` | The read-only tree used by the quizzes and the Mystery Level. |
| `canvas.js` | Pan/zoom/fit shared by every canvas. |

Two conventions worth knowing before changing anything:

- **Text is fitted by measurement, never by counting characters.** `getComputedTextLength()`
  decides how big a label can be, which means elements must be visible before they are
  fitted — inside a hidden subtree every measurement is zero and the fit silently does
  nothing.
- **Comments say why, not what.** Most of the non-obvious code has a note explaining the
  pedagogical or device constraint behind it. If a change makes one of those comments
  false, the change probably needs rethinking.

## Licence

Do what you like with it. If you use it with a class, I'd be glad to hear how it went.
