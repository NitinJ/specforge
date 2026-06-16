// Comments API for the review server. JSON over HTTP, backed by the per-spec
// comment store. Anchors are resolved server-side against the current spec so
// the client can render precise / moved / section / orphaned highlights.

import { resolveSpec } from '../lib/paths.mjs';
import {
  loadStore, saveStore, createThread, addComment, resolveThread,
} from '../lib/comments.mjs';
import { submitBatch } from '../lib/inbox.mjs';

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

function specOr404(specsDir, id, res) {
  const spec = resolveSpec(specsDir, id);
  if (!spec) {
    sendJson(res, 404, { error: 'spec not found' });
    return null;
  }
  return spec;
}

/** GET /api/spec/:id/comments — stored threads. Block anchors are resolved
 *  client-side (the browser has the DOM), so the server never parses the spec. */
export function handleCommentsGet(specsDir, id, res) {
  const spec = specOr404(specsDir, id, res);
  if (!spec) return;
  const store = loadStore(specsDir, id, spec.relPath);
  sendJson(res, 200, { specId: id, specPath: spec.relPath, threads: store.threads });
}

/** POST /api/spec/:id/comments — create a thread { anchor, body, author? }. */
export function handleCommentCreate(specsDir, id, body, res) {
  const spec = specOr404(specsDir, id, res);
  if (!spec) return;
  const store = loadStore(specsDir, id, spec.relPath);
  let thread;
  try {
    // The public HTTP API is human-only. Agent (claude) replies are written
    // directly to the store by the review-spec skill, never over HTTP — so a
    // client-supplied `author` is ignored to prevent forged claude comments.
    thread = createThread(store, { anchor: body.anchor, body: body.body, author: 'human' });
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
  saveStore(specsDir, store);
  sendJson(res, 201, { thread });
}

/** POST /api/spec/:id/comments/:tid/reply — add a comment { body, author? }. */
export function handleCommentReply(specsDir, id, tid, body, res) {
  const spec = specOr404(specsDir, id, res);
  if (!spec) return;
  const store = loadStore(specsDir, id, spec.relPath);
  let comment;
  try {
    // Human-only (see handleCommentCreate): ignore any client-supplied author.
    comment = addComment(store, tid, { body: body.body, author: 'human' });
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
  saveStore(specsDir, store);
  sendJson(res, 201, { comment });
}

/** POST /api/spec/:id/comments/:tid/resolve — resolve a thread (human only). */
export function handleCommentResolve(specsDir, id, tid, res) {
  const spec = specOr404(specsDir, id, res);
  if (!spec) return;
  const store = loadStore(specsDir, id, spec.relPath);
  let thread;
  try {
    thread = resolveThread(store, tid);
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
  saveStore(specsDir, store);
  sendJson(res, 200, { thread });
}

/** POST /api/spec/:id/comments/submit — freeze pending comments into a batch. */
export function handleSubmit(specsDir, id, res) {
  const spec = specOr404(specsDir, id, res);
  if (!spec) return;
  const batch = submitBatch(specsDir, id, spec.relPath);
  if (!batch) return sendJson(res, 200, { ok: false, reason: 'nothing to submit' });
  sendJson(res, 201, { ok: true, batch });
}
