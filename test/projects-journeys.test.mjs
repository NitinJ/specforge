// End-to-end journeys for projects, driven the way a person drives them: over
// HTTP against a real daemon, or through the page's own script in a jsdom
// window. Each one is a sentence from the spec's §15, and each asserts the state
// the store is left in rather than the calls made on the way.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createDaemon, renderIndex } from '../server/daemon.mjs';
import { readMeta } from '../lib/meta.mjs';
import { readGlobalPrefs, writeGlobalPrefs } from '../lib/global-prefs.mjs';
import { cmdCreate } from '../lib/specforge-cli.mjs';
import { useTempStore } from './helpers/temp-store.mjs';
import { seedProjects } from './helpers/project-store.mjs';
import { loadIndex, tick } from './helpers/index-dom.mjs';

const store = useTempStore({ beforeEach, afterEach }, 'sf-journey-');

let server;
let base;

beforeEach(async () => {
  server = createDaemon();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(() => server.close());

const organize = (id, body) => fetch(`${base}/api/spec/${id}/organize`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const putPrefs = (body) => fetch(`${base}/api/prefs`, {
  method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const projectOf = (id) => readMeta(id).project || null;
const answerPrompt = (document, value) => {
  document.getElementById('sf-dp-input').value = value;
  document.getElementById('sf-dp-ok').click();
};

test('journey: file a body of work into a project', async () => {
  // A store organised the way one is before projects exist: everything in
  // collections, nothing in a project.
  const seeded = seedProjects({ '': { Research: 3, UI: 1 } });
  const research = seeded.at('', 'Research');

  await putPrefs({ projects: ['shopify'] });
  for (const id of research) await organize(id, { project: 'shopify' });

  for (const id of research) {
    assert.equal(projectOf(id), 'shopify');
    assert.equal(readMeta(id).collection, 'Research', 'the collection travels with the spec');
  }
  assert.equal(projectOf(seeded.first('', 'UI')), null, 'nothing else moved');

  const html = renderIndex();
  assert.match(html, /<section class="pgrp" data-p="shopify">/);
  assert.match(html, /data-p="shopify" data-coll="Research">\s*<h2>Research <span class="gcount">3<\/span>/);
});

test('journey: the same collection name in two projects stays two collections', async () => {
  await putPrefs({ projects: ['figur', 'specforge'] });
  const seeded = seedProjects({ figur: { UI: 2 }, specforge: { UI: 1 } });

  // Rename figur's UI. specforge's is a different collection and must not move.
  for (const id of seeded.at('figur', 'UI')) await organize(id, { collection: 'Interface' });

  assert.deepEqual(seeded.at('figur', 'UI').map((id) => readMeta(id).collection), ['Interface', 'Interface']);
  assert.equal(readMeta(seeded.first('specforge', 'UI')).collection, 'UI');

  const html = renderIndex();
  assert.match(html, /data-p="figur" data-coll="Interface"/);
  assert.match(html, /data-p="specforge" data-coll="UI"/);
});

test('journey: deleting a project keeps every spec it held', async (t) => {
  await putPrefs({ projects: ['figur'] });
  const seeded = seedProjects({ figur: { UI: 2, Product: 1 } });
  const { window, calls } = loadIndex(t);
  const { document } = window;

  document.querySelector('.prow[data-p="figur"] .kebab').click();
  const del = [].slice.call(document.querySelectorAll('#menu .mitem'))
    .find((b) => b.querySelector('span:last-child').textContent.startsWith('Delete'));
  del.click();
  document.getElementById('sf-dc-ok').click();
  await tick(window);
  await tick(window);

  // The page fans out one PATCH per member; replay them against the daemon so
  // the store ends up where the browser would have left it.
  for (const c of calls.filter((x) => x.method === 'PATCH' && /\/organize$/.test(x.url))) {
    await fetch(base + c.url, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(c.body),
    });
  }
  await putPrefs(calls.filter((x) => x.method === 'PUT' && Array.isArray(x.body.projects)).at(-1).body);

  assert.equal(seeded.ids.length, 3);
  for (const id of seeded.ids) assert.ok(readMeta(id), 'the spec still exists');
  assert.deepEqual(seeded.ids.map(projectOf), [null, null, null], 'all unfiled');
  assert.deepEqual(
    seeded.ids.map((id) => readMeta(id).collection).sort(),
    ['Product', 'UI', 'UI'],
    'and each kept the collection it was in',
  );
  assert.deepEqual(readGlobalPrefs().projects, [], 'the name is gone from the rail');
});

test('journey: a spec created while a project is showing is filed into it', async () => {
  writeGlobalPrefs({ projects: ['figur-design-studio'], project: 'figur-design-studio' });
  const r = await cmdCreate(
    { title: 'Wardrobe grid v2' },
    { session: 'sess-j', ensureDaemon: async () => ({ url: base }) },
  );

  assert.equal(projectOf(r.id), 'figur-design-studio');
  // And the spec page names it, which is what the header chip reads.
  const meta = await (await fetch(`${base}/api/spec/${r.id}/meta`)).json();
  assert.equal(meta.project, 'figur-design-studio');
});

test('journey: a shared spec discloses no project', async () => {
  const { newToken } = await import('../lib/tokens.mjs');
  const { createGatewayServer } = await import('../lib/gateway.mjs');
  // The title is named explicitly so it cannot contain the project name: the
  // assertion below is that the project does not leak, not that no string
  // matches.
  const seeded = seedProjects({ 'figur-design-studio': { UI: ['Wardrobe grid v2'] } });
  const id = seeded.ids[0];

  const token = newToken();
  const gw = createGatewayServer((t) => (t === token ? id : null));
  await new Promise((r) => gw.listen(0, '127.0.0.1', r));
  const gwBase = `http://127.0.0.1:${gw.address().port}`;
  try {
    const body = await (await fetch(`${gwBase}/s/${token}/api/meta`)).text();
    assert.equal('project' in JSON.parse(body), false);
    assert.equal(body.includes('figur-design-studio'), false, 'the name is nowhere in the reader payload');

    const page = await (await fetch(`${gwBase}/s/${token}`)).text();
    assert.equal(page.includes('figur-design-studio'), false, 'nor in the page it is served');
  } finally {
    await new Promise((r) => gw.close(r));
  }
});

test('journey: a store that has never used a project renders as it always did', () => {
  seedProjects({ '': { Research: 2, Design: 1, '': 3 } });
  const html = renderIndex();

  // The no-migration guarantee, stated as an assertion: one pseudo-project, the
  // collections inside it, and no selection to explain.
  assert.equal((html.match(/<section class="pgrp"/g) || []).length, 1);
  assert.match(html, /<section class="pgrp" data-p="">/);
  assert.match(html, /<body>/, 'not scoped to a project');
  assert.match(html, /id="htitle">All specs</);
  assert.equal(html.includes('style="display:none"'), false, 'nothing hidden');
  assert.equal((html.match(/<li class="row/g) || []).length, 6, 'every spec is on the page');
});

test('journey: the header chip opens the home page on that project', async () => {
  writeGlobalPrefs({ projects: ['figur', 'specforge'], project: 'figur' });
  seedProjects({ figur: { UI: 1 }, specforge: { Engineering: 2 } });

  // What the chip's href resolves to.
  const html = await (await fetch(`${base}/?project=${encodeURIComponent('specforge')}`)).text();
  assert.match(html, /<button class="pnav on"[^>]*data-p="specforge"/);
  assert.match(html, /id="htitle">specforge</);
  assert.equal(readGlobalPrefs().project, 'figur', 'the GET itself stores nothing');
});

test('journey: templates stay reachable from inside every project', async () => {
  const { ensureTemplates } = await import('../lib/store-templates.mjs');
  ensureTemplates();
  await putPrefs({ projects: ['figur'], project: 'figur' });
  seedProjects({ figur: { UI: 1 } });

  const html = renderIndex();
  assert.equal((html.match(/<section class="tpls">/g) || []).length, 1);
  assert.equal(html.indexOf('<section class="tpls">') > html.lastIndexOf('<section class="pgrp"'), true);
  // And a template cannot be filed into one.
  const { templateId } = await import('../lib/store-templates.mjs');
  assert.equal((await organize(templateId('design'), { project: 'figur' })).status, 403);
  assert.equal(readMeta(templateId('design')).project ?? null, null);
});

test('journey: the store directory gains no new file for any of this', async () => {
  const { readdirSync } = await import('node:fs');
  await putPrefs({ projects: ['figur'], project: 'figur' });
  seedProjects({ figur: { UI: 1 } });

  const entries = readdirSync(store.dir).sort();
  assert.deepEqual(entries, ['specs', 'ui.json'], 'projects live in meta.json and ui.json, nowhere else');
});
