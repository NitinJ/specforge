import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createServer } from 'node:http';

import { createSpec } from '../lib/store.mjs';
import { createDaemon, ensureServer } from '../server/daemon.mjs';

/** A port nothing listens on (open then immediately close to free it). */
function freePort() {
  return new Promise((resolve) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-daemon-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

// Bind createDaemon() on an ephemeral port; always close in t.after.
async function withDaemon(t, fn) {
  const server = createDaemon();
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return fn(base);
}

// The body is load-bearing, not decoration: ensureServer treats "something
// answers here" as "the daemon is already running", so it has to be able to tell
// us apart from any other server that happens to hold the port. The pid rides
// along because the port is now the only handle on the daemon — `curl /healthz`
// is how you find out which process to kill.
test('GET /healthz identifies SpecForge and names the process', async (t) => {
  await withDaemon(t, async (base) => {
    const res = await fetch(`${base}/healthz`);
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { service: 'specforge', pid: process.pid });
  });
});

test('GET / lists all store specs (ids + titles, linking to /spec/<id>)', async (t) => {
  const a = createSpec({ title: 'Gateway billing', html: '<h1>Gateway billing</h1>' });
  const b = createSpec({ title: 'Share resolution', html: '<h1>Share resolution</h1>' });
  await withDaemon(t, async (base) => {
    const res = await fetch(`${base}/`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /Gateway billing/);
    assert.match(body, /Share resolution/);
    assert.match(body, new RegExp(`/spec/${a}`));
    assert.match(body, new RegExp(`/spec/${b}`));
    // unattached spec shows as "free"
    assert.match(body, /free/);
    // the type column is rendered (these default to design-impl)
    assert.match(body, /design-impl/);
  });
});

test('GET / shows attached label for an attached spec', async (t) => {
  const id = createSpec({ title: 'Attached one', html: '<h1>Attached one</h1>' });
  // Attach by writing meta directly (Stage 3 owns attach() — here we only render).
  const { readMeta, writeMeta } = await import('../lib/meta.mjs');
  const m = readMeta(id);
  writeMeta(id, { ...m, attachedSession: 'abcdef1234567890' });
  await withDaemon(t, async (base) => {
    const body = await (await fetch(`${base}/`)).text();
    assert.match(body, /session abcdef12/); // short id
  });
});

test('GET /spec/<id> serves the spec html with the review layer injected', async (t) => {
  const id = createSpec({
    title: 'Sample Spec',
    html: '<!doctype html><html><head><title>Sample Spec</title></head><body><h1>Sample Spec</h1></body></html>',
  });
  await withDaemon(t, async (base) => {
    const res = await fetch(`${base}/spec/${id}`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    const body = await res.text();
    assert.match(body, /Sample Spec/);
    assert.match(body, /specforge:review-layer/); // injected review layer marker
    assert.match(body, /\/public\/review\.js/);
  });
});

test('GET /spec/<unknown> returns 404', async (t) => {
  await withDaemon(t, async (base) => {
    const res = await fetch(`${base}/spec/deadbeef00`);
    assert.equal(res.status, 404);
  });
});

test('ensureServer seeds the template specs, and settings lists them', async (t) => {
  const first = await ensureServer({ port: 0 });
  t.after(() => new Promise((r) => first.server.close(r)));

  const { templateId } = await import('../lib/store-templates.mjs');
  const { readMeta } = await import('../lib/meta.mjs');
  assert.ok(readMeta(templateId('design')), 'daemon start seeds the templates');

  // They are listed on /settings rather than the index: they are configuration,
  // and at the foot of the home page they sat below every spec (P7).
  const home = await (await fetch(first.url)).text();
  assert.doesNotMatch(home, new RegExp(`/spec/${templateId('design')}`), 'not on the index');

  const settings = await (await fetch(`${first.url}settings`)).text();
  assert.match(settings, new RegExp(`/spec/${templateId('design')}`), 'listed on settings');
  assert.match(settings, /class="tcard"/, 'as cards that open the template');
});

test('the daemon also answers on IPv6 loopback — localhost from a Windows browser', async (t) => {
  // Under WSL2 mirrored networking the Windows browser resolves `localhost` to
  // ::1 first; an IPv4-only listener makes localhost links flake while
  // 127.0.0.1 works. The daemon mirrors its listener onto [::1] (best-effort).
  createSpec({ title: 'One', html: '<h1>One</h1>' });
  const first = await ensureServer({ port: 0 });
  t.after(() => new Promise((r) => first.server.close(r)));

  const res = await fetch(`http://[::1]:${first.port}/healthz`);
  assert.equal(res.status, 200, 'the same port answers on ::1');
});

test('the ::1 mirror retries EADDRINUSE — a fast restart still ends up dual-stack', async (t) => {
  // Fast-restart race: the previous daemon's ::1 socket can still be closing
  // when the next daemon binds. Simulate it: hold ::1 on a port, release it
  // shortly after ensureServer starts — the retry must pick it up.
  createSpec({ title: 'One', html: '<h1>One</h1>' });
  const blocker = createDaemon();
  await new Promise((r) => blocker.listen(0, '::1', r));
  const port = blocker.address().port;
  setTimeout(() => blocker.close(), 200);

  const first = await ensureServer({ port });
  t.after(() => new Promise((r) => first.server.close(r)));

  const res = await fetch(`http://[::1]:${first.port}/healthz`);
  assert.equal(res.status, 200, '::1 answers after the blocker released the port');
});

// Holding the port IS being the daemon. The kernel admits one holder and settles
// the race itself, so the loser has nothing to check and nothing to clean up —
// which is the whole reason the lockfile and server.json could go.
test('ensureServer is a singleton: the second call finds the first and starts nothing', async (t) => {
  createSpec({ title: 'One', html: '<h1>One</h1>' });
  const port = await freePort();

  const first = await ensureServer({ port });
  assert.ok(first.server, 'first call starts a server');
  assert.equal(first.port, port);
  t.after(() => new Promise((r) => first.server.close(r)));

  const second = await ensureServer({ port });
  assert.equal(second.server, null, 'second call reuses, does not start a server');
  assert.equal(second.url, first.url);
  assert.equal(second.port, first.port);

  const res = await fetch(`${first.url}healthz`);
  assert.equal(res.status, 200);
});

// The bug this whole change exists for. The old code walked to the next free
// port, which meant a daemon that had just proved another one was already
// running started anyway — on an address nothing would ever look at, and without
// the gateway port, so it served specs happily and could not publish.
test('ensureServer never walks to another port when its own is taken', async (t) => {
  createSpec({ title: 'One', html: '<h1>One</h1>' });
  const port = await freePort();

  const first = await ensureServer({ port });
  t.after(() => new Promise((r) => first.server.close(r)));

  const second = await ensureServer({ port });
  assert.equal(second.port, port, 'reports the port that is actually serving');
  assert.equal(second.server, null, 'and no second listener exists anywhere');
});

// The winner of the port binds before it finishes starting — templates to seed,
// publications to restore — so the loser can knock while it is too busy to
// answer. Treating one silent probe as "a stranger has the port" would report
// the most misleading thing in the file about an entirely normal startup.
test('a daemon that is still starting up is not mistaken for a stranger', async (t) => {
  const port = await freePort();
  let knocked = false;
  const busyThenReady = createServer((req, res) => {
    if (!knocked) {
      knocked = true;
      return req.destroy(); // still coming up: the probe gets nothing
    }
    res.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ service: 'specforge', pid: 1 }));
  });
  await new Promise((r) => busyThenReady.listen(port, '127.0.0.1', r));
  t.after(() => new Promise((r) => busyThenReady.close(r)));

  const res = await ensureServer({ port });
  assert.equal(res.server, null, 'found it on the retry instead of erroring');
  assert.ok(knocked, 'the first probe really did fail');
});

// A foreign process on the port is the one case the walk was defensible for.
// Failing loudly beats it: a daemon on some other port looks healthy, serves
// specs, and silently cannot publish — which is exactly how six of them
// accumulated unnoticed.
test('ensureServer refuses to start when the port is held by something else', async (t) => {
  const port = await freePort();
  const squatter = createServer((_req, res) => res.writeHead(200).end('ok'));
  await new Promise((r) => squatter.listen(port, '127.0.0.1', r));
  t.after(() => new Promise((r) => squatter.close(r)));

  await assert.rejects(() => ensureServer({ port }), /not SpecForge/);
});

// --- Template blocks, and the origin guard on every write -------------------
//
// Raised in review of PR #207: loopback is not a boundary a browser respects, so
// a page on any site could aim a form at the daemon and reset a user's rules.
// The guard is on the method rather than the route, so the tests below use these
// routes to prove a property that holds for every write.

const post = (base, url, body, origin) => fetch(base + url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
  body: JSON.stringify(body),
});

test('the blocks route answers with one type’s rules and prompts', async (t) => {
  await withDaemon(t, async (base) => {
    const res = await fetch(`${base}/api/template/design-impl/blocks`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.type, 'design-impl');
    assert.ok(body.rules.some((r) => r.shipped));
  });
});

