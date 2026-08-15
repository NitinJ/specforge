// Tests for the test helpers themselves.
//
// A fixture builder that files specs at the wrong address makes every suite
// built on it assert the wrong thing while staying green, so the builder is
// checked against the metadata it claims to write.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedProjects, fileSpec } from './helpers/project-store.mjs';
import { loadIndex } from './helpers/index-dom.mjs';
import { readMeta } from '../lib/meta.mjs';
import { createSpec } from '../lib/store.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-helpers-');

test('seedProjects files every spec at the address it was given', () => {
  const store = seedProjects({
    'figur-design-studio': { UI: 2, Product: ['Garment model'] },
    specforge: { Engineering: 1 },
  });

  assert.equal(store.ids.length, 4);
  assert.equal(store.at('figur-design-studio', 'UI').length, 2);
  for (const id of store.at('figur-design-studio', 'UI')) {
    const m = readMeta(id);
    assert.equal(m.project, 'figur-design-studio');
    assert.equal(m.collection, 'UI');
  }
  const named = readMeta(store.first('figur-design-studio', 'Product'));
  assert.equal(named.title, 'Garment model');
  assert.equal(named.collection, 'Product');
  assert.equal(readMeta(store.first('specforge', 'Engineering')).project, 'specforge');
});

test('seedProjects writes null, not the empty string, for either absent half', () => {
  const store = seedProjects({ '': { '': 1, Research: 1 }, solo: { '': 1 } });

  const unfiled = readMeta(store.first('', ''));
  assert.equal(unfiled.project, null);
  assert.equal(unfiled.collection, null);

  const collectedOnly = readMeta(store.first('', 'Research'));
  assert.equal(collectedOnly.project, null);
  assert.equal(collectedOnly.collection, 'Research');

  const projectOnly = readMeta(store.first('solo', ''));
  assert.equal(projectOnly.project, 'solo');
  assert.equal(projectOnly.collection, null);
});

test('seedProjects returns [] for an address nothing was filed at', () => {
  const store = seedProjects({ a: { UI: 1 } });
  assert.deepEqual(store.at('b', 'UI'), []);
  assert.equal(store.first('b', 'UI'), undefined);
});

test('fileSpec changes only the halves it is given', () => {
  const id = createSpec({ title: 'Alpha', html: '<h1>A</h1>' });
  fileSpec(id, { project: 'p', collection: 'c' });

  fileSpec(id, { collection: 'c2' });
  assert.equal(readMeta(id).project, 'p', 'project untouched when not passed');
  assert.equal(readMeta(id).collection, 'c2');

  fileSpec(id, { project: '' });
  assert.equal(readMeta(id).project, null, 'empty string clears to null');
  assert.equal(readMeta(id).collection, 'c2', 'collection untouched');
});

test('loadIndex renders the page and runs its inline script', (t) => {
  createSpec({ title: 'Alpha spec', html: '<h1>A</h1>' });
  const { window, calls } = loadIndex(t);

  assert.ok(window.document.getElementById('search'), 'the page rendered');
  window.document.getElementById('theme').click();
  assert.equal(window.document.documentElement.getAttribute('data-theme'), 'dark',
    'the inline script ran and handled the click');
  assert.ok(calls.some((c) => c.method === 'PUT' && /\/api\/prefs$/.test(c.url)),
    'fetch is stubbed and records calls');
});

test('loadIndex serves the page at a caller-supplied URL', (t) => {
  createSpec({ title: 'Alpha spec', html: '<h1>A</h1>' });
  const { window } = loadIndex(t, undefined, { url: 'http://localhost/?project=figur' });
  assert.equal(window.location.search, '?project=figur');
});
