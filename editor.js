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
const SIZING = {
  desktop: { nodeRadius: 32, snapDistance: 60, slotSize: 230, scatterMargin: 190, gap: 200, childSpreadX: 76, childSpreadY: 90, springApart: 80 },
  mobile:  { nodeRadius: 44, snapDistance: 82, slotSize: 250, scatterMargin: 150, gap: 220, childSpreadX: 100, childSpreadY: 120, springApart: 90 },
};

class TreeEditor {
  constructor(svg, feedbackEl) {
    this.svg = svg;
    this.feedbackEl = feedbackEl;
    this.nodes = [];   // {id, catKey, number, x, y, chunkRoot, structureId}
    this.edges = [];   // {parent: id, child: id}
    this.seams = new Map(); // leafId -> {catKey, number, chunkRoot, structureId, childIds} -- what snap() consumed, so snip can rebuild it
    this.nextId = 1;
    this.drag = null;         // {id, offsetX, offsetY}
    this.snapTargetId = null; // node currently hovered close enough to snap
    this.snipMode = false;
    this.snapCount = 0;
    this.snipCount = 0;
    this.onChange = null;      // callback() invoked after any state change (for UI to refresh counters etc.)
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
    this.nextId = 1;
    this.setFeedback('');
    this.render();
  }

  // Zoom can go as low as needed to fit the whole tree in the visible
  // canvas area, so a big tree is never stuck too large to see.
  minZoom() {
    const wrap = this.svg.parentElement;
    const availW = (wrap && wrap.clientWidth) || 300;
    const availH = (wrap && wrap.clientHeight) || 300;
    const fit = Math.min(availW / this.viewW, availH / this.viewH);
    return Math.max(0.15, Math.min(1, fit) * 0.92);
  }
  maxZoom() { return 2.5; }
  setZoom(z) {
    this.zoom = Math.max(this.minZoom(), Math.min(this.maxZoom(), z));
    this.render();
  }

  setFeedback(msg, kind) {
    this.feedbackEl.textContent = msg || '';
    this.feedbackEl.className = 'editor-feedback' + (kind ? ' ' + kind : '');
  }

  setSnipMode(on) {
    this.snipMode = on;
    this.setFeedback(on ? 'Snip mode: click a joint to pull it apart.' : '');
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
    return Math.max(this.minViewW || 0, this.contentRight() + this.slotWidth / 2);
  }
  canvasHeight() {
    return Math.max(this.minViewH || 0, this.contentBottom() + this.slotHeight / 2);
  }

  // Dump every piece for this sub-level onto the canvas at once, laid out
  // in a grid centered in the middle of the canvas -- like a jigsaw puzzle
  // tipped out on a table. There's no "add a piece" step, everything
  // needed is already there to drag together.
  scatterAll(structureItems) {
    const cols = Math.max(2, Math.ceil(Math.sqrt(structureItems.length * 1.3)));
    const rows = Math.ceil(structureItems.length / cols);
    const offsetX = this.scatterMargin + this.colGap / 2;
    const offsetY = this.scatterMargin + this.rowGap / 2;
    structureItems.forEach((item, i) => {
      const col = i % cols, row = Math.floor(i / cols);
      this.addChunk(item, { x: offsetX + col * this.colGap, y: offsetY + row * this.rowGap });
    });
    this.scrollToStart();
  }

  // Open the view anchored just above/left of the piece cluster (with a
  // little padding) instead of the empty buffer or dead-center of a much
  // bigger canvas -- the buffer is still there to drag into, you just
  // don't start out staring at blank canvas to reach it.
  scrollToStart() {
    const wrap = this.svg.parentElement;
    if (!wrap) return;
    requestAnimationFrame(() => {
      const pad = 30;
      wrap.scrollLeft = Math.max(0, (this.scatterMargin - pad) * this.zoom);
      wrap.scrollTop = Math.max(0, (this.scatterMargin - pad) * this.zoom);
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

    const n = structureItem.children.length;
    structureItem.children.forEach((c, i) => {
      const cx = baseX + (i - (n - 1) / 2) * this.childSpreadX;
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
  snap(leafId, rootId) {
    const root = this.nodes.find(n => n.id === rootId);
    this.seams.set(leafId, {
      catKey: root.catKey, number: root.number,
      chunkRoot: root.chunkRoot, structureId: root.structureId,
      childIds: this.childrenOf(rootId),
    });
    this.edges.forEach(e => { if (e.parent === rootId) e.parent = leafId; });
    this.nodes = this.nodes.filter(n => n.id !== rootId);
    this.snapCount++;
    this.setFeedback('Snapped together.', 'ok');
    if (this.onSnap) this.onSnap();
    if (this.onChange) this.onChange();
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
  snipAt(nodeId) {
    const seam = this.seams.get(nodeId);
    const leaf = this.nodes.find(n => n.id === nodeId);
    if (!seam || !leaf) {
      this.setFeedback('Nothing joined there.', 'err');
      return;
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
    this.setFeedback('Snipped apart.', 'ok');
    if (this.onChange) this.onChange();
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
      let cls = 'tree-node';
      if (isDragging) cls += ' dragging';
      if (isTarget) cls += ' snap-ready';
      if (this.snipMode) cls += isSnippable ? ' snippable' : ' snip-disabled';
      g.setAttribute('class', cls);
      g.setAttribute('transform', `translate(${n.x},${n.y})`);
      g.dataset.id = n.id;

      g.addEventListener('pointerdown', (ev) => this._onNodePointerDown(ev, n.id));

      nodeLayer.appendChild(g);
    }
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
      if (this.snipMode) return;
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

  _onNodePointerDown(ev, id) {
    ev.preventDefault();
    ev.stopPropagation();
    if (this.snipMode) {
      this.snipAt(id);
      this.setSnipMode(false);
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
