import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { lintSpec } from '../lib/lint-spec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// A well-formed template: passes every hard check and traps no text in bare divs.
const CLEAN = readFileSync(join(ROOT, 'templates', 'spec-base-research.html'), 'utf8');

test('commentability is an advisory check that passes on a well-formed template', () => {
  const { ok, checks } = lintSpec(CLEAN);
  const c = checks.find((x) => x.name === 'commentability');
  assert.ok(c, 'commentability check present');
  assert.equal(c.advisory, true, 'it is advisory');
  assert.equal(c.ok, true, 'all content sits in commentable blocks');
  assert.equal(ok, true, 'the template lints clean');
});

test('commentability warns on trapped divs but never fails the lint', () => {
  const trapped = CLEAN.replace(
    '</body>',
    '<div class="x">a</div><div class="y">b</div><div class="z">c</div></body>',
  );
  const { ok, checks } = lintSpec(trapped);
  const c = checks.find((x) => x.name === 'commentability');
  assert.equal(c.ok, false, 'three trapped divs exceed the threshold');
  assert.equal(c.advisory, true, 'still advisory');
  assert.equal(ok, true, 'an advisory check never fails the lint');
});
