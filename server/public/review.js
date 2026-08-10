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

  // UI prefs, embedded at serve time by inject.mjs. Source of truth is the store
  // (origin/port-independent — survives a daemon port change, unlike localStorage),
  // so a change PUTs back and updates this in place.
  //
  // theme + font are STORE-WIDE (apply to every spec) → PUT /api/prefs.
  // width / filter / fit / toc are per-spec → PUT /api/spec/<id>/prefs.
  var PREFS = (window.SPECFORGE || {}).prefs || {};
  var GLOBAL_PREF_KEYS = { theme: 1, font: 1 };
  function putJSON(url, body) {
    try {
      fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(function () {});
    } catch (e) {}
  }
  function putPref(patch) {
    var global = null, spec = null;
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      PREFS[k] = patch[k];
      // Strict === against the sentinel so an inherited key (constructor,
      // toString) can never be misread as a global pref.
      if (GLOBAL_PREF_KEYS[k] === 1) { (global = global || {})[k] = patch[k]; }
      else { (spec = spec || {})[k] = patch[k]; }
    }
    if (global) putJSON('/api/prefs', global);
    if (spec) putJSON(SPEC_API + '/prefs', spec);
  }

  // Elements that can carry a comment. The innermost match under the pointer wins.
  var BLOCK_SEL = 'h1,h2,h3,h4,h5,h6,p,li,tr,td,th,pre,blockquote,figure,.panel,.callout,.card,.stat,.loop .step,.matrix .q,.bar,.ns';
  var INTERACTIVE = 'a,button,input,textarea,select,summary,label';

  var INIT_FILTER = (PREFS.filter === 'resolved' || PREFS.filter === 'all') ? PREFS.filter : 'open';
  // composeEl: the block a new-thread composer is currently open on (rail), or null.
  var state = { threads: [], filter: INIT_FILTER, active: null, meta: null, composeEl: null };
  var els = {};

  // Reading-font catalog (review-layer owned) — the famous reader/blog fonts, 3 per
  // category. `cat` (sans/serif/mono/presentation) drives the code-block exemption in review.css;
  // `google` is the Fonts API family spec, loaded on demand only when picked (so a
  // spec fetches nothing until you choose a web font); `stack` always lists a system
  // fallback so it degrades gracefully offline. Default ('default') leaves the spec's
  // own font untouched — no override, no fetch.
  var FONTS = [
    { id: 'inter', name: 'Inter', cat: 'sans', google: 'Inter:wght@400;600', stack: '"Inter", system-ui, sans-serif' },
    { id: 'google-sans', name: 'Google Sans', cat: 'sans', google: 'Google+Sans:wght@400;600', stack: '"Google Sans", system-ui, sans-serif' },
    { id: 'work-sans', name: 'Work Sans', cat: 'sans', google: 'Work+Sans:wght@400;600', stack: '"Work Sans", system-ui, sans-serif' },
    { id: 'eb-garamond', name: 'EB Garamond', cat: 'serif', google: 'EB+Garamond:wght@400;600', stack: '"EB Garamond", Georgia, serif' },
    { id: 'merriweather', name: 'Merriweather', cat: 'serif', google: 'Merriweather:wght@400;700', stack: '"Merriweather", Georgia, serif' },
    { id: 'lora', name: 'Lora', cat: 'serif', google: 'Lora:wght@400;600', stack: '"Lora", Georgia, serif' },
    { id: 'jetbrains-mono', name: 'JetBrains Mono', cat: 'mono', google: 'JetBrains+Mono:wght@400;600', stack: '"JetBrains Mono", ui-monospace, monospace' },
    { id: 'fira-code', name: 'Fira Code', cat: 'mono', google: 'Fira+Code:wght@400;600', stack: '"Fira Code", ui-monospace, monospace' },
    { id: 'ibm-plex-mono', name: 'IBM Plex Mono', cat: 'mono', google: 'IBM+Plex+Mono:wght@400;600', stack: '"IBM Plex Mono", ui-monospace, monospace' },
    // Presentation — high-personality display faces for slide-heavy / showcase specs.
    // A 700 weight is loaded so headings render crisp bold, not synthetic. They behave
    // like sans/serif for the code-block exemption (any cat but 'mono' keeps code mono).
    { id: 'poppins', name: 'Poppins', cat: 'presentation', google: 'Poppins:wght@400;600;700', stack: '"Poppins", system-ui, sans-serif' },
    { id: 'space-grotesk', name: 'Space Grotesk', cat: 'presentation', google: 'Space+Grotesk:wght@400;600;700', stack: '"Space Grotesk", system-ui, sans-serif' },
    { id: 'fraunces', name: 'Fraunces', cat: 'presentation', google: 'Fraunces:wght@400;600;700', stack: '"Fraunces", Georgia, serif' },
  ];
  var FONT_CATS = ['sans', 'serif', 'mono', 'presentation'];
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
    // Apply the persisted view on load too. Without this a saved width only took
    // effect when the menu first built its width row, so every spec auto-reload
    // reset the page to its default width until you clicked the SpecForge icon.
    if (PREFS.fit) {
      applyFit(true);
    } else {
      var savedW = parseInt(PREFS.width, 10);
      if (savedW) applyWidth(savedW);
    }
    // The floating "Contents" TOC + its collapse state are owned by the #sf-toc
    // injector (the second IIFE below), which builds after this chrome.
    applyFont(initFont()); // reading font — persisted choice (or sans) on load
    buildChrome();
    // Establish block identity before the first render, so comments resolve by
    // id rather than by guessing at content. Non-blocking on failure.
    syncBlocks(load);
    // Poll so Claude's replies appear without a manual refresh; pause while the
    // composer is open so we don't disrupt the user mid-comment.
    // Pause the poll while a composer is open so a reload can't wipe what the
    // reader is typing.
    setInterval(function () { if (!state.composeEl) load(); }, 6000);
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
  // Fit-to-width: stretch the layout to the full viewport instead of a px cap.
  // On exit, restore the persisted/derived slider width so the page never lands
  // in a half-state. The html attr lets CSS opt other things in later.
  function applyFit(on) {
    if (on) {
      document.documentElement.setAttribute('data-sf-fit', '');
      document.documentElement.style.setProperty('--maxw', '100%');
      try { widthContainer().style.maxWidth = 'none'; } catch (e) {}
    } else {
      document.documentElement.removeAttribute('data-sf-fit');
      applyWidth(startWidth());
    }
  }
  function isFit() { return document.documentElement.hasAttribute('data-sf-fit'); }
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
      if (changed) { adoptBids(); render(); }
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
    buildTitleBar();
    buildRail();

    document.addEventListener('mousemove', onHover);
    document.addEventListener('click', onClick, true); // capture so we can claim a block click
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { clearHover(); closeMenu(); collapseThread(); cancelCompose(); }
    });
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

  // Floating spec title (top-center glass pill) — mirrors the spec's own <h1>
  // (falling back to the stored title, then the document title) and is ALWAYS on
  // top — a fixed, full-width header rather than something that appears on
  // scroll, so the spec's name is never out of reach. Clicking it returns to the
  // top. The label refreshes from render() so the fallback fills in once meta
  // loads. Its own font so the reading-font override can't bleed in.
  function buildTitleBar() {
    // A container, not a button: it also carries the lifecycle CTA, and nesting
    // a button inside a button is invalid. The title itself is the button.
    els.titlebar = create('div', { id: 'sf-titlebar' });
    var home = create('button', { class: 'sf-tb-home', type: 'button', title: 'Back to top' });
    els.titlebarLabel = create('span', { class: 'sf-tb-title' });
    home.appendChild(els.titlebarLabel);
    home.onclick = function () { window.scrollTo({ top: 0, behavior: 'smooth' }); };
    els.titlebar.appendChild(home);
    // The review CTA, mirroring the drawer's command bar — where the loop has
    // got to (Submit comments / Working on comments / Review replies / LGTM /
    // Implement) is the one thing you shouldn't have to open a drawer to see.
    // It shares actionState()/applyAction() with the footer, so the two
    // surfaces cannot drift.
    els.headAction = create('button', { class: 'sf-act sf-tb-act', type: 'button' });
    els.headAction.onclick = onAction;
    els.titlebar.appendChild(els.headAction);
    document.body.appendChild(els.titlebar);
    syncTitle();
  }
  function currentTitle() {
    var h1 = document.querySelector('h1');
    var fromH1 = h1 && h1.textContent.trim();
    var fromMeta = state.meta && state.meta.title && String(state.meta.title).trim();
    return fromH1 || fromMeta || (document.title || '').trim();
  }
  // A spec with no title anywhere gets no header — and, crucially, no page
  // offset either: data-sf-header is what CSS keys the top padding off, so the
  // two can never disagree.
  function syncTitle() {
    if (!els.titlebar) return;
    var title = currentTitle();
    if (els.titlebarLabel.textContent !== title) els.titlebarLabel.textContent = title;
    els.titlebar.classList.toggle('show', !!title);
    if (title) document.documentElement.setAttribute('data-sf-header', '');
    else document.documentElement.removeAttribute('data-sf-header');
  }

  // Sidebar open/close — also flags the body so the floating launcher can
  // get out of the sidebar's way (CSS: body.sf-side-open).
  function setSidebar(open) {
    els.sidebar.classList.toggle('open', open);
    document.body.classList.toggle('sf-side-open', open);
    syncRailVisibility(); // the drawer and the rail share the right gutter
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
    applyAction(els.headAction, s);
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

    // Contents — show/hide the floating TOC. Delegates to the chevron so the two
    // controls (and the persisted state) never disagree.
    var tocBtn = document.getElementById('sf-tocbtn');
    if (tocBtn) {
      els.menu.appendChild(menuRow('📑', 'Contents', function () { tocBtn.click(); closeMenu(); }));
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
    // Fit-to-width toggle — stretches the layout to the viewport; the slider is
    // the alternative, so using it exits fit mode.
    var fit = create('button', { class: 'sf-fit', type: 'button', title: 'Fit to width' }, 'Fit');
    fit.classList.toggle('on', isFit());
    fit.onclick = function () {
      var on = !isFit();
      applyFit(on);
      fit.classList.toggle('on', on);
      putPref({ fit: on });
    };
    row.querySelector('.sf-row-main').appendChild(fit);
    var range = create('input', { type: 'range', min: '820', max: '1760', step: '20' });
    var px = startWidth();
    range.value = px;
    if (!isFit()) applyWidth(px);
    // Apply live while dragging; persist once (on release) to avoid a PUT per pixel.
    range.oninput = function () {
      if (isFit()) { applyFit(false); fit.classList.remove('on'); }
      applyWidth(range.value);
    };
    range.onchange = function () {
      // A slider release always means px mode. `change` can fire without a
      // preceding `input` — exit fit here too, or a stale fit:true would win
      // the next boot over the width the user just picked.
      if (isFit()) { applyFit(false); fit.classList.remove('on'); applyWidth(range.value); }
      putPref({ width: parseInt(range.value, 10), fit: false });
    };
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
  // ---------- block registry ----------
  // SpecForge remembers this spec's block sequence (blocks.json) so a comment
  // keeps its place when the spec is edited: on load we diff what we remember
  // against what is on the page, and every block comes back with the id it had
  // last time. See server/public/reconcile.js for the algorithm.
  //
  // Strictly an optimisation: if the registry is missing, unreadable, or the
  // request fails, `bidOf` simply returns nothing and every anchor falls back to
  // the content matching that has always been there.
  var bidByEl = null;   // Map-ish: set once per reconcile
  var goneBids = {};    // bids whose block no longer exists on this page
  function bidOf(el) {
    if (!bidByEl || !el) return null;
    for (var i = 0; i < bidByEl.length; i++) if (bidByEl[i].el === el) return bidByEl[i].bid;
    return null;
  }
  function elForBid(bid) {
    if (!bidByEl || !bid) return null;
    for (var i = 0; i < bidByEl.length; i++) if (bidByEl[i].bid === bid) return bidByEl[i].el;
    return null;
  }
  /** True when this thread's block is known-deleted (not merely unresolvable). */
  function isOrphan(t) {
    var b = t.anchor && t.anchor.block;
    return !!(b && b.bid && goneBids[b.bid] && !elForBid(b.bid));
  }
  /**
   * Where to park an orphaned thread: the nearest block that still exists ABOVE
   * where its block used to be, so it stays next to its old neighbourhood
   * instead of jumping to the top of the page. Falls back to the first block.
   */
  function orphanHome(t) {
    var b = t.anchor && t.anchor.block;
    var blocks = commentableBlocks();
    if (!blocks.length) return null;
    var path = (b && b.sectionPath) || [];
    for (var k = 0; k < path.length; k++) {
      var sec = document.getElementById(path[k]);
      if (sec && sec.tagName === 'SECTION') return sec;
    }
    var i = Math.min(Math.max((b && b.index) || 0, 0), blocks.length - 1);
    return blocks[i] || blocks[0];
  }

  function reconcileBlocks(registry) {
    var R = window.SFReconcile;
    if (!R) return null;
    var els = commentableBlocks();
    var page = els.map(function (el) { return { tag: el.tagName, text: norm(el.textContent) }; });
    var out = R.reconcile(page, registry);
    bidByEl = els.map(function (el, i) { return { el: el, bid: out.bids[i] }; });
    // Read from `retired`, not `gone`: gone is only what vanished since the last
    // reconcile, and the load that notices a deletion rewrites the registry — so
    // every later load would see an empty `gone` and forget the block was ever
    // removed. `retired` is the durable record.
    goneBids = {};
    (out.registry.retired || []).forEach(function (b) { goneBids[b] = true; });
    return out;
  }
  // Fetch the registry, reconcile, persist if it moved, then render. Any failure
  // here is non-fatal — we still render, just without ids.
  function syncBlocks(done) {
    if (!window.SFReconcile) return done();
    fetch(SPEC_API + '/blocks')
      .then(function (r) { return r.json(); })
      .catch(function () { return null; })
      .then(function (body) {
        var registry = body && body.registry;
        var out = reconcileBlocks(registry);
        if (!out || !out.changed) return done();
        var payload = out.registry;
        payload.baseVersion = registry && typeof registry.version === 'number' ? registry.version : 0;
        return fetch(SPEC_API + '/blocks', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        }).then(function (r) {
          // 409: another tab reconciled first. Re-read and redo once — both tabs
          // compute the same answer from the same page, so this converges.
          if (r && r.status === 409) return syncBlocksRetry(done);
          done();
        }).catch(function () { done(); });
      })
      .catch(function () { done(); });
  }
  var retried = false;
  function syncBlocksRetry(done) {
    if (retried) return done();
    retried = true;
    syncBlocks(done);
  }

  // The anchor is ADDITIVE: it gains a bid, and keeps index/text/sectionPath.
  // Those are what the sidebar quotes, what a comment written by an older
  // client carries, and what an older client would read if this one were rolled
  // back — so they are never dropped in favour of the id.
  function blockAnchor(el) {
    var a = {
      index: commentableBlocks().indexOf(el),
      tag: el.tagName,
      text: norm(el.textContent).slice(0, 400),
      sectionPath: sectionPathOf(el),
    };
    var bid = bidOf(el);
    if (bid) a.bid = bid;
    return a;
  }
  /**
   * Where a thread's block is now.
   *
   * The id is the answer whenever we have one: it is tracked across edits by the
   * reconcile, so a reworded paragraph is still that paragraph. Everything below
   * it is the path for anchors written before ids existed (and for the case
   * where the registry is unavailable) — resolve by content once, then adopt the
   * id, and this never runs for that thread again.
   */
  function findBlock(anchor) {
    var b = anchor && anchor.block;
    if (!b) return null;
    if (b.bid) {
      var byBid = elForBid(b.bid);
      if (byBid) return byBid;
      // Known-gone is a FACT, not a failed search: the block was deleted. Say so
      // rather than quietly landing the thread on something else.
      if (goneBids[b.bid]) return null;
      // Otherwise the registry just isn't loaded — fall through and match content.
    }
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

  /**
   * Give threads that predate the registry an id, once. Each is resolved by the
   * legacy content path, adopts the id of whatever block it landed on, and is an
   * exact lookup from then on — so the corpus heals as specs are opened, with no
   * migration step to run.
   */
  /**
   * Resolve a legacy anchor by content, and say whether the answer was
   * UNAMBIGUOUS. Adopting an id is permanent, so a guess must never be frozen:
   * if several blocks share this text and the remembered index no longer picks
   * one of them, we genuinely do not know which was meant.
   * @returns {{el:Element, sure:boolean}|null}
   */
  function legacyMatch(anchor) {
    var b = anchor && anchor.block;
    if (!b) return null;
    var blocks = commentableBlocks();
    var hits = [];
    for (var i = 0; i < blocks.length; i++) {
      if (norm(blocks[i].textContent).slice(0, 400) === b.text) hits.push(blocks[i]);
    }
    if (!hits.length) return null;
    if (hits.length === 1) return { el: hits[0], sure: true };
    var atIndex = blocks[b.index];
    // Several blocks match, but the remembered position still lands on one of
    // them — that is the one.
    if (atIndex && hits.indexOf(atIndex) !== -1) return { el: atIndex, sure: true };
    return { el: hits[0], sure: false };
  }

  function adoptBids() {
    if (!bidByEl) return;
    state.threads.forEach(function (t) {
      var b = t.anchor && t.anchor.block;
      if (!b || b.bid) return;
      var m = legacyMatch(t.anchor);
      // Ambiguous: leave it alone. It still resolves the way it always did,
      // re-decided each render — no worse than before, and not cemented.
      if (!m || !m.sure) return;
      var bid = bidOf(m.el);
      if (!bid) return;
      b.bid = bid; // optimistic locally, so this render already uses it
      fetch(API + '/' + t.id + '/anchor', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bid: bid }),
      }).catch(function () {});
    });
  }

  // ---------- hover + click ----------
  var hoverEl = null;
  function onHover(e) {
    // Over the rail, leave the highlight alone: the bubble's own enter/leave
    // handlers own the reciprocal highlight there. Clearing it on every
    // mousemove inside a hovered bubble would make its block flicker.
    if (e.target.closest && e.target.closest('#sf-rail')) return;
    if (state.composeEl || inUI(e.target)) { clearHover(); return; }
    var el = blockAt(e.target);
    if (el === hoverEl) return;
    clearHover();
    // Hovering a block lights up every bubble anchored to it — the other half of
    // the reciprocal bond wired in wireBubbleHover().
    if (el) { el.classList.add('sf-hover'); hoverEl = el; markBubbleFocus(el, true); }
  }
  function clearHover() {
    if (!hoverEl) return;
    hoverEl.classList.remove('sf-hover');
    markBubbleFocus(hoverEl, false);
    hoverEl = null;
  }

  function onClick(e) {
    // Dismissal is decided HERE, in the capture phase, before any handler can
    // re-render and detach e.target — an ancestor test on a detached node would
    // miss the chrome it came from and collapse the thread the user just opened.
    // Clicking anywhere that isn't a thread card or review chrome collapses the
    // open thread: the same outcome as its × button.
    if (!(e.target.closest && e.target.closest('.sf-bub')) && !inUI(e.target)) {
      collapseThread();
      cancelCompose();
    }
    if (inUI(e.target) || (e.target.closest && e.target.closest(INTERACTIVE))) return;
    var sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed) return; // a real text selection — leave it alone
    var el = blockAt(e.target);
    if (!el) return;
    // A click on a block ALWAYS starts a new thread — including on a block that
    // already carries one, which is what allows several threads per block.
    // Existing threads are read and replied to from their cards, not from here.
    e.preventDefault();
    openRailCompose(el);
  }

  // ---------- render ----------
  function render() { renderSidebar(); renderHighlights(); renderRail(); renderLauncher(); renderAction(); syncTitle(); }

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
            '<div class="body">' + fmtBody(c.body) + '</div>' +
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

  // Mark every block that carries live threads. A block may carry SEVERAL, so
  // the threads are grouped by element first: `data-sf-threads` lists them all
  // (the rail keys off it), while `data-sf-thread` keeps naming the first one so
  // activate()'s scroll-into-view lookup stays a simple attribute match.
  function renderHighlights() {
    Array.prototype.forEach.call(document.querySelectorAll('.sf-block-mark'), function (el) {
      el.classList.remove('sf-block-mark', 'sf-active');
      el.removeAttribute('data-sf-thread');
      el.removeAttribute('data-sf-threads');
    });
    var groups = [];
    visible().forEach(function (t) {
      if (t.state === 'resolved') return;
      var el = findBlock(t.anchor);
      if (!el) return;
      var g = groups.filter(function (x) { return x.el === el; })[0];
      if (!g) { g = { el: el, ids: [] }; groups.push(g); }
      g.ids.push(t.id);
    });
    groups.forEach(function (g) {
      g.el.classList.add('sf-block-mark');
      g.el.setAttribute('data-sf-thread', g.ids[0]);
      g.el.setAttribute('data-sf-threads', g.ids.join(','));
      if (g.ids.indexOf(state.active) !== -1) g.el.classList.add('sf-active');
    });
    // The block being commented on reads as the active pair too, even before its
    // first thread exists.
    if (state.composeEl) state.composeEl.classList.add('sf-block-mark', 'sf-active');
  }

  // ---------- comments rail ----------
  // Open threads also render as floating bubbles in a right-margin rail, each
  // pinned to the block it comments on (Google-Docs style). Positions are
  // MEASURED every pass from live layout and never stored, so the rail stays
  // correct as the page scrolls, resizes or reflows.
  var RAIL_GAP = 8;
  var RAIL_EDGE = 8;   // breathing room kept at the rail's top/bottom when lifting
  // Below this the rail can't sit beside the centred content without crowding
  // it, so the drawer (SF → Comments) becomes the way to read threads — the same
  // idea as the floating TOC auto-collapsing on narrow windows.
  var RAIL_MIN_W = 1100;

  /**
   * PURE layout pass — the whole positioning rule, isolated from the DOM so it
   * can be tested with measurements alone.
   * @param {{top:number,h:number}[]} items measured, sorted by anchor top
   * @param {number} focusIdx index of the expanded thread, or -1 for none
   * @returns {number[]} the top for each item, in the same order
   *
   * The focused item is pinned to EXACTLY its anchor — it must never be shoved
   * off the block it is about — EXCEPT when the card would then run off the
   * bottom of the page, which would force a scroll to read the thread you just
   * opened. Then it is lifted just enough to fit, and never past the top edge.
   * Items after it flow down from its bottom; items before it are pulled up only
   * if they would collide. With no focus this is a plain downward clamp: never
   * above your anchor, never overlapping the one above.
   * @param {number} [viewportH] the rail's visible height; omit to skip the lift
   * @param {number} [edge] margin kept at the top and bottom when lifting
   */
  function railLayout(items, focusIdx, gap, viewportH, edge) {
    var tops = new Array(items.length), y, i;
    if (!items.length) return tops;
    if (focusIdx == null || focusIdx < 0) {
      y = -Infinity;
      for (i = 0; i < items.length; i++) {
        tops[i] = Math.max(items[i].top, y);
        y = tops[i] + items[i].h + gap;
      }
      return tops;
    }
    var focusTop = items[focusIdx].top;
    if (viewportH) {
      var m = edge || 0;
      var maxTop = viewportH - items[focusIdx].h - m;
      if (focusTop > maxTop) focusTop = maxTop;   // lift so the whole thread is readable
      if (focusTop < m) focusTop = m;             // but never above the top of the page
    }
    tops[focusIdx] = focusTop;
    y = tops[focusIdx] + items[focusIdx].h + gap;
    for (i = focusIdx + 1; i < items.length; i++) {
      tops[i] = Math.max(items[i].top, y);
      y = tops[i] + items[i].h + gap;
    }
    y = tops[focusIdx] - gap;
    for (i = focusIdx - 1; i >= 0; i--) {
      tops[i] = Math.min(items[i].top, y - items[i].h);
      y = tops[i] - gap;
    }
    return tops;
  }

  function buildRail() {
    els.rail = create('div', { id: 'sf-rail' });
    document.body.appendChild(els.rail);
    window.addEventListener('scroll', queueRail, { passive: true });
    window.addEventListener('resize', queueRail, { passive: true });
    // Scroll/resize alone miss reflows that move anchors without either event:
    // the width slider, fit-to-width, the TOC collapsing, or a web font arriving
    // late and re-wrapping every paragraph. Observe the content box itself so any
    // of those re-pin the bubbles.
    if (window.ResizeObserver) {
      var ro = new window.ResizeObserver(queueRail);
      try { ro.observe(widthContainer()); } catch (e) {}
      try { ro.observe(document.documentElement); } catch (e) {}
    }
    if (document.fonts && document.fonts.ready && document.fonts.ready.then) {
      document.fonts.ready.then(queueRail).catch(function () {});
    }
  }
  // Scroll fires far faster than we can usefully re-measure — coalesce to one
  // reposition per frame.
  var railTick = false;
  function queueRail() {
    if (railTick) return;
    railTick = true;
    window.requestAnimationFrame(function () { railTick = false; positionRail(); });
  }

  // Live threads whose anchor still resolves, paired with their block, in
  // DOCUMENT order (ties — several threads on one block — keep store order).
  // Ordering deliberately uses document position rather than measured tops: the
  // two agree for laid-out content, but document position is also correct before
  // the first layout and during transient reflow, where every rect reads 0.
  function railThreads() {
    var out = [];
    visible().forEach(function (t) {
      if (t.state === 'resolved') return;
      var el = findBlock(t.anchor);
      // Its block was deleted. Keep the thread on the page, pinned where the
      // block used to be, rather than letting it disappear — a comment matters
      // most when the thing it was about has just been removed.
      if (!el && isOrphan(t)) el = orphanHome(t);
      if (el) out.push({ t: t, el: el, seq: state.threads.indexOf(t) });
    });
    return out.sort(function (a, b) {
      // Within one block the EXPANDED thread sorts first, so its siblings are
      // the ones pushed down and it keeps the anchor line for itself.
      if (a.el === b.el) {
        var af = a.t.id === state.active ? 0 : 1, bf = b.t.id === state.active ? 0 : 1;
        return (af - bf) || (a.seq - b.seq);
      }
      var rel = a.el.compareDocumentPosition(b.el);
      if (rel & 4) return -1;  // DOCUMENT_POSITION_FOLLOWING — b comes after a
      if (rel & 2) return 1;   // DOCUMENT_POSITION_PRECEDING
      return a.seq - b.seq;
    });
  }

  // The rail and the drawer share the right gutter, so only one shows at a time;
  // and on a narrow window there is no gutter to spare, so the drawer is the
  // fallback. `hidden` (rather than a CSS-only rule) keeps the state inspectable
  // and lets the layout pass skip work while the rail is off.
  function railShouldShow() {
    if (els.sidebar && els.sidebar.classList.contains('open')) return false;
    // An open composer overrides the width rule: the composer lives in the rail,
    // so hiding the rail on a narrow window would leave you unable to comment at
    // all — invisible input, no keyboard path, and no way to create a thread
    // from the drawer. It overlays more of a narrow page; that beats a dead end.
    if (state.composeEl) return true;
    return (window.innerWidth || 0) >= RAIL_MIN_W;
  }
  function syncRailVisibility() {
    if (!els.rail) return;
    var show = railShouldShow();
    var was = !els.rail.hasAttribute('hidden');
    if (show) els.rail.removeAttribute('hidden');
    else els.rail.setAttribute('hidden', '');
    // Positions go stale while hidden (the layout pass skips it), so re-measure
    // on the way back — otherwise closing the drawer reveals bubbles and chips
    // sitting where the page used to be.
    if (show && !was) queueRail();
  }

  function renderRail() {
    if (!els.rail) return;
    syncRailVisibility();
    els.rail.innerHTML = '';
    var entries = railThreads();
    // The composer is a focused entry in the rail, ordered with the threads so
    // it takes its block's anchor line and pushes that block's threads down.
    if (state.composeEl) {
      var at = 0;
      for (; at < entries.length; at++) {
        if (entries[at].el === state.composeEl) break;
        var rel = entries[at].el.compareDocumentPosition(state.composeEl);
        if (rel & 2) break; // the composer's block precedes this entry's block
      }
      entries.splice(at, 0, { compose: true, el: state.composeEl });
    }
    entries.forEach(function (r) {
      if (r.compose) return els.rail.appendChild(composeBubble(r.el));
      els.rail.appendChild(r.t.id === state.active ? openBubble(r.t, r.el) : bubble(r.t, r.el));
    });
    // The rail is rebuilt from scratch, so any hover pairing was just thrown
    // away with the old nodes — while hoverEl still points at the same block, so
    // onHover's "same element, nothing to do" short-circuit would never restore
    // it. Re-apply it here, or commenting on the block you are hovering silently
    // drops the pairing until you move the pointer away and back.
    if (hoverEl) markBubbleFocus(hoverEl, true);
    positionRail();
  }

  // New-thread composer, in the rail, pinned to the block you clicked. Always a
  // NEW thread — that is what allows several per block.
  function composeBubble(el) {
    var b = create('div', { class: 'sf-bub sf-bub-open sf-bub-compose', 'data-focus': '1' });
    b._anchor = el;
    var anchor = { block: blockAnchor(el) };
    b.innerHTML = '<div class="sf-bub-head"><span class="sf-bub-who">H</span>' +
      '<span class="sf-bub-n">new thread</span>' +
      '<button class="sf-bub-x" type="button" aria-label="Cancel">×</button></div>' +
      '<div class="q">' + esc(anchor.block.text.slice(0, 160)) + '</div>';
    b.onclick = function (e) { e.stopPropagation(); };
    b.querySelector('.sf-bub-x').onclick = function (e) { e.stopPropagation(); cancelCompose(); };

    var ta = create('textarea', { class: 'sf-input', placeholder: 'Add a comment…', rows: '2' });
    var row = create('div', { class: 'sf-compose-foot' });
    var save = create('button', { class: 'sf-primary', type: 'button' }, 'Comment');
    function submit() {
      if (!ta.value.trim()) return;
      postJSON(API, { anchor: anchor, body: ta.value.trim(), author: 'human' })
        .then(function (r) {
          if (!r.ok) return flash('Could not add the comment.');
          state.composeEl = null;
          load();
        }).catch(function () { flash('Could not add the comment.'); });
    }
    save.onclick = function (e) { e.stopPropagation(); submit(); };
    row.appendChild(create('span', { class: 'sf-hint' }, MOD_HINT + ' to comment'));
    row.appendChild(save);
    b.appendChild(ta); b.appendChild(row);
    wireInput(ta, submit);
    setTimeout(function () { try { ta.focus(); } catch (e) {} }, 0);
    return b;
  }
  function openRailCompose(el) {
    state.active = null;      // a composer and an expanded thread are exclusive
    setSidebar(false);        // composing claims the gutter; the drawer would hide the rail
    state.composeEl = el;
    ensureAnchorVisible(el);
    render();
  }
  function cancelCompose() {
    if (!state.composeEl) return;
    state.composeEl = null;
    render();
  }

  // Collapsed bubble: who started the thread, a one-line snippet, and the reply
  // count. Initials (H/C) rather than icons — the product UI carries no emoji.
  function bubble(t, el) {
    var orphan = isOrphan(t);
    var b = create('button', { class: 'sf-bub' + (orphan ? ' sf-bub-orphan' : ''), type: 'button', 'data-tid': t.id });
    b._anchor = el; // the measured element, re-read every pass
    var first = t.comments[0] || {};
    var claude = first.author === 'claude';
    b.innerHTML = '<span class="sf-bub-who' + (claude ? ' claude' : '') + '">' + (claude ? 'C' : 'H') + '</span>' +
      '<span class="sf-bub-snip">' + esc(norm(first.body || '')) + '</span>' +
      (t.comments.length > 1 ? '<span class="sf-bub-n">' + (t.comments.length - 1) + '</span>' : '');
    b.onclick = function (e) { e.stopPropagation(); expandThread(t.id, el); };
    wireBubbleHover(b, el);
    return b;
  }

  // The expanded thread — the whole conversation, in place in the rail. Not a
  // <button> (it holds a textarea and its own buttons); the header carries the
  // close control so it stays keyboard-reachable.
  function openBubble(t, el) {
    var orphan = isOrphan(t);
    var b = create('div', { class: 'sf-bub sf-bub-open' + (orphan ? ' sf-bub-orphan' : ''), 'data-tid': t.id, 'data-focus': '1' });
    b._anchor = el;
    b.innerHTML = '<div class="sf-bub-head"><span class="sf-bub-who' +
      (t.comments[0] && t.comments[0].author === 'claude' ? ' claude' : '') + '">' +
      (t.comments[0] && t.comments[0].author === 'claude' ? 'C' : 'H') + '</span>' +
      '<span class="sf-badge ' + esc(t.state) + '">' + esc(t.state) + '</span>' +
      '<button class="sf-bub-x" type="button" aria-label="Collapse thread">×</button></div>' +
      t.comments.map(function (c) {
        return '<div class="sf-comment" data-cid="' + esc(c.id || '') + '"><span class="who ' +
          (c.author === 'claude' ? 'claude' : '') + '">' + esc(c.author) + '</span>' +
          '<div class="body">' + fmtBody(c.body) + '</div></div>';
      }).join('');
    b.onclick = function (e) { e.stopPropagation(); }; // using the card must not dismiss it
    b.querySelector('.sf-bub-x').onclick = function (e) { e.stopPropagation(); collapseThread(); };
    // Say plainly that the content is gone, above the thread, and keep the
    // original quote so the reader can see what it was about before deciding.
    if (orphan) {
      var quote = (t.anchor && t.anchor.block && t.anchor.block.text) || '';
      if (quote) b.insertBefore(create('div', { class: 'sf-orphan-quote' }, quote.slice(0, 160)), b.firstChild);
      b.insertBefore(create('div', { class: 'sf-orphan-note' },
        'The content this comment referred to was removed.'), b.firstChild);
    }

    var ta = create('textarea', { class: 'sf-input', placeholder: 'Reply…', rows: '2' });
    var row = create('div', { class: 'sf-compose-foot' });
    var send = create('button', { class: 'sf-primary', type: 'button' }, 'Reply');
    function submit() {
      if (!ta.value.trim()) return;
      postJSON(API + '/' + t.id + '/reply', { body: ta.value.trim(), author: 'human' }).then(load);
    }
    send.onclick = function (e) { e.stopPropagation(); submit(); };
    var res = create('button', { class: 'sf-bub-resolve', type: 'button' }, 'Resolve');
    // Only drop the expanded thread if the server actually resolved it — fetch
    // fulfills on 4xx/5xx too, so an unchecked .then() would collapse the card
    // as though it had worked and swallow the failure.
    res.onclick = function (e) {
      e.stopPropagation();
      postJSON(API + '/' + t.id + '/resolve').then(function (r) {
        if (!r.ok) return flash('Could not resolve the thread.');
        state.active = null;
        load();
      }).catch(function () { flash('Could not resolve the thread.'); });
    };
    row.appendChild(res); row.appendChild(send);
    b.appendChild(ta); b.appendChild(row);
    wireInput(ta, submit);
    wireBubbleHover(b, el);
    return b;
  }

  // Reciprocal focus: a bubble lights up the block it annotates, and hovering a
  // block lights up every bubble anchored to it (see onHover).
  function wireBubbleHover(b, el) {
    b.onmouseenter = function () {
      // Drop any highlight still held by a DIFFERENT block: moving the pointer
      // straight from block A into a bubble anchored to block B would otherwise
      // leave both lit, since the rail guard in onHover stops the usual clear.
      clearHover();
      if (el) el.classList.add('sf-hover');
      markBubbleFocus(el, true);
    };
    b.onmouseleave = function () {
      if (el) el.classList.remove('sf-hover');
      markBubbleFocus(el, false);
    };
  }
  function markBubbleFocus(el, on) {
    if (!els.rail || !el) return;
    Array.prototype.forEach.call(els.rail.children, function (b) {
      if (b._anchor === el) b.classList.toggle('sf-bub-focus', !!on);
    });
  }

  function expandThread(id, el) {
    state.active = id;
    state.composeEl = null; // exactly one focused card in the rail at a time —
                            // two would break the single-focus layout pass
    if (el) ensureAnchorVisible(el);
    render();
  }
  function collapseThread() {
    if (!state.active) return;
    state.active = null;
    render();
  }
  // A focused thread is pinned to EXACTLY its anchor, so if that anchor has
  // scrolled out of view the card would land off-screen. Bring the anchor back
  // into view first — the automatic-scrolling half of the anchor/card bond.
  function ensureAnchorVisible(el) {
    var r = el.getBoundingClientRect();
    var h = window.innerHeight || 0;
    if (!h || !el.scrollIntoView) return;
    // The top of the viewport is behind the fixed header, so "visible" starts
    // below it — otherwise an anchor tucked under the header counts as in view.
    var top = els.rail ? (els.rail.getBoundingClientRect().top || 0) : 0;
    if (r.top < top + 8 || r.top > h - 80) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Horizontal placement: the rail hugs the RIGHT EDGE OF THE CONTENT, not the
  // viewport. Pinned to the window it drifts far from the text it annotates
  // whenever the reading column is narrow, breaking the bubble/anchor bond.
  // When the content is wide enough that the gutter can't hold the rail, its
  // left is clamped so the rail stays fully on screen (overlapping the content
  // edge) rather than sliding off it. The rail's own CSS width stays the single
  // source of truth for how wide it is.
  var RAIL_MARGIN = 8;
  function positionRailX() {
    var right = 0;
    try { right = widthContainer().getBoundingClientRect().right || 0; } catch (e) {}
    // offsetWidth keeps the CSS as the source of truth for the rail's width; the
    // fallback is only for environments without layout (jsdom) and must match
    // the width in review.css.
    var railW = els.rail.offsetWidth || 272;
    var vw = window.innerWidth || 0;
    var left = right + RAIL_MARGIN;
    var maxLeft = vw - railW - RAIL_MARGIN;
    if (vw && left > maxLeft) left = maxLeft;
    if (left < RAIL_MARGIN) left = RAIL_MARGIN;
    els.rail.style.left = left + 'px';
    els.rail.style.right = 'auto';
  }

  function positionRail() {
    if (!els.rail) return;
    syncRailVisibility();
    if (els.rail.hasAttribute('hidden')) return; // nothing to measure while off
    positionRailX();
    var bubs = Array.prototype.filter.call(els.rail.children, function (b) {
      return b.classList.contains('sf-bub');
    });
    if (!bubs.length) { renderOffscreenChips(0, 0); return; }
    var vp = railViewport();
    var items = bubs.map(function (b) {
      return {
        top: (b._anchor ? b._anchor.getBoundingClientRect().top : 0) - vp.top,
        h: b.offsetHeight,
      };
    });
    var focusIdx = -1;
    bubs.forEach(function (b, i) { if (b.getAttribute('data-focus') === '1') focusIdx = i; });
    var tops = railLayout(items, focusIdx, RAIL_GAP, vp.height, RAIL_EDGE);
    var above = 0, below = 0;
    tops.forEach(function (top, i) {
      bubs[i].style.top = top + 'px';
      // Count what the reader can't see, measured on the ANCHOR (the bubble is
      // clamped, the anchor is the truth about where the comment lives).
      if (offscreenDir(items[i].top, vp) === 'above') above++;
      else if (offscreenDir(items[i].top, vp) === 'below') below++;
    });
    renderOffscreenChips(above, below);
  }

  // Bubbles live INSIDE the rail, which starts below the fixed header, so every
  // vertical question about them is asked in the rail's coordinate space — not
  // the viewport's. Counting and navigation both read this, so they cannot
  // drift apart and produce a chip that counts a thread it can't reach.
  // (Without layout, e.g. jsdom, top reads 0 and this is the viewport.)
  function railViewport() {
    var top = els.rail ? (els.rail.getBoundingClientRect().top || 0) : 0;
    return { top: top, height: (window.innerHeight || 0) - top };
  }
  /** @returns {'above'|'below'|null} where a rail-relative top sits, if off-screen */
  function offscreenDir(railTop, vp) {
    if (railTop < 0) return 'above';
    if (vp.height && railTop > vp.height) return 'below';
    return null;
  }

  // "N above / N below" — without these, a comment on scrolled-past content is
  // simply invisible. Clicking jumps to the nearest one in that direction.
  function renderOffscreenChips(above, below) {
    if (!els.rail) return;
    Array.prototype.forEach.call(els.rail.querySelectorAll('.sf-rail-chip'), function (c) { c.remove(); });
    if (above) els.rail.appendChild(chip('above', '↑ ' + above + ' above'));
    if (below) els.rail.appendChild(chip('below', '↓ ' + below + ' below'));
  }
  function chip(dir, label) {
    var c = create('button', { class: 'sf-rail-chip sf-rail-' + dir, type: 'button' }, label);
    c.onclick = function (e) {
      e.stopPropagation();
      // Navigate over exactly what the chips COUNT — the rail's own cards, in
      // the rail's coordinate space. Counting from one set (or one coordinate
      // space) and navigating in another strands whatever only the counter
      // knows about, e.g. an anchor hidden behind the fixed header.
      var vp = railViewport();
      var best = null, bestTop = 0;
      Array.prototype.forEach.call(els.rail.children, function (b) {
        if (!b._anchor) return; // the chips themselves
        var top = b._anchor.getBoundingClientRect().top - vp.top;
        if (offscreenDir(top, vp) !== dir) return;
        if (!best || Math.abs(top) < Math.abs(bestTop)) { best = b._anchor; bestTop = top; }
      });
      if (best && best.scrollIntoView) best.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    return c;
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


  function submitBatch() {
    postJSON(API + '/submit', {}).then(function (r) {
      if (r.ok) load();
      else flash('Batch submit activates in the review-loop stage.');
    }).catch(function () { flash('Could not submit batch.'); });
  }

  // ---------- activate ----------
  function activate(id, scroll) {
    state.active = id;
    state.composeEl = null; // same single-focus invariant as expandThread(): the
                            // drawer can activate a thread too, and a composer
                            // left open would be a second focused rail card
    renderSidebar();
    renderHighlights();
    renderRail();
    if (!scroll) return;
    // Resolve the block from the thread's own anchor rather than matching
    // data-sf-thread: a block may carry several threads and that attribute only
    // names the first, so an attribute lookup would silently skip the scroll for
    // every later thread on a shared block.
    var t = state.threads.filter(function (x) { return x.id === id; })[0];
    var el = t ? findBlock(t.anchor) : null;
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- utils ----------
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function inUI(t) {
    while (t) {
      if (t.id === 'sf-sidebar' || t.id === 'sf-compose' || t.id === 'sf-launcher' ||
          t.id === 'sf-menu' || t.id === 'sf-live' || t.id === 'sf-toc' || t.id === 'sf-top' ||
          t.id === 'sf-titlebar' || t.id === 'sf-rail' || t.id === 'sf-tocbtn') return true;
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
  // Render a comment body as a small, safe markdown subset. The text is
  // HTML-escaped FIRST, then emphasis/code/lists are layered onto the escaped
  // string — so no markup inside a body can ever reach the DOM (the escaped
  // entities carry none of the *_` markers this looks for). Intentionally tiny
  // (no links/headings/tables): review comments are short prose, not documents.
  // The raw source is what's stored + edited; this only affects display.
  function fmtInline(s) {
    // Split on inline-code spans so emphasis never rewrites inside `code`.
    return esc(s).split(/(`[^`]+`)/).map(function (part) {
      if (/^`[^`]+`$/.test(part)) return '<code>' + part.slice(1, -1) + '</code>';
      return part
        .replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>')       // **bold**
        .replace(/\*(\S(?:[^*\n]*\S)?)\*/g, '<em>$1</em>');        // *italic* (no inner-edge spaces)
    }).join('');
  }
  function fmtBody(raw) {
    var text = String(raw == null ? '' : raw).replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    if (!text.trim()) return '';
    var out = [], para = [], list = null; // list = { tag:'ul'|'ol', items:[] }
    function flushPara() { if (para.length) { out.push('<p>' + para.map(fmtInline).join('<br>') + '</p>'); para = []; } }
    function flushList() { if (list) { out.push('<' + list.tag + '>' + list.items.join('') + '</' + list.tag + '>'); list = null; } }
    text.split('\n').forEach(function (line) {
      var ul = /^\s*[-*]\s+(.*)$/.exec(line);
      var ol = /^\s*\d+\.\s+(.*)$/.exec(line);
      if (ul || ol) {
        flushPara();
        var tag = ul ? 'ul' : 'ol';
        if (!list || list.tag !== tag) { flushList(); list = { tag: tag, items: [] }; }
        list.items.push('<li>' + fmtInline((ul || ol)[1]) + '</li>');
      } else if (!line.trim()) {
        flushPara(); flushList(); // a blank line ends the current block
      } else {
        flushList();
        para.push(line);
      }
    });
    flushPara(); flushList();
    return out.join('');
  }
  function flash(msg) {
    var n = create('div', {}, msg);
    n.style.cssText = 'position:fixed;bottom:60px;right:16px;z-index:60;background:var(--sf-panel);border:1px solid var(--sf-line);color:var(--sf-ink);border-radius:8px;padding:10px 14px;font:13px system-ui';
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 3000);
  }
})();

/* Serve-time enhancement on EVERY served spec: the floating "Contents" TOC
 * (#sf-toc) pinned to the left, with the spec content centered (docs layout, via
 * html[data-sf-docs]). Built from the spec's own TOC links when it has one (else
 * its sections/headings); any native in-flow TOC is hidden and replaced. Each
 * top-level section nests the headings one level below its title (h2 -> h3) as a
 * collapsible subsection list, its open/closed state persisted per spec in
 * localStorage. A chevron (#sf-tocbtn) collapses/expands the whole rail —
 * persisted per spec (toc: shown|hidden) — and
 * it auto-collapses on windows too narrow to fit it beside the centered content,
 * until the reader makes an explicit choice. The on-disk file is untouched. */
(function () {
  'use strict';
  var SF = window.SPECFORGE || {};
  var PREFS = SF.prefs || {};
  var docEl = document.documentElement;
  var TOC_W = 240; // keep in sync with --sf-toc-w in review.css
  var auto = (PREFS.toc !== 'shown' && PREFS.toc !== 'hidden'); // no explicit choice yet
  var done = false;
  var reResolve = null; // set by spy() to its geometry-based active-link recompute
  document.addEventListener('DOMContentLoaded', init);
  if (document.readyState !== 'loading') init();
  function init() { if (done) return; done = true; ensureToc(); }

  // ---------- floating "Contents" TOC ----------
  function ensureToc() {
    var items = collect();
    if (items.length < 3) return; // too few sections to bother; leave the layout as-is
    // Enter docs mode: hide any native TOC + center the content (review.css).
    docEl.setAttribute('data-sf-docs', '');

    var collapsed = loadCollapsed();
    var panel = document.createElement('nav');
    panel.id = 'sf-toc'; panel.setAttribute('aria-label', 'Contents');
    panel.appendChild(mk('div', 'sf-toc-head', 'Contents'));
    var list = mk('div', 'sf-toc-list');
    items.forEach(function (it) {
      var kids = childrenOf(it.id); // the section's one-level-down headings
      if (!kids.length) { list.appendChild(topLink(it, 'sf-toc-top')); return; }
      list.appendChild(buildGroup(it, kids, collapsed[it.id] === true));
    });
    panel.appendChild(list);
    document.body.appendChild(panel);

    var btn = document.createElement('button');
    btn.id = 'sf-tocbtn'; btn.type = 'button';
    btn.onclick = function () {
      var next = docEl.getAttribute('data-sf-toc') === 'hidden' ? 'shown' : 'hidden';
      auto = false; PREFS.toc = next; apply(next); putToc(next); // explicit choice sticks
    };
    document.body.appendChild(btn);

    resolve();
    // Re-resolve once all resources (incl. review.css) have loaded, so the
    // initial auto decision can't be made against a not-yet-styled layout.
    window.addEventListener('load', function () { if (auto) resolve(); }, { once: true });
    window.addEventListener('resize', function () { if (auto) resolve(); }, { passive: true });
    // On a narrow window, tapping a TOC link should reveal the section, not leave
    // the overlay covering it.
    Array.prototype.forEach.call(panel.querySelectorAll('a'), function (a) {
      a.addEventListener('click', function () { if (auto && tooNarrow()) apply('hidden'); });
    });
    spy(panel);
  }
  // ---------- collapsible section subsections ----------
  // Each top-level section can carry the headings one level below its title
  // (h2 title -> h3 subsections) as a nested, collapsible list. The per-spec
  // collapse choice lives in localStorage so it survives the SSE live-reload
  // without a server round-trip. Sections with no such headings stay flat links.
  function mk(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function topLink(it, cls) {
    var a = mk('a', cls, it.text); a.setAttribute('href', '#' + it.id); return a;
  }
  function buildGroup(it, kids, startCollapsed) {
    var group = mk('div', 'sf-toc-group');
    if (startCollapsed) group.classList.add('sf-collapsed');
    var row = mk('div', 'sf-toc-row');
    var sub = mk('div', 'sf-toc-sub');
    var subIn = mk('div', 'sf-toc-sub-in');
    kids.forEach(function (k) { subIn.appendChild(topLink(k, 'sf-toc-child')); });
    sub.appendChild(subIn);
    sub.inert = !!startCollapsed; // out of the tab order + a11y tree while collapsed
    var tw = mk('button', 'sf-toc-tw');
    tw.type = 'button';
    tw.setAttribute('aria-expanded', startCollapsed ? 'false' : 'true');
    tw.setAttribute('aria-label', 'Toggle ' + it.text);
    tw.addEventListener('click', function (e) {
      e.stopPropagation();
      var nowCollapsed = !group.classList.contains('sf-collapsed');
      group.classList.toggle('sf-collapsed', nowCollapsed);
      tw.setAttribute('aria-expanded', nowCollapsed ? 'false' : 'true');
      sub.inert = nowCollapsed; // immediate — never deferred through the animation
      saveCollapsed(it.id, nowCollapsed);
      if (reResolve) reResolve(); // re-derive the active link so it never sits on a hidden child
    });
    row.appendChild(topLink(it, 'sf-toc-top'));
    row.appendChild(tw); // absolutely placed in the shared left gutter (review.css)
    group.appendChild(row); group.appendChild(sub);
    return group;
  }
  // A section's subsections = the headings one level below its title, skipping
  // any that live inside a NESTED section (those belong to that section).
  function childrenOf(sectionId) {
    var el = document.getElementById(sectionId);
    if (!el || el.tagName !== 'SECTION') return [];
    var title = el.querySelector('h1,h2,h3,h4,h5,h6');
    if (!title) return [];
    var want = hlevel(title) + 1;
    if (want > 6) return [];
    var out = [], seen = {};
    Array.prototype.forEach.call(el.querySelectorAll('h' + want), function (h) {
      if (h.closest('section') !== el) return; // owned by a nested section
      var id = h.id;
      if (!id) { id = uniqueId(slug(txt(h)) || 'sub', seen); h.id = id; }
      seen[id] = 1; out.push({ id: id, text: txt(h) });
    });
    return out;
  }
  function hlevel(h) { return parseInt(String(h.tagName).charAt(1), 10) || 6; }
  function uniqueId(base, seen) {
    var id = base, i = 2;
    while (seen[id] || document.getElementById(id)) { id = base + '-' + i++; }
    return id;
  }
  function ckey() { return 'sf:toc-collapsed:' + (SF.specId || 'anon'); }
  function loadCollapsed() {
    try {
      var raw = window.localStorage.getItem(ckey());
      var arr = raw ? JSON.parse(raw) : [];
      var m = {};
      if (Array.isArray(arr)) arr.forEach(function (id) { m[id] = true; });
      return m;
    } catch (e) { return {}; }
  }
  function saveCollapsed(id, collapsed) {
    try {
      var m = loadCollapsed();
      if (collapsed) m[id] = true; else delete m[id];
      window.localStorage.setItem(ckey(), JSON.stringify(Object.keys(m)));
    } catch (e) {}
  }
  // The centered content column's width, from --maxw (the width slider's value)
  // or the 820px reading default in review.css — NOT a getBoundingClientRect
  // read, which would race the stylesheet at init and mis-measure a full-width
  // .layout. Fit mode (--maxw:100%) means full width → treat as the viewport.
  function contentWidth() {
    var raw = getComputedStyle(docEl).getPropertyValue('--maxw').trim();
    if (raw.indexOf('%') !== -1) return window.innerWidth; // fit-to-width
    var mw = parseInt(raw, 10);
    return Math.min((mw > 0 ? mw : 820), window.innerWidth);
  }
  // Auto-collapse when the TOC can't sit beside the centered content without
  // overlapping it: content is centered, so its left edge is (vw - cw)/2 — that
  // must clear the TOC (width TOC_W) plus a small gap. Uses the content width, so
  // a slider-widened (or fit) column collapses the TOC sooner.
  function tooNarrow() { return window.innerWidth < contentWidth() + 2 * TOC_W + 24; }
  // Show/hide by the user's explicit pref, or (in auto mode) by the geometry.
  function resolve() {
    if (auto) apply(tooNarrow() ? 'hidden' : 'shown');
    else apply(PREFS.toc === 'hidden' ? 'hidden' : 'shown');
  }
  function apply(state) {
    if (state === 'hidden') docEl.setAttribute('data-sf-toc', 'hidden');
    else docEl.removeAttribute('data-sf-toc');
    var btn = document.getElementById('sf-tocbtn');
    if (btn) {
      btn.textContent = state === 'hidden' ? '›' : '‹'; // › expand / ‹ collapse
      btn.setAttribute('aria-label', state === 'hidden' ? 'Show contents' : 'Hide contents');
      btn.setAttribute('title', state === 'hidden' ? 'Show contents' : 'Hide contents');
    }
  }
  function putToc(state) {
    if (!SF.specId) return;
    try {
      fetch('/api/spec/' + encodeURIComponent(SF.specId) + '/prefs', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ toc: state }),
      }).catch(function () {});
    } catch (e) {}
  }
  function collect() {
    // Prefer the spec's own TOC links (curated labels) when it has a TOC.
    var native = document.querySelector('nav.toc, .side-toc');
    if (native) {
      var out = [];
      Array.prototype.forEach.call(native.querySelectorAll('a[href^="#"]'), function (a) {
        var id = a.getAttribute('href').slice(1);
        if (id && document.getElementById(id)) out.push({ id: id, text: txt(a) });
      });
      if (out.length >= 2) return dropNested(out);
    }
    var byId = [], seen = {};
    var secs = document.querySelectorAll('section[id]');
    if (secs.length >= 3) {
      Array.prototype.forEach.call(secs, function (s) {
        var h = s.querySelector('h1,h2,h3'); if (h) byId.push({ id: s.id, text: txt(h) });
      });
      return byId;
    }
    Array.prototype.forEach.call(document.querySelectorAll('h2,h3'), function (h) {
      var id = h.id;
      if (!id) { id = slug(txt(h)) || 'sec'; if (seen[id]) id = id + '-' + byId.length; h.id = id; }
      seen[id] = 1; byId.push({ id: id, text: txt(h) });
    });
    return byId;
  }
  // A spec's own TOC often lists a section's subsections as flat siblings of the
  // section itself. The rail nests those subsections under their parent group
  // (childrenOf), so keeping the flat link too renders them twice. Drop a link
  // only when its target is exactly the heading the parent group will nest —
  // anything deeper (an h4 under an h2) has no group to live in, so it stays.
  function dropNested(items) {
    var listed = {};
    items.forEach(function (it) { listed[it.id] = 1; });
    return items.filter(function (it) {
      var el = document.getElementById(it.id);
      if (!el || el.tagName === 'SECTION' || !/^H[1-6]$/.test(el.tagName)) return true;
      // Owner = the IMMEDIATE enclosing section (id or not), matching childrenOf's
      // nesting rule exactly. A heading inside an id-less nested section has no
      // group to be recreated in, so its curated link must survive — don't drop it
      // against the outer listed section (which childrenOf would never nest it under).
      var owner = el.closest('section');
      if (!owner || !owner.id || owner.id === it.id || !listed[owner.id]) return true;
      var ownerTitle = owner.querySelector('h1,h2,h3,h4,h5,h6');
      return !ownerTitle || hlevel(el) !== hlevel(ownerTitle) + 1;
    });
  }
  // Scroll-spy over every anchor's target (top-level sections AND nested
  // subsection headings). The observer only signals "something crossed the
  // band"; the active link is (re)derived from geometry, so it is independent
  // of intersection-callback delivery order (which does not encode heading
  // depth). The winner is the last heading scrolled above a line ~20% down the
  // viewport. A collapsed subsection's link is clipped/removed from the a11y
  // tree, so its active state is promoted to the visible parent section link.
  function spy(panel) {
    if (!('IntersectionObserver' in window)) return;
    var anchors = panel.querySelectorAll('a');
    var links = {}, targets = [];
    Array.prototype.forEach.call(anchors, function (a) {
      var id = a.getAttribute('href').slice(1);
      links[id] = a;
      var el = document.getElementById(id);
      if (el) targets.push({ id: id, el: el });
    });
    function activeAnchor(id) {
      var a = links[id];
      if (!a) return null;
      if (a.classList.contains('sf-toc-child')) {
        var g = a.closest('.sf-toc-group');
        if (g && g.classList.contains('sf-collapsed')) return g.querySelector('.sf-toc-top') || a;
      }
      return a;
    }
    function update() {
      var line = window.innerHeight * 0.2; // matches the -80% bottom rootMargin
      var best = null, first = null;
      targets.forEach(function (t) {
        var top = t.el.getBoundingClientRect().top;
        if (!first || top < first.top) first = { id: t.id, top: top };
        if (top <= line + 1 && (!best || top > best.top)) best = { id: t.id, top: top };
      });
      var pick = best || first; // nothing passed yet -> highlight the first
      var want = pick ? activeAnchor(pick.id) : null;
      Array.prototype.forEach.call(anchors, function (l) { l.classList.remove('active'); });
      if (want) want.classList.add('active');
    }
    var obs = new IntersectionObserver(update, { rootMargin: '-12% 0px -80% 0px', threshold: 0 });
    targets.forEach(function (t) { obs.observe(t.el); });
    reResolve = update; // let the disclosure toggles re-derive the active link
  }
  function txt(h) { return String(h.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80); }
  function slug(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40); }
})();
