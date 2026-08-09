// Level 2: word matching. The tree is pre-made and already fully labeled
// (reusing the same "reveal" rendering the Level 1 Mystery Level uses --
// the category system is no longer a secret by now) -- the task is just to
// drag each word onto the head it belongs to. Words come up ONE AT A TIME,
// in random order, so there's never a full word list on screen to read the
// sentence off of -- each one has to be placed by its category alone. A
// head with no word at all (`silent`) is a tense with no auxiliary to carry
// it (∅) and is never a match target; a moved-away trace (`isTrace`) is a
// real match target like any other, it just reveals itself struck through,
// not in its category's color, once it's filled.

// `margin` matches Level 1's SIZING.scatterMargin exactly -- same amount of
// breathing room around the content on all four sides, even though this
// tree is static rather than draggable, for a consistent feel between the
// two canvases.
const WM_SIZING = {
  desktop: { r: 26, chipW: 112, chipH: 46, fontSize: 28, snapDist: 90, slotGapY: 34, margin: 1120 },
  mobile:  { r: 36, chipW: 142, chipH: 58, fontSize: 35, snapDist: 120, slotGapY: 44, margin: 800 },
};

class WordMatchEditor {
  constructor(svg) {
    this.svg = svg;
    this.drag = null;
    this.currentChip = null;
    this.zoom = 1;
    this.bgPointers = new Map(); // pointerId -> {x,y}, for background pan/pinch (same scheme as TreeEditor)
    this.bgAnchor = null;
    this.wrongForCurrentWord = 0; // resets on every new word, for the hint
    this.hintNode = null;         // the slot currently being pointed at, or null
    this.onPlace = null;    // callback() after any correct placement
    this.onComplete = null; // callback() once every slot is filled
    this.onReject = null;   // callback(message) when a drop doesn't land

    // The word-to-place lives OUTSIDE the (scrollable/scalable) SVG canvas
    // entirely -- a plain fixed-position element pinned near the bottom of
    // the screen. Its home position (see the .wm-chip-float CSS rule) sits
    // just above the docked mascot bar, so it's always visible without
    // scrolling and never sits underneath anything else.
    this.chipEl = document.createElement('button');
    this.chipEl.type = 'button';
    this.chipEl.className = 'wm-chip-float hidden';
    this.chipEl.addEventListener('pointerdown', (ev) => this._onChipPointerDown(ev));
    (svg.closest('.overlay') || document.body).appendChild(this.chipEl);

    this._bindPointerEvents();
    this._bindBackgroundPointerEvents();
    this._bindWheelZoom();
  }

  // Same fixed 5%-500% range as Level 1's canvas, for the same reason: a
  // dynamic minimum tied to content size means a big tree could hit a floor
  // well above 5% and still not fit; a flat range means every edge is
  // always reachable by panning from wherever you've zoomed to.
  minZoom() { return 0.05; }
  maxZoom() { return 5; }

  open(root, viewW, viewH) {
    this.root = root;
    this.sizing = window.innerWidth < 640 ? WM_SIZING.mobile : WM_SIZING.desktop;
    const s = this.sizing;

    const dims = layoutTree(root, s.chipW + 18, s.r * 2 + s.slotGapY + 40);
    this.treeWidth = dims.width;
    this.treeHeight = dims.height;
    this.viewW = Math.max(viewW || 0, dims.width + s.margin * 2);
    this.xOffset = Math.max(s.margin, (this.viewW - dims.width) / 2);
    this.viewH = Math.max(viewH || 0, this.treeHeight + s.margin * 2);
    this.yOffset = s.margin;
    this.zoom = 1;

    this.slotNodes = [];
    const collect = (node) => {
      node._filled = false;
      node._slotEl = null;
      if (node.word) this.slotNodes.push(node);
      node.children.forEach(collect);
    };
    collect(root);

    // One chip per slot, carrying whether it's the pronounced copy or the
    // crossed-out one left behind. "did the cat chase the mouse" hands you
    // a plain "did" and a struck-through "did" -- not two identical chips
    // -- so placing them is a claim about which position each belongs in,
    // rather than a coin flip between two indistinguishable options.
    this.queue = this.slotNodes.map(n => ({ word: n.word, isTrace: !!n.isTrace }));
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this.drag = null;
    this._nextChip();
    this.render();
    this._scrollToStart();
  }

