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
  // A publication serves one spec, so its API carries no id. The listener that
  // answered tells us which shape to use rather than the client guessing.
  var SPEC_API = (window.SPECFORGE || {}).api || '/api/spec/' + encodeURIComponent(SPEC);
  var API = SPEC_API + '/comments';

  // UI prefs, embedded at serve time by inject.mjs. Source of truth is the store
  // (origin/port-independent — survives a daemon port change, unlike localStorage),
  // so a change PUTs back and updates this in place.
  //
  // theme + font are STORE-WIDE (apply to every spec) → PUT /api/prefs.
  // width / filter / fit / toc are per-spec → PUT /api/spec/<id>/prefs.
  // Who wrote a comment is `kind`; `author` is a free display name. Comments
  // stored before the split carry no kind, so fall back to the one name the
  // agent used to write under. Never compare an author to 'human': with several
  // people on a spec, every name is a human name.
  function isAgentComment(c) {
    if (!c) return false;
    if (c.kind === 'agent' || c.kind === 'human') return c.kind === 'agent';
    return c.author === 'claude';
  }

  /** The letter on a bubble: the agent's C, else the author's own initial. */
  function initialOf(c) {
    if (isAgentComment(c)) return 'C';
    var m = /[a-z0-9]/i.exec((c && c.author) || '');
    return m ? m[0].toUpperCase() : 'H';
  }

  // Addressing, mirroring lib/mentions.mjs. A comment is agent work when it
  // says @agent outside code; anything else is discussion between people and
  // never enters a batch. Kept in step with the server rule: if these disagree,
  // the page offers a submit that submits nothing.
  function mentionsAgentBody(body) {
    var prose = String(body == null ? '' : body)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/`[^`\n]*`/g, ' ');
    return /@agent(?![a-z0-9_-])/i.test(prose);
  }

  /**
   * True when some human in this thread addressed the agent.
   *
   * This decides what a submit would send, so it is about the mention and
   * nothing else. Kept in step with isForAgent in lib/comments.mjs: if the two
   * disagree the page offers a submit that submits nothing.
   */
  function isForAgentThread(t) {
    return !!(t && t.comments || []).length
      && t.comments.some(function (c) {
        // Unsent only: a mention that was already delivered is history, and
        // counting it would make every later remark in that thread agent work.
        return !isAgentComment(c) && !c.batchId && mentionsAgentBody(c.body);
      });
  }

  /**
   * True when this thread is in the agent's loop: addressed to it, or already
   * sent at some point.
   *
   * A different question from isForAgentThread, and the one the lifecycle CTA
   * asks. The already-sent half keeps specs written before mentions existed
   * working, since every comment on them was agent work by construction and
   * carries no @agent. It deliberately does not make a later human-only remark
   * in that thread submittable.
   */
  function inAgentLoop(t) {
    return isForAgentThread(t)
      || !!(t && t.comments || []).length && t.comments.some(function (c) { return !!c.batchId; });
  }

  // How you read a spec is yours, not the spec's.
  //
  // Theme, font, width, fit, TOC and comment filter used to be server state, so
  // one reader switching to dark changed it for everyone who opened the spec,
  // and theme and font changed it on every spec. Once a spec can be published
  // that is a stranger reaching into the owner's settings, so these live in the
  // browser instead.
  //
  // The server values are still read once, as the starting point for a browser
  // that has none. Nothing writes them back.
  var GLOBAL_PREF_KEYS = { theme: 1, font: 1, mono: 1 };
  var GLOBAL_STORE_KEY = 'sf-prefs';          // theme + font + mono: every spec
  var SPEC_STORE_KEY = 'sf-prefs:' + SPEC;    // width, fit, toc, filter: this spec

  function readLocal(key) {
    try {
      var raw = window.localStorage.getItem(key);
      var v = raw ? JSON.parse(raw) : null;
      return v && typeof v === 'object' ? v : null;
    } catch (e) {
      return null; // storage blocked or corrupt: fall back to the server seed
    }
  }
  function writeLocal(key, obj) {
    try { window.localStorage.setItem(key, JSON.stringify(obj)); } catch (e) { /* not fatal */ }
  }

  var LOCAL_GLOBAL = readLocal(GLOBAL_STORE_KEY) || {};
  var LOCAL_SPEC = readLocal(SPEC_STORE_KEY) || {};
  var PREFS = (function () {
    var seed = (window.SPECFORGE || {}).prefs || {};
    var out = {};
    var k;
    for (k in seed) if (Object.prototype.hasOwnProperty.call(seed, k)) out[k] = seed[k];
    for (k in LOCAL_GLOBAL) if (Object.prototype.hasOwnProperty.call(LOCAL_GLOBAL, k)) out[k] = LOCAL_GLOBAL[k];
    for (k in LOCAL_SPEC) if (Object.prototype.hasOwnProperty.call(LOCAL_SPEC, k)) out[k] = LOCAL_SPEC[k];
    return out;
  })();

  function putPref(patch) {
    var global = false, spec = false;
    for (var k in patch) {
      if (!Object.prototype.hasOwnProperty.call(patch, k)) continue;
      PREFS[k] = patch[k];
      // Strict === against the sentinel so an inherited key (constructor,
      // toString) can never be misread as a global pref.
      if (GLOBAL_PREF_KEYS[k] === 1) { LOCAL_GLOBAL[k] = patch[k]; global = true; }
      else { LOCAL_SPEC[k] = patch[k]; spec = true; }
    }
    if (global) writeLocal(GLOBAL_STORE_KEY, LOCAL_GLOBAL);
    if (spec) writeLocal(SPEC_STORE_KEY, LOCAL_SPEC);
  }

  // Elements that can carry a comment. The innermost match under the pointer wins.
  //
  // The component library's block components are appended from the injected
  // config rather than listed here. The lint tells an author a block component is
  // commentable; if this list did not follow, that would be a promise the page
  // could not keep, and text inside a .diff or a .flow would be uncommentable
  // while the lint reported it as fine.
  var BLOCK_SEL = 'h1,h2,h3,h4,h5,h6,p,li,tr,td,th,pre,blockquote,figure,.panel,.callout,.card,.stat,.loop .step,.matrix .q,.bar,.ns'
    + ((window.SPECFORGE || {}).blocks || []).map(function (c) { return ',.' + c; }).join('');
  var INTERACTIVE = 'a,button,input,textarea,select,summary,label';

  var INIT_FILTER = (PREFS.filter === 'resolved' || PREFS.filter === 'all') ? PREFS.filter : 'open';
  // composeEl: the block a new-thread composer is currently open on (rail), or null.
  var state = {
    threads: [], filter: INIT_FILTER, active: null, meta: null, composeEl: null,
    // What the composer's textarea starts with. Only ever set by the context
    // menu, and only for one composer.
    composeSeed: '',
  };
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
  // Two axes, because they answer two questions. A reading font is what prose
  // looks like; a monospace face is what code looks like. Picking JetBrains Mono
  // used to set the whole document in it, which is the one thing nobody choosing
  // a code font is asking for.
  var FONT_CATS = ['sans', 'serif', 'presentation'];
  function fontById(id) { return FONTS.filter(function (f) { return f.id === id; })[0] || null; }
  function isMono(id) { var f = fontById(id); return !!f && f.cat === 'mono'; }
  function initFont() {
    return (fontById(PREFS.font) && !isMono(PREFS.font)) ? PREFS.font : 'default';
  }
  // A pref saved before the split named a mono in the reading-font slot. Read it
  // as what it always meant: that face, for code.
  //
  // A stored 'default' is a choice, not an absence. Without that first test, an
  // upgraded reader who picks Default gets the legacy value migrated over their
  // pick on the next load, and the old face comes back every time.
  function initMono() {
    if (PREFS.mono === 'default' || isMono(PREFS.mono)) return PREFS.mono;
    return isMono(PREFS.font) ? PREFS.font : 'default';
  }

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
  var SUBMIT_HINT = IS_MAC ? '⌘S' : 'Ctrl+S';

  // Initialized here (not at the theme section below) because boot() runs on the
  // readyState check above — before that section's top-level code executes — and
  // applyTheme() reads this; a mid-file init would leave it `undefined` on boot.
  var _themeSupported = null;

  // The name this browser writes under. Null until it has one, which the server
  // reads as the pre-authors default. Every write sends the same value, so the
  // name on a comment is the name that can edit it: create, reply and edit must
  // agree or a comment becomes uneditable by the browser that wrote it.
  //
  // Up here for the same reason as _themeSupported: review.js is deferred, so
  // readyState is never 'loading' and boot() runs at the check below. A var
  // assigned further down is still `undefined` at that point, and the lookup
  // would silently miss and re-ask a reader who already has a name.
  var AUTHOR_KEY = 'sf-author';
  // The name is held here first and persisted second. Storage can be blocked
  // (private windows, third-party-storage settings), and a name that only lived
  // there would be silently dropped: the dialog would close, the reviewer would
  // believe they were named, and every comment they wrote would be attributed to
  // nobody. In memory it at least holds for the session.
  var _me = null;

  // A deck's slides, and how far inside one its comments sit. Up here for the
  // same reason as the two above: boot() runs at the readyState check below, and
  // watchSlides() reads SLIDE_SEL from there. Declared mid-file it is still
  // `undefined` at that point, querySelectorAll("undefined") matches nothing, and
  // the deck is silently treated as an ordinary scrolling spec — so the rail
  // never re-renders when a slide changes.
  var SLIDE_SEL = 'main > section[data-sf-section]';
  var DECK_INSET = 16;

  // The vendored highlighter's path. Up here for the same reason as the three
  // above: initHighlight() runs from boot(), at the readyState check below, and
  // declared beside its own section it is still `undefined` there — which appends
  // <script src="undefined">, a 404, and no highlighting, silently.
  var HIGHLIGHT_SRC = '/public/prism.js';
  // The vendored diagram renderer, up here for exactly the same reason.
  var MERMAID_SRC = '/public/mermaid.js';
  // A ceiling on the source one diagram may carry. Mermaid's own default is
  // 50000; this is lower because a published spec is read by strangers and an
  // imported one carries untrusted markdown, and no diagram legible at a spec's
  // column width comes close to this.
  var MERMAID_MAX_TEXT = 20000;
  // How long to wait for the renderer before giving up on it. The comment rail
  // loads behind this, so a request that neither completes nor fails would
  // otherwise leave a spec with no comments at all rather than with no diagram.
  // Generous, because the bundle is about a megabyte over a tunnel.
  var MERMAID_LOAD_TIMEOUT = 15000;

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
    applyFont(initFont()); // reading font — persisted choice (or the spec's own) on load
    applyMono(initMono()); // the monospace face, which is a separate choice
    initHighlight();       // and colour the code blocks whose author named a language
    buildChrome();
    // Diagrams before the reconcile, never beside it. Rendering replaces a
    // block's contents, and the reconcile identifies a block by its text, so
    // running them concurrently would record whichever answer won the race.
    // Resolves immediately when the spec declares no diagram, which is every
    // spec written before this existed.
    initMermaid(function (settled) {
      // Establish block identity before the first render, so comments resolve by
      // id rather than by guessing at content. Non-blocking on failure.
      syncBlocks(load, settled);
    });
    // Poll so Claude's replies appear without a manual refresh; pause while the
    // composer is open so we don't disrupt the user mid-comment.
    // Pause the poll while a composer is open so a reload can't wipe what the
    // reader is typing.
    setInterval(function () { if (!state.composeEl) load(); }, 6000);
    // Only on a published copy. The owner's own browser is not a stranger who
    // needs telling how comments work, and asking them to name themselves on a
    // spec they wrote would be noise.
    if ((window.SPECFORGE || {}).transport === 'poll' && !meAuthor()) openWelcome();
  }

  // Shown once per browser on a published spec: who you are, and how the two
  // kinds of comment differ. The name is the label on everything you write, so
  // it is asked for before the first comment rather than after it.
  function openWelcome() {
    var wrap = create('div', { id: 'sf-welcome', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Introduce yourself' });
    wrap.innerHTML =
      '<div class="sf-welcome-card">' +
      '<h2>Reviewing this spec</h2>' +
      '<p>Click any paragraph, table row or heading to comment on it. Your comments appear beside the text and the author sees them live.</p>' +
      '<p>A comment is a <b>discussion</b> with the other people reading. To ask the AI agent to change the spec, write <code>@agent</code> in it, then press Submit.</p>' +
      // Each published spec gets its own tunnel hostname, which is the same
      // property that keeps one publication from reaching another: separate
      // origins, so separate browser storage. Saying so costs a line and stops
      // the second link looking like a bug.
      '<label for="sf-welcome-name">Your name <span class="sf-welcome-hint">asked once for this link</span></label>' +
      '<input id="sf-welcome-name" type="text" autocomplete="name" maxlength="40" placeholder="e.g. Lavee">' +
      '<div class="sf-welcome-err" hidden></div>' +
      '<button type="button" class="sf-primary sf-welcome-go">Start reviewing</button>' +
      '</div>';
    document.body.appendChild(wrap);
    var input = wrap.querySelector('#sf-welcome-name');
    var err = wrap.querySelector('.sf-welcome-err');
    var go = wrap.querySelector('.sf-welcome-go');
    function fail(msg) { err.textContent = msg; err.removeAttribute('hidden'); }
    function submit() {
      var v = (input.value || '').trim();
      if (!v) return fail('Please enter a name so your comments are attributed.');
      // `agent` would make an @agent mention ambiguous; the server refuses it
      // too, and finding that out after writing a comment would be worse.
      if (/^(agent|claude)$/i.test(v)) return fail('That name is reserved. Please use your own.');
      setMeAuthor(v);
      wrap.remove();
    }
    go.onclick = submit;
    input.onkeydown = function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } };
    try { input.focus(); } catch (e) { /* jsdom */ }
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
  // under every reading font; which monospace is applyMono's business.
  function applyFont(id) {
    var c = widthContainer();
    var f = fontById(id);
    if (!f || f.cat === 'mono') { // 'default' / unknown / a code font → no override, no fetch
      c.removeAttribute('data-sf-font');
      c.style.removeProperty('--sf-reading-font');
      return;
    }
    loadGoogleFont(f);
    // data-sf-font carries the CATEGORY (sans/serif/presentation) — review.css keys
    // the code exemption off its presence; the family is the inline --sf-reading-font.
    c.setAttribute('data-sf-font', f.cat);
    c.style.setProperty('--sf-reading-font', f.stack);
  }

  /**
   * The monospace face, wherever the document uses one.
   *
   * Sets --mono, the canonical palette token every spec already writes its code
   * and pre rules against, so the pick reaches .kw, .diff, .codeblock's filename
   * and a deck's slide numbers without review.css naming any of them. The
   * attribute is for the specs that hardcoded a stack instead of the token; the
   * rule keyed on it puts them back on --mono.
   */
  function applyMono(id) {
    var c = widthContainer();
    var f = isMono(id) ? fontById(id) : null;
    if (!f) {
      c.removeAttribute('data-sf-mono');
      c.style.removeProperty('--mono');
      return;
    }
    loadGoogleFont(f);
    c.setAttribute('data-sf-mono', f.id);
    c.style.setProperty('--mono', f.stack);
  }

  // ---------- syntax highlighting (review-layer owned) ----------
  //
  // Declared, never detected. Measured across the 117 specs in the store: 0 of
  // 133 code blocks name a language, and about half of them are not a language
  // at all — ASCII data-flow diagrams, pseudo-code carrying prose annotations,
  // structural sketches that look like JSON and are not. Guessing would colour a
  // box-drawing diagram as if it were code, and a wrong highlight reads worse
  // than none, so a block is highlighted when its author says what it is.
  //
  // An author may write the language where it falls naturally: `data-lang` on the
  // block, the pre or the code, or Prism's own `class="language-x"`. They all end
  // up as that class on the element Prism reads.
  //
  // HIGHLIGHT_SRC is declared with the other boot-time constants near the top,
  // not here: boot() runs before this line would execute.

  /** The element to highlight and the language it declares, or null. */
  function declaredLang(pre) {
    var code = pre.querySelector('code') || pre;
    var from = [code, pre, pre.parentNode];
    for (var i = 0; i < from.length; i++) {
      var el = from[i];
      if (!el || !el.getAttribute) continue;
      var attr = el.getAttribute('data-lang');
      if (attr) return { el: code, lang: attr.toLowerCase() };
      var m = /(?:^|\s)lang(?:uage)?-([\w+#-]+)/.exec(el.className || '');
      if (m) return { el: code, lang: m[1].toLowerCase() };
    }
    return null;
  }

  /** Every code block whose author declared a language. */
  function declaredBlocks() {
    var out = [];
    var pres = document.querySelectorAll('pre');
    for (var i = 0; i < pres.length; i++) {
      // The review chrome writes no code blocks; this is belt and braces for a
      // spec that nests one inside a comment rail's markup.
      if (pres[i].closest && pres[i].closest('#sf-sidebar,#sf-menu,#sf-compose')) continue;
      var d = declaredLang(pres[i]);
      if (d) out.push(d);
    }
    return out;
  }

  /**
   * Put the DECIDED language on the element Prism reads, replacing any other.
   *
   * This used to append only when no `language-` class was present, which meant
   * markup declaring two things (`<code data-lang="yaml" class="language-sql">`)
   * was decided as yaml by declaredLang and then highlighted as sql, because the
   * stale class was left in place. Deciding one language and applying another is
   * a bug however rare the markup, and the markdown exporter reads the same
   * precedence, so the two would have disagreed about the same block.
   *
   * Stripping `lang-` too normalises what import-md writes, which review.css
   * keys on as `[class*="language-"]`.
   */
  function applyLang(el, lang) {
    var cls = String(el.className || '').replace(/(?:^|\s)lang(?:uage)?-[\w+#-]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
    el.className = (cls ? cls + ' ' : '') + 'language-' + lang;
  }

  function highlightAll(blocks) {
    if (!window.Prism || !window.Prism.languages) return;
    blocks.forEach(function (b) {
      // No grammar means the vendored build does not carry that language. Leaving
      // it as plain text is the honest outcome; Prism would otherwise emit one
      // undifferentiated token and the block would look highlighted and not be.
      if (!window.Prism.languages[b.lang]) return;
      applyLang(b.el, b.lang);
      try { window.Prism.highlightElement(b.el); } catch (e) { /* a bad grammar is not a broken page */ }
    });
  }

  /**
   * Load the highlighter, once, and only for a spec that has something to
   * highlight. A spec of prose and diagrams fetches nothing, which is the same
   * bargain the reading fonts make.
   */
  function initHighlight() {
    var blocks = declaredBlocks();
    if (!blocks.length) return;
    // The class has to land before Prism runs, so the markup is normalised first
    // and the highlight follows whenever the script is ready.
    blocks.forEach(function (b) { applyLang(b.el, b.lang); });
    if (window.Prism) { highlightAll(blocks); return; }
    var s = document.createElement('script');
    s.src = HIGHLIGHT_SRC;
    s.async = true;
    s.onload = function () { highlightAll(blocks); };
    document.head.appendChild(s);
  }

  // ---------- diagrams (review-layer owned) ----------
  //
  // A mermaid diagram is a code block whose declared language is `mermaid`, so
  // everything above already applies to it: declaredLang() finds it, and Prism
  // skips it because the vendored build carries no grammar by that name.
  //
  // Rendering replaces the block's children with an SVG, which changes the text
  // the block reconcile identifies that block by. Two states are therefore not
  // the same failure, and only one of them is safe to remember:
  //
  //   rendered            text is the node labels     deterministic given the source
  //   source will not parse   text is the error       deterministic given the source
  //   renderer unreachable    text is the source      depends on the network
  //
  // The last is the one that must never reach blocks.json, because writing it
  // would retire every diagram's block id and orphan the threads on them. That is
  // what `settled` carries to syncBlocks.

  /**
   * The font the document is actually set in, as a family string.
   *
   * Diagrams are pinned to it at render time rather than inheriting it. A
   * rendered diagram is a measured artefact: its boxes were sized around text in
   * a particular font, so if the reader later picks a different reading font the
   * diagram must keep the one it was drawn with. Inheriting would resize the
   * glyphs inside boxes that cannot resize with them.
   */
  function readingFont() {
    try {
      var el = widthContainer() || document.body;
      var f = window.getComputedStyle(el).fontFamily;
      if (f) return f;
    } catch (e) { /* fall through */ }
    return '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  }

  /** Every block whose author declared the mermaid language. */
  function mermaidBlocks() {
    var out = [];
    var pres = document.querySelectorAll('pre');
    for (var i = 0; i < pres.length; i++) {
      if (pres[i].closest && pres[i].closest('#sf-sidebar,#sf-menu,#sf-rail')) continue;
      var d = declaredLang(pres[i]);
      if (d && d.lang === 'mermaid') out.push(pres[i]);
    }
    return out;
  }

  /**
   * Replace a block with the reason it did not render.
   *
   * The source is removed rather than kept beside the error: a reader cannot act
   * on mermaid source, and the author who can is looking at the file. Keeping
   * both would also leave the block's text carrying the source, which is the one
   * text that must not be remembered.
   */
  /**
   * Move a rendered diagram's stylesheet out of the block.
   *
   * Mermaid injects its CSS as a <style> element INSIDE the SVG. Left there it
   * is part of the block's textContent, and textContent is what the block
   * registry hashes and what the comment rail quotes: a thread on a diagram
   * would be identified by a kilobyte of generated CSS, would re-identify as a
   * different block on any mermaid upgrade, and would quote `#sf-mmd-0{font-
   * family:inherit...}` back at the reader.
   *
   * The rules are id-scoped, so they apply identically from <head>. Moving is
   * preferred to deleting because some of them are layout, not colour.
   */
  function hoistDiagramStyle(pre, id) {
    var styles = pre.querySelectorAll('style');
    for (var i = 0; i < styles.length; i++) {
      styles[i].setAttribute('data-sf-mermaid-style', id);
      document.head.appendChild(styles[i]);
    }
  }

  function showMermaidError(pre, err) {
    var msg = String((err && err.message) || err || 'could not render');
    pre.textContent = '';
    pre.setAttribute('data-sf-mermaid', 'error');
    var box = document.createElement('div');
    box.className = 'sf-mermaid-err';
    box.textContent = 'Diagram error: ' + msg.split('\n')[0].slice(0, 300);
    pre.appendChild(box);
  }

  /**
   * Render every declared diagram, then report whether the page settled.
   *
   * @param {(settled:boolean) => void} done `false` only when the renderer never
   *   arrived. A diagram that fails to parse is a settled outcome: the same
   *   source fails the same way on every load.
   */
  function initMermaid(done) {
    var blocks = mermaidBlocks();
    // The common case, and every spec that predates this: nothing declared, so
    // nothing is fetched and boot is exactly as it was.
    if (!blocks.length) return done(true);

    // Exactly once. Everything below this point has more than one way to finish
    // (loaded, failed, timed out, and one settlement per diagram), and calling
    // back twice would run the reconcile twice against the same page.
    var finished = false;
    function settle(ok) {
      if (finished) return;
      finished = true;
      done(ok);
    }

    function render() {
      var m = window.mermaid;
      if (!m || typeof m.render !== 'function') return settle(false);
      try {
        m.initialize({
          startOnLoad: false,
          securityLevel: 'strict',   // no click directives, label HTML sanitised
          theme: 'base',             // review.css repaints it from the palette
          maxTextSize: MERMAID_MAX_TEXT,
          // The REAL family, resolved from the page, not the keyword `inherit`.
          // Mermaid measures each label to size the box around it, and it
          // measures in whatever font this names. Passing `inherit` measured in
          // a fallback and painted in the spec's reading font, so every label
          // was sized for one font and drawn in another: "collector" rendered as
          // "collecto" inside its box.
          fontFamily: readingFont(),
        });
      } catch (e) {
        return settle(false);
      }

      var pending = blocks.length;
      var after = function () { if (--pending === 0) settle(true); };

      blocks.forEach(function (pre, i) {
        var src = pre.textContent;
        var id = 'sf-mmd-' + i;
        var finish = function () {
          // Mermaid measures in a temporary element and leaves it behind when a
          // render throws. Unremoved it is a stray block on the page and another
          // entry the reconcile has to account for. Cleaned up even after the
          // page has settled, because removing a stray is never the wrong move.
          var junk = document.getElementById('d' + id);
          if (junk && junk.parentNode) junk.parentNode.removeChild(junk);
          after();
        };
        var fail = function (err) {
          if (!finished) showMermaidError(pre, err);
          finish();
        };
        try {
          m.render(id, src).then(function (r) {
            // The page may have settled without this one: a render slower than
            // MERMAID_LOAD_TIMEOUT lets the reconcile run against the source
            // text, and changing the block now would leave every comment on this
            // page anchored to text that is no longer in it. The diagram stays
            // as its source until the next load, which is the same outcome as an
            // unreachable renderer and consistent with what was recorded.
            if (finished) return finish();
            pre.innerHTML = r.svg;
            hoistDiagramStyle(pre, id);
            pre.setAttribute('data-sf-mermaid', 'rendered');
            finish();
          }, fail);
        } catch (e) {
          // render() throws synchronously for some malformed input rather than
          // rejecting, so both paths have to land in the same place.
          fail(e);
        }
      });
    }

    /**
     * Render once the page's fonts have actually arrived.
     *
     * Mermaid measures every label to size the box around it. A reading font is
     * a web font fetched on demand, so rendering immediately measures in the
     * fallback and then paints in the real face when it lands: the same
     * clipping as measuring in the wrong family, and invisible on any machine
     * where the font happens to be local. `document.fonts.ready` is already
     * resolved when nothing is being fetched, so this costs a microtask in the
     * common case. Rejection is treated as ready: a font that will not load is
     * not a reason to withhold the diagram.
     */
    function renderWhenFontsReady() {
      var fonts = document.fonts;
      if (fonts && fonts.ready && typeof fonts.ready.then === 'function') {
        fonts.ready.then(render, render);
        return;
      }
      render();
    }

    // Armed before either path, not just the fetch. It is the guarantee that the
    // comment rail is never held hostage by this, and there are now two ways to
    // wait: for the script, and for the fonts. A page that already has mermaid
    // skips the fetch entirely and can still wait on document.fonts.ready
    // forever, which armed nothing when the timer lived below.
    setTimeout(function () { settle(false); }, MERMAID_LOAD_TIMEOUT);

    if (window.mermaid) return renderWhenFontsReady();
    var s = document.createElement('script');
    s.src = MERMAID_SRC;
    s.async = true;
    s.onload = renderWhenFontsReady;
    // The page is readable without the renderer, so a failed fetch is not an
    // error state: the blocks stay as the source, shown as code.
    s.onerror = function () { settle(false); };
    document.head.appendChild(s);
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

  function meAuthor() {
    if (_me) return _me;
    try {
      var v = window.localStorage.getItem(AUTHOR_KEY);
      _me = v && v.trim() ? v.trim() : null;
    } catch (e) {
      _me = null; // storage blocked; the session copy is all there is
    }
    return _me;
  }
  function setMeAuthor(name) {
    _me = name; // authoritative for this page, whatever storage does
    try { window.localStorage.setItem(AUTHOR_KEY, name); } catch (e) { /* asked again next load */ }
  }
  /** Add the writer's name to a request body, when this browser has one. */
  function withAuthor(body) {
    var me = meAuthor();
    if (!me) return body;
    var out = {};
    for (var k in body) if (Object.prototype.hasOwnProperty.call(body, k)) out[k] = body[k];
    out.author = me;
    return out;
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
      postJSON(API + '/resolve-all').then(load).catch(function () { flashErr('Could not resolve threads.'); });
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
    buildCtxMenu();
    buildAsides();
    buildTop();
    buildTitleBar();
    buildRail();
    watchSlides();

    document.addEventListener('mousemove', onHover);
    document.addEventListener('click', onClick, true); // capture so we can claim a block click
    document.addEventListener('keydown', function (e) {
      // A modal dialog answers Escape itself, and the keypress still bubbles to
      // here. Acting on it a second time would collapse the thread and cancel
      // the composer behind the dialog — losing an unposted draft to a keypress
      // that was meant to close a confirmation.
      if (window.SFUI && window.SFUI.dialogOpen()) return;
      if (e.key === 'Escape') { clearHover(); closeMenu(); collapseThread(); cancelCompose(); }
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) onSaveKey(e);
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
    // Which body of work this spec belongs to, and a way into the rest of it —
    // "which project" is rarely the last question, "what else is in it" is the
    // next one. Hidden until meta says there is one; a published copy is never
    // told, because handlePublicMeta does not carry the field.
    els.project = create('a', { class: 'sf-tb-proj', hidden: 'hidden' });
    els.titlebar.appendChild(els.project);
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
    // A live publication has no expiry, so the only thing standing between a
    // share and a forgotten public URL is being able to see it without running
    // a command. It carries the link's state as well as its existence: a record
    // whose listener is gone still answers, with a 502, and a pill that said
    // "Shared" over that would be worse than no pill.
    els.shared = create('span', { class: 'sf-tb-shared', hidden: 'hidden' });
    els.titlebar.appendChild(els.shared);
    // Whether anything is listening. In the header rather than the menu, because
    // a spec whose agent has gone is one you can leave comments on all day
    // without anyone ever seeing them, and that is not something to find out by
    // opening a popup.
    els.conn = create('span', { class: 'sf-tb-conn', hidden: 'hidden' });
    els.titlebar.appendChild(els.conn);
    els.headAction = create('button', { class: 'sf-act sf-tb-act', type: 'button' });
    els.headAction.onclick = onAction;
    els.titlebar.appendChild(els.headAction);
    document.body.appendChild(els.titlebar);
    syncTitle();
  }

  /**
   * The connection pill: is anyone listening, and what to do when nobody is.
   *
   * "Connected" means a review watcher is beating for the session this spec is
   * attached to — so comments submitted now would be picked up on their own. It
   * is not "a session was here once": that was the old rule, and it left specs
   * claiming to be live for half an hour after their window closed.
   *
   * A spec attached to nothing says so too. It used to be silent, on the grounds
   * that "Disconnected" reads as a fault where the truth is that nobody has
   * claimed the spec yet — which was fair while the daemon had a headless drain
   * to sweep up batches nobody owned. With that gone, comments written here reach
   * no one at all, so saying nothing is the worst of the three states to be quiet
   * about.
   *
   * Hidden on a published copy. A reviewer cannot connect someone else's spec to
   * someone else's agent, and telling them the author's session is down only
   * invites them to stop writing.
   */
  /**
   * The project chip: which body of work this spec is filed under.
   *
   * Absent means unfiled, and unfiled is a real state rather than a gap to fill,
   * so nothing renders. That is also what a published copy sees: the reader's
   * meta subset does not carry the field, so the chip stays hidden there without
   * needing its own rule.
   *
   * The name is set as text and the link built with encodeURIComponent, because
   * a project name is whatever the author typed.
   */
  function renderProject() {
    if (!els.project) return;
    var name = (state.meta || {}).project;
    if (!name || isPublishedCopy()) {
      els.project.setAttribute('hidden', 'hidden');
      els.project.textContent = '';
      els.project.removeAttribute('href');
      return;
    }
    els.project.removeAttribute('hidden');
    els.project.textContent = name;
    els.project.setAttribute('title', 'Open ' + name + ' on the home page');
    els.project.setAttribute('href', '/?project=' + encodeURIComponent(name));
  }

  function renderConn() {
    if (!els.conn) return;
    var meta = state.meta;
    if (!meta || isPublishedCopy()) {
      els.conn.setAttribute('hidden', 'hidden');
      els.conn.innerHTML = '';
      return;
    }
    els.conn.removeAttribute('hidden');
    els.conn.innerHTML = '';
    var attached = !!meta.attachedSession;
    var connected = !!meta.connected;
    els.conn.className = 'sf-tb-conn' + (connected ? '' : ' sf-tb-conn-off');
    var who = meta.sessionLabel || ('session ' + String(meta.attachedSession).slice(0, 8));
    els.conn.appendChild(create('span', { class: 'sf-conn-dot', 'aria-hidden': 'true' }));
    els.conn.appendChild(create('span', { class: 'sf-conn-label' },
      connected ? 'Connected' : attached ? 'Disconnected' : 'No agent'));
    els.conn.title = connected
      ? who + ' is watching this spec — comments you submit reach it on its own'
      : attached
        ? who + ' has stopped watching. Comments you submit will sit unread until a session picks this spec up.'
        : 'No session owns this spec. Comments you submit will sit unread until one takes it.';
    if (connected) return;
    var btn = create('button', { class: 'sf-conn-act', type: 'button' }, attached ? 'Reconnect' : 'Connect');
    btn.onclick = function (e) { e.stopPropagation(); copyReconnectPrompt(); };
    els.conn.appendChild(btn);
  }

  /**
   * Reconnecting is a thing only an agent can do, and nothing here can reach one.
   *
   * There is no channel from this page to any Claude session — the connection
   * runs the other way, an agent attaching itself to a spec. So the button hands
   * the reader the exact words to paste into whichever session they want to own
   * this spec, which is the shortest path that does not invent a control plane.
   */
  function reconnectPrompt() {
    var cli = (window.SPECFORGE || {}).cli;
    var attached = !!(state.meta && state.meta.attachedSession);
    return [
      'Connect SpecForge spec ' + SPEC + ' to this session.',
      '',
      attached
        ? 'It is attached to a session that has stopped watching it, so comments submitted'
        : 'No session owns it, so comments submitted',
      'in the browser are not reaching anyone. Take it over here:',
      '',
      '  1. Detach it from wherever it is attached:  node "' + cli + '" detach ' + SPEC,
      '  2. Attach it to this session:               node "' + cli + '" open ' + SPEC,
      '  3. Arm the review watcher in the background so submitted comments reach you',
      '     while you are idle:                      node "' + cli + '" wait-batch',
      '',
      'On the watcher completing, run the specforge:review-spec skill for each pending',
      'spec and relaunch it; on timeout just relaunch it.',
    ].join('\n');
  }
  function copyReconnectPrompt() {
    var text = reconnectPrompt();
    var done = function () {
      flash('Prompt copied. Paste it into the Claude session you want to own this spec.');
    };
    try {
      navigator.clipboard.writeText(text).then(done, function () { flash(text); });
    } catch (e) {
      flash(text);
    }
  }

  /**
   * The share pill: what is public, whether the link works, and what to do.
   *
   * Hidden when nothing is shared, because a pill saying "not shared" is noise
   * on every spec you own. When something is shared it reports the link's
   * actual state, not merely the record's existence:
   *
   *   live  → "Shared" + Copy. The link works.
   *   down  → "Link down" + Regenerate. The record outlived its listener, so
   *           the URL answers 502; the only useful action is a new one.
   */
  function renderShared() {
    if (!els.shared) return;
    var share = state.meta && state.meta.share;
    // Checked before the no-share case: publishing for the first time is
    // exactly when there is no record yet, and it is the moment the feedback
    // matters most, since a tunnel takes seconds.
    if (state.sharing) {
      els.shared.removeAttribute('hidden');
      els.shared.className = 'sf-tb-shared sf-tb-shared-busy';
      els.shared.textContent = 'Publishing…';
      els.shared.title = '';
      return;
    }
    if (!share) {
      els.shared.setAttribute('hidden', 'hidden');
      els.shared.innerHTML = '';
      return;
    }
    els.shared.removeAttribute('hidden');
    var live = !!share.live;
    els.shared.className = 'sf-tb-shared' + (live ? '' : ' sf-tb-shared-down');
    els.shared.innerHTML = '';
    var label = create('span', { class: 'sf-shared-label' }, live ? 'Shared' : 'Link down');
    els.shared.appendChild(label);
    els.shared.title = live
      ? share.url + ' — anyone with this link can read, comment and submit'
      : 'The tunnel for this spec is gone, so the link no longer serves. Regenerate to get a new one.';
    if (live) {
      var copy = create('button', { class: 'sf-shared-act', type: 'button', title: 'Copy the link' }, 'Copy');
      copy.onclick = function (e) { e.stopPropagation(); copyShare(share.url, copy); };
      els.shared.appendChild(copy);
    } else {
      var again = create('button', { class: 'sf-shared-act', type: 'button', title: 'Publish again on a new URL' }, 'Regenerate');
      again.onclick = function (e) { e.stopPropagation(); doShare(); };
      els.shared.appendChild(again);
    }
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
  // bar). It follows comments → review → approval, and approval is the end:
  //   approved                        → "Approved ✓"        (status display, no action)
  //   unsubmitted comment(s)          → "Submit comments"   (freeze a batch for the agent)
  //   submitted, agent not yet replied→ "Awaiting response" (disabled; agent is working)
  //   agent replied to every thread   → "Review replies"    (read them, then resolve)
  //   a thread still open             → "Resolve to approve"(disabled)
  //   nothing unresolved              → "LGTM ✓"            (status → approved)
  // `approved` is read first, which is safe because it cannot coexist with an
  // unresolved thread: writing a comment on an approved spec sends it back to draft.
  function actionState() {
    var status = (state.meta && state.meta.status) || 'draft';
    if (status === 'approved') return { label: 'Approved ✓', state: 'done', act: null };
    if (pendingCount() > 0) return { label: 'Submit comments', state: 'needs', act: 'submit' };
    // Agent threads only: an open discussion is a conversation between people,
    // not work in flight, and must not report the agent as busy.
    var unresolved = unresolvedAgentCount();
    if (unresolved > 0) {
      // All submitted. Once every open thread is answered it's the human's turn to
      // read the replies; until then we surface how far the agent has got —
      // Awaiting response → Picked up comments → Working on comments — from the
      // batch progress the hooks + review-spec skill report via meta.reviewProgress.
      if (repliedAgentCount() >= unresolved) return { label: 'Review replies', state: 'replied', act: 'review' };
      // Nobody owns the spec, so nothing is coming. "Awaiting response" with a
      // spinner would report work in flight over an empty queue, and the header
      // already says No agent with a Connect button beside it.
      if (!(state.meta && state.meta.attachedSession)) {
        return { label: 'No agent to answer', state: 'other', act: null };
      }
      // Comments submitted, agent processing, not yet ready to review — one phase, so
      // all three steps carry the loading spinner (loading) to signal work in flight.
      var prog = state.meta && state.meta.reviewProgress;
      if (prog === 'working') return { label: 'Working on comments', state: 'reviewing', act: null, loading: true };
      if (prog === 'picked_up') return { label: 'Picked up comments', state: 'picked', act: null, loading: true };
      return { label: 'Awaiting response', state: 'awaiting', act: null, loading: true };
    }
    // A human discussion nobody resolved is still unfinished business, and an
    // approval granted over it would be revoked by the next comment anyway.
    // On a published copy the instruction names something the reader cannot do
    // — resolving is the owner's — so it says whose move it is instead.
    if (unresolvedCount() > 0) {
      return isPublishedCopy()
        ? { label: 'With the owner', state: 'other', act: null }
        : { label: 'Resolve to approve', state: 'other', act: null };
    }
    // A status from before the lifecycle was cut to two — done, implementing,
    // closed — on a store nobody has migrated. Show it; never offer to approve
    // over the top of it, which would erase what it recorded.
    if (status !== 'draft') return { label: status, state: 'other', act: null };
    return { label: 'LGTM ✓', state: 'lgtm', act: 'approve' };
  }
  function renderAction() {
    var s = actionState();
    applyAction(els.footAction, s);
    applyAction(els.headAction, s);
    if (els.footCaption) {
      // Both counts, always. Whether a comment reaches an agent depends on a
      // token inside its text, which is easy to forget; showing what is
      // discussion next to what is queued makes a missing @agent visible before
      // the submit rather than after it.
      var p = pendingCount();
      var d = discussionCount();
      var parts = [];
      if (p > 0) parts.push(p + ' for agent');
      if (d > 0) parts.push(d + (d === 1 ? ' discussion' : ' discussions'));
      els.footCaption.textContent = parts.join(' · ');
    }
    if (els.resolveAll) {
      els.resolveAll.classList.toggle('show', !!unresolvedCount() && !isPublishedCopy());
    }
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
    // A shortcut nobody can find is not a shortcut. Only on the state it drives.
    if (s.act === 'submit') btn.title = 'Submit comments (' + SUBMIT_HINT + ')';
    else btn.removeAttribute('title');
  }
  function onAction() {
    var s = actionState();
    if (!s.act) return;
    if (s.act === 'submit') return submitBatch();
    if (s.act === 'review') return setSidebar(true); // open the sidebar to read the agent's replies
    postJSON(SPEC_API + '/status', { status: 'approved' }).then(function (r) {
      if (r.ok) load(); else flashErr('Could not update status.');
    }).catch(function () { flashErr('Could not update status.'); });
  }
  function unresolvedCount() {
    return state.threads.filter(function (t) { return t.state !== 'resolved'; }).length;
  }
  function repliedCount() {
    return state.threads.filter(function (t) { return t.state === 'replied'; }).length;
  }

  // The same two counts, restricted to threads an agent is expected to act on.
  //
  // The lifecycle CTA reads these rather than the totals above. Its "everything
  // was submitted, we are waiting on the agent" branch assumed every open thread
  // had been sent, which was true only while every comment was agent work.
  // Discussion between people was never submitted, so it cannot be awaiting
  // anything, and counting it made a comment nobody sent report the agent as busy.
  function unresolvedAgentCount() {
    return state.threads.filter(function (t) {
      return t.state !== 'resolved' && inAgentLoop(t);
    }).length;
  }
  function repliedAgentCount() {
    return state.threads.filter(function (t) {
      return t.state === 'replied' && inAgentLoop(t);
    }).length;
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

  // ---------- context menu ----------
  // Right-click a block, pick an action, and the composer opens holding it. The
  // menu writes a comment and nothing else: no agent is called from here, no job
  // is queued, and the spec file is not touched. See §9 of the design.
  //
  // The list is injected by the server (window.SPECFORGE.actions). A page served
  // before this existed carries none, and every right-click on it falls through
  // to the browser's own menu, which is the behaviour it had.
  function menuActionList() {
    var a = (window.SPECFORGE || {}).actions;
    return a && a.length ? a : null;
  }
  function ctxTargetOf(node) {
    if (inUI(node) || inMenu(node)) return null;
    return blockAt(node);
  }
  function buildCtxMenu() {
    els.ctx = create('div', { id: 'sf-ctx', class: 'sf-ctx', role: 'menu' });
    document.body.appendChild(els.ctx);

    document.addEventListener('contextmenu', function (e) {
      var actions = menuActionList();
      if (!actions) return;
      // Review chrome answers neither menu: a spec-wide action offered over the
      // launcher is nonsense, and so is "explain this simply".
      if (inUI(e.target) || inMenu(e.target)) return;
      var el = ctxTargetOf(e.target);
      // Nothing commentable under the pointer means the reader hit the page
      // itself, which is the scope of the whole document.
      var scope = el ? 'local' : 'global';
      var anchor = el || specAnchorEl();
      if (!anchor) return; // a document with nothing in it: no menu to offer
      e.preventDefault(); // or the browser's menu opens on top of this one
      openCtxMenu(anchor, actions, e.clientX, e.clientY, scope);
    });
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      // The menu first: with both open, Escape means the thing on top.
      if (els.ctx && els.ctx.classList.contains('open')) return closeCtxMenu();
      setAsidesOpen(false);
    });
    document.addEventListener('click', function () { closeCtxMenu(); });
    // A menu placed at a pointer position is in the wrong place the moment the
    // page moves under it, and there is no position worth recomputing: you
    // scrolled because you were looking at something else.
    window.addEventListener('scroll', function () { closeCtxMenu(); }, true);
  }
  /**
   * What a spec-wide action anchors to.
   *
   * The title, because the scope is the document and the anchor should say so
   * rather than recording whatever the reader happened to be standing near. An
   * imported spec may have no h1, so the first commentable block stands in: a
   * menu that throws on right-click is worse than one anchored a line off.
   */
  function specAnchorEl() {
    var h1 = document.querySelector('h1');
    if (h1 && !inUI(h1)) return h1;
    return commentableBlocks()[0] || null;
  }
  function openCtxMenu(el, actions, x, y, scope) {
    els.ctx.innerHTML = '';
    actions.forEach(function (a) {
      if (a.scope !== scope) return;
      els.ctx.appendChild(menuRow(a.icon, a.label, function (ev) {
        ev.stopPropagation();
        closeCtxMenu();
        runAction(a, el);
      }));
    });
    els.ctx.style.left = x + 'px';
    els.ctx.style.top = y + 'px';
    els.ctx.classList.add('open');
    // Placed at the pointer, then pulled back inside the viewport. Right-click
    // near the bottom or the right edge and the menu would otherwise run off it,
    // and a row that falls outside cannot be clicked at all.
    var r = els.ctx.getBoundingClientRect();
    var pad = 8;
    var maxL = Math.max(pad, window.innerWidth - r.width - pad);
    var maxT = Math.max(pad, window.innerHeight - r.height - pad);
    els.ctx.style.left = Math.max(pad, Math.min(x, maxL)) + 'px';
    els.ctx.style.top = Math.max(pad, Math.min(y, maxT)) + 'px';
  }
  function closeCtxMenu() {
    if (els.ctx) els.ctx.classList.remove('open');
  }
  /** Copy link is the only action the browser answers by itself. */
  function runAction(a, el) {
    if (a.id === 'copy_link') return copyAnchorLink(el);
    // Whatever is already in the composer for this block rides along. You are
    // mid-thought and decide the agent should draw it; losing the sentence you
    // typed is the wrong answer, and the action reading first is the right
    // order anyway. Picking a second action keeps the first, which is how two
    // actions travel in one comment.
    var draft = openDraftFor(el);
    openRailCompose(el, '@' + a.id + ' ' + draft);
  }
  /**
   * What is typed in the composer, if one is open on THIS block.
   *
   * A composer open on a different block is left behind with its text, which is
   * what clicking that other block has always done: a composer belongs to one
   * block and moving it drops what was in it. Carrying the text across would be
   * worse, since it was written about the block you left.
   */
  function openDraftFor(el) {
    if (state.composeEl !== el || !els.rail) return '';
    var ta = els.rail.querySelector('.sf-bub-compose textarea');
    return ta && ta.value ? ta.value.trim() : '';
  }
  // ---------- asides ----------
  // An aside is a section of the spec carrying data-sf-aside, stored directly
  // after the section it came from. That is the model, and it is what makes
  // export, anchoring, comments and the gate work with nothing written for them.
  //
  // The rendering is separate: the section is MOVED out of the flow into a
  // right-hand panel, because a draft you have not accepted should not push the
  // document you are reading down the page. Moved, not copied — one aside, one
  // id, one set of nodes, still part of the document and still commentable.
  //
  // The source section keeps a marker saying an aside exists, since a panel you
  // never open is a draft you never answer.
  function buildAsides() {
    var list = document.querySelectorAll('section[data-sf-aside]');
    if (!list.length) return; // no panel until there is something to put in it
    els.asides = create('div', { id: 'sf-asides', class: 'sf-asides' });
    var head = create('div', { class: 'sf-asides-head' });
    head.appendChild(create('b', {}, 'Asides'));
    var close = create('button', { class: 'sf-asides-close', type: 'button', 'aria-label': 'Close' }, '×');
    close.onclick = function (e) { e.stopPropagation(); setAsidesOpen(false); };
    head.appendChild(close);
    els.asides.appendChild(head);
    var body = create('div', { class: 'sf-asides-body' });
    els.asides.appendChild(body);
    document.body.appendChild(els.asides);

    for (var i = 0; i < list.length; i++) {
      decorateAside(list[i]);
      markSourceOf(list[i]);
      body.appendChild(list[i]); // appendChild MOVES a node that is already in the DOM
    }
  }
  /**
   * The marker on the source section.
   *
   * A direct child of the section and never inside a block: a comment anchors to
   * a block's normalized text, so chrome placed inside one would change that
   * text and orphan the threads already on it.
   */
  function markSourceOf(aside) {
    var src = document.getElementById(aside.getAttribute('data-sf-aside'));
    if (!src) return; // an aside whose section was deleted: nothing to hang it on
    var m = src.querySelector(':scope > .sf-aside-mark');
    if (!m) {
      m = create('button', {
        class: 'sf-aside-mark', type: 'button',
        title: 'Drafts attached to this section',
      });
      m.onclick = function (e) { e.stopPropagation(); setAsidesOpen(true, aside); };
      src.classList.add('sf-has-aside');
      src.insertBefore(m, src.firstChild);
    }
    var a = actionByIdClient(aside.getAttribute('data-sf-action'));
    m.appendChild(create('span', { class: 'sf-aside-mark-ic' }, a ? a.icon : '◇'));
  }
  function setAsidesOpen(open, scrollTo) {
    if (!els.asides) return;
    els.asides.classList.toggle('open', !!open);
    document.body.classList.toggle('sf-asides-open', !!open);
    // The rail and the drawer already take turns in the right gutter. The panel
    // joins that rule rather than overlapping either of them.
    syncRailVisibility();
    if (open && scrollTo && scrollTo.scrollIntoView) {
      scrollTo.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
  function decorateAside(sec) {
    if (sec.querySelector(':scope > .sf-aside-head')) return; // built once
    sec.classList.add('sf-aside');
    var a = actionByIdClient(sec.getAttribute('data-sf-action'));

    var head = create('div', { class: 'sf-aside-head' });
    // An aside written under an action id that has since been renamed keeps its
    // buttons and loses only its label: it is still a draft awaiting an answer.
    var toggle = create('button', {
      class: 'sf-aside-toggle', type: 'button', 'aria-expanded': 'true',
      title: 'Fold this draft away',
    });
    toggle.innerHTML = '<span class="sf-aside-ic">' + esc(a ? a.icon : '◇') + '</span>' +
      '<span class="sf-aside-label">' + esc(a ? a.label : 'Aside') + '</span>';
    toggle.onclick = function (e) {
      e.stopPropagation();
      var shut = sec.classList.toggle('sf-aside-shut');
      toggle.setAttribute('aria-expanded', shut ? 'false' : 'true');
    };
    head.appendChild(toggle);

    var acts = create('span', { class: 'sf-aside-acts' });
    asideActions().forEach(function (act) {
      var b = create('button', { class: 'sf-aside-act', type: 'button' }, act.label);
      b.onclick = function (e) { e.stopPropagation(); runAction(act, sec); };
      acts.appendChild(b);
    });
    head.appendChild(acts);
    sec.insertBefore(head, sec.firstChild);
  }
  function actionByIdClient(id) {
    var all = (window.SPECFORGE || {}).actions || [];
    for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
    return null;
  }
  function asideActions() {
    return ((window.SPECFORGE || {}).actions || []).filter(function (a) {
      return a.scope === 'aside';
    });
  }

  function copyAnchorLink(el) {
    // The section, not the block: a block has an id only in SpecForge's own
    // registry, and a URL naming that is meaningless to anyone you send it to.
    var section = sectionPathOf(el)[0];
    var url = location.origin + location.pathname + (section ? '#' + section : '');
    var failed = function () { flash('Could not copy the link', 'err'); };
    var p;
    try {
      p = navigator.clipboard && navigator.clipboard.writeText(url);
    } catch (e) { return failed(); }
    // writeText resolves; it does not return. Saying "copied" before it settles
    // reports a success that a denied permission never delivered.
    if (!p || !p.then) return failed();
    p.then(function () { flash('Link copied'); }, failed);
  }
  // Which view the menu is showing, as a counter. Bumped by every rebuild and
  // every close, so an async request started for one view can tell that the
  // reader has moved on — pressed Back, or closed and reopened the menu — and
  // drop its answer rather than painting it over a screen they left.
  var menuView = 0;

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
    // Every rebuild is a new view, so anything still in flight for the old one
    // is dropped rather than rendered over this.
    menuView += 1;
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
    els.menu.appendChild(monoRow());

    // Export — open the print dialog (pick "Save as PDF"); the review chrome is
    // hidden by the print stylesheet so the PDF is just the spec.
    els.menu.appendChild(menuRow('⤓', 'Export PDF', function () { closeMenu(); window.print(); }));

    // Export to Google Docs — relayed through the attached session (it runs the
    // Drive MCP); the row reflects meta.export and updates live on the poll.
    els.menu.appendChild(exportRow());

    // Download as markdown. Unlike the two rows above this needs no relay and no
    // state: the daemon renders it per request and the browser saves what comes
    // back. Loopback only — the route lives on the daemon, not on the gateway a
    // published page is served from, so offering it there would 404.
    if ((window.SPECFORGE || {}).transport !== 'poll') els.menu.appendChild(downloadMdRow());

    // Share — publish this spec on a public URL. Only offered on the loopback
    // copy: a published page has no share route behind it, and offering a
    // reviewer a button to re-publish what they are already reading is noise.
    if ((window.SPECFORGE || {}).transport !== 'poll') els.menu.appendChild(shareRow());

    // Add to a shared project — list this spec in a project a teammate shared
    // with you. Loopback only, for the same reason Share is: the routes are the
    // daemon's, and a reviewer cannot contribute someone else's spec anywhere.
    if ((window.SPECFORGE || {}).transport !== 'poll') els.menu.appendChild(contributeRow());

    // Footer — one bottom row: the live pill (left), the attached session id
    // (center), and Detach (right). els.live survives the innerHTML reset above
    // (#sf-live, the same node re-appended each rebuild).
    els.menu.appendChild(sessionFoot());
  }

  // The bottom row: [● live]  [session id / "Not attached"]  [Detach].
  //
  // The session's NAME stays here — it answers "which window", which is a detail
  // you go looking for. Whether that window is still listening moved to the
  // header (renderConn), because that is not a detail: a spec nobody is watching
  // takes comments all day and delivers none of them.
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
  // Font — a dropdown of reading fonts grouped Sans/Serif/Presentation; applies
  // live and persists the pick. "Default" leaves the spec's own font alone. The
  // monospace faces are not here: they are the Code font row below.
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
  // Code font — the monospace face, everywhere the document uses one. Composes
  // with the reading font rather than replacing it.
  function monoRow() {
    var row = create('div', { class: 'sf-menu-row sf-menu-ctl' });
    row.innerHTML = '<span class="sf-row-main"><span class="sf-row-ic">&#123;&#125;</span><span>Code font</span></span>';
    var sel = create('select', { class: 'sf-mono-select', 'aria-label': 'Code font' });
    sel.appendChild(create('option', { value: 'default' }, 'Default'));
    FONTS.filter(function (f) { return f.cat === 'mono'; }).forEach(function (f) {
      sel.appendChild(create('option', { value: f.id }, f.name));
    });
    sel.value = initMono();
    sel.onchange = function () { applyMono(sel.value); putPref({ mono: sel.value }); };
    row.appendChild(sel);
    return row;
  }
  // Asks first. Nothing is lost, but the spec stops reaching anyone: comments
  // submitted after this sit unread until a session takes it, and the session
  // that had it is not necessarily one you can get back to.
  function detachSpec() {
    var who = (state.meta && state.meta.sessionLabel) || 'the session that owns it';
    confirmThen({
      title: 'Detach this spec',
      body: 'It stops reaching ' + who + '. Comments you submit will sit unread '
        + 'until a session picks this spec up.',
      ok: 'Detach',
      onOk: function () {
        postJSON(SPEC_API + '/detach').then(function () { closeMenu(); load(); })
          .catch(function () { flashErr('Could not detach.'); });
      },
    });
  }

  // Download-as-markdown row. A plain anchor: the response carries
  // Content-Disposition, so the browser saves it with the right name and no
  // script has to fetch, blob and revoke anything. The server decides whether
  // that is a .md or a .zip, which depends on whether the spec has diagrams —
  // inline SVG does not survive a markdown renderer, so those travel as files.
  function downloadMdRow() {
    var row = create('div', { class: 'sf-menu-row sf-menu-ctl' });
    var link = create('a', { class: 'sf-row-main sf-doc-link', href: SPEC_API + '/md', download: '' });
    link.innerHTML = '<span class="sf-row-ic">⤓</span><span>Download markdown</span>';
    link.onclick = function () { closeMenu(); };
    row.appendChild(link);
    return row;
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
  // Publish this spec on a public URL, from the menu.
  //
  // Three states, like the export row: idle → action · starting → spinner ·
  // published → the link, a copy button and Unshare. The spinner is driven from
  // local state rather than meta, because a tunnel takes several seconds to come
  // up and nothing in the store changes until it has.
  function shareRow() {
    if (state.sharing) {
      var busy = menuRow('', 'Publishing…', null);
      busy.disabled = true;
      busy.querySelector('.sf-row-ic').appendChild(create('span', { class: 'sf-spin', 'aria-hidden': 'true' }));
      return busy;
    }
    var share = state.meta && state.meta.share;
    if (share && share.url) {
      var row = create('div', { class: 'sf-menu-row sf-menu-ctl sf-share-on' });
      var link = create('a', {
        class: 'sf-row-main sf-doc-link', href: share.url, target: '_blank', rel: 'noopener',
        title: share.url,
      });
      link.innerHTML = '<span class="sf-row-ic">🔗</span><span class="sf-share-url"></span>';
      // Hostname only: the full URL does not fit and its host is the whole
      // secret anyway.
      link.querySelector('.sf-share-url').textContent = prettyHost(share.url);
      link.onclick = function () { closeMenu(); };
      row.appendChild(link);
      var copy = create('button', { class: 'sf-detach sf-share-copy', type: 'button', title: 'Copy the link' }, 'Copy');
      copy.onclick = function (e) { e.stopPropagation(); copyShare(share.url, copy); };
      row.appendChild(copy);
      var off = create('button', { class: 'sf-detach sf-share-off', type: 'button', title: 'Stop sharing' }, 'Unshare');
      off.onclick = function (e) { e.stopPropagation(); doUnshare(); };
      row.appendChild(off);
      return row;
    }
    return menuRow('🔗', 'Share this spec', function () { doShare(); });
  }

  /**
   * "Add to a shared project" — the menu half of `specforge contribute`.
   *
   * The projects offered are the ones this machine has joined, because those
   * are the only ones it holds a token for. Contributing publishes the spec
   * under this machine's own token and registers a pointer; the spec itself
   * never leaves.
   */
  function contributeRow() {
    if (state.contributing) {
      var busy = menuRow('', 'Adding…', null);
      busy.disabled = true;
      busy.querySelector('.sf-row-ic').appendChild(create('span', { class: 'sf-spin', 'aria-hidden': 'true' }));
      return busy;
    }
    return menuRow('📤', 'Add to a shared project…', function (e) {
      // Replacing the menu's rows detaches the button that was clicked, so the
      // outside-click handler walking up from it never reaches the menu and
      // closes it. Every other row either closes the menu on purpose or leaves
      // it alone; this is the only one that rebuilds it in place.
      if (e) e.stopPropagation();
      openContributePicker();
    });
  }

  /**
   * Replace the menu with the list of joined projects.
   *
   * A submenu rather than a dialog: the list is short, it is a choice rather
   * than a form, and the menu is already open where the reader is looking.
   */
  function openContributePicker() {
    var view = ++menuView;
    var leftView = function () { return view !== menuView; };
    // buildMenuRows bumps the counter itself, so Back invalidates this request
    // without having to remember to.
    var backRow = function () {
      return menuRow('‹', 'Back', function (e) {
        if (e) e.stopPropagation();
        buildMenuRows();
      });
    };
    els.menu.innerHTML = '';
    els.menu.appendChild(backRow());
    var loading = menuRow('', 'Loading…', null);
    loading.disabled = true;
    els.menu.appendChild(loading);

    fetch('/api/subscriptions').then(function (r) { return r.json(); }).then(function (body) {
      if (leftView()) return;
      var subs = (body && body.subscriptions) || [];
      els.menu.innerHTML = '';
      els.menu.appendChild(backRow());
      if (!subs.length) {
        // Nothing to offer, and the reason is actionable: they have not joined
        // a project yet. Said here rather than left as an empty list.
        var none = menuRow('', 'No shared projects joined yet', null);
        none.disabled = true;
        els.menu.appendChild(none);
        els.menu.appendChild(menuRow('', 'Open a teammate’s project link to join one', null)).disabled = true;
        return;
      }
      subs.forEach(function (s) {
        els.menu.appendChild(menuRow('📁', s.name, function () { doContribute(s); }));
      });
    }).catch(function () {
      // Guarded like the success path: a failure that lands after the reader
      // left is just as unwelcome as a success, and reporting it over a menu
      // they returned to is worse, because it names a screen they cannot see.
      if (leftView()) return;
      els.menu.innerHTML = '';
      els.menu.appendChild(backRow());
      var err = menuRow('', 'Could not load your shared projects', null);
      err.disabled = true;
      els.menu.appendChild(err);
    });
  }

  function doContribute(sub) {
    state.contributing = true;
    buildMenuRows();
    var finish = function () { state.contributing = false; buildMenuRows(); };
    postJSON(SPEC_API + '/contribute', { url: sub.url, owner: meAuthor() || undefined })
      .then(function (r) {
        if (r.ok) {
          finish();
          closeMenu();
          return flash('Added to “' + sub.name + '”.');
        }
        return r.json().then(function (b) {
          finish();
          flashErr((b && b.error) || 'Could not add this spec to “' + sub.name + '”.');
        }).catch(function () {
          finish();
          flashErr('Could not add this spec to “' + sub.name + '”.');
        });
      })
      .catch(function () {
        finish();
        flashErr('Could not add this spec to “' + sub.name + '”.');
      });
  }

  /** The hostname of a share URL, which is the part worth showing. */
  function prettyHost(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return String(url || '');
    }
  }

  function copyShare(url, btn) {
    var done = function () {
      var was = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = was; }, 1200);
    };
    try {
      navigator.clipboard.writeText(url).then(done, function () { flash(url); });
    } catch (e) {
      flash(url); // no clipboard access: show it so it can be copied by hand
    }
  }

  // Publishing takes as long as the tunnel takes, so the row shows a spinner
  // for the whole request rather than resolving on the next poll.
  function doShare() {
    state.sharing = true;
    renderLauncher();
    renderShared();
    var finish = function () { state.sharing = false; load(); renderLauncher(); renderShared(); };
    postJSON(SPEC_API + '/share').then(function (r) {
      if (r.ok) return finish();
      r.json().then(function (b) { finish(); flashErr((b && b.error) || 'Could not publish this spec.'); })
        .catch(function () { finish(); flashErr('Could not publish this spec.'); });
    }).catch(function () { finish(); flashErr('Could not publish this spec.'); });
  }

  // Asks first. The link is already out there, in someone's tab or a message,
  // and stopping the share breaks it for everyone at once.
  //
  // It is reversible, and the dialog says so, because that is what tells the
  // reader how much care this needs. The token outlives an unshare by design
  // (lib/store-share.mjs), so sharing again hands back the same URL; rotate is
  // the only thing that changes it. This text used to claim the opposite.
  function doUnshare() {
    confirmThen({
      title: 'Stop sharing',
      body: 'Anyone with the link loses access immediately. Sharing this spec '
        + 'again gives back the same link.',
      ok: 'Stop sharing',
      onOk: function () {
        fetch(SPEC_API + '/share', { method: 'DELETE' }).then(function (r) {
          if (!r.ok) return flashErr('Could not stop sharing.');
          load();
          renderLauncher();
          flash('Sharing stopped.');
        }).catch(function () { flashErr('Could not stop sharing.'); });
      },
    });
  }

  // Queue the export, then refresh — the row flips to "Exporting…" (menu stays open
  // so the user watches it resolve to the link). A 409 (no session / already running)
  // flashes the server's reason.
  function doExport() {
    postJSON(SPEC_API + '/export').then(function (r) {
      if (r.ok) return load();
      r.json().then(function (b) { flashErr((b && b.error) || 'Could not start the export.'); })
        .catch(function () { flashErr('Could not start the export.'); });
    }).catch(function () { flashErr('Could not start the export.'); });
  }

  // ---------- block targeting ----------
  //
  // A rendered diagram is ONE block, and the block is the <pre> the source was
  // written in. Mermaid renders its labels as <p> and <span> inside a
  // foreignObject, and <p> is in BLOCK_SEL, so without this a diagram silently
  // becomes several commentable blocks: clicking a node comments on a paragraph
  // inside the picture, and the registry gains an entry per label that appears
  // and disappears with the render. Per-node comments are a deliberate non-goal
  // in v1; this is what makes that true rather than merely intended.
  var DIAGRAM_SEL = '[data-sf-mermaid]';

  /** The diagram a node belongs to, or null when it is not inside one. */
  function diagramOf(el) {
    return el && el.closest ? el.closest(DIAGRAM_SEL) : null;
  }

  function commentableBlocks() {
    return Array.prototype.filter.call(document.querySelectorAll(BLOCK_SEL), function (el) {
      if (inUI(el)) return false;
      var dia = diagramOf(el);
      return !dia || dia === el;
    });
  }
  function blockAt(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    el = el && el.closest ? el.closest(BLOCK_SEL) : null;
    if (!el || inUI(el)) return null;
    // Clicked inside a diagram: the diagram is what gets the comment.
    var dia = diagramOf(el);
    return dia || el;
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
  //
  // `settled` false means a declared diagram did not render, so this page's block
  // text is not the text the same spec produces when it does. Such a page is not
  // one to learn anything from, and it is skipped entirely rather than merely
  // not written.
  //
  // Not written was the first attempt, and it was not enough. reconcileBlocks
  // also populates `goneBids` from the diff, in memory, whether or not the
  // result is persisted. On a page where one diagram rendered and another did
  // not, the unrendered one's stored id has no match, so it reads as deleted and
  // every thread on it renders as an orphan until the next load. Nothing was
  // written and the reader still sees the damage.
  //
  // Skipping leaves bidByEl null, so every thread resolves by content: exactly
  // the path that predates the registry, which is the worst case this was always
  // designed to degrade to.
  /** True once this page is known to be showing an older version of the spec. */
  function isStale() {
    return !!(window.SPECFORGE || {}).stale;
  }

  function syncBlocks(done, settled) {
    if (!window.SFReconcile) return done();
    if (settled === false) return done();
    // A page showing an old version would report paragraphs the owner has since
    // rewritten as deleted, detaching their comments. Retirement is durable, so
    // this is the difference between a stale tab being harmless and it costing
    // someone their anchors (spec D11).
    if (isStale()) return done();
    fetch(SPEC_API + '/blocks')
      .then(function (r) { return r.json(); })
      .catch(function () { return null; })
      .then(function (body) {
        var registry = body && body.registry;
        var out = reconcileBlocks(registry);
        if (!out || !out.changed) return done();
        // Re-checked at the commit point: the poll can land while this request
        // is in flight, and a PUT computed from a page that has since gone
        // stale is exactly what this is meant to prevent.
        if (isStale()) return done();
        var payload = out.registry;
        payload.baseVersion = registry && typeof registry.version === 'number' ? registry.version : 0;
        return fetch(SPEC_API + '/blocks', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        }).then(function (r) {
          // 409: another tab reconciled first. Re-read and redo once — both tabs
          // compute the same answer from the same page, so this converges.
          if (r && r.status === 409) return syncBlocksRetry(done, settled);
          done();
        }).catch(function () { done(); });
      })
      .catch(function () { done(); });
  }
  var retried = false;
  // `settled` is carried through rather than defaulted. The retry is only
  // reachable after a PUT, which an unsettled page never makes, so this cannot
  // matter today; it is threaded so that stops being something the next edit has
  // to rediscover.
  function syncBlocksRetry(done, settled) {
    if (retried) return done();
    retried = true;
    syncBlocks(done, settled);
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
    // ONE candidate is the only certainty. A stored index that still lands on a
    // matching block proves nothing when the text is duplicated: content shifting
    // above changes which duplicate sits at that index, so "the index matches"
    // can quietly mean "a different one of them". Prefer it for resolution — it
    // mirrors findBlock — but never call it sure, because sure means permanent.
    //
    // Known and accepted: if the text WAS duplicated when the comment was made
    // and the twin has since been deleted, this reads as unique and adopts the
    // survivor. That is where the legacy matcher already sends the thread, so
    // adoption freezes an answer we were giving anyway rather than inventing a
    // wrong one; catching it would mean keeping every deleted block's content
    // forever just to notice the coincidence.
    var atIndex = blocks[b.index];
    var pick = (atIndex && hits.indexOf(atIndex) !== -1) ? atIndex : hits[0];
    return { el: pick, sure: hits.length === 1 };
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
  function render() { renderSidebar(); renderHighlights(); renderRail(); renderSlideCounts(); renderLauncher(); renderAction(); renderShared(); renderConn(); renderProject(); syncTitle(); }

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
        t.comments.map(commentHTML).join('');
      wireCommentEdits(card, t);
      var acts = create('div', { class: 'sf-acts' });
      var replyBtn = create('button', {}, 'Reply');
      replyBtn.onclick = function (e) { e.stopPropagation(); openReply(card, t); };
      acts.appendChild(replyBtn);
      // Resolving is the owner's verdict on whether their spec answered the
      // thread, so a published copy does not offer it: the route is not on the
      // gateway, and a button that 404s is worse than no button.
      if (t.state !== 'resolved' && !isPublishedCopy()) {
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
    var aud = audienceChips(ta);
    var send = create('button', { class: 'sf-primary' }, 'Send');
    function submit() {
      var body = aud.body();
      if (!body) return;
      postJSON(API + '/' + t.id + '/reply', withAuthor({ body: body })).then(load);
    }
    send.onclick = submit;
    row.appendChild(create('span', { class: 'sf-hint' }, MOD_HINT + ' to send'));
    row.appendChild(send);
    box.appendChild(ta); box.appendChild(aud.el); box.appendChild(row);
    card.appendChild(box);
    wireInput(ta, submit);
    ta.focus();
  }

  // One comment, rendered the same way wherever it is read — the sidebar list
  // and the rail's expanded thread. They diverged once, and the rail lost the
  // Edit control by omission rather than by decision.
  //
  // Only your own, not-yet-submitted comments carry it (the server enforces the
  // same rule); once frozen into a batch the agent may already be acting on it.
  // id-less fixture comments aren't addressable → no control.
  function commentHTML(c) {
    var editable = !isAgentComment(c) && !c.batchId && c.id;
    return '<div class="sf-comment" data-cid="' + esc(c.id || '') + '"><span class="who ' +
      (isAgentComment(c) ? 'claude' : '') + '">' + esc(c.author) + '</span>' +
      '<div class="body">' + fmtBody(c.body) + '</div>' +
      (editable ? '<button class="sf-edit-c" type="button" aria-label="Edit comment">Edit</button>' : '') +
      '</div>';
  }

  /** Point every Edit control under `root` at the inline editor for its comment. */
  function wireCommentEdits(root, t) {
    Array.prototype.forEach.call(root.querySelectorAll('.sf-comment'), function (cEl) {
      var btn = cEl.querySelector('.sf-edit-c');
      if (!btn) return;
      var cid = cEl.getAttribute('data-cid');
      var c = t.comments.filter(function (x) { return x.id === cid; })[0];
      if (c) btn.onclick = function (e) { e.stopPropagation(); openCommentEdit(cEl, t, c); };
    });
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
        // The name must go with the edit: the server checks it against the one
        // on the comment, so a browser writing as `lavee` and editing as nobody
        // cannot edit what it just wrote.
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(withAuthor({ body: v })),
      }).then(function (r) { if (r.ok) load(); else flashErr('Could not save the edit.'); })
        .catch(function () { flashErr('Could not save the edit.'); });
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

  // ---------- decks: one section on screen at a time ----------
  //
  // A deck pages its sections instead of scrolling them: exactly one carries
  // `is-current` and the rest are display:none. Every assumption the rail makes
  // breaks on that, because a hidden block measures as a zero-height rect at the
  // top of the page. Threads from all 22 slides land on the one slide you are
  // reading, stacked in a column with nothing to anchor them to, and "N above"
  // counts a scroll distance that does not exist.
  //
  // So on a deck the rail is scoped to the current slide, sits on that slide
  // rather than in a gutter a deck does not have, and counts by slide.
  //
  // Detected from the rendered result rather than the spec type, so it holds for
  // anything that pages sections. The deck's own script is inline at the end of
  // the body and review.js is deferred, so `is-current` is set before this runs.
  function deckSlides() {
    var secs = document.querySelectorAll(SLIDE_SEL);
    if (secs.length < 2) return null;
    for (var i = 0; i < secs.length; i++) {
      if (secs[i].classList.contains('is-current')) return secs;
    }
    return null;
  }
  /** The slide a block sits on, or null off a deck. */
  function slideOf(el) {
    return el && el.closest ? el.closest(SLIDE_SEL) : null;
  }
  function slideIndex(slides, sec) {
    return sec ? Array.prototype.indexOf.call(slides, sec) : -1;
  }
  function currentSlideIndex(slides) {
    for (var i = 0; i < slides.length; i++) if (slides[i].classList.contains('is-current')) return i;
    return -1;
  }
  /**
   * Page the deck to a slide.
   *
   * Through the hash, which is the deck's own paging contract (it listens for
   * hashchange and maps the id to a slide), so the review layer never has to
   * know how a deck decides what to render.
   */
  function showSlide(sec) {
    if (!sec || !sec.id) return;
    if (sec.classList.contains('is-current')) return;
    location.hash = '#' + sec.id;
  }
  /** Page to the slide holding `el`, if that is somewhere else. Safe off a deck. */
  function revealSlideFor(el) {
    if (!deckSlides()) return;
    showSlide(slideOf(el));
  }

  /**
   * Re-render the rail when the deck pages.
   *
   * Not on hashchange: the deck's own prev/next buttons and arrow keys use
   * history.replaceState, which fires nothing. What always happens is the
   * `is-current` class moving between sections, so that is what this watches.
   */
  function watchSlides() {
    if (!window.MutationObserver || !deckSlides()) return;
    var main = document.querySelector('main');
    if (!main) return;
    new window.MutationObserver(function (records) {
      // renderHighlights marks blocks INSIDE slides on every render; reacting to
      // those would re-render from within a render, forever.
      var paged = records.some(function (r) { return r.target.matches && r.target.matches(SLIDE_SEL); });
      if (paged) render();
    }).observe(main, { attributes: true, attributeFilter: ['class'], subtree: true });
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

  /**
   * The threads the rail actually draws: everything on a scrolling spec, and on
   * a deck only the current slide's. A bubble for a slide nobody is looking at
   * has nothing on screen to point at, so it can only mislead.
   */
  function railEntries() {
    var all = railThreads();
    var slides = deckSlides();
    if (!slides) return all;
    return all.filter(function (r) {
      var s = slideOf(r.el);
      return s && s.classList.contains('is-current');
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
    //
    // It overrides the asides panel for the same reason and more sharply: the
    // panel holds sections of the spec, commenting on them is the point, and
    // every one of those comments is composed in the rail. CSS shifts the rail
    // clear of the panel while both are up.
    if (state.composeEl) return true;
    if (els.asides && els.asides.classList.contains('open')) return false;
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
    var entries = railEntries();
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
    // Opened from the context menu, the composer starts holding the action:
    // `@visualize `, with the space, so a qualifier can be typed straight on.
    // The `@agent` in front of it comes from the audience chip below, which
    // already meant "route this to the agent" before this feature existed.
    if (state.composeSeed) ta.value = state.composeSeed;
    var row = create('div', { class: 'sf-compose-foot' });
    var aud = audienceChips(ta);
    var save = create('button', { class: 'sf-primary', type: 'button' }, 'Comment');
    function submit() {
      var body = aud.body();
      if (!body) return;
      postJSON(API, withAuthor({ anchor: anchor, body: body }))
        .then(function (r) {
          if (!r.ok) return flashErr('Could not add the comment.');
          state.composeEl = null;
          load();
        }).catch(function () { flashErr('Could not add the comment.'); });
    }
    save.onclick = function (e) { e.stopPropagation(); submit(); };
    row.appendChild(create('span', { class: 'sf-hint' }, MOD_HINT + ' to comment'));
    row.appendChild(save);
    b.appendChild(ta); b.appendChild(aud.el); b.appendChild(row);
    wireInput(ta, submit);
    setTimeout(function () { try { ta.focus(); } catch (e) {} }, 0);
    return b;
  }
  function openRailCompose(el, seed) {
    state.active = null;      // a composer and an expanded thread are exclusive
    setSidebar(false);        // composing claims the gutter; the drawer would hide the rail
    state.composeEl = el;
    // Cleared rather than left alone: a plain click on a block after an action
    // must open an empty composer, not the last action you picked.
    state.composeSeed = seed || '';
    ensureAnchorVisible(el);
    render();
  }
  function cancelCompose() {
    if (!state.composeEl) return;
    state.composeEl = null;
    state.composeSeed = '';
    render();
  }

  // Collapsed bubble: who started the thread, a one-line snippet, and the reply
  // count. Initials (H/C) rather than icons — the product UI carries no emoji.
  function bubble(t, el) {
    var orphan = isOrphan(t);
    var b = create('button', { class: 'sf-bub' + (orphan ? ' sf-bub-orphan' : ''), type: 'button', 'data-tid': t.id });
    b._anchor = el; // the measured element, re-read every pass
    var first = t.comments[0] || {};
    var claude = isAgentComment(first);
    b.innerHTML = '<span class="sf-bub-who' + (claude ? ' claude' : '') + '" title="' + esc(first.author || '') + '">' + initialOf(first) + '</span>' +
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
      (isAgentComment(t.comments[0]) ? ' claude' : '') + '" title="' +
      esc((t.comments[0] && t.comments[0].author) || '') + '">' +
      initialOf(t.comments[0]) + '</span>' +
      '<span class="sf-badge ' + esc(t.state) + '">' + esc(t.state) + '</span>' +
      '<button class="sf-bub-x" type="button" aria-label="Collapse thread">×</button></div>' +
      t.comments.map(commentHTML).join('');
    b.onclick = function (e) { e.stopPropagation(); }; // using the card must not dismiss it
    b.querySelector('.sf-bub-x').onclick = function (e) { e.stopPropagation(); collapseThread(); };
    wireCommentEdits(b, t);
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
    var aud = audienceChips(ta);
    var send = create('button', { class: 'sf-primary', type: 'button' }, 'Reply');
    function submit() {
      var body = aud.body();
      if (!body) return;
      postJSON(API + '/' + t.id + '/reply', withAuthor({ body: body })).then(load);
    }
    send.onclick = function (e) { e.stopPropagation(); submit(); };
    var res = create('button', { class: 'sf-bub-resolve', type: 'button' }, 'Resolve');
    // Only drop the expanded thread if the server actually resolved it — fetch
    // fulfills on 4xx/5xx too, so an unchecked .then() would collapse the card
    // as though it had worked and swallow the failure.
    res.onclick = function (e) {
      e.stopPropagation();
      postJSON(API + '/' + t.id + '/resolve').then(function (r) {
        if (!r.ok) return flashErr('Could not resolve the thread.');
        state.active = null;
        load();
      }).catch(function () { flashErr('Could not resolve the thread.'); });
    };
    // Same rule as the sidebar card: a reader of a published copy replies, and
    // the owner closes.
    if (!isPublishedCopy()) row.appendChild(res);
    row.appendChild(send);
    b.appendChild(ta); b.appendChild(aud.el); b.appendChild(row);
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
    // A deck fills its stage edge to edge — there is no gutter beside the slide
    // to hang a rail in, and clamping one to the window put it half off screen.
    // So the comments sit ON the slide they annotate, inset from its right edge:
    // the "anchored to the container" reading of a margin comment, for a layout
    // that has no margin.
    var slides = deckSlides();
    if (slides) {
      var cur = slides[currentSlideIndex(slides)];
      var rect = cur && cur.getBoundingClientRect();
      if (rect && rect.width) {
        var w = els.rail.offsetWidth || 272;
        els.rail.style.left = Math.max(RAIL_MARGIN, rect.right - w - DECK_INSET) + 'px';
        els.rail.style.right = 'auto';
        return;
      }
    }
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
    var bySlide = offSlideCounts();
    if (bySlide) renderOffscreenChips(bySlide.before, bySlide.after);
    else renderOffscreenChips(above, below);
  }

  /**
   * On a deck, what is out of sight is on another slide, not further down the
   * page — so count earlier and later slides. Returns null off a deck, which is
   * how the caller picks between the two meanings.
   */
  function offSlideCounts() {
    var slides = deckSlides();
    if (!slides) return null;
    var cur = currentSlideIndex(slides);
    var before = 0, after = 0;
    railThreads().forEach(function (r) {
      var i = slideIndex(slides, slideOf(r.el));
      if (i < 0 || i === cur) return;
      if (i < cur) before++; else after++;
    });
    return { before: before, after: after };
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
  // simply invisible. Clicking jumps to the nearest one in that direction. On a
  // deck the same two chips mean earlier and later SLIDES, and clicking pages
  // there, so they are labelled for what they actually cross.
  function renderOffscreenChips(above, below) {
    if (!els.rail) return;
    Array.prototype.forEach.call(els.rail.querySelectorAll('.sf-rail-chip'), function (c) { c.remove(); });
    var deck = !!deckSlides();
    if (above) els.rail.appendChild(chip('above', '↑ ' + above + (deck ? ' earlier' : ' above')));
    if (below) els.rail.appendChild(chip('below', '↓ ' + below + (deck ? ' later' : ' below')));
  }
  function chip(dir, label) {
    var c = create('button', { class: 'sf-rail-chip sf-rail-' + dir, type: 'button' }, label);
    c.onclick = function (e) {
      e.stopPropagation();
      if (jumpSlide(dir)) return;
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

  /**
   * Page to the nearest slide in `dir` that carries a comment. The chip counted
   * slides, so it navigates slides — a scrollIntoView on a display:none block
   * does nothing at all, which is why these chips read as dead on a deck.
   * @returns {boolean} whether this was a deck and the jump was handled
   */
  function jumpSlide(dir) {
    var slides = deckSlides();
    if (!slides) return false;
    var cur = currentSlideIndex(slides);
    var best = -1;
    railThreads().forEach(function (r) {
      var i = slideIndex(slides, slideOf(r.el));
      if (i < 0) return;
      if (dir === 'above' ? i >= cur : i <= cur) return;
      // Nearest in that direction: the largest index before, the smallest after.
      if (best < 0 || (dir === 'above' ? i > best : i < best)) best = i;
    });
    if (best >= 0) showSlide(slides[best]);
    return true;
  }

  /**
   * A count badge on each filmstrip entry whose slide carries live comments.
   *
   * On a scrolling spec the rail is the map: every comment on the document is
   * somewhere on the same page. A deck hides 21 slides out of 22, so without
   * this there is nothing to tell you a slide has comments except opening it.
   *
   * Keyed off the filmstrip's own `href="#<slide id>"`, which is the contract
   * the deck already uses to page itself, so the badge lands on whatever
   * navigation a deck happens to render.
   */
  function renderSlideCounts() {
    Array.prototype.forEach.call(document.querySelectorAll('.sf-fs-count'), function (c) { c.remove(); });
    Array.prototype.forEach.call(document.querySelectorAll('.sf-fs-has'), function (a) { a.classList.remove('sf-fs-has'); });
    var slides = deckSlides();
    if (!slides) return;
    var counts = {};
    railThreads().forEach(function (r) {
      var s = slideOf(r.el);
      if (s && s.id) counts[s.id] = (counts[s.id] || 0) + 1;
    });
    Array.prototype.forEach.call(document.querySelectorAll('nav a[href^="#"]'), function (a) {
      // The review layer's own TOC drawer links to the same slides. Badging it
      // too would put a count in a panel that is closed by default, styled for a
      // thumbnail it does not have.
      if (inUI(a)) return;
      var n = counts[a.getAttribute('href').slice(1)];
      if (!n) return;
      a.classList.add('sf-fs-has');
      a.appendChild(create('span', {
        class: 'sf-fs-count',
        title: n + (n === 1 ? ' comment' : ' comments') + ' on this slide',
      }, String(n)));
    });
  }

  /** Live threads nobody addressed to the agent: conversation, not a queue. */
  function discussionCount() {
    return state.threads.filter(function (t) {
      return t.state !== 'resolved' && !inAgentLoop(t);
    }).length;
  }

  function pendingCount() {
    // A thread needs submitting if it's live (not resolved), addressed to the
    // agent, and carries any un-submitted human comment — `some`, not `every`,
    // so a reopened thread whose older comments were already submitted (have a
    // batchId) still counts. Discussion is excluded: offering to submit it
    // would submit nothing.
    return state.threads.filter(function (t) {
      return t.state !== 'resolved'
        && isForAgentThread(t)
        && t.comments.some(function (c) { return !isAgentComment(c) && !c.batchId; });
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

  /** True on a published copy, which is to say: the reader is not the owner. */
  function isPublishedCopy() {
    return (window.SPECFORGE || {}).transport === 'poll';
  }

  /**
   * Who a comment is for, as two chips instead of remembering to type @agent.
   *
   * The mention stays the only thing that routes a comment, here and on the
   * server; these chips write it for you. The alternative was a second field
   * meaning the same thing, which is two sources of truth for one question and
   * a thread whose text no longer says who it was addressed to.
   *
   * The default differs by who is reading. An owner's comments are nearly always
   * work for their own agent; a reviewer's are nearly always a question for a
   * person, and a reviewer who submits to someone else's agent by accident
   * cannot easily undo it.
   */
  function audienceChips(ta) {
    var forAgent = !isPublishedCopy();
    var wrap = create('span', { class: 'sf-aud' });
    var agentBtn = create('button', {
      class: 'sf-aud-chip', type: 'button',
      title: 'Work for the agent. Sends @agent with your comment.',
    }, '@agent');
    var humanBtn = create('button', {
      class: 'sf-aud-chip', type: 'button',
      title: 'A question or note for a person. Never reaches an agent.',
    }, 'discussion');

    function paint() {
      agentBtn.classList.toggle('on', forAgent);
      humanBtn.classList.toggle('on', !forAgent);
      agentBtn.setAttribute('aria-pressed', forAgent ? 'true' : 'false');
      humanBtn.setAttribute('aria-pressed', forAgent ? 'false' : 'true');
    }
    function pick(next) {
      forAgent = next;
      // Chosen "discussion" while the text already says @agent: the text wins
      // over the chip unless the mention goes, so it goes. Doing nothing would
      // leave a chip that says one thing and a comment that does another.
      if (!forAgent && mentionsAgentBody(ta.value)) {
        ta.value = ta.value.replace(/@agent(?![a-z0-9_-])\s*/gi, '').trim();
        autoGrow(ta);
      }
      paint();
    }
    agentBtn.onclick = function (e) { e.stopPropagation(); pick(true); };
    humanBtn.onclick = function (e) { e.stopPropagation(); pick(false); };
    // Typing the mention by hand raises the chip, so a comment that says @agent
    // never sits under a chip that says discussion. The sync only goes up: text
    // without a mention means nothing, since writing it is exactly the work the
    // chip does for you. Mirroring downward would clear the owner's default on
    // their first keystroke.
    ta.addEventListener('input', function () {
      if (!forAgent && mentionsAgentBody(ta.value)) { forAgent = true; paint(); }
    });

    paint();
    wrap.appendChild(agentBtn);
    wrap.appendChild(humanBtn);
    return {
      el: wrap,
      /** The body to send: the mention added when it is missing. */
      body: function () {
        var v = ta.value.trim();
        if (!forAgent || !v || mentionsAgentBody(v)) return v;
        return '@agent ' + v;
      },
    };
  }


  /**
   * ⌘/Ctrl+S submits the batch.
   *
   * Submitting is the one thing on this page you do repeatedly and cannot do
   * from the keyboard, and Save is what the reflex already reaches for on a
   * document. Nothing here is ever unsaved — comments are written the moment you
   * post them — so the browser's Save Page is not a shortcut anyone is giving up.
   *
   * It is bound to submitting specifically, not to "whatever the button says".
   * The same button also approves a spec, and a reflex keystroke that silently
   * approved something would be a bad trade for a saved click.
   */
  function onSaveKey(e) {
    e.preventDefault(); // no "save this page as HTML" on a spec, in any state
    var s = actionState();
    if (s.act === 'submit') return submitBatch();
    if (draftText()) return; // submitBatch said why
    // Pressed with nothing to send. Say which, rather than appearing to be a
    // dead key — the counts are already in the footer but the drawer may be shut.
    var d = discussionCount();
    if (d) return flashErr(d + (d === 1 ? ' open thread is' : ' open threads are') + ' discussion — add @agent to send one.');
    flashErr('Nothing to submit.');
  }

  /**
   * Text typed into a composer or reply box and not yet posted, if any.
   *
   * Submitting reloads the comment layer, which rebuilds every card from the
   * store — and an unposted draft is not in the store, so it goes. The six-second
   * poll already refuses to run for this reason; submitting has to refuse for the
   * same one, and it matters more now that a keystroke can reach it mid-sentence.
   */
  function draftText() {
    var boxes = document.querySelectorAll('#sf-rail textarea, #sf-sidebar textarea');
    for (var i = 0; i < boxes.length; i++) {
      var v = (boxes[i].value || '').trim();
      if (v) return v;
    }
    return '';
  }

  function submitBatch() {
    // Never at the cost of something written and not yet posted.
    if (draftText()) return flashErr('Post your comment first (' + MOD_HINT + '), then submit.');
    postJSON(API + '/submit', {}).then(function (r) {
      if (r.ok) load();
      else flash('Batch submit activates in the review-loop stage.');
    }).catch(function () { flashErr('Could not submit batch.'); });
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
    // On a deck the block may be on a slide that is not rendered, where a scroll
    // reaches nothing. Page there first; the slide change re-renders the rail.
    revealSlideFor(el);
    if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // ---------- utils ----------
  function norm(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function inUI(t) {
    while (t) {
      if (t.id === 'sf-sidebar' || t.id === 'sf-compose' || t.id === 'sf-launcher' ||
          t.id === 'sf-menu' || t.id === 'sf-live' || t.id === 'sf-toc' || t.id === 'sf-top' ||
          t.id === 'sf-titlebar' || t.id === 'sf-rail' || t.id === 'sf-tocbtn' ||
          t.id === 'sf-ctx') return true;
      // An aside's header strip is chrome sitting inside a section of the
      // document. The section is commentable; the strip that folds it away and
      // the buttons that answer it are not. Deliberately NOT #sf-asides itself:
      // the panel holds real sections of the spec, and excluding the container
      // would make everything it carries uncommentable, which is the whole
      // reason an aside is modelled as a section.
      if (t.classList
        && (t.classList.contains('sf-aside-head')
          || t.classList.contains('sf-asides-head')
          || t.classList.contains('sf-aside-mark'))) return true;
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
        .replace(/\*(\S(?:[^*\n]*\S)?)\*/g, '<em>$1</em>')         // *italic* (no inner-edge spaces)
        // @name reads as addressing, so it should look like it. The agent's own
        // mention is marked apart, since that one decides whether a thread is
        // work. Applied after escaping, and never inside a code span, which is
        // the same rule the routing uses.
        .replace(/@([a-z0-9_-]+)/gi, function (m, name) {
          var agent = name.toLowerCase() === 'agent';
          return '<span class="sf-at' + (agent ? ' sf-at-agent' : '') + '">' + m + '</span>';
        });
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
  /**
   * Every message this layer shows, through the one snackbar the home page uses
   * too (server/public/ui.js). It used to be a box of its own in the opposite
   * corner that always faded after three seconds, which meant a failure and a
   * copied link looked and behaved identically.
   *
   * `tone` is 'err' for anything reporting that something did not happen; those
   * stay up longer, because a failure is read rather than glimpsed.
   */
  function flash(msg, tone) {
    if (window.SFUI) return window.SFUI.snack(msg, { tone: tone });
    // ui.js is a separate <script>; if it did not load, saying nothing would be
    // worse than saying it plainly.
    var n = create('div', { class: 'sf-flash', role: 'status' }, msg);
    n.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2147483000;background:var(--sf-panel);border:1px solid var(--sf-line);color:var(--sf-ink);border-radius:10px;padding:10px 14px;font:13px system-ui';
    document.body.appendChild(n);
    setTimeout(function () { n.remove(); }, 4000);
    return { dismiss: function () { n.remove(); } };
  }
  /** The failing half of flash — everything that reports something did not happen. */
  function flashErr(msg) { return flash(msg, 'err'); }
  /**
   * Ask first. Falls through to doing it when ui.js is absent, because a missing
   * script must not silently disable a control the page still shows.
   */
  function confirmThen(o) {
    if (window.SFUI) return window.SFUI.confirm(o);
    o.onOk();
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
  // Same rule as the review layer above: how you read a spec is yours. The
  // server value seeds a browser that has none; the browser owns it after that.
  var SPEC_STORE_KEY = 'sf-prefs:' + SF.specId;
  var PREFS = (function () {
    var out = {};
    var seed = SF.prefs || {};
    for (var k in seed) if (Object.prototype.hasOwnProperty.call(seed, k)) out[k] = seed[k];
    try {
      var raw = window.localStorage.getItem(SPEC_STORE_KEY);
      var local = raw ? JSON.parse(raw) : null;
      if (local && typeof local === 'object') {
        for (var j in local) if (Object.prototype.hasOwnProperty.call(local, j)) out[j] = local[j];
      }
    } catch (e) { /* storage blocked or corrupt: the seed stands */ }
    return out;
  })();
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
    // Written into the same per-spec bucket the review layer uses, so the two
    // read each other rather than drifting apart.
    try {
      var raw = window.localStorage.getItem(SPEC_STORE_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      if (!obj || typeof obj !== 'object') obj = {};
      obj.toc = state;
      PREFS.toc = state;
      window.localStorage.setItem(SPEC_STORE_KEY, JSON.stringify(obj));
    } catch (e) { /* not fatal: the panel still works this session */ }
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
    // An aside is a section, and it is deliberately not in the outline: it lives
    // until the reader imports or dismisses it, so listing it would rewrite the
    // contents every time an action runs. A spec with its own nav.toc excludes
    // asides by construction, since nothing links them; this is the other path.
    var secs = document.querySelectorAll('section[id]:not([data-sf-aside])');
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
