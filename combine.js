// Level 9: combining whole phrases.
//
// Every level up to here hands out pre-built pieces and asks you to match
// them up -- an open branch joins a freestanding piece of the identical
// shape AND number, so the piece itself already says what goes under what.
// That is the right training wheel for learning to read a tree, and it is
// the wrong one for learning to build a sentence, because the student never
// once decides that a TP is the complement of C.
//
// So this canvas works the other way round. A piece is a whole phrase, and
// it arrives with its empty positions showing: a dashed SLOT labelled
// "Specifier" or "Complement". Connecting means dragging a phrase into a
// slot, and a slot only accepts what its head selects -- C′ wants a TP, T′
// wants a VP, V′ and P′ want a DP, and a specifier wants a DP. That list is
// per-slot data, not a rule buried in this file, which is what makes the
// puzzle a puzzle: given a TP, a CP and a DP there is no complement slot a
// bare DP fits, so it has to go to a specifier.
//
// Two consequences worth knowing before reading the code:
//
//   * Pieces are INDIVISIBLE. You drag a whole connected component by any
//     node in it, never a subtree out of the middle. Taking something back
//     apart is the scissors, exactly as in Level 1.
//   * Layout is AUTOMATIC. Level 1 lets every node stay wherever it was
//     dropped, which is fine for three-node chunks; drop a TP into a CP and
//     the entire TP has to move under C′ or the result is unreadable. So
//     each connected component is tidy-laid-out from its root, and the
//     root's position is the only thing a drag actually changes. Snapping
//     into shape the moment a connection lands is also the clearest signal
//     that it landed.

// Bigger shapes, bigger text and more room on a phone, for the same reason
// as Level 1's SIZING: a phone is where the pieces are hardest to see and
// hit. `wordGap` sizes the columns when a sub-level's pieces carry words,
// which need far more horizontal room than a bare "1.5" does.
// `slotW` is deliberately separate from `chipW`: a slot is the widest thing
// on the canvas, and since it sets how wide a whole phrase is, an over-wide
// one costs zoom on every piece in the puzzle. The captions are measured and
// shrunk to fit (see _fitSlotLabels) rather than the box being sized around
// the longest word.
const CB_SIZING = {
  // nodeGap has to clear two slots standing side by side -- slotW plus a
  // little air. Levels 11 and 12 deal nodes whose daughters are BOTH still
  // empty (a bar level with its head and its complement both open), which
  // no earlier level does, and sizing this to slot-next-to-shape instead
  // leaves those two dashed boxes touching.
  desktop: { r: 28, levelGap: 92, nodeGap: 132, wordGap: 148, snapDistance: 96, margin: 900, pieceGap: 130, slotW: 118, chipW: 112, chipH: 42, wordFont: 24, springApart: 90 },
  mobile:  { r: 38, levelGap: 124, nodeGap: 156, wordGap: 176, snapDistance: 128, margin: 700, pieceGap: 150, slotW: 140, chipW: 146, chipH: 54, wordFont: 30, springApart: 110 },
};

// What a slot says on it. Kept as whole words rather than "Spec"/"Comp":
// Level 9 is where the terms are introduced, and an abbreviation of a word
// you have never seen is not a shorter version of it, it is a different
// unknown.
//
// Levels 11 and 12 run with `blankSlots`, where none of this is shown and
// every empty position is an unmarked grey box -- by then, working out what
// a position wants IS the exercise, and a label on it is the answer. The
// text still exists for the one place it is still worth saying: the hint,
// which writes it onto a single box after three wrong tries in a row.
const SLOT_LABEL = {
  spec: 'Specifier', comp: 'Complement', head: 'Head',
  bar: 'Bar level', adjunct: 'Adjunct',
  // A head's own word, which in Levels 11-12 arrives as a separate piece.
  word: 'Word',
};

// How far a round is allowed to zoom out just to fit on opening. Below this
// the shapes stop being tellable apart, and a view you cannot read is not a
// view of anything.
const CB_MIN_OPEN_ZOOM = 0.34;

class CombineEditor {
  constructor(svg) {
    this.svg = svg;
    this.nodes = new Map();   // id -> node record (see _addTree)
    this.nextId = 1;
    this.seams = new Map();   // nodeId -> {parentId, index, role, accepts} -- what filling a slot consumed
    this.drag = null;         // {rootId, grabX, grabY} -- moving a whole piece around
    this.moveDrag = null;     // {id, x, y} -- carrying a node already IN the tree to a landing site
    this.snapTarget = null;   // {pieceId, slotId} currently in range
    this.silentNote = '';     // what to say when a silent head is tapped and there's no word to add
    this.snipMode = false;
    this.connectCount = 0;
    this.detachCount = 0;
    this.failedAttempts = 0;
    this.hintIds = null;      // [rootId, slotId] being pointed at, or null
    this.zoom = 1;
    this.bgPointers = new Map();
    this.bgAnchor = null;

    this.onChange = null;
    this.onFeedback = null;
    this.onConnect = null;
    this.onSnipModeChange = null;
    this.onLivesOut = null;     // the round's allowance of wrong joins is spent
    this.onLivesChange = null;  // one has just been used up

    this._applySizing();
    this._bindGlobalPointerEvents();
    this._bindBackgroundPointerEvents();
    this._bindWheelZoom();
  }

  _applySizing() {
    const s = window.innerWidth < 640 ? CB_SIZING.mobile : CB_SIZING.desktop;
    Object.assign(this, s);
  }

  minZoom() { return 0.05; }
  maxZoom() { return 5; }
  setZoom(z) {
    this.zoom = Math.max(this.minZoom(), Math.min(this.maxZoom(), z));
    this.render();
  }

  setFeedback(msg, kind) {
    if (this.onFeedback) this.onFeedback(msg || '', kind || '');
  }

  setSnipMode(on, { keepFeedback = false } = {}) {
    this.snipMode = on;
    if (!on && !keepFeedback) this.setFeedback('');
    if (this.onSnipModeChange) this.onSnipModeChange(on);
    this.render();
  }

  // ---- loading ----
  open(minViewW, minViewH) {
    this._applySizing();
    this.minViewW = minViewW;
    this.minViewH = minViewH;
    this.zoom = 1;
  }

