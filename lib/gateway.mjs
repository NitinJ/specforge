// The public gateway: one socket serving every published spec.
//
// This replaces the one-listener-per-spec design. That design got its isolation
// structurally, by binding a spec id at construction so no route could name a
// different one. A single origin cannot do that, so isolation here rests on two
// explicit properties instead, and both are tested:
//
//   1. The tunnel's only downstream is this port. The daemon's routes (the
//      index, rename, organize, status, export, DELETE) are not on this socket
//      at all, so no bug in this file can reach them.
//   2. A spec is reachable only through a token the caller was given. Tokens are
//      16 random bytes and are never derived from a spec id, so possessing one
//      published spec's link says nothing about any other spec.
//
// Every route lives under /s/<token>. Anything else, including a bare spec id,
// falls through to the default deny.

import http from 'node:http';
import { readSpecHtml } from './store.mjs';
import { injectReviewLayer } from '../server/inject.mjs';
import { serveStatic } from '../server/static.mjs';
import { readPublicationState } from './publication-state.mjs';
import { isToken } from './tokens.mjs';
import {
  sendJson, readJsonBody, handleCommentsGet, handleCommentCreate,
  handleCommentReply, handleCommentResolve, handleCommentEdit, handleAnchorPatch,
  handleSubmit, handleBlocksGet, handleBlocksPut,
} from './store-api.mjs';

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

/**
 * An unknown token and a revoked one answer identically, byte for byte. A
 * distinguishable response would confirm that a token exists, which is the one
 * fact the token is there to withhold.
 */
function notFound(res) {
  return send(res, 404, 'text/plain; charset=utf-8', 'not found');
}

/**
 * @param {(token:string) => string|null} resolve token to spec id; null for
 *   anything not published right now. Called per request, so revocation takes
 *   effect on the next request rather than at the next restart.
 * @returns {import('node:http').Server} unbound; the caller listens
 */
export function createGatewayServer(resolve) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;

    // Static review-layer assets, at the root. They carry no spec data, and
    // keeping them off the token path means one cache entry rather than one per
    // published spec.
    const pub = path.match(/^\/public\/([\w.-]+)$/);
    if (pub) {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      return serveStatic(pub[1], res);
    }

    const scoped = path.match(/^\/s\/([^/]+)(\/.*)?$/);
    if (!scoped) return notFound(res);

    const [, rawToken, rest = ''] = scoped;
    // Validated before it is used as a lookup key, so nothing a path can carry
    // (a spec id, a traversal, trailing whitespace) reaches the registry.
    if (!isToken(rawToken)) return notFound(res);
    const specId = resolve(rawToken);
    if (!specId) return notFound(res);

    const withBody = (fn) => readJsonBody(req)
      .then(fn)
      .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));

    if (rest === '' || rest === '/') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      let html;
      try {
        html = readSpecHtml(specId);
      } catch {
        return notFound(res);
      }
      // transport 'poll' because an event stream does not survive the tunnel
      // (measured: the edge returns headers and buffers every body byte). The
      // api base carries this token, and no route below reads a spec id.
      return send(res, 200, 'text/html; charset=utf-8',
        injectReviewLayer(html, { specId, transport: 'poll', api: `/s/${rawToken}/api` }));
    }

    if (rest === '/api/comments') {
      if (method === 'GET') return handleCommentsGet(specId, res);
      if (method === 'POST') return withBody((b) => handleCommentCreate(specId, b, res));
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    if (rest === '/api/comments/submit') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleSubmit(specId, res);
    }
    const reply = rest.match(/^\/api\/comments\/([\w-]+)\/reply$/);
    if (reply) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return withBody((b) => handleCommentReply(specId, reply[1], b, res));
    }
    const resolveT = rest.match(/^\/api\/comments\/([\w-]+)\/resolve$/);
    if (resolveT) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleCommentResolve(specId, resolveT[1], res);
    }
    const editC = rest.match(/^\/api\/comments\/([\w-]+)\/comment\/([\w-]+)$/);
    if (editC) {
      if (method !== 'PATCH') return sendJson(res, 405, { error: 'method not allowed' });
      return withBody((b) => handleCommentEdit(specId, editC[1], editC[2], b, res));
    }
    const anchorP = rest.match(/^\/api\/comments\/([\w-]+)\/anchor$/);
    if (anchorP) {
      if (method !== 'PATCH') return sendJson(res, 405, { error: 'method not allowed' });
      return withBody((b) => handleAnchorPatch(specId, anchorP[1], b, res));
    }
    if (rest === '/api/blocks') {
      if (method === 'GET') return handleBlocksGet(specId, res);
      if (method === 'PUT') return withBody((b) => handleBlocksPut(specId, b, res));
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    if (rest === '/api/state') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      return sendJson(res, 200, readPublicationState(specId));
    }

    // Default deny. Everything the daemon serves and this does not list lands
    // here: the index, other specs, rename, organize, status, export, prefs and
    // DELETE.
    return notFound(res);
  });
}
