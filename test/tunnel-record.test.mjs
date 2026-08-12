// The tunnel record: how a daemon finds the tunnel the previous one left.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'sf-tun-'));
process.env.SPECFORGE_HOME = home;

const { readTunnel, writeTunnel, clearTunnel } = await import('../lib/store-tunnel.mjs');
const { tunnelPath } = await import('../lib/store-paths.mjs');

after(() => rmSync(home, { recursive: true, force: true }));

const rec = () => ({
  url: 'https://calm-fox.trycloudflare.com', pid: 4242, localPort: 14180, createdAt: 'now',
});

test('a record round-trips', () => {
  mkdirSync(home, { recursive: true });
  writeTunnel(rec());
  assert.deepEqual(readTunnel(), rec());
});

test('no record means nothing is exposed', () => {
  clearTunnel();
  assert.equal(readTunnel(), null);
});

test('clearTunnel reports whether there was anything to remove', () => {
  writeTunnel(rec());
  assert.equal(clearTunnel(), true);
  assert.equal(clearTunnel(), false);
});

// Every field is load-bearing: without the pid the process cannot be reaped,
// without the port the gateway cannot rebind under it, without the url there is
// nothing to hand back.
test('a record missing any of url, pid or localPort is not usable', () => {
  for (const missing of ['url', 'pid', 'localPort']) {
    const partial = rec();
    delete partial[missing];
    writeFileSync(tunnelPath(), JSON.stringify(partial));
    assert.equal(readTunnel(), null, `accepted a record with no ${missing}`);
  }
});

test('unreadable JSON is not a record', () => {
  writeFileSync(tunnelPath(), '{ not json');
  assert.equal(readTunnel(), null);
});