  // `pieces` is a list of {shape, number, children} trees, where a child may
  // instead be {slot:'spec'|'comp', accepts:['T1', ...]}. Each becomes one
  // freestanding component.
  // `lives` caps how many wrong joins a round survives. Left unset, wrong
  // joins are simply corrected: refused, explained, and after three in a
  // row a pair that fits starts glowing -- the way every level up to here
  // behaves. Set, that safety net comes off, because a hint that rescues
  // you costs nothing and the whole point of a limit is that it costs
  // something.
  load(pieces, { silentNote = '', lives = 0, blankSlots = false } = {}) {
    this.lives = lives;
    this.livesLeft = lives;
    this.blankSlots = blankSlots;
    this.nodes = new Map();
    this.seams = new Map();
    this.nextId = 1;
    this.drag = null;
    this.moveDrag = null;
    this.silentNote = silentNote;
    this.snapTarget = null;
    this.snipMode = false;
    this.connectCount = 0;
    this.detachCount = 0;
    this.moveCount = 0;
    this.insertCount = 0;
    this.failedAttempts = 0;
    this.hintIds = null;
    // Words need much wider columns than bare numbers, and a sub-level
    // either has them throughout or not at all, so this is decided once for
    // the whole canvas rather than per branch.
    this.hasWords = pieces.some(p => this._anyWord(p));
    this.colGap = this.hasWords ? this.wordGap : this.nodeGap;
    for (const spec of pieces) this._addTree(spec, null, 0);
    this._arrange();
    this.setFeedback('');
    this.render();
    this._scrollToStart();
  }

  _anyWord(node) {
    if (node.word || node.silent) return true;
    return (node.children || []).some(c => this._anyWord(c));
  }

  // Recursively materialise a spec tree into node records. Returns the id.
  _addTree(spec, parentId, index) {
    const id = this.nextId++;
    // A bare word, with no category of its own: Levels 11 and 12 hand the
    // words out as separate pieces, so that knowing "the" is a determiner
    // is its own step rather than something the board has already done.
    if (spec.word && !spec.shape) {
      const w = { id, slot: false, isWord: true, word: spec.word, parentId, childIds: [], x: 0, y: 0 };
      this.nodes.set(id, w);
      return id;
    }
    const node = spec.slot
      ? { id, slot: true, role: spec.slot, accepts: spec.accepts, parentId, childIds: [], x: 0, y: 0 }
      : {
          id, slot: false, catKey: spec.shape, number: spec.number,
          word: spec.word, silent: spec.silent, isTrace: spec.isTrace,
          // Level 10 only. `movable` is what may be carried to a landing
          // site, `mustMove` is what the round is not finished without, and
          // `insertable` is a silent head that can have a word put into it
          // (do-support). Absent everywhere in Level 9, which has no
          // movement at all.
          movable: spec.movable, mustMove: spec.mustMove, insertable: spec.insertable,
          parentId, childIds: [], x: 0, y: 0,
        };
    this.nodes.set(id, node);
    if (!spec.slot) {
      (spec.children || []).forEach((c, i) => {
        node.childIds.push(this._addTree(c, id, i));
      });
    }
    return id;
  }

  node(id) { return this.nodes.get(id); }
  roots() { return [...this.nodes.values()].filter(n => n.parentId === null); }
  subtree(id) {
    const out = [];
    const walk = (nid) => { const n = this.node(nid); out.push(n); n.childIds.forEach(walk); };
    walk(id);
    return out;
  }
  // Which freestanding piece a node currently belongs to.
  rootOf(id) {
    let n = this.node(id);
    while (n.parentId !== null) n = this.node(n.parentId);
    return n;
  }
  emptySlots() { return [...this.nodes.values()].filter(n => n.slot); }

  // ---- layout ----
  // Tidy tree layout per component: leaves get sequential columns, parents
  // centre over their children, and the whole thing is then translated so
  // the component's root lands on its stored x/y -- the one coordinate a
  // drag ever writes to.
  _layout() {
    for (const root of this.roots()) {
      let leafX = 0;
      const assign = (n, depth) => {
        n._depth = depth;
        if (!n.childIds.length) { n._lx = leafX * this.colGap; leafX++; }
        else {
          n.childIds.forEach(cid => assign(this.node(cid), depth + 1));
          const xs = n.childIds.map(cid => this.node(cid)._lx);
          n._lx = (Math.min(...xs) + Math.max(...xs)) / 2;
        }
        n._ly = depth * this.levelGap;
      };
      assign(root, 0);
      const dx = root.x - root._lx, dy = root.y - root._ly;
      for (const n of this.subtree(root.id)) { n._x = n._lx + dx; n._y = n._ly + dy; }
    }
  }

  // How much room a node's painted form actually occupies, which is not the
  // same for all three kinds: a slot is a wide flat box, and a head with a
  // word has one hanging below it.
  _halfWidth(n) {
    if (n.slot) return this.slotW / 2;
    if (n.isWord) return this.chipW / 2;
    if (n.word || n.silent) return Math.max(this.r, this.chipW / 2);
    return this.r;
  }
  // A word piece is a chip centred on its own position; everything else is
  // a shape of radius r, possibly with a word hanging under it.
  _top(n) { return n.isWord ? this.chipH / 2 : this.r; }
  _bottom(n) {
    if (n.isWord) return this.chipH / 2;
    return (n.word || n.silent) ? this.r + this.chipH + 14 : this.r;
  }
  _edgeRadius(n) { return n.isWord ? this.chipH / 2 : this.r; }

  _componentBounds(rootId) {
    const ns = this.subtree(rootId);
    return {
      minX: Math.min(...ns.map(n => n._x - this._halfWidth(n))),
      maxX: Math.max(...ns.map(n => n._x + this._halfWidth(n))),
      minY: Math.min(...ns.map(n => n._y - this._top(n))),
      maxY: Math.max(...ns.map(n => n._y + this._bottom(n))),
    };
  }

  contentBounds() {
    if (!this.nodes.size) return null;
    const boxes = this.roots().map(r => this._componentBounds(r.id));
    return {
      minX: Math.min(...boxes.map(b => b.minX)),
      minY: Math.min(...boxes.map(b => b.minY)),
      maxX: Math.max(...boxes.map(b => b.maxX)),
      maxY: Math.max(...boxes.map(b => b.maxY)),
    };
  }

  // Deal the pieces out across the canvas. Every piece is measured after
  // layout rather than slotted into a fixed grid, since a DP carrying words
  // is several times the width of a bare VP.
  //
  // How many per row is chosen by trying every count and keeping whichever
  // one the opening view can zoom to best. A phrase is a wide, shallow
  // object and a phone screen is a narrow, tall one, so laying three of
  // them out in a line -- the obvious thing -- forces the opening zoom down
  // to a level where the labels can't be read. Stacking them instead trades
  // width the screen hasn't got for height it has.
  _arrange() {
    const roots = this.roots();
    let best = null;
    for (let cols = 1; cols <= roots.length; cols++) {
      const box = this._packInto(cols);
      // Same allowances _scrollToStart() uses, so the column count is
      // chosen against the framing the student will actually get.
      const zoom = Math.min(
        (this.minViewW || 800) / (box.w + 80),
        (this.minViewH || 600) / (box.h + 156));
      if (!best || zoom > best.zoom) best = { cols, zoom };
    }
    this._packInto(best.cols);
  }

