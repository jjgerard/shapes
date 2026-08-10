// A read-only, pannable/zoomable tree display -- the same canvas mechanics
// as Level 1's editor and Level 2's word-match (natural size, zoom-to-fit
// only when still readable, pan/pinch/ctrl-wheel otherwise, same 5%-500%
// range, same generous margin), just with nothing draggable in it at all.
// Used by Level 3 (constituency yes/no) and Level 4 (category ID) to show
// the reference tree while a question about the sentence is being asked.

const TV_SIZING = {
  desktop: { r: 26, margin: 1120 },
  mobile:  { r: 36, margin: 800 },
};

class TreeViewer {
  // `reveal` decides whether nodes are painted with their real labels
  // (NP, V', T⁰ ...) or with the bare mystery numbers they were built
  // from. Levels 3 and 4 always show the real thing; the Level 1 Mystery
  // Level flips it on only once the code has been cracked, so it's a
  // mutable property rather than a constructor-time constant.
  constructor(svg, { reveal = true } = {}) {
    this.svg = svg;
    this.reveal = reveal;
    this.zoom = 1;
    this.bgPointers = new Map();
    this.bgAnchor = null;
    this._bindBackgroundPointerEvents();
    this._bindWheelZoom();
  }

  minZoom() { return 0.05; }
  maxZoom() { return 5; }

  open(root, viewW, viewH) {
    this.root = root;
    this.sizing = window.innerWidth < 640 ? TV_SIZING.mobile : TV_SIZING.desktop;
    const s = this.sizing;

    const dims = layoutTree(root, s.r * 4, s.r * 4);
    this.treeWidth = dims.width;
    this.treeHeight = dims.height;
    this.viewW = Math.max(viewW || 0, dims.width + s.margin * 2);
    this.xOffset = Math.max(s.margin, (this.viewW - dims.width) / 2);
    this.viewH = Math.max(viewH || 0, this.treeHeight + s.margin * 2);
    this.yOffset = s.margin;
    this.zoom = 1;

    this.render();
    this._scrollToStart();
  }

  render() {
    const s = this.sizing;
    this.svg.setAttribute('viewBox', `0 0 ${this.viewW} ${this.viewH}`);
    this.svg.setAttribute('width', this.viewW * this.zoom);
    this.svg.setAttribute('height', this.viewH * this.zoom);
    while (this.svg.firstChild) this.svg.removeChild(this.svg.firstChild);

    const contentLayer = svgEl('g', { transform: `translate(0,${this.yOffset})` });
    this.svg.appendChild(contentLayer);
    paintStaticTree(contentLayer, this.root, { r: s.r, reveal: this.reveal, xOffset: this.xOffset, fontScale: 0.62 });
  }

  // The tree's bounding box in content coordinates, for the "Fit" button.
  contentBounds() {
    if (!this.root) return null;
    return {
      minX: this.xOffset,
      minY: this.yOffset,
      maxX: this.xOffset + this.treeWidth,
      maxY: this.yOffset + this.treeHeight,
    };
  }

  // Unlike TreeEditor/WordMatchEditor (where precise dragging onto small
  // targets makes an overly-shrunk view a problem), this canvas is pure
  // reference material -- there's nothing to click inside it -- so it
  // always zooms to fit the WHOLE tree in view and centers it, regardless
  // of how small that makes it. Pinch/wheel zoom is still there afterward
  // for anyone who wants a closer look at part of it.
  _scrollToStart() {
    const wrap = this.svg.parentElement;
    if (!wrap) return;
    requestAnimationFrame(() => {
      const pad = 30;
      const rawW = this.treeWidth + pad * 2, rawH = this.treeHeight + pad * 2;
      // The same usable height the Fit button works to (see controlsReserve
      // in canvas.js), so opening the canvas and pressing Fit land on the
      // same framing instead of Fit shrinking the tree the first time it is
      // pressed -- and so the bottom of the tree isn't behind the buttons.
      const availH = Math.max(60, wrap.clientHeight - controlsReserve(this));
      const fitZoom = Math.min(wrap.clientWidth / rawW, availH / rawH);
      this.zoom = Math.max(this.minZoom(), Math.min(this.maxZoom(), fitZoom));
      this.render();
      const contentW = rawW * this.zoom, contentH = rawH * this.zoom;
      wrap.scrollLeft = Math.max(0, (this.xOffset - pad) * this.zoom - (wrap.clientWidth - contentW) / 2);
      wrap.scrollTop = Math.max(0, (this.yOffset - pad) * this.zoom - (availH - contentH) / 2);
    });
  }

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
}
