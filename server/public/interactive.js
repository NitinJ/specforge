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
    return el ? el.textContent.replace(/\s+$/, '') : '';
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
      return navigator.clipboard.writeText(text);
    }
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

  // ---------- boot ----------

  var booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    goLive();
    initCopy();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  // Re-run after a live reload replaces the document's blocks. review.js
  // reloads the whole page rather than patching it, so this is for the aside
  // and action paths that rewrite a section in place.
  document.addEventListener('sf-content-changed', function () { initCopy(); });
})();
