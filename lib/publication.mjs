// A publication: one spec, served on its own socket.
//
// Publishing does not expose the daemon. It puts this listener on a fresh
// loopback port with one spec id bound at construction, and a tunnel points at
// that port. Isolation is structural rather than a policy: the daemon's index,
// its other specs and its destructive routes are not behind this socket at all,
// so there is no identifier to change and nothing to enumerate.
//
// No route here carries a spec id. Anything not listed answers 404.

import http from 'node:http';
import { statSync } from 'node:fs';
import { readSpecHtml } from './store.mjs';
import { specHtmlPath, commentsPath } from './store-paths.mjs';
import { injectReviewLayer } from '../server/inject.mjs';
import { serveStatic } from '../server/static.mjs';
import {
  sendJson, readJsonBody, handleCommentsGet, handleCommentCreate,
  handleCommentReply, handleCommentResolve, handleCommentEdit, handleAnchorPatch,
  handleSubmit, handleBlocksGet, handleBlocksPut,
} from './store-api.mjs';

/** Modification time in ms, or 0 when the file is absent. */
function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * What a polling page needs to know: has the spec changed, have the comments.
 *
 * A published page cannot hold an event stream (measured: Cloudflare's edge
 * returns the response headers and then buffers every body byte), so it asks
 * for these two numbers instead and refetches when either moves.
 */
export function readPublicationState(specId) {
  return { spec: mtime(specHtmlPath(specId)), comments: mtime(commentsPath(specId)) };
}

/**
 * An HTTP server serving exactly one spec.
 * @param {string} specId bound at construction; never read from a request
 * @returns {import('node:http').Server} unbound; the caller listens
 */
export function createPublicationServer(specId) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;

    const withBody = (fn) => readJsonBody(req)
      .then(fn)
      .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));

    if (path === '/api/comments') {
      if (method === 'GET') return handleCommentsGet(specId, res);
      if (method === 'POST') return withBody((b) => handleCommentCreate(specId, b, res));
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    if (path === '/api/comments/submit') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleSubmit(specId, res);
    }
    const reply = path.match(/^\/api\/comments\/([\w-]+)\/reply$/);
    if (reply) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return withBody((b) => handleCommentReply(specId, reply[1], b, res));
    }
    const resolve = path.match(/^\/api\/comments\/([\w-]+)\/resolve$/);
    if (resolve) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleCommentResolve(specId, resolve[1], res);
    }
    const editC = path.match(/^\/api\/comments\/([\w-]+)\/comment\/([\w-]+)$/);
    if (editC) {
      if (method !== 'PATCH') return sendJson(res, 405, { error: 'method not allowed' });
      return withBody((b) => handleCommentEdit(specId, editC[1], editC[2], b, res));
    }
    const anchorP = path.match(/^\/api\/comments\/([\w-]+)\/anchor$/);
    if (anchorP) {
      if (method !== 'PATCH') return sendJson(res, 405, { error: 'method not allowed' });
      return withBody((b) => handleAnchorPatch(specId, anchorP[1], b, res));
    }
    if (path === '/api/blocks') {
      if (method === 'GET') return handleBlocksGet(specId, res);
      if (method === 'PUT') return withBody((b) => handleBlocksPut(specId, b, res));
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    if (path === '/api/state') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      return sendJson(res, 200, readPublicationState(specId));
    }

    if (method === 'GET') {
      if (path === '/') {
        let html;
        try {
          html = readSpecHtml(specId);
        } catch {
          return send(res, 404, 'text/plain; charset=utf-8', 'spec not found');
        }
        // transport 'poll' and an api base without a spec id: the listener knows
        // which it is, so no client has to probe for a stream that never speaks.
        return send(res, 200, 'text/html; charset=utf-8',
          injectReviewLayer(html, { specId, transport: 'poll', api: '/api' }));
      }
      const pub = path.match(/^\/public\/([\w.-]+)$/);
      if (pub) return serveStatic(pub[1], res);
    }

    // Default deny. Everything the daemon serves and this does not list —
    // the index, other specs, rename, organize, status, export, prefs, DELETE —
    // lands here.
    return send(res, 404, 'text/plain; charset=utf-8', 'not found');
  });
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
