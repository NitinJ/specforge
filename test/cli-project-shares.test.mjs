// The share-project / unshare-project CLI commands, against a stub daemon.
//
// The commands are thin fetch wrappers; what is worth pinning is the wire
// contract: the URL-encoded name in the path, the rotate flag in the body, and
// the error surfacing when the daemon refuses. The daemon side of the contract
// is covered by publications-projects.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { cmdShareProject, cmdUnshareProject, cmdShares } from '../lib/specforge-cli.mjs';

/** A daemon that records requests and answers from a script. */
async function withStub(t, respond, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, body });
      const { status, json } = respond(req);
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  const deps = { ensureDaemon: async () => ({ url: `http://127.0.0.1:${server.address().port}` }) };
  return fn(deps, seen);
}

test('share-project encodes the name and carries the rotate flag', async (t) => {
  await withStub(t, () => ({
    status: 201,
    json: { ok: true, share: { project: 'Figur design studio', token: 'a'.repeat(32), url: 'https://x/p/aa' } },
  }), async (deps, seen) => {
    const out = await cmdShareProject({ name: 'Figur design studio', rotate: true }, deps);
    assert.equal(out.ok, true);
    assert.equal(out.project, 'Figur design studio');
    assert.equal(seen[0].method, 'POST');
    assert.equal(seen[0].url, '/api/project/Figur%20design%20studio/share');
    assert.deepEqual(JSON.parse(seen[0].body), { rotate: true });
  });
});

test('share-project without a name fails before any request is made', async () => {
  await assert.rejects(() => cmdShareProject({ name: '' }, {
    ensureDaemon: async () => { throw new Error('must not be called'); },
  }), /<name> required/);
});

test('share-project surfaces the daemon refusal verbatim', async (t) => {
  await withStub(t, () => ({ status: 400, json: { error: 'unknown project nope' } }),
    async (deps) => {
      await assert.rejects(() => cmdShareProject({ name: 'nope' }, deps), /unknown project nope/);
    });
});

test('unshare-project DELETEs the encoded name and reports wasPublished', async (t) => {
  await withStub(t, () => ({ status: 200, json: { ok: true, wasPublished: true } }),
    async (deps, seen) => {
      const out = await cmdUnshareProject({ name: 'specforge' }, deps);
      assert.equal(out.wasPublished, true);
      assert.equal(seen[0].method, 'DELETE');
      assert.equal(seen[0].url, '/api/project/specforge/share');
    });
});

test('shares returns the project list beside the spec list', async (t) => {
  await withStub(t, () => ({
    status: 200,
    json: {
      origin: 'https://x',
      shares: [{ specId: 's1', token: 'b'.repeat(32), url: 'https://x/s/bb' }],
      projects: [{ project: 'specforge', token: 'c'.repeat(32), url: 'https://x/p/cc' }],
    },
  }), async (deps) => {
    const out = await cmdShares({}, deps);
    assert.equal(out.shares.length, 1);
    assert.equal(out.projects.length, 1);
    assert.equal(out.projects[0].project, 'specforge');
  });
});

test('shares tolerates a daemon that predates project shares', async (t) => {
  await withStub(t, () => ({ status: 200, json: { shares: [] } }),
    async (deps) => {
      const out = await cmdShares({}, deps);
      assert.deepEqual(out.projects, []);
    });
});
