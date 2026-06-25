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

  // Reading-font catalog (review-layer owned) — the famous reader/blog fonts, 3 per
  // category. `cat` (sans/serif/mono) drives the code-block exemption in review.css;
  // `google` is the Fonts API family spec, loaded on demand only when picked (so a
  // spec fetches nothing until you choose a web font); `stack` always lists a system
  // fallback so it degrades gracefully offline. Default ('default') leaves the spec's
  // own font untouched — no override, no fetch.
  var FONTS = [
    { id: 'inter', name: 'Inter', cat: 'sans', google: 'Inter:wght@400;600', stack: '"Inter", system-ui, sans-serif' },
    { id: 'source-sans', name: 'Source Sans 3', cat: 'sans', google: 'Source+Sans+3:wght@400;600', stack: '"Source Sans 3", system-ui, sans-serif' },
    { id: 'work-sans', name: 'Work Sans', cat: 'sans', google: 'Work+Sans:wght@400;600', stack: '"Work Sans", system-ui, sans-serif' },
    { id: 'source-serif', name: 'Source Serif 4', cat: 'serif', google: 'Source+Serif+4:wght@400;600', stack: '"Source Serif 4", Georgia, serif' },
    { id: 'merriweather', name: 'Merriweather', cat: 'serif', google: 'Merriweather:wght@400;700', stack: '"Merriweather", Georgia, serif' },
    { id: 'lora', name: 'Lora', cat: 'serif', google: 'Lora:wght@400;600', stack: '"Lora", Georgia, serif' },
    { id: 'jetbrains-mono', name: 'JetBrains Mono', cat: 'mono', google: 'JetBrains+Mono:wght@400;600', stack: '"JetBrains Mono", ui-monospace, monospace' },
    { id: 'fira-code', name: 'Fira Code', cat: 'mono', google: 'Fira+Code:wght@400;600', stack: '"Fira Code", ui-monospace, monospace' },
    { id: 'ibm-plex-mono', name: 'IBM Plex Mono', cat: 'mono', google: 'IBM+Plex+Mono:wght@400;600', stack: '"IBM Plex Mono", ui-monospace, monospace' },
  ];
  var FONT_CATS = ['sans', 'serif', 'mono'];
  function fontById(id) { return FONTS.filter(function (f) { return f.id === id; })[0] || null; }
  function initFont() { return fontById(PREFS.font) ? PREFS.font : 'default'; }

  // Inject the Google Fonts stylesheet for a font once, the first time it's picked.
  var _loadedFonts = {};
  function loadGoogleFont(f) {
    if (!f || !f.google || _loadedFonts[f.id]) return;
    _loadedFonts[f.id] = true;
    var link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=' + f.google + '&display=swap';
    document.head.appendChild(link);
  }

  // Theme catalog (defined up here, not in the theme section below, because boot()
  // runs on the readyState check before that section's top-level code executes —
  // applyTheme reads THEME_IDS on boot). The two spec-native palettes plus the
  // review-layer variants whose palettes live in review.css (keyed on
  // [data-theme="<id>"]). Order matters: light family first, then dark — the 4-up
  // swatch grid then lands each family on its own row.
  var THEMES = [
    { id: 'light', name: 'Light' },
    { id: 'solarized-light', name: 'Solarized Light' },
    { id: 'github-light', name: 'GitHub Light' },
    { id: 'gruvbox-light', name: 'Gruvbox Light' },
    { id: 'dark', name: 'Dark' },
    { id: 'dracula', name: 'Dracula' },
    { id: 'nord', name: 'Nord' },
    { id: 'solarized-dark', name: 'Solarized Dark' },
  ];
  var THEME_IDS = THEMES.map(function (t) { return t.id; });

  // Submit shortcut label: ⌘↵ on Mac, Ctrl+↵ elsewhere (the handler accepts both).
  var IS_MAC = /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
  var MOD_HINT = IS_MAC ? '⌘↵' : 'Ctrl+↵';

  // Initialized here (not at the theme section below) because boot() runs on the
  // readyState check above — before that section's top-level code executes — and
  // applyTheme() reads this; a mid-file init would leave it `undefined` on boot.
  var _themeSupported = null;

  var booted = false;
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
  function boot() {
    if (booted) return;
    booted = true;
    applyTheme(); // review-layer owns theme — apply the persisted choice on load
    // Apply the persisted width on load too. Without this a saved width only took
    // effect when the menu first built its width row, so every spec auto-reload
    // reset the page to its default width until you clicked the SpecForge icon.
    var savedW = parseInt(PREFS.width, 10);
    if (savedW) applyWidth(savedW);
    applyFont(initFont()); // reading font — persisted choice (or sans) on load
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
  function specSupportsTheme() {
    if (_themeSupported !== null) return _themeSupported;
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
    if (next == null) next = PREFS.theme;
    if (THEME_IDS.indexOf(next) === -1) return; // honor the spec/OS default
    document.documentElement.setAttribute('data-theme', next);
  }
  function currentTheme() {
    var a = document.documentElement.getAttribute('data-theme');
    if (THEME_IDS.indexOf(a) !== -1) return a;
    // No explicit choice yet → reflect what's actually rendered, else the OS hint.
    return renderedTheme() ||
      ((window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light');
  }
  function setTheme(id) {
    if (THEME_IDS.indexOf(id) === -1) return;
    document.documentElement.setAttribute('data-theme', id);
    putPref({ theme: id });
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

  // ---------- reading font (review-layer owned) ----------
  // Set a data-attr on the content container only; review.css maps it to a stack.
  // Scoping to the container (not <html>) keeps the review chrome untouched. When a
  // spec has no container element, widthContainer() falls back to <body> (same as
  // applyWidth) and the attr lands there — the chrome is still safe because every
  // chrome root (#sf-sidebar/#sf-menu/#sf-launcher/#sf-compose/#sf-toc) declares its
  // own font-family, so the reading font can't inherit in. Code stays monospace
  // unless the whole doc is set to mono.
  function applyFont(id) {
    var c = widthContainer();
    var f = fontById(id);
    if (!f) { // 'default' / unknown → spec's own font, no override, no fetch
      c.removeAttribute('data-sf-font');
      c.style.removeProperty('--sf-reading-font');
      return;
    }
    loadGoogleFont(f);
    // data-sf-font carries the CATEGORY (sans/serif/mono) — review.css keys the
    // code-block exemption off it; the actual family is the inline --sf-reading-font.
    c.setAttribute('data-sf-font', f.cat);
    c.style.setProperty('--sf-reading-font', f.stack);
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
    buildTop();

    document.addEventListener('mousemove', onHover);
    document.addEventListener('click', onClick, true); // capture so we can claim a block click
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { clearHover(); hideCompose(); closeMenu(); } });
  }

  // Floating "↑ Top" button (top-right) — smooth-scrolls to the top of the spec.
  // Hidden until the reader has scrolled down a bit, so it never clutters the top.
  function buildTop() {
    els.top = create('button', { id: 'sf-top', type: 'button', 'aria-label': 'Back to top', title: 'Back to top' });
    els.top.innerHTML = '<span aria-hidden="true">↑</span> Top';
    els.top.onclick = function () { window.scrollTo({ top: 0, behavior: 'smooth' }); };
    document.body.appendChild(els.top);
    function onScroll() { els.top.classList.toggle('show', (window.scrollY || window.pageYOffset || 0) > 400); }
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
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
      // All submitted. Once every open thread is answered it's the human's turn to
      // read the replies; until then we surface how far the agent has got —
      // Awaiting response → Picked up comments → Working on comments — from the
      // batch progress the hooks + review-spec skill report via meta.reviewProgress.
      if (repliedCount() >= unresolved) return { label: 'Review replies', state: 'replied', act: 'review' };
      // Comments submitted, agent processing, not yet ready to review — one phase, so
      // all three steps carry the loading spinner (loading) to signal work in flight.
      var prog = state.meta && state.meta.reviewProgress;
      if (prog === 'working') return { label: 'Working on comments', state: 'reviewing', act: null, loading: true };
      if (prog === 'picked_up') return { label: 'Picked up comments', state: 'picked', act: null, loading: true };
      return { label: 'Awaiting response', state: 'awaiting', act: null, loading: true };
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
    btn.setAttribute('data-state', s.state);
    btn.disabled = !s.act;
    // While the agent is working a submitted batch, prefix the label with a custom
    // SpecForge spinner (a CSS ring) so the disabled button reads as "in progress".
    btn.textContent = '';
    if (s.loading) btn.appendChild(create('span', { class: 'sf-spin', 'aria-hidden': 'true' }));
    btn.appendChild(document.createTextNode(s.label));
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
    var unresolved = unresolvedCount();

    // Comments — toggles the sidebar; carries the unresolved-count badge (mirrors
    // the launcher pill, so the two never disagree).
    var comments = menuRow('💬', 'Comments', function () { toggleSidebar(); closeMenu(); });
    if (unresolved) {
      var badge = create('span', { class: 'sf-menu-badge' }, String(unresolved));
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

    // Font — sans/serif/mono reading font, persisted.
    els.menu.appendChild(fontRow());

    // Export — open the print dialog (pick "Save as PDF"); the review chrome is
    // hidden by the print stylesheet so the PDF is just the spec.
    els.menu.appendChild(menuRow('⤓', 'Export PDF', function () { closeMenu(); window.print(); }));

    // Export to Google Docs — relayed through the attached session (it runs the
    // Drive MCP); the row reflects meta.export and updates live on the poll.
    els.menu.appendChild(exportRow());

    // Footer — one bottom row: the live pill (left), the attached session id
    // (center), and Detach (right). els.live survives the innerHTML reset above
    // (#sf-live, the same node re-appended each rebuild).
    els.menu.appendChild(sessionFoot());
  }

  // The bottom row: [● live]  [session id / "Not attached"]  [Detach].
  function sessionFoot() {
    var foot = create('div', { class: 'sf-menu-foot' });
    if (els.live) foot.appendChild(els.live); // the green SSE live pill, left
    var attached = state.meta && state.meta.attachedSession;
    var friendly = state.meta && state.meta.sessionLabel;
    var label = attached ? (friendly || ('Session ' + String(attached).slice(0, 8))) : 'Not attached';
    foot.appendChild(create('span', { class: 'sf-foot-session', title: label }, label));
    if (attached) {
      var btn = create('button', { class: 'sf-detach', type: 'button' }, 'Detach');
      btn.onclick = function (e) { e.stopPropagation(); detachSpec(); };
      foot.appendChild(btn);
    }
    return foot;
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
    var row = create('div', { class: 'sf-menu-row sf-menu-ctl' });
    row.innerHTML = '<span class="sf-row-main"><span class="sf-row-ic">◐</span><span>Theme</span></span>';
    // A spec that hardcodes one palette can't be re-themed — show it fixed.
    if (!specSupportsTheme()) {
      var shown = renderedTheme() || currentTheme();
      row.querySelector('.sf-row-main').appendChild(create('span', { class: 'sf-row-val' }, shown + ' · fixed'));
      row.setAttribute('title', 'This spec defines a single theme');
      return row;
    }
    // Swatch picker — light family then dark, each swatch tinted in review.css.
    var cur = currentTheme();
    var grid = create('span', { class: 'sf-themes' });
    THEMES.forEach(function (th) {
      var sw = create('button', { class: 'sf-swatch', type: 'button', 'data-theme': th.id, title: th.name, 'aria-label': th.name });
      if (th.id === cur) sw.classList.add('on');
      sw.onclick = function () {
        Array.prototype.forEach.call(grid.querySelectorAll('.sf-swatch'), function (x) { x.classList.remove('on'); });
        sw.classList.add('on');
        setTheme(th.id);
      };
      grid.appendChild(sw);
    });
    row.appendChild(grid);
    return row;
  }
  // Font — a dropdown of reading fonts grouped Sans/Serif/Mono; applies live and
  // persists the pick. "Default" leaves the spec's own font alone.
  function fontRow() {
    var row = create('div', { class: 'sf-menu-row sf-menu-ctl' });
    row.innerHTML = '<span class="sf-row-main"><span class="sf-row-ic">A</span><span>Font</span></span>';
    var sel = create('select', { class: 'sf-font-select', 'aria-label': 'Reading font' });
    sel.appendChild(create('option', { value: 'default' }, 'Default'));
    FONT_CATS.forEach(function (cat) {
      var group = create('optgroup', { label: cat.charAt(0).toUpperCase() + cat.slice(1) });
      FONTS.filter(function (f) { return f.cat === cat; }).forEach(function (f) {
        group.appendChild(create('option', { value: f.id }, f.name));
      });
      sel.appendChild(group);
    });
    sel.value = initFont();
    sel.onchange = function () { applyFont(sel.value); putPref({ font: sel.value }); };
    row.appendChild(sel);
    return row;
  }
  function detachSpec() {
    postJSON(SPEC_API + '/detach').then(function () { closeMenu(); load(); })
      .catch(function () { flash('Could not detach.'); });
  }

  // Export-to-Google-Docs row — reflects meta.export. The browser can't run the
  // MCP, so this only queues the request; the attached session fulfills it and the
  // link arrives on a later /meta poll (the menu rebuilds in place, so it updates
  // live while open). States: idle/error → action · requested/working → spinner ·
  // done → open-link + re-export.
  function exportRow() {
    var ex = (state.meta && state.meta.export) || null;
    var st = ex && ex.state;
    if (st === 'requested' || st === 'working') {
      var busy = menuRow('', 'Exporting to Google Docs…', null);
      busy.disabled = true;
      busy.querySelector('.sf-row-ic').appendChild(create('span', { class: 'sf-spin', 'aria-hidden': 'true' }));
      return busy;
    }
    if (st === 'done' && ex.url) {
      var done = create('div', { class: 'sf-menu-row sf-menu-ctl' });
      // A real anchor — natively keyboard-activatable + opens in a new tab; no
      // role/tabindex/window.open dance.
      var link = create('a', { class: 'sf-row-main sf-doc-link', href: ex.url, target: '_blank', rel: 'noopener' });
      link.innerHTML = '<span class="sf-row-ic">↗</span><span>Open Google Doc</span>';
      link.onclick = function () { closeMenu(); };
      done.appendChild(link);
      var re = create('button', { class: 'sf-detach sf-reexport', type: 'button', title: 'Export again' }, 'Re-export');
      re.onclick = function (e) { e.stopPropagation(); doExport(); };
      done.appendChild(re);
      return done;
    }
    var label = st === 'error' ? 'Export to Google Docs — retry' : 'Export to Google Docs';
    var row = menuRow('⤴', label, function () { doExport(); });
    if (st === 'error' && ex.error) row.setAttribute('title', ex.error);
    return row;
  }
  // Queue the export, then refresh — the row flips to "Exporting…" (menu stays open
  // so the user watches it resolve to the link). A 409 (no session / already running)
  // flashes the server's reason.
  function doExport() {
    postJSON(SPEC_API + '/export').then(function (r) {
      if (r.ok) return load();
      r.json().then(function (b) { flash((b && b.error) || 'Could not start the export.'); })
        .catch(function () { flash('Could not start the export.'); });
    }).catch(function () { flash('Could not start the export.'); });
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
    if (tid) {
      // Block already has a thread → open it and drop straight into a reply, so
      // adding another comment to the same thread is one click (no hunting for
      // the Reply button). Every comment on a block lives in that one thread.
      setSidebar(true);
      activate(tid, false);
      focusReply(tid);
      return;
    }
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
      var card = create('div', { class: 'sf-thread state-' + t.state, 'data-tid': t.id });
      if (state.active === t.id) card.classList.add('sf-active');
      card.innerHTML =
        '<div class="sf-meta"><span class="sf-badge ' + t.state + '">' + esc(t.state) + '</span>' +
        '<span class="sf-loc">' + esc((block.tag || 'block').toLowerCase()) + '</span></div>' +
        '<div class="sf-quote">' + esc((block.text || '').slice(0, 140)) + '</div>' +
        t.comments.map(function (c) {
          // Only your own, not-yet-submitted comments can be edited (the server
          // enforces the same rule); once frozen into a batch the agent may be
          // acting on it. id-less fixture comments aren't addressable → no control.
          var editable = c.author === 'human' && !c.batchId && c.id;
          return '<div class="sf-comment" data-cid="' + esc(c.id || '') + '"><span class="who ' +
            (c.author === 'claude' ? 'claude' : '') + '">' + esc(c.author) + '</span>' +
            '<div class="body">' + esc(c.body) + '</div>' +
            (editable ? '<button class="sf-edit-c" type="button" aria-label="Edit comment">Edit</button>' : '') +
            '</div>';
        }).join('');
      Array.prototype.forEach.call(card.querySelectorAll('.sf-comment'), function (cEl) {
        var btn = cEl.querySelector('.sf-edit-c');
        if (!btn) return;
        var cid = cEl.getAttribute('data-cid');
        var c = t.comments.filter(function (x) { return x.id === cid; })[0];
        if (c) btn.onclick = function (e) { e.stopPropagation(); openCommentEdit(cEl, t, c); };
      });
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

  // Open (and focus) the reply box on a thread's sidebar card — used when a click
  // on an already-commented block should let you add another comment to it.
  function focusReply(tid) {
    var t = state.threads.filter(function (x) { return x.id === tid; })[0];
    if (!t) return;
    var card = els.threads.querySelector('[data-tid="' + tid + '"]');
    if (card) openReply(card, t);
  }

  // Inline edit of an own, not-yet-submitted comment — swaps the body for a
  // prefilled textarea. Save PATCHes the comment; Cancel restores the body.
  function openCommentEdit(commentEl, t, c) {
    if (commentEl.querySelector('.sf-edit')) return; // already editing this one
    var bodyEl = commentEl.querySelector('.body');
    var trigger = commentEl.querySelector('.sf-edit-c');
    var box = create('div', { class: 'sf-edit' });
    box.onclick = function (e) { e.stopPropagation(); }; // editing shouldn't re-activate the card
    var ta = create('textarea', { class: 'sf-input', rows: '2' });
    ta.value = c.body;
    var row = create('div', { class: 'sf-compose-foot' });
    var save = create('button', { class: 'sf-primary' }, 'Save');
    var cancel = create('button', { class: 'sf-ghost' }, 'Cancel');
    function close() {
      box.remove();
      if (bodyEl) bodyEl.style.display = '';
      if (trigger) trigger.style.display = '';
    }
    function submit() {
      var v = ta.value.trim();
      if (!v) return;
      if (v === c.body) return close(); // no change — just put the body back
      fetch(API + '/' + t.id + '/comment/' + c.id, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body: v }),
      }).then(function (r) { if (r.ok) load(); else flash('Could not save the edit.'); })
        .catch(function () { flash('Could not save the edit.'); });
    }
    save.onclick = submit;
    cancel.onclick = close;
    row.appendChild(create('span', { class: 'sf-hint' }, MOD_HINT + ' to save'));
    row.appendChild(cancel); row.appendChild(save);
    box.appendChild(ta); box.appendChild(row);
    if (bodyEl) bodyEl.style.display = 'none';
    if (trigger) trigger.style.display = 'none';
    commentEl.appendChild(box);
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
    // A thread needs submitting if it's live (not resolved) and carries any
    // un-submitted human comment — `some`, not `every`, so a reopened thread whose
    // older comments were already submitted (have a batchId) still counts.
    return state.threads.filter(function (t) {
      return t.state !== 'resolved'
        && t.comments.some(function (c) { return c.author === 'human' && !c.batchId; });
    }).length;
  }
  function renderLauncher() {
    // The launcher pill is the at-a-glance signal: how many threads are still
    // unresolved (not how many are un-submitted). It stays visible through the
    // agent's working phase, when pending=0 but threads remain open.
    var n = unresolvedCount();
    els.launcher.classList.toggle('has-count', !!n);
    els.launcher.querySelector('.sf-l-n').textContent = n || '';
    // Keep an open menu's count badge in sync with fresh data.
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
          t.id === 'sf-menu' || t.id === 'sf-live' || t.id === 'sf-toc' || t.id === 'sf-top') return true;
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
