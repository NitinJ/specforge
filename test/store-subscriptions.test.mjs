// Subscriptions: pointers to other people's shared projects.
//
// A subscription is {name, origin, token} and never content — the rail it
// feeds links out to the owner's origin rather than mirroring anything. The
// file is the feature: join appends, leave removes, the index reads.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-subs-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const mod = await import('../lib/store-subscriptions.mjs');
const { subscriptionsPath } = await import('../lib/store-paths.mjs');

const TOK = 'a'.repeat(32);

test('parseShareUrl accepts a project share URL and nothing else', () => {
  assert.deepEqual(mod.parseShareUrl(`https://specs.example/p/${TOK}`),
    { origin: 'https://specs.example', token: TOK });
  assert.deepEqual(mod.parseShareUrl(`https://specs.example/p/${TOK}/`),
    { origin: 'https://specs.example', token: TOK });
  assert.equal(mod.parseShareUrl(`https://specs.example/s/${TOK}`), null, 'a spec share is not a project');
  assert.equal(mod.parseShareUrl('https://specs.example/p/not-a-token'), null);
  assert.equal(mod.parseShareUrl(`ftp://specs.example/p/${TOK}`), null, 'http(s) only');
  assert.equal(mod.parseShareUrl('not a url'), null);
  assert.equal(mod.parseShareUrl(`https://specs.example/p/${TOK}/spec/abc`), null,
    'a deep link is not the project URL');
});

test('adding stores the pointer; reading it back sanitizes', () => {
  mod.addSubscription({ name: 'Atelier', origin: 'https://specs.example', token: TOK });
  const subs = mod.readSubscriptions();
  assert.equal(subs.length, 1);
  assert.equal(subs[0].name, 'Atelier');
  assert.equal(subs[0].origin, 'https://specs.example');
  assert.equal(subs[0].token, TOK);
  assert.ok(subs[0].addedAt);
});

test('the same origin+token joins once: a re-join updates the name instead', () => {
  mod.addSubscription({ name: 'Old name', origin: 'https://specs.example', token: TOK });
  mod.addSubscription({ name: 'New name', origin: 'https://specs.example', token: TOK });
  const subs = mod.readSubscriptions();
  assert.equal(subs.length, 1);
  assert.equal(subs[0].name, 'New name');
});

test('leave removes by URL, by token, or by name', () => {
  const b = 'b'.repeat(32);
  const c = 'c'.repeat(32);
  mod.addSubscription({ name: 'One', origin: 'https://x.example', token: TOK });
  mod.addSubscription({ name: 'Two', origin: 'https://y.example', token: b });
  mod.addSubscription({ name: 'Three', origin: 'https://z.example', token: c });
  assert.equal(mod.removeSubscription(`https://x.example/p/${TOK}`), true);
  assert.equal(mod.removeSubscription(b), true);
  assert.equal(mod.removeSubscription('Three'), true);
  assert.deepEqual(mod.readSubscriptions(), []);
  assert.equal(mod.removeSubscription('nothing left'), false);
});

test('leave by an ambiguous name is refused, naming the tokens', () => {
  const b = 'b'.repeat(32);
  mod.addSubscription({ name: 'Shared project', origin: 'https://x.example', token: TOK });
  mod.addSubscription({ name: 'Shared project', origin: 'https://y.example', token: b });
  assert.throws(() => mod.removeSubscription('Shared project'), /2 subscriptions are named/);
  assert.equal(mod.readSubscriptions().length, 2, 'nothing was removed');
  // By token still works, because a token names exactly one.
  assert.equal(mod.removeSubscription(b), true);
  assert.equal(mod.readSubscriptions().length, 1);
});

test('a held lock refuses the write rather than racing it', () => {
  // Unlike the comments lock, which degrades to best-effort because its caller
  // is a request handler, a CLI one-shot refuses: a re-run costs nothing, a
  // silently dropped subscription costs someone their joined project.
  mkdirSync(home, { recursive: true });
  writeFileSync(`${subscriptionsPath()}.lock`, '');
  try {
    assert.throws(
      () => mod.addSubscription({ name: 'Blocked', origin: 'https://x.example', token: TOK }),
      /locked by another specforge process/,
    );
  } finally {
    rmSync(`${subscriptionsPath()}.lock`, { force: true });
  }
  // And the lock file being gone restores normal service.
  mod.addSubscription({ name: 'After', origin: 'https://x.example', token: TOK });
  assert.equal(mod.readSubscriptions().length, 1);
});

test('a lock left by a dead process is reclaimed rather than wedging the file', () => {
  mkdirSync(home, { recursive: true });
  const lock = `${subscriptionsPath()}.lock`;
  writeFileSync(lock, '');
  // Backdate it past the staleness window.
  const old = Date.now() - 60_000;
  utimesSync(lock, old / 1000, old / 1000);
  mod.addSubscription({ name: 'Reclaimed', origin: 'https://x.example', token: TOK });
  assert.equal(mod.readSubscriptions()[0].name, 'Reclaimed');
});

test('a corrupt file reads as no subscriptions rather than throwing', () => {
  mkdirSync(home, { recursive: true });
  writeFileSync(subscriptionsPath(), '[{broken');
  assert.deepEqual(mod.readSubscriptions(), []);
});

test('a record with a malformed token or origin is dropped on read', () => {
  mkdirSync(home, { recursive: true });
  writeFileSync(subscriptionsPath(), JSON.stringify([
    { name: 'ok', origin: 'https://x.example', token: TOK, addedAt: 'x' },
    { name: 'bad token', origin: 'https://x.example', token: 'nope', addedAt: 'x' },
    { name: 'bad origin', origin: 'javascript:alert(1)', token: 'd'.repeat(32), addedAt: 'x' },
  ]));
  const subs = mod.readSubscriptions();
  assert.equal(subs.length, 1);
  assert.equal(subs[0].name, 'ok');
});
