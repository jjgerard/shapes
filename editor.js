// Drag-and-snap tree editor. Every piece for a sub-level (a pre-built
// handout structure: root + its fixed children, exactly as shown on the
// paper handout) is scattered across the canvas up front via scatterAll(),
// like a jigsaw puzzle tipped out on a table -- there's no "add a piece"
// step, and students never wire an individual shape-to-shape edge either.
// Dragging a node carries everything BELOW it (its whole subtree) along,
// like picking up a mobile by one joint -- but never its parent or
// siblings, so two branches hanging off the same piece stay independent.
//
// Connecting is done by DRAGGING: pick up any node with an open branch (no
// children yet) and drop it on top of a freestanding piece of the exact
// same shape and number (or vice versa) -- they snap into one node. Touch
// and mouse both work, since everything runs on pointer events.
//
// SNIP mode does the reverse: click the scissors, then click a joint where
// two originally-separate pieces were snapped together, and they spring
// back apart into two freestanding pieces.
//
// The canvas has no fixed size: it's always exactly wide/tall enough to
// fit wherever the pieces currently are, growing as they're dragged around.
// One finger on empty canvas pans; two fingers pinch-zoom, with a minimum
// zoom that loosens as the puzzle grows so a big one can always be zoomed
// out to fit.

// Sizing is responsive, not a fixed constant -- a phone screen is where
// pieces and their numbers are hardest to see/hit, so mobile gets bigger
// shapes, bigger text (font size is derived from the shape radius, see
// buildShapeGroup in shapes.js) and more breathing room between pieces,
// not just a scaled-down copy of the desktop layout. Recomputed by
// _applySizing() every time the editor opens, so rotating a device or
// resizing the window between sub-levels picks up the right sizes.
// The floor for the opening view. Below this the labels stop being readable,
// so a puzzle too big to fit opens here and is panned rather than shrunk
// further.
const MIN_OPEN_ZOOM = 0.45;

const SIZING = {
  desktop: { nodeRadius: 32, snapDistance: 60, slotSize: 320, scatterMargin: 1120, gap: 240, childSpreadX: 76, childSpreadY: 90, springApart: 80 },
  mobile:  { nodeRadius: 44, snapDistance: 82, slotSize: 300, scatterMargin: 800, gap: 250, childSpreadX: 100, childSpreadY: 120, springApart: 90 },
};

class TreeEditor {
  constructor(svg) {
    this.svg = svg;
    this.nodes = [];   // {id, catKey, number, x, y, chunkRoot, structureId}
    this.edges = [];   // {parent: id, child: id}
    this.seams = new Map(); // leafId -> {catKey, number, chunkRoot, structureId, childIds} -- what snap() consumed, so snip can rebuild it
    this.nextId = 1;
    this.drag = null;         // {id, offsetX, offsetY}
    this.snapTargetId = null; // node currently hovered close enough to snap
    this.snipMode = false;
    this.snapCount = 0;
    this.snipCount = 0;
    this.failedAttempts = 0;   // failed snaps since the last successful one, for the hint
    this.hintIds = null;       // [leafId, rootId] currently being pointed at, or null
    this.onChange = null;      // callback() invoked after any state change (for UI to refresh counters etc.)
    this.onFeedback = null;    // callback(msg, kind) for anything worth telling the student
    this.onSnipModeChange = null; // callback(bool) invoked whenever snip mode toggles
    this.onSnap = null;        // callback() invoked whenever two pieces snap together
    this.zoom = 1;
    this.bgPointers = new Map(); // pointerId -> {x,y} in screen space, for background pan/pinch (not on a piece)
    this.bgAnchor = null;        // gesture anchor recomputed whenever bgPointers changes size
    this._applySizing();
    this._bindGlobalPointerEvents();
    this._bindBackgroundPointerEvents();
    this._bindWheelZoom();
  }

