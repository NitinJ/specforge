// Changing a spec's parent from the home page.
//
// The parent field and the endpoint that writes it both shipped with the child
// specs work; what did not ship was any way to reach them from a browser. These
// tests cover the three pieces that close that: which menu rows a row offers,
// which specs the picker is willing to offer as a destination, and what the page
// does with each answer the server can give.
//
// The picker's list is a FILTER, not the guard. The server's cycle check stays
// the only thing that decides whether a move is legal, so the tests below assert
// both halves: that an impossible destination is kept out of the list, and that
// one arriving anyway is refused without changing the page.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec, buildShape } from './helpers/spec-tree-fixtures.mjs';
import { loadIndex, tick } from './helpers/index-dom.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-reparent-');

const rowFor = (doc, id) => doc.querySelector(`.row[data-id="${id}"]`);
// The icon and the label are two spans, and the icon is a glyph: reading the
// whole button back gives "✎Rename…", which no assertion should have to spell.
const labelOf = (item) => item.lastElementChild.textContent.trim();
const menuLabels = (doc) => [...doc.querySelectorAll('#menu .mitem')].map(labelOf);

/** Open a spec row's actions menu and return the labels it drew. */
function openRowMenu(doc, id) {
  rowFor(doc, id).querySelector('.kebab').click();
  return menuLabels(doc);
}

/** Click a menu row by the label it shows. */
function clickMenu(doc, label) {
  const hit = [...doc.querySelectorAll('#menu .mitem')].find((b) => labelOf(b) === label);
  assert.ok(hit, `no menu row labelled ${label}`);
  hit.click();
}

/** The titles the picker is currently offering, in the order it drew them. */
const pickLabels = (doc) => [...doc.querySelectorAll('#plist .pitem .pname')].map((s) => s.textContent);
const pickValues = (doc) => [...doc.querySelectorAll('#plist .pitem')].map((b) => b.getAttribute('data-v'));

/** Open "Move under spec…" on a row and leave the picker on screen. */
function openSpecPicker(doc, id) {
  openRowMenu(doc, id);
  clickMenu(doc, 'Move under spec…');
  return doc.getElementById('cpick');
}

const snackText = (doc) => [...doc.querySelectorAll('.sfui-snack-msg')].map((s) => s.textContent).join(' | ');
const organizeCalls = (calls) => calls.filter((c) => c.method === 'PATCH' && /\/organize$/.test(c.url));

// ── the menu rows ────────────────────────────────────────────────────────────

test('every spec row offers "Move under spec…"', async (t) => {
  const solo = seedSpec({ title: 'Solo' });
  const { window } = loadIndex(t, {});

  assert.ok(openRowMenu(window.document, solo).includes('Move under spec…'));
});

test('"Detach from parent" is drawn on a child and not on a root', async (t) => {
  const root = seedSpec({ title: 'Root' });
  const kid = seedSpec({ title: 'Kid', parent: root });
  const { window } = loadIndex(t, {});
  const doc = window.document;

  assert.equal(openRowMenu(doc, root).includes('Detach from parent'), false,
    'a spec with no parent offered an action that would do nothing');
  assert.equal(openRowMenu(doc, kid).includes('Detach from parent'), true);
});

test('the reparent rows sit between the project move and the shared project action', async (t) => {
  const root = seedSpec({ title: 'Root' });
  seedSpec({ title: 'Kid', parent: root });
  const { window } = loadIndex(t, {});
  const labels = openRowMenu(window.document, root);

  assert.ok(labels.indexOf('Move under spec…') > labels.indexOf('Move to project…'));
  assert.ok(labels.indexOf('Move under spec…') < labels.indexOf('Add to a shared project…'));
  assert.equal(labels[labels.length - 1], 'Delete spec…', 'delete must stay last');
});

// ── which specs the picker offers ────────────────────────────────────────────

test('the picker offers every other spec and never the one being moved', async (t) => {
  const a = seedSpec({ title: 'Alpha' });
  const b = seedSpec({ title: 'Beta' });
  const c = seedSpec({ title: 'Gamma' });
  const { window } = loadIndex(t, {});
  const doc = window.document;

  openSpecPicker(doc, a);
  const values = pickValues(doc);

  assert.equal(values.includes(a), false, 'a spec was offered as its own parent');
  assert.ok(values.includes(b));
  assert.ok(values.includes(c));
});

