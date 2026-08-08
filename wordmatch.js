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

const WM_SIZING = {
  desktop: { r: 26, chipW: 92, chipH: 42, fontSize: 15, snapDist: 90, slotGapY: 34 },
  mobile:  { r: 36, chipW: 122, chipH: 54, fontSize: 18, snapDist: 120, slotGapY: 44 },
};

class WordMatchEditor {
  constructor(svg) {
    this.svg = svg;
    this.drag = null;
    this.currentChip = null;
    this.onPlace = null;    // callback() after any correct placement
    this.onComplete = null; // callback() once every slot is filled

    // The word-to-place lives OUTSIDE the (scrollable/scalable) SVG canvas
    // entirely -- a plain fixed-position element pinned near the bottom of
    // the screen, above-left of the mascot's speech bubble (which sits
    // fixed bottom-right). It used to be drawn inside the SVG content
    // itself, which meant it could end up needing a scroll to reach on a
    // tall tree, or sitting right where the mascot bubble covers it; fixed
    // screen positioning makes it always visible and never covered.
    this.chipEl = document.createElement('button');
    this.chipEl.type = 'button';
    this.chipEl.className = 'wm-chip-float hidden';
    this.chipEl.addEventListener('pointerdown', (ev) => this._onChipPointerDown(ev));
    (svg.closest('.overlay') || document.body).appendChild(this.chipEl);

    this._bindPointerEvents();
  }

  open(root, viewW) {
    this.root = root;
    this.sizing = window.innerWidth < 640 ? WM_SIZING.mobile : WM_SIZING.desktop;
    const s = this.sizing;

    const dims = layoutTree(root, s.chipW + 18, s.r * 2 + s.slotGapY + 40);
    this.treeWidth = dims.width;
    this.treeHeight = dims.height;
    this.viewW = Math.max(viewW, dims.width + 40);
    this.xOffset = Math.max(20, (this.viewW - dims.width) / 2);
    this.viewH = this.treeHeight + 40;

    this.slotNodes = [];
    const collect = (node) => {
      node._filled = false;
      node._slotEl = null;
      if (node.word) this.slotNodes.push(node);
      node.children.forEach(collect);
    };
    collect(root);

    this.queue = this.slotNodes.map(n => n.word);
    for (let i = this.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.queue[i], this.queue[j]] = [this.queue[j], this.queue[i]];
    }
    this.drag = null;
    this._nextChip();
    this.render();
  }

  // Pulls the next word off the shuffled queue -- the only chip on screen
  // at any given time.
  _nextChip() {
    const word = this.queue.shift();
    if (word === undefined) { this.currentChip = null; this.chipEl.classList.add('hidden'); return; }
    this.currentChip = { word };
    this.chipEl.textContent = word;
    this.chipEl.classList.remove('hidden');
    this._resetChipPosition();
  }

  // Home position: fixed to the viewport, bottom-left -- clear of the
  // mascot's speech bubble, which sits fixed bottom-right. The bubble's
  // height varies with how long its hint text is, so a flat pixel offset
  // isn't enough on its own -- read the bubble's actual current top edge
  // and clear it, growing the offset on long hints instead of sitting
  // under them.
  _resetChipPosition() {
    const isMobile = window.innerWidth < 640;
    this.chipEl.classList.remove('dragging');
    this.chipEl.style.left = (isMobile ? 12 : 20) + 'px';
    let bottom = isMobile ? 84 : 96;
    const mascotWrap = document.querySelector('.mascot-wrap');
    if (mascotWrap) {
      const r = mascotWrap.getBoundingClientRect();
      bottom = Math.max(bottom, (window.innerHeight - r.top) + 14);
    }
    this.chipEl.style.bottom = bottom + 'px';
    this.chipEl.style.top = '';
  }

  render() {
    const s = this.sizing;
    this.svg.setAttribute('viewBox', `0 0 ${this.viewW} ${this.viewH}`);
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    const treeLayer = svgEl('g');
    this.svg.appendChild(treeLayer);
    paintStaticTree(treeLayer, this.root, { r: s.r, reveal: true, xOffset: this.xOffset });

    const overlayLayer = svgEl('g', { class: 'wm-overlay' });
    this.svg.appendChild(overlayLayer);
    const walk = (node) => {
      const x = node._x + this.xOffset, y = node._y + s.r + s.slotGapY;
      if (node.word) overlayLayer.appendChild(this._buildSlot(node, x, y));
      else if (node.silent) overlayLayer.appendChild(this._buildSilent(x, y));
      node.children.forEach(walk);
    };
    walk(this.root);
  }

  _buildSlot(node, x, y) {
    const s = this.sizing;
    const g = svgEl('g', { class: 'wm-slot', transform: `translate(${x},${y})` });
    node._slotEl = g;
    const filled = !!node._filled;

    // A filled trace reveals itself as a struck-through "ghost" of the
    // word -- no colored box -- so it still reads as "this word moved
    // away from here" even though the student had to actively place it.
    if (filled && node.isTrace) {
      const t = svgEl('text', { x: 0, y: 1 });
      t.textContent = node.word;
      t.style.cssText = `font-size:${s.fontSize - 1}px; font-style:italic; text-decoration:line-through; fill:#9a9284; text-anchor:middle; dominant-baseline:middle; user-select:none;`;
      g.appendChild(t);
      return g;
    }

    const cat = CATEGORIES[node.shape];
    g.appendChild(svgEl('rect', {
      x: -s.chipW / 2, y: -s.chipH / 2, width: s.chipW, height: s.chipH, rx: 10,
      fill: filled ? cat.color : '#eee9df',
      stroke: filled ? cat.color : '#b7b0a2',
      'stroke-width': filled ? 0 : 2,
      'stroke-dasharray': filled ? 'none' : '5 4',
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
    this.chipEl.style.bottom = '';
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

  // Hit-tests in plain screen space against each slot's actual rendered
  // position -- no SVG coordinate conversion needed, since both the chip
  // and the slots can just answer getBoundingClientRect().
  _findNearestSlot(clientX, clientY) {
    const s = this.sizing;
    let best = null, bestDist = Infinity;
    for (const node of this.slotNodes) {
      if (node._filled || !node._slotEl) continue;
      const r = node._slotEl.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(clientX - cx, clientY - cy);
      if (d < s.snapDist && d < bestDist) { bestDist = d; best = node; }
    }
    return best;
  }

  _attemptPlace(node) {
    if (normalizeAnswer(this.currentChip.word) === normalizeAnswer(node.word)) {
      node._filled = true;
      playClickSound();
      this._nextChip();
      this.render();
      if (this.onPlace) this.onPlace();
      if (this.slotNodes.every(n => n._filled) && this.onComplete) this.onComplete();
    } else {
      this._resetChipPosition();
    }
  }
}