  // Lay the pieces out `cols` to a row, and report the size of the result.
  _packInto(cols) {
    this._layout();
    let cx = this.margin, cy = this.margin, rowH = 0, inRow = 0;
    let maxRight = this.margin;
    for (const root of this.roots()) {
      const b = this._componentBounds(root.id);
      const w = b.maxX - b.minX, h = b.maxY - b.minY;
      if (inRow === cols) {
        cx = this.margin; cy += rowH + this.pieceGap; rowH = 0; inRow = 0;
      }
      root.x += cx - b.minX;
      root.y += cy - b.minY;
      cx += w + this.pieceGap;
      inRow++;
      rowH = Math.max(rowH, h);
      maxRight = Math.max(maxRight, cx - this.pieceGap);
      this._layout();
    }
    return { w: maxRight - this.margin, h: cy + rowH - this.margin };
  }

  canvasWidth() {
    const b = this.contentBounds();
    return Math.max(this.minViewW || 0, (b ? b.maxX : 0) + this.margin);
  }
  canvasHeight() {
    const b = this.contentBounds();
    return Math.max(this.minViewH || 0, (b ? b.maxY : 0) + this.margin);
  }

  // Always frame everything, unlike the other canvases, which anchor
  // top-left when fitting would make the pieces too small to read. Here the
  // first thing to do in a round is survey what you have been given -- a
  // piece parked off-screen at the start is a piece the student does not
  // know exists -- so the opening view shows the lot and they zoom in to
  // work. _arrange() has already picked the layout that makes this as
  // generous as it can be.
  _scrollToStart() {
    const wrap = this.svg.parentElement;
    if (!wrap || !this.nodes.size) return;
    requestAnimationFrame(() => {
      if (!wrap.clientWidth || !wrap.clientHeight) return;
      // Framed the same way the Fit button does it, including the strip
      // reserved for the buttons themselves -- see controlsReserve(). A
      // piece dealt underneath them can be seen but not picked up, which on
      // a 30-node round means the puzzle simply cannot be finished.
      fitBoundsInView(this, this.contentBounds());
      // Two ends to clamp. A round small enough to fit twice over shouldn't
      // open blown up past full size. And a forty-piece round on a phone
      // fits at about 13%, where a determiner phrase and a bar level are
      // the same grey smudge -- "you can see all of it" stops being worth
      // anything long before that, so below the floor it opens at the floor
      // and on the top-left corner of the board instead, and the Fit button
      // is there for whenever the whole thing is wanted.
      const framed = Math.min(1, Math.max(CB_MIN_OPEN_ZOOM, this.zoom));
      if (framed === this.zoom) return;
      this.zoom = framed;
      this.render();
      const b = this.contentBounds();
      const pad = 30;
      const contentW = (b.maxX - b.minX) * this.zoom, contentH = (b.maxY - b.minY) * this.zoom;
      wrap.scrollLeft = Math.max(0, contentW <= wrap.clientWidth
        ? b.minX * this.zoom - (wrap.clientWidth - contentW) / 2
        : (b.minX - pad) * this.zoom);
      wrap.scrollTop = Math.max(0, contentH <= wrap.clientHeight
        ? b.minY * this.zoom - (wrap.clientHeight - contentH) / 2
        : (b.minY - pad) * this.zoom);
    });
  }

  // ---- connecting ----
  nodeKey(n) { return n.isWord ? `w:${n.word}` : `${n.catKey}${n.number}`; }

  // What to call a piece in a message. A word is quoted; anything else gets
  // the label it is wearing.
  _pieceLabel(n) { return n.isWord ? `“${n.word}”` : nodeLabel(n.catKey, n.number); }

  // Can this freestanding piece fill this slot? Selection lives entirely in
  // the slot's own `accepts` list -- no grammar is hardcoded here.
  fits(rootId, slotId) {
    const root = this.node(rootId), slot = this.node(slotId);
    if (!root || !slot || !slot.slot || root.parentId !== null) return false;
    if (this.rootOf(slotId).id === rootId) return false;   // can't feed a piece into itself
    return slot.accepts.includes(this.nodeKey(root));
  }

  // Nearest slot the dragged piece could actually fill. Measured from the
  // piece's ROOT, which is the node the student is lining up with the slot.
  findSlotFor(rootId) {
    const root = this.node(rootId);
    let best = null, bestDist = Infinity;
    for (const slot of this.emptySlots()) {
      if (!this.fits(rootId, slot.id)) continue;
      const d = Math.hypot(root._x - slot._x, root._y - slot._y);
      if (d < this.snapDistance && d < bestDist) { bestDist = d; best = slot.id; }
    }
    return best;
  }

  connect(rootId, slotId) {
    const slot = this.node(slotId);
    const parent = this.node(slot.parentId);
    const index = parent.childIds.indexOf(slotId);

    this.seams.set(rootId, { parentId: parent.id, index, role: slot.role, accepts: slot.accepts });
    parent.childIds[index] = rootId;
    this.node(rootId).parentId = parent.id;
    this.nodes.delete(slotId);

    this.connectCount++;
    this.failedAttempts = 0;
    this.hintIds = null;
    this._layout();
    this.setFeedback(this._connectMessage(rootId, slot.role), 'ok');
    playClickSound();
    if (this.onConnect) this.onConnect();
    if (this.onChange) this.onChange();
  }

  // Name what just happened in the terms the level is teaching, rather than
  // a generic "snapped": which phrase went into which position is exactly
  // the thing being learned, so it is worth saying out loud every time.
  _connectMessage(rootId, role) {
    const root = this.node(rootId);
    const parent = this.node(root.parentId);
    const parentLabel = this._pieceLabel(parent);
    const label = this._pieceLabel(root);
    if (role === 'word') return `${label} is the word for ${parentLabel}.`;
    if (role === 'spec') return `${label} is now the specifier of ${parentLabel}.`;
    if (role === 'head') return `${label} is now the head of ${parentLabel}.`;
    if (role === 'bar') return `${label} sits under ${parentLabel}.`;
    if (role === 'adjunct') return `${label} is now an adjunct on ${parentLabel}.`;
    return `${label} is now the complement of ${parentLabel}.`;
  }

  // ---- movement (Level 10) ----
  // Moving is the same gesture as connecting -- drag a thing into an empty
  // position -- with one difference that is the entire point of the topic:
  // what moved leaves a crossed-out copy of itself behind, so the tree
  // still records where it started out.
  //
  // Landing sites are ordinary slots with an `accepts` list, so nothing
  // here knows what a question is. A movement is legal when the slot takes
  // this category AND sits in the same tree -- you cannot move something
  // out of one piece into another that hasn't been joined on yet, which is
  // what makes "build it first, then move" the only possible order.
  fitsMove(nodeId, slotId) {
    const node = this.node(nodeId), slot = this.node(slotId);
    if (!node || !slot || !slot.slot || !node.movable || node.moved) return false;
    if (node.parentId === null) return false;
    if (this.rootOf(nodeId).id !== this.rootOf(slotId).id) return false;
    if (this.subtree(nodeId).some(n => n.id === slotId)) return false;
    return slot.accepts.includes(this.nodeKey(node));
  }

