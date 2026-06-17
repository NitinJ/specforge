/* SpecForge review layer client. Vanilla, dependency-free.
 * Block-level comments: hover any block to highlight it, click to comment.
 * Reply / resolve. Batch submit feeds the review loop.
 *
 * Anchoring is block-level and lives entirely on the client: a comment binds to
 * a block by its document-order index + its normalized text. The server is dumb
 * storage — it never parses the spec. Re-finding a block: try the stored index,
 * else match by text; if neither matches the thread still shows in the sidebar
 * (just without an inline highlight). */
(function () {
  'use strict';
  var SPEC = (window.SPECFORGE || {}).specId;
  if (!SPEC) return;
  var API = '/api/spec/' + encodeURIComponent(SPEC) + '/comments';

  // Elements that can carry a comment. The innermost match under the pointer wins.
  var BLOCK_SEL = 'h1,h2,h3,h4,h5,h6,p,li,tr,td,th,pre,blockquote,figure,.panel,.callout,.card,.stat,.loop .step,.matrix .q,.bar,.ns';
  var INTERACTIVE = 'a,button,input,textarea,select,summary,label';

  var state = { threads: [], filter: 'open', active: null };
  var els = {};

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
  var THEME_KEY = 'sf-theme';
  function applyTheme(next) {
    var root = document.documentElement;
    if (next == null) next = localStorage.getItem(THEME_KEY);
    if (next !== 'light' && next !== 'dark') return; // honor the spec/OS default
    root.setAttribute('data-theme', next);
  }
  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    var next = cur === 'light' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem(THEME_KEY, next); } catch (e) {}
    return next;
  }

  // ---------- container width (review-layer owned) ----------
  var WIDTH_KEY = 'sf-spec-width';
  function widthContainer() {
    return document.querySelector('.deck, .layout, main, article, .container, .wrap') || document.body;
  }
  function applyWidth(px) {
    document.documentElement.style.setProperty('--maxw', px + 'px');
    var c = widthContainer();
    try { c.style.maxWidth = px + 'px'; c.style.marginLeft = 'auto'; c.style.marginRight = 'auto'; } catch (e) {}
  }
  function startWidth() {
    var saved = parseInt(localStorage.getItem(WIDTH_KEY), 10);
    if (saved) return saved;
    var w = widthContainer().getBoundingClientRect().width || 1040;
    return Math.min(1760, Math.max(820, Math.round(w / 20) * 20));
  }

  // ---------- data ----------
  var lastRaw = null;
  function load() {
    fetch(API).then(function (r) { return r.text(); }).then(function (raw) {
      if (raw === lastRaw) return; // unchanged → skip re-render (no flicker)
      lastRaw = raw;
      var d = JSON.parse(raw);
      state.threads = (d && d.threads) || [];
      render();
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
      '<span class="sf-filter">' +
      '<button data-f="open" class="on">Open</button>' +
      '<button data-f="resolved">Resolved</button>' +
      '<button data-f="all">All</button></span></div>' +
      '<div class="sf-threads"></div>';
    document.body.appendChild(els.sidebar);
    els.threads = els.sidebar.querySelector('.sf-threads');
    els.count = els.sidebar.querySelector('.sf-count');
    Array.prototype.forEach.call(els.sidebar.querySelectorAll('.sf-filter button'), function (b) {
      b.onclick = function () {
        state.filter = b.getAttribute('data-f');
        Array.prototype.forEach.call(els.sidebar.querySelectorAll('.sf-filter button'), function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        renderSidebar();
      };
    });

    buildLauncher();

    document.addEventListener('mousemove', onHover);
    document.addEventListener('click', onClick, true); // capture so we can claim a block click
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { clearHover(); hideCompose(); closeMenu(); } });
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
    var comments = menuRow('💬', 'Comments', function () { els.sidebar.classList.toggle('open'); closeMenu(); });
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

    // Submit batch — only when there are comments to submit.
    if (pending) {
      els.menu.appendChild(menuRow('▲', 'Submit batch (' + pending + ')', function () { closeMenu(); submitBatch(); }));
    }

    // Footer — relocate the live-status pill, if present, into the menu.
    var live = document.getElementById('sf-live');
    if (live) {
      var foot = create('div', { class: 'sf-menu-foot' });
      foot.appendChild(live);
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
    range.oninput = function () { applyWidth(range.value); try { localStorage.setItem(WIDTH_KEY, range.value); } catch (e) {} };
    row.appendChild(range);
    return row;
  }
  function themeRow() {
    var cur = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    var row = menuRow('◐', 'Theme', null);
    var val = create('span', { class: 'sf-row-val' }, cur);
    row.querySelector('.sf-row-main').appendChild(val);
    row.onclick = function () { val.textContent = toggleTheme(); };
    return row;
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
  function blockAnchor(el) {
    return { index: commentableBlocks().indexOf(el), tag: el.tagName, text: norm(el.textContent).slice(0, 400) };
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
    if (tid) { activate(tid, false); els.sidebar.classList.add('open'); return; }
    e.preventDefault();
    openCompose(el);
  }

  // ---------- render ----------
  function render() { renderSidebar(); renderHighlights(); renderLauncher(); }

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
    var ta = create('textarea', { placeholder: 'Reply…' });
    var send = create('button', { class: 'sf-primary' }, 'Send');
    send.style.marginTop = '6px';
    send.onclick = function (e) {
      e.stopPropagation();
      if (!ta.value.trim()) return;
      postJSON(API + '/' + t.id + '/reply', { body: ta.value.trim(), author: 'human' }).then(load);
    };
    box.appendChild(ta); box.appendChild(send);
    card.appendChild(box);
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
    // Keep an open menu's rows (badge, Submit batch) in sync with fresh data.
    if (els.menu.classList.contains('open')) buildMenuRows();
  }

  // ---------- compose ----------
  function openCompose(block) {
    hideCompose();
    var anchor = { block: blockAnchor(block) };
    var rect = block.getBoundingClientRect();
    var box = create('div', { id: 'sf-compose' });
    box.style.top = Math.max(8, Math.min(rect.top, window.innerHeight - 220)) + 'px';
    box.innerHTML = '<div class="q">' + esc(anchor.block.text.slice(0, 160)) + '</div>';
    var ta = create('textarea', { placeholder: 'Comment…' });
    var row = create('div', { class: 'sf-acts' });
    var save = create('button', { class: 'sf-primary' }, 'Comment');
    var cancel = create('button', { class: 'sf-ghost' }, 'Cancel');
    save.onclick = function () {
      if (!ta.value.trim()) return;
      postJSON(API, { anchor: anchor, body: ta.value.trim(), author: 'human' })
        .then(function () { hideCompose(); els.sidebar.classList.add('open'); load(); });
    };
    cancel.onclick = hideCompose;
    row.appendChild(save); row.appendChild(cancel);
    box.appendChild(ta); box.appendChild(row);
    document.body.appendChild(box);
    els.compose = box;
    clearHover();
    block.classList.add('sf-block-mark', 'sf-active');
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
