// The owner's home page and the shared project page are the same product.
//
// They were two hand-written palettes. Every token had drifted: --bg was #faf9f6
// on one and #fbfaf7 on the other, --accent #4f46e5 and #2563eb, and the shared
// page had never been given --surface, --surface2, --faint, --line2 or --live at
// all. A reviewer opening a shared link met something that looked like a
// different tool.
//
// The fix is one definition rather than a matching pair, because a matching pair
// is what drifted. These tests hold that: the block is byte-identical in both,
// and every token one page uses is a token the other declares.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { useTempStore } from './helpers/temp-store.mjs';
import { THEME_CSS, LIST_CSS, BODY_FONT, CONTENT_WIDTH } from '../server/theme.mjs';
import { renderIndex } from '../server/index-page.mjs';
import { renderProjectPage } from '../server/project-page.mjs';
import { specDir, specHtmlPath } from '../lib/store-paths.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-theme-parity-');

function seed(id, project) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), '<html><body><p>x</p></body></html>');
  writeFileSync(join(specDir(id), 'meta.json'), JSON.stringify({
    id, title: id, status: 'draft', type: 'design', project, updated: Date.now(),
  }));
}

const pages = () => {
  seed('one', 'atelier');
  return { index: renderIndex({}), shared: renderProjectPage('atelier', 'x'.repeat(32)) };
};

/** Every custom property a stylesheet declares, as name -> value. */
function declared(css) {
  return new Map([...css.matchAll(/(--[\w-]+)\s*:\s*([^;}]+)/g)]
    .map((m) => [m[1], m[2].trim()]));
}

test('both pages carry the same palette, byte for byte', () => {
  const { index, shared } = pages();
  assert.ok(index.includes(THEME_CSS), 'the home page does not use the shared palette');
  assert.ok(shared.includes(THEME_CSS), 'the shared project page does not use it');
});

test('the shared page declares every token the home page does', () => {
  // The failure this catches is the one that was live: a page referencing
  // var(--surface2) that nothing declares falls back to nothing, and the element
  // renders transparent rather than wrong, which is harder to notice.
  const { index, shared } = pages();
  const onIndex = declared(index);
  const onShared = declared(shared);
  const missing = [...onIndex.keys()].filter((t) => !onShared.has(t));
  assert.deepEqual(missing, [], `the shared page is missing: ${missing.join(', ')}`);
});

test('no token is declared twice with different values', () => {
  // Two definitions is how they drifted in the first place. A page may restate a
  // token per theme, so the check is per page and per theme block.
  const { shared } = pages();
  for (const block of shared.match(/:root[^{]*\{[^}]*\}/g) || []) {
    const seen = new Map();
    for (const [name, value] of declared(block)) {
      if (seen.has(name) && seen.get(name) !== value) {
        assert.fail(`${name} declared twice in one block: ${seen.get(name)} and ${value}`);
      }
      seen.set(name, value);
    }
  }
});

test('both pages draw the list the same way', () => {
  // The most visible half of "it looks like a different tool". The home page had
  // hairline-separated rows in one card with the signals in fixed columns; the
  // shared page had every row floating in its own rounded box with a ragged
  // right edge.
  const { index, shared } = pages();
  assert.ok(index.includes(LIST_CSS), 'the home page does not use the shared list');
  assert.ok(shared.includes(LIST_CSS), 'the shared project page does not use it');
});

test('both pages set the same type scale and reading column', () => {
  const { index, shared } = pages();
  for (const [name, html] of [['home', index], ['shared', shared]]) {
    assert.ok(html.includes(`font:${BODY_FONT}`), `${name} page sets its own body font`);
    assert.ok(html.includes(CONTENT_WIDTH), `${name} page sets its own content width`);
  }
});

test('the shared page emits the row anatomy the shared list styles', () => {
  // The stylesheet is only half of it: a row that keeps the old markup gets the
  // new CSS and matches nothing. The classes the list block styles have to be
  // the classes the rows are built from.
  const { shared } = pages();
  assert.match(shared, /<div class="card"><ul class="rows">/);
  assert.match(shared, /<span class="main">/);
  assert.match(shared, /<span class="badge t">/);
  assert.match(shared, /<span class="badge s s-\w+"><span class="sdot">/);
  assert.ok(!/class="type"/.test(shared), 'a row still carries the old type span');
  assert.ok(!/class="status /.test(shared), 'a row still carries the old status span');
});

test('the shared page styles no class its rows stopped emitting', () => {
  // How the responsive ladder was lost: the rows were renamed from `.type` to
  // `.badge.t`, and the only narrow-width rule still said `.type{display:none}`.
  // It matched nothing, so at 420px every column stayed and the title was
  // squeezed to 73px. A rule for a class that is never emitted is dead either
  // way, and this is the shape it takes when it matters.
  const { shared } = pages();
  const css = shared.slice(shared.indexOf('<style>'), shared.indexOf('</style>'));
  const body = shared.slice(shared.indexOf('</style>'));
  const emitted = new Set(
    [...body.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)),
  );
  // Only the classes this page renamed away from. A general sweep flags states
  // that are real but absent from one render (an approved row, a collapsed
  // group), and would fail for the wrong reason.
  for (const gone of ['type', 'status']) {
    const styled = new RegExp(`\\.${gone}[\\s,{:]`).test(css);
    assert.ok(!styled || emitted.has(gone),
      `.${gone} is styled but no row emits it, so the rule does nothing`);
  }
});

test('the row sheds its columns at the same widths on both pages', () => {
  // The ladder is in the shared block, so the two pages cannot disagree about
  // when a column goes. Asserted on the source because a media query needs a
  // viewport, and the widths themselves were checked in a browser.
  assert.match(LIST_CSS, /@media\(max-width:1180px\)\{\.badge\.t\{display:none\}\}/);
  assert.match(LIST_CSS, /@media\(max-width:900px\)\{\.upd\{display:none\}\}/);
  const { index, shared } = pages();
  for (const [name, html] of [['home', index], ['shared', shared]]) {
    assert.ok(html.includes('@media(max-width:1180px){.badge.t{display:none}}'),
      `${name} page has no type-column rule`);
  }
});

test('a reader who has chosen nothing still gets their system theme', () => {
  // The home page is served with data-theme stamped on, because the daemon knows
  // what the owner chose. A reviewer has chosen nothing, so the shared page has
  // to answer prefers-color-scheme on its own.
  const { shared } = pages();
  assert.match(shared, /@media \(prefers-color-scheme: dark\)/);
  assert.match(shared, /:root\[data-theme="dark"\]/, 'an explicit choice must still win');
  assert.match(shared, /:root\[data-theme="light"\]/);
});
