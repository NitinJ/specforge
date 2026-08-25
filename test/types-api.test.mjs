// The two routes behind "Add a template": creating a kind, and asking after one.
//
// What matters most here is what is on disk after a refusal. A kind that half
// exists validates but cannot be scaffolded from, so every refusal is checked
// for wreckage as well as for its status code (I3).
//
// Spec 45395008a2, tasks 3.1, 3.2, 3.3.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedLiveSession, seedDeadSession } from './helpers/live-session.mjs';
import { handleTypeCreate, handleTypeGet } from '../lib/types-api.mjs';
import { customTypes, specTypes } from '../lib/spec-types.mjs';
import { readMeta, writeMeta } from '../lib/meta.mjs';
import { specDir, typesPath } from '../lib/store-paths.mjs';
import { liveSessions } from '../lib/attach.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-typesapi-');

const CREATE = { name: 'Postmortem', prompt: 'what happened, timeline, impact, root cause' };

/** Nothing about this kind exists anywhere. */
function assertNoTrace(slug) {
  assert.equal(customTypes().some((t) => t.slug === slug), false, 'no registry row');
  assert.equal(existsSync(specDir(`template-${slug}`)), false, 'no spec directory');
  assert.equal(readMeta(`template-${slug}`), null, 'no meta');
}

// --- live sessions (3.3) ----------------------------------------------------

test('liveSessions lists the sessions with a running watcher', () => {
  seedLiveSession({ id: 'sess-alive' });
  seedDeadSession({ id: 'sess-gone' });
  assert.deepEqual(liveSessions(), ['claude:sess-alive']);
});

test('a store with no sessions at all lists none, rather than throwing', () => {
  assert.deepEqual(liveSessions(), []);
});

// --- creating (3.1) ---------------------------------------------------------

test('creating a kind writes the row, the template spec, and the request', () => {
  seedLiveSession({ id: 'sess-a' });
  const out = handleTypeCreate(CREATE);

  assert.equal(out.status, 201);
  assert.equal(out.body.slug, 'postmortem');
  assert.equal(out.body.templateId, 'template-postmortem');
  assert.equal(out.body.specUrl, '/spec/template-postmortem');
  assert.equal(out.body.generate.state, 'requested');

  assert.ok(specTypes().includes('postmortem'), 'the kind exists');
  const meta = readMeta('template-postmortem');
  assert.equal(meta.template, true, 'the template spec is protected');
  assert.equal(meta.attachedSession, 'claude:sess-a', 'and attached to the live session');
  assert.match(meta.generate.prompt, /what happened/);
});

test('the shell family rides through, defaulting to doc', () => {
  seedLiveSession();
  assert.equal(handleTypeCreate({ ...CREATE, shell: 'impl' }).body.shell, 'impl');
  assert.equal(handleTypeCreate({ name: 'Plain', prompt: 'x' }).body.shell, 'doc');
});

test('with no live session nothing is created at all (I3)', () => {
  // Checked before the first write on purpose: this is the failure a user hits
  // by opening the configuration page without a session running, which needs no
  // mistake on their part.
  seedDeadSession({ id: 'sess-gone' });
  const out = handleTypeCreate(CREATE);
  assert.equal(out.status, 503);
  assert.match(out.body.error, /session/i);
  assert.match(out.body.error, /wait-batch|Claude Code/i, 'and says what to start');
  assertNoTrace('postmortem');
});

test('a duplicate kind is refused, and leaves the first one untouched', () => {
  seedLiveSession();
  handleTypeCreate(CREATE);
  const before = readFileSync(typesPath(), 'utf8');

  const out = handleTypeCreate(CREATE);
  assert.equal(out.status, 409);
  assert.match(out.body.error, /already/i);
  assert.equal(readFileSync(typesPath(), 'utf8'), before, 'the file is byte-identical');
});

test('a name that makes no slug is refused before anything is written', () => {
  seedLiveSession();
  const out = handleTypeCreate({ name: '!!!', prompt: 'x' });
  assert.equal(out.status, 400);
  assert.match(out.body.error, /name/i);
  assert.equal(existsSync(typesPath()), false, 'no file was even created');
});

