// Who else has worked on a project's specs.
//
// The question the shared project page answers is "who else is in here" — the
// people a reader might recognise, not the owner and not the agent. Both
// exclusions come out of how a name is acquired rather than from any identity
// record, because the store has none:
//
//   - The agent is excluded by `kind`, never by name. Authors are free text, so
//     a person called claude is possible and only `kind` is authoritative.
//   - The owner is excluded because they are never named. The welcome dialog
//     runs only on a published copy (review.js: transport === 'poll'), and it
//     refuses to close without a name, so every reviewer who arrives through a
//     shared link is named and the owner's own comments keep the pre-authors
//     default 'human' that store-api hands out when a request carries no name.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'sf-collab-'));
process.env.SPECFORGE_HOME = home;

const { projectCollaborators, OWNER_DEFAULT } = await import('../lib/collaborators.mjs');
const { normalizeAuthor, isReservedName, mentionsAgent } = await import('../lib/mentions.mjs');
const { specDir } = await import('../lib/store-paths.mjs');

/** Seed a spec's comment store from [author, kind, ...] tuples. */
function seed(id, comments) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(join(specDir(id), 'comments.json'), JSON.stringify({
    specId: id,
    threads: [{
      id: `th_${id}`,
      state: 'open',
      anchor: { block: { index: 0, tag: 'p', text: 'x' } },
      comments: comments.map(([author, kind], i) => ({
        id: `c_${id}_${i}`, author, ...(kind ? { kind } : {}), body: 'x',
        createdAt: new Date(2026, 0, 1 + i).toISOString(),
      })),
    }],
  }));
}

before(() => {
  seed('s1', [
    ['human', 'human'],   // the owner
    ['claude', 'agent'],  // the agent
    ['Lavee', 'human'],
    ['Lavee', 'human'],
    ['Ravi', 'human'],
  ]);
  seed('s2', [
    ['human', 'human'],
    ['Lavee', 'human'],
  ]);
  seed('s3', [['human', 'human'], ['claude', 'agent']]); // nobody external
});
after(() => rmSync(home, { recursive: true, force: true }));

test('lists the people who commented, and neither the owner nor the agent', () => {
  const who = projectCollaborators(['s1', 's2', 's3']);
  assert.deepEqual(who.map((c) => c.name), ['Lavee', 'Ravi']);
});

test('each carries how much they did, deduped across specs', () => {
  const [lavee, ravi] = projectCollaborators(['s1', 's2', 's3']);
  assert.deepEqual(lavee, { name: 'Lavee', comments: 3, specs: 2 });
  assert.deepEqual(ravi, { name: 'Ravi', comments: 1, specs: 1 });
});

test('the busiest reviewer is first, ties broken by name', () => {
  seed('t1', [['Zoe', 'human'], ['Abe', 'human'], ['Mo', 'human'], ['Mo', 'human']]);
  assert.deepEqual(projectCollaborators(['t1']).map((c) => c.name), ['Mo', 'Abe', 'Zoe']);
});

test('a project nobody outside has touched has no collaborators', () => {
  assert.deepEqual(projectCollaborators(['s3']), []);
});

test('a spec with no comment store at all is skipped, not an error', () => {
  assert.deepEqual(projectCollaborators(['s1', 'never-existed']).map((c) => c.name),
    ['Lavee', 'Ravi']);
});

test('the agent is excluded by kind, so a person may be called claude', () => {
  // Authors are free text and `kind` is the only authority: a reviewer who types
  // "claude" is a person whose comments say kind: human. (store-api reserves the
  // name on the write path, so this is defence for stores written before it did.)
  seed('k1', [['claude', 'human'], ['claude', 'agent']]);
  assert.deepEqual(projectCollaborators(['k1']), [{ name: 'claude', comments: 1, specs: 1 }]);
});

test('a comment stored before kind existed is still classified', () => {
  // Nothing on disk is ever rewritten (comments.mjs), so the fallback in kindOf
  // is what these depend on: author 'claude' was the agent's only name.
  seed('old', [['claude'], ['human'], ['Priya']]);
  assert.deepEqual(projectCollaborators(['old']), [{ name: 'Priya', comments: 1, specs: 1 }]);
});

test('no reviewer can be recorded under the owner\'s default name', () => {
  // The exclusion above reads a name, so the name has to mean one thing. It is
  // reserved on the write path for exactly that reason — without it a reviewer
  // who typed "human" would be filed as the owner and vanish from this list,
  // counts and all. Raised in review of PR #219.
  assert.equal(normalizeAuthor(OWNER_DEFAULT), null, 'the store refuses it');
  assert.equal(normalizeAuthor('Human'), null, 'in any casing');
  assert.equal(isReservedName(OWNER_DEFAULT), true);
  // And it is still an ordinary name to everything that is not a display name:
  // reserving it must not make the WORD unusable in a comment.
  assert.equal(mentionsAgent('a human wrote this'), false);
});

test('one person who typed their name two ways is one person', () => {
  // A published spec is its own origin, so the name is asked once PER LINK: a
  // reviewer on four specs types it four times. Folding case is what stops
  // "lavee" and "Lavee" reading as two people; the spelling shown is the one
  // they used first.
  seed('c1', [['Lavee', 'human'], ['lavee', 'human'], ['LAVEE', 'human']]);
  assert.deepEqual(projectCollaborators(['c1']), [{ name: 'Lavee', comments: 3, specs: 1 }]);
});
