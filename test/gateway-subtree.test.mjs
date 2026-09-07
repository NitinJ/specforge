// Sharing a parent shares its subtree.
//
// A share exists so somebody can read a spec. If the code-grounding and testing
// children sit behind an unshared boundary, the recipient has been handed a
// document with holes in it and no way to know how much is missing, which is
// worse than the single large document child specs replaced.
//
// This is the one socket reachable from the internet, so the tests that matter
// most are the ones asserting what it refuses. Two properties:
//
//   1. The token resolves its root and every descendant, and nothing else.
//   2. A refusal for a non-descendant is indistinguishable from a refusal for a
//      token that means nothing. Otherwise the response shape is an oracle for
//      whether a spec id exists.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSpec, buildShape } from './helpers/spec-tree-fixtures.mjs';
import { startGateway } from './helpers/daemon-harness.mjs';
import { poison, unpoisonAll, needsPoison } from './helpers/fs-probe.mjs';
import { specHtmlPath, metaPath } from '../lib/store-paths.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-gwtree-');

let g;
afterEach(async () => {
  unpoisonAll();
  if (g) { await g.close(); g = null; }
});

/** A root with two children and a grandchild, plus an unrelated spec. */
function tree() {
  const root = seedSpec({ title: 'Root' });
  const a = seedSpec({ title: 'A', parent: root });
  const b = seedSpec({ title: 'B', parent: root });
  const grand = seedSpec({ title: 'Grand', parent: a });
  const outside = seedSpec({ title: 'Somebody else' });
  return { root, a, b, grand, outside };
}

test('the root is served, as it always was', async () => {
  const { root } = tree();
  g = await startGateway();
  const res = await g.get(`/s/${g.share(root)}`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /Root/);
});

test('a child and a grandchild are served through the parent token', async () => {
  const t = tree();
  g = await startGateway();
  const token = g.share(t.root);

  for (const id of [t.a, t.b, t.grand]) {
    const res = await g.get(`/s/${token}/spec/${id}`);
    assert.equal(res.status, 200, `${id} was refused through its root's token`);
  }
});

test('a spec outside the subtree is refused', async () => {
  const t = tree();
  g = await startGateway();
  const res = await g.get(`/s/${g.share(t.root)}/spec/${t.outside}`);
  assert.equal(res.status, 404);
});

test('the parent is not reachable through a child token', async () => {
  const t = tree();
  g = await startGateway();
  // Sharing downward is not sharing upward. A token on a child grants the child
  // and what is below it, never the document it belongs to.
  const res = await g.get(`/s/${g.share(t.a)}/spec/${t.root}`);
  assert.equal(res.status, 404);
});

test('a sibling is not reachable through a sibling token', async () => {
  const t = tree();
  g = await startGateway();
  const res = await g.get(`/s/${g.share(t.a)}/spec/${t.b}`);
  assert.equal(res.status, 404);
});

test('a refusal is byte-identical to the one for a token that means nothing', async () => {
  const t = tree();
  g = await startGateway();
  const token = g.share(t.root);

  const outside = await g.get(`/s/${token}/spec/${t.outside}`);
  const missing = await g.get(`/s/${token}/spec/0000000000`);
  const unknown = await g.get('/s/00000000000000000000000000000000/spec/anything');

  const bodies = await Promise.all([outside.text(), missing.text(), unknown.text()]);
  assert.equal(outside.status, 404);
  assert.equal(missing.status, 404);
  assert.equal(unknown.status, 404);
  // Otherwise the response is an oracle: a reader could learn which spec ids
  // exist by comparing refusals.
  assert.equal(bodies[0], bodies[1]);
  assert.equal(bodies[1], bodies[2]);
});

test('a child added after the share was made is readable through the same token', async () => {
  const t = tree();
  g = await startGateway();
  const token = g.share(t.root);

  const late = seedSpec({ title: 'Added later', parent: t.b });
  const res = await g.get(`/s/${token}/spec/${late}`);
  assert.equal(res.status, 200, 'the share does not cover children added later');
});