  landingSlotsFor(nodeId) {
    return this.emptySlots().filter(s => this.fitsMove(nodeId, s.id));
  }

  // The thing a press at this node would move: the node itself if it can
  // move, otherwise the nearest thing above it that can.
  //
  // This is what makes "drag the constituent" true rather than "drag the
  // one node at the top of the constituent". A wh-phrase is a DP with five
  // nodes and two words under it, and the obvious thing to take hold of is
  // the word, or the noun -- not the DP label three rows up. Grabbing any
  // of them now picks up the whole phrase.
  movingPieceFor(nodeId) {
    let n = this.node(nodeId);
    while (n) {
      if (n.movable && !n.moved && this.landingSlotsFor(n.id).length) return n;
      n = n.parentId === null ? null : this.node(n.parentId);
    }
    return null;
  }

  // A deep copy of a subtree, marked all the way down as a trace: same
  // shapes, same words, but pronounced nowhere.
  _copyAsTrace(id) {
    const src = this.node(id);
    const copyId = this.nextId++;
    const copy = {
      id: copyId, slot: false, catKey: src.catKey, number: src.number,
      word: src.word, silent: src.silent, isTrace: true,
      parentId: null, childIds: [], x: 0, y: 0,
    };
    this.nodes.set(copyId, copy);
    for (const cid of src.childIds) {
      const childCopy = this._copyAsTrace(cid);
      childCopy.parentId = copyId;
      copy.childIds.push(childCopy.id);
    }
    return copy;
  }

  moveTo(nodeId, slotId) {
    const node = this.node(nodeId), slot = this.node(slotId);
    const home = this.node(node.parentId);
    const homeIndex = home.childIds.indexOf(nodeId);
    const landing = this.node(slot.parentId);
    const landingIndex = landing.childIds.indexOf(slotId);

    const trace = this._copyAsTrace(nodeId);
    trace.parentId = home.id;
    home.childIds[homeIndex] = trace.id;

    landing.childIds[landingIndex] = nodeId;
    node.parentId = landing.id;
    node.moved = true;
    node.traceId = trace.id;
    this.nodes.delete(slotId);

    this.seams.set(nodeId, {
      kind: 'move', parentId: landing.id, index: landingIndex,
      role: slot.role, accepts: slot.accepts,
      traceId: trace.id, homeParentId: home.id, homeIndex,
    });

    this.moveCount = (this.moveCount || 0) + 1;
    this.failedAttempts = 0;
    this.hintIds = null;
    this._layout();
    const label = nodeLabel(node.catKey, node.number);
    this.setFeedback(`${label} moved up, and left a crossed-out copy behind where it started.`, 'ok');
    playClickSound();
    if (this.onConnect) this.onConnect();
    if (this.onChange) this.onChange();
  }

  // Put a silent head's word in. Do-support in everything but name: it only
  // ever exists on a head the round has marked `insertable`, which is how
  // the one place it is legal stays a property of the sentence rather than
  // a rule in here. Adding `do` also takes the tense off the verb --
  // "chased" becomes "chase" -- which is the whole reason it is needed.
  insertWord(nodeId) {
    const node = this.node(nodeId);
    const spec = node.insertable;
    if (!spec) return false;
    node.word = spec.word;
    node.silent = false;
    node.movable = true;
    node.insertable = null;
    let note = `“${spec.word}” goes into the empty ${nodeLabel(node.catKey, node.number)}.`;
    if (spec.verb) {
      const verb = [...this.nodes.values()].find(n => n.catKey === 'V' && n.number === 2 && !n.isTrace);
      if (verb) {
        note += ` The tense goes with it, so “${verb.word}” drops back to “${spec.verb}”.`;
        verb.word = spec.verb;
      }
    }
    this.insertCount = (this.insertCount || 0) + 1;
    this.setFeedback(note, 'ok');
    playClickSound();
    if (this.onConnect) this.onConnect();
    if (this.onChange) this.onChange();
    return true;
  }

  hasSeam(id) { return this.seams.has(id); }

  // Put a connected piece back on the table, restoring the empty slot it
  // filled so the position is visibly open again.
  detachAt(id) {
    const seam = this.seams.get(id);
    const node = this.node(id);
    if (!seam || !node) {
      this.setFeedback('Nothing is plugged in there — tap a piece outlined in red.', 'err');
      return false;
    }
    // Undoing a movement is not the same as pulling a piece off: what moved
    // goes back where it came from and the crossed-out copy disappears,
    // rather than the moved thing being left loose on the canvas.
    if (seam.kind === 'move') return this._undoMove(id, seam);
    const slotId = this.nextId++;
    this.nodes.set(slotId, {
      id: slotId, slot: true, role: seam.role, accepts: seam.accepts,
      parentId: seam.parentId, childIds: [], x: 0, y: 0,
    });
    this.node(seam.parentId).childIds[seam.index] = slotId;

    node.parentId = null;
    node.x = node._x + this.springApart;
    node.y = node._y + this.springApart;
    this.seams.delete(id);

    this.detachCount++;
    this.failedAttempts = 0;
    this.hintIds = null;
    this._layout();
    this.setFeedback('Pulled apart.', 'ok');
    if (this.onChange) this.onChange();
    return true;
  }

  _undoMove(id, seam) {
    const node = this.node(id);
    // The landing site becomes an empty position again...
    const slotId = this.nextId++;
    this.nodes.set(slotId, {
      id: slotId, slot: true, role: seam.role, accepts: seam.accepts,
      parentId: seam.parentId, childIds: [], x: 0, y: 0,
    });
    this.node(seam.parentId).childIds[seam.index] = slotId;

    // ...and the trace standing in for it is replaced by the real thing.
    for (const n of this.subtree(seam.traceId)) this.nodes.delete(n.id);
    this.node(seam.homeParentId).childIds[seam.homeIndex] = id;
    node.parentId = seam.homeParentId;
    node.moved = false;
    node.traceId = null;

    this.seams.delete(id);
    this.moveCount = Math.max(0, (this.moveCount || 0) - 1);
    this.failedAttempts = 0;
    this.hintIds = null;
    this._layout();
    this.setFeedback('Moved back to where it started.', 'ok');
    if (this.onChange) this.onChange();
    return true;
  }

  // ---- state the host asks about ----
  isOneTree() { return this.roots().length === 1; }
  // Everything the round says has to move has moved.
  allMoved() {
    return [...this.nodes.values()].every(n => !n.mustMove || n.moved);
  }
  isFullyFilled() { return this.emptySlots().length === 0; }

