// `specforge verify <id>` as a caller sees it: human text by default, JSON on
// request, and an exit code that carries the verdict so a harness can gate on it
// without parsing anything.

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

/** Run the CLI against the temp store; returns {code, stdout, stderr}. */
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
  assert.ok(r.pending.some((p) => p.id === 'findings-cite-sources'));
});

test('the CLI prints a human report and exits 1 while work is outstanding', () => {
  const id = seed();
  const { code, stdout } = run(['verify', id]);
  assert.equal(code, 1, 'blocking judgements outstanding is not a pass');
  assert.match(stdout, /PENDING/);
  assert.match(stdout, /verify: NOT DONE \(design\)/);
  assert.doesNotMatch(stdout, /^\{/, 'the default output is a report, not JSON');
});

test('--json gives a caller the same result as a parsable object', () => {
  const id = seed();
  const { code, stdout } = run(['verify', id, '--json']);
  assert.equal(code, 1);
  const parsed = JSON.parse(stdout);
  assert.equal(parsed.id, id);
  assert.equal(parsed.ok, false);
  assert.ok(Array.isArray(parsed.pending));
  assert.ok(parsed.pending.length > 0);
  assert.ok(parsed.pending[0].ask, 'the agent needs the sentence to judge');
});

test('a mechanical failure is named in both output modes', () => {
  const id = seed(specWith('no-placeholders'));
  const text = run(['verify', id]);
  assert.match(text.stdout, /FAILED/);
  assert.match(text.stdout, /no-placeholders/);
  const json = JSON.parse(run(['verify', id, '--json']).stdout);
  assert.ok(json.failed.some((v) => v.id === 'no-placeholders'));
});

test('an unknown id exits 1 with a message on stderr, not a stack trace', () => {
  const { code, stderr, stdout } = run(['verify', 'no-such-spec']);
  assert.equal(code, 1);
  assert.match(stderr, /verify: unknown spec no-such-spec/);
  assert.equal(stdout, '');
});

test('verify is listed among the commands', () => {
  const { stderr } = run(['definitely-not-a-command']);
  assert.match(stderr, /\bverify\b/);
});

test('the exit code is the whole contract for a harness', () => {
  // The only way to exit 0 is for every blocking rule to have been answered.
  // Two different specs, same reason for the same code.
  assert.equal(run(['verify', seed(cleanSpec())]).code, 1);
  assert.equal(run(['verify', seed(specWith('has-title'))]).code, 1);
});