test('a detached child leaves the share', async () => {
  const t = tree();
  g = await startGateway();
  const token = g.share(t.root);
  assert.equal((await g.get(`/s/${token}/spec/${t.a}`)).status, 200);

  // Detaching is the escape hatch, and it has to work in this direction too:
  // a spec taken out of the tree is out of the share.
  seedSpec({ id: t.a, title: 'A', parent: null });
  assert.equal((await g.get(`/s/${token}/spec/${t.a}`)).status, 404);
});

test('membership is decided before the spec is read', needsPoison, async () => {
  const t = tree();
  g = await startGateway();
  const token = g.share(t.root);

  // If the handler read the document first and checked afterwards, this would
  // be a 500 from an unreadable file rather than a clean refusal.
  poison(specHtmlPath(t.outside));
  poison(metaPath(t.outside));

  const res = await g.get(`/s/${token}/spec/${t.outside}`);
  assert.equal(res.status, 404);
});

test('a child is served with the review layer, in reader mode', async () => {
  const t = tree();
  g = await startGateway();
  const html = await (await g.get(`/s/${g.share(t.root)}/spec/${t.a}`)).text();

  assert.match(html, /"transport":\s*"poll"/, 'an event stream does not survive the tunnel');
  // The api base has to carry both the token and the spec, or a reader's
  // comments would land on the root.
  assert.match(html, new RegExp(`/spec/${t.a}/api`));
});

test('the embed view is served through a token, so a reader gets the panel too', async () => {
  const t = tree();
  g = await startGateway();
  const res = await g.get(`/s/${g.share(t.root)}/spec/${t.a}?embed=1`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /"embed":\s*true/);
});

test('a reserved id is not a spec, whatever the token says', async () => {
  const t = tree();
  g = await startGateway();
  const res = await g.get(`/s/${g.share(t.root)}/spec/specforge-components`);
  assert.equal(res.status, 404);
});

test('a traversing spec id is refused', async () => {
  const t = tree();
  g = await startGateway();
  const res = await g.get(`/s/${g.share(t.root)}/spec/..%2F..%2Fetc`);
  assert.equal(res.status, 404);
});

// ── what a reader is told ───────────────────────────────────────────────────

test('a reader can list the children of a spec their token resolves', async () => {
  const t = tree();
  g = await startGateway();
  const token = g.share(t.root);

  const res = await g.get(`/s/${token}/api/children`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.deepEqual(body.children.map((c) => c.id).sort(), [t.a, t.b].sort());
  assert.equal(body.children.find((c) => c.id === t.a).hasChildren, true);
});

test('a reader can list a child of a child, through the subtree route', async () => {
  const t = tree();
  g = await startGateway();
  const res = await g.get(`/s/${g.share(t.root)}/spec/${t.a}/api/children`);
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).children.map((c) => c.id), [t.grand]);
});

test('a reader cannot list the children of a spec outside the subtree', async () => {
  const t = tree();
  seedSpec({ title: 'Hidden child', parent: t.outside });
  g = await startGateway();
  const res = await g.get(`/s/${g.share(t.root)}/spec/${t.outside}/api/children`);
  assert.equal(res.status, 404);
});

test('the reader meta stays an allow-list', async () => {
  const t = tree();
  g = await startGateway();
  const body = await (await g.get(`/s/${g.share(t.root)}/api/meta`)).json();

  // Two fields were added deliberately, and nothing else came with them. The
  // owner's session, export state, share record and project must not be here.
  assert.deepEqual(
    Object.keys(body).sort(),
    ['hasChildren', 'parent', 'reviewProgress', 'status', 'title'],
  );
});

test('a cycle in stored data does not hang a reader request', async () => {
  const { ids } = buildShape('cyclic');
  g = await startGateway();
  const res = await g.get(`/s/${g.share(ids[0])}/spec/${ids[1]}`);
  assert.equal(res.status, 200);
});