  // Same idea as TreeEditor.scrollToStart(): zoom to fit and center when
  // the whole TREE (not the huge margin-inflated canvas -- that's scroll
  // room to have around it, not content that needs to fit on screen) fits
  // at a still-readable zoom; otherwise anchor at the top-left corner of
  // the tree itself and let panning/pinching reach the rest.
  _scrollToStart() {
    const wrap = this.svg.parentElement;
    if (!wrap) return;
    requestAnimationFrame(() => {
      // Same half-a-box overhang as contentBounds().
      const pad = 30 + this.sizing.chipW / 2;
      const rawW = this.treeWidth + pad * 2, rawH = this.treeHeight + pad * 2;
      const fitZoom = Math.min(1, wrap.clientWidth / rawW, wrap.clientHeight / rawH);
      this.zoom = fitZoom >= 0.5 ? fitZoom : 1;
      this.render();
      if (fitZoom >= 0.5) {
        const contentW = rawW * this.zoom, contentH = rawH * this.zoom;
        wrap.scrollLeft = Math.max(0, (this.xOffset - pad) * this.zoom - (wrap.clientWidth - contentW) / 2);
        wrap.scrollTop = Math.max(0, (this.yOffset - pad) * this.zoom - (wrap.clientHeight - contentH) / 2);
      } else {
        wrap.scrollLeft = Math.max(0, (this.xOffset - pad) * this.zoom);
        wrap.scrollTop = Math.max(0, (this.yOffset - pad) * this.zoom);
      }
    });
  }

  // Pulls the next word off the shuffled queue -- the only chip on screen
  // at any given time.
  _nextChip() {
    // A new word is a fresh problem -- the count of wrong tries is about
    // the word in your hand, not about the sentence as a whole.
    this.wrongForCurrentWord = 0;
    this.hintNode = null;
    const chip = this.queue.shift();
    if (chip === undefined) { this.currentChip = null; this.chipEl.classList.add('hidden'); return; }
    this.currentChip = chip;
    this.chipEl.textContent = chip.word;
    this.chipEl.classList.toggle('trace', chip.isTrace);
    this.chipEl.classList.remove('hidden');
    this._resetChipPosition();
  }

  // Home position comes from the .wm-chip-float CSS rule (left/bottom,
  // the latter keyed off --mascot-bar-h) -- just clear whatever inline
  // left/top/bottom a drag left behind so that rule applies again.
  _resetChipPosition() {
    this.chipEl.classList.remove('dragging');
    this.chipEl.style.left = '';
    this.chipEl.style.top = '';
    this.chipEl.style.bottom = '';
  }

  render() {
    const s = this.sizing;
    this.svg.setAttribute('viewBox', `0 0 ${this.viewW} ${this.viewH}`);
    // Explicit pixel width/height (not CSS 100%) -- the SVG renders at its
    // natural size scaled only by zoom, same as Level 1's canvas, so a big
    // tree needs scrolling/zooming to see fully rather than auto-shrinking
    // its text down to whatever fits the screen.
    this.svg.setAttribute('width', this.viewW * this.zoom);
    this.svg.setAttribute('height', this.viewH * this.zoom);
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    // xOffset is baked into paintStaticTree's own node coordinates (it
    // takes an xOffset param); yOffset is simpler as one wrapping
    // transform over both layers rather than threading it through every
    // node's y as well.
    const contentLayer = svgEl('g', { transform: `translate(0,${this.yOffset})` });
    this.svg.appendChild(contentLayer);

    const treeLayer = svgEl('g');
    contentLayer.appendChild(treeLayer);
    // Bigger than the default 0.5 -- these "DP / D′ / D⁰"-style labels are
    // read constantly while matching words, so they get their own larger
    // scale rather than sharing the size tuned for Level 1's bare numbers.
    paintStaticTree(treeLayer, this.root, { r: s.r, reveal: true, xOffset: this.xOffset, fontScale: 0.62 });

    // Movement sits UNDER the slots so an arrow can never obscure a word.
    const moveLayer = svgEl('g', { class: 'wm-moves' });
    contentLayer.appendChild(moveLayer);

    const overlayLayer = svgEl('g', { class: 'wm-overlay' });
    contentLayer.appendChild(overlayLayer);
    const walk = (node) => {
      const x = node._x + this.xOffset, y = node._y + s.r + s.slotGapY;
      if (node.word) overlayLayer.appendChild(this._buildSlot(node, x, y));
      else if (node.silent) overlayLayer.appendChild(this._buildSilent(x, y));
      node.children.forEach(walk);
    };
    walk(this.root);

    for (const mv of this._readyMovements()) moveLayer.appendChild(this._buildMovement(mv));

    this._fitWordText();
  }

