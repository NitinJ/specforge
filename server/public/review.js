/* SpecForge review layer client. Vanilla, dependency-free.
 * Block-level comments: hover any block to highlight it, click to comment.
 * Reply / resolve. Batch submit feeds the review loop.
 *
 * Anchoring is block-level and lives entirely on the client: a comment binds to
 * a block by its document-order index + its normalized text, plus the id-path of
 * its enclosing sections. The server is dumb storage — it never parses the spec.
 * Re-finding a block: try the stored index, else match by text; if the block was
 * edited away or removed, fall back to its section (then the parent section) so
 * the thread stays anchored instead of going stray. */
(function () {
  'use strict';
  var SPEC = (window.SPECFORGE || {}).specId;
  if (!SPEC) return;
  var SPEC_API = '/api/spec/' + encodeURIComponent(SPEC);
  var API = SPEC_API + '/comments';

  // Per-spec UI prefs (theme/width/filter), embedded at serve time by inject.mjs.
  // Source of truth is the store (origin/port-independent — survives a daemon port
  // change, unlike localStorage), so a change PUTs back and updates this in place.
  var PREFS = (window.SPECFORGE || {}).prefs || {};
  function putPref(patch) {
    for (var k in patch) PREFS[k] = patch[k];
    try {
      fetch(SPEC_API + '/prefs', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
      }).catch(function () {});
    } catch (e) {}
  }

  // Elements that can carry a comment. The innermost match under the pointer wins.
  var BLOCK_SEL = 'h1,h2,h3,h4,h5,h6,p,li,tr,td,th,pre,blockquote,figure,.panel,.callout,.card,.stat,.loop .step,.matrix .q,.bar,.ns';
  var INTERACTIVE = 'a,button,input,textarea,select,summary,label';

  var INIT_FILTER = (PREFS.filter === 'resolved' || PREFS.filter === 'all') ? PREFS.filter : 'open';
  var state = { threads: [], filter: INIT_FILTER, active: null, meta: null };
  var els = {};

  // Submit shortcut label: ⌘↵ on Mac, Ctrl+↵ elsewhere (the handler accepts both).
  var IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  var MOD_HINT = IS_MAC ? '⌘↵' : 'Ctrl+↵';

  var booted = false;
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
  function boot() {
    if (booted) return;
    booted = true;
    applyTheme(); // review-layer owns theme — apply the persisted choice on load
    buildChrome();
    load();
    // Poll so Claude's replies appear without a manual refresh; pause while the
    // composer is open so we don't disrupt the user mid-comment.
    setInterval(function () { if (!els.compose) load(); }, 6000);
  }

  // ---------- theme (review-layer owned) ----------
  // The review layer drives theme via the [data-theme] attribute on <html>, which
  // every house spec wires to a full light/dark variable set. To keep the menu's
  // Theme value honest we read what's ACTUALLY rendered (body background luminance)
  // rather than trusting the attribute or the OS media query — an imported spec may
  // ignore data-theme entirely. Such single-theme specs are detected once and their
  // Theme row is shown as fixed (the toggle can't re-theme hardcoded colors).
  // body background as [r,g,b], or null when nothing is actually painted (e.g. jsdom
  // has no CSS engine, or a transparent body) — then we can't detect from pixels.
  function bodyBg() {
    var bg = ((window.getComputedStyle(document.body) || {}).backgroundColor || '').trim();
    if (!bg || bg === 'transparent') return null;
    var m = bg.match(/[\d.]+/g);
    if (!m) return null;
    if (m.length >= 4 && parseFloat(m[3]) === 0) return null; // fully transparent
    return [parseFloat(m[0]) || 0, parseFloat(m[1]) || 0, parseFloat(m[2]) || 0];
  }
  function renderedTheme() {
    var rgb = bodyBg();
    if (!rgb) return null;
    var lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
    return lum < 128 ? 'dark' : 'light';
  }
  // Does this spec actually respond to [data-theme]? Probe once: flip the attribute,
  // see if the painted background changes, then restore. Cached — the spec's CSS is
  // static. When pixels aren't readable (null) we assume it's switchable.
  var _themeSupported = null;
  function specSupportsTheme() {
    if (_themeSupported != null) return _themeSupported; // != → treat null/undefined as uncached
    var rgb = bodyBg();
    if (!rgb) { _themeSupported = true; return true; }
    var root = document.documentElement;
    var had = root.hasAttribute('data-theme');
    var prev = root.getAttribute('data-theme');
    root.setAttribute('data-theme', renderedTheme() === 'dark' ? 'light' : 'dark');
    var changed = String(bodyBg()) !== String(rgb);
    if (had) root.setAttribute('data-theme', prev); else root.removeAttribute('data-theme');
    _themeSupported = changed;
    return changed;
  }
  function applyTheme(next) {
    if (!specSupportsTheme()) return; // single-theme spec — nothing to switch
    var root = document.documentElement;
    if (next == null) next = PREFS.theme;
    if (next !== 'light' && next !== 'dark') return; // honor the spec/OS default
    root.setAttribute('data-theme', next);
  }
  function currentTheme() {
    var a = document.documentElement.getAttribute('data-theme');
    if (a === 'light' || a === 'dark') return a;
    // No explicit choice yet → reflect what's actually rendered, else the OS hint.
    return renderedTheme() ||
      ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
  }
  function toggleTheme() {
    var next = currentTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    putPref({ theme: next });
    return next;
  }

  // ---------- container width (review-layer owned) ----------
  function widthContainer() {
    return document.querySelector('.deck, .layout, main, article, .container, .wrap') || document.body;
  }
  function applyWidth(px) {
    document.documentElement.style.setProperty('--maxw', px + 'px');
    var c = widthContainer();
    try { c.style.maxWidth = px + 'px'; c.style.marginLeft = 'auto'; c.style.marginRight = 'auto'; } catch (e) {}
  }
  function startWidth() {
    var saved = parseInt(PREFS.width, 10);
    if (saved) return saved;
    var w = widthContainer().getBoundingClientRect().width || 1040;
    return Math.min(1760, Math.max(820, Math.round(w / 20) * 20));
  }

  // ---------- data ----------
  var lastRaw = null;
  var lastMeta = null;
  function load() {
    Promise.all([
      fetch(API).then(function (r) { return r.text(); }),
      fetch(SPEC_API + '/meta').then(function (r) { return r.json(); }).catch(function () { return null; }),
    ]).then(function (vals) {
      var raw = vals[0];
      var meta = vals[1];
      var changed = false;
      if (raw !== lastRaw) { lastRaw = raw; state.threads = (JSON.parse(raw) || {}).threads || []; changed = true; }
      var metaStr = meta && JSON.stringify(meta);
      if (metaStr && metaStr !== lastMeta) { lastMeta = metaStr; state.meta = meta; changed = true; }
      if (changed) render();
    }).catch(function () {});
  }
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    });
  }

  // ---------- chrome ----------
  function buildChrome() {
    els.sidebar = create('div', { id: 'sf-sidebar' });
    els.sidebar.innerHTML =
      '<div class="sf-side-head"><b><span>Spec</span>Forge</b>' +
      '<span class="sf-count"></span>' +
      '<button class="sf-side-close" title="Close comments" aria-label="Close comments">×</button>' +
      '</div>' +
      '<div class="sf-threads"></div>' +
      '<div class="sf-side-foot">' +
      '<div class="sf-foot-filter"><span class="sf-filter">' +
      '<button data-f="open" class="on">Open</button>' +
      '<button data-f="resolved">Resolved</button>' +
      '<button data-f="all">All</button></span>' +
      '<button class="sf-resolve-all" title="Resolve every open thread">Resolve all</button></div>' +
      '<div class="sf-foot-action"><span class="sf-foot-caption"></span></div>' +
      '</div>';
    document.body.appendChild(els.sidebar);
    els.threads = els.sidebar.querySelector('.sf-threads');
    els.count = els.sidebar.querySelector('.sf-count');
    els.resolveAll = els.sidebar.querySelector('.sf-resolve-all');
    els.footCaption = els.sidebar.querySelector('.sf-foot-caption');
    els.sidebar.querySelector('.sf-side-close').onclick = function () { setSidebar(false); };
    els.resolveAll.onclick = function () {
      if (!unresolvedCount()) return;
      postJSON(API + '/resolve-all').then(load).catch(function () { flash('Could not resolve threads.'); });
    };
    Array.prototype.forEach.call(els.sidebar.querySelectorAll('.sf-filter button'), function (b) {
      // Reflect the persisted filter (the markup defaults "Open" to on).
      b.classList.toggle('on', b.getAttribute('data-f') === state.filter);
      b.onclick = function () {
        state.filter = b.getAttribute('data-f');
        Array.prototype.forEach.call(els.sidebar.querySelectorAll('.sf-filter button'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        putPref({ filter: state.filter });
        renderSidebar();
      };
    });

    // Lifecycle action — the single primary CTA, hosted in the sidebar command bar
    // (the comments bar). There's no floating pill; the launcher's pending badge is
    // the at-a-glance signal, and the CTA lives where the review controls already are.
    els.footAction = create('button', { class: 'sf-act', type: 'button' });
    els.footAction.onclick = onAction;
    els.sidebar.querySelector('.sf-foot-action').appendChild(els.footAction);

    buildLauncher();

    document.addEventListener('mousemove', onHover);
    document.addEventListener('click', onClick, true); // capture so we can claim a block click
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { clearHover(); hideCompose(); closeMenu(); } });
  }

  // Sidebar open/close — also flags the body so the floating launcher can
  // get out of the sidebar's way (CSS: body.sf-side-open).
  function setSidebar(open) {
    els.sidebar.classList.toggle('open', open);
    document.body.classList.toggle('sf-side-open', open);
  }
  function toggleSidebar() { setSidebar(!els.sidebar.classList.contains('open')); }

  // ---------- lifecycle action button ----------
  // One contextual primary CTA, rendered in the sidebar command bar (the comments
  // bar). Once implementation has started the button is just a status display;
  // before that it follows comments → review → approval:
  //   unsubmitted comment(s)          → "Submit comments"   (freeze a batch for the agent)
  //   submitted, agent not yet replied→ "Awaiting response" (disabled; agent is working)
  //   agent replied to every thread   → "Review replies"    (read them, then resolve)
  //   all resolved, not yet approved  → "LGTM ✓"            (status → approved)
  //   all resolved AND approved       → "Implement →"       (status → implementing)
  //   implementing / done / closed    → status display (no action)
  // Open comments take priority over `approved`, so new feedback on an approved
  // doc reverts the CTA away from "Implement →".
  function actionState() {
    var status = (state.meta && state.meta.status) || 'draft';
    if (status === 'implementing') return { label: 'Implementing…', state: 'working', act: null };
    if (status === 'done') return { label: 'Done ✓', state: 'done', act: null };
    if (status === 'closed') return { label: 'Closed', state: 'closed', act: null };
    if (pendingCount() > 0) return { label: 'Submit comments', state: 'needs', act: 'submit' };
    var unresolved = unresolvedCount();
    if (unresolved > 0) {
      // All submitted. While any open thread still lacks a reply we're waiting on
      // the agent; once every open thread is answered it's the human's turn to
      // read the replies and resolve them.
      return repliedCount() < unresolved
        ? { label: 'Awaiting response', state: 'awaiting', act: null }
        : { label: 'Review replies', state: 'replied', act: 'review' };
    }
    if (status === 'approved') return { label: 'Implement →', state: 'impl', act: 'implement' };
    if (status === 'draft' || status === 'in_review') return { label: 'LGTM ✓', state: 'lgtm', act: 'approve' };
    return { label: status, state: 'other', act: null }; // unknown status → inert display, never a silent approve
  }
  function renderAction() {
    var s = actionState();
    applyAction(els.footAction, s);
    if (els.footCaption) {
      var p = pendingCount();
      els.footCaption.textContent = (s.state === 'needs' && p > 0)
        ? p + (p === 1 ? ' thread to submit' : ' threads to submit') : '';
    }
    if (els.resolveAll) els.resolveAll.classList.toggle('show', !!unresolvedCount());
  }
  function applyAction(btn, s) {
    if (!btn) return;
    btn.textContent = s.label;
    btn.setAttribute('data-state', s.state);
    btn.disabled = !s.act;
  }
  function onAction() {
    var s = actionState();
    if (!s.act) return;
    if (s.act === 'submit') return submitBatch();
    if (s.act === 'review') return setSidebar(true); // open the sidebar to read the agent's replies
    var status = s.act === 'approve' ? 'approved' : 'implementing';
    postJSON(SPEC_API + '/status', { status: status }).then(function (r) {
      if (r.ok) load(); else flash('Could not update status.');
    }).catch(function () { flash('Could not update status.'); });
  }
  function unresolvedCount() {
    return state.threads.filter(function (t) { return t.state !== 'resolved'; }).length;
  }
  function repliedCount() {
    return state.threads.filter(function (t) { return t.state === 'replied'; }).length;
  }

  // ---------- launcher + menu ----------
  // One floating SpecForge button consolidates every review control. The menu is
  // (re)built on each open so applicable rows reflect current state — notably the
  // injected #sf-toc drawer, which a later script builds after this chrome.
  function buildLauncher() {
    els.launcher = create('button', { id: 'sf-launcher', 'aria-expanded': 'false', 'aria-label': 'SpecForge', title: 'SpecForge' });
    els.launcher.innerHTML = '<b><span>S</span>F</b><span class="sf-l-n"></span>';
    els.launcher.onclick = function (e) { e.stopPropagation(); toggleMenu(); };
    document.body.appendChild(els.launcher);

    els.menu = create('div', { id: 'sf-menu', role: 'menu' });
    document.body.appendChild(els.menu);
    els.live = document.getElementById('sf-live'); // capture once — survives menu innerHTML resets

    document.addEventListener('click', function (e) { // click-outside closes
      if (els.menu.classList.contains('open') && !inMenu(e.target)) closeMenu();
    });
  }
  function inMenu(t) {
    while (t) { if (t === els.menu || t === els.launcher) return true; t = t.parentElement; }
    return false;
  }
  function toggleMenu() { els.menu.classList.contains('open') ? closeMenu() : openMenu(); }
  function openMenu() {
    buildMenuRows();
    els.menu.classList.add('open');
    els.launcher.setAttribute('aria-expanded', 'true');
  }
  function closeMenu() {
    if (!els.menu) return;
    els.menu.classList.remove('open');
    els.launcher.setAttribute('aria-expanded', 'false');
  }

  function buildMenuRows() {
    els.menu.innerHTML = '';
    var pending = pendingCount();

    // Comments — toggles the sidebar; carries the pending badge.
    var comments = menuRow('💬', 'Comments', function () { toggleSidebar(); closeMenu(); });
    if (pending) {
      var badge = create('span', { class: 'sf-menu-badge' }, String(pending));
      comments.querySelector('.sf-row-main').appendChild(badge);
    }
    els.menu.appendChild(comments);

    // Contents — only when the review layer injected its own TOC drawer.
    var toc = document.getElementById('sf-toc');
    if (toc) {
      els.menu.appendChild(menuRow('📑', 'Contents', function () { toc.classList.toggle('open'); closeMenu(); }));
    }

    // Width — inline range, persisted.
    els.menu.appendChild(widthRow());

    // Theme — light/dark toggle.
    els.menu.appendChild(themeRow());

    // Export — open the print dialog (pick "Save as PDF"); the review chrome is
    // hidden by the print stylesheet so the PDF is just the spec.
    els.menu.appendChild(menuRow('⤓', 'Export PDF', function () { closeMenu(); window.print(); }));

    // Session — which session owns this spec, with a Detach button.
    els.menu.appendChild(sessionRow());

    // Footer — relocate the live-status pill into the menu. Held at els.live so it
    // survives the innerHTML reset above (we re-append the same node each rebuild).
    if (els.live) {
      var foot = create('div', { class: 'sf-menu-foot' });
      foot.appendChild(els.live);
      els.menu.appendChild(foot);
    }
  }

  function menuRow(icon, label, onclick) {
    var row = create('button', { class: 'sf-menu-row', type: 'button', role: 'menuitem' });
    row.innerHTML = '<span class="sf-row-main"><span class="sf-row-ic">' + esc(icon) + '</span><span>' + esc(label) + '</span></span>';
    if (onclick) row.onclick = onclick;
    return row;
  }
  function widthRow() {
    var row = create('div', { class: 'sf-menu-row sf-menu-ctl' });
    row.innerHTML = '<span class="sf-row-main"><span class="sf-row-ic">↔</span><span>Width</span></span>';
    var range = create('input', { type: 'range', min: '820', max: '1760', step: '20' });
    var px = startWidth();
    range.value = px;
    applyWidth(px);
    // Apply live while dragging; persist once (on release) to avoid a PUT per pixel.
    range.oninput = function () { applyWidth(range.value); };
    range.onchange = function () { putPref({ width: parseInt(range.value, 10) }); };
    row.appendChild(range);
    return row;
  }
  function themeRow() {
    var supported = specSupportsTheme();
    var shown = supported ? currentTheme() : (renderedTheme() || currentTheme());
    var row = menuRow('◐', 'Theme', null);
    var val = create('span', { class: 'sf-row-val' }, supported ? shown : shown + ' · fixed');
    row.querySelector('.sf-row-main').appendChild(val);
    if (supported) {
      row.onclick = function () { val.textContent = toggleTheme(); };
    } else {
      row.disabled = true;
      row.setAttribute('title', 'This spec defines a single theme');
    }
    return row;
  }
  // Session row — shows which session owns this spec + a Detach button.
  function sessionRow() {
    var attached = state.meta && state.meta.attachedSession;
    var row = create('div', { class: 'sf-menu-row sf-menu-ctl' });
    var label = attached ? 'Session ' + esc(String(attached).slice(0, 8)) : 'Not attached';
    row.innerHTML = '<span class="sf-row-main"><span class="sf-row-ic">🔗</span><span>' + label + '</span></span>';
    if (attached) {
      var btn = create('button', { class: 'sf-detach', type: 'button' }, 'Detach');
      btn.onclick = function (e) { e.stopPropagation(); detachSpec(); };
      row.appendChild(btn);
    }
    return row;
  }
  function detachSpec() {
    postJSON(SPEC_API + '/detach').then(function () { closeMenu(); load(); })
      .catch(function () { flash('Could not detach.'); });
  }

  // ---------- block targeting ----------
  function commentableBlocks() {
    return Array.prototype.filter.call(document.querySelectorAll(BLOCK_SEL), function (el) { return !inUI(el); });
  }
  function blockAt(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    el = el && el.closest ? el.closest(BLOCK_SEL) : null;
    return el && !inUI(el) ? el : null;
  }
  // Section ancestry (innermost → outermost) so a thread can fall back to its
  // section — then the parent section — if the exact block is edited away/removed.
  function sectionPathOf(el) {
    var path = [], n = el;
    while (n && n !== document.body) {
      if (n.tagName === 'SECTION' && n.id && !inUI(n)) path.push(n.id);
      n = n.parentElement;
    }
    return path;
  }
  function blockAnchor(el) {
    return {
      index: commentableBlocks().indexOf(el),
      tag: el.tagName,
      text: norm(el.textContent).slice(0, 400),
      sectionPath: sectionPathOf(el),
    };
  }
  function findBlock(anchor) {
    var b = anchor && anchor.block;
    if (!b) return null;
    var blocks = commentableBlocks();
    var byIndex = blocks[b.index];
    if (byIndex && norm(byIndex.textContent).slice(0, 400) === b.text) return byIndex;
    for (var i = 0; i < blocks.length; i++) {
      if (norm(blocks[i].textContent).slice(0, 400) === b.text) return blocks[i];
    }
    // Block edited away or removed → anchor to the nearest surviving section in the
    // original ancestry: its own section, else the parent section, and so on.
    var path = b.sectionPath || [];
    for (var k = 0; k < path.length; k++) {
      var sec = document.getElementById(path[k]);
      if (sec && sec.tagName === 'SECTION') return sec;
    }
    return null;
  }

  // ---------- hover + click ----------
  var hoverEl = null;
  function onHover(e) {
    if (els.compose || inUI(e.target)) { clearHover(); return; }
    var el = blockAt(e.target);
    if (el === hoverEl) return;
    clearHover();
    if (el) { el.classList.add('sf-hover'); hoverEl = el; }
  }
  function clearHover() { if (hoverEl) { hoverEl.classList.remove('sf-hover'); hoverEl = null; } }

  function onClick(e) {
    if (inUI(e.target) || (e.target.closest && e.target.closest(INTERACTIVE))) return;
    var sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) return; // a real text selection — leave it alone
    var el = blockAt(e.target);
    if (!el) return;
    var tid = el.getAttribute('data-sf-thread');
    if (tid) { activate(tid, false); setSidebar(true); return; }
    e.preventDefault();
    openCompose(el);
  }

  // ---------- render ----------
  function render() { renderSidebar(); renderHighlights(); renderLauncher(); renderAction(); }

  function visible() {
    return state.threads.filter(function (t) {
      if (state.filter === 'all') return true;
      if (state.filter === 'resolved') return t.state === 'resolved';
      return t.state !== 'resolved';
    });
  }

  function renderSidebar() {
    var list = visible();
    els.count.textContent = list.length + (list.length === 1 ? ' thread' : ' threads');
    els.threads.innerHTML = '';
    if (!list.length) {
      els.threads.innerHTML = '<p style="color:var(--sf-muted);padding:12px">No comments yet. Hover any block in the spec and click it to comment.</p>';
      return;
    }
    list.forEach(function (t) {
      var block = (t.anchor && t.anchor.block) || {};
      var card = create('div', { class: 'sf-thread state-' + t.state });
      if (state.active === t.id) card.classList.add('sf-active');
      card.innerHTML =
        '<div class="sf-meta"><span class="sf-badge ' + t.state + '">' + esc(t.state) + '</span>' +
        '<span class="sf-loc">' + esc((block.tag || 'block').toLowerCase()) + '</span></div>' +
        '<div class="sf-quote">' + esc((block.text || '').slice(0, 140)) + '</div>' +
        t.comments.map(function (c) {
          return '<div class="sf-comment"><span class="who ' + (c.author === 'claude' ? 'claude' : '') + '">' +
            esc(c.author) + '</span><div class="body">' + esc(c.body) + '</div></div>';
        }).join('');
      var acts = create('div', { class: 'sf-acts' });
      var replyBtn = create('button', {}, 'Reply');
      replyBtn.onclick = function (e) { e.stopPropagation(); openReply(card, t); };
      acts.appendChild(replyBtn);
      if (t.state !== 'resolved') {
        var resolveBtn = create('button', {}, 'Resolve');
        resolveBtn.onclick = function (e) { e.stopPropagation(); postJSON(API + '/' + t.id + '/resolve').then(load); };
        acts.appendChild(resolveBtn);
      }
      card.appendChild(acts);
      card.onclick = function () { activate(t.id, true); };
      els.threads.appendChild(card);
    });
  }

  function openReply(card, t) {
    if (card.querySelector('.sf-reply')) return;
    var box = create('div', { class: 'sf-reply' });
    box.onclick = function (e) { e.stopPropagation(); }; // typing shouldn't re-activate the card
    var ta = create('textarea', { class: 'sf-input', placeholder: 'Reply…', rows: '2' });
    var row = create('div', { class: 'sf-compose-foot' });
    var send = create('button', { class: 'sf-primary' }, 'Send');
    function submit() {
      if (!ta.value.trim()) return;
      postJSON(API + '/' + t.id + '/reply', { body: ta.value.trim(), author: 'human' }).then(load);
    }
    send.onclick = submit;
    row.appendChild(create('span', { class: 'sf-hint' }, MOD_HINT + ' to send'));
    row.appendChild(send);
    box.appendChild(ta); box.appendChild(row);
    card.appendChild(box);
    wireInput(ta, submit);
    ta.focus();
  }

  function renderHighlights() {
    Array.prototype.forEach.call(document.querySelectorAll('.sf-block-mark'), function (el) {
      el.classList.remove('sf-block-mark', 'sf-active');
      el.removeAttribute('data-sf-thread');
    });
    visible().forEach(function (t) {
      if (t.state === 'resolved') return;
      var el = findBlock(t.anchor);
      if (!el) return;
      el.classList.add('sf-block-mark');
      el.setAttribute('data-sf-thread', t.id);
      if (state.active === t.id) el.classList.add('sf-active');
    });
  }

  function pendingCount() {
    return state.threads.filter(function (t) {
      return t.state !== 'resolved' && t.comments.every(function (c) { return !c.batchId; });
    }).length;
  }
  function renderLauncher() {
    var pending = pendingCount();
    els.launcher.classList.toggle('has-pending', !!pending);
    els.launcher.querySelector('.sf-l-n').textContent = pending || '';
    // Keep an open menu's pending badge in sync with fresh data.
    if (els.menu.classList.contains('open')) buildMenuRows();
  }

  // ---------- compose ----------
  // Grow the textarea with its content (capped), so there's no drag-grip and the
  // box never starts oversized.
  function autoGrow(ta) {
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 240) + 'px';
  }
  // Shared input behavior: auto-grow + ⌘/Ctrl+Enter to submit. (Esc closes the
  // composer via the global keydown handler.)
  function wireInput(ta, submit) {
    ta.addEventListener('input', function () { autoGrow(ta); });
    ta.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    });
  }

  function openCompose(block) {
    hideCompose();
    var anchor = { block: blockAnchor(block) };
    var rect = block.getBoundingClientRect();
    var box = create('div', { id: 'sf-compose' });
    box.style.top = Math.max(8, Math.min(rect.top, window.innerHeight - 220)) + 'px';
    box.innerHTML = '<div class="q">' + esc(anchor.block.text.slice(0, 160)) + '</div>';
    var ta = create('textarea', { class: 'sf-input', placeholder: 'Add a comment…', rows: '2' });
    var row = create('div', { class: 'sf-compose-foot' });
    var save = create('button', { class: 'sf-primary' }, 'Comment');
    var cancel = create('button', { class: 'sf-ghost' }, 'Cancel');
    function submit() {
      if (!ta.value.trim()) return;
      postJSON(API, { anchor: anchor, body: ta.value.trim(), author: 'human' })
        .then(function () { hideCompose(); setSidebar(true); load(); });
    }
    save.onclick = submit;
    cancel.onclick = hideCompose;
    row.appendChild(create('span', { class: 'sf-hint' }, MOD_HINT + ' to comment'));
    row.appendChild(cancel); row.appendChild(save);
    box.appendChild(ta); box.appendChild(row);
    document.body.appendChild(box);
    els.compose = box;
    clearHover();
    block.classList.add('sf-block-mark', 'sf-active');
    wireInput(ta, submit);
    ta.focus();
  }
  function hideCompose() {
    if (els.compose) { els.compose.remove(); els.compose = null; }
    renderHighlights();
  }

  function submitBatch() {
    postJSON(API + '/submit', {}).then(function (r) {
      if (r.ok) load();
      else flash('Batch submit activates in the review-loop stage.');
    }).catch(function () { flash('Could not submit batch.'); });
  }

  // ---------- activate ----------
  function activate(id, scroll) {
    state.active = id;
    renderSidebar();
    renderHighlights();
    var el = document.querySelector('[data-sf-thread="' + id + '"]');
    if (scroll && el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- utils ----------
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function inUI(t) {
    while (t) {
      if (t.id === 'sf-sidebar' || t.id === 'sf-compose' || t.id === 'sf-launcher' ||
          t.id === 'sf-menu' || t.id === 'sf-live' || t.id === 'sf-toc') return true;
      t = t.parentElement;
    }
    return false;
  }
  function create(tag, attrs, text) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    if (text != null) el.textContent = text;
    return el;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
  }
  function flash(msg) {
    var n = create('div', {}, msg);
    n.style.cssText = 'position:fixed;bottom:60px;right:16px;z-index:60;background:var(--sf-panel);border:1px solid var(--sf-line);color:var(--sf-ink);border-radius:8px;padding:10px 14px;font:13px system-ui';
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 3000);
  }
})();

