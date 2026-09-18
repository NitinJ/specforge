import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { spawn } from 'node:child_process';

import { readMeta, listSpecs } from '../lib/meta.mjs';
import { mutateComments, createThread } from '../lib/store-comments.mjs';
import { cmdCreate, cmdCredit, cmdReply, cmdReview } from '../lib/specforge-cli.mjs';
import { agentIdentity, creditLabel, recordCredit } from '../lib/credits.mjs';
import { renderIndex } from '../server/index-page.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-credits-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

// Unattached (no session), no daemon, and the harness decided by `env` alone,
// so each test says which agent is running rather than inheriting this one.
const deps = (env) => ({
  session: '',
  ensureDaemon: async () => ({ url: 'http://127.0.0.1:4180/', port: 4180 }),
  env,
});
const CLAUDE = { CLAUDE_CODE_SESSION_ID: 'claude-sess' };
const CODEX = { CODEX_THREAD_ID: 'codex-thread' };

function openThread(id) {
  let thread;
  mutateComments(id, (store) => {
    thread = createThread(store, {
      anchor: { block: { index: 0, tag: 'P', text: 'hi' } },
      body: '@agent answer this',
      author: 'human',
    });
  });
  return thread.id;
}

test('create credits the running agent as author: detected harness, reported model', async () => {
  const r = await cmdCreate({ title: 'Credited', model: 'claude-fable-5-1' }, deps(CLAUDE));
  const expected = { harness: 'claude', model: 'claude-fable-5-1' };
  assert.deepEqual(readMeta(r.id).author, expected);
  assert.deepEqual(r.author, expected, 'and says so in its output');
});

test('with no model reported, the credit names the harness alone', async () => {
  const r = await cmdCreate({ title: 'Codex wrote it' }, deps(CODEX));
  assert.deepEqual(readMeta(r.id).author, { harness: 'codex', model: null });
  assert.equal(creditLabel(readMeta(r.id).author), 'Codex');
});

test('SPECFORGE_HARNESS and SPECFORGE_MODEL are the fallbacks when no flag is given', () => {
  const agent = agentIdentity({}, { SPECFORGE_HARNESS: 'pi', SPECFORGE_MODEL: 'glm-5.3-flash' });
  assert.deepEqual(agent, { harness: 'pi', model: 'glm-5.3-flash' });
  assert.equal(creditLabel(agent), 'Pi · glm-5.3-flash');
});

test('a flag wins over the environment', () => {
  const agent = agentIdentity({ harness: 'codex', model: 'gpt-6-astra' }, { SPECFORGE_MODEL: 'other' });
  assert.deepEqual(agent, { harness: 'codex', model: 'gpt-6-astra' });
});

test('a model id is cut to characters a chip can show safely', () => {
  const agent = agentIdentity({ model: 'gpt-6<script>"x"' }, CLAUDE);
  assert.equal(agent.model, 'gpt-6scriptx');
});

test('the author answering its own comments stays the author, not a reviewer', async () => {
  const r = await cmdCreate({ title: 'Own replies', model: 'claude-fable-5-1' }, deps(CLAUDE));
  const tid = openThread(r.id);
  await cmdReply({ id: r.id, tid, body: 'done', model: 'claude-fable-5-1' }, deps(CLAUDE));
  await cmdReply({ id: r.id, tid, body: 'done again' }, deps(CLAUDE));
  assert.equal(readMeta(r.id).reviewers, undefined);
});

test('an unknown harness flag is refused, never recorded as a different harness', async () => {
  assert.throws(() => agentIdentity({ harness: 'gemini', model: 'x' }, CLAUDE), /unknown harness "gemini"/);
  const r = await cmdCreate({ title: 'Flagged' }, deps(CLAUDE));
  await assert.rejects(
    () => cmdCredit({ id: r.id, role: 'reviewer', harness: 'gemini', model: 'x' }, deps(CLAUDE)),
    /unknown harness/,
  );
  assert.equal(readMeta(r.id).reviewers, undefined);
});

test('create refuses an unknown harness flag before it writes anything', async () => {
  await assert.rejects(
    () => cmdCreate({ title: 'Nope', harness: 'gemini', model: 'x' }, deps(CLAUDE)),
    /unknown harness "gemini"/,
  );
  assert.deepEqual(listSpecs(), []);
});