  // See SIZING above -- picks desktop vs. mobile proportions from the
  // current viewport width (same 640px breakpoint style.css uses).
  _applySizing() {
    const s = window.innerWidth < 640 ? SIZING.mobile : SIZING.desktop;
    this.nodeRadius = s.nodeRadius;
    this.edgeMargin = s.nodeRadius;
    this.snapDistance = s.snapDistance;
    this.slotWidth = s.slotSize;
    this.slotHeight = s.slotSize;
    this.scatterMargin = s.scatterMargin;
    this.colGap = s.gap;
    this.rowGap = s.gap;
    this.childSpreadX = s.childSpreadX;
    this.childSpreadY = s.childSpreadY;
    this.springApart = s.springApart;
  }

  open(minViewW, minViewH) {
    this._applySizing();
    this.minViewW = minViewW;
    this.minViewH = minViewH;
    this.viewW = minViewW;
    this.viewH = minViewH;
    this.zoom = 1;
    this.clear();
  }

  clear() {
    this.nodes = [];
    this.edges = [];
    this.seams = new Map();
    this.snapTargetId = null;
    this.snipMode = false;
    this.snapCount = 0;
    this.snipCount = 0;
    this.failedAttempts = 0;
    this.hintIds = null;
    this.nextId = 1;
    this.setFeedback('');
    this.render();
  }

  // Fixed range like Canva/Figma -- 5% to 500% -- rather than a bound
  // derived from content size. A dynamic minimum meant a big tree could
  // hit a floor well above 5% and still not fully fit; a fixed range
  // means you can always zoom out (or in) exactly as far as you want,
  // and pan to any edge of the canvas from there (see the "safe center"
  // note on .canvas-wrap in style.css for why every edge is reachable).
  minZoom() { return 0.05; }
  maxZoom() { return 5; }
  setZoom(z) {
    this.zoom = Math.max(this.minZoom(), Math.min(this.maxZoom(), z));
    this.render();
  }

  // Messages go wherever the host puts them -- in practice the mascot bar
  // at the bottom of the screen. They used to write into a line under the
  // modal title, which on a narrow phone wrapped to three or four lines,
  // grew the header, and shrank the canvas underneath by that much every
  // time a message appeared or cleared.
  setFeedback(msg, kind) {
    if (this.onFeedback) this.onFeedback(msg || '', kind || '');
  }

  // `keepFeedback` preserves whatever message is already showing instead of
  // blanking it. Turning snip mode off used to unconditionally clear the
  // feedback line, which meant the result of the snip that just turned it
  // off -- "Snipped apart", or the "nothing joined there" miss -- was wiped
  // in the same tick it was set, so a mis-tap in snip mode looked exactly
  // like the app ignoring you.
  setSnipMode(on, { keepFeedback = false } = {}) {
    this.snipMode = on;
    // The standing "you're in snip mode" instruction belongs to the host
    // (it sets it from onSnipModeChange), so that it can be the message
    // transient ones fall back to rather than competing with them for the
    // same slot.
    if (!on && !keepFeedback) this.setFeedback('');
    if (this.onSnipModeChange) this.onSnipModeChange(on);
    this.render();
  }

  // ---- dynamic sizing ----
  contentRight() {
    if (!this.nodes.length) return 0;
    return Math.max(...this.nodes.map(n => n.x + this.nodeRadius + 8));
  }
  contentBottom() {
    if (!this.nodes.length) return 0;
    return Math.max(...this.nodes.map(n => n.y + this.nodeRadius + 8));
  }
  canvasWidth() {
    return Math.max(this.minViewW || 0, this.contentRight() + this.slotWidth * 2);
  }
  canvasHeight() {
    return Math.max(this.minViewH || 0, this.contentBottom() + this.slotHeight * 2);
  }

  // Half the width of one silhouette, from its own SHAPE_REACH (shapes.js)
  // rather than the nominal radius. The difference is not cosmetic: P's
  // rectangle is 1.35r each side, so two rectangles as siblings are 2.7r wide
  // between them where a flat radius budgets 2r -- which is exactly why they
  // were overlapping each other inside their own piece.
  _halfWidth(shapeKey) {
    const silhouette = CATEGORIES[shapeKey] && CATEGORIES[shapeKey].shape;
    const reach = SHAPE_REACH[silhouette];
    return this.nodeRadius * (reach ? reach.r : 1) + 3;   // +3 for the stroke
  }

