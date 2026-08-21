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
 * @param {object} [opts]
 * @param {string} [opts.id] the session id; defaults to a fixed readable one
 * @param {boolean} [opts.alive] whether its watcher pid is a running process
 * @returns {{id: string, watcherPid: number}}
 */
export function seedSession({ id = 'sess-live-0001', alive = true } = {}) {
  const watcherPid = alive ? process.pid : DEAD_PID;
  mkdirSync(sessionsDir(), { recursive: true });
  writeFileSync(sessionPath(id), JSON.stringify({ specs: [], watcherPid }, null, 2));
  return { id, watcherPid };
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