/* Serve-time enhancement, added to EVERY served spec: an auto-built floating TOC
 * drawer (#sf-toc), injected only when the spec has no TOC of its own. The
 * SpecForge launcher's "Contents" row toggles it. The on-disk file is untouched —
 * this lives purely in the served page. */
(function () {
  'use strict';
  var done = false;
  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
  function init() { if (done) return; done = true; ensureToc(); }

  // ---------- auto floating TOC ----------
  function ensureToc() {
    if (document.querySelector('nav.toc, .side-toc')) return; // spec has its own TOC
    var items = collect();
    if (items.length < 3) return; // too few sections to bother
    var panel = document.createElement('nav');
    panel.id = 'sf-toc'; panel.setAttribute('aria-label', 'Contents');
    var html = '<div class="sf-toc-head"><b><span>On this</span> page</b></div><div class="sf-toc-list">';
    items.forEach(function (it) { html += '<a href="#' + it.id + '">' + esc(it.text) + '</a>'; });
    panel.innerHTML = html + '</div>';
    document.body.appendChild(panel);
    Array.prototype.forEach.call(panel.querySelectorAll('a'), function (a) {
      a.addEventListener('click', function () { if (window.innerWidth < 1100) panel.classList.remove('open'); });
    });
    spy(items, panel);
  }
  function collect() {
    var out = [], seen = {};
    var secs = document.querySelectorAll('section[id]');
    if (secs.length >= 3) {
      Array.prototype.forEach.call(secs, function (s) {
        var h = s.querySelector('h1,h2,h3'); if (h) out.push({ id: s.id, text: txt(h) });
      });
      return out;
    }
    Array.prototype.forEach.call(document.querySelectorAll('h2,h3'), function (h) {
      var id = h.id;
      if (!id) { id = slug(txt(h)) || 'sec'; if (seen[id]) id = id + '-' + out.length; h.id = id; }
      seen[id] = 1; out.push({ id: id, text: txt(h) });
    });
    return out;
  }
  function spy(items, panel) {
    if (!('IntersectionObserver' in window)) return;
    var links = {};
    Array.prototype.forEach.call(panel.querySelectorAll('a'), function (a) { links[a.getAttribute('href').slice(1)] = a; });
    var obs = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        Array.prototype.forEach.call(panel.querySelectorAll('a'), function (l) { l.classList.remove('active'); });
        var a = links[e.target.id]; if (a) a.classList.add('active');
      });
    }, { rootMargin: '-12% 0px -80% 0px', threshold: 0 });
    items.forEach(function (it) { var el = document.getElementById(it.id); if (el) obs.observe(el); });
  }
  function txt(h) { return String(h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80); }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
})();