  // The base font size is set from the BOX height, so a word fills its box
  // rather than floating in the middle of one. That leaves the long words
  // ("quickly", "chased") overflowing sideways, so this measures each one
  // now that it's in the document and shrinks only those that need it.
  // Measuring beats estimating from character count: "will" and "mill" are
  // the same length and nothing like the same width.
  _fitWordText() {
    const s = this.sizing;
    const maxWidth = s.chipW - 16;
    for (const node of this.slotNodes) {
      if (!node._filled || !node._slotEl) continue;
      const text = node._slotEl.querySelector('text');
      if (!text) continue;
      let width;
      try { width = text.getComputedTextLength(); } catch { continue; }
      if (!width || width <= maxWidth) continue;
      const shrunk = Math.max(11, s.fontSize * (maxWidth / width));
      text.style.fontSize = `${shrunk}px`;
    }
  }

  // ---- movement ----------------------------------------------------------
  // Both ends of a movement are tagged in the data with a shared id
  // (`traceOf` on the gap, `moved` on the landing site), so finding them is
  // a lookup rather than a guess about tree shape. That is what makes this
  // work unchanged in both formats: the same nodes carry the tags either
  // way, and the bar level only adds nodes in between that nothing here
  // looks at.
  _movements() {
    const origins = new Map(), landings = new Map();
    (function walk(n) {
      if (n.traceOf) origins.set(n.traceOf, n);
      if (n.moved) landings.set(n.moved, n);
      n.children.forEach(walk);
    })(this.root);
    const out = [];
    for (const [id, from] of origins) {
      const to = landings.get(id);
      if (to) out.push({ id, from, to, isPhrase: from.children.length > 0 });
    }
    return out;
  }

  // Only drawn once every word inside BOTH ends is placed -- the movement
  // is the payoff for having worked out where the copies go, so revealing
  // it early would give away the answer.
  _readyMovements() {
    const filled = (node) => {
      let ok = true;
      (function walk(n) { if (n.word && !n._filled) ok = false; n.children.forEach(walk); })(node);
      return ok;
    };
    return this._movements().filter(mv => filled(mv.from) && filled(mv.to));
  }

  // Bounding box of a node's whole subtree, in the same coordinates the
  // slots are drawn in, padded to enclose the word boxes hanging below it.
  _subtreeBox(node) {
    const s = this.sizing;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    (function walk(n) {
      minX = Math.min(minX, n._x); maxX = Math.max(maxX, n._x);
      minY = Math.min(minY, n._y); maxY = Math.max(maxY, n._y);
      n.children.forEach(walk);
    })(node);
    return {
      minX: minX + this.xOffset - s.chipW / 2 - 8,
      maxX: maxX + this.xOffset + s.chipW / 2 + 8,
      minY: minY - s.r - 8,
      maxY: maxY + s.r + s.slotGapY + s.chipH / 2 + 8,
    };
  }