// ── what the reader is told about the tree above them ───────────────────────
//
// `parent` is on the reader's meta so a shared parent's drawer knows where it
// is in its own subtree. Above the shared root there is no subtree: the id of a
// spec the token does not grant is a store fact, and the reader learning it can
// go on to ask for it. It is reported only when it names a spec this token
// already serves.

test('the shared root does not name the parent it was cut out of', async () => {
  const outerRoot = seedSpec({ title: 'The big one' });
  const shared = seedSpec({ title: 'Testing strategy', parent: outerRoot });
  g = await startGateway();

  const body = await (await g.get(`/s/${g.share(shared)}/api/meta`)).json();
  assert.equal(body.parent, null, 'the reader was handed an id the token does not serve');
});

test('a descendant names its parent, which the token does serve', async () => {
  const t = tree();
  g = await startGateway();
  const body = await (await g.get(`/s/${g.share(t.root)}/spec/${t.grand}/api/meta`)).json();
  assert.equal(body.parent, t.a);
});

// ── a project share is the other way in ─────────────────────────────────────
//
// /p/<token> grants a project, not a subtree, and membership is checked per
// request. A child filed elsewhere is outside that grant however close the
// relation is, so it is neither listed nor served.

test('a project reader sees the children that are in the project', async () => {
  const root = seedSpec({ title: 'Root', project: 'atlas' });
  const kid = seedSpec({ title: 'Kid', parent: root, project: 'atlas' });
  g = await startGateway();
  const token = g.shareProject('atlas');

  const body = await (await g.get(`/p/${token}/spec/${root}/api/children`)).json();
  assert.deepEqual(body.children.map((c) => c.id), [kid]);
  assert.equal((await g.get(`/p/${token}/spec/${kid}`)).status, 200);
});

test('a child filed in another project is not listed to a project reader', async () => {
  const root = seedSpec({ title: 'Root', project: 'atlas' });
  const moved = seedSpec({ title: 'Moved away', parent: root, project: 'other' });
  g = await startGateway();
  const token = g.shareProject('atlas');

  const body = await (await g.get(`/p/${token}/spec/${root}/api/children`)).json();
  assert.deepEqual(body.children, [], 'a row was offered for a spec this token refuses');
  assert.equal((await g.get(`/p/${token}/spec/${moved}`)).status, 404);
});

test('a project reader is not told a parent outside the project', async () => {
  const root = seedSpec({ title: 'Root', project: 'atlas' });
  const kid = seedSpec({ title: 'Kid', parent: root, project: 'beta' });
  g = await startGateway();

  const body = await (await g.get(`/p/${g.shareProject('beta')}/spec/${kid}/api/meta`)).json();
  assert.equal(body.parent, null);
});

test('a reader printing a shared parent gets the whole tree, not just the root', async () => {
  const t = tree();
  g = await startGateway();
  const token = g.share(t.root);

  const res = await g.get(`/s/${token}/spec/${t.root}?flat=1`);
  assert.equal(res.status, 200);
  const html = await res.text();
  for (const title of ['Root', 'A', 'B', 'Grand']) {
    assert.match(html, new RegExp(title), `${title} is missing from the flat document`);
  }
  assert.doesNotMatch(html, /Somebody else/, 'the flat view reached outside the grant');
});

test('the flat view of a spec the token does not cover is refused', async () => {
  const t = tree();
  g = await startGateway();
  const token = g.share(t.a);

  for (const id of [t.root, t.b, t.outside]) {
    assert.equal((await g.get(`/s/${token}/spec/${id}?flat=1`)).status, 404, id);
  }
});

test('the flat view of a child covers that child and below, and no more', async () => {
  const t = tree();
  g = await startGateway();

  const html = await (await g.get(`/s/${g.share(t.a)}/spec/${t.a}?flat=1`)).text();
  assert.match(html, /Grand/);
  assert.doesNotMatch(html, /Somebody else/);
});

