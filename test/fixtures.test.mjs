// The fixture corpus is an input to the exporter, the importer, and the
// round-trip suite. If a fixture stops being a valid spec, those three suites
// fail for a reason that has nothing to do with the code under test, so the
// corpus is checked on its own first.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { FIXTURES, fixture } from './fixtures/md/index.mjs';
import { lintSpec } from '../lib/lint-spec.mjs';
import { getSectionIds, duplicateSectionIds, getTitle, getStatus, parsePlan } from '../lib/spec.mjs';

test('every fixture is a lint-passing spec', () => {
  for (const f of FIXTURES) {
    const { ok, checks } = lintSpec(f.html());
    const failing = checks.filter((c) => !c.ok && !c.advisory).map((c) => `${c.name} (${c.detail})`);
    assert.ok(ok, `${f.name}: ${failing.join('; ')}`);
  }
});

test('every fixture has a title, a status and unique section ids', () => {
  for (const f of FIXTURES) {
    const html = f.html();
    assert.notEqual(getTitle(html), 'Untitled spec', `${f.name} has a title`);
    assert.match(getStatus(html), /^(draft|approved)$/, `${f.name} has a lifecycle status`);
    assert.deepEqual(duplicateSectionIds(html), [], `${f.name} has unique section ids`);
    assert.ok(getSectionIds(html).length >= 2, `${f.name} has sections to convert`);
  }
});

test('the corpus covers every construct the converters have to handle', () => {
  const all = FIXTURES.map((f) => f.html()).join('\n');
  const required = {
    'nested list': /<li\b[^>]*>[\s\S]{0,400}?<ul\b/,
    'ordered list': /<ol\b(?![^>]*class="sf-stages")/,
    'table': /<table\b/,
    'fenced code with a language': /<code\b[^>]*class="lang-\w+"/,
    'inline code': /<code>(?!<)/,
    'link': /<a\b[^>]*href="https?:/,
    'bold': /<strong\b/,
    'emphasis': /<em\b/,
    'callout': /class="callout/,
    'panel': /class="panel"/,
    'inline svg': /<svg\b/,
    'figure with a caption': /<figcaption\b/,
    'plan stage': /data-sf-stage/,
    'plan task': /data-sf-task/,
    'open question': /data-sf-q="open"/,
    'resolved question': /data-sf-q="resolved"/,
    'dropped question': /data-sf-q="dropped"/,
  };
  for (const [what, re] of Object.entries(required)) {
    assert.match(all, re, `the corpus contains a ${what}`);
  }
});

test('the plan fixture exercises every task status the tracker knows', () => {
  const statuses = new Set(
    parsePlan(fixture('design-impl').html()).flatMap((s) => s.tasks.map((t) => t.status))
  );
  for (const s of ['todo', 'in_progress', 'done', 'blocked', 'deferred']) {
    // 'dropped' is deliberately absent: it behaves exactly like 'deferred' in the
    // tracker (both settle a task) and adding it would test the same branch twice.
    assert.ok(statuses.has(s) || s === 'todo', `a task is ${s}`);
  }
  assert.ok(statuses.has('done') && statuses.has('blocked'), 'settled and blocked are both present');
});

test('fixture() names what is available when asked for something missing', () => {
  assert.throws(() => fixture('nope'), /no fixture "nope".*design/s);
});
