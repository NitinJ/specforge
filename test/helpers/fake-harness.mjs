// A harness record a test can script, so policy is provable with no agent CLI
// installed (E6).
//
// The real records live in lib/harness/. This one exists because a test that
// imported one of those would be testing Claude Code's payload shape or Pi's
// event names alongside the thing it means to assert. Every resolver here is a
// plain value or a function the caller supplies.
//
// The throwing variant is not a curiosity: I5 says no adapter can wedge a
// session, and the only way to assert that is to hand the binding one that
// fails.
//
// Spec e9ddcddef6, task 0.1.

/** What every field defaults to when a test does not care about it. */
const DEFAULTS = {
  id: 'fake',
  agentName: 'fake',
  sessionKey: 'fake:sess-0001',
  workRef: (workId) => `fake:${workId}`,
  reentered: false,
};

/**
 * A harness record with scriptable resolvers.
 *
 * A field given as a function is used as the resolver. A field given as a value
 * is wrapped in one, because most tests want a fixed answer and writing
 * `() => 'x'` at every call site reads worse than `'x'`.
 *
 * @param {object} [opts]
 * @param {string} [opts.id] the harness id, which prefixes every session key
 * @param {string} [opts.agentName] the name replies are signed with
 * @param {string|Function} [opts.sessionKey] the whole key, or a resolver
 * @param {Function} [opts.workRef] renders a work id as this harness would
 * @param {boolean|Function} [opts.reentered] whether this settle already followed a Notice
 * @returns {{id, agentName, sessionKey, workRef, reentered}}
 */
export function fakeHarness(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const fn = (v) => (typeof v === 'function' ? v : () => v);
  return {
    id: o.id,
    agentName: o.agentName,
    sessionKey: fn(o.sessionKey),
    workRef: fn(o.workRef),
    reentered: fn(o.reentered),
  };
}

/**
 * A harness record whose resolvers all throw.
 *
 * The fixture for I5. A binding handed this one must still exit cleanly and say
 * nothing, which is what keeps a SpecForge bug from wedging somebody's session.
 *
 * @param {string} [message] carried on the error, so a test can assert which
 *   failure it caught rather than merely that something failed
 */
export function throwingHarness(message = 'harness resolver failed') {
  const boom = () => { throw new Error(message); };
  return { id: 'boom', agentName: 'boom', sessionKey: boom, workRef: boom, reentered: boom };
}