test('a spec below the one being moved is not offered', async (t) => {
  const { ids } = buildShape('chain5');
  const [l0, l1, l2, l3, l4] = ids;
  const { window } = loadIndex(t, {});
  const doc = window.document;

  openSpecPicker(doc, l1);
  const values = pickValues(doc);

  assert.deepEqual(values.filter((v) => v), [l0],
    'only the spec above the one being moved is a legal destination in a chain');
  for (const below of [l1, l2, l3, l4]) assert.equal(values.includes(below), false);
});

test('a ring in the data does not hang the picker', async (t) => {
  const { ids } = buildShape('cyclic');
  const { window } = loadIndex(t, {});
  const doc = window.document;

  openSpecPicker(doc, ids[0]);

  // Every member of a ring is below every other, so the only destination left is
  // "no parent". The assertion that matters is that the call returned at all.
  assert.equal(doc.getElementById('cpick').hidden, false);
  assert.deepEqual(pickValues(doc), ['']);
});

test('a spec whose parent is missing is still offered as a destination', async (t) => {
  const { child } = buildShape('dangling');
  const mover = seedSpec({ title: 'Mover' });
  const { window } = loadIndex(t, {});
  const doc = window.document;

  openSpecPicker(doc, mover);

  assert.ok(pickValues(doc).includes(child),
    'an orphan is a spec like any other and can take a child');
});

test('the picker lists specs by title, filters on it, and offers no create button', async (t) => {
  const a = seedSpec({ title: 'Widget theming' });
  seedSpec({ title: 'Gateway schema' });
  const { window } = loadIndex(t, {});
  const doc = window.document;

  openSpecPicker(doc, a);
  assert.ok(pickLabels(doc).includes('Gateway schema'), 'the list names specs, not ids');
  assert.ok(pickLabels(doc).includes('No parent (top level)'));

  const filter = doc.getElementById('pfilter');
  filter.value = 'gate';
  filter.dispatchEvent(new window.Event('input'));

  assert.deepEqual(pickLabels(doc), ['Gateway schema']);
  assert.equal(doc.getElementById('pnew').hidden, true,
    'a spec cannot be conjured from the destination field');
});

test('the picker ticks the spec the row is already under', async (t) => {
  const root = seedSpec({ title: 'Root' });
  const kid = seedSpec({ title: 'Kid', parent: root });
  const { window } = loadIndex(t, {});
  const doc = window.document;

  openSpecPicker(doc, kid);
  const on = doc.querySelector('#plist .pitem.on');

  assert.equal(on && on.getAttribute('data-v'), root);
});

test('opening the picker costs no request', async (t) => {
  const a = seedSpec({ title: 'Alpha' });
  seedSpec({ title: 'Beta' });
  const { window, calls } = loadIndex(t, {});
  const before = calls.length;

  openSpecPicker(window.document, a);

  assert.equal(calls.length, before, 'the list is read off the page, not fetched');
});

// ── what is sent, and what each answer does ──────────────────────────────────

test('choosing a destination sends the parent key and nothing else', async (t) => {
  const a = seedSpec({ title: 'Alpha', project: 'one', collection: 'Design' });
  const b = seedSpec({ title: 'Beta', project: 'two' });
  const { window, calls, reloads } = loadIndex(t, {});
  const doc = window.document;

  openSpecPicker(doc, a);
  doc.querySelector(`#plist .pitem[data-v="${b}"]`).click();
  await tick(window);

  const sent = organizeCalls(calls);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, `/api/spec/${a}/organize`);
  assert.deepEqual(Object.keys(sent[0].body), ['parent'],
    'a move that also carries collection or project refiles the spec with no warning');
  assert.equal(sent[0].body.parent, b);
  assert.equal(reloads.n, 1);
});

