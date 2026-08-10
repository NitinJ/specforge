// The mechanical slice of the spec language contract
// (references/spec-language.md). Advisory: it reports, it never fails a lint —
// the contract's own rule is "report failures, do not silently fix".

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLanguage, lintSpec } from '../lib/lint-spec.mjs';

const doc = (body) => `<!DOCTYPE html><html><head><title>T</title></head><body>${body}</body></html>`;
const names = (html) => checkLanguage(html).map((r) => r.name);

test('clean prose reports nothing', () => {
  assert.deepEqual(checkLanguage(doc('<p>Limits (25 MB, 8000 px, 3 files) render as chips on the dropzone.</p>')), []);
});

test('em dashes are reported with a count', () => {
  const found = checkLanguage(doc('<p>One — two — three.</p>'));
  assert.equal(found.length, 1);
  assert.equal(found[0].name, 'em dash');
  assert.equal(found[0].count, 2);
  assert.match(found[0].fix, /colon|semicolon|parentheses/);
});

test('attention-curating phrases are reported', () => {
  assert.ok(names(doc('<p>Worth noting: the cache is cold on boot.</p>')).includes('attention-curating phrase'));
  assert.ok(names(doc('<p>Importantly, the job is idempotent.</p>')).includes('attention-curating phrase'));
});

test('precision theatre is reported', () => {
  assert.ok(names(doc('<p>Retries take typically 3 attempts.</p>')).includes('precision theatre'));
  assert.ok(names(doc('<p>It keeps a handful of entries.</p>')).includes('precision theatre'));
});

test('hedged decisions are reported', () => {
  assert.ok(names(doc('<p>This is probably the same feature.</p>')).includes('hedged decision'));
  assert.ok(names(doc('<p>Arguably the queue should drain first.</p>')).includes('hedged decision'));
});

test('code and styles are exempt — a spec may quote a banned pattern', () => {
  // An em dash inside a code sample, a <style> block or a <pre> is not prose.
  assert.deepEqual(checkLanguage(doc('<pre><code>const s = "a — b";</code></pre>')), []);
  assert.deepEqual(checkLanguage(doc('<style>.x{content:"—"}</style>')), []);
  assert.deepEqual(checkLanguage(doc('<p>Use <code>a — b</code> in the shell.</p>')), []);
});

test('several rules can fire at once, each counted separately', () => {
  const found = checkLanguage(doc('<p>Worth noting — this is probably fine.</p>'));
  assert.equal(found.length, 3, 'em dash, attention-curating, hedged');
  assert.ok(found.every((r) => r.count === 1 && r.fix));
});

test('the check is advisory: it never fails the lint', () => {
  const html = doc('<h1>T</h1><p data-sf-spec-status="draft">Worth noting — probably.</p>');
  const res = lintSpec(html);
  const lang = res.checks.find((c) => c.name === 'spec-language');
  assert.ok(lang, 'the check is reported');
  assert.equal(lang.ok, false, 'and it fired');
  assert.equal(lang.advisory, true, 'but it is advisory');
  // The lint's own verdict ignores advisory checks; only the structural ones count.
  const structural = res.checks.filter((c) => !c.advisory).every((c) => c.ok);
  assert.equal(res.ok, structural, 'the verdict comes from the structural checks alone');
});
