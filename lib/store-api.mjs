// Comments API for the v2 daemon — JSON over HTTP, backed by the global store's
// per-spec comment store (store-comments.mjs) + inbox (store-inbox.mjs). The
// store-id-keyed analogue of v1's server/api.mjs. Block anchors are resolved
// client-side (the browser has the DOM), so the server never parses the spec.

import { readMeta, writeMeta } from './meta.mjs';
import {
  loadComments, mutateComments, createThread, addComment, resolveThread,
  editComment, findThread,
} from './store-comments.mjs';
import { renameSpec } from './store.mjs';
import { sanitizeTitle, sanitizeTags, sanitizeCollection } from './organize.mjs';
import { submitBatch, reviewProgressForSpec } from './store-inbox.mjs';
import { requestExport } from './store-export.mjs';
import { setStatus } from './lifecycle.mjs';
import { detach, isStale } from './attach.mjs';
import { readPrefs, writePrefs } from './store-prefs.mjs';
import { readGlobalPrefs, writeGlobalPrefs } from './global-prefs.mjs';
import { sessionDisplay } from './session-label.mjs';

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

/**
 * PATCH /api/spec/:id/comments/:tid/comment/:cid — edit a comment's body.
 * Only an own, not-yet-submitted comment is editable: claude (agent) comments
 * are never editable over HTTP, and once a comment is frozen into a batch
 * (has a batchId) the agent may already be acting on it, so it's locked.
 */
export function handleCommentEdit(id, tid, cid, body, res) {
  if (!specOr404(id, res)) return;
  let comment;
  try {
    comment = mutateComments(id, (store) => {
      const thread = findThread(store, tid);
      if (!thread) throw new Error(`thread not found: ${tid}`);
      const existing = thread.comments.find((c) => c.id === cid);
      if (!existing) throw new Error(`comment not found: ${cid}`);
      if (existing.author !== 'human') throw new Error('only your own comments can be edited');
      if (existing.batchId) throw new Error('a submitted comment cannot be edited');
      return editComment(store, tid, cid, body.body);
    });
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
  sendJson(res, 200, { comment });
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
    sessionLabel: sessionDisplay(meta),
    connected: !!meta.attachedSession && !isStale(meta),
    reviewProgress: reviewProgressForSpec(id),
    export: meta.export || null,
  });
}

/**
 * POST /api/spec/:id/export — queue a Google Docs export. The browser can't call
 * the Drive MCP, so this only stamps a request for the attached session to run;
 * with no live session there's nothing to fulfill it (409).
 */
export function handleExport(id, res) {
  if (!specOr404(id, res)) return;
  const meta = readMeta(id);
  if (!meta.attachedSession || isStale(meta)) {
    return sendJson(res, 409, { error: 'attach this spec to a Claude session to export it' });
  }
  sendJson(res, 202, { ok: true, export: requestExport(id) });
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

/** GET /api/prefs — store-wide UI prefs (the index page's theme). */
export function handleGlobalPrefsGet(res) {
  sendJson(res, 200, { prefs: readGlobalPrefs() });
}

/** PUT /api/prefs — merge a validated store-wide prefs patch; returns merged. */
export function handleGlobalPrefsPut(body, res) {
  sendJson(res, 200, { ok: true, prefs: writeGlobalPrefs(body) });
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

/** POST /api/spec/:id/rename — set the title (meta + the spec's own <h1>/<title>). */
export function handleRename(id, body, res) {
  if (!specOr404(id, res)) return;
  const title = sanitizeTitle(body && body.title);
  if (!title) return sendJson(res, 400, { error: 'title required' });
  const meta = renameSpec(id, title);
  sendJson(res, 200, { ok: true, title: meta.title });
}

/** PATCH /api/spec/:id/organize — set tags and/or collection (only the keys present). */
export function handleOrganize(id, body, res) {
  if (!specOr404(id, res)) return;
  const meta = readMeta(id);
  if (body && 'tags' in body) meta.tags = sanitizeTags(body.tags);
  if (body && 'collection' in body) meta.collection = sanitizeCollection(body.collection);
  writeMeta(id, meta);
  sendJson(res, 200, { ok: true, tags: meta.tags || [], collection: meta.collection || null });
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
