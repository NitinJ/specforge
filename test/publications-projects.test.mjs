// Project publications: one token addressing a whole project at /p/<token>.
//
// The lifecycle mirrors spec publications (publications.test.mjs): idempotent
// share, token survives unshare, rotate is the only thing that changes a URL,
// and restore() rebuilds the registry from disk. What is specific to projects:
// a project share alone must hold the tunnel up, and a project must actually
// exist (name at least one spec, or be in the registry) before it can be shared.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home;
let prevHome;
const registries = [];

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-pubs-proj-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(async () => {
  for (const p of registries.splice(0)) {
    try { await p.stopAll(); } catch { /* already down */ }
  }
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const { createPublications } = await import('../lib/publications.mjs');
const { specDir, specHtmlPath, globalUiPath } = await import('../lib/store-paths.mjs');
const { readProjectShareToken } = await import('../lib/store-project-shares.mjs');
const { isToken } = await import('../lib/tokens.mjs');

/** A spec on disk, filed into a project. */
function seed(id, project = null) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), `<!DOCTYPE html><html><head><title>${id}</title></head><body><p>${id}</p></body></html>`);
  writeFileSync(join(specDir(id), 'meta.json'), JSON.stringify({ id, title: id, status: 'draft', project }));
}

function fakePublisher() {
  const calls = [];
  const fn = async (port) => {
    calls.push(port);
    return { url: `https://fake-${port}.example`, pid: 4242, stop: async () => {} };
  };
  fn.calls = calls;
  return fn;
}

function mkPubs(overrides = {}) {
  const deps = {
    publishImpl: fakePublisher(),
    killImpl: () => {},
    aliveImpl: () => true,
    ownsImpl: () => true,
    probeImpl: async () => true,
    sleepImpl: async () => {},
    port: 0,
    ...overrides,
  };
  const pubs = createPublications(deps);
  registries.push(pubs);
  return { pubs, publish: deps.publishImpl, deps };
}

test('sharing a project returns a /p/<token> URL on the tunnel origin', async () => {
  seed('a1', 'specforge');
  const { pubs } = mkPubs();
  const share = await pubs.shareProject('specforge');
  assert.equal(share.project, 'specforge');
  assert.ok(isToken(share.token));
  assert.match(share.url, /^https:\/\/fake-\d+\.example\/p\/[0-9a-f]{32}$/);
});

test('sharing is idempotent: the second call returns the token already sent', async () => {
  seed('a1', 'specforge');
  const { pubs } = mkPubs();
  const first = await pubs.shareProject('specforge');
  const second = await pubs.shareProject('specforge');
  assert.equal(second.token, first.token);
});

test('rotate mints a new token and the old one stops resolving', async () => {
  seed('a1', 'specforge');
  const { pubs } = mkPubs();
  const first = await pubs.shareProject('specforge');
  const second = await pubs.shareProject('specforge', { rotate: true });
  assert.notEqual(second.token, first.token);
  assert.equal(pubs.resolveProject(first.token), null);
  assert.equal(pubs.resolveProject(second.token), 'specforge');
});

test('a project that names no spec and is in no registry cannot be shared', async () => {
  seed('a1', 'something-else');
  const { pubs } = mkPubs();
  await assert.rejects(() => pubs.shareProject('specforge'), /unknown project/);
});

test('a zero-spec project from the prefs registry can be shared', async () => {
  mkdirSync(home, { recursive: true });
  writeFileSync(globalUiPath(), JSON.stringify({ projects: ['fresh project'] }));
  const { pubs } = mkPubs();
  const share = await pubs.shareProject('fresh project');
  assert.ok(isToken(share.token));
});

test('unshare keeps the token on disk, and a re-share returns the same URL', async () => {
  seed('a1', 'specforge');
  const { pubs } = mkPubs();
  const first = await pubs.shareProject('specforge');
  const was = await pubs.unshareProject('specforge');
  assert.equal(was, true);
  assert.equal(pubs.resolveProject(first.token), null);
  assert.equal(readProjectShareToken('specforge'), first.token);
  const again = await pubs.shareProject('specforge');
  assert.equal(again.token, first.token);
});

test('a project share alone brings the tunnel up and holds it up', async () => {
  seed('a1', 'specforge');
  const { pubs, publish } = mkPubs();
  await pubs.shareProject('specforge');
  assert.equal(publish.calls.length, 1);
  assert.equal(typeof pubs.localPort(), 'number');
  // A spec published and unpublished while the project stays up must not
  // retire the tunnel: the project is still being served.
  await pubs.share('a1');
  await pubs.unshare('a1');
  assert.notEqual(pubs.origin(), null);
  // Unsharing the project is what retires it.
  await pubs.unshareProject('specforge');
  assert.equal(pubs.origin(), null);
});

test('resolveProject validates shape before lookup', async () => {
  seed('a1', 'specforge');
  const { pubs } = mkPubs();
  await pubs.shareProject('specforge');
  assert.equal(pubs.resolveProject('not-a-token'), null);
  assert.equal(pubs.resolveProject(null), null);
});

test('listProjects reports what is public right now', async () => {
  seed('a1', 'specforge');
  seed('a2', 'other');
  const { pubs } = mkPubs();
  const s = await pubs.shareProject('specforge');
  await pubs.shareProject('other');
  await pubs.unshareProject('other');
  const rows = pubs.listProjects();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].project, 'specforge');
  assert.equal(rows[0].token, s.token);
  assert.match(rows[0].url, /\/p\//);
});

test('restore() re-registers published project shares on the same tokens', async () => {
  seed('a1', 'specforge');
  const first = mkPubs();
  const share = await first.pubs.shareProject('specforge');
  await first.pubs.closeGateway();

  const second = mkPubs({ publishImpl: first.deps.publishImpl });
  await second.pubs.restore();
  assert.equal(second.pubs.resolveProject(share.token), 'specforge');
  assert.notEqual(second.pubs.origin(), null);
});

test('restore() does not resurrect an unshared project', async () => {
  seed('a1', 'specforge');
  const first = mkPubs();
  const share = await first.pubs.shareProject('specforge');
  await first.pubs.unshareProject('specforge');
  await first.pubs.closeGateway();

  const second = mkPubs();
  await second.pubs.restore();
  assert.equal(second.pubs.resolveProject(share.token), null);
});

test('projectShareInfo composes the URL and reports liveness', async () => {
  seed('a1', 'specforge');
  const { pubs } = mkPubs();
  assert.equal(pubs.projectShareInfo('specforge'), null);
  const share = await pubs.shareProject('specforge');
  const info = pubs.projectShareInfo('specforge');
  assert.equal(info.token, share.token);
  assert.equal(info.url, share.url);
  assert.equal(info.live, true);
});

test('a name normalizes before it shares, so two spellings are one project', async () => {
  seed('a1', 'Figur design studio');
  const { pubs } = mkPubs();
  const a = await pubs.shareProject('  Figur   design studio ');
  const b = await pubs.shareProject('Figur design studio');
  assert.equal(a.token, b.token);
});
