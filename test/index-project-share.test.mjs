// Sharing a project from the home page.
//
// The CLI could already do it; this is the affordance beside the one a spec
// has had all along. Two places, because a project is selected far more often
// than its kebab is opened: the rail row's menu, and the header of the project
// you are looking at.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { renderIndex } from '../server/daemon.mjs';
import { createSpec } from '../lib/store.mjs';
import { readMeta, writeMeta } from '../lib/meta.mjs';
import { loadIndex, tick } from './helpers/index-dom.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-idx-pshare-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

/** A spec filed into a project. */
function seed(title, project) {
  const id = createSpec({ title, html: `<h1>${title}</h1>` });
  const m = readMeta(id);
  m.project = project;
  writeMeta(id, m);
  return id;
}

const SHARED = { url: 'https://team.example/p/abc', token: 'abc', live: true };

/** The rail row's markup, which is where the state lives — the page's own
 *  script names the attribute too, so a whole-page match proves nothing. */
function rowMarkup(html, name) {
  const m = html.match(new RegExp(`<div class="prow" data-p="${name}"[^>]*>`));
  return m ? m[0] : '';
}

test('an unshared project renders no share link, a shared one does', () => {
  seed('Widget themes', 'Atelier');
  const off = renderIndex({ projectShareInfo: () => null });
  assert.doesNotMatch(rowMarkup(off, 'Atelier'), /data-share-url/);

  const on = renderIndex({ projectShareInfo: (n) => (n === 'Atelier' ? SHARED : null) });
  assert.match(rowMarkup(on, 'Atelier'), /data-share-url="https:\/\/team\.example\/p\/abc"/,
    'the row carries the URL, so the header can read it without a second fetch');
});

test('a dead tunnel is not advertised as a live link', () => {
  seed('Widget themes', 'Atelier');
  const html = renderIndex({ projectShareInfo: () => ({ ...SHARED, live: false }) });
  assert.doesNotMatch(rowMarkup(html, 'Atelier'), /data-share-url/,
    'a link that does not answer is worse than no link');
});

test('the header carries a share control for the selected project', async (t) => {
  seed('Widget themes', 'Atelier');
  const { window } = loadIndex(t, {
    project: 'Atelier',
    projectShareInfo: () => null,
  });
  const btn = window.document.getElementById('pshare');
  assert.ok(btn, 'the control exists');
  assert.equal(btn.hidden, false, 'and shows for a named project');
  assert.match(btn.textContent, /Share/);
});

test('the header control is hidden on All projects and on No project', async (t) => {
  seed('Widget themes', 'Atelier');
  seed('Loose', null);
  const all = loadIndex(t, { projectShareInfo: () => null });
  assert.equal(all.window.document.getElementById('pshare').hidden, true,
    'All projects is not a thing you can share');

  const none = loadIndex(t, { project: '', projectShareInfo: () => null });
  assert.equal(none.window.document.getElementById('pshare').hidden, true,
    'and neither is the No-project bucket');
});

test('clicking Share in the header publishes the selected project', async (t) => {
  seed('Widget themes', 'Atelier');
  const { window, calls } = loadIndex(t, {
    project: 'Atelier',
    projectShareInfo: () => null,
  }, {
    respond: () => ({ ok: true, share: { project: 'Atelier', url: 'https://team.example/p/abc' } }),
  });
  window.document.getElementById('pshare').click();
  await tick(window);

  const post = calls.find((c) => c.method === 'POST' && /\/api\/project\//.test(c.url));
  assert.ok(post, 'a share request was made');
  assert.equal(post.url, '/api/project/Atelier/share');
});

test('once shared, the header offers the link and a way to stop', async (t) => {
  seed('Widget themes', 'Atelier');
  const { window } = loadIndex(t, {
    project: 'Atelier',
    projectShareInfo: () => SHARED,
  });
  const link = window.document.getElementById('pshare-link');
  assert.ok(link, 'the link is shown rather than the Share button');
  assert.equal(link.getAttribute('href'), 'https://team.example/p/abc');
  assert.equal(window.document.getElementById('pshare').hidden, true, 'and Share is not offered twice');
  assert.ok(window.document.getElementById('pshare-copy'), 'with a copy control');
});

test('switching projects moves the share control with the selection', async (t) => {
  seed('Widget themes', 'Atelier');
  seed('Gateway billing', 'Gateway');
  const { window } = loadIndex(t, {
    project: 'Atelier',
    projectShareInfo: (n) => (n === 'Atelier' ? SHARED : null),
  });
  // Atelier is shared, so the link shows.
  assert.equal(window.document.getElementById('pshare-link').hidden, false);

  // Select Gateway, which is not shared: the link goes, the button returns.
  const gateway = window.document.querySelector('.pnav[data-p="Gateway"]');
  gateway.click();
  await tick(window);
  assert.equal(window.document.getElementById('pshare-link').hidden, true);
  assert.equal(window.document.getElementById('pshare').hidden, false);
});

test('the project kebab offers Share, and Copy/Unshare once shared', async (t) => {
  seed('Widget themes', 'Atelier');
  const unshared = loadIndex(t, { projectShareInfo: () => null });
  const kebab = unshared.window.document.querySelector('.prow[data-p="Atelier"] .kebab');
  kebab.click();
  await tick(unshared.window);
  let labels = [...unshared.window.document.querySelectorAll('.menu button')]
    .map((b) => b.textContent.trim());
  assert.ok(labels.some((l) => /Share project/.test(l)), `Share is offered: ${labels.join(', ')}`);
  assert.ok(!labels.some((l) => /Unshare/.test(l)), 'and Unshare is not, since it is not shared');

  const shared = loadIndex(t, { projectShareInfo: () => SHARED });
  shared.window.document.querySelector('.prow[data-p="Atelier"] .kebab').click();
  await tick(shared.window);
  labels = [...shared.window.document.querySelectorAll('.menu button')]
    .map((b) => b.textContent.trim());
  assert.ok(labels.some((l) => /Copy link/.test(l)));
  assert.ok(labels.some((l) => /Unshare/.test(l)));
});

test('unsharing asks first, because the link is already out there', async (t) => {
  seed('Widget themes', 'Atelier');
  const { window, calls } = loadIndex(t, { projectShareInfo: () => SHARED });
  window.document.querySelector('.prow[data-p="Atelier"] .kebab').click();
  await tick(window);
  const unshare = [...window.document.querySelectorAll('.menu button')]
    .find((b) => /Unshare/.test(b.textContent));
  unshare.click();
  await tick(window);

  assert.equal(calls.find((c) => c.method === 'DELETE'), undefined, 'nothing happened yet');
  assert.ok(window.document.querySelector('.sfui-dialog, dialog'), 'a confirmation is up');
});