  // Where a piece's children sit relative to its root: laid out left to right
  // by their real widths and then centred under it, instead of stepped by one
  // pitch that every shape has to share. The gap between neighbours is the gap
  // the old fixed pitch produced for same-width shapes, so nothing moves for
  // the pieces that were already fine.
  _childOffsets(item) {
    const gap = Math.max(10, this.childSpreadX - this.nodeRadius * 2);
    const halves = item.children.map(c => this._halfWidth(c.shape));
    const total = halves.reduce((w, h) => w + h * 2, 0) + gap * (halves.length - 1);
    const out = [];
    let x = -total / 2;
    for (const h of halves) { out.push(x + h); x += h * 2 + gap; }
    return { offsets: out, halfWidth: Math.max(total / 2, this._halfWidth(item.shape)) };
  }

  // How much room a whole piece takes up, measured from its own root.
  _chunkHalfWidth(item) {
    return item.children.length ? this._childOffsets(item).halfWidth : this._halfWidth(item.shape);
  }
  _chunkBelow(item) {
    return (item.children.length ? this.childSpreadY : 0) + this.nodeRadius;
  }

  // How many pieces per row, chosen so the cluster ends up roughly the shape
  // of the screen it has to fit into. A square-ish grid (the old
  // ceil(sqrt(n))) lays a portrait phone's pieces out far wider than the phone
  // is, and scrollToStart then can't fit them at a readable zoom and falls
  // back to anchoring top-left -- which is how a six-piece level ends up
  // opening on two and a half pieces.
  //
  // Measured against the canvas itself where possible (openEditor unhides the
  // overlay first so it has a size here); the viewport is only the fallback,
  // for a caller that scatters while hidden.
  _columnsFor(items) {
    if (items.length < 2) return 1;
    const avgW = items.reduce((w, it) => w + this._chunkHalfWidth(it) * 2, 0) / items.length;
    const avgH = items.reduce((h, it) => h + this._chunkBelow(it), 0) / items.length + this.nodeRadius;
    const wrap = this.svg.parentElement;
    const boxW = (wrap && wrap.clientWidth) || window.innerWidth;
    const boxH = (wrap && wrap.clientHeight) || window.innerHeight;
    const want = Math.max(0.3, boxW / Math.max(1, boxH));
    let best = 1, bestErr = Infinity;
    for (let c = 1; c <= items.length; c++) {
      const aspect = (c * avgW) / (Math.ceil(items.length / c) * avgH);
      const err = Math.abs(Math.log(aspect / want));
      if (err < bestErr) { bestErr = err; best = c; }
    }
    return best;
  }

  // Dump every piece for this sub-level onto the canvas at once -- like a
  // jigsaw tipped out on a table. There's no "add a piece" step, everything
  // needed is already there to drag together.
  //
  // Laid out by MEASURING each piece rather than stepping a fixed grid pitch.
  // A single pitch has to be either wide enough for the widest piece (leaving
  // the small ones adrift in whitespace) or too narrow for it (leaving a
  // three-child piece overlapping whatever is beside it, which is what the
  // six-piece sub-level did on a phone). Rows are packed to measured widths
  // and centred on each other.
  //
  // leadWithRoot puts the first piece alone on the top row. For a build
  // sub-level that piece is the top of the finished tree, and starting it
  // above everything else is a much better first impression of the job than
  // finding it in the bottom-left corner of a grid sorted by piece id.
  scatterAll(structureItems, { leadWithRoot = false, preJoin = false } = {}) {
    if (!structureItems.length) return;
    const padX = this.nodeRadius * 1.25;
    const padY = this.nodeRadius * 1.1;

    const rows = [];
    if (leadWithRoot) rows.push([structureItems[0]]);
    const rest = leadWithRoot ? structureItems.slice(1) : structureItems;
    for (let i = 0; i < rest.length; i += this._columnsFor(rest)) {
      rows.push(rest.slice(i, i + this._columnsFor(rest)));
    }

    const rowWidth = row => row.reduce((w, it) => w + this._chunkHalfWidth(it) * 2, 0)
      + padX * (row.length - 1);
    const widest = Math.max(...rows.map(rowWidth));

    let y = this.scatterMargin;
    for (const row of rows) {
      y += this.nodeRadius;                        // top edge of the row -> root centre
      let x = this.scatterMargin + (widest - rowWidth(row)) / 2;
      for (const item of row) {
        x += this._chunkHalfWidth(item);
        this.addChunk(item, { x, y });
        x += this._chunkHalfWidth(item) + padX;
      }
      y += Math.max(...row.map(it => this._chunkBelow(it))) + padY;
    }
    if (preJoin) this.preJoinAll();   // re-frames the view itself
    else this.scrollToStart();
  }

