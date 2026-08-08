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
  desktop: { r: 26, chipW: 92, chipH: 42, fontSize: 15, snapDist: 62, slotGapY: 34, bankGapY: 46 },
  mobile:  { r: 36, chipW: 122, chipH: 54, fontSize: 18, snapDist: 90, slotGapY: 44, bankGapY: 56 },
};

class WordMatchEditor {
  constructor(svg) {
    this.svg = svg;
    this.drag = null;
    this.currentChip = null;
    this.onPlace = null;    // callback() after any correct placement
    this.onComplete = null; // callback() once every slot is filled
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
    this.viewH = this.treeHeight + s.bankGapY + s.chipH + 30;

    this.slotNodes = [];
    const collect = (node) => {
      node._filled = false;
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
    const s = this.sizing;
    const word = this.queue.shift();
    if (word === undefined) { this.currentChip = null; return; }
    const homeX = this.viewW / 2, homeY = this.treeHeight + s.bankGapY + s.chipH / 2;
    this.currentChip = { word, x: homeX, y: homeY, homeX, homeY };
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

    if (this.currentChip) {
      const bankLayer = svgEl('g', { class: 'wm-bank' });
      this.svg.appendChild(bankLayer);
      bankLayer.appendChild(this._buildChip(this.currentChip));
    }
  }

  _buildSlot(node, x, y) {
    const s = this.sizing;
    const g = svgEl('g', { class: 'wm-slot', transform: `translate(${x},${y})` });
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

  _buildChip(chip) {
    const s = this.sizing;
    const g = svgEl('g', { class: 'wm-chip' + (this.drag ? ' dragging' : ''), transform: `translate(${chip.x},${chip.y})` });
    g.appendChild(svgEl('rect', {
      x: -s.chipW / 2, y: -s.chipH / 2, width: s.chipW, height: s.chipH, rx: 999,
      fill: '#fff', stroke: '#e2ddd3', 'stroke-width': 1.5,
    }));
    const t = svgEl('text', { x: 0, y: 1 });
    t.textContent = chip.word;
    t.style.cssText = `font-size:${s.fontSize}px; font-weight:700; fill:#262220; text-anchor:middle; dominant-baseline:middle; pointer-events:none; user-select:none;`;
    g.appendChild(t);
    g.addEventListener('pointerdown', (ev) => this._onChipPointerDown(ev));
    return g;
  }

  toSvgPoint(clientX, clientY) {
    const pt = this.svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    return pt.matrixTransform(this.svg.getScreenCTM().inverse());
  }

  _onChipPointerDown(ev) {
    ev.preventDefault();
    ev.stopPropagation();
    if (!this.currentChip) return;
    const p = this.toSvgPoint(ev.clientX, ev.clientY);
    this.drag = { offsetX: p.x - this.currentChip.x, offsetY: p.y - this.currentChip.y };
    this.render();
  }

  _bindPointerEvents() {
    window.addEventListener('pointermove', (ev) => {
      if (!this.drag || !this.currentChip) return;
      ev.preventDefault();
      const p = this.toSvgPoint(ev.clientX, ev.clientY);
      this.currentChip.x = p.x - this.drag.offsetX;
      this.currentChip.y = p.y - this.drag.offsetY;
      this.render();
    }, { passive: false });
    const endDrag = () => {
      if (!this.drag) return;
      this.drag = null;
      const chip = this.currentChip;
      if (!chip) return;
      const target = this._findNearestSlot(chip);
      if (target) this._attemptPlace(chip, target);
      else { chip.x = chip.homeX; chip.y = chip.homeY; this.render(); }
    };
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
  }

  _findNearestSlot(chip) {
    const s = this.sizing;
    let best = null, bestDist = Infinity;
    for (const node of this.slotNodes) {
      if (node._filled) continue;
      const sx = node._x + this.xOffset, sy = node._y + s.r + s.slotGapY;
      const d = Math.hypot(chip.x - sx, chip.y - sy);
      if (d < s.snapDist && d < bestDist) { bestDist = d; best = node; }
    }
    return best;
  }

  _attemptPlace(chip, node) {
    if (normalizeAnswer(chip.word) === normalizeAnswer(node.word)) {
      node._filled = true;
      playClickSound();
      this._nextChip();
      this.render();
      if (this.onPlace) this.onPlace();
      if (this.slotNodes.every(n => n._filled) && this.onComplete) this.onComplete();
    } else {
      chip.x = chip.homeX; chip.y = chip.homeY;
      this.render();
    }
  }
}
