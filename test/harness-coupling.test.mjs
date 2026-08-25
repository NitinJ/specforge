// The coupling gate, and that it is a gate rather than a report.
//
// I7 in the form that survives a refactor: run the real scan over the real
// repository and fail on any hit. The unit assertions in harness-policy.test.mjs
// cover one file; this covers everything that is not a binding.
//
// It also asserts the scanner catches a planted violation, because a gate that
// passes for the wrong reason is worse than no gate: a broken pattern would read
// as a clean repository forever.
//
// Spec e9ddcddef6, task 3.4.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN = join(ROOT, 'scripts', 'check-harness-coupling.mjs');

/** Run the scan. Returns { code, out }. */
function scan() {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCAN], { encoding: 'utf8' }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

test('the repository names no single agent CLI outside its bindings', () => {
  const { code, out } = scan();
  assert.equal(code, 0, out);
});

test('a planted violation fails it, naming the file and the pattern', (t) => {
  // Planted in lib/, which is core and therefore covered. Removed whatever the
  // assertions do, so a failure here cannot leave the repository dirty.
  const planted = join(ROOT, 'lib', 'coupling-probe-delete-me.mjs');
  t.after(() => rmSync(planted, { force: true }));
  writeFileSync(planted, 'export const id = process.env.CLAUDE_CODE_SESSION_ID;\n');

  const { code, out } = scan();
  assert.equal(code, 1, 'the scan passed with a planted coupling in lib/');
  assert.match(out, /coupling-probe-delete-me\.mjs/);
  assert.match(out, /claude env var/);
});

test('the bindings themselves are exempt, which is what makes them bindings', () => {
  // hooks/lib/emit.mjs is the Claude Code translation layer. If the scan flagged
  // it, the only way to a clean run would be to stop translating.
  const emit = readFileSync(join(ROOT, 'hooks', 'lib', 'emit.mjs'), 'utf8');
  assert.match(emit, /hookSpecificOutput/, 'the fixture this test rests on has moved');
  assert.equal(scan().code, 0);
});

test('npm run check:harness is what CI runs', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['check:harness'], 'node scripts/check-harness-coupling.mjs');
  const ci = readFileSync(join(ROOT, '.github', 'workflows', 'test.yml'), 'utf8');
  assert.match(ci, /npm run check:harness/);
});
