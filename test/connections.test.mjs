// Two harnesses on one spec, and the one the human chose to work it.
//
// Attachment used to do two jobs. `connections` is now the set and
// `attachedSession` is the active one, which is what keeps this a small change:
// every reader that meant "the owner" goes on meaning it.
//
// Spec e9ddcddef6, stage 6.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSession } from './helpers/live-session.mjs';
import {
  connectionsOf, activeHarnessOf, connectionList, connectionAlive,
  connect, disconnect, setActive, canWrite, writeRefusal,
} from '../lib/connections.mjs';
import {
  attach, detach, specsForSession, specsConnectedTo, heartbeat,
} from '../lib/attach.mjs';
import { createSpec } from '../lib/store.mjs';
import { readMeta, writeMeta } from '../lib/meta.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-conn-');

const newSpec = (title = 'A spec') => createSpec({ title, html: `<h1>${title}</h1>` });

/** A spec with a Claude session working it and a Pi session connected. */
function shared() {
  const c = seedSession({ id: 'c1', harness: 'claude' });
  const p = seedSession({ id: 'p1', harness: 'pi' });
  const specId = newSpec();
  attach(specId, c.key);
  connect(specId, p.key);
  return { specId, claude: c, pi: p };
}

// --- I2: a spec that predates all of this -----------------------------------

test('a spec with no connections field reads as the one it has always had', () => {
  const specId = newSpec();
  const meta = readMeta(specId);
  writeMeta(specId, { ...meta, attachedSession: 'abc-123', connections: undefined });

  const now = readMeta(specId);
  assert.deepEqual(Object.keys(connectionsOf(now)), ['claude']);
  assert.equal(activeHarnessOf(now), 'claude');
  assert.equal(connectionsOf(now).claude.session, 'claude:abc-123');
});

test('a spec attached to nothing has no connections and no active harness', () => {
  const meta = readMeta(newSpec());
  assert.deepEqual(connectionsOf(meta), {});
  assert.equal(activeHarnessOf(meta), null);
});

// --- I8: one connection per harness -----------------------------------------

test('a second session of the same harness replaces the first', () => {
  const specId = newSpec();
  connect(specId, 'pi:one');
  connect(specId, 'pi:two');
  const conns = connectionsOf(readMeta(specId));
  assert.deepEqual(Object.keys(conns), ['pi']);
  assert.equal(conns.pi.session, 'pi:two');
});

test('two harnesses connect side by side', () => {
  const { specId } = shared();
  assert.deepEqual(Object.keys(connectionsOf(readMeta(specId))).sort(), ['claude', 'pi']);
});

// --- the active harness ------------------------------------------------------

test('attaching makes that harness active, and connects it', () => {
  const { specId } = shared();
  assert.equal(activeHarnessOf(readMeta(specId)), 'claude');
});

test('connecting does not take the work', () => {
  // E8 in one assertion: nothing an agent does changes who is active.
  const { specId, pi: p } = shared();
  connect(specId, p.key);
  assert.equal(activeHarnessOf(readMeta(specId)), 'claude');
});

test('the human switches it, and the spec moves with it', () => {
  const { specId, pi: p } = shared();
  const out = setActive(specId, 'pi');
  assert.equal(out.ok, true);
  assert.equal(out.changed, true);
  assert.equal(activeHarnessOf(readMeta(specId)), 'pi');
  assert.deepEqual(specsForSession(p.key), [specId], 'and batches now route to it');
});

test('switching to the harness already active is a no-op, not an error', () => {
  const { specId } = shared();
  const out = setActive(specId, 'claude');
  assert.equal(out.ok, true);
  assert.equal(out.changed, false);
});

test('a harness that is not connected cannot be made active', () => {
  // Activating one would name a session nothing can route to.
  const { specId } = shared();
  const out = setActive(specId, 'codex');
  assert.equal(out.ok, false);
  assert.match(out.error, /not connected/);
  assert.match(out.error, /claude, pi/);
  assert.equal(activeHarnessOf(readMeta(specId)), 'claude', 'and nothing moved');
});

test('an unknown spec answers with an error rather than throwing', () => {
  assert.equal(setActive('deadbeef00', 'pi').ok, false);
});

// --- I6 and I10: who may write ------------------------------------------------

test('only the active harness may write the spec', () => {
  const { specId, claude: c, pi: p } = shared();
  const meta = readMeta(specId);
  assert.equal(canWrite(meta, c.key), true);
  assert.equal(canWrite(meta, p.key), false);
});

test('the refusal names the harness to switch away from', () => {
  const { specId } = shared();
  const msg = writeRefusal(specId, readMeta(specId));
  assert.match(msg, /claude/);
  assert.match(msg, /spec header/, 'and says where to change it');
});

test('a spec nothing holds is writable by anyone', () => {
  const specId = newSpec();
  assert.equal(canWrite(readMeta(specId), 'pi:anyone'), true);
});

test('switching hands the write over', () => {
  const { specId, pi: p } = shared();
  setActive(specId, 'pi');
  assert.equal(canWrite(readMeta(specId), p.key), true);
});