  // What the assembled tree actually spells out, left to right. Silent
  // heads contribute nothing, which is how a tense with no auxiliary can
  // sit in the middle of a sentence without appearing in it. This is what
  // catches a well-formed tree of the WRONG sentence -- swapping the two
  // DPs in a transitive clause is legal everywhere except here.
  yieldWords() {
    const roots = this.roots();
    if (roots.length !== 1) return [];
    const out = [];
    const walk = (n) => {
      // A trace is a copy of something pronounced somewhere else, so it
      // contributes nothing here -- that is what makes moving a word
      // change the sentence rather than duplicate a word in it.
      if (n.word && !n.silent && !n.isTrace) out.push(n.word);
      n.childIds.forEach(cid => walk(this.node(cid)));
    };
    walk(roots[0]);
    return out;
  }

  // ---- rendering ----
  render() {
    this._layout();
    this.viewW = this.canvasWidth();
    this.viewH = this.canvasHeight();
    this.svg.setAttribute('viewBox', `0 0 ${this.viewW} ${this.viewH}`);
    this.svg.setAttribute('width', this.viewW * this.zoom);
    this.svg.setAttribute('height', this.viewH * this.zoom);

    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    const edgeLayer = svgEl('g', { class: 'edge-layer' });
    const nodeLayer = svgEl('g', { class: 'node-layer' });
    this.svg.appendChild(edgeLayer);
    this.svg.appendChild(nodeLayer);

    for (const n of this.nodes.values()) {
      for (const cid of n.childIds) {
        const c = this.node(cid);
        const seam = this.snipMode && this.seams.has(cid);
        edgeLayer.appendChild(svgEl('path', {
          class: 'tree-edge' + (seam ? ' seam' : ''),
          d: `M ${n._x} ${n._y + this._edgeRadius(n)} C ${n._x} ${(n._y + c._y) / 2}, ${c._x} ${(n._y + c._y) / 2}, ${c._x} ${c._y - this._edgeRadius(c)}`,
        }));
      }
    }

    // Movement sits UNDER the nodes, the way it's drawn on paper: the
    // arrow dips below the tree so it never crosses a shape or a word.
    for (const n of this.nodes.values()) {
      if (n.moved && n.traceId && this.node(n.traceId)) edgeLayer.appendChild(this._buildMovement(this.node(n.traceId), n));
    }

    for (const n of this.nodes.values()) {
      nodeLayer.appendChild(n.slot ? this._buildSlot(n) : n.isWord ? this._buildWordPiece(n) : this._buildNode(n));
    }
    if (this.moveDrag) nodeLayer.appendChild(this._buildGhost());

    fitShapeLabels(nodeLayer);
    this._fitSlotLabels(nodeLayer);
  }

  _subtreeBox(id) {
    const ns = this.subtree(id);
    return {
      minX: Math.min(...ns.map(n => n._x - this._halfWidth(n))) - 8,
      maxX: Math.max(...ns.map(n => n._x + this._halfWidth(n))) + 8,
      minY: Math.min(...ns.map(n => n._y - this._top(n))) - 8,
      maxY: Math.max(...ns.map(n => n._y + this._bottom(n))) + 8,
    };
  }

  // An arrow from the gap up to the landing site, dipping below both ends.
  // Same drawing as Level 2 uses for the movement in its ready-made trees,
  // so a student who has seen one recognises the other -- the difference is
  // only that here they drew it themselves.
  _buildMovement(trace, moved) {
    const g = svgEl('g', { class: 'cb-move' });
    const from = this._subtreeBox(trace.id);
    const to = this._subtreeBox(moved.id);
    // Ring both ends when a whole phrase moved, so it's clear what the
    // arrow is carrying. A lone head needs no ring -- the arrow already
    // points at exactly one shape at each end.
    if (this.subtree(moved.id).length > 1) {
      for (const b of [from, to]) {
        g.appendChild(svgEl('rect', {
          class: 'cb-move-ring', x: b.minX, y: b.minY,
          width: b.maxX - b.minX, height: b.maxY - b.minY, rx: 22, fill: 'none',
        }));
      }
    }
    const fx = (from.minX + from.maxX) / 2, tx = (to.minX + to.maxX) / 2;
    const dip = Math.max(from.maxY, to.maxY) + 54;
    const fy = from.maxY + 4, ty = to.maxY + 4;
    g.appendChild(svgEl('path', {
      class: 'cb-move-arrow', fill: 'none',
      d: `M ${fx} ${fy} C ${fx} ${dip}, ${tx} ${dip}, ${tx} ${ty}`,
    }));
    g.appendChild(svgEl('polygon', {
      class: 'cb-move-head',
      points: `${tx},${ty - 2} ${tx - 8},${ty + 12} ${tx + 8},${ty + 12}`,
    }));
    return g;
  }

  // What the finger is carrying during a move: the WHOLE constituent, drawn
  // as a see-through copy following the hand. Carrying only the top node
  // was the root of the problem -- a wh-phrase is five nodes and two words,
  // and a lone circle floating off the top of it does not read as "this
  // phrase is moving". The tree itself stays put and laid out underneath,
  // so there is always something to aim at.
  _buildGhost() {
    const src = this.node(this.moveDrag.id);
    const dx = this.moveDrag.x - src._x, dy = this.moveDrag.y - src._y;
    const g = svgEl('g', { class: 'cb-ghost' });
    const kids = this.subtree(src.id);

    for (const n of kids) {
      for (const cid of n.childIds) {
        const c = this.node(cid);
        g.appendChild(svgEl('path', {
          class: 'tree-edge',
          d: `M ${n._x + dx} ${n._y + dy + this._edgeRadius(n)} C ${n._x + dx} ${(n._y + c._y) / 2 + dy}, ` +
             `${c._x + dx} ${(n._y + c._y) / 2 + dy}, ${c._x + dx} ${c._y + dy - this._edgeRadius(c)}`,
        }));
      }
    }
    for (const n of kids) {
      if (n.slot) continue;   // an empty position travels as a gap, not a box
      const el = n.isWord ? this._buildWordPiece(n) : this._buildNode(n);
      el.setAttribute('transform', `translate(${n._x + dx},${n._y + dy})`);
      el.removeAttribute('data-id');
      g.appendChild(el);
    }
    return g;
  }

