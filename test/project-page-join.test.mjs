// "Add to my SpecForge" on a shared project page.
//
// A reader who clicks a project link can read and comment straight away. What
// the page did not say is that they can also keep it: `join` puts the project
// on their own home page. So the page offers the command, with the URL already
// in it, and a button to copy it.
//
// Deliberately NOT a button that calls their local daemon. That would mean the
// daemon accepting cross-origin writes from any page, which turns every
// website into something that can add subscriptions to a SpecForge store. The
// clipboard is one extra paste and no new attack surface.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { JSDOM } from 'jsdom';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-pjoin-'));
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

const TOK = 'b'.repeat(32);

function seed(title, project = 'Atelier') {
  const id = createSpec({ title, html: `<h1>${title}</h1>` });
  const m = readMeta(id);
  m.project = project;
  writeMeta(id, m);
  return id;
}

test('the page offers the join command, carrying its own URL', () => {
  seed('Widget themes');
  const html = renderProjectPage('Atelier', TOK);
  assert.match(html, /Add to my SpecForge/);
  assert.ok(html.includes(`specforge join `), 'the command is shown');
  assert.ok(html.includes(`/p/${TOK}`), 'with this project’s URL in it');
});

test('the command names the origin the reader actually reached', (t) => {
  seed('Widget themes');
  const html = renderProjectPage('Atelier', TOK);
  // runScripts is the whole point: the server reaches a reader through a tunnel
  // and does not know that origin, so the page completes the command itself.
  // Without executing it, this test would pass on a page that never did.
  const { window } = new JSDOM(html, {
    url: `https://team.example/p/${TOK}`,
    runScripts: 'dangerously',
  });
  t.after(() => window.close());
  assert.equal(
    window.document.getElementById('sf-join-cmd').textContent,
    `specforge join https://team.example/p/${TOK}`,
  );
});

test('a different reader gets their own origin, not a hardcoded one', (t) => {
  seed('Widget themes');
  const { window } = new JSDOM(renderProjectPage('Atelier', TOK), {
    url: `http://192.168.1.9:4180/p/${TOK}`,
    runScripts: 'dangerously',
  });
  t.after(() => window.close());
  assert.match(window.document.getElementById('sf-join-cmd').textContent,
    /^specforge join http:\/\/192\.168\.1\.9:4180\/p\//);
});

test('Copy puts the completed command on the clipboard', async (t) => {
  seed('Widget themes');
  const { window } = new JSDOM(renderProjectPage('Atelier', TOK), {
    url: `https://team.example/p/${TOK}`,
    runScripts: 'dangerously',
  });
  t.after(() => window.close());
  const written = [];
  window.navigator.clipboard = { writeText: (v) => { written.push(v); return Promise.resolve(); } };

  window.document.getElementById('sf-join-copy').click();
  await new Promise((r) => window.setTimeout(r, 0));
  assert.deepEqual(written, [`specforge join https://team.example/p/${TOK}`]);
  assert.equal(window.document.getElementById('sf-join-copy').textContent, 'Copied');
});

test('with no clipboard the command is selected instead of the button dying', async (t) => {
  seed('Widget themes');
  const { window } = new JSDOM(renderProjectPage('Atelier', TOK), {
    url: `https://team.example/p/${TOK}`,
    runScripts: 'dangerously',
  });
  t.after(() => window.close());
  // An insecure context has no navigator.clipboard at all.
  window.navigator.clipboard = undefined;

  window.document.getElementById('sf-join-copy').click();
  await new Promise((r) => window.setTimeout(r, 0));
  const sel = window.getSelection();
  assert.ok(sel && sel.rangeCount > 0, 'something is selected');
  assert.match(sel.toString(), /specforge join https:\/\/team\.example/);
});

test('nothing on the page writes to a reader’s machine', () => {
  seed('Widget themes');
  const html = renderProjectPage('Atelier', TOK);
  assert.doesNotMatch(html, /127\.0\.0\.1|localhost/,
    'no call to the reader’s own daemon, from a page any site could imitate');
  assert.doesNotMatch(html, /method:\s*['"]POST/i, 'and no writes at all');
});

test('the affordance is quiet: it explains what joining gets you', () => {
  seed('Widget themes');
  // Collapsed first: the prose wraps, so a phrase can straddle a newline.
  const text = renderProjectPage('Atelier', TOK).replace(/\s+/g, ' ');
  assert.match(text, /your own home page/i,
    'a reader should know what the command does before running it');
  assert.match(text, /Shared with me/,
    'and where it will show up, which is the rail this feature added');
});

test('the join block sits above the list, not below it', () => {
  // Under the list it was below the fold on any project past a screenful, so
  // the readers most likely to want their own copy were the least likely to
  // reach it. Asserted on position rather than presence: every other test here
  // passes wherever the block sits.
  const html = renderProjectPage('Atelier', TOK);
  for (const n of ['Widget themes', 'Pricing designer']) seed(n);
  const withRows = renderProjectPage('Atelier', TOK);
  assert.ok(html.indexOf('Add to my SpecForge') > 0, 'the block is on the page');
  assert.ok(
    withRows.indexOf('Add to my SpecForge') < withRows.indexOf('Widget themes'),
    'and it comes before the first spec row',
  );
});

test('the project name and its specs still render alongside it', () => {
  seed('Widget themes');
  seed('Pricing designer');
  const html = renderProjectPage('Atelier', TOK);
  assert.match(html, /Widget themes/);
  assert.match(html, /Pricing designer/);
  assert.match(html, /Atelier/);
});