test('a missing prompt is refused: there is nothing to generate from', () => {
  seedLiveSession();
  const out = handleTypeCreate({ name: 'Postmortem', prompt: '   ' });
  assert.equal(out.status, 400);
  assert.match(out.body.error, /prompt/i);
  assertNoTrace('postmortem');
});

test('an unknown shell is refused', () => {
  seedLiveSession();
  const out = handleTypeCreate({ ...CREATE, shell: 'nonsense' });
  assert.equal(out.status, 400);
  assert.match(out.body.error, /shell/i);
  assertNoTrace('postmortem');
});

test('a kind whose name collides with a built-in is refused', () => {
  seedLiveSession();
  const out = handleTypeCreate({ name: 'Design', prompt: 'x' });
  assert.equal(out.status, 409);
  assert.equal(specTypes().filter((t) => t === 'design').length, 1);
});

// --- polling (3.2) ----------------------------------------------------------

test('the poll reports the state the dialog is waiting on', async () => {
  seedLiveSession();
  handleTypeCreate(CREATE);

  let out = handleTypeGet('postmortem');
  assert.equal(out.status, 200);
  assert.equal(out.body.generate.state, 'requested');
  assert.equal(out.body.specUrl, '/spec/template-postmortem');

  const { markGenerateWorking, finishGenerate } = await import('../lib/store-generate.mjs');
  markGenerateWorking('template-postmortem');
  assert.equal(handleTypeGet('postmortem').body.generate.state, 'working');

  finishGenerate('template-postmortem');
  out = handleTypeGet('postmortem');
  assert.equal(out.body.generate.state, 'done');
  assert.equal(out.body.label, 'Postmortem', 'and names the kind for the arrival dialog');
});

test('a failure is reported with its message, so the dialog can show it', async () => {
  seedLiveSession();
  handleTypeCreate(CREATE);
  const { finishGenerate } = await import('../lib/store-generate.mjs');
  finishGenerate('template-postmortem', { error: 'could not lint the result' });

  const out = handleTypeGet('postmortem');
  assert.equal(out.body.generate.state, 'error');
  assert.match(out.body.generate.error, /could not lint/);
  assert.equal(out.body.specUrl, '/spec/template-postmortem', 'and it is still openable');
});

test('an unknown kind is a 404', () => {
  assert.equal(handleTypeGet('never-existed').status, 404);
});

test('a kind whose template spec is gone reports an error, never done', async (t) => {
  // Raised in review of PR #224. Reporting done would send the dialog to a spec
  // that answers 404, and would bury a real generation error behind a success.
  // It takes deleting the spec directory by hand to reach, which is why the
  // message names the id rather than offering a fix.
  seedLiveSession();
  handleTypeCreate(CREATE);
  const { rmSync } = await import('node:fs');
  rmSync(specDir('template-postmortem'), { recursive: true, force: true });

  const out = handleTypeGet('postmortem');
  assert.equal(out.status, 200, 'the kind still exists, so this is not a 404');
  assert.equal(out.body.generate.state, 'error');
  assert.match(out.body.generate.error, /template-postmortem/);
});

test('a template spec with no generation on it reads as done', () => {
  // The ordinary case for a kind whose request finished long ago and whose meta
  // has since been rewritten by an edit: the spec is there, nothing is pending.
  seedLiveSession();
  handleTypeCreate(CREATE);
  const meta = readMeta('template-postmortem');
  delete meta.generate;
  writeMeta('template-postmortem', meta);

  const out = handleTypeGet('postmortem');
  assert.equal(out.body.generate.state, 'done');
  assert.equal(out.body.generate.error, undefined);
});

test('a built-in kind is a 404 here: this route is about creations', () => {
  // The Templates tab already lists the built-ins from the store. A poll for one
  // would answer with no generation state and mean nothing.
  assert.equal(handleTypeGet('design').status, 404);
});
