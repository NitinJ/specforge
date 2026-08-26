/**
 * Full-screen preview for the three things a spec draws with.
 *
 * A diagram is drawn at the document's reading width and several are unreadable
 * there. Hovering one offers a button; the button opens the artwork over a dark
 * backdrop, where it can be zoomed and panned.
 *
 * Three rules shape everything here, and each prevents a specific defect:
 *
 *   The trigger is a BUTTON, not a click on the diagram.
 *     A click on a block already means "comment on this", and review.js exempts
 *     `button` from that handler. Taking the click would make the most-drawn
 *     blocks the least commentable.
 *
 *   The trigger is a CHILD OF BODY, positioned over the block.
 *     A rendered mermaid block's comment anchors are recorded against its
 *     rendered text. Anything inserted into the block moves every comment on it,
 *     silently, and nobody would know why.
 *
 *   The overlay shows a CLONE.
 *     Moving the original would empty the block while the preview is open, and
 *     the block registry reconciles against the page on a timer that cannot be
 *     suspended safely.
 *
 * Its own module rather than more of review.js: that file owns comments, the
 * rail, the menu and the header, none of which this touches, and a zoom bug
 * must not be able to take commenting down with it.
 *
 * Spec 2cc9bae1bc, stage 2.
 */
(function (global) {
  'use strict';

  var doc = global.document;
  var View = global.SFZoomView;

  /** A rendered mermaid diagram. An errored one holds source text, not artwork. */
  var MERMAID = '[data-sf-mermaid="rendered"]';

  var btn = null;      // the one trigger, moved between blocks
  var target = null;   // the block it currently offers
  var onTrigger = false;   // the pointer is on the trigger itself
  var clearPending = false; // a hover-of-nothing held until the pointer leaves it
  var open = null;     // the overlay, or null

  // ---------- what can be previewed ----------

  /**
   * The zoomable `el` belongs to, or null.
   *
   * Outermost wins: a figure wrapping an image is one zoomable, not two, so a
   * hover over the image offers the figure and the preview shows the caption
   * with it.
   */
  function zoomableOf(el) {
    if (!el || !el.closest) return null;
    var mermaid = el.closest(MERMAID);
    if (mermaid) return mermaid;
    var fig = el.closest('figure');
    if (fig && fig.querySelector('svg, img')) return fig;
    if (el.tagName === 'IMG') return el;
    // The hovered block is often not the picture but the thing holding it: a
    // paragraph, a card, a table cell. Exactly one image in it is unambiguous.
    // Several, and the reader has not said which one they meant.
    var imgs = el.querySelectorAll ? el.querySelectorAll('img') : [];
    return imgs.length === 1 ? imgs[0] : null;
  }

  /** The artwork inside a zoomable: what actually gets cloned. */
  function artOf(zoomable) {
    if (!zoomable) return null;
    if (zoomable.tagName === 'IMG') return zoomable;
    return zoomable.querySelector('svg, img');
  }

  // ---------- the trigger ----------

  function ensureButton() {
    if (btn) return btn;
    btn = doc.createElement('button');
    btn.id = 'sf-zoom-btn';
    btn.type = 'button';
    btn.hidden = true;
    btn.setAttribute('aria-label', 'Open this full screen');
    btn.title = 'Open full screen';
    // An inline SVG rather than a character: a magnifier glyph is not in every
    // font, and a missing glyph renders as a box on the one control that has to
    // read as an affordance.
    btn.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">'
      + '<circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"></circle>'
      + '<path d="M10.5 10.5 L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"></path>'
      + '<path d="M5 7h4M7 5v4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"></path>'
      + '</svg>';
    btn.onclick = function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (target) openPreview(target);
    };
    // The pointer leaving the block for the trigger is review.js reporting that
    // it is over review chrome, which is a hover of nothing. Acted on
    // immediately the trigger deletes itself the instant the reader reaches for
    // it, and it can never be clicked with a real mouse. The clear is held until
    // the pointer leaves the trigger for something that is not the block.
    btn.addEventListener('mouseenter', function () { onTrigger = true; });
    btn.addEventListener('mouseleave', function () {
      onTrigger = false;
      if (clearPending) hideButton();
    });
    doc.body.appendChild(btn);
    return btn;
  }

  function hideButton() {
    clearPending = false;
    target = null;
    if (btn) btn.hidden = true;
  }

  /**
   * Offer the trigger over `el`, or hide it.
   *
   * Called from review.js's own hover tracking rather than a second mousemove
   * listener, so the two cannot disagree about which block the pointer is over.
   */
  function hover(el) {
    var z = zoomableOf(el);
    if (!z || !artOf(z)) {
      if (onTrigger && target) { clearPending = true; return; }
      return hideButton();
    }
    clearPending = false;
    target = z;
    place();
  }

  /**
   * Put the trigger over the target's top-right corner.
   *
   * Separate from `hover` because a fixed-position element placed from a
   * viewport rect is correct only until the page moves under it. Scrolling with
   * the wheel while hovering a diagram fires no mousemove, so without this the
   * button sits where the diagram used to be and the next click lands on
   * whatever is there now.
   */
  function place() {
    if (!target || !target.isConnected) return hideButton();
    var b = ensureButton();
    var r = target.getBoundingClientRect();
    var vh = (global.innerHeight || 768);
    // Scrolled out of sight: hide rather than pin it to an edge, where it would
    // offer to enlarge something the reader can no longer see.
    if (r.bottom < 0 || r.top > vh) { b.hidden = true; return; }
    b.hidden = false;
    // Fixed positioning, so these are viewport coordinates and need no scroll
    // offset. Inset into the corner rather than hung outside it: a diagram at
    // the reading width has no margin to hang in on a narrow window.
    b.style.top = (r.top + 8) + 'px';
    b.style.left = (r.right - 8 - 26) + 'px';
  }

  // ---------- the overlay ----------

  function viewport() {
    return { width: global.innerWidth || 1024, height: global.innerHeight || 768 };
  }

  /**
   * The artwork's natural size: what "scale 1" should mean.
   *
   * Three sources, because the three forms disagree about where their size
   * lives:
   *
   *   An image knows its own pixels (`naturalWidth`), and 1:1 with those is what
   *   a reader expects from a photo or a screenshot.
   *
   *   A mermaid SVG is written `width="100%"` and carries its authored size only
   *   in the viewBox. Reading the rect instead gives whatever the reading column
   *   happened to be, so a diagram would open at the size that made it
   *   unreadable in the first place.
   *
   *   Anything else falls back to its rect, then to the viewport, so a zero
   *   never reaches the maths.
   */
  function artSize(node) {
    if (node.tagName === 'IMG' && node.naturalWidth) {
      return { width: node.naturalWidth, height: node.naturalHeight };
    }
    var box = node.getAttribute && node.getAttribute('viewBox');
    if (box) {
      var parts = box.split(/[\s,]+/);
      var w = Number(parts[2]);
      var h = Number(parts[3]);
      if (w > 0 && h > 0) return { width: w, height: h };
    }
    var r = node.getBoundingClientRect();
    if (r.width && r.height) return { width: r.width, height: r.height };
    var aw = Number(node.getAttribute && node.getAttribute('width')) || 0;
    var ah = Number(node.getAttribute && node.getAttribute('height')) || 0;
    if (aw > 0 && ah > 0) return { width: aw, height: ah };
    var vp = viewport();
    return { width: vp.width, height: vp.height };
  }

  var cloneSeq = 0;

  /**
   * Carry the artwork's own stylesheet across to the clone.
   *
   * Mermaid does not put its styles in the SVG it renders. It writes them into a
   * `<style>` in the document head and scopes every rule by the SVG's id, so a
   * clone that has had its id removed keeps none of them: node fills fall back
   * to black, and an edge path that has lost `fill: none` renders as a solid
   * blob the width of the diagram. Keeping the id is not an option either, since
   * two elements cannot share one.
   *
   * So the clone gets an id of its own, and every sheet written for the original
   * is copied into the overlay with the selectors rewritten to match it. The
   * copies live inside the overlay and go when it does.
   */
  function adoptStyles(art, clone, wrap) {
    var id = art.id;
    if (!id) { clone.removeAttribute('id'); return; }
    var mine = 'sf-zoom-art-' + (cloneSeq++);
    clone.id = mine;
    // The trailing guard stops `#sf-mmd-1` from matching inside `#sf-mmd-10`,
    // which would copy another diagram's sheet and rewrite it into selectors
    // that match nothing.
    var re = new RegExp('#' + id.replace(/[^\w-]/g, '\\$&') + '(?![\\w-])', 'g');
    var sheets = doc.querySelectorAll('style');
    var seen = {};
    for (var i = 0; i < sheets.length; i++) {
      var text = sheets[i].textContent;
      // Mermaid emits the same sheet once per render pass, and a duplicate copy
      // is dead weight in every preview.
      if (!text || seen[text]) continue;
      re.lastIndex = 0;
      if (!re.test(text)) continue;
      seen[text] = 1;
      var copy = doc.createElement('style');
      copy.textContent = text.replace(re, '#' + mine);
      wrap.appendChild(copy);
    }
  }

  /**
   * Put the clone back inside the context its styling was written against.
   *
   * The review layer themes a diagram through descendant selectors rooted on
   * the block's own attribute (`[data-sf-mermaid="rendered"] g.node rect`, and
   * about forty more in review.css). A clone lifted out of its block matches
   * none of them and falls back to mermaid's untouched defaults, which is the
   * wrong palette in either theme and ignores the reader's own.
   *
   * A wrapper rather than the attribute on the holder: `[data-sf-mermaid]` also
   * carries `background: none !important`, which would take the card the
   * artwork is drawn on with it.
   */
  function shellFor(zoomable, clone) {
    var shell = doc.createElement('div');
    shell.className = 'sf-zoom-shell';
    var mmd = zoomable.getAttribute && zoomable.getAttribute('data-sf-mermaid');
    if (mmd) shell.setAttribute('data-sf-mermaid', mmd);
    shell.appendChild(clone);
    return shell;
  }

  function openPreview(zoomable) {
    var art = artOf(zoomable);
    if (!art) return false;
    if (open) closePreview();

    // The trigger goes away for as long as the preview is up, whether or not the
    // pointer is still resting on it: it was opened by a click on it, so it is.
    // `target` is left alone; closePreview puts it back and re-places the button.
    onTrigger = false;
    clearPending = false;
    if (btn) btn.hidden = true;

    var wrap = doc.createElement('div');
    wrap.id = 'sf-zoom';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-modal', 'true');
    wrap.setAttribute('aria-label', labelFor(zoomable));

    var backdrop = doc.createElement('div');
    backdrop.className = 'sf-zoom-backdrop';
    backdrop.onclick = closePreview;

    var stage = doc.createElement('div');
    stage.className = 'sf-zoom-stage';

    // cloneNode(true), never the node itself. See the header.
    var clone = art.cloneNode(true);
    adoptStyles(art, clone, wrap);
    var size = artSize(art);
    var holder = doc.createElement('div');
    holder.className = 'sf-zoom-art';
    // The holder is given the artwork's natural size in pixels, and the clone
    // fills it. A mermaid SVG is written `width="100%"`, so inside a holder with
    // no size of its own it collapses to a few hundred pixels: the picture
    // arrives smaller than it was in the document, which is the opposite of what
    // the reader asked for.
    holder.style.width = size.width + 'px';
    holder.style.height = size.height + 'px';
    clone.setAttribute('width', '100%');
    clone.setAttribute('height', '100%');
    holder.appendChild(shellFor(zoomable, clone));
    stage.appendChild(holder);

    var close = doc.createElement('button');
    close.type = 'button';
    close.className = 'sf-zoom-close';
    close.setAttribute('aria-label', 'Close');
    close.textContent = '×';
    close.onclick = closePreview;

    wrap.appendChild(backdrop);
    wrap.appendChild(stage);
    wrap.appendChild(controls());
    wrap.appendChild(close);
    doc.body.appendChild(wrap);

    open = {
      wrap: wrap, holder: holder, art: size,
      view: { scale: 1, x: 0, y: 0 },
      fit: 1,
      drag: null,
      level: pendingLevel,
      // The block this was opened on, kept so the trigger can be put back over
      // it on close. `target` is cleared the moment the pointer leaves, which is
      // immediately: the overlay covers the page.
      block: zoomable,
      // The trigger, whatever its current visibility: opening the preview hid it
      // a few lines above, and closing re-places it over `block` before focusing
      // it. Null only when no trigger has ever been built, which is the
      // programmatic open the tests use.
      opener: btn,
    };
    pendingLevel = null;
    reset();
    wireView(wrap, holder);

    // On the overlay rather than the document, and it stops propagation: the
    // document handler collapses threads and cancels composers, and a keypress
    // meant to close a picture must not cost somebody an unposted draft (I4).
    wrap.tabIndex = -1;
    wrap.addEventListener('keydown', onKey);
    doc.addEventListener('keydown', onKey, true);
    try { wrap.focus(); } catch (e) { /* jsdom, and it is not fatal */ }
    return true;
  }

  /** What a screen reader announces the preview as. */
  function labelFor(zoomable) {
    var art = artOf(zoomable);
    var alt = art && art.getAttribute && art.getAttribute('alt');
    if (alt) return alt;
    var cap = zoomable.querySelector && zoomable.querySelector('figcaption');
    if (cap && cap.textContent.trim()) return cap.textContent.trim();
    return zoomable.matches && zoomable.matches(MERMAID) ? 'Diagram, full screen' : 'Image, full screen';
  }

  /** How far an arrow key moves the picture, in CSS pixels. */
  var NUDGE = 64;

  /** Keys a browser scrolls a document with, beyond the arrows. */
  var SCROLLS = { PageUp: 1, PageDown: 1, Home: 1, End: 1, ' ': 1, Spacebar: 1 };

  function onKey(e) {
    if (!open) return;
    var k = e.key;

    if (k === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      return closePreview();
    }

    if (k === 'Tab') return trapTab(e);

    // Every branch below consumes the key. An arrow scrolls a page, and a reader
    // panning a diagram must not also be scrolling the document behind it.
    var centre = centreOfViewport();
    if (k === '+' || k === '=') { e.preventDefault(); return scaleBy(1.4, centre); }
    if (k === '-' || k === '_') { e.preventDefault(); return scaleBy(1 / 1.4, centre); }
    if (k === '0') { e.preventDefault(); return reset(); }

    var by = { ArrowLeft: [NUDGE, 0], ArrowRight: [-NUDGE, 0], ArrowUp: [0, NUDGE], ArrowDown: [0, -NUDGE] }[k];
    if (by) { e.preventDefault(); return pan(by[0], by[1]); }

    // The rest of the keys a browser scrolls a document with. They do nothing
    // here and they must not do that either.
    if (SCROLLS[k]) e.preventDefault();
  }

  /** Move the picture, clamped, as a drag does. */
  function pan(dx, dy) {
    if (!open || !View) return;
    open.view = View.clamp({
      scale: open.view.scale, x: open.view.x + dx, y: open.view.y + dy,
    }, open.art, viewport());
    apply();
  }

  /**
   * Keep Tab inside the preview.
   *
   * A modal that lets Tab reach the document behind it is a modal in appearance
   * only: a keyboard reader tabs out, cannot see where they are, and has no way
   * back except Escape.
   */
  function trapTab(e) {
    var stops = open.wrap.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
    if (!stops.length) return;
    var first = stops[0];
    var last = stops[stops.length - 1];
    var here = doc.activeElement;
    if (e.shiftKey && (here === first || here === open.wrap)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && here === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function closePreview() {
    if (!open) return;
    onDragEnd();
    doc.removeEventListener('keydown', onKey, true);
    var opener = open.opener;
    var block = open.block;
    if (open.wrap.parentNode) open.wrap.parentNode.removeChild(open.wrap);
    open = null;
    // Focus goes back where it came from, or a keyboard reader is dropped at the
    // top of the document every time they close a picture (I7).
    //
    // Re-placed first. Opening the preview puts the pointer over the overlay, so
    // review.js clears its hover and the trigger hides: focusing a hidden button
    // does nothing at all, and the reader lands back at the top of the document.
    // Caught in a browser; jsdom fires no such hover and reported this working.
    if (opener && opener.isConnected !== false) {
      target = block;
      place();
      try { opener.focus(); } catch (e) { /* not fatal */ }
    }
  }

  // ---------- the view ----------

  /** Write the current scale and offset onto the clone, as one transform. */
  function apply() {
    if (!open) return;
    var v = open.view;
    open.holder.style.transform = 'translate(' + v.x + 'px, ' + v.y + 'px) scale(' + v.scale + ')';
    if (open.level) open.level.textContent = Math.round(v.scale * 100) + '%';
  }

  /** Back to fit, centred. */
  function reset() {
    if (!open || !View) return;
    var vp = viewport();
    var scale = View.fit(open.art, vp);
    var c = View.centre(open.art, vp, scale);
    open.fit = scale;
    open.view = { scale: scale, x: c.x, y: c.y };
    apply();
  }

  /**
   * How far the scale may travel.
   *
   * The floor is half of FIT rather than a constant: fit is already the scale at
   * which the whole picture is visible, so a fixed 0.1 would let a reader shrink
   * a small diagram to a speck for no reason.
   */
  function bounds() {
    return { min: (open.fit || 1) / 2, max: 8 };
  }

  /** Scale by `factor` about a viewport point, then pull it back in range. */
  function scaleBy(factor, anchor) {
    if (!open || !View) return;
    var next = View.zoomAt(open.view, factor, anchor, bounds());
    open.view = View.clamp(next, open.art, viewport());
    apply();
  }

  function centreOfViewport() {
    var vp = viewport();
    return { x: vp.width / 2, y: vp.height / 2 };
  }

  /**
   * Wheel on the whole overlay; drag and double-click on the artwork.
   *
   * The wheel is bound to the overlay rather than the artwork because the
   * artwork covers a fraction of the screen: a wheel over the backdrop was
   * scrolling the document behind the preview, and closing it left the reader
   * somewhere they did not choose.
   */
  function wireView(wrap, holder) {
    wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      // exp() rather than a fixed step: a trackpad sends many small deltas and a
      // mouse sends few large ones, and this makes both feel like one gesture.
      scaleBy(Math.exp(-e.deltaY / 400), { x: e.clientX, y: e.clientY });
    }, { passive: false });

    holder.addEventListener('dblclick', function (e) {
      e.preventDefault();
      var atFit = Math.abs(open.view.scale - open.fit) < 0.001;
      var wanted = atFit ? 2 : open.fit;
      scaleBy(wanted / open.view.scale, { x: e.clientX, y: e.clientY });
    });

    holder.addEventListener('pointerdown', function (e) {
      if (e.button) return; // primary only: a right-click is a context menu
      open.drag = { x: e.clientX, y: e.clientY };
      holder.classList.add('sf-zoom-dragging');
      // Listeners on the document, not the holder: a pointer that leaves the
      // artwork mid-drag must keep dragging it rather than dropping it there.
      doc.addEventListener('pointermove', onDragMove);
      doc.addEventListener('pointerup', onDragEnd);
      doc.addEventListener('pointercancel', onDragEnd);
    });
  }

  function onDragMove(e) {
    if (!open || !open.drag || !View) return;
    var moved = { x: e.clientX - open.drag.x, y: e.clientY - open.drag.y };
    open.drag = { x: e.clientX, y: e.clientY };
    open.view = View.clamp({
      scale: open.view.scale, x: open.view.x + moved.x, y: open.view.y + moved.y,
    }, open.art, viewport());
    apply();
  }

  function onDragEnd() {
    doc.removeEventListener('pointermove', onDragMove);
    doc.removeEventListener('pointerup', onDragEnd);
    doc.removeEventListener('pointercancel', onDragEnd);
    if (!open) return;
    open.drag = null;
    open.holder.classList.remove('sf-zoom-dragging');
  }

  /** The control strip: out, reset, in, and what the scale currently is. */
  function controls() {
    var bar = doc.createElement('div');
    bar.className = 'sf-zoom-bar';

    var mk = function (cls, label, onClick) {
      var b = doc.createElement('button');
      b.type = 'button';
      b.className = 'sf-zoom-' + cls;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.onclick = function (e) { e.stopPropagation(); onClick(); };
      return b;
    };

    var out = mk('out', 'Zoom out', function () { scaleBy(1 / 1.4, centreOfViewport()); });
    out.textContent = '−';
    var reset = mk('reset', 'Fit to screen', function () { resetView(); });
    reset.textContent = 'Fit';
    var into = mk('in', 'Zoom in', function () { scaleBy(1.4, centreOfViewport()); });
    into.textContent = '+';

    var level = doc.createElement('span');
    level.className = 'sf-zoom-level';
    level.setAttribute('aria-live', 'polite');
    level.textContent = '100%';

    bar.appendChild(out);
    bar.appendChild(reset);
    bar.appendChild(into);
    bar.appendChild(level);
    // Held so `apply` can keep the readout honest without a query per frame.
    pendingLevel = level;
    return bar;
  }

  /** Set aside between building the strip and the state it belongs to. */
  var pendingLevel = null;

  /** `reset` under its own name, since the control strip shadows it locally. */
  function resetView() { reset(); }

  // ---------- exports ----------

  // The trigger tracks its block. Passive, because neither handler blocks the
  // gesture, and a listener that can delay a scroll is worse than no affordance.
  global.addEventListener('scroll', place, { passive: true });
  global.addEventListener('resize', function () { place(); if (open) reset(); }, { passive: true });

  global.SFZoom = {
    hover: hover,
    _place: place,
    open: function (el) {
      var z = zoomableOf(el);
      return z ? openPreview(z) : false;
    },
    close: closePreview,
    // Read by the tests and by stage 3, which drives the same numbers.
    _state: function () { return open; },
    _apply: apply,
    _reset: reset,
  };
}(typeof window !== 'undefined' ? window : globalThis));
