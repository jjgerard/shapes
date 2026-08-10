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
  // nodeGap has to clear a slot standing next to a shape -- slotW/2 + r
  // plus a little air -- or the dashed box overlaps the head beside it.
  desktop: { r: 28, levelGap: 92, nodeGap: 104, wordGap: 132, snapDistance: 96, margin: 900, pieceGap: 130, slotW: 118, chipW: 112, chipH: 42, wordFont: 24, springApart: 90 },
  mobile:  { r: 38, levelGap: 124, nodeGap: 130, wordGap: 168, snapDistance: 128, margin: 700, pieceGap: 150, slotW: 140, chipW: 146, chipH: 54, wordFont: 30, springApart: 110 },
};

// What a slot says on it. Kept as whole words rather than "Spec"/"Comp":
// this level is where the two terms are introduced, and an abbreviation of
// a word you have never seen is not a shorter version of it, it is a
// different unknown.
const SLOT_LABEL = { spec: 'Specifier', comp: 'Complement' };

class CombineEditor {
  constructor(svg) {
    this.svg = svg;
    this.nodes = new Map();   // id -> node record (see _addTree)
    this.nextId = 1;
    this.seams = new Map();   // nodeId -> {parentId, index, role, accepts} -- what filling a slot consumed
    this.drag = null;         // {rootId, grabX, grabY}
    this.snapTarget = null;   // {pieceId, slotId} currently in range
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
  load(pieces) {
    this.nodes = new Map();
    this.seams = new Map();
    this.nextId = 1;
    this.drag = null;
    this.snapTarget = null;
    this.snipMode = false;
    this.connectCount = 0;
    this.detachCount = 0;
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
    const node = spec.slot
      ? { id, slot: true, role: spec.slot, accepts: spec.accepts, parentId, childIds: [], x: 0, y: 0 }
      : {
          id, slot: false, catKey: spec.shape, number: spec.number,
          word: spec.word, silent: spec.silent,
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
    if (n.word || n.silent) return Math.max(this.r, this.chipW / 2);
    return this.r;
  }
  _bottom(n) {
    return (n.word || n.silent) ? this.r + this.chipH + 14 : this.r;
  }

  _componentBounds(rootId) {
    const ns = this.subtree(rootId);
    return {
      minX: Math.min(...ns.map(n => n._x - this._halfWidth(n))),
      maxX: Math.max(...ns.map(n => n._x + this._halfWidth(n))),
      minY: Math.min(...ns.map(n => n._y - this.r)),
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
      const b = this.contentBounds();
      const pad = 40;
      // The zoom/fit cluster floats over the bottom-right of the canvas, so
      // the opening view leaves it a strip of its own. Without this the
      // last piece dealt reliably starts out half-hidden behind the buttons
      // -- which is the same problem as a piece being off-screen, just
      // harder to spot.
      const padBottom = pad + 76;
      const rawW = (b.maxX - b.minX) + pad * 2, rawH = (b.maxY - b.minY) + pad + padBottom;
      this.zoom = Math.max(this.minZoom(),
        Math.min(1, wrap.clientWidth / rawW, wrap.clientHeight / rawH));
      this.render();
      const cw = rawW * this.zoom, ch = rawH * this.zoom;
      wrap.scrollLeft = Math.max(0, (b.minX - pad) * this.zoom - (wrap.clientWidth - cw) / 2);
      wrap.scrollTop = Math.max(0, (b.minY - pad) * this.zoom - (wrap.clientHeight - ch) / 2);
    });
  }

  // ---- connecting ----
  nodeKey(n) { return `${n.catKey}${n.number}`; }

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
    const parentLabel = nodeLabel(this.node(root.parentId).catKey, this.node(root.parentId).number);
    const label = nodeLabel(root.catKey, root.number);
    return role === 'spec'
      ? `${label} is now the specifier of ${parentLabel}.`
      : `${label} is now the complement of ${parentLabel}.`;
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

  // ---- state the host asks about ----
  isOneTree() { return this.roots().length === 1; }
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
      if (n.word && !n.silent) out.push(n.word);
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
          d: `M ${n._x} ${n._y + this.r} C ${n._x} ${(n._y + c._y) / 2}, ${c._x} ${(n._y + c._y) / 2}, ${c._x} ${c._y - this.r}`,
        }));
      }
    }

    for (const n of this.nodes.values()) {
      nodeLayer.appendChild(n.slot ? this._buildSlot(n) : this._buildNode(n));
    }

    fitShapeLabels(nodeLayer);
    this._fitSlotLabels(nodeLayer);
  }

  _buildNode(n) {
    // Real labels, not mystery numbers: by Level 9 both Mystery Levels have
    // been cracked, and this level's whole vocabulary ("the complement of
    // T") is unusable if the pieces are still called 1 and 1.5.
    const g = buildShapeGroup(n.catKey, nodeLabel(n.catKey, n.number), this.r, 0.56);
    const dragging = this.drag && this.rootOf(n.id).id === this.drag.rootId;
    const hinted = !!this.hintIds && this.hintIds[0] === this.rootOf(n.id).id;
    const snippable = this.snipMode && this.seams.has(n.id);
    let cls = 'tree-node';
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

  // The word a head is pronounced as, in the same box Level 2 uses so the
  // two levels read as the same tree drawn twice. A tense with no auxiliary
  // shows ∅, exactly as it does there.
  _buildWord(n) {
    const y = this.r + 12 + this.chipH / 2;
    if (n.silent) {
      const t = svgEl('text', { x: 0, y: y + 1 });
      t.textContent = '∅';
      t.style.cssText = `font-size:${this.wordFont}px; fill:#b7b0a2; text-anchor:middle; ` +
        'dominant-baseline:middle; pointer-events:none; user-select:none;';
      return t;
    }
    const g = svgEl('g', { transform: `translate(0,${y})` });
    g.appendChild(svgEl('rect', {
      x: -this.chipW / 2, y: -this.chipH / 2, width: this.chipW, height: this.chipH,
      rx: 10, fill: CATEGORIES[n.catKey].color,
    }));
    const t = svgEl('text', { x: 0, y: 1, class: 'cb-word-text' });
    t.textContent = n.word;
    t.dataset.room = this.chipW - 16;
    t.style.cssText = `font-size:${this.wordFont}px; font-weight:700; fill:#fff; text-anchor:middle; ` +
      'dominant-baseline:middle; pointer-events:none; user-select:none;';
    g.appendChild(t);
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
    const t = svgEl('text', { x: 0, y: 1, class: 'cb-slot-text' });
    t.textContent = SLOT_LABEL[n.role] || n.role;
    t.dataset.room = w - 18;
    t.style.fontSize = `${Math.round(this.r * 0.62)}px`;
    g.appendChild(t);
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
    const reach = this.snapDistance * 2;
    let near = null, bestDist = Infinity;
    for (const slot of this.emptySlots()) {
      if (this.rootOf(slot.id).id === rootId) continue;
      const d = Math.hypot(root._x - slot._x, root._y - slot._y);
      if (d < reach && d < bestDist) { bestDist = d; near = slot; }
    }
    if (!near) { this.setFeedback(''); return; }

    // Naming the piece and the position, but never what the slot wants:
    // working out what fits where is the entire level.
    const label = nodeLabel(root.catKey, root.number);
    const owner = nodeLabel(this.node(near.parentId).catKey, this.node(near.parentId).number);
    this.setFeedback(
      near.role === 'spec'
        ? `A ${label} can't be the specifier of ${owner}.`
        : `A ${label} can't be the complement of ${owner}.`,
      'err');

    this.failedAttempts++;
    if (this.failedAttempts >= HINT_AFTER_ATTEMPTS) this._offerHint();
  }

  _offerHint() {
    for (const root of this.roots()) {
      for (const slot of this.emptySlots()) {
        if (!this.fits(root.id, slot.id)) continue;
        this.hintIds = [root.id, slot.id];
        this.failedAttempts = 0;
        this.setFeedback('This one fits — drag the glowing piece into the glowing slot.', 'hint');
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
    // Whole pieces move, never a branch out of the middle of one -- taking
    // something apart is the scissors' job, and only the scissors'.
    const root = this.rootOf(id);
    const p = this.toSvgPoint(ev.clientX, ev.clientY);
    this.drag = { rootId: root.id, grabX: p.x - root.x, grabY: p.y - root.y };
    this.render();
  }
}