  _buildMovement(mv) {
    const g = svgEl('g', { class: 'wm-move' });
    const from = this._subtreeBox(mv.from);
    const to = this._subtreeBox(mv.to);

    // What moved was a whole phrase, so ring both ends to show what the
    // arrow is actually carrying. A head moving on its own needs no ring:
    // the arrow already points at exactly one box on each end.
    if (mv.isPhrase) {
      for (const b of [from, to]) {
        g.appendChild(svgEl('rect', {
          class: 'wm-move-ring',
          x: b.minX, y: b.minY, width: b.maxX - b.minX, height: b.maxY - b.minY,
          rx: 22, fill: 'none',
        }));
      }
    }

    // Arrow from the gap up to the landing site, dipping below both so it
    // never crosses the tree itself -- the way movement is drawn on paper.
    const fx = (from.minX + from.maxX) / 2, tx = (to.minX + to.maxX) / 2;
    const dip = Math.max(from.maxY, to.maxY) + 46;
    const fy = from.maxY + 4, ty = to.maxY + 4;
    g.appendChild(svgEl('path', {
      class: 'wm-move-arrow',
      d: `M ${fx} ${fy} C ${fx} ${dip}, ${tx} ${dip}, ${tx} ${ty}`,
      fill: 'none',
    }));
    // The curve arrives travelling straight up (its last control point sits
    // directly below the end), so a fixed upward head is always correct.
    g.appendChild(svgEl('polygon', {
      class: 'wm-move-head',
      points: `${tx},${ty - 2} ${tx - 7},${ty + 11} ${tx + 7},${ty + 11}`,
    }));
    return g;
  }

  _buildSlot(node, x, y) {
    const s = this.sizing;
    const hinted = node === this.hintNode;
    const g = svgEl('g', { class: 'wm-slot' + (hinted ? ' hinted' : ''), transform: `translate(${x},${y})` });
    node._slotEl = g;
    const filled = !!node._filled;

    const cat = CATEGORIES[node.shape];

    // A filled trace gets the SAME box and the SAME text size as every
    // other word -- it used to be bare grey italic text with no box, which
    // read as an afterthought a third the size of its neighbours. It's a
    // word the student had to identify and place like any other, so it
    // should look like one. What marks it out is the treatment, not the
    // scale: a pale box in the category's colour with the word struck
    // through, rather than the solid colour a pronounced word gets.
    if (filled && node.isTrace) {
      g.appendChild(svgEl('rect', {
        x: -s.chipW / 2, y: -s.chipH / 2, width: s.chipW, height: s.chipH, rx: 10,
        fill: '#fffdf9', stroke: cat.color, 'stroke-width': 2.5,
      }));
      const t = svgEl('text', { x: 0, y: 1 });
      t.textContent = node.word;
      t.style.cssText = `font-size:${s.fontSize}px; font-weight:700; fill:${cat.color}; ` +
        'text-anchor:middle; dominant-baseline:middle; pointer-events:none; user-select:none;';
      g.appendChild(t);
      // An explicit strike rather than text-decoration: its length is then
      // tied to the box, not to however the browser measures the glyphs.
      g.appendChild(svgEl('line', {
        x1: -s.chipW / 2 + 10, y1: 1, x2: s.chipW / 2 - 10, y2: 1,
        stroke: cat.color, 'stroke-width': 2.5, 'stroke-linecap': 'round',
      }));
      return g;
    }
    // A hinted slot gets a solid amber outline (plus a CSS pulse on the
    // group) so it reads as "this one" against the dashed grey of every
    // other empty slot.
    g.appendChild(svgEl('rect', {
      x: -s.chipW / 2, y: -s.chipH / 2, width: s.chipW, height: s.chipH, rx: 10,
      fill: filled ? cat.color : (hinted ? '#fdf3d4' : '#eee9df'),
      stroke: filled ? cat.color : (hinted ? '#e8b400' : '#b7b0a2'),
      'stroke-width': filled ? 0 : (hinted ? 4 : 2),
      'stroke-dasharray': filled || hinted ? 'none' : '5 4',
    }));
    if (filled) {
      const label = svgEl('text', { x: 0, y: 1 });
      label.textContent = node.word;
      label.style.cssText = `font-size:${s.fontSize}px; font-weight:700; fill:#fff; text-anchor:middle; dominant-baseline:middle; pointer-events:none; user-select:none;`;
      g.appendChild(label);
    }
    return g;
  }

