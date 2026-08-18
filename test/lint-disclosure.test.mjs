// The one thing the lint can say about a disclosure.
//
// The component rule names its failure in prose: "never for content the
// argument depends on". Prose cannot be checked, and the obvious mechanical
// proxy — how much of a section a disclosure holds — needs a threshold there is
// no measurement to set (D9 in the interactive components spec, which dropped
// it for exactly that reason).
//
// A section heading inside one is checkable and is the same failure stated
// concretely: an h2 or h3 is a division of the document, and a division of the
// document behind a summary line is an argument a reader can miss. Advisory,
// because a spec that means it should still lint.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { lintSpec } from '../lib/lint-spec.mjs';

const spec = (body) => `<!DOCTYPE html>
<html lang="en" data-theme="light" data-sf-spec-status="draft" data-sf-components="1">
<head><title>T — Spec</title><style>
:root{--bg:#fff;--panel:#fff;--panel2:#eee;--ink:#111;--muted:#666;--line:#ddd;
--accent:#2f6feb;--green:#15803d;--amber:#b45309;--red:#b91c1c;--code:#f1efe9;
--shadow:0 1px 2px rgba(0,0,0,.04);--mono:ui-monospace,monospace}
:root[data-theme="dark"]{--bg:#111;--ink:#eee}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--bg:#111;--ink:#eee}}
</style></head>
<body><main><h1>T</h1><section id="s" data-sf-section><h2>1 · S</h2>
${body}
</section></main></body></html>`;

const check = (html, id) => lintSpec(html).checks.find((c) => c.name === id);

test('a disclosure holding only prose passes quietly', () => {
  const r = check(spec(`<details class="disclosure"><summary>Raw numbers</summary>
    <p>n=133, parsed 2026-08-18.</p></details>`), 'disclosure-depth');
  assert.ok(r, 'the check runs');
  assert.equal(r.ok, true);
});

test('a disclosure holding an h3 is reported', () => {
  const r = check(spec(`<details class="disclosure"><summary>Design</summary>
    <h3>How the queue drains</h3><p>x</p></details>`), 'disclosure-depth');
  assert.equal(r.ok, false);
  assert.match(r.detail, /h3/, 'and says which level');
});

test('an h2 counts too', () => {
  const r = check(spec(`<details class="disclosure"><summary>Design</summary>
    <h2>4 · Design</h2><p>x</p></details>`), 'disclosure-depth');
  assert.equal(r.ok, false);
});

test('an h4 or a label does not', () => {
  // h4 is the deepest the rail lists and h5 is a label. Neither is a division of
  // the document, so neither is the failure this names.
  const r = check(spec(`<details class="disclosure"><summary>Detail</summary>
    <h4>Counting method</h4><h5>Worked example</h5><p>x</p></details>`), 'disclosure-depth');
  assert.equal(r.ok, true);
});

test('it is advisory: a spec that means it still lints', () => {
  const html = spec(`<details class="disclosure"><summary>Design</summary>
    <h3>Buried</h3><p>x</p></details>`);
  const out = lintSpec(html);
  assert.equal(out.checks.find((c) => c.name === 'disclosure-depth').advisory, true);
  assert.equal(out.ok, true, 'the verdict is unaffected');
});

test('a spec with no disclosure is not reported on at all', () => {
  // Same shape as spec-components: a rule that does not apply is omitted rather
  // than passed, so a clean report means something.
  const out = lintSpec(spec('<p>Nothing collapsible here.</p>'));
  assert.equal(out.checks.find((c) => c.name === 'disclosure-depth'), undefined);
});
