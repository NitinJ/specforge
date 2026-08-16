// The loopback routes behind "Add to a shared project" in the spec menu.
//
// The menu needs two things the daemon did not offer: which projects this
// machine has joined, and a way to list a spec in one of them without dropping
// to a terminal. Both are loopback-only, like every other owner route.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-daemon-contrib-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const { createDaemon } = await import('../server/daemon.mjs');
const { createPublications } = await import('../lib/publications.mjs');
const { createSpec } = await import('../lib/store.mjs');
const { addSubscription } = await import('../lib/store-subscriptions.mjs');
const { readContributed } = await import('../lib/store-contributed.mjs');
const { newToken } = await import('../lib/tokens.mjs');

/**
 * A daemon whose publications registry is seamed.
 *
 * The default registry publishes through cloudflared and binds the production
 * gateway port, so a test that let it run would spawn a tunnel and collide with
 * whatever is already on 14180. Everything the routes under test do after
 * publishing is real.
 */
async function withDaemon(t, fn) {
  const pubs = createPublications({
    publishImpl: async (port) => ({
      url: `http://127.0.0.1:${port}`, pid: 1, stop: async () => {},
    }),
    killImpl: () => {}, aliveImpl: () => true, ownsImpl: () => true,
    probeImpl: async () => true, sleepImpl: async () => {}, port: 0,
  });
  const server = createDaemon({ publications: pubs });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await pubs.stopAll();
  });
  return fn(`http://127.0.0.1:${server.address().port}`);
}

/** A creator that accepts the registration and records what arrived. */
async function withCreator(t, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      res.writeHead(req.method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, removed: true }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return fn(`http://127.0.0.1:${server.address().port}`, seen);
}

const PTOK = 'c'.repeat(32);

test('GET /api/subscriptions lists the projects this machine has joined', async (t) => {
  addSubscription({ name: 'Atelier', origin: 'https://team.example', token: PTOK });
  await withDaemon(t, async (base) => {
    const r = await fetch(`${base}/api/subscriptions`);
    assert.equal(r.status, 200);
    const body = await r.json();
    assert.equal(body.subscriptions.length, 1);
    assert.equal(body.subscriptions[0].name, 'Atelier');
    assert.equal(body.subscriptions[0].url, `https://team.example/p/${PTOK}`,
      'the menu needs the URL it will contribute to, composed once here');
  });
});

test('with nothing joined it answers an empty list, not an error', async (t) => {
  await withDaemon(t, async (base) => {
    const body = await (await fetch(`${base}/api/subscriptions`)).json();
    assert.deepEqual(body.subscriptions, []);
  });
});

test('POST /api/spec/:id/contribute registers the spec with the creator', async (t) => {
  const id = createSpec({ title: 'My contribution', html: '<h1>x</h1>' });
  await withCreator(t, async (creator, seen) => {
    addSubscription({ name: 'Atelier', origin: creator, token: PTOK });
    await withDaemon(t, async (base) => {
      const r = await fetch(`${base}/api/spec/${id}/contribute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${creator}/p/${PTOK}`, owner: 'mira' }),
      });
      assert.equal(r.status, 201, await r.text());
      const post = seen.find((s) => s.method === 'POST');
      assert.equal(post.url, `/p/${PTOK}/contribute`);
      assert.equal(post.body.title, 'My contribution', 'the title comes from the spec');
      assert.equal(post.body.owner, 'mira');
      assert.ok(!('html' in post.body), 'no content travels');
      // And the machine remembers what it registered, so a rotate can still
      // be withdrawn.
      assert.equal(readContributed().length, 1);
    });
  });
});

test('DELETE /api/spec/:id/contribute withdraws it again', async (t) => {
  const id = createSpec({ title: 'Mine', html: '<h1>x</h1>' });
  await withCreator(t, async (creator, seen) => {
    addSubscription({ name: 'Atelier', origin: creator, token: PTOK });
    await withDaemon(t, async (base) => {
      await fetch(`${base}/api/spec/${id}/contribute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${creator}/p/${PTOK}` }),
      });
      const r = await fetch(`${base}/api/spec/${id}/contribute`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${creator}/p/${PTOK}` }),
      });
      assert.equal(r.status, 200);
      assert.ok(seen.some((s) => s.method === 'DELETE'));
      assert.deepEqual(readContributed(), [], 'and forgets it locally');
    });
  });
});

// Contributing publishes the spec and hands its token to the destination, so
// an unrestricted route would let anything that can reach loopback disclose a
// spec capability to an origin nobody on this machine ever agreed to. Joining
// is that agreement.
test('a project this machine has not joined is refused', async (t) => {
  const id = createSpec({ title: 'Mine', html: '<h1>x</h1>' });
  await withCreator(t, async (creator, seen) => {
    // Deliberately NOT joined.
    await withDaemon(t, async (base) => {
      const r = await fetch(`${base}/api/spec/${id}/contribute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${creator}/p/${PTOK}` }),
      });
      assert.equal(r.status, 403);
      assert.match((await r.json()).error, /has not joined|specforge join/);
      assert.deepEqual(seen, [], 'nothing was sent to the destination');
      assert.deepEqual(readContributed(), [], 'and nothing was recorded');
    });
  });
});

test('a joined origin does not license a different token on it', async (t) => {
  const id = createSpec({ title: 'Mine', html: '<h1>x</h1>' });
  await withCreator(t, async (creator, seen) => {
    addSubscription({ name: 'Atelier', origin: creator, token: PTOK });
    await withDaemon(t, async (base) => {
      const r = await fetch(`${base}/api/spec/${id}/contribute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: `${creator}/p/${newToken()}` }),
      });
      assert.equal(r.status, 403, 'membership is origin AND token, not either');
      assert.deepEqual(seen, []);
    });
  });
});

test('a URL that is not a project share is refused', async (t) => {
  const id = createSpec({ title: 'Mine', html: '<h1>x</h1>' });
  await withDaemon(t, async (base) => {
    const r = await fetch(`${base}/api/spec/${id}/contribute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `https://x.example/s/${newToken()}` }),
    });
    // Refused by the membership check, which a malformed URL can never pass:
    // it is not parseable as a project, so it matches no subscription.
    assert.equal(r.status, 403);
  });
});

test('an unknown spec is refused before anything is published', async (t) => {
  await withDaemon(t, async (base) => {
    const r = await fetch(`${base}/api/spec/nosuchspec/contribute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: `https://x.example/p/${PTOK}` }),
    });
    assert.equal(r.status, 404);
  });
});

test('neither route is on the public gateway', async (t) => {
  const { createGatewayServer } = await import('../lib/gateway.mjs');
  const id = createSpec({ title: 'Mine', html: '<h1>x</h1>' });
  const tok = newToken();
  const server = createGatewayServer((t2) => (t2 === tok ? id : null));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;

  assert.equal((await fetch(`${base}/api/subscriptions`)).status, 404);
  const r = await fetch(`${base}/s/${tok}/api/contribute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  assert.ok(r.status === 404 || r.status === 405, `answered ${r.status}`);
});