test('a reset names its class, and leaves the other one alone', async (t) => {
  await withDaemon(t, async (base) => {
    await fetch(`${base}/api/template/design-impl/blocks`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rules: [{ id: 'no_vendor_quotes', ask: 'No vendor quotes.', fix: 'Cut it.' }],
        prompts: [{ section: 'goals', text: 'One line per goal.' }],
      }),
    });
    const res = await post(base, '/api/template/design-impl/blocks', { class: 'rules' });
    const body = await res.json();
    assert.equal(body.rules.some((r) => r.id === 'no_vendor_quotes'), false);
    assert.ok(body.prompts.find((p) => p.section === 'goals'), 'the Sections tab is untouched');
  });
});

test('an unknown reset class is a 400 rather than a reset of everything', async (t) => {
  await withDaemon(t, async (base) => {
    const res = await post(base, '/api/template/design-impl/blocks', { class: 'everything' });
    assert.equal(res.status, 400);
  });
});

test('a write from another site is refused', async (t) => {
  await withDaemon(t, async (base) => {
    const res = await post(base, '/api/template/design-impl/blocks', { class: 'rules' },
      'https://attacker.example');
    assert.equal(res.status, 403);
  });
});

test('a write from the daemon’s own page is allowed', async (t) => {
  await withDaemon(t, async (base) => {
    const res = await post(base, '/api/template/design-impl/blocks', { class: 'rules' }, base);
    assert.equal(res.status, 200);
  });
});

test('a write with no Origin is allowed, because that is the CLI', async (t) => {
  await withDaemon(t, async (base) => {
    const res = await post(base, '/api/template/design-impl/blocks', { class: 'rules' });
    assert.equal(res.status, 200);
  });
});

test('a read from another site is not refused, since it changes nothing', async (t) => {
  await withDaemon(t, async (base) => {
    const res = await fetch(`${base}/api/template/design-impl/blocks`, {
      headers: { Origin: 'https://attacker.example' },
    });
    assert.equal(res.status, 200, 'the guard is on writes; reading is already public over a share');
  });
});

test('the guard covers every write, not the route it was found on', async (t) => {
  await withDaemon(t, async (base) => {
    const res = await fetch(`${base}/api/prompts`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Origin: 'https://attacker.example' },
      body: JSON.stringify({ language: 'Owned.' }),
    });
    assert.equal(res.status, 403);
    const { handlePromptsGet } = await import('../lib/prompts-api.mjs');
    assert.equal(handlePromptsGet().language.value, '', 'and nothing was written');
  });
});
