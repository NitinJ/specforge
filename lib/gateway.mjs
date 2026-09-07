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
//
//   3. A token reaches its spec and everything BELOW it, and nothing else. A
//      spec's substance can live in child specs, so a token that served only its
//      root would hand the reader a document with holes in it. The grant is
//      downward only: a token on a child reaches neither its parent nor its
//      siblings. Membership is resolved per request, so a child added later is
//      covered and a child detached later is not, and it is decided before
//      anything is read.

import http from 'node:http';
import { readSpecHtml } from './store.mjs';
import { injectReviewLayer } from '../server/inject.mjs';
import { serveStatic } from '../server/static.mjs';
import { renderProjectPage, projectSpecs } from '../server/project-page.mjs';
import { addContribution, removeContribution } from './store-project-shares.mjs';
import { readPublicationState } from './publication-state.mjs';
import { isToken } from './tokens.mjs';
import { readMeta } from './meta.mjs';
import { rewriteSpecLinks } from './share-links.mjs';
import { isReservedId } from './store-paths.mjs';
import { descendantsOf } from './spec-tree.mjs';
import { flattenSubtree } from './flatten-tree.mjs';
import {
  sendJson, readJsonBody, handleCommentsGet, handleCommentCreate,
  handleCommentReply, handleCommentEdit, handleAnchorPatch,
  handleSubmit, handleBlocksGet, handleBlocksPut, handlePublicMeta, handlePublicChildren,
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
 * What a spec token serves: the root it names and everything below it.
 *
 * Resolved per request, so a child added after the link was sent is covered and
 * one detached since is not. An unreadable tree grants the root alone, which is
 * what the token meant before child specs.
 *
 * @param {string} rootId
 * @returns {(specId: string) => boolean}
 */
function inSubtree(rootId) {
  let subtree;
  try {
    subtree = descendantsOf(rootId);
  } catch {
    subtree = [rootId];
  }
  return (id) => !isReservedId(id) && subtree.includes(id);
}

/**
 * The review-layer API a published spec page uses, shared by both address
 * schemes: /s/<token>/api/* and /p/<token>/spec/<id>/api/*. The caller has
 * already resolved a token to a spec id, which is the whole authorization.
 *
 * @param {string} rest the path after `/api`, starting with `/`
 * @param {(specId: string) => boolean} reachable whether this token serves that
 *   OTHER spec. Only the two tree routes read it, and they are the two that can
 *   name a spec the reader was not given: everything else on this dispatcher
 *   answers about `specId` alone, which the token already granted.
 * @returns {boolean} whether the path was one of ours (response sent)
 */
function dispatchSpecApi(specId, rest, method, req, res, reachable) {
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
    // Everything reaching this dispatcher arrived through a share token, so the
    // batch is a reviewer's however it was addressed. The agent answers it and
    // does not amend the document on it (spec D3).
    handleSubmit(specId, res, 'share');
    return true;
  }
  const reply = rest.match(/^\/comments\/([\w-]+)\/reply$/);
  if (reply) {
    if (method !== 'POST') { sendJson(res, 405, { error: 'method not allowed' }); return true; }
    withBody((b) => handleCommentReply(specId, reply[1], b, res));
    return true;
  }
  // Resolve is deliberately absent. Closing a thread is the owner's verdict on
  // whether their spec answered it (spec 82f5dabccf, D4), and a reviewer
  // reaches this dispatcher by holding a token, which says nothing about whose
  // spec it is. It falls through to the gateway's default deny.
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
    handlePublicMeta(specId, res, reachable);
    return true;
  }
  // The child list. Reachable only for a spec the token already resolves, so it
  // discloses nothing that opening that spec would not.
  if (rest === '/children') {
    if (method !== 'GET') { sendJson(res, 405, { error: 'method not allowed' }); return true; }
    handlePublicChildren(specId, res, reachable);
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
      const inProject = (id) => {
        if (isReservedId(id)) return false;
        const m = readMeta(id);
        return !!m && (m.project || null) === project;
      };

      const withBody = (fn) => readJsonBody(req)
        .then(fn)
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));

      if (rest === '' || rest === '/') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        return send(res, 200, 'text/html; charset=utf-8', renderProjectPage(project, rawToken));
      }
      // What a subscription card renders by: the name and how much is in it.
      // The one route with CORS (D8): the Shared-with-me rail on a teammate's
      // local index fetches this cross-origin. Read-only, token-gated, and the
      // comment APIs stay same-origin — a reviewer uses those from the
      // owner-served page, so nothing else needs widening.
      if (rest === '/api/meta') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        res.setHeader('Access-Control-Allow-Origin', '*');
        const specs = projectSpecs(project);
        return sendJson(res, 200, {
          project,
          specs: specs.length,
          updated: specs.reduce((max, m) => Math.max(max, m.updated || 0), 0),
        });
      }
      // Registering a contribution: the one write on this socket that is not a
      // comment. It appends a metadata row to the project-share record and
      // nothing else — the spec it names stays on the contributor's machine and
      // is never fetched, stored or served from here (spec D9). The project
      // token is the capability (D10), the same one commenting already needs.
      if (rest === '/contribute') {
        if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
        return withBody((b) => {
          try {
            const saved = addContribution(project, b || {});
            return sendJson(res, 201, { ok: true, entry: saved });
          } catch (e) {
            return sendJson(res, 400, { error: e.message });
          }
        });
      }
      const withdraw = rest.match(/^\/contribute\/([^/]+)$/);
      if (withdraw) {
        if (method !== 'DELETE') return sendJson(res, 405, { error: 'method not allowed' });
        // Validated before it is used as a key, like every token on this socket.
        if (!isToken(withdraw[1])) return notFound(res);
        return sendJson(res, 200, { ok: true, removed: removeContribution(project, withdraw[1]) });
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
          // mtime BEFORE bytes: a write landing between the two then pairs new
          // bytes with an old stamp, which costs one spurious "new version"
          // notice. The other order pairs old bytes with a new stamp, and the
          // page believes itself current forever.
          const servedAt = readPublicationState(specId).spec;
          let html;
          try {
            html = readSpecHtml(specId);
          } catch {
            return notFound(res);
          }
          // Links to the project's other specs are rewritten into this share.
          // Reachability is the same test the route above just applied, so a
          // link that resolves is one this reader could already have opened by
          // typing the address, and one that does not is left unfollowable
          // rather than pointed at the deny page.
          const linked = rewriteSpecLinks(html, {
            base: `/p/${rawToken}`,
            reachable: inProject,
          });
          return send(res, 200, 'text/html; charset=utf-8',
            injectReviewLayer(linked, {
              specId, transport: 'poll', api: `/p/${rawToken}/spec/${specId}/api`, servedAt,
            }));
        }
        // A project token grants a project. Membership is the same test the
        // route above applied to this spec, applied again to any other spec a
        // response would name.
        if (specRest.startsWith('/api')
          && dispatchSpecApi(specId, specRest.slice(4), method, req, res, inProject))
          return undefined;
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
      // mtime BEFORE bytes — see the project-scoped route above for why the
      // order is the whole point.
      const servedAt = readPublicationState(specId).spec;
      let html;
      try {
        html = readSpecHtml(specId);
      } catch {
        return notFound(res);
      }
      // One spec was shared, so no cross-spec link is reachable, not even to
      // another spec the same person published: their tokens are separate
      // capabilities and this one grants neither. The links are left
      // unfollowable rather than pointed at the deny page.
      // Links to specs BELOW this one are followable, because the token grants
      // them: the subtree is one document split up, and a reference from the
      // parent to its own child is the commonest link in it. Anything else,
      // including another spec the same person published, is left unfollowable:
      // their tokens are separate capabilities and this one grants neither.
      let subtree = [];
      try {
        subtree = descendantsOf(specId);
      } catch { /* an unreadable tree leaves every link unfollowable */ }
      const linked = rewriteSpecLinks(html, {
        base: `/s/${rawToken}`,
        reachable: (linkId) => !isReservedId(linkId) && linkId !== specId && subtree.includes(linkId),
      });
      // transport 'poll' because an event stream does not survive the tunnel
      // (measured: the edge returns headers and buffers every body byte). The
      // api base carries this token, and no route below reads a spec id.
      return send(res, 200, 'text/html; charset=utf-8',
        injectReviewLayer(linked, { specId, transport: 'poll', api: `/s/${rawToken}/api`, servedAt }));
    }

    // The shared root's own API. What this token also serves is its subtree and
    // nothing above it: the spec the root was cut out of is a store fact the
    // reader has not been given, and its id is the thing they would ask for next.
    if (rest.startsWith('/api')
      && dispatchSpecApi(specId, rest.slice(4), method, req, res, inSubtree(specId)))
      return undefined;

    // ---- a descendant of the shared spec ----
    //
    // A share exists so somebody can read a spec, and after child specs a spec's
    // substance can live in specs below it. A token that served only its root
    // would hand the reader a document with holes in it and no way to tell how
    // much was missing, which is worse than the single large document child
    // specs replaced.
    //
    // The grant is downward only and it is a standing one: the subtree is
    // resolved per request, so a child added later is covered and a child
    // detached later is not. Membership is decided before anything is read, and
    // a non-member answers exactly like a token that means nothing, so the
    // response cannot be used to learn which spec ids exist.
    const childScoped = rest.match(/^\/spec\/([\w-]+)(\/.*)?$/);
    if (childScoped) {
      const [, wantedId, childRest = ''] = childScoped;
      if (isReservedId(wantedId)) return notFound(res);
      let subtree;
      try {
        subtree = descendantsOf(specId);
      } catch {
        return notFound(res);
      }
      if (!subtree.includes(wantedId)) return notFound(res);

      if (childRest === '' || childRest === '/') {
        if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
        // mtime BEFORE bytes — see the project-scoped route above for why.
        const servedAt = readPublicationState(wantedId).spec;

        // The flat view, for a reader printing a tree. Without it the PDF row
        // on a shared parent opened this route, got the ordinary root page and
        // printed a document with the children missing. The grant already
        // covers everything below `wantedId`, so flattening it hands the reader
        // exactly what the token entitles them to and nothing more.
        if (url.searchParams.get('flat') === '1') {
          let flat;
          try {
            flat = flattenSubtree(wantedId);
          } catch {
            return notFound(res);
          }
          return send(res, 200, 'text/html; charset=utf-8', injectReviewLayer(flat, {
            specId: wantedId,
            embed: true,
          }));
        }

        let html;
        try {
          html = readSpecHtml(wantedId);
        } catch {
          return notFound(res);
        }
        // Links within the subtree stay followable, because the reader holds a
        // capability for all of it. Anything else is left unfollowable, as on
        // the root.
        const linked = rewriteSpecLinks(html, {
          base: `/s/${rawToken}`,
          reachable: (linkId) => !isReservedId(linkId) && subtree.includes(linkId),
        });
        return send(res, 200, 'text/html; charset=utf-8', injectReviewLayer(linked, {
          specId: wantedId,
          transport: 'poll',
          // Carries both the token and the spec: without the spec id a reader's
          // comments on a child would land on the root.
          api: `/s/${rawToken}/spec/${wantedId}/api`,
          servedAt,
          embed: url.searchParams.get('embed') === '1',
          theme: url.searchParams.get('theme'),
        }));
      }

      if (childRest.startsWith('/api')
        && dispatchSpecApi(wantedId, childRest.slice(4), method, req, res, inSubtree(specId)))
        return undefined;
      return notFound(res);
    }

    // Default deny. Everything the daemon serves and this does not list lands
    // here: the index, other specs, rename, organize, status, export, prefs and
    // DELETE.
    return notFound(res);
  });
}
