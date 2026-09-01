// Token-cost recommendations R1–R3 (spec 3067be852a):
//
// R1  comments <id> is batch-scoped by default: only the threads named in
//     pending batches ride in the payload; --all restores the full dump.
// R2  list/listall print compact one-line rows by default; --json keeps the
//     machine shape.
// R3  create returns a skeleton (section id + line range + placeholder) so the
//     agent never has to read the whole shell to find the blanks.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';

import { cmdCreate, cmdListall, cmdComments, formatRowsCompact } from '../lib/specforge-cli.mjs';
import { mutateComments } from '../lib/store-comments.mjs';
import { submitBatch } from '../lib/store-inbox.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let home;
let prevHome;

const deps = (session = 'sess-1') => ({
  session,
  ensureDaemon: async () => ({ url: 'http://127.0.0.1:4180/', port: 4180 }),
});

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-tok-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

function addThreads(id) {
  mutateComments(id, (store) => {
    store.threads.push(
      {
        id: 'th_agent', state: 'open',
        anchor: { block: { index: 0, tag: 'H1', text: 't', sectionPath: [], bid: 'b1' } },
        comments: [{ id: 'c1', author: 'human', kind: 'human', body: '@agent fix this', createdAt: new Date().toISOString() }],
      },
      {
        id: 'th_chat', state: 'open',
        anchor: { block: { index: 1, tag: 'P', text: 'u', sectionPath: [], bid: 'b2' } },
        comments: [{ id: 'c2', author: 'human', kind: 'human', body: 'btw, unrelated', createdAt: new Date().toISOString() }],
      },
    );
    return ['th_agent'];
  });
}

// --- R1: comments is batch-scoped by default ---

test('comments returns only threads named in pending batches', async () => {
  const { id } = await cmdCreate({ title: 'A' }, deps());
  addThreads(id);
  const batch = submitBatch(id);
  assert.ok(batch, 'the agent-directed thread freezes into a batch');

  const scoped = await cmdComments({ id });
  assert.deepEqual(scoped.threads.map((t) => t.id), ['th_agent'],
    'the discussion thread (th_chat) is not in the payload');
  assert.ok(scoped.language, 'the language contract still rides along');
  assert.ok(scoped.htmlPath, 'htmlPath still present');
  assert.equal(scoped.pending.length, 1);
  assert.deepEqual(scoped.pending[0].threadIds, ['th_agent']);
});

test('comments --all restores the full dump', async () => {
  const { id } = await cmdCreate({ title: 'A' }, deps());
  addThreads(id);
  submitBatch(id);
  const all = await cmdComments({ id, all: true });
  assert.equal(all.threads.length, 2);
  assert.deepEqual(all.threads.map((t) => t.id).sort(), ['th_agent', 'th_chat']);
});

test('comments with nothing pending returns empty threads, not the whole spec', async () => {
  const { id } = await cmdCreate({ title: 'A' }, deps());
  addThreads(id); // a thread, but no @agent, so no batch
  const scoped = await cmdComments({ id });
  assert.deepEqual(scoped.threads, []);
  assert.deepEqual(scoped.pending, []);
  const all = await cmdComments({ id, all: true });
  assert.equal(all.threads.length, 2, '--all still works with nothing pending');
});

// --- R2: compact list output ---

test('formatRowsCompact prints one line per spec: id status type attached title', () => {
  const line = formatRowsCompact([
    { id: 'b912d210dd', title: 'UX architecture', type: 'design', status: 'draft', attached: 'free' },
  ]);
  assert.equal(line, 'b912d210dd  draft  design  free  UX architecture');
});

test('formatRowsCompact handles an empty store', () => {
  assert.equal(formatRowsCompact([]), '');
});

test('listall still returns the machine shape from the function', async () => {
  await cmdCreate({ title: 'A' }, deps('sess-1'));
  const { rows, indexUrl, session } = await cmdListall({}, deps());
  assert.equal(rows.length, 1);
  assert.ok(rows[0].title);
  assert.equal(indexUrl, 'http://127.0.0.1:4180/');
  assert.equal(session, 'sess-1');
});

// --- R3: create returns a skeleton ---

test('create returns a skeleton with section ids, line ranges and placeholders', async () => {
  const r = await cmdCreate({ title: 'Skel' }, deps());
  assert.ok(Array.isArray(r.skeleton), 'skeleton rides in the create payload');
  assert.ok(r.skeleton.length >= 1);

  const html = readFileSync(r.htmlPath, 'utf8');
  const lines = html.split('\n');
  for (const s of r.skeleton) {
    assert.match(s.lines, /^\d+-\d+$/, 'line range shape');
    const [a, b] = s.lines.split('-').map(Number);
    assert.ok(a >= 1 && b >= a, `sane range for ${s.id}`);
    const sectionAt = lines[a - 1] + '\n' + (lines[a] || '');
    assert.match(sectionAt, /<section\b/, `the range points at section ${s.id}`);
    assert.ok(s.title !== undefined, 'header carried');
  }
  const tldr = r.skeleton.find((s) => s.id === 'tldr');
  assert.ok(tldr, 'tldr section present');
  assert.ok(tldr.fills.some((f) => f.startsWith('{{')), 'placeholders listed for tldr');
  assert.ok(existsSync(r.htmlPath));
});