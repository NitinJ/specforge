// The Collaborators line on a shared project page.
//
// A reader arriving at a project link cannot tell whether they are the first
// person here or the fifth. The names of the reviewers who have already
// commented answer that, and they are already visible on every spec page's
// comments — this only gathers them where a reader meets them first.
//
// Who counts is lib/collaborators.mjs's business (see its tests). What this
// file covers is the page: the section is present when there is someone to
// name, absent when there is not, and it sits above the fold.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-pcollab-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const { renderProjectPage } = await import('../server/project-page.mjs');
const { createSpec } = await import('../lib/store.mjs');
const { readMeta, writeMeta } = await import('../lib/meta.mjs');
const { specDir } = await import('../lib/store-paths.mjs');

const TOK = 'c'.repeat(32);

/** A spec in `project`, with one thread carrying [author, kind] comments. */
function seed(title, comments = [], project = 'Atelier') {
  const id = createSpec({ title, html: `<h1>${title}</h1>` });
  const m = readMeta(id);
  m.project = project;
  writeMeta(id, m);
  if (comments.length) {
    writeFileSync(join(specDir(id), 'comments.json'), JSON.stringify({
      specId: id,
      threads: [{
        id: `th_${id}`,
        state: 'open',
        anchor: { block: { index: 0, tag: 'p', text: 'x' } },
        comments: comments.map(([author, kind], i) => ({
          id: `c_${id}_${i}`, author, kind, body: 'x',
          createdAt: new Date(2026, 0, 1 + i).toISOString(),
        })),
      }],
    }));
  }
  return id;
}

const dom = (html) => new JSDOM(html).window.document;
const names = (doc) => [...doc.querySelectorAll('.collab .person')].map((e) => e.textContent.trim());

test('the reviewers are named, and the owner and agent are not', () => {
  seed('Widget themes', [['human', 'human'], ['claude', 'agent'], ['Lavee', 'human']]);
  seed('Pricing', [['Ravi', 'human'], ['Lavee', 'human']]);
  const doc = dom(renderProjectPage('Atelier', TOK));
  assert.deepEqual(names(doc), ['Lavee', 'Ravi']);
  assert.equal(doc.querySelector('.collab .gcount').textContent, '2');
});

test('each name says how much that person did', () => {
  // The count is what separates someone who left one remark from someone who
  // reviewed the whole project, and it is the reason to gather the names at all.
  seed('Widget themes', [['Lavee', 'human'], ['Lavee', 'human']]);
  seed('Pricing', [['Lavee', 'human']]);
  const doc = dom(renderProjectPage('Atelier', TOK));
  assert.equal(doc.querySelector('.collab .person').getAttribute('title'),
    '3 comments on 2 specs');
});

test('one comment on one spec is said in the singular', () => {
  seed('Widget themes', [['Ravi', 'human']]);
  const doc = dom(renderProjectPage('Atelier', TOK));
  assert.equal(doc.querySelector('.collab .person').getAttribute('title'),
    '1 comment on 1 spec');
});

test('a project nobody outside has commented on shows no section', () => {
  // Not an empty heading: "Collaborators 0" is a fact nobody needs, and this is
  // the ordinary state of a project the moment it is shared.
  seed('Widget themes', [['human', 'human'], ['claude', 'agent']]);
  const doc = dom(renderProjectPage('Atelier', TOK));
  assert.equal(doc.querySelector('.collab'), null);
});

test('only this project\'s specs count', () => {
  seed('Widget themes', [['Lavee', 'human']]);
  seed('Someone else\'s', [['Mallory', 'human']], 'Other');
  const doc = dom(renderProjectPage('Atelier', TOK));
  assert.deepEqual(names(doc), ['Lavee']);
});

test('the section sits between the heading and the join panel', () => {
  // Above the list, where a reader meets it without scrolling — the same reason
  // the join panel is there. Below the list it would be past the fold on any
  // project of more than a screenful.
  seed('Widget themes', [['Lavee', 'human']]);
  const doc = dom(renderProjectPage('Atelier', TOK));
  const order = [...doc.querySelectorAll('main > *')].map((e) => e.className || e.tagName);
  assert.deepEqual(order.slice(0, 3), ['head', 'collab', 'join']);
});

test('a name is escaped, not rendered', () => {
  // Display names are self-asserted free text typed by a reviewer, and this page
  // is served to every other reviewer.
  seed('Widget themes', [['<img src=x onerror=alert(1)>', 'human']]);
  const html = renderProjectPage('Atelier', TOK);
  assert.equal(html.includes('<img src=x'), false, 'no raw tag reaches the page');
  const doc = dom(html);
  assert.deepEqual(names(doc), ['<img src=x onerror=alert(1)>']);
  assert.equal(doc.querySelector('.collab img'), null, 'and nothing was parsed as markup');
});
