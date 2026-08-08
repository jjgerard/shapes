// Drag-and-snap tree editor. Palette pieces are pre-built handout
// structures (root + its fixed children, exactly as shown on the paper
// handout) -- students never wire an individual shape-to-shape edge.
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
// The canvas has no fixed size: it's always exactly wide/tall enough for
// the current tree plus one empty slot, and every new piece drops into that
// slot at the bottom-right, growing the canvas in whichever direction is
// needed so nothing ever overlaps.

const SNAP_DISTANCE = 50;
const SLOT_WIDTH = 150;
const SLOT_HEIGHT = 150;
const SPRING_APART_OFFSET = 70;

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
    this.onRemoveChunk = null; // callback(structureId) invoked when a whole piece is deleted
    this.onChange = null;      // callback() invoked after any state change (for UI to refresh counters etc.)
    this.onSnipModeChange = null; // callback(bool) invoked whenever snip mode toggles
    this.onSnap = null;        // callback() invoked whenever two pieces snap together
    this.activePointers = new Map(); // pointerId -> {x,y} in screen space, for two-finger panning
    this.panLast = null; // midpoint of the two pan pointers, last frame
    this._bindGlobalPointerEvents();
    this._bindBackgroundPointerEvents();
  }

  open(minViewW, minViewH) {
    this.minViewW = minViewW;
    this.minViewH = minViewH;
    this.viewW = minViewW;
    this.viewH = minViewH;
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
    return Math.max(...this.nodes.map(n => n.x + 40));
  }
  contentBottom() {
    if (!this.nodes.length) return 0;
    return Math.max(...this.nodes.map(n => n.y + 40));
  }
  // Lowest extent of only the nodes that horizontally overlap [left,right]
  // -- used so a new piece only gets pushed down when it would actually
  // land on top of something, not just because the tree is tall elsewhere.
  contentBottomNear(left, right) {
    const relevant = this.nodes.filter(n => n.x + 26 > left && n.x - 26 < right);
    if (!relevant.length) return null;
    return Math.max(...relevant.map(n => n.y + 40));
  }
  canvasWidth() {
    return Math.max(this.minViewW || 0, this.contentRight() + SLOT_WIDTH);
  }
  canvasHeight() {
    return Math.max(this.minViewH || 0, this.contentBottom() + SLOT_HEIGHT);
  }

  // Spawn a whole pre-built handout piece (root + its fixed children),
  // dropped into the reserved slot at the bottom-right of the canvas. It
  // only gets pushed lower than the default row if something already
  // occupies that horizontal slot -- so pieces normally line up in one row
  // and the canvas only grows taller when it actually has to. Pass `pos` to
  // place it at an exact spot instead (used to seed the very first piece).
  addChunk(structureItem, pos) {
    let baseX, baseY;
    if (pos) {
      baseX = pos.x; baseY = pos.y;
    } else {
      baseX = this.contentRight() + SLOT_WIDTH / 2;
      const defaultY = Math.max((this.minViewH || 0) - 110, 40);
      const nearBottom = this.contentBottomNear(baseX - SLOT_WIDTH / 2, baseX + SLOT_WIDTH / 2);
      baseY = nearBottom === null ? defaultY : Math.max(defaultY, nearBottom + 40);
    }

    const rootId = this.nextId++;
    const root = {
      id: rootId, catKey: structureItem.shape, number: structureItem.number,
      x: baseX, y: baseY, chunkRoot: rootId, structureId: structureItem.id,
    };
    this.nodes.push(root);

    const n = structureItem.children.length;
    structureItem.children.forEach((c, i) => {
      const cx = baseX + (i - (n - 1) / 2) * 56;
      const cy = baseY + 68;
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

  // Deletes the whole original piece a node came from (you can't take a
  // pre-built piece apart by deleting -- only snip it apart, or remove it
  // entirely and try again).
  removeChunk(anyNodeId) {
    const node = this.nodes.find(n => n.id === anyNodeId);
    if (!node) return;
    const groupId = node.chunkRoot;
    const idsToRemove = new Set(this.nodes.filter(n => n.chunkRoot === groupId).map(n => n.id));
    if (this.onRemoveChunk) this.onRemoveChunk(node.structureId);
    this.nodes = this.nodes.filter(n => !idsToRemove.has(n.id));
    this.edges = this.edges.filter(e => !idsToRemove.has(e.parent) && !idsToRemove.has(e.child));
    this.render();
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
      if (dist < SNAP_DISTANCE && dist < bestDist) { bestDist = dist; best = other.id; }
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
      n.x += SPRING_APART_OFFSET;
      n.y += SPRING_APART_OFFSET;
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
    this.svg.setAttribute('viewBox', `0 0 ${this.viewW} ${this.viewH}`);
    this.svg.setAttribute('width', this.viewW);
    this.svg.setAttribute('height', this.viewH);

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
        d: `M ${p.x} ${p.y + 26} C ${p.x} ${(p.y + c.y) / 2}, ${c.x} ${(p.y + c.y) / 2}, ${c.x} ${c.y - 26}`,
      });
      edgeLayer.appendChild(path);
    }

    for (const n of this.nodes) {
      const g = buildShapeGroup(n.catKey, n.number, 26);
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

      const del = svgEl('circle', { class: 'node-delete', cx: 20, cy: -20, r: 11 });
      const delX = svgEl('text', { x: 20, y: -19, 'text-anchor': 'middle', 'dominant-baseline': 'middle', fill: '#fff', 'font-size': 12, 'pointer-events': 'none' });
      delX.textContent = '×';
      g.appendChild(del);
      g.appendChild(delX);

      del.addEventListener('pointerdown', (ev) => { ev.stopPropagation(); if (!this.snipMode) this.removeChunk(n.id); });
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

  // Two fingers on empty canvas pans the view (scrolls the container);
  // one finger only ever drags a piece. This is what lets touch-action be
  // locked to "none" (so a single-finger drag never gets hijacked as a
  // scroll) while still leaving a way to scroll around a big canvas.
  _bindBackgroundPointerEvents() {
    this.svg.addEventListener('pointerdown', (ev) => {
      if (this.snipMode) return; // node handler deals with snip clicks; background does nothing in snip mode
      this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      if (this.activePointers.size === 2) {
        this.panLast = this._pointersMidpoint();
        this.drag = null; // two fingers always wins over an in-progress single-finger drag
      }
    });
  }

  _pointersMidpoint() {
    const pts = [...this.activePointers.values()];
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }

  _bindGlobalPointerEvents() {
    window.addEventListener('pointermove', (ev) => {
      if (this.activePointers.has(ev.pointerId)) {
        this.activePointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      }
      if (this.activePointers.size === 2) {
        ev.preventDefault();
        const mid = this._pointersMidpoint();
        if (this.panLast) {
          const wrap = this.svg.parentElement;
          wrap.scrollLeft -= mid.x - this.panLast.x;
          wrap.scrollTop -= mid.y - this.panLast.y;
        }
        this.panLast = mid;
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
      const nx = Math.max(24, p.x - this.drag.offsetX);
      const ny = Math.max(24, p.y - this.drag.offsetY);
      const dx = nx - node.x, dy = ny - node.y;
      for (const id of this.subtreeOf(node.id)) {
        const n = this.nodes.find(x => x.id === id);
        n.x = Math.max(24, n.x + dx);
        n.y = Math.max(24, n.y + dy);
      }
      this.snapTargetId = this.findSnapTarget(node.id);
      this.render();
    }, { passive: false });
    const releasePointer = (ev) => {
      this.activePointers.delete(ev.pointerId);
      if (this.activePointers.size < 2) this.panLast = null;
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
    window.addEventListener('pointerup', (ev) => { releasePointer(ev); endDrag(); });
    // If the browser decides mid-gesture to treat this as a scroll after
    // all, it cancels the pointer instead of sending pointerup -- without
    // handling this too, drag state gets stuck and the NEXT attempt starts
    // from stale state, which is what caused "first try scrolls, second
    // try works."
    window.addEventListener('pointercancel', (ev) => { releasePointer(ev); endDrag(); });
  }

  _onNodePointerDown(ev, id) {
    ev.preventDefault();
    ev.stopPropagation();
    if (this.snipMode) {
      this.snipAt(id);
      this.setSnipMode(false);
      return;
    }
    if (this.activePointers.size >= 1) return; // a pan gesture is already in progress with another finger
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
