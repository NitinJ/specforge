// Comments API for the v2 daemon — JSON over HTTP, backed by the global store's
// per-spec comment store (store-comments.mjs) + inbox (store-inbox.mjs). The
// store-id-keyed analogue of v1's server/api.mjs. Block anchors are resolved
// client-side (the browser has the DOM), so the server never parses the spec.

import { readMeta } from './meta.mjs';
import {
  loadComments, mutateComments, createThread, addComment, resolveThread,
} from './store-comments.mjs';
import { submitBatch } from './store-inbox.mjs';
import { setStatus } from './lifecycle.mjs';
import { detach } from './attach.mjs';
import { readPrefs, writePrefs } from './store-prefs.mjs';

export function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

export function readJsonBody(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
      } else {
        data += c;
      }
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/** True iff the spec exists; otherwise 404s and returns false. */
function specOr404(id, res) {
  if (readMeta(id)) return true;
  sendJson(res, 404, { error: 'spec not found' });
  return false;
}

/** GET /api/spec/:id/comments — stored threads. */
export function handleCommentsGet(id, res) {
  if (!specOr404(id, res)) return;
  const store = loadComments(id);
  sendJson(res, 200, { specId: id, threads: store.threads });
}

/** POST /api/spec/:id/comments — create a thread { anchor, body }. Human-only. */
export function handleCommentCreate(id, body, res) {
  if (!specOr404(id, res)) return;
  let thread;
  try {
    // The public HTTP API is human-only; agent (claude) replies are written to
    // the store by the review flow, never over HTTP — ignore a client `author`.
    thread = mutateComments(id, (store) => createThread(store, { anchor: body.anchor, body: body.body, author: 'human' }));
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
  sendJson(res, 201, { thread });
}

/** POST /api/spec/:id/comments/:tid/reply — add a comment { body }. Human-only. */
export function handleCommentReply(id, tid, body, res) {
  if (!specOr404(id, res)) return;
  let comment;
  try {
    comment = mutateComments(id, (store) => addComment(store, tid, { body: body.body, author: 'human' }));
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
  sendJson(res, 201, { comment });
}

/** POST /api/spec/:id/comments/:tid/resolve — resolve a thread (human only). */
export function handleCommentResolve(id, tid, res) {
  if (!specOr404(id, res)) return;
  let thread;
  try {
    thread = mutateComments(id, (store) => resolveThread(store, tid));
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
  sendJson(res, 200, { thread });
}

/** POST /api/spec/:id/comments/submit — freeze pending comments into a batch. */
export function handleSubmit(id, res) {
  if (!specOr404(id, res)) return;
  const batch = submitBatch(id);
  if (!batch) return sendJson(res, 200, { ok: false, reason: 'nothing to submit' });
  sendJson(res, 201, { ok: true, batch });
}

/** GET /api/spec/:id/meta — lifecycle + ownership for the action button/dropdown. */
export function handleMeta(id, res) {
  const meta = readMeta(id);
  if (!meta) return sendJson(res, 404, { error: 'spec not found' });
  sendJson(res, 200, {
    id: meta.id, title: meta.title, status: meta.status, attachedSession: meta.attachedSession,
  });
}

/** POST /api/spec/:id/status — set lifecycle status (the action button). */
export function handleStatus(id, body, res) {
  if (!specOr404(id, res)) return;
  try {
    const meta = setStatus(id, body.status);
    sendJson(res, 200, { ok: true, status: meta.status });
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
}

/** GET /api/spec/:id/prefs — this spec's persisted UI prefs (theme/width/filter). */
export function handlePrefsGet(id, res) {
  if (!specOr404(id, res)) return;
  sendJson(res, 200, { specId: id, prefs: readPrefs(id) });
}

/** PUT /api/spec/:id/prefs — merge a validated prefs patch; returns the merged prefs. */
export function handlePrefsPut(id, body, res) {
  if (!specOr404(id, res)) return;
  sendJson(res, 200, { ok: true, prefs: writePrefs(id, body) });
}

/** POST /api/spec/:id/detach — free the spec from its session (sessionless; browser). */
export function handleDetach(id, res) {
  if (!specOr404(id, res)) return;
  detach(id);
  sendJson(res, 200, { ok: true, id });
}

/** POST /api/spec/:id/comments/resolve-all — resolve every open thread (human). */
export function handleResolveAll(id, res) {
  if (!specOr404(id, res)) return;
  const resolved = mutateComments(id, (store) => {
    let n = 0;
    for (const t of store.threads) {
      if (t.state !== 'resolved') { resolveThread(store, t.id); n++; }
    }
    return n;
  });
  sendJson(res, 200, { ok: true, resolved });
}
