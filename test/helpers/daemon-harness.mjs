// Start the daemon on an ephemeral port and talk to it like a browser would.
//
// Every store-touching integration test repeats the same eight lines: create the
// server, listen on 0, build a base URL, and send the requests.
//
// It sends a same-origin `Origin` header on writes. Not because the guard
// requires one (`sameOrigin` in daemon.mjs returns true when the header is
// absent, which is how the CLI writes), but because a browser always sends one
// and a harness that never does would leave the mismatch branch of that guard
// untested by every route built on top of it.

import { createDaemon } from '../../server/daemon.mjs';
import { createGatewayServer } from '../../lib/gateway.mjs';

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}

/**
 * A running daemon against whatever store SPECFORGE_HOME currently names.
 *
 * Call inside a test that has already installed a temp store; this does not make
 * one, so the caller keeps control of the store's lifetime.
 *
 * @returns {Promise<object>} `{ base, close, get, post, patch, del, json }`
 */
export async function startDaemon() {
  const server = createDaemon();
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;

  const send = (method) => async (path, body) => fetch(base + path, {
    method,
    // Matches the daemon's own host, so `sameOrigin` accepts it.
    headers: {
      'Content-Type': 'application/json',
      Origin: base,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  return {
    base,
    server,
    close: () => new Promise((r) => server.close(r)),
    get: (path) => fetch(base + path),
    post: send('POST'),
    patch: send('PATCH'),
    put: send('PUT'),
    del: send('DELETE'),
    /** Fetch and parse, returning `{ status, body }` so both can be asserted. */
    async json(path, init) {
      const res = await fetch(base + path, init);
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { status: res.status, body };
    },
  };
}

/**
 * A running public gateway, with a token table the test controls.
 *
 * The gateway takes a resolver rather than reading the store's share records, so
 * a test decides which token stands for which spec. `share(id)` issues one and
 * returns it.
 *
 * @param {(token: string) => string|null} [resolve] custom resolver
 * @returns {Promise<object>} `{ base, close, share, tokens }`
 */
export async function startGateway(resolve) {
  const tokens = new Map();
  const resolver = resolve || ((t) => tokens.get(t) || null);
  const server = createGatewayServer(resolver);
  const port = await listen(server);
  const base = `http://127.0.0.1:${port}`;

  const { newToken } = await import('../../lib/tokens.mjs');

  return {
    base,
    server,
    tokens,
    close: () => new Promise((r) => server.close(r)),
    share(specId) {
      const token = newToken();
      tokens.set(token, specId);
      return token;
    },
    get: (path) => fetch(base + path),
  };
}
