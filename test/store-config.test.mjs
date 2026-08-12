// Store config: the settings that change how publishing behaves.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'sf-cfg-'));
process.env.SPECFORGE_HOME = home;

const { readConfig, writeConfig, setPublicOrigin } = await import('../lib/store-config.mjs');
const { configPath } = await import('../lib/store-paths.mjs');

after(() => rmSync(home, { recursive: true, force: true }));

test('an absent config is an empty one', () => {
  assert.deepEqual(readConfig(), {});
});

test('a config round-trips', () => {
  mkdirSync(home, { recursive: true });
  writeConfig({ publicOrigin: 'https://spec.example.com' });
  assert.equal(readConfig().publicOrigin, 'https://spec.example.com');
});

test('unreadable config is an empty one rather than a crash', () => {
  writeFileSync(configPath(), '{ not json');
  assert.deepEqual(readConfig(), {});
});

// The origin is concatenated into every published URL, so a trailing slash or a
// path would produce links with a double slash or a buried prefix.
test('setPublicOrigin keeps only the origin', () => {
  for (const [input, want] of [
    ['https://spec.example.com', 'https://spec.example.com'],
    ['https://spec.example.com/', 'https://spec.example.com'],
    ['https://spec.example.com/some/path', 'https://spec.example.com'],
    ['https://spec.example.com:8443', 'https://spec.example.com:8443'],
    ['  https://spec.example.com  ', 'https://spec.example.com'],
  ]) {
    assert.equal(setPublicOrigin(input).publicOrigin, want, `for ${JSON.stringify(input)}`);
  }
});

// An empty argument is a mistake, not an intent. Reading it as "hand the tunnel
// back" would change the origin of every link already sent, silently.
test('setPublicOrigin refuses what cannot be an origin', () => {
  for (const bad of ['', '   ', 'spec.example.com', 'ftp://spec.example.com', 'not a url']) {
    assert.throws(() => setPublicOrigin(bad), /origin/i, `accepted ${JSON.stringify(bad)}`);
  }
});

test('clearing hands the tunnel back to SpecForge', () => {
  setPublicOrigin('https://spec.example.com');
  assert.ok(readConfig().publicOrigin);
  setPublicOrigin(null);
  assert.equal(readConfig().publicOrigin, undefined);
});

test('clearing leaves other settings alone', () => {
  writeConfig({ publicOrigin: 'https://spec.example.com', somethingElse: 1 });
  setPublicOrigin(null);
  assert.equal(readConfig().somethingElse, 1);
});