  _buildSilent(x, y) {
    const s = this.sizing;
    const t = svgEl('text', { x, y: y + 1 });
    t.textContent = '∅';
    t.style.cssText = `font-size:${s.fontSize + 2}px; fill:#b7b0a2; text-anchor:middle; dominant-baseline:middle; user-select:none;`;
    return t;
  }

  _onChipPointerDown(ev) {
    ev.preventDefault();
    if (!this.currentChip) return;
    const rect = this.chipEl.getBoundingClientRect();
    this.drag = { offsetX: ev.clientX - rect.left, offsetY: ev.clientY - rect.top };
    // 'auto', not '' -- clearing the inline value just falls back to the
    // stylesheet's own `bottom: calc(...)` rule (its home position), which
    // would then fight with the `top` we're about to drive from pointer
    // events: with both top AND bottom constraining a position:fixed
    // element of unspecified height, the browser stretches it to satisfy
    // both instead of moving it. Explicit 'auto' actually clears it.
    this.chipEl.style.bottom = 'auto';
    this.chipEl.style.left = rect.left + 'px';
    this.chipEl.style.top = rect.top + 'px';
    this.chipEl.classList.add('dragging');
    this.chipEl.setPointerCapture(ev.pointerId);
  }

  _bindPointerEvents() {
    this.chipEl.addEventListener('pointermove', (ev) => {
      if (!this.drag) return;
      ev.preventDefault();
      this.chipEl.style.left = (ev.clientX - this.drag.offsetX) + 'px';
      this.chipEl.style.top = (ev.clientY - this.drag.offsetY) + 'px';
    });
    const endDrag = (ev) => {
      if (!this.drag) return;
      this.drag = null;
      const target = this._findNearestSlot(ev.clientX, ev.clientY);
      if (target) this._attemptPlace(target);
      else this._resetChipPosition();
    };
    this.chipEl.addEventListener('pointerup', endDrag);
    this.chipEl.addEventListener('pointercancel', endDrag);
  }

