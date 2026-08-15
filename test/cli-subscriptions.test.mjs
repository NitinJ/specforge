// join / leave: the subscription half of shared projects.
//
// join is daemonless — a local file write plus one best-effort fetch of the
// remote's public meta for a display name — so an owner whose machine is off
// still gets joined, just as unreachable.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pjoin } from 'node:path';
import { createServer } from 'node:http';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(pjoin(tmpdir(), 'sf-cli-subs-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const { cmdJoin, cmdLeave } = await import('../lib/specforge-cli.mjs');
const { readSubscriptions } = await import('../lib/store-subscriptions.mjs');

const TOK = 'e'.repeat(32);

/** A remote gateway answering the public project meta. */
async function withRemote(t, meta, fn) {
  const server = createServer((req, res) => {
    if (req.url === `/p/${TOK}/api/meta`) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify(meta));
    }
    res.writeHead(404);
    return res.end('not found');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise((r) => server.close(r)));
  return fn(`http://127.0.0.1:${server.address().port}`);
}

test('join stores the pointer and takes the name from the remote meta', async (t) => {
  await withRemote(t, { project: 'Atelier', specs: 4 }, async (origin) => {
    const out = await cmdJoin({ url: `${origin}/p/${TOK}` });
    assert.equal(out.ok, true);
    assert.equal(out.name, 'Atelier');
    assert.equal(out.reachable, true);
    const subs = readSubscriptions();
    assert.equal(subs.length, 1);
    assert.equal(subs[0].origin, origin);
    assert.equal(subs[0].token, TOK);
  });
});

test('join with the owner unreachable still joins, and says so', async () => {
  // A port nothing listens on: the fetch fails fast with ECONNREFUSED.
  const out = await cmdJoin({ url: `http://127.0.0.1:9/p/${TOK}` });
  assert.equal(out.ok, true);
  assert.equal(out.reachable, false);
  assert.equal(out.name, 'Shared project');
  assert.equal(readSubscriptions().length, 1);
});

test('an explicit --name wins over the remote one', async (t) => {
  await withRemote(t, { project: 'Their name' }, async (origin) => {
    const out = await cmdJoin({ url: `${origin}/p/${TOK}`, name: 'My label' });
    assert.equal(out.name, 'My label');
  });
});

test('join refuses anything that is not a project share URL', async () => {
  await assert.rejects(() => cmdJoin({ url: `https://x.example/s/${TOK}` }), /project share URL/);
  await assert.rejects(() => cmdJoin({ url: 'nonsense' }), /project share URL/);
  assert.equal(readSubscriptions().length, 0);
});

test('leave removes the subscription and refuses what it cannot find', async () => {
  await cmdJoin({ url: `http://127.0.0.1:9/p/${TOK}`, name: 'To go' });
  const out = await cmdLeave({ key: 'To go' });
  assert.equal(out.ok, true);
  assert.deepEqual(readSubscriptions(), []);
  await assert.rejects(() => cmdLeave({ key: 'To go' }), /no subscription matches/);
});