  _buildNode(n) {
    // Real labels, not mystery numbers: by Level 9 both Mystery Levels have
    // been cracked, and this level's whole vocabulary ("the complement of
    // T") is unusable if the pieces are still called 1 and 1.5.
    const g = buildShapeGroup(n.catKey, nodeLabel(n.catKey, n.number), this.r, 0.56);
    const dragging = this.drag && this.rootOf(n.id).id === this.drag.rootId;
    const hinted = !!this.hintIds && (this.hintIds[0] === n.id || this.hintIds[0] === this.rootOf(n.id).id);
    const snippable = this.snipMode && this.seams.has(n.id);
    // Marked only once there is somewhere for it to go, so the halo doubles
    // as "the tree is now built enough for this to move" -- which is the
    // step order Level 10 depends on and would otherwise have to nag about.
    // Every node in the constituent wears it, not just the one at the top,
    // because every one of them can now be grabbed to move the whole thing.
    const canMove = !this.snipMode && !n.moved && !!this.movingPieceFor(n.id);
    let cls = 'tree-node';
    if (n.isTrace) cls += ' cb-trace';
    if (n.insertable) cls += ' cb-insertable';
    if (canMove) cls += ' cb-movable';
    if (dragging) cls += ' dragging';
    if (hinted) cls += ' hinted';
    if (this.snipMode) cls += snippable ? ' snippable' : ' snip-disabled';
    g.setAttribute('class', cls);
    g.setAttribute('transform', `translate(${n._x},${n._y})`);
    g.dataset.id = n.id;
    g.addEventListener('pointerdown', (ev) => this._onNodePointerDown(ev, n.id));

    if (n.word || n.silent) g.appendChild(this._buildWord(n));
    return g;
  }

  // A word handed out as a piece of its own (Levels 11-12). Loose, it is a
  // plain tile in the ink colour -- deliberately saying nothing about which
  // category it belongs to, since that is the thing being asked. Dropped
  // onto its head it takes that category's colour, which is the same
  // "right answer" signal Level 2 gives.
  _buildWordPiece(n) {
    const parent = n.parentId === null ? null : this.node(n.parentId);
    const colour = parent && parent.catKey ? CATEGORIES[parent.catKey].color : null;
    const dragging = this.drag && this.rootOf(n.id).id === this.drag.rootId;
    const hinted = !!this.hintIds && this.hintIds[0] === this.rootOf(n.id).id;
    const g = svgEl('g', {
      class: 'tree-node cb-word-piece' + (dragging ? ' dragging' : '') + (hinted ? ' hinted' : '') +
        (this.snipMode ? (this.seams.has(n.id) ? ' snippable' : ' snip-disabled') : ''),
      transform: `translate(${n._x},${n._y})`,
    });
    g.dataset.id = n.id;
    g.appendChild(svgEl('rect', {
      class: 'cb-word-box',
      x: -this.chipW / 2, y: -this.chipH / 2, width: this.chipW, height: this.chipH, rx: 10,
      fill: colour || '#fffdf9', stroke: colour || '#8a8375', 'stroke-width': colour ? 0 : 2.5,
    }));
    const t = svgEl('text', { x: 0, y: 1, class: 'cb-word-text' });
    t.textContent = n.word;
    t.dataset.room = this.chipW - 16;
    t.style.cssText = `font-size:${this.wordFont}px; font-weight:700; ` +
      `fill:${colour ? '#fff' : '#3b3a55'}; text-anchor:middle; ` +
      'dominant-baseline:middle; pointer-events:none; user-select:none;';
    g.appendChild(t);
    g.addEventListener('pointerdown', (ev) => this._onNodePointerDown(ev, n.id));
    return g;
  }

  // The word a head is pronounced as, in the same box Level 2 uses so the
  // two levels read as the same tree drawn twice. Levels 9 and 10 only --
  // there the word is part of the piece it came on. A tense with no auxiliary
  // shows ∅, exactly as it does there.
  _buildWord(n) {
    const y = this.r + 12 + this.chipH / 2;
    const cat = CATEGORIES[n.catKey];
    if (n.silent) {
      const t = svgEl('text', { x: 0, y: y + 1, class: 'cb-silent' });
      t.textContent = '∅';
      t.style.cssText = `font-size:${this.wordFont}px; text-anchor:middle; ` +
        'dominant-baseline:middle; pointer-events:none; user-select:none;';
      return t;
    }
    const g = svgEl('g', { transform: `translate(0,${y})` });
    // A trace keeps the same box and the same text size as any other word
    // -- it is the same word, said somewhere else -- but hollow and struck
    // through rather than solid. Exactly Level 2's treatment, so the two
    // levels agree about what a crossed-out copy looks like.
    g.appendChild(svgEl('rect', {
      x: -this.chipW / 2, y: -this.chipH / 2, width: this.chipW, height: this.chipH, rx: 10,
      fill: n.isTrace ? '#fffdf9' : cat.color,
      stroke: n.isTrace ? cat.color : 'none', 'stroke-width': n.isTrace ? 2.5 : 0,
    }));
    const t = svgEl('text', { x: 0, y: 1, class: 'cb-word-text' });
    t.textContent = n.word;
    t.dataset.room = this.chipW - 16;
    t.style.cssText = `font-size:${this.wordFont}px; font-weight:700; ` +
      `fill:${n.isTrace ? cat.color : '#fff'}; text-anchor:middle; ` +
      'dominant-baseline:middle; pointer-events:none; user-select:none;';
    g.appendChild(t);
    if (n.isTrace) {
      // An explicit line rather than text-decoration, so its length is tied
      // to the box instead of to however the browser measures the glyphs.
      g.appendChild(svgEl('line', {
        x1: -this.chipW / 2 + 10, y1: 1, x2: this.chipW / 2 - 10, y2: 1,
        stroke: cat.color, 'stroke-width': 2.5, 'stroke-linecap': 'round',
      }));
    }
    return g;
  }

  _buildSlot(n) {
    const w = this.slotW, h = this.r * 1.7;
    const ready = this.snapTarget && this.snapTarget.slotId === n.id;
    const hinted = !!this.hintIds && this.hintIds[1] === n.id;
    const g = svgEl('g', {
      class: 'cb-slot' + (ready ? ' ready' : '') + (hinted ? ' hinted' : '') + (this.snipMode ? ' snip-disabled' : ''),
      transform: `translate(${n._x},${n._y})`,
    });
    g.dataset.slotId = n.id;
    g.appendChild(svgEl('rect', {
      class: 'cb-slot-box',
      x: -w / 2, y: -h / 2, width: w, height: h, rx: 12,
    }));
    // Blank unless this is the box the hint is pointing at. Writing the
    // label onto exactly one box is the whole hint: it doesn't say which
    // piece to bring, only what this position is waiting for.
    if (!this.blankSlots || hinted) {
      const t = svgEl('text', { x: 0, y: 1, class: 'cb-slot-text' });
      t.textContent = SLOT_LABEL[n.role] || n.role;
      t.dataset.room = w - 18;
      t.style.fontSize = `${Math.round(this.r * 0.62)}px`;
      g.appendChild(t);
    }
    return g;
  }