  // Pan (one finger) / pinch-zoom (two fingers) on the canvas background --
  // the tree itself has nothing else draggable inside the SVG (the chip
  // lives outside it now), so every pointer that lands on the svg is a
  // background gesture; no need to distinguish "started on a piece" like
  // TreeEditor does.
  _bindBackgroundPointerEvents() {
    this.svg.addEventListener('pointerdown', (ev) => {
      ev.preventDefault();
      this.bgPointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      this._restartBgGesture();
    });
    window.addEventListener('pointermove', (ev) => {
      if (!this.bgPointers.has(ev.pointerId)) return;
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
    }, { passive: false });
    const releaseBg = (ev) => {
      if (this.bgPointers.delete(ev.pointerId)) this._restartBgGesture();
    };
    window.addEventListener('pointerup', releaseBg);
    window.addEventListener('pointercancel', releaseBg);
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

  // Trackpad pinch-to-zoom on a non-touchscreen laptop surfaces as a
  // 'wheel' event with ctrlKey set, not a touch/pointer gesture -- same
  // trick as TreeEditor's _bindWheelZoom.
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

  // Hit-tests in plain screen space against each slot's actual rendered
  // position -- no SVG coordinate conversion needed, since both the chip
  // and the slots can just answer getBoundingClientRect(). Filled slots are
  // included so a drop onto one can be told apart from a drop into empty
  // space: they're different mistakes and deserve different messages.
  _findNearestSlot(clientX, clientY) {
    const s = this.sizing;
    let best = null, bestDist = Infinity;
    for (const node of this.slotNodes) {
      if (!node._slotEl) continue;
      const r = node._slotEl.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(clientX - cx, clientY - cy);
      if (d < s.snapDist && d < bestDist) { bestDist = d; best = node; }
    }
    return best;
  }

  // The tree's bounding box in content coordinates, for the "Fit" button.
  // layoutTree() already pads treeHeight past the deepest node by more than
  // a word slot's height, so the slots hanging below each head are covered.
  contentBounds() {
    if (!this.root) return null;
    // A word box is centred on its node, so the outermost boxes hang half
    // their width past the tree's own edges -- which, once the boxes grew,
    // was enough to clip the leftmost word against the canvas edge.
    const overhang = this.sizing.chipW / 2 + 8;
    return {
      minX: this.xOffset - overhang,
      minY: this.yOffset,
      // Room for a movement arrow's dip below the deepest word slot, so
      // "Fit" frames the arrows too once they appear.
      maxX: this.xOffset + this.treeWidth + overhang,
      maxY: this.yOffset + this.treeHeight + 70,
    };
  }

  // Send the current word to the back of the queue. Without this a student
  // who can't place the word they've been handed is stuck for good: the
  // queue only advances on a correct placement, so the only way forward was
  // Clear, which throws away everything already placed.
  skipCurrentWord() {
    if (!this.currentChip || !this.queue.length) return false;
    this.queue.push(this.currentChip);
    this._nextChip();
    return true;
  }

  // Bounce the chip home with a visible shake, so a wrong drop reads as
  // "not that one" rather than as the drag having failed to register.
  _rejectChip() {
    this._resetChipPosition();
    this.chipEl.classList.remove('rejected');
    void this.chipEl.offsetWidth; // restart the animation on repeat misses
    this.chipEl.classList.add('rejected');
    clearTimeout(this._rejectTimer);
    this._rejectTimer = setTimeout(() => this.chipEl.classList.remove('rejected'), 500);
  }

  // A chip fits a slot only if the word matches AND they agree about
  // whether this is where the word is pronounced. Matching on the word
  // alone made the two "did"s interchangeable, so the question "which of
  // these positions is the pronounced one?" was never actually asked.
  _chipFits(node) {
    return normalizeAnswer(this.currentChip.word) === normalizeAnswer(node.word)
      && !!node.isTrace === !!this.currentChip.isTrace;
  }

  _attemptPlace(node) {
    if (node._filled) {
      this._rejectChip();
      if (this.onReject) this.onReject('That piece already has its word.');
      return;
    }
    // Right word, wrong copy -- worth its own explanation, since it's the
    // whole point of the exercise rather than a random miss.
    if (normalizeAnswer(this.currentChip.word) === normalizeAnswer(node.word) && !this._chipFits(node)) {
      this._rejectChip();
      this.wrongForCurrentWord++;
      if (this.wrongForCurrentWord >= HINT_AFTER_ATTEMPTS) {
        this.hintNode = this.slotNodes.find(n => !n._filled && this._chipFits(n)) || null;
      }
      this.render();
      if (this.onReject) {
        this.onReject(this.currentChip.isTrace
          ? `That's the crossed-out "${this.currentChip.word}" — it goes where the word moved FROM, not where you say it.`
          : `That's the "${this.currentChip.word}" you actually say — the crossed-out copy goes in the empty spot.`,
          this.hintNode ? 'hint' : undefined);
      }
      return;
    }
    if (this._chipFits(node)) {
      node._filled = true;
      playClickSound();
      this._nextChip();
      this.render();
      if (this.onPlace) this.onPlace();
      if (this.slotNodes.every(n => n._filled) && this.onComplete) this.onComplete();
    } else {
      this._rejectChip();
      this.wrongForCurrentWord++;
      // Three misses on the same word means the category isn't landing, and
      // another "try another one" won't change that. Show which piece it
      // belongs on -- but leave the placing to the student, so the move is
      // still theirs to make.
      if (this.wrongForCurrentWord >= HINT_AFTER_ATTEMPTS) {
        this.hintNode = this.slotNodes.find(n => !n._filled && this._chipFits(n)) || null;
      }
      this.render();
      if (this.onReject) {
        this.onReject(
          this.hintNode
            ? `"${this.currentChip.word}" goes on the glowing piece — drag it there.`
            : `"${this.currentChip.word}" doesn't belong on that piece — try another one.`,
          this.hintNode ? 'hint' : undefined);
      }
    }
  }
}
