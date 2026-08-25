// A stand-in for Pi's extension API, so the Pi binding is testable with Pi
// absent (E6).
//
// It records rather than simulates. What the binding has to get right is which
// event it registers for and what options it passes to sendMessage, and both are
// assertions about calls, not about behaviour. Simulating Pi would be testing
// Pi.
//
// Spec e9ddcddef6, task 0.2.

/**
 * A recording `pi` object.
 *
 * @returns {{
 *   handlers: Map<string, Function[]>,
 *   sent: {message: any, options: object}[],
 *   userMessages: {content: any, options: object}[],
 *   on: Function, sendMessage: Function, sendUserMessage: Function,
 *   fire: Function, registeredFor: Function
 * }}
 */
export function fakePi() {
  const handlers = new Map();
  const sent = [];
  const userMessages = [];

  const pi = {
    handlers,
    sent,
    userMessages,

    on(event, handler) {
      if (!handlers.has(event)) handlers.set(event, []);
      handlers.get(event).push(handler);
    },

    sendMessage(message, options = {}) {
      sent.push({ message, options });
    },

    sendUserMessage(content, options = {}) {
      userMessages.push({ content, options });
    },

    /** Event names the binding registered for, in registration order. */
    registeredFor() {
      return [...handlers.keys()];
    },

    /**
     * Run every handler registered for `event`, in order, awaiting each.
     *
     * Returns the handlers' return values, because `before_agent_start` answers
     * with a message rather than sending one, and a test needs to read it.
     */
    async fire(event, payload = {}, ctx = {}) {
      const out = [];
      for (const handler of handlers.get(event) || []) out.push(await handler(payload, ctx));
      return out;
    },
  };
  return pi;
}

/**
 * The context object Pi hands a handler, reduced to what the binding reads.
 *
 * `getSessionId` rather than `getSessionFile`: Q2 settled that the session UUID
 * is the identity, and the file path is not it.
 */
export function fakePiContext({ sessionId = 'pi-uuid-0001', cwd = '/tmp/fake' } = {}) {
  return {
    cwd,
    sessionManager: {
      getSessionId: () => sessionId,
      getSessionFile: () => (sessionId ? `${cwd}/${sessionId}.jsonl` : undefined),
      isPersisted: () => Boolean(sessionId),
    },
  };
}
