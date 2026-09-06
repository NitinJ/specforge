// Self-tests for the tree harness added in Stage 0.
//
// They assert the two things later stages depend on: a tree really is seeded
// with its parent links, and the request recorder sees the page's own load. A
// recorder attached too late would report "no child was fetched" for every test,
// which is the assertion the panel stages rest on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { withSpecTree, needsChrome } from './harness.mjs';
import { metaPath } from '../lib/store-paths.mjs';

/**
 * Requests for a spec's DOCUMENT, not for its API or its event stream.
 *
 * `/spec/<id>` is a prefix of `/api/spec/<id>/meta` and appears in the query of
 * `/events?spec=<id>`, so a loose match counts six things for one page load. The
 * panel assertions are about documents, so the pattern has to end the path.
 */
const docFor = (id) => new RegExp(`/spec/${id}(?:\\?|$)`);

test('withSpecTree seeds parents and opens the requested spec', needsChrome, async () => {
  await withSpecTree({
    specs: [
      { key: 'root', title: 'Tree root' },
      { key: 'kid', title: 'Tree child', parent: 'root' },
    ],
    open: 'root',
  }, async ({ page, ids, base }) => {
    assert.ok(ids.root && ids.kid);
    assert.equal(page.url(), `${base}/spec/${ids.root}`);

    // Read the meta from disk, not from /api/spec/<id>/meta: the API does not
    // report `parent` until Stage 2, and this is the Stage 0 harness test.
    const meta = JSON.parse(readFileSync(metaPath(ids.kid), 'utf8'));
    assert.equal(meta.parent, ids.root, 'child meta should name its parent');
  });
});

test('the recorder captures the page load itself', needsChrome, async () => {
  await withSpecTree({
    specs: [{ key: 'solo', title: 'Solo' }],
  }, async ({ ids, requests }) => {
    assert.equal(requests.matching(docFor(ids.solo)).length, 1);
  });
});

test('a parent key that names nothing is refused, not silently made a root', async () => {
  await assert.rejects(
    () => withSpecTree({
      specs: [{ key: 'root' }, { key: 'kid', parent: 'raot' }],
    }, async () => {}),
    /names parent raot/,
  );
});

test('a duplicate key is refused', async () => {
  await assert.rejects(
    () => withSpecTree({ specs: [{ key: 'a' }, { key: 'a' }] }, async () => {}),
    /duplicate key a/,
  );
});

test('opening a key that does not exist is refused', async () => {
  await assert.rejects(
    () => withSpecTree({ specs: [{ key: 'a' }], open: 'b' }, async () => {}),
    /open names b/,
  );
});

test('opening a parent fetches no other spec document', needsChrome, async () => {
  await withSpecTree({
    specs: [
      { key: 'root', title: 'Quiet root' },
      { key: 'a', title: 'Child A', parent: 'root' },
      { key: 'b', title: 'Child B', parent: 'root' },
    ],
    open: 'root',
  }, async ({ ids, requests }) => {
    assert.equal(requests.matching(docFor(ids.a)).length, 0);
    assert.equal(requests.matching(docFor(ids.b)).length, 0);
  });
});
