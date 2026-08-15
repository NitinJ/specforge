// contribute / withdraw / prune: the two-way half of shared projects.
//
// contribute runs on the CONTRIBUTOR's machine: it publishes their spec under
// their own token (their daemon), then registers a pointer with the creator's
// gateway. prune runs on the creator's, against their own store.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-cli-contrib-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const { cmdContribute, cmdWithdraw, cmdPrune } = await import('../lib/specforge-cli.mjs');
const { createSpec } = await import('../lib/store.mjs');
const { writeProjectShare, listContributions } = await import('../lib/store-project-shares.mjs');
const { newToken } = await import('../lib/tokens.mjs');

const PTOK = 'c'.repeat(32);

/** A creator's gateway: records what was registered, refuses what it should. */
async function withCreator(t, opts = {}, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body: body ? JSON.parse(body) : null });
      if (opts.status && opts.status !== 201) {
        res.writeHead(opts.status, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: opts.error || 'refused' }));
      }
      res.writeHead(201, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, entry: { title: 'Their spec' } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return fn(`http://127.0.0.1:${server.address().port}`, seen);
}

/** A local daemon stub standing in for the contributor's own share flow. */
async function withOwnDaemon(t, fn) {
  const token = newToken();
  const server = createServer((req, res) => {
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      ok: true,
      share: { specId: 'x', token, url: `https://mine.example/s/${token}` },
    }));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const deps = { ensureDaemon: async () => ({ url: `http://127.0.0.1:${server.address().port}` }) };
  return fn(deps, token);
}

test('contribute publishes the spec, then registers a pointer with the creator', async (t) => {
  const id = createSpec({ title: 'My contribution', html: '<h1>x</h1>' });
  await withOwnDaemon(t, async (deps, token) => {
    await withCreator(t, {}, async (creator, seen) => {
      const out = await cmdContribute({
        id, url: `${creator}/p/${PTOK}`, owner: 'mira',
      }, deps);
      assert.equal(out.ok, true);
      assert.equal(out.token, token, 'listed under the contributor’s own spec token');

      const post = seen.find((s) => s.method === 'POST');
      assert.equal(post.url, `/p/${PTOK}/contribute`);
      assert.equal(post.body.token, token);
      assert.equal(post.body.title, 'My contribution');
      assert.equal(post.body.owner, 'mira');
      assert.equal(post.body.origin, 'https://mine.example', 'the origin its own share is on');
      assert.ok(!('html' in post.body), 'no content travels');
    });
  });
});

test('contribute refuses a URL that is not a project share', async (t) => {
  const id = createSpec({ title: 'x', html: '<h1>x</h1>' });
  await withOwnDaemon(t, async (deps) => {
    await assert.rejects(
      () => cmdContribute({ id, url: `https://x.example/s/${PTOK}` }, deps),
      /project share URL/,
    );
  });
});

test('contribute surfaces the creator refusing it', async (t) => {
  const id = createSpec({ title: 'x', html: '<h1>x</h1>' });
  await withOwnDaemon(t, async (deps) => {
    await withCreator(t, { status: 400, error: 'entry limit (200) reached for atelier' },
      async (creator) => {
        await assert.rejects(
          () => cmdContribute({ id, url: `${creator}/p/${PTOK}` }, deps),
          /entry limit/,
        );
      });
  });
});

test('withdraw asks the creator to drop the entry, by the spec token on disk', async (t) => {
  const id = createSpec({ title: 'x', html: '<h1>x</h1>' });
  // A contributed spec has a share record; that token is the handle the entry
  // was registered under, and the only one that can withdraw it.
  const { writeShare } = await import('../lib/store-share.mjs');
  const token = newToken();
  writeShare(id, { specId: id, token, createdAt: 'x' });

  await withCreator(t, {}, async (creator, seen) => {
    const out = await cmdWithdraw({ id, url: `${creator}/p/${PTOK}` }, {});
    assert.equal(out.ok, true);
    const del = seen.find((s) => s.method === 'DELETE');
    assert.ok(del, 'a DELETE was sent');
    assert.equal(del.url, `/p/${PTOK}/contribute/${token}`);
  });
});

test('withdraw refuses a spec that was never shared', async (t) => {
  const id = createSpec({ title: 'never shared', html: '<h1>x</h1>' });
  await withCreator(t, {}, async (creator) => {
    await assert.rejects(() => cmdWithdraw({ id, url: `${creator}/p/${PTOK}` }, {}),
      /never shared/);
  });
});

test('prune drops an entry from the creator’s own store, no network', async () => {
  writeProjectShare('atelier', { token: PTOK, createdAt: 'x' });
  const theirs = newToken();
  const { addContribution } = await import('../lib/store-project-shares.mjs');
  addContribution('atelier', {
    origin: 'https://theirs.example', token: theirs, title: 'Theirs', owner: 'them',
  });
  const out = await cmdPrune({ name: 'atelier', token: theirs });
  assert.equal(out.ok, true);
  assert.deepEqual(listContributions('atelier'), []);
});

test('prune reports when nothing matched rather than claiming success', async () => {
  writeProjectShare('atelier', { token: PTOK, createdAt: 'x' });
  await assert.rejects(() => cmdPrune({ name: 'atelier', token: newToken() }),
    /no contribution/);
});