  // Slot captions and words are whole English words of wildly different
  // lengths ("Specifier", "Complement", "the", "quickly"), so they are
  // measured and shrunk to fit their own box rather than trusted to a font
  // size picked for an average one. Same approach as fitShapeLabels, and it
  // has the same requirement: the elements must already be on screen.
  _fitSlotLabels(root) {
    for (const t of root.querySelectorAll('.cb-slot-text, .cb-word-text')) {
      const room = Number(t.dataset.room);
      let width;
      try { width = t.getComputedTextLength(); } catch { continue; }
      if (!width || !room || width <= room) continue;
      const current = parseFloat(t.style.fontSize) || 20;
      t.style.fontSize = `${current * (room / width)}px`;
    }
  }

  toSvgPoint(clientX, clientY) {
    const pt = this.svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(this.svg.getScreenCTM().inverse());
  }

  // ---- pointer handling ----
  // Identical scheme to Level 1's canvas: a press that lands on a piece is
  // swallowed here, so anything reaching the SVG itself started on empty
  // background -- one finger pans, two pinch.
  _bindBackgroundPointerEvents() {
    this.svg.addEventListener('pointerdown', (ev) => {
      if (this.snipMode) { this.setSnipMode(false); return; }
      ev.preventDefault();
      this.bgPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      this._restartBgGesture();
    });
  }

  _bindWheelZoom() {
    this.svg.addEventListener('wheel', (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      const wrap = this.svg.parentElement;
      const rect = wrap.getBoundingClientRect();
      const oldZoom = this.zoom;
      const newZoom = Math.max(this.minZoom(), Math.min(this.maxZoom(), oldZoom * Math.exp(-ev.deltaY * 0.01)));
      const contentX = (wrap.scrollLeft + ev.clientX - rect.left) / oldZoom;
      const contentY = (wrap.scrollTop + ev.clientY - rect.top) / oldZoom;
      this.zoom = newZoom;
      this.render();
      wrap.scrollLeft = contentX * newZoom - (ev.clientX - rect.left);
      wrap.scrollTop = contentY * newZoom - (ev.clientY - rect.top);
    }, { passive: false });
  }

  _restartBgGesture() {
    const wrap = this.svg.parentElement;
    const pts = [...this.bgPointers.values()];
    if (pts.length === 1) {
      this.bgAnchor = { mode: 'pan', x: pts[0].x, y: pts[0].y, scrollLeft: wrap.scrollLeft, scrollTop: wrap.scrollTop };
    } else if (pts.length === 2) {
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const midX = (pts[0].x + pts[1].x) / 2, midY = (pts[0].y + pts[1].y) / 2;
      const rect = wrap.getBoundingClientRect();
      this.bgAnchor = {
        mode: 'pinch', dist: dist || 1, zoom: this.zoom,
        contentX: (wrap.scrollLeft + midX - rect.left) / this.zoom,
        contentY: (wrap.scrollTop + midY - rect.top) / this.zoom,
      };
    } else {
      this.bgAnchor = null;
    }
  }

  _bindGlobalPointerEvents() {
    window.addEventListener('pointermove', (ev) => {
      if (this.bgPointers.has(ev.pointerId)) {
        ev.preventDefault();
        this.bgPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
        const wrap = this.svg.parentElement;
        const pts = [...this.bgPointers.values()];
        if (this.bgAnchor && this.bgAnchor.mode === 'pan' && pts.length === 1) {
          wrap.scrollLeft = this.bgAnchor.scrollLeft - (pts[0].x - this.bgAnchor.x);
          wrap.scrollTop = this.bgAnchor.scrollTop - (pts[0].y - this.bgAnchor.y);
        } else if (this.bgAnchor && this.bgAnchor.mode === 'pinch' && pts.length === 2) {
          const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
          const midX = (pts[0].x + pts[1].x) / 2, midY = (pts[0].y + pts[1].y) / 2;
          this.zoom = Math.max(this.minZoom(), Math.min(this.maxZoom(), this.bgAnchor.zoom * (dist / this.bgAnchor.dist)));
          this.render();
          const rect = wrap.getBoundingClientRect();
          wrap.scrollLeft = this.bgAnchor.contentX * this.zoom - (midX - rect.left);
          wrap.scrollTop = this.bgAnchor.contentY * this.zoom - (midY - rect.top);
        }
        return;
      }
      if (this.moveDrag) {
        ev.preventDefault();
        const p = this.toSvgPoint(ev.clientX, ev.clientY);
        this.moveDrag.px = p.x;
        this.moveDrag.py = p.y;
        this.moveDrag.x = p.x - this.moveDrag.grabX;
        this.moveDrag.y = p.y - this.moveDrag.grabY;
        const slotId = this._landingUnder(this.moveDrag.id, this.moveDrag);
        this.snapTarget = slotId ? { rootId: this.moveDrag.id, slotId } : null;
        this.render();
        return;
      }
      if (!this.drag) return;
      ev.preventDefault();
      const p = this.toSvgPoint(ev.clientX, ev.clientY);
      const root = this.node(this.drag.rootId);
      if (!root) return;
      root.x = p.x - this.drag.grabX;
      root.y = p.y - this.drag.grabY;
      this._layout();
      const slotId = this.findSlotFor(root.id);
      this.snapTarget = slotId ? { rootId: root.id, slotId } : null;
      this.render();
    }, { passive: false });

    const releaseBg = (ev) => { if (this.bgPointers.delete(ev.pointerId)) this._restartBgGesture(); };
    const endDrag = () => {
      if (this.moveDrag) {
        const drag = this.moveDrag;
        const id = drag.id;
        this.moveDrag = null;
        const slotId = this._landingUnder(id, drag);
        if (slotId) this.moveTo(id, slotId);
        else this._reportFailedMove(id);
        this.snapTarget = null;
        this.render();
        return;
      }
      if (!this.drag) return;
      const rootId = this.drag.rootId;
      this.drag = null;
      const slotId = this.findSlotFor(rootId);
      if (slotId) this.connect(rootId, slotId);
      else this._reportFailedDrop(rootId);
      this.snapTarget = null;
      this.render();
    };
    window.addEventListener('pointerup', (ev) => { releaseBg(ev); endDrag(); });
    window.addEventListener('pointercancel', (ev) => { releaseBg(ev); endDrag(); });
  }