test('two processes crediting one spec at once keep every credit', async () => {
  const r = await cmdCreate({ title: 'Busy' }, deps(CLAUDE));
  const lib = new URL('../lib/credits.mjs', import.meta.url).href;
  const script = (tag) => `
    const { recordCredit } = await import(${JSON.stringify(lib)});
    for (let i = 0; i < 25; i++) recordCredit(${JSON.stringify(r.id)}, 'reviewer', { harness: 'pi', model: '${tag}-' + i });
  `;
  const run = (tag) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', script(tag)], {
      env: { ...process.env, SPECFORGE_HOME: home }, stdio: 'inherit',
    });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))));
  });
  await Promise.all([run('a'), run('b')]);
  assert.equal(readMeta(r.id).reviewers.length, 50);
});

test('an author credited without a model, replying with one, stays the author', async () => {
  const r = await cmdCreate({ title: 'Vague author' }, deps(CLAUDE));
  const tid = openThread(r.id);
  await cmdReply({ id: r.id, tid, body: 'done', model: 'claude-fable-5-1' }, deps(CLAUDE));
  assert.equal(readMeta(r.id).reviewers, undefined);
});

test('an author reviewing its own spec files the review but is not credited as a reviewer', async () => {
  const r = await cmdCreate({ title: 'Self', model: 'claude-fable-5-1' }, deps(CLAUDE));
  const out = await cmdReview({ id: r.id, model: 'claude-fable-5-1' }, deps(CLAUDE));
  assert.equal(readMeta(out.id).parent, r.id, 'the review is still filed');
  assert.equal(readMeta(r.id).reviewers, undefined);
});

test('a reply from a different agent credits it as a reviewer, once', async () => {
  const r = await cmdCreate({ title: 'Cross review', model: 'claude-fable-5-1' }, deps(CLAUDE));
  const tid = openThread(r.id);
  await cmdReply({ id: r.id, tid, body: 'looked at it', model: 'gpt-6-astra' }, deps(CODEX));
  await cmdReply({ id: r.id, tid, body: 'and again', model: 'gpt-6-astra' }, deps(CODEX));
  assert.deepEqual(readMeta(r.id).reviewers, [{ harness: 'codex', model: 'gpt-6-astra' }]);
});

test('credit records a reviewer explicitly, for a review that replied to nothing', async () => {
  const r = await cmdCreate({ title: 'Read through', model: 'claude-fable-5-1' }, deps(CLAUDE));
  const out = await cmdCredit({ id: r.id, role: 'reviewer', harness: 'pi', model: 'glm-5.3-flash' }, deps(CLAUDE));
  assert.equal(out.ok, true);
  assert.deepEqual(out.reviewers, [{ harness: 'pi', model: 'glm-5.3-flash' }]);
  assert.deepEqual(readMeta(r.id).author, { harness: 'claude', model: 'claude-fable-5-1' }, 'author untouched');
});

test('a credit that names the model replaces the same harness credited without one', async () => {
  const r = await cmdCreate({ title: 'Vague then precise' }, deps(CLAUDE));
  await cmdCredit({ id: r.id, role: 'reviewer', harness: 'codex' }, deps(CLAUDE));
  await cmdCredit({ id: r.id, role: 'reviewer', harness: 'codex', model: 'gpt-6-astra' }, deps(CLAUDE));
  await cmdCredit({ id: r.id, role: 'reviewer', harness: 'codex' }, deps(CLAUDE));
  assert.deepEqual(readMeta(r.id).reviewers, [{ harness: 'codex', model: 'gpt-6-astra' }]);
});

test('an author credit replaces the author, for a spec written before credits existed', async () => {
  const r = await cmdCreate({ title: 'Backfilled' }, deps(CLAUDE));
  await cmdCredit({ id: r.id, role: 'author', model: 'claude-opus-5' }, deps(CLAUDE));
  assert.deepEqual(readMeta(r.id).author, { harness: 'claude', model: 'claude-opus-5' });
});

