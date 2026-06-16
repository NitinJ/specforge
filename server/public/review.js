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
  var BLOCK_SEL = 'h1,h2,h3,h4,h5,h6,p,li,tr,pre,blockquote,figure,.panel,.callout,.card';
  var INTERACTIVE = 'a,button,input,textarea,select,summary,label';

  var state = { threads: [], filter: 'open', active: null };
  var els = {};

  var booted = false;
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
  function boot() {
    if (booted) return;
    booted = true;
    buildChrome();
    load();
    // Poll so Claude's replies appear without a manual refresh; pause while the
    // composer is open so we don't disrupt the user mid-comment.
    setInterval(function () { if (!els.compose) load(); }, 6000);
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
    els.toggle = create('button', { id: 'sf-toggle' });
    els.toggle.onclick = function () { els.sidebar.classList.toggle('open'); };
    document.body.appendChild(els.toggle);

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

    els.batch = create('div', { id: 'sf-batchbar' });
    els.batch.innerHTML = '<span class="c"></span><button>Submit batch</button>';
    els.batch.querySelector('button').onclick = submitBatch;
    document.body.appendChild(els.batch);

    document.addEventListener('mousemove', onHover);
    document.addEventListener('click', onClick, true); // capture so we can claim a block click
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { clearHover(); hideCompose(); } });
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
  function render() { renderSidebar(); renderHighlights(); renderBatchbar(); }

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

  function renderBatchbar() {
    var pending = state.threads.filter(function (t) {
      return t.state !== 'resolved' && t.comments.every(function (c) { return !c.batchId; });
    }).length;
    els.toggle.innerHTML = '💬 ' + (pending ? '<span class="n">' + pending + '</span>' : 'review');
    if (pending) {
      els.batch.classList.add('show');
      els.batch.querySelector('.c').textContent = pending + (pending === 1 ? ' comment' : ' comments') + ' to submit';
    } else {
      els.batch.classList.remove('show');
    }
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
      if (t.id === 'sf-sidebar' || t.id === 'sf-compose' || t.id === 'sf-batchbar' ||
          t.id === 'sf-toggle' || t.id === 'sf-live') return true;
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