  // A drop that lands nowhere gets an explanation, but only if it was
  // plausibly AIMED at something -- dropping a piece in open space is just
  // moving it, and deserves neither a complaint nor a tick on the counter.
  _reportFailedDrop(rootId) {
    const root = this.node(rootId);
    const near = this._slotDroppedOn(rootId);
    // Dropped anywhere but on a box. Shuffling pieces around the canvas to
    // get at them is ordinary handling, not a guess at an answer, so it
    // draws no comment, doesn't tick the hint counter, and above all costs
    // nothing where there is an allowance to spend.
    if (!near) { this.setFeedback(''); return; }

    // Naming the piece and the position, but never what the slot wants:
    // working out what fits where is the entire level.
    const label = this._pieceLabel(root);
    const owner = this._pieceLabel(this.node(near.parentId));
    let why;
    if (near.role === 'word') why = `${label} isn't the word that goes on ${owner}.`;
    else if (root.isWord) why = `${label} is a word — it goes on a piece, not into a branch.`;
    else if (near.role === 'spec') why = `A ${label} can't be the specifier of ${owner}.`;
    else if (near.role === 'head') why = `A ${label} can't be the head of ${owner}.`;
    else if (near.role === 'bar') why = `A ${label} can't sit under ${owner}.`;
    else if (near.role === 'adjunct') why = `A ${label} can't be an adjunct on ${owner}.`;
    else why = `A ${label} can't be the complement of ${owner}.`;
    if (!this.spendLife(why)) return;

    this.failedAttempts++;
    if (this.failedAttempts >= HINT_AFTER_ATTEMPTS) this._offerHint();
  }

  // Charge a wrong move against the round's allowance and say what it cost.
  // Returns false once they've run out, so callers stop there. With no
  // allowance set this is just "say what was wrong", which is what the
  // earlier levels do.
  spendLife(message) {
    if (!this.lives) { this.setFeedback(message, 'err'); return true; }
    this.livesLeft = Math.max(0, this.livesLeft - 1);
    const spent = this.livesLeft === 0;
    this.setFeedback(spent
      ? `${message} That was the last try.`
      : `${message} ${this.livesLeft} ${this.livesLeft === 1 ? 'try' : 'tries'} left.`, 'err');
    if (this.onLivesChange) this.onLivesChange();
    if (spent && this.onLivesOut) this.onLivesOut();
    return !spent;
  }

  // Which empty box, if any, a piece was actually dropped ON. Deliberately
  // stricter than the snap radius that CONNECTS two pieces: it is right to
  // be generous about what counts as a successful aim, and wrong to be
  // generous about what counts as a wrong answer. The test is the box's own
  // outline plus a little tolerance around the edges, so landing on it
  // counts and landing beside it doesn't.
  _slotDroppedOn(rootId) {
    const root = this.node(rootId);
    const halfW = this.slotW / 2 + 14;
    const halfH = this.r * 0.85 + 14;
    let best = null, bestDist = Infinity;
    for (const slot of this.emptySlots()) {
      if (this.rootOf(slot.id).id === rootId) continue;
      const dx = Math.abs(root._x - slot._x), dy = Math.abs(root._y - slot._y);
      if (dx > halfW || dy > halfH) continue;
      const d = dx + dy;
      if (d < bestDist) { bestDist = d; best = slot; }
    }
    return best;
  }

  // The landing site being aimed at. Two things count as aiming, because
  // two mental models are both reasonable with a whole phrase in hand: the
  // finger over the empty position, and the phrase itself lined up on it.
  // Whichever is closer wins, and the reach is wider than a plain
  // connection's because what is being aimed IS bigger.
  _landingUnder(nodeId, drag) {
    const reach = this.snapDistance * 1.4;
    let best = null, bestDist = Infinity;
    for (const slot of this.landingSlotsFor(nodeId)) {
      const d = Math.min(
        Math.hypot(drag.x - slot._x, drag.y - slot._y),
        Math.hypot((drag.px ?? drag.x) - slot._x, (drag.py ?? drag.y) - slot._y));
      if (d < reach && d < bestDist) { bestDist = d; best = slot.id; }
    }
    return best;
  }

  _reportFailedMove(id) {
    const node = this.node(id);
    const label = nodeLabel(node.catKey, node.number);
    this.setFeedback(`${label} didn't land anywhere — drop it right on an empty position.`, 'err');
    this.failedAttempts++;
    if (this.failedAttempts >= HINT_AFTER_ATTEMPTS) {
      const slots = this.landingSlotsFor(id);
      if (slots.length) {
        this.hintIds = [id, slots[0].id];
        this.failedAttempts = 0;
        this.setFeedback('That one goes in the glowing position — drop it right on top.', 'hint');
      }
    }
  }

  _offerHint() {
    for (const root of this.roots()) {
      for (const slot of this.emptySlots()) {
        if (!this.fits(root.id, slot.id)) continue;
        this.failedAttempts = 0;
        // Where the boxes are blank, the hint fills ONE of them in and
        // leaves the piece alone: it says what that position is waiting
        // for, and finding the thing that answers to that is still the
        // student's job. Glowing the piece as well would just be the
        // answer.
        this.hintIds = this.blankSlots ? [null, slot.id] : [root.id, slot.id];
        this.setFeedback(this.blankSlots
          ? 'One of the empty boxes is now showing what it\'s waiting for.'
          : 'This one fits — drag the glowing piece into the glowing slot.', 'hint');
        return true;
      }
    }
    this.failedAttempts = 0;
    return false;
  }

  _onNodePointerDown(ev, id) {
    ev.preventDefault();
    ev.stopPropagation();
    if (this.snipMode) {
      if (this.detachAt(id)) this.setSnipMode(false, { keepFeedback: true });
      return;
    }
    const n = this.node(id);

    // A silent head that can take a word: tapping it puts the word in.
    // That this comes before the drag is what enforces the real order --
    // `do` is inserted in T and raised from there, never dropped straight
    // into C, because until it has a word there is nothing to carry.
    if (n.insertable && n.silent) { this.insertWord(id); return; }

    // A silent head with no word to add. Saying nothing here would read as
    // a broken tap on the one node a student is most likely to try, and in
    // a subject question the reason is the lesson.
    if (n.silent && this.silentNote) { this.setFeedback(this.silentNote, 'hint'); return; }

    const p = this.toSvgPoint(ev.clientX, ev.clientY);

    // Something that can move, and somewhere for it to go: carry it. If
    // there is nowhere yet -- the piece it would land in hasn't been joined
    // on -- this falls through and drags the whole piece instead, which is
    // what the same press means everywhere else in the game.
    const mover = this.movingPieceFor(id);
    if (mover) {
      // The constituent comes away under the finger where it was grabbed,
      // rather than snapping its top node to the pointer -- picking a
      // phrase up by its noun shouldn't make it jump.
      this.moveDrag = { id: mover.id, x: mover._x, y: mover._y, px: p.x, py: p.y,
                        grabX: p.x - mover._x, grabY: p.y - mover._y };
      this.render();
      return;
    }

    // Whole pieces move, never a branch out of the middle of one -- taking
    // something apart is the scissors' job, and only the scissors'.
    const root = this.rootOf(id);
    this.drag = { rootId: root.id, grabX: p.x - root.x, grabY: p.y - root.y };
    this.render();
  }
}