  // Open the view anchored just above/left of the piece cluster (with a
  // little padding) instead of the empty buffer or dead-center of a much
  // bigger canvas -- the buffer is still there to drag into, you just
  // don't start out staring at blank canvas to reach it.
  //
  // Exception: if every piece can fit inside the visible wrap at a still-
  // readable zoom (true for small sub-levels, e.g. the first level's two
  // starter pieces), zoom to fit and center on the whole cluster instead --
  // anchoring to just the top-left corner at 100% could otherwise leave a
  // piece sitting off the right/bottom edge on a narrow phone screen even
  // though there was room to show both by zooming out just slightly (mobile
  // pieces are bigger/further apart than desktop ones to begin with, so a
  // strict "already fits at 100%" check was failing there in practice).
  //
  // And when it genuinely can't fit -- a six-piece level on a 360x640 phone --
  // it still opens at MIN_OPEN_ZOOM anchored on the pieces, rather than at
  // 100% where all but a couple of them are off-screen. A student who has to
  // pan before they can see what the puzzle even is has been handed a worse
  // problem than small shapes.
  scrollToStart() {
    const wrap = this.svg.parentElement;
    if (!wrap || !this.nodes.length) return;
    requestAnimationFrame(() => {
      const pad = 30;
      const minX = Math.min(...this.nodes.map(n => n.x - this.nodeRadius)) - pad;
      const minY = Math.min(...this.nodes.map(n => n.y - this.nodeRadius)) - pad;
      const maxX = Math.max(...this.nodes.map(n => n.x + this.nodeRadius)) + pad;
      const maxY = Math.max(...this.nodes.map(n => n.y + this.nodeRadius)) + pad;
      const rawW = maxX - minX, rawH = maxY - minY;
      const fitZoom = Math.min(1, wrap.clientWidth / rawW, wrap.clientHeight / rawH);
      if (fitZoom >= MIN_OPEN_ZOOM) {
        this.zoom = fitZoom;
        this.render();
        const contentW = rawW * this.zoom, contentH = rawH * this.zoom;
        wrap.scrollLeft = Math.max(0, minX * this.zoom - (wrap.clientWidth - contentW) / 2);
        wrap.scrollTop = Math.max(0, minY * this.zoom - (wrap.clientHeight - contentH) / 2);
      } else {
        this.zoom = MIN_OPEN_ZOOM;
        this.render();
        wrap.scrollLeft = Math.max(0, minX * this.zoom);
        wrap.scrollTop = Math.max(0, minY * this.zoom);
      }
    });
  }

  // Spawn a whole pre-built handout piece (root + its fixed children) at an
  // exact position.
  addChunk(structureItem, pos) {
    const baseX = pos.x, baseY = pos.y;
    const rootId = this.nextId++;
    const root = {
      id: rootId, catKey: structureItem.shape, number: structureItem.number,
      x: baseX, y: baseY, chunkRoot: rootId, structureId: structureItem.id,
    };
    this.nodes.push(root);

    const { offsets } = this._childOffsets(structureItem);
    structureItem.children.forEach((c, i) => {
      const cx = baseX + offsets[i];
      const cy = baseY + this.childSpreadY;
      const child = {
        id: this.nextId++, catKey: c.shape, number: c.number,
        x: cx, y: cy, chunkRoot: rootId, structureId: structureItem.id,
      };
      this.nodes.push(child);
      this.edges.push({ parent: rootId, child: child.id });
    });

    this.render();
    return root;
  }

