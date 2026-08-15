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
import { renderProjectPage, projectSpecs } from '../server/project-page.mjs';
import { readPublicationState } from './publication-state.mjs';
import { isToken } from './tokens.mjs';
import { readMeta } from './meta.mjs';
import { isReservedId } from './store-paths.mjs';
import {
  sendJson, readJsonBody, handleCommentsGet, handleCommentCreate,
  handleCommentReply, handleCommentResolve, handleCommentEdit, handleAnchorPatch,
  handleSubmit, handleBlocksGet, handleBlocksPut, handlePublicMeta,
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
 * The review-layer API a published spec page uses, shared by both address
 * schemes: /s/<token>/api/* and /p/<token>/spec/<id>/api/*. The caller has
 * already resolved a token to a spec id, which is the whole authorization.
 *
 * @param {string} rest the path after `/api`, starting with `/`
 * @returns {boolean} whether the path was one of ours (response sent)
 */
function dispatchSpecApi(specId, rest, method, req, res) {
  const withBody = (fn) => readJsonBody(req)
    .then(fn)
    .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));

  if (rest === '/comments') {
    if (method === 'GET') { handleCommentsGet(specId, res); return true; }
    if (method === 'POST') { withBody((b) => handleCommentCreate(specId, b, res)); return true; }
    sendJson(res, 405, { error: 'method not allowed' });
    return true;
  }
  if (rest === '/comments/submit') {
    if (method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return true; }
    handleSubmit(specId, res);
    return true;
  }
  const reply = rest.match(/^\/comments\/([\w-]+)\/reply$/);
  if (reply) {
    if (method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return true; }
    withBody((b) => handleCommentReply(specId, reply[1], b, res));
    return true;
  }
  const resolveT = rest.match(/^\/comments\/([\w-]+)\/resolve$/);
  if (resolveT) {
    if (method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return true; }
    handleCommentResolve(specId, resolveT[1], res);
    return true;
  }
  const editC = rest.match(/^\/comments\/([\w-]+)\/comment\/([\w-]+)$/);
  if (editC) {
    if (method !== 'PATCH') { sendJson(res, 405, { error: 'method not allowed' }); return true; }
    withBody((b) => handleCommentEdit(specId, editC[1], editC[2], b, res));
    return true;
  }
  const anchorP = rest.match(/^\/comments\/([\w-]+)\/anchor$/);
  if (anchorP) {
    if (method !== 'PATCH') { sendJson(res, 405, { error: 'method not allowed' }); return true; }
    withBody((b) => handleAnchorPatch(specId, anchorP[1], b, res));
    return true;
  }
  if (rest === '/blocks') {
    if (method === 'GET') { handleBlocksGet(specId, res); return true; }
    if (method === 'PUT') { withBody((b) => handleBlocksPut(specId, b, res)); return true; }
    sendJson(res, 405, { error: 'method not allowed' });
    return true;
  }
  if (rest === '/state') {
    if (method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return true; }
    sendJson(res, 200, readPublicationState(specId));
    return true;
  }
  // The reader's half of the spec's meta — never the owner's (handlePublicMeta).
  if (rest === '/meta') {
    if (method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return true; }
    handlePublicMeta(specId, res);
    return true;
  }
  return false;
}

/**
 * @param {(token:string) => string|null} resolve token to spec id; null for
 *   anything not published right now. Called per request, so revocation takes
 *   effect on the next request rather than at the next restart.
 * @param {(token:string) => string|null} [resolveProject] token to project
 *   name, same contract. Defaults to "no project is published".
 * @returns {import('node:http').Server} unbound; the caller listens
 */
export function createGatewayServer(resolve, resolveProject = () => null) {
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
      return serveStatic(pub[1], res, req);
    }

    // ---- /p/<token>: a whole project, addressed by its own token ----
    const projScoped = path.match(/^\/p\/([^/]+)(\/.*)?$/);
    if (projScoped) {
      const [, rawToken, rest = ''] = projScoped;
      if (!isToken(rawToken)) return notFound(res);
      const project = resolveProject(rawToken);
      if (!project) return notFound(res);

      if (rest === '' || rest === '/') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        return send(res, 200, 'text/html; charset=utf-8', renderProjectPage(project, rawToken));
      }
      // What a subscription card renders by: the name and how much is in it.
      if (rest === '/api/meta') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        const specs = projectSpecs(project);
        return sendJson(res, 200, {
          project,
          specs: specs.length,
          updated: specs.reduce((max, m) => Math.max(max, m.updated || 0), 0),
        });
      }
      const specScoped = rest.match(/^\/spec\/([\w-]+)(\/.*)?$/);
      if (specScoped) {
        const [, specId, specRest = ''] = specScoped;
        // Membership is checked on every request, so moving a spec out of the
        // project is its revocation, with nothing separate to revoke. Outside
        // the project answers exactly like an unknown token.
        const meta = isReservedId(specId) ? null : readMeta(specId);
        if (!meta || (meta.project || null) !== project) return notFound(res);

        if (specRest === '' || specRest === '/') {
          if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
          let html;
          try {
            html = readSpecHtml(specId);
          } catch {
            return notFound(res);
          }
          return send(res, 200, 'text/html; charset=utf-8',
            injectReviewLayer(html, {
              specId, transport: 'poll', api: `/p/${rawToken}/spec/${specId}/api`,
            }));
        }
        if (specRest.startsWith('/api')
          && dispatchSpecApi(specId, specRest.slice(4), method, req, res)) return undefined;
      }
      return notFound(res);
    }

    const scoped = path.match(/^\/s\/([^/]+)(\/.*)?$/);
    if (!scoped) return notFound(res);

    const [, rawToken, rest = ''] = scoped;
    // Validated before it is used as a lookup key, so nothing a path can carry
    // (a spec id, a traversal, trailing whitespace) reaches the registry.
    if (!isToken(rawToken)) return notFound(res);
    const specId = resolve(rawToken);
    if (!specId) return notFound(res);

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

    if (rest.startsWith('/api')
      && dispatchSpecApi(specId, rest.slice(4), method, req, res)) return undefined;

    // Default deny. Everything the daemon serves and this does not list lands
    // here: the index, other specs, rename, organize, status, export, prefs and
    // DELETE.
    return notFound(res);
  });
}
