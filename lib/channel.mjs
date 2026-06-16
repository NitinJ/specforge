// In-memory long-poll channel for live review delivery.
//
// A "waiter" is a parked GET /await call. publish(specId, batch) wakes every
// waiter for that spec; waitForBatch(specId, timeoutMs) parks until a publish
// arrives or the timeout elapses (resolving null). Ephemeral by design — the
// on-disk inbox is the durable truth, so a server restart loses waiters, never
// comments (the Stop/UserPromptSubmit hook re-routes pending batches).

/** @type {Map<string, Set<{deliver(batch:any):void}>>} */
const waiters = new Map();

/** Number of parked waiters for a spec (test/observability helper). */
export function waiterCount(specId) {
  const set = waiters.get(specId);
  return set ? set.size : 0;
}

/**
 * Wake every waiter parked on `specId` with `batch`.
 * @returns {number} how many waiters were notified
 */
export function publish(specId, batch) {
  const set = waiters.get(specId);
  if (!set || set.size === 0) return 0;
  const n = set.size;
  for (const w of [...set]) w.deliver(batch);
  return n;
}

/**
 * Park until a batch is published for `specId`, the `timeoutMs` elapses, or the
 * optional `signal` aborts (e.g. the client disconnected). On timeout/abort the
 * waiter is removed and the promise resolves null.
 * @returns {Promise<any|null>} the published batch, or null on timeout/abort
 */
export function waitForBatch(specId, timeoutMs = 25000, signal) {
  return new Promise((resolve) => {
    let set = waiters.get(specId);
    if (!set) { set = new Set(); waiters.set(specId, set); }
    const w = { done: false };
    function onAbort() { w.deliver(null); }
    w.deliver = (batch) => {
      if (w.done) return;
      w.done = true;
      clearTimeout(w.timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      set.delete(w);
      if (set.size === 0) waiters.delete(specId);
      resolve(batch ?? null);
    };
    if (signal && signal.aborted) { w.deliver(null); return; } // already gone
    // Ref'd on purpose: the timeout must fire to resolve the long-poll with
    // null. In the server the listening socket keeps the loop alive regardless;
    // this just guarantees a parked waiter always settles within timeoutMs.
    w.timer = setTimeout(() => w.deliver(null), timeoutMs);
    if (signal) signal.addEventListener('abort', onAbort);
    set.add(w);
  });
}