test('`comments` says whether this session may amend the spec', async (t) => {
  // The gate an agent actually meets. It amends spec.html with its own editor,
  // which nothing here can intercept, so the refusal has to arrive with the
  // threads rather than at the write.
  //
  // The session is put into the environment rather than read from it: CI runs
  // inside no agent at all, so `currentSessionKey()` there is '' and the whole
  // test asserts the no-session branch by accident.
  const { cmdComments } = await import('../lib/specforge-cli.mjs');
  const prev = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = 'sess-writable';
  t.after(() => {
    if (prev === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = prev;
  });
  const me = 'claude:sess-writable';

  const ours = newSpec('Ours');
  attach(ours, me);
  const mine = await cmdComments({ id: ours });
  assert.equal(mine.writable, true);
  assert.equal(mine.refusal, undefined, 'and says nothing when there is nothing to say');

  const specId = newSpec('Theirs');
  attach(specId, 'pi:someone-else');
  connect(specId, me);
  const theirs = await cmdComments({ id: specId });
  assert.equal(theirs.writable, false);
  assert.match(theirs.refusal, /pi/);
  assert.equal(theirs.threads.length, 0, 'and the threads are still handed over to answer');
});

test('a script with no session is not a competing agent, and may write', async (t) => {
  // What CI is, and what a cron job is. Refusing here would make every
  // non-agent caller unable to touch a spec an agent happens to hold.
  const { cmdComments } = await import('../lib/specforge-cli.mjs');
  const prev = process.env.CLAUDE_CODE_SESSION_ID;
  delete process.env.CLAUDE_CODE_SESSION_ID;
  t.after(() => { if (prev !== undefined) process.env.CLAUDE_CODE_SESSION_ID = prev; });

  const specId = newSpec('Held by someone');
  attach(specId, 'pi:someone-else');
  const out = await cmdComments({ id: specId });
  assert.equal(out.writable, true);
  assert.equal(out.refusal, undefined);
});

// --- I9: exactly one recipient ------------------------------------------------

test('batches route to the active harness only', () => {
  const { specId, claude: c, pi: p } = shared();
  assert.deepEqual(specsForSession(c.key), [specId]);
  assert.deepEqual(specsForSession(p.key), [], 'connected, but not the recipient');
});

test('both sessions can still find the spec they are connected to', () => {
  // What separates routing from reporting: doctor and the header need the set,
  // the watcher needs the one.
  const { specId, claude: c, pi: p } = shared();
  assert.deepEqual(specsConnectedTo(c.key), [specId]);
  assert.deepEqual(specsConnectedTo(p.key), [specId]);
});

// --- I11: liveness, per connection --------------------------------------------

test('a connection with a recorded pid is judged by the pid, not the beat', () => {
  // The defect this prevents: `wait-batch` exits the moment it delivers a batch,
  // so its last beat stays fresh for another half minute with nothing behind it.
  const fresh = { session: 'pi:x', lastBeat: Date.now(), watcherPid: 4242 };
  assert.equal(connectionAlive(fresh, { alive: () => false }), false);
  assert.equal(connectionAlive(fresh, { alive: () => true }), true);
});

test('a connection with no pid falls back to the beat, which is what the badge showed', () => {
  // Every spec written before this has no pid recorded. Reading those as
  // permanently dead would mark all 111 as needing a reconnect.
  const now = Date.now();
  assert.equal(connectionAlive({ session: 'claude:x', lastBeat: now }, { now }), true);
  assert.equal(connectionAlive({ session: 'claude:x', lastBeat: now - 120000 }, { now }), false);
});

test('a watcher beat records liveness on its own connection', () => {
  const { specId, claude: c } = shared();
  heartbeat(c.key);
  const conns = connectionsOf(readMeta(specId));
  assert.equal(conns.claude.watcherPid, process.pid, 'its own pid, from the session record');
  assert.equal(conns.pi.watcherPid, null, 'and it did not touch the other harness');
});

test('a connected but inactive session beats its own connection too', () => {
  // The defect this prevents, seen on a live spec: the beat loop walked
  // `specsForSession`, which is active-only, so a session connected to a spec
  // another harness was working never beat it. Its connection went stale within
  // thirty seconds and read "needs reconnect" for as long as the session lived,
  // which is exactly the agent the reader is trying to hand the spec to.
  const { specId, pi: p } = shared(); // claude active, pi connected
  heartbeat(p.key);

  const conns = connectionsOf(readMeta(specId));
  assert.equal(conns.pi.watcherPid, process.pid, 'the inactive harness recorded its pid');
  assert.equal(connectionAlive(conns.pi), true, 'and therefore reads live');
});

test('an inactive session\'s beat does not move the spec\'s own heartbeat', () => {
  // `meta.heartbeat` answers "is the session working this spec listening", which
  // is about the active one. An inactive session bumping it would report the
  // wrong agent as live.
  const { specId, pi: p } = shared();
  const before = readMeta(specId).heartbeat || 0;
  heartbeat(p.key);
  assert.equal(readMeta(specId).heartbeat || 0, before);
});

test('the header list says which connections need a reconnect', () => {
  const { specId } = shared();
  const meta = readMeta(specId);
  const conns = connectionsOf(meta);
  writeMeta(specId, {
    ...meta,
    connections: { ...conns, pi: { ...conns.pi, watcherPid: 0x7ffffffe } },
  });

  const list = connectionList(readMeta(specId));
  assert.deepEqual(list.map((c) => c.harness), ['claude', 'pi']);
  assert.equal(list.find((c) => c.harness === 'claude').active, true);
  assert.equal(list.find((c) => c.harness === 'pi').alive, false, 'a dead pid needs a reconnect');
});

// --- detach -------------------------------------------------------------------

test('detaching drops that harness, and does not promote another on its own', () => {
  // P9 puts the choice with the human. Switching on their behalf would move work
  // to an agent they did not pick.
  const { specId } = shared();
  detach(specId);
  const meta = readMeta(specId);
  assert.equal(activeHarnessOf(meta), null);
  assert.deepEqual(Object.keys(connectionsOf(meta)), ['pi'], 'the other stays connected');
});

test('disconnecting a harness that was never there changes nothing', () => {
  const { specId } = shared();
  disconnect(specId, 'codex');
  assert.deepEqual(Object.keys(connectionsOf(readMeta(specId))).sort(), ['claude', 'pi']);
});
