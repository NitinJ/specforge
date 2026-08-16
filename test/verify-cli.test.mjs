// `specforge verify <id>` as a caller sees it: a report by default, JSON on
// request, and an exit code that is the gate. 0 passed, 1 did not.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { useTempStore } from './helpers/temp-store.mjs';
import { cmdVerify } from '../lib/specforge-cli.mjs';
import { createSpec } from '../lib/store.mjs';
import { specHtmlPath } from '../lib/store-paths.mjs';
import { cleanSpec, specWith } from './helpers/spec-corpus.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'specforge-cli.mjs');
const store = useTempStore({ beforeEach, afterEach }, 'sf-verify-cli-');

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: 'utf8',
      env: { ...process.env, SPECFORGE_HOME: store.dir },
    });
    return { code: 0, stdout, stderr: '' };
  } catch (e) {
    return { code: e.status, stdout: e.stdout || '', stderr: e.stderr || '' };
  }
}

function seed(html = cleanSpec(), type = 'design') {
  const id = createSpec({ title: 'Verified', html, type });
  writeFileSync(specHtmlPath(id), html);
  return id;
}

test('cmdVerify refuses an unknown id rather than verifying nothing', async () => {
  await assert.rejects(cmdVerify({ id: 'nope' }), /unknown spec nope/);
  await assert.rejects(cmdVerify({}), /<id> required/);
});

test('cmdVerify reads the type off the spec', async () => {
  const r = await cmdVerify({ id: seed(cleanSpec(), 'research') });
  assert.equal(r.type, 'research');
  assert.ok(r.failing.some((f) => f.id === 'findings-cite-sources'));
});

test('the gate fails first, and exits 1', () => {
  const id = seed();
  const { code, stdout } = run(['verify', id]);
  assert.equal(code, 1);
  assert.match(stdout, /verify: FAIL \(design\)/);
  assert.match(stdout, /^JUDGE — /m);
  assert.doesNotMatch(stdout, /^\{/, 'the default output is a report, not JSON');
});

test('the loop closes: judge what it asked about, and it exits 0', () => {
  const id = seed();
  const first = JSON.parse(run(['verify', id, '--json']).stdout);
  const ids = first.failing.map((f) => f.id).join(',');
  const { code, stdout } = run(['verify', id, '--judged', ids]);
  assert.equal(code, 0, 'the gate has to be passable or it is not a gate');
  assert.match(stdout, /verify: PASS \(design\)/);
});

test('--json carries everything an agent needs to run the next round', () => {
  const id = seed();
  const { code, stdout } = run(['verify', id, '--json']);
  assert.equal(code, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.id, id);
  assert.equal(parsed.pass, false);
  assert.ok(parsed.failing.length > 0);
  for (const f of parsed.failing) {
    assert.ok(f.id && f.kind && f.why && f.fix, `${f.id} is missing something the agent needs`);
  }
});

test('a broken spec cannot be judged into passing', () => {
  const id = seed(specWith('no-placeholders'));
  const { code, stdout } = run(['verify', id, '--judged', 'no-placeholders']);
  assert.equal(code, 1);
  assert.match(stdout, /^FIX — /m);
  assert.match(stdout, /no-placeholders/);
});

test('a mistyped --judged id fails rather than silently settling nothing', () => {
  const id = seed();
  const first = JSON.parse(run(['verify', id, '--json']).stdout);
  const ids = [...first.failing.map((f) => f.id), 'no-such-rule'].join(',');
  const { code, stdout } = run(['verify', id, '--judged', ids]);
  assert.equal(code, 1);
  assert.match(stdout, /not a rule for this type/);
});

test('an unknown id exits 1 with a message on stderr, not a stack trace', () => {
  const { code, stderr, stdout } = run(['verify', 'no-such-spec']);
  assert.equal(code, 1);
  assert.match(stderr, /verify: unknown spec no-such-spec/);
  assert.equal(stdout, '');
});

test('verify is listed among the commands', () => {
  assert.match(run(['definitely-not-a-command']).stderr, /\bverify\b/);
});
