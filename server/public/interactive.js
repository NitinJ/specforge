/* SpecForge interactive components. Vanilla, dependency-free.
 *
 * The enhanced half of the interactive library. Everything here REDUCES a
 * document that is already complete: it never builds a component out of
 * nothing, and it never reveals content that was not on the page before it ran.
 * That is what lets a spec render fully from file:// with no network, which the
 * house rules require and the markdown exporter depends on.
 *
 * The contract, in two halves:
 *
 *   1. The stamped stylesheet may not hide content. Every rule that hides is
 *      written under [data-sf-live], which only this file sets. A document that
 *      never runs this script therefore never hides anything.
 *   2. This file is served, never stamped. A spec file gains no <script> from
 *      the library, which matters because specs are imported from untrusted
 *      markdown and published to readers who are not the author.
 *
 * Loaded on demand by review.js, only for a document that contains something
 * for it to do, in the same way the highlighter and the diagram renderer are.
 */
(function () {
  'use strict';

  var LIVE = 'data-sf-live';

  /* Marks the document live. Nothing here removes content before this lands,
   * because the CSS that hides is keyed on it — so a failure to reach this line
   * leaves a complete document rather than a half-reduced one. */
  function goLive() {
    document.documentElement.setAttribute(LIVE, '');
  }

  // ---------- copy ----------
  //
  // The code a reader copies is the code as authored, which is not always the
  // code on screen: the highlighter wraps every token in a <span>, and a
  // filename caption sits inside the same block. textContent of the <code>
  // element gives back exactly what was written, spans and all, and excludes
  // the caption because the caption is not inside it.

  var COPIED_MS = 1600;

  function codeOf(block) {
    var el = block.querySelector('pre code') || block.querySelector('pre');
    // Verbatim. Nothing is trimmed, because nothing here can tell an artifact of
    // the markup from the author's own text: a hand-written block usually has a
    // newline before `</code>` that means nothing, and a block imported from a
    // fenced markdown block has one that means something, and they are the same
    // character. Two guesses were tried and both lost real content — `\s+$` took
    // the two trailing spaces that are a hard line break, `\n+$` took a
    // deliberate final blank line. The control hands over what the block
    // contains, which is a rule with no edge cases, and a trailing newline
    // pasted into a shell simply runs the command.
    return el ? el.textContent : '';
  }

  /* Clipboard, with the pre-permission fallback.
   *
   * navigator.clipboard is unavailable on a page served over plain http to
   * anything but localhost, which is exactly what a published spec on a tunnel
   * used to be. The textarea path is ugly and works everywhere, and a copy
   * button that silently does nothing is worse than an ugly one.
   */
  function write(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      // Falls THROUGH to the textarea on rejection, not just on absence. The API
      // being present says nothing about it being permitted: a denied clipboard
      // permission, or a document that was not focused at the moment of the
      // call, rejects — and returning that rejection straight to the caller
      // skipped a fallback that would have worked.
      return navigator.clipboard.writeText(text).catch(function () { return legacyWrite(text); });
    }
    return legacyWrite(text);
  }

  function legacyWrite(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta);
      if (ok) resolve(); else reject(new Error('copy refused'));
    });
  }

  function addCopy(block) {
    if (block.querySelector(':scope > .copy')) return;
    if (!codeOf(block)) return; // a codeblock with no code has nothing to offer
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'copy';
    b.textContent = 'Copy';
    // Named for what it copies, because a page of code blocks otherwise
    // announces "Copy" a dozen times with nothing to tell them apart.
    var name = block.querySelector('.filename');
    b.setAttribute('aria-label', name ? 'Copy ' + name.textContent.trim() : 'Copy code');
    b.addEventListener('click', function () {
      write(codeOf(block)).then(function () {
        b.classList.add('copied');
        b.textContent = 'Copied';
        setTimeout(function () {
          b.classList.remove('copied');
          b.textContent = 'Copy';
        }, COPIED_MS);
      }).catch(function () {
        b.textContent = 'Press ⌘C';
        setTimeout(function () { b.textContent = 'Copy'; }, COPIED_MS);
      });
    });
    block.appendChild(b);
  }

  function initCopy() {
    Array.prototype.forEach.call(document.querySelectorAll('.codeblock'), addCopy);
  }

  // ---------- tabs ----------
  //
  // The panels are authored visible and in order. This adds the strip and hides
  // all but one, so a document that never reaches here is complete and longer
  // rather than truncated — the same fallback GOV.UK ships for their tabs.
  //
  // Selection lives in the URL fragment (D7). Nothing is written to the store or
  // to local storage, so no reader state is persisted; a live reload during
  // review lands on the same panel; and a panel becomes deep-linkable, which is
  // what lets a comment anchored inside a hidden one be scrolled to at all.
  //
  // Written with replaceState, which means the BACK BUTTON DOES NOT step through
  // selections. That is the trade: pushState would give back-between-tabs and
  // fill the history with a dozen entries a reader never asked for, and
  // assigning location.hash would scroll the panel to the top of the viewport on
  // every switch. An earlier draft of this file claimed back navigation worked;
  // it did not, and the claim is corrected here and in the spec rather than in
  // the behaviour.

  var TAB_PREFIX = 'tab-';

  function panelsOf(group) {
    return Array.prototype.filter.call(group.children, function (el) {
      return el.classList && el.classList.contains('tab');
    });
  }

  function labelOf(panel, i) {
    return panel.getAttribute('data-label') || 'Panel ' + (i + 1);
  }

  /**
   * How many elements in the document carry this id.
   *
   * Counted by comparing `.id`, never by building a `[id="…"]` selector. An id
   * is allowed almost any character, and a selector built from one with a
   * backslash, a bracket or a newline in it either matches the wrong thing or
   * throws — and a throw here would abort initTabs part-way and leave every
   * later group on the page unbuilt, which is the failure this file already had
   * once from decodeURIComponent.
   */
  function idCount(id) {
    var all = document.querySelectorAll('[id]');
    var n = 0;
    for (var i = 0; i < all.length; i++) if (all[i].id === id) n += 1;
    return n;
  }

  /**
   * A stable, document-unique id for a panel, so the fragment survives edits.
   *
   * Uniqueness is checked against the document rather than assumed from the
   * group index and the label: two panels in one group can carry the same label,
   * and the slug can collide with an id the author already used. A collision
   * would point a deep link and an `aria-controls` at the wrong element, which
   * is worse than an ugly id.
   */
  function panelId(group, panel, gi, pi) {
    // An authored id is kept, because it is a contract with whatever links to
    // it — UNLESS the document already uses it twice, in which case it is not an
    // identity at all: getElementById answers with the first one, so the
    // fragment restores the wrong panel and every aria-controls pointing here
    // resolves somewhere else. A duplicate is replaced rather than trusted.
    if (panel.id && idCount(panel.id) === 1) return panel.id;
    var slug = labelOf(panel, pi).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    var base = TAB_PREFIX + (gi + 1) + '-' + (slug || pi + 1);
    var id = base;
    var n = 2;
    while (document.getElementById(id)) { id = base + '-' + n; n += 1; }
    panel.id = id;
    return id;
  }

  /** The fragment, or '' when it is malformed. */
  function currentFragment() {
    var raw = (location.hash || '').slice(1);
    if (!raw) return '';
    // decodeURIComponent throws on a lone `%` or a bad escape. Thrown from
    // inside the group loop it aborted initTabs part-way, leaving every later
    // tab group on the page unbuilt — a malformed URL somebody pasted breaking
    // components further down the document.
    try {
      return decodeURIComponent(raw);
    } catch (e) {
      return raw;
    }
  }

  function select(group, index) {
    var panels = panelsOf(group);
    var strip = group.querySelector(':scope > .sf-tablist');
    panels.forEach(function (p, i) {
      var on = i === index;
      p.hidden = !on;
      var btn = strip.children[i];
      btn.classList.toggle('sf-selected', on);
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
      // Only the selected tab is in the tab order; arrow keys move within the
      // strip. That is the roving-tabindex the ARIA tabs pattern specifies, and
      // it is why Tab lands on the panel rather than on the next label.
      btn.tabIndex = on ? 0 : -1;
    });
  }

  /**
   * Select a panel AND record it in the fragment. Every control uses this.
   *
   * replaceState rather than assigning location.hash, which would scroll the
   * panel to the top of the viewport and yank the page out from under a reader
   * who only wanted a different tab. See the note above on what that costs.
   */
  function choose(group, index) {
    select(group, index);
    var panel = panelsOf(group)[index];
    if (!panel || !panel.id) return;
    try {
      history.replaceState(null, '', '#' + encodeURIComponent(panel.id));
    } catch (e) { /* file:// refuses; the selection still stands */ }
  }

  function initTabs() {
    var groups = document.querySelectorAll('.tabs');
    var want = currentFragment();
    Array.prototype.forEach.call(groups, function (group, gi) {
      if (group.querySelector(':scope > .sf-tablist')) return;
      var panels = panelsOf(group);
      if (panels.length < 2) return; // one alternative is not a choice

      var strip = document.createElement('div');
      strip.className = 'sf-tablist';
      strip.setAttribute('role', 'tablist');

      panels.forEach(function (panel, pi) {
        var id = panelId(group, panel, gi, pi);
        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sf-tab';
        btn.textContent = labelOf(panel, pi);
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-controls', id);
        // One entry point for both, so the fragment cannot fall out of step with
        // what is on screen. It did: the click handler updated the URL and the
        // arrow keys did not, so navigating by keyboard and then reloading put
        // the reader back on whichever panel was last CLICKED.
        btn.addEventListener('click', function () { choose(group, pi); });
        btn.addEventListener('keydown', function (e) {
          var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
          if (!d) return;
          e.preventDefault();
          var next = (pi + d + panels.length) % panels.length;
          choose(group, next);
          strip.children[next].focus();
        });
        panel.setAttribute('role', 'tabpanel');
        panel.setAttribute('aria-label', labelOf(panel, pi));
        strip.appendChild(btn);
      });

      group.insertBefore(strip, group.firstChild);

      // The fragment wins over the default, so a link into a panel opens it.
      // `select`, not `choose`: reading the URL must not rewrite it, or the
      // first group on the page would claim the fragment from a later one.
      var found = panels.findIndex(function (p) { return p.id === want; });
      select(group, found >= 0 ? found : 0);
    });
  }

  /**
   * Open the panel holding an element, and return whether anything moved.
   *
   * The tab equivalent of opening a collapsed disclosure: a comment anchored in
   * a hidden panel, or a rail link targeting one, otherwise scrolls to nothing.
   * Exposed on window because review.js owns every scroll site and this file is
   * loaded after it.
   */
  function revealTab(el) {
    var moved = false;
    for (var n = el; n; n = n.parentElement) {
      if (!n.classList || !n.classList.contains('tab')) continue;
      var group = n.parentElement;
      if (!group || !group.classList.contains('tabs')) continue;
      // `choose`, not `select`: revealing a panel to scroll a comment into it IS
      // a selection, and leaving the fragment behind meant a reload took the
      // reviewer back to whichever panel was last clicked rather than the one
      // they were reading.
      var i = panelsOf(group).indexOf(n);
      if (i >= 0 && n.hidden) { choose(group, i); moved = true; }
    }
    return moved;
  }
  window.sfRevealTab = revealTab;

  // ---------- sortable ----------
  //
  // Sorting is a view a reader asks for, never a change to the document. The
  // authored order is kept and restored on the third activation of a column, so
  // a reader can always get back to what the author meant, and nothing here
  // touches the markdown export or the un-enhanced page.

  /* Compare two cells the way a reader expects rather than the way strings sort.
   *
   * A spec's tables are mostly measurements, and lexical order puts 1601 before
   * 97 and "10 MB" before "9 MB". Numbers are compared as numbers when BOTH
   * cells parse as one; everything else falls back to a locale compare, which
   * gets accented names and case right where a raw < does not.
   *
   * The leading symbol strip is for currency and the trailing one for units, so
   * "$1,200" and "8 KB" both read as numbers. A cell that is a number followed
   * by prose is not one, which is why the pattern is anchored.
   */
  function cellValue(td) {
    return (td ? td.textContent : '').trim();
  }

  function asNumber(s) {
    var m = /^[^\d\-+.]*([-+]?[\d,]*\.?\d+)(?:\s*[^\s\d]*)?$/.exec(s);
    if (!m) return null;
    var n = parseFloat(m[1].replace(/,/g, ''));
    return isNaN(n) ? null : n;
  }

  function compare(a, b) {
    var na = asNumber(a);
    var nb = asNumber(b);
    if (na !== null && nb !== null) return na - nb;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  }

  function initSortable() {
    Array.prototype.forEach.call(document.querySelectorAll('table.sortable'), function (table) {
      if (table.hasAttribute('data-sf-sortable')) return;
      table.setAttribute('data-sf-sortable', '');
      var body = table.querySelector('tbody');
      var heads = table.querySelectorAll('thead th');
      if (!body || !heads.length) return;

      // The authored order, captured before anything moves. Restoring from a
      // stored copy rather than by sorting on an implied column is what makes
      // "back to what the author wrote" exact.
      var original = Array.prototype.slice.call(body.rows);

      // ONE cycle for the table, not one per column. Held per column, clicking
      // A then B then A resumed A's old position and jumped straight to
      // descending, so returning to a column you had already sorted skipped
      // ascending entirely.
      var activeCol = -1;
      var state = 0; // 0 authored, 1 ascending, 2 descending

      function apply(col) {
        Array.prototype.forEach.call(heads, function (o, i) {
          if (i === col && state !== 0) {
            o.setAttribute('aria-sort', state === 1 ? 'ascending' : 'descending');
          } else {
            o.removeAttribute('aria-sort');
          }
        });
        if (state === 0) {
          original.forEach(function (r) { body.appendChild(r); });
          return;
        }
        var rows = Array.prototype.slice.call(body.rows);
        rows.sort(function (x, y) {
          var d = compare(cellValue(x.cells[col]), cellValue(y.cells[col]));
          return state === 1 ? d : -d;
        });
        rows.forEach(function (r) { body.appendChild(r); });
      }

      Array.prototype.forEach.call(heads, function (th, col) {
        // A real <button> INSIDE the th, which is what the ARIA authoring
        // practices' sortable-table example does. Putting role="button" on the
        // th itself overrides its native `columnheader` role, and a cell that is
        // no longer a column header loses its association with the cells below
        // it and makes aria-sort meaningless — the attribute is defined on a
        // header, not on a button. The button also brings Enter and Space and
        // the tab stop for free, which is three fewer things to implement.
        // A header that already holds a control is left alone, and its column
        // stays unsorted. Moving a link or a button inside this one would nest
        // interactive content — invalid, and unreachable by keyboard — and every
        // press of the inner control would also sort the table. An author who
        // put a control in a header meant it to do its own job.
        if (th.querySelector('a[href], button, input, select, textarea, [tabindex]')) return;

        var btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'sf-sort';
        while (th.firstChild) btn.appendChild(th.firstChild);
        th.appendChild(btn);

        btn.addEventListener('click', function () {
          if (activeCol !== col) { activeCol = col; state = 1; } else { state = (state + 1) % 3; }
          if (state === 0) activeCol = -1;
          apply(col);
        });
      });
    });
  }

  // ---------- boot ----------

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    goLive();
    initCopy();
    initTabs();
    initSortable();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Re-run after a live reload replaces the document's blocks. review.js
  // reloads the whole page rather than patching it, so this is for the aside
  // and action paths that rewrite a section in place.
  document.addEventListener('sf-content-changed', function () {
    initCopy();
    initTabs();
    initSortable();
  });
})();
