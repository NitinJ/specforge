// Give a temp store a session that looks alive, or one that does not.
//
// "Alive" here means what lib/attach.mjs means by it: a session record naming a
// watcher process that still exists. Not the heartbeat, which answers a weaker
// question and is stale for thirty seconds after `wait-batch` exits (attach.mjs
// L106-116). Anything deciding whether an agent is available to hand work to has
// to read the pid.
//
// The live pid is this test process. Nothing else in a test run is guaranteed to
// be running, and a made-up pid is either dead or, worse, belongs to something
// unrelated that happens to be alive.
//
// Spec 45395008a2, task 0.1.

import { mkdirSync, writeFileSync } from 'node:fs';

import { sessionsDir, sessionPath } from '../../lib/store-paths.mjs';
import { sessionKey, encodeKey, LEGACY_HARNESS } from '../../lib/session-key.mjs';

/** A pid that is certainly not running. Chosen high, above the usual pid_max. */
const DEAD_PID = 0x7ffffffe;

/**
 * Write a session record into the current store.
 *
 * Seeds the watcher only. It deliberately takes no list of owned specs: the
 * record's `specs` array is a reverse index, and meta.attachedSession is the
 * source of truth (attach.mjs L21-24). A helper writing only the index would
 * hand back spec ids that `specsForSession` then filters out, which is a fixture
 * that looks like ownership and is not one. To own a spec in a test, call
 * `attach(specId, sessionId)` — the production function, which writes both.
 * Raised in review of PR #221.
 *
 * `harness` names which CLI the session belongs to. Two harnesses can issue the
 * same raw id, so a fixture that could only seed the raw one could not express
 * I1 at all. Defaulting to `claude` keeps every test written before harnesses
 * existed seeding exactly what it always seeded, down to the filename.
 *
 * `id` is the RAW id, not the key. Callers pass it straight to `watcherAlive`
 * and `attach`, which read a raw id today and a key from Stage 1 onward, and a
 * helper that returned the key early would break every one of them at once. The
 * qualified form is `key`, for the tests that mean the key.
 *
 * @param {object} [opts]
 * @param {string} [opts.id] the raw session id; defaults to a fixed readable one
 * @param {string} [opts.harness] the harness that owns it
 * @param {boolean} [opts.alive] whether its watcher pid is a running process
 * @returns {{id: string, key: string, harness: string, watcherPid: number}}
 */
export function seedSession({ id = 'sess-live-0001', harness = 'claude', alive = true } = {}) {
  const watcherPid = alive ? process.pid : DEAD_PID;
  const key = sessionKey(harness, id);
  const record = { specs: [], watcherPid };
  // Only a non-default harness records the field, so a Claude Code fixture stays
  // byte-identical to the records already in the store.
  if (harness !== LEGACY_HARNESS) record.harness = harness;
  mkdirSync(sessionsDir(), { recursive: true });
  writeFileSync(sessionPath(encodeKey(key)), JSON.stringify(record, null, 2));
  return { id, key, harness, watcherPid };
}

/**
 * A session record in the shape the store held before harness keys existed: the
 * raw id as its own filename, and no harness field.
 *
 * The fixture I2 is asserted against. Every one of the 111 records on this
 * machine is this shape, so a reader that cannot handle it detaches all of them.
 */
export function seedLegacySession({ id = 'sess-legacy-0001', alive = true } = {}) {
  const watcherPid = alive ? process.pid : DEAD_PID;
  mkdirSync(sessionsDir(), { recursive: true });
  writeFileSync(sessionPath(id), JSON.stringify({ specs: [], watcherPid }, null, 2));
  return { id, key: sessionKey(LEGACY_HARNESS, id), watcherPid };
}

/** A session an agent is listening on. */
export const seedLiveSession = (opts = {}) => seedSession({ ...opts, alive: true });

/**
 * A session record left behind by a window that is gone.
 *
 * The state a store is in most of the time, and the one that must refuse work
 * rather than queue it somewhere nobody will look.
 */
export const seedDeadSession = (opts = {}) => seedSession({ ...opts, alive: false });