test('credit refuses an unknown role and an unknown spec', async () => {
  const r = await cmdCreate({ title: 'Guarded' }, deps(CLAUDE));
  await assert.rejects(cmdCredit({ id: r.id, role: 'editor' }, deps(CLAUDE)), /--role must be one of/);
  await assert.rejects(cmdCredit({ id: 'ffffffffff', role: 'author' }, deps(CLAUDE)), /unknown spec/);
});

test('the home page row carries the author and the reviewers as chips', async () => {
  const r = await cmdCreate({ title: 'Shown on the index', model: 'claude-fable-5-1' }, deps(CLAUDE));
  await cmdCredit({ id: r.id, role: 'reviewer', harness: 'codex', model: 'gpt-6-astra' }, deps(CLAUDE));
  await cmdCredit({ id: r.id, role: 'reviewer', harness: 'pi', model: 'glm-5.3-flash' }, deps(CLAUDE));
  const html = renderIndex({});
  assert.match(html, /class="by by-author h-claude" title="Written by Claude · claude-fable-5-1">/);
  assert.match(html, /class="by by-reviewer h-codex" title="Reviewed by Codex · gpt-6-astra">/);
  assert.match(html, /class="by by-reviewer h-pi" title="Reviewed by Pi · glm-5.3-flash">/);
  assert.match(html, /<span class="by-mark"><b>✳<\/b><\/span>Claude · claude-fable-5-1/, 'each chip wears its harness glyph');
});

test('a spec with no credit renders no credit chip', async () => {
  const r = await cmdCreate({ title: 'Uncredited' }, deps(CLAUDE));
  const meta = readMeta(r.id);
  delete meta.author;
  const { writeMeta } = await import('../lib/meta.mjs');
  writeMeta(r.id, meta);
  assert.doesNotMatch(renderIndex({}), /class="by/);
});

test('review files a child spec of type review, credited both ways', async () => {
  const reviewed = await cmdCreate({ title: 'Under review', model: 'claude-fable-5-1' }, deps(CLAUDE));
  const r = await cmdReview({ id: reviewed.id, model: 'gpt-6-astra' }, deps(CODEX));
  const child = readMeta(r.id);
  assert.equal(child.type, 'review');
  assert.equal(child.parent, reviewed.id, 'filed under the spec it reviews');
  assert.equal(child.title, 'Review: Under review · Codex · gpt-6-astra');
  assert.deepEqual(child.author, { harness: 'codex', model: 'gpt-6-astra' }, 'the reviewer wrote the review');
  assert.deepEqual(readMeta(reviewed.id).reviewers, [{ harness: 'codex', model: 'gpt-6-astra' }]);
  assert.deepEqual(readMeta(reviewed.id).author, { harness: 'claude', model: 'claude-fable-5-1' }, 'author untouched');
  assert.deepEqual(r.skeleton.map((s) => s.id), ['tldr', 'scope', 'findings', 'questions']);
  assert.deepEqual(r.reviewOf, { id: reviewed.id, title: 'Under review' });
});

test('a second review is a second child, never an edit of the first', async () => {
  const reviewed = await cmdCreate({ title: 'Reviewed twice' }, deps(CLAUDE));
  const first = await cmdReview({ id: reviewed.id, model: 'gpt-6-astra' }, deps(CODEX));
  const second = await cmdReview({ id: reviewed.id, harness: 'pi', model: 'glm-5.3-flash' }, deps(CLAUDE));
  assert.notEqual(first.id, second.id);
  assert.equal(readMeta(second.id).parent, reviewed.id);
  assert.deepEqual(readMeta(reviewed.id).reviewers, [
    { harness: 'codex', model: 'gpt-6-astra' },
    { harness: 'pi', model: 'glm-5.3-flash' },
  ]);
});

test('review refuses a spec that does not exist', async () => {
  await assert.rejects(cmdReview({ id: 'ffffffffff', model: 'x' }, deps(CLAUDE)), /unknown spec/);
});

test('a repeated credit writes nothing, so the spec does not jump up the home page', async () => {
  const r = await cmdCreate({ title: 'Stable', model: 'claude-fable-5-1' }, deps(CLAUDE));
  const before = readMeta(r.id).updated;
  recordCredit(r.id, 'author', { harness: 'claude', model: 'claude-fable-5-1' });
  assert.equal(readMeta(r.id).updated, before);
});