test('"No parent (top level)" and "Detach from parent" both send null', async (t) => {
  const root = seedSpec({ title: 'Root' });
  const kid = seedSpec({ title: 'Kid', parent: root });
  const { window, calls } = loadIndex(t, {});
  const doc = window.document;

  openSpecPicker(doc, kid);
  doc.querySelector('#plist .pitem[data-v=""]').click();
  await tick(window);

  openRowMenu(doc, kid);
  clickMenu(doc, 'Detach from parent');
  await tick(window);

  const sent = organizeCalls(calls);
  assert.equal(sent.length, 2);
  for (const call of sent) {
    assert.deepEqual(call.body, { parent: null });
    assert.equal(call.url, `/api/spec/${kid}/organize`);
  }
});

test('a refused move names both specs, does not reload, and leaves the row alone', async (t) => {
  const a = seedSpec({ title: 'Alpha' });
  const b = seedSpec({ title: 'Beta' });
  const { window, reloads } = loadIndex(t, {}, {
    reply: (call) => (/\/organize$/.test(call.url)
      ? { status: 409, json: { error: 'cycle', ancestry: [b] } }
      : null),
  });
  const doc = window.document;

  openSpecPicker(doc, a);
  doc.querySelector(`#plist .pitem[data-v="${b}"]`).click();
  await tick(window);
  await tick(window);

  const said = snackText(doc);
  assert.match(said, /Alpha/);
  assert.match(said, /Beta/);
  assert.equal(reloads.n, 0, 'reloading over the message hides the only explanation there is');
  assert.equal(rowFor(doc, a).getAttribute('data-parent'), '');
});

test('a 409 from a delete in progress is not reported as a loop', async (t) => {
  // The organize route answers 409 for two reasons: a cycle, and a spec or its
  // new parent being deleted right now. Only the first is a loop.
  const root = seedSpec({ title: 'Root' });
  const kid = seedSpec({ title: 'Kid', parent: root });
  const { window, reloads } = loadIndex(t, {}, {
    reply: (call) => (/\/organize$/.test(call.url)
      ? { status: 409, json: { error: 'spec is being deleted' } }
      : null),
  });
  const doc = window.document;

  openRowMenu(doc, kid);
  clickMenu(doc, 'Detach from parent');
  await tick(window);
  await tick(window);

  const said = snackText(doc);
  assert.match(said, /being deleted/i);
  assert.doesNotMatch(said, /already inside/i);
  assert.equal(reloads.n, 0);
});

test('a destination that has been deleted says so', async (t) => {
  const a = seedSpec({ title: 'Alpha' });
  const b = seedSpec({ title: 'Beta' });
  const { window, reloads } = loadIndex(t, {}, {
    reply: (call) => (/\/organize$/.test(call.url) ? { status: 404, json: {} } : null),
  });
  const doc = window.document;

  openSpecPicker(doc, a);
  doc.querySelector(`#plist .pitem[data-v="${b}"]`).click();
  await tick(window);

  assert.match(snackText(doc), /no longer exists/i);
  assert.equal(reloads.n, 0);
});

test('a daemon that is not answering says so', async (t) => {
  const a = seedSpec({ title: 'Alpha' });
  const b = seedSpec({ title: 'Beta' });
  const { window, reloads } = loadIndex(t, {}, {
    reply: (call) => {
      if (/\/organize$/.test(call.url)) throw new Error('offline');
      return null;
    },
  });
  const doc = window.document;

  openSpecPicker(doc, a);
  doc.querySelector(`#plist .pitem[data-v="${b}"]`).click();
  await tick(window);

  assert.match(snackText(doc), /could not move/i);
  assert.equal(reloads.n, 0);
});

test('the collection and project pickers are unchanged by the new kind', async (t) => {
  const a = seedSpec({ title: 'Alpha', collection: 'Design' });
  seedSpec({ title: 'Beta', collection: 'Testing' });
  const { window, calls } = loadIndex(t, {});
  const doc = window.document;

  openRowMenu(doc, a);
  clickMenu(doc, 'Move to collection…');

  assert.deepEqual(pickValues(doc), ['Design', 'Testing', ''],
    'a collection picker still carries names as its values');

  const filter = doc.getElementById('pfilter');
  filter.value = 'Brand new';
  filter.dispatchEvent(new window.Event('input'));
  assert.equal(doc.getElementById('pnew').hidden, false,
    'a collection can still be created from the destination field');

  doc.getElementById('pnew').click();
  await tick(window);

  const sent = organizeCalls(calls);
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].body, { collection: 'Brand new' });
});
