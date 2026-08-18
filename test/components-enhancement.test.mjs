// The enhancement channel: how behaviour reaches a document that must also
// render from file:// with no network.
//
// One rule holds the whole layer up, and it is checkable: the stamped stylesheet
// may not hide content. Hiding is written under [data-sf-live], an attribute
// only the served script sets, so a document that never runs the script shows
// everything. Written the obvious way instead — `.tabs > .tab{display:none}` —
// that rule would sit in the stamped block of every spec and a reader opening
// the file from disk would silently lose every panel but the first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

import {
  COMPONENTS, componentsIn, needsOf, component, LIVE_ATTR, scriptSelectors,
} from '../components/index.mjs';
import { buildBody, hidingRules } from '../lib/components-build.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---- I1: the stamped stylesheet hides nothing on its own ----

test('every hiding rule in the stamped stylesheet is behind the live attribute', () => {
  const stray = hidingRules(buildBody());
  assert.deepEqual(stray, [],
    'a rule that hides content with no script to bring it back');
});

test('the checker catches a hiding rule that is not behind it', () => {
  // The check is worth nothing if it cannot fail. Both spellings of hiding that
  // remove a block from the page, and the guarded form that is allowed.
  assert.deepEqual(hidingRules('.tabs > .tab{display:none}'), ['.tabs > .tab']);
  assert.deepEqual(hidingRules('.tab{visibility:hidden}'), ['.tab']);
  assert.deepEqual(hidingRules(`[${LIVE_ATTR}] .tabs > .tab{display:none}`), [],
    'guarded by the attribute, so an un-enhanced document still shows it');
});

test('a marker or an arrow may still be hidden', () => {
  // Decoration is not content. The disclosure hides the native triangle so it
  // can draw its own, and that must not read as a violation.
  assert.deepEqual(hidingRules('summary::-webkit-details-marker{display:none}'), []);
  assert.deepEqual(hidingRules('.thing::before{display:none}'), []);
});

// ---- the channel ----

test('only components that declare it are said to need the script', () => {
  for (const c of COMPONENTS) {
    const n = needsOf(c);
    assert.ok(n === 'none' || n === 'script', `${c.name}: ${n}`);
    if (n === 'script') assert.equal(c.layer, 'interactive', `${c.name} is interactive`);
  }
  // The disclosure is the proof the two are separate axes: interactive, and
  // needing nothing.
  assert.equal(needsOf(component('disclosure')), 'none');
});

test('every script-needing component says how to detect it in a document', () => {
  // The review layer loads the script only for a document that has something for
  // it to do, which it can only decide from a selector.
  for (const c of componentsIn('interactive')) {
    if (needsOf(c) !== 'script') continue;
    assert.ok(c.detect, `${c.name} declares a detect selector`);
    assert.ok(scriptSelectors().includes(c.detect), `${c.name} is in the list the client gets`);
  }
});

test('a document with none of them asks for nothing', () => {
  assert.ok(scriptSelectors().length, 'there are selectors to match');
  // The bargain the reading fonts and the highlighter already make: a spec of
  // prose and diagrams fetches nothing.
  const sel = scriptSelectors().join(',');
  assert.ok(!/^\s*,|,\s*,|,\s*$/.test(sel), 'and the list composes into one valid selector');
});

test('the client script exists and is served from public', () => {
  const src = readFileSync(join(ROOT, 'server', 'public', 'interactive.js'), 'utf8');
  assert.match(src, new RegExp(LIVE_ATTR), 'it sets the attribute the CSS keys on');
  assert.ok(!/\bexport\b|\bimport\s/.test(src), 'a plain script, like review.js: no module syntax');
});

test('review.js loads it, and only when the document needs it', () => {
  const src = readFileSync(join(ROOT, 'server', 'public', 'review.js'), 'utf8');
  assert.match(src, /\/public\/interactive\.js/, 'the path is declared');
  assert.match(src, /INTERACTIVE_SRC/, 'as a constant, beside the other two loaders');
});

// ---- copy ----

test('copy is automatic: it carries a rule and nothing to author', () => {
  const c = component('copy');
  assert.ok(c, 'registered');
  assert.equal(needsOf(c), 'script');
  assert.equal(c.detect, '.codeblock', 'every code block gets one');
  assert.deepEqual(c.requires, [], 'there is nothing an author must write');
});

test('the codeblock can position a control without the copy component restyling it', () => {
  // Two components, one block. `.codeblock` belongs to codeblock and the
  // positioning it needs goes there, so the stamped block has one definition of
  // it rather than two that can disagree.
  const css = buildBody();
  const codeblockRules = css.split('\n').filter((l) => l.trim().startsWith('.codeblock'));
  assert.ok(codeblockRules.some((l) => /position:\s*relative/.test(l)),
    'the codeblock positions itself');
  assert.ok(!/\.copy[^{]*\{[^}]*\.codeblock/.test(css), 'and copy does not redefine it');
});