  childrenOf(id) {
    return this.edges.filter(e => e.parent === id).map(e => e.child);
  }
  hasParent(id) {
    return this.edges.some(e => e.child === id);
  }
  // id plus every node hanging below it.
  subtreeOf(id) {
    const out = [id];
    for (const childId of this.childrenOf(id)) out.push(...this.subtreeOf(childId));
    return out;
  }

  // If aId/bId are compatible for snapping (same shape+number, one is an
  // open branch, the other a freestanding root), return [leafId, rootId] in
  // the right order. Otherwise null.
  resolveSnapPair(aId, bId) {
    if (aId === bId) return null;
    const a = this.nodes.find(n => n.id === aId);
    const b = this.nodes.find(n => n.id === bId);
    if (!a || !b || a.catKey !== b.catKey || a.number !== b.number) return null;
    const aOpen = this.childrenOf(aId).length === 0;
    const bOpen = this.childrenOf(bId).length === 0;
    const aFreeRoot = !this.hasParent(aId);
    const bFreeRoot = !this.hasParent(bId);
    if (aOpen && bFreeRoot) return [aId, bId];
    if (bOpen && aFreeRoot) return [bId, aId];
    return null;
  }

  // Nearest compatible partner to `nodeId` within snapping distance.
  findSnapTarget(nodeId) {
    const node = this.nodes.find(n => n.id === nodeId);
    if (!node) return null;
    let best = null, bestDist = Infinity;
    for (const other of this.nodes) {
      if (other.id === nodeId) continue;
      if (!this.resolveSnapPair(nodeId, other.id)) continue;
      const dx = node.x - other.x, dy = node.y - other.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < this.snapDistance && dist < bestDist) { bestDist = dist; best = other.id; }
    }
    return best;
  }

  // Merge leafId (an open branch) with rootId (a freestanding root) into
  // one node at leafId's position; rootId's children are adopted. Before
  // rootId disappears, remember exactly what it was so a later snip can
  // rebuild it as an identical, freestanding piece again.
  snap(leafId, rootId, { silent = false } = {}) {
    const root = this.nodes.find(n => n.id === rootId);
    this.seams.set(leafId, {
      catKey: root.catKey, number: root.number,
      chunkRoot: root.chunkRoot, structureId: root.structureId,
      childIds: this.childrenOf(rootId),
    });
    this.edges.forEach(e => { if (e.parent === rootId) e.parent = leafId; });
    this.nodes = this.nodes.filter(n => n.id !== rootId);
    // Getting somewhere clears the slate: the hint counter is about being
    // stuck right now, not about a tally over the whole puzzle.
    this.failedAttempts = 0;
    this.hintIds = null;
    // A silent snap is the app setting a puzzle up, not the student doing
    // something -- so it makes no sound, takes no credit, and stays out of
    // snapCount, which is what "Start over" reads to decide whether there is
    // any work worth confirming the loss of.
    if (silent) return;
    this.snapCount++;
    this.setFeedback('Snapped together.', 'ok');
    playClickSound();
    if (this.onSnap) this.onSnap();
    if (this.onChange) this.onChange();
  }

  // Open a sub-level with its pieces already joined. The scissors tutorial
  // needs this: there is nothing to cut until something has been snapped, and
  // making the student snap it first is the very thing that sub-level exists
  // to stop asking of them all at once.
  //
  // The subtree is moved onto its new parent before the join, because snap()
  // adopts children where they stand -- which is right when a student has
  // just dragged the piece into position, and leaves the children stranded
  // across the canvas when nobody has.
  preJoinAll() {
    for (let guard = this.nodes.length; guard > 0; guard--) {
      let pair = null;
      for (const a of this.nodes) {
        for (const b of this.nodes) {
          pair = this.resolveSnapPair(a.id, b.id);
          if (pair) break;
        }
        if (pair) break;
      }
      if (!pair) break;
      const [leafId, rootId] = pair;
      const leaf = this.nodes.find(n => n.id === leafId);
      const root = this.nodes.find(n => n.id === rootId);
      const dx = leaf.x - root.x, dy = leaf.y - root.y;
      for (const id of this.subtreeOf(rootId)) {
        const n = this.nodes.find(m => m.id === id);
        n.x += dx; n.y += dy;
      }
      this.snap(leafId, rootId, { silent: true });
    }
    this.setFeedback('');
    this.render();
    this.scrollToStart();
  }

  hasSeam(nodeId) {
    return this.seams.has(nodeId);
  }
  isSeam(parentId, childId) {
    const seam = this.seams.get(parentId);
    return !!seam && seam.childIds.includes(childId);
  }

  // Undo the snap recorded at `nodeId`: recreate the piece that was
  // consumed into it (same shape, same children) as a new freestanding
  // piece placed just next to it.
  // Returns true if something was actually snipped, so the caller can leave
  // snip mode on after a miss -- dropping out of the mode on every tap made
  // a near-miss feel like the scissors button had broken.
  snipAt(nodeId) {
    const seam = this.seams.get(nodeId);
    const leaf = this.nodes.find(n => n.id === nodeId);
    if (!seam || !leaf) {
      this.setFeedback('Nothing was joined there — tap a piece outlined in red.', 'err');
      return false;
    }
    const newRootId = this.nextId++;
    this.nodes.push({
      id: newRootId, catKey: seam.catKey, number: seam.number,
      x: leaf.x, y: leaf.y, chunkRoot: seam.chunkRoot, structureId: seam.structureId,
    });
    for (const childId of seam.childIds) {
      const e = this.edges.find(edge => edge.parent === nodeId && edge.child === childId);
      if (e) e.parent = newRootId;
    }
    // Spring the WHOLE reconstructed piece apart together -- the new root
    // starts exactly where it was consumed, then the entire subtree
    // (root + every descendant, wherever they've been dragged to) shifts
    // by the same amount, so it moves as one rigid piece, not just the root.
    for (const id of this.subtreeOf(newRootId)) {
      const n = this.nodes.find(x => x.id === id);
      n.x += this.springApart;
      n.y += this.springApart;
    }
    this.seams.delete(nodeId);
    this.snipCount++;
    this.failedAttempts = 0;
    this.hintIds = null;
    this.setFeedback('Snipped apart.', 'ok');
    if (this.onChange) this.onChange();
    return true;
  }

  // The bounding box of every piece currently on the canvas, in content
  // coordinates -- what the "Fit" button re-frames to (see canvas.js).
  contentBounds() {
    if (!this.nodes.length) return null;
    const r = this.nodeRadius;
    return {
      minX: Math.min(...this.nodes.map(n => n.x - r)),
      minY: Math.min(...this.nodes.map(n => n.y - r)),
      maxX: Math.max(...this.nodes.map(n => n.x + r)),
      maxY: Math.max(...this.nodes.map(n => n.y + r)),
    };
  }

  // ---- rendering ----
  render() {
    this.viewW = this.canvasWidth();
    this.viewH = this.canvasHeight();
    // viewBox stays in natural (unzoomed) content coordinates -- that's the
    // space every node's x/y and all the drag/snap math lives in. Zoom is
    // applied purely by rendering that same viewBox into a bigger or
    // smaller pixel box; getScreenCTM() (used by toSvgPoint) accounts for
    // this automatically, so nothing else needs to know zoom exists.
    this.svg.setAttribute('viewBox', `0 0 ${this.viewW} ${this.viewH}`);
    this.svg.setAttribute('width', this.viewW * this.zoom);
    this.svg.setAttribute('height', this.viewH * this.zoom);

    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);
    const edgeLayer = svgEl('g', { class: 'edge-layer' });
    const nodeLayer = svgEl('g', { class: 'node-layer' });
    this.svg.appendChild(edgeLayer);
    this.svg.appendChild(nodeLayer);

    for (const e of this.edges) {
      const p = this.nodes.find(n => n.id === e.parent);
      const c = this.nodes.find(n => n.id === e.child);
      if (!p || !c) continue;
      const path = svgEl('path', {
        class: 'tree-edge' + (this.snipMode && this.isSeam(e.parent, e.child) ? ' seam' : ''),
        d: `M ${p.x} ${p.y + this.nodeRadius} C ${p.x} ${(p.y + c.y) / 2}, ${c.x} ${(p.y + c.y) / 2}, ${c.x} ${c.y - this.nodeRadius}`,
      });
      edgeLayer.appendChild(path);
    }

    for (const n of this.nodes) {
      const g = buildShapeGroup(n.catKey, n.number, this.nodeRadius);
      const isDragging = this.drag && this.drag.id === n.id;
      const isTarget = n.id === this.snapTargetId;
      const isSnippable = this.snipMode && this.hasSeam(n.id);
      const isHinted = !!this.hintIds && this.hintIds.includes(n.id);
      let cls = 'tree-node';
      if (isDragging) cls += ' dragging';
      if (isHinted) cls += ' hinted';
      if (isTarget) cls += ' snap-ready';
      if (this.snipMode) cls += isSnippable ? ' snippable' : ' snip-disabled';
      g.setAttribute('class', cls);
      g.setAttribute('transform', `translate(${n.x},${n.y})`);
      g.dataset.id = n.id;

      g.addEventListener('pointerdown', (ev) => this._onNodePointerDown(ev, n.id));

      nodeLayer.appendChild(g);
    }

    fitShapeLabels(nodeLayer);
  }

  toSvgPoint(clientX, clientY) {
    const pt = this.svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const m = this.svg.getScreenCTM().inverse();
    return pt.matrixTransform(m);
  }

  // A touch that starts on a piece is captured by _onNodePointerDown
  // (which stopPropagation()s), so anything reaching the svg itself started
  // on empty canvas: one finger pans, two fingers pinch-zoom (and pan
  // together via their midpoint). Recomputed from scratch whenever the
  // number of active background pointers changes, so lifting one finger of
  // a pinch smoothly continues as a single-finger pan instead of jumping.
  _bindBackgroundPointerEvents() {
    this.svg.addEventListener('pointerdown', (ev) => {
      // Tapping empty canvas while the scissors are armed cancels snip mode
      // rather than doing nothing at all -- without this, someone who armed
      // the scissors by accident had no obvious way back out except finding
      // the (now red) scissors button again.
      if (this.snipMode) { this.setSnipMode(false); return; }
      ev.preventDefault();
      this.bgPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      this._restartBgGesture();
    });
  }

  // Trackpad pinch-to-zoom never reaches _bindBackgroundPointerEvents on a
  // non-touchscreen laptop -- a trackpad pinch has no touch/pointer events
  // at all, browsers surface it as a 'wheel' event with ctrlKey set (the
  // same trick maps-style apps rely on). Plain two-finger scrolling (no
  // ctrlKey) is left alone so it keeps doing the browser's native scroll.
  _bindWheelZoom() {
    this.svg.addEventListener('wheel', (ev) => {
      if (!ev.ctrlKey) return;
      ev.preventDefault();
      const wrap = this.svg.parentElement;
      const rect = wrap.getBoundingClientRect();
      const oldZoom = this.zoom;
      const factor = Math.exp(-ev.deltaY * 0.01);
      const newZoom = Math.max(this.minZoom(), Math.min(this.maxZoom(), oldZoom * factor));
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
      // Non-passive + preventDefault is required here: without it, mobile
      // browsers can decide mid-gesture that this is a page scroll instead
      // of our drag, since touch-action on the SVG node isn't reliably
      // honored on all mobile browsers.
      ev.preventDefault();
      const p = this.toSvgPoint(ev.clientX, ev.clientY);
      const node = this.nodes.find(n => n.id === this.drag.id);
      if (!node) return;
      const nx = Math.max(this.edgeMargin, p.x - this.drag.offsetX);
      const ny = Math.max(this.edgeMargin, p.y - this.drag.offsetY);
      const dx = nx - node.x, dy = ny - node.y;
      for (const id of this.subtreeOf(node.id)) {
        const n = this.nodes.find(x => x.id === id);
        n.x = Math.max(this.edgeMargin, n.x + dx);
        n.y = Math.max(this.edgeMargin, n.y + dy);
      }
      this.snapTargetId = this.findSnapTarget(node.id);
      this.render();
    }, { passive: false });
    const releaseBg = (ev) => {
      if (this.bgPointers.delete(ev.pointerId)) this._restartBgGesture();
    };
    const endDrag = () => {
      if (!this.drag) return;
      const id = this.drag.id;
      this.drag = null;
      const targetId = this.findSnapTarget(id);
      if (targetId) {
        const pair = this.resolveSnapPair(id, targetId);
        if (pair) this.snap(pair[0], pair[1]);
      } else {
        this._reportFailedSnap(id);
      }
      this.snapTargetId = null;
      this.render();
    };
    window.addEventListener('pointerup', (ev) => { releaseBg(ev); endDrag(); });
    // If the browser decides mid-gesture to treat this as a scroll after
    // all, it cancels the pointer instead of sending pointerup -- without
    // handling this too, drag state gets stuck and the NEXT attempt starts
    // from stale state.
    window.addEventListener('pointercancel', (ev) => { releaseBg(ev); endDrag(); });
  }

  // Dropping a piece next to one it can't join used to do nothing whatsoever
  // -- no sound, no message, no movement -- which reads as "this app is
  // broken" rather than "those two don't go together". Say why, without
  // naming any category: which shape is which is still the secret Level 1
  // is built around, so the wording stays at the level of "shape" and
  // "number", exactly what's visible on the piece.
  _reportFailedSnap(id) {
    const node = this.nodes.find(n => n.id === id);
    if (!node) return;
    const carried = new Set(this.subtreeOf(id));
    const reach = this.snapDistance * 1.9;
    let near = null, bestDist = Infinity;
    for (const other of this.nodes) {
      if (carried.has(other.id)) continue;
      const d = Math.hypot(node.x - other.x, node.y - other.y);
      if (d < reach && d < bestDist) { bestDist = d; near = other; }
    }
    // Dropped in open space -- that's just moving a piece around, not a
    // failed attempt at anything, so it deserves no complaint and no tick
    // on the counter.
    if (!near) { this.setFeedback(''); return; }

    if (near.catKey !== node.catKey) {
      this.setFeedback("Those two don't fit — pieces only join another piece of the same shape.", 'err');
    } else if (near.number !== node.number) {
      this.setFeedback('Same shape, but different numbers — the number has to match too.', 'err');
    } else {
      this.setFeedback('Right shape and number, but neither one has a free branch to plug into.', 'err');
    }

    this.failedAttempts++;
    if (this.failedAttempts >= HINT_AFTER_ATTEMPTS) this._offerHint();
  }

  // Point at a pair that genuinely fits, rather than leaving someone to
  // keep guessing. Explaining why each individual attempt failed is only
  // useful while the explanations are still telling you something new;
  // after three in a row they're just repeating themselves.
  _offerHint() {
    for (const a of this.nodes) {
      for (const b of this.nodes) {
        const pair = this.resolveSnapPair(a.id, b.id);
        if (!pair) continue;
        this.hintIds = pair;
        this.failedAttempts = 0;
        this.setFeedback('Here are two that fit — drag either glowing piece onto the other.', 'hint');
        return true;
      }
    }
    // Nothing left that can legally join. Either it's finished or every
    // remaining piece is already plugged in, so there's no hint to give.
    this.failedAttempts = 0;
    return false;
  }

  _onNodePointerDown(ev, id) {
    ev.preventDefault();
    ev.stopPropagation();
    if (this.snipMode) {
      // Stay in snip mode on a miss so the next tap can try again.
      if (this.snipAt(id)) this.setSnipMode(false, { keepFeedback: true });
      return;
    }
    const node = this.nodes.find(n => n.id === id);
    const p = this.toSvgPoint(ev.clientX, ev.clientY);
    this.drag = { id, offsetX: p.x - node.x, offsetY: p.y - node.y };
    this.render();
  }

  // Build the forest of root nodes (nodes with no parent) as nested
  // {shape, number, children:[...]} objects, matching data.js target shape.
  toForest() {
    const build = (id) => {
      const n = this.nodes.find(x => x.id === id);
      return { shape: n.catKey, number: n.number, children: this.childrenOf(id).map(build) };
    };
    const rootIds = this.nodes.filter(n => !this.hasParent(n.id)).map(n => n.id);
    return rootIds.map(build);
  }
}
