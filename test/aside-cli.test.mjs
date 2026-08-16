// `specforge aside` end to end, against a real spec in a temporary store.
//
// The unit tests cover the markup. This covers the part an agent actually
// touches: a command that reads a file, writes the store, and leaves the spec
// passing its own gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CLI = join(ROOT, 'lib', 'specforge-cli.mjs');

const SPEC = `<!doctype html><html data-sf-spec-status="draft"><head><title>T</title></head><body>
<main>
  <h1>Aside CLI</h1>
  <section id="one"><h2>1 · One</h2><p>First.</p></section>
  <section id="two"><h2>2 · Two</h2><p>Second.</p></section>
</main>
</body></html>`;

/** A store with one spec in it, and the id of that spec. */
function withStore(t) {
  const home = mkdtempSync(join(tmpdir(), 'sf-aside-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const env = { ...process.env, SPECFORGE_HOME: home };
  const src = join(home, 'seed.html');
  writeFileSync(src, SPEC);
  const out = JSON.parse(execFileSync(
    process.execPath, [CLI, 'import', src, '--title', 'Aside CLI', '--type', 'design'],
    { encoding: 'utf8', env },
  ));
  return { env, id: out.id, htmlPath: out.htmlPath };
}

const run = (env, ...args) =>
  execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });

test('the command writes the aside into the stored spec', async (t) => {
  const { env, id, htmlPath } = withStore(t);
  const body = join(tmpdir(), `sf-aside-body-${id}.html`);
  writeFileSync(body, '<p>A diagram the agent drafted.</p>');
  t.after(() => rmSync(body, { force: true }));

  const out = JSON.parse(run(env, 'aside', id, '--section', 'two', '--action', 'visualize', '--file', body));
  assert.equal(out.asideId, 'two-aside-1');

  const html = readFileSync(htmlPath, 'utf8');
  assert.match(html, /<section id="two-aside-1" data-sf-aside="two" data-sf-action="visualize">/);
  assert.match(html, /A diagram the agent drafted/);
});

test('--body works too, for output short enough to pass inline', async (t) => {
  const { env, id, htmlPath } = withStore(t);
  run(env, 'aside', id, '--section', 'one', '--action', 'explain_simply', '--body', '<p>In plain words.</p>');
  assert.match(readFileSync(htmlPath, 'utf8'), /<section id="one-aside-1"[^>]*>/);
});

test('it refuses an unknown spec, section, or action rather than writing something wrong', async (t) => {
  const { env, id } = withStore(t);
  const cases = [
    ['aside', 'nosuchspec', '--section', 'two', '--action', 'visualize', '--body', '<p>x</p>'],
    ['aside', id, '--section', 'seven', '--action', 'visualize', '--body', '<p>x</p>'],
    ['aside', id, '--section', 'two', '--action', 'visualise', '--body', '<p>x</p>'],
    ['aside', id, '--section', 'two', '--action', 'tighten', '--body', '<p>x</p>'],
    ['aside', id, '--section', 'two', '--action', 'visualize'],
  ];
  for (const args of cases) {
    assert.throws(() => run(env, ...args), `expected ${args.join(' ')} to fail`);
  }
});

test('a spec with an aside still passes its own gate', async (t) => {
  // The point of modelling an aside as a section is that everything else keeps
  // working. `verify` reading it is the behaviour we want, not a regression.
  const { env, id } = withStore(t);
  run(env, 'aside', id, '--section', 'two', '--action', 'visualize', '--body', '<p>A drafted diagram.</p>');
  // verify exits 1 while judged rules are outstanding, which is its whole point,
  // so the report is read off the thrown error rather than from a zero exit.
  let report;
  try {
    report = run(env, 'verify', id, '--json');
  } catch (e) {
    report = String(e.stdout);
  }
  const out = JSON.parse(report);
  const toc = out.failing.find((f) => f.id === 'toc-in-sync');
  assert.equal(toc, undefined, 'the aside is not reported as an unlisted section');
  assert.ok(out.failing.length || out.judged, 'and the gate still ran');
});
