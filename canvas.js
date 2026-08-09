// ---------------------------------------------------------------------------
// Shared zoom/fit helpers for the three pannable canvases (TreeEditor,
// WordMatchEditor, TreeViewer).
//
// Every one of those canvases is deliberately much bigger than its content
// -- there's an 800-1120px empty margin on all four sides to drag pieces
// into -- and all three support free pan plus 5%-500% pinch zoom. That's
// great for anyone comfortable with a maps-style canvas and a trap for
// anyone who isn't: one stray finger-drag on the background scrolls the
// pieces off screen, one over-enthusiastic pinch shrinks them to specks,
// and until now there was no way back other than closing the puzzle and
// starting over.
//
// So: every canvas gets a visible zoom in / zoom out / fit cluster, and
// "fit" is an unconditional escape hatch -- it always re-frames the actual
// content, whatever state the view got into.
// ---------------------------------------------------------------------------

function clampZoom(view, z) {
  return Math.max(view.minZoom(), Math.min(view.maxZoom(), z));
}

// Zoom about the middle of what's currently visible, so the thing the
// student is looking at stays put. (Pinch/wheel zoom anchor on the pointer
// instead; a button has no pointer position to anchor to.)
function zoomAboutCenter(view, factor) {
  const wrap = view.svg.parentElement;
  if (!wrap) return;
  const oldZoom = view.zoom;
  const newZoom = clampZoom(view, oldZoom * factor);
  if (newZoom === oldZoom) return;
  const cx = wrap.clientWidth / 2, cy = wrap.clientHeight / 2;
  const contentX = (wrap.scrollLeft + cx) / oldZoom;
  const contentY = (wrap.scrollTop + cy) / oldZoom;
  view.zoom = newZoom;
  view.render();
  wrap.scrollLeft = contentX * newZoom - cx;
  wrap.scrollTop = contentY * newZoom - cy;
}

// Frame `bounds` (content coordinates) as large as it will go in the wrap,
// centered. Unlike the various _scrollToStart() methods -- which only zoom
// to fit when the result would still be comfortably readable, and otherwise
// anchor to the top-left -- this always fits, because the student asked it
// to: getting everything back on screen beats keeping it legible.
function fitBoundsInView(view, bounds, pad = 40) {
  const wrap = view.svg.parentElement;
  if (!wrap || !bounds) return;
  const rawW = (bounds.maxX - bounds.minX) + pad * 2;
  const rawH = (bounds.maxY - bounds.minY) + pad * 2;
  if (rawW <= 0 || rawH <= 0 || !wrap.clientWidth || !wrap.clientHeight) return;
  view.zoom = clampZoom(view, Math.min(wrap.clientWidth / rawW, wrap.clientHeight / rawH));
  view.render();
  const contentW = rawW * view.zoom, contentH = rawH * view.zoom;
  wrap.scrollLeft = Math.max(0, (bounds.minX - pad) * view.zoom - (wrap.clientWidth - contentW) / 2);
  wrap.scrollTop = Math.max(0, (bounds.minY - pad) * view.zoom - (wrap.clientHeight - contentH) / 2);
}

// Re-frame everything. Each canvas class supplies contentBounds().
function fitToView(view) {
  if (!view || !view.contentBounds) return;
  fitBoundsInView(view, view.contentBounds());
}

// Build the on-canvas control cluster. `stage` is the .canvas-stage element
// wrapping the scrollable .canvas-wrap; `getView()` is called lazily on
// each press so the buttons can be wired up before the view object exists.
function attachCanvasControls(stage, getView) {
  if (!stage || stage.querySelector('.canvas-controls')) return;
  const bar = document.createElement('div');
  bar.className = 'canvas-controls';

  const mk = (label, title, onPress) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'canvas-btn';
    b.textContent = label;
    b.title = title;
    b.setAttribute('aria-label', title);
    // pointerdown is swallowed by the canvas pan handler on some browsers if
    // it bubbles; these buttons sit outside .canvas-wrap so a plain click is
    // safe, but stop propagation anyway to be certain a press here never
    // reads as a background drag.
    b.addEventListener('pointerdown', ev => ev.stopPropagation());
    b.addEventListener('click', () => { const v = getView(); if (v) onPress(v); });
    return b;
  };

  bar.appendChild(mk('−', 'Zoom out', v => zoomAboutCenter(v, 1 / 1.3)));
  bar.appendChild(mk('+', 'Zoom in', v => zoomAboutCenter(v, 1.3)));
  const fit = mk('Fit', 'Show everything again', v => fitToView(v));
  fit.classList.add('canvas-btn-wide');
  bar.appendChild(fit);

  stage.appendChild(bar);
}
