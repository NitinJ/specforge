/* SpecForge review layer client. Vanilla, dependency-free.
 * - Renders anchored comment threads (sidebar + in-document highlights).
 * - Lets a human select text or a section and leave a comment.
 * - Reply / resolve. Batch submit hooks into the review loop (Stage 4). */
(function () {
  'use strict';
  var SPEC = (window.SPECFORGE || {}).specId;
  if (!SPEC) return;
  var API = '/api/spec/' + encodeURIComponent(SPEC) + '/comments';

  var state = { threads: [], filter: 'open', active: null };
  var els = {};

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
  var booted = false;
  function boot() { if (booted) return; booted = true; buildChrome(); load(); }

  // ---------- data ----------
  function load() {
    fetch(API).then(function (r) { return r.json(); }).then(function (d) {
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

    document.addEventListener('mouseup', onSelect);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { hideCta(); hideCompose(); } });
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
      els.threads.innerHTML = '<p style="color:var(--sf-muted);padding:12px">No comments. Select text in the spec to add one.</p>';
      return;
    }
    list.forEach(function (t) {
      var card = create('div', { class: 'sf-thread state-' + t.state });
      if (state.active === t.id) card.classList.add('sf-active');
      var st = (t.resolution && t.resolution.status) || 'section';
      card.innerHTML =
        '<div class="sf-meta"><span class="sf-badge ' + st + '">' + st + '</span>' +
        '<span>' + esc(t.anchor && t.anchor.sectionId || '') + '</span>' +
        '<span style="margin-left:auto">' + esc(t.state) + '</span></div>' +
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
    // clear old
    Array.prototype.forEach.call(document.querySelectorAll('.sf-anchor'), unwrap);
    Array.prototype.forEach.call(document.querySelectorAll('section.sf-section-hl'), function (s) { s.classList.remove('sf-section-hl', 'sf-active'); });
    visible().forEach(function (t) {
      if (t.state === 'resolved') return;
      var section = t.anchor && document.getElementById(t.anchor.sectionId);
      if (!section) return;
      var q = t.anchor.quote;
      var span = q && q.exact ? wrapQuote(section, q.exact, t) : null;
      if (!span) section.classList.add('sf-section-hl');
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

  // ---------- selection → comment ----------
  function onSelect(e) {
    if (inUI(e.target)) return;
    var sel = window.getSelection();
    if (!sel || sel.isCollapsed) { hideCta(); return; }
    var text = sel.toString().replace(/\s+/g, ' ').trim();
    var range = sel.rangeCount ? sel.getRangeAt(0) : null;
    var section = range && closestSection(range.commonAncestorContainer);
    if (!text || !section || !section.id) { hideCta(); return; }
    showCta(range, section);
  }

  function showCta(range, section) {
    hideCta();
    var rect = range.getBoundingClientRect();
    var btn = create('button', { class: 'sf-cta' }, '💬 Comment');
    btn.style.left = (window.scrollX + rect.left + rect.width / 2) + 'px';
    btn.style.top = (window.scrollY + rect.bottom) + 'px';
    btn.onmousedown = function (ev) { ev.preventDefault(); };
    btn.onclick = function () { openCompose(range, section); };
    document.body.appendChild(btn);
    els.cta = btn;
  }
  function hideCta() { if (els.cta) { els.cta.remove(); els.cta = null; } }

  function openCompose(range, section) {
    hideCta();
    hideCompose();
    var quote = makeQuote(section, range);
    var box = create('div', { id: 'sf-compose' });
    box.style.top = (window.scrollY + range.getBoundingClientRect().top) + 'px';
    box.innerHTML = '<div class="q">' + esc(quote.exact.slice(0, 160)) + '</div>';
    var ta = create('textarea', { placeholder: 'Comment…' });
    var row = create('div', { class: 'sf-acts' });
    var save = create('button', { class: 'sf-primary' }, 'Comment');
    var cancel = create('button', { class: 'sf-ghost' }, 'Cancel');
    save.onclick = function () {
      if (!ta.value.trim()) return;
      postJSON(API, { anchor: { sectionId: section.id, quote: quote }, body: ta.value.trim(), author: 'human' })
        .then(function () { hideCompose(); els.sidebar.classList.add('open'); load(); });
    };
    cancel.onclick = hideCompose;
    row.appendChild(save); row.appendChild(cancel);
    box.appendChild(ta); box.appendChild(row);
    document.body.appendChild(box);
    els.compose = box;
    ta.focus();
  }
  function hideCompose() { if (els.compose) { els.compose.remove(); els.compose = null; } }

  function submitBatch() {
    postJSON(API + '/submit', {}).then(function (r) {
      if (r.ok) load();
      else flash('Batch submit activates in the review-loop stage.');
    }).catch(function () { flash('Could not submit batch.'); });
  }

  // ---------- anchoring (DOM) ----------
  function activate(id, scroll) {
    state.active = id;
    renderSidebar();
    var hl = document.querySelector('[data-thread="' + id + '"]');
    var thread = state.threads.find(function (t) { return t.id === id; });
    var target = hl || (thread && document.getElementById(thread.anchor.sectionId));
    Array.prototype.forEach.call(document.querySelectorAll('.sf-active'), function (e) { if (e.dataset) e.classList.remove('sf-active'); });
    if (hl) hl.classList.add('sf-active');
    else if (target) target.classList.add('sf-active');
    if (scroll && target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function wrapQuote(section, exact, thread) {
    var walker = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, null);
    var node;
    while ((node = walker.nextNode())) {
      var idx = node.nodeValue.indexOf(exact);
      if (idx !== -1) {
        try {
          var range = document.createRange();
          range.setStart(node, idx);
          range.setEnd(node, idx + exact.length);
          var span = document.createElement('span');
          span.className = 'sf-anchor' + (thread.resolution && thread.resolution.status === 'moved' ? ' moved' : '');
          span.setAttribute('data-thread', thread.id);
          span.onclick = function (e) { e.stopPropagation(); activate(thread.id, false); els.sidebar.classList.add('open'); };
          range.surroundContents(span);
          return span;
        } catch (e) { return null; }
      }
    }
    return null;
  }
  function unwrap(span) {
    var p = span.parentNode; if (!p) return;
    while (span.firstChild) p.insertBefore(span.firstChild, span);
    p.removeChild(span); p.normalize();
  }

  function makeQuote(section, range) {
    var pre = document.createRange();
    pre.selectNodeContents(section);
    try { pre.setEnd(range.startContainer, range.startOffset); } catch (e) {}
    var offset = pre.toString().length;
    var full = section.textContent;
    var exact = range.toString();
    return {
      exact: exact,
      prefix: full.slice(Math.max(0, offset - 40), offset),
      suffix: full.slice(offset + exact.length, offset + exact.length + 40),
    };
  }

  // ---------- utils ----------
  function closestSection(node) {
    var el = node && node.nodeType === 1 ? node : node && node.parentElement;
    while (el && el !== document.body) {
      if (el.tagName === 'SECTION' && el.id) return el;
      el = el.parentElement;
    }
    return null;
  }
  function inUI(t) {
    while (t) {
      if (t.id === 'sf-sidebar' || t.id === 'sf-compose' || t.id === 'sf-batchbar' ||
          t.id === 'sf-toggle' || (t.classList && t.classList.contains('sf-cta'))) return true;
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
