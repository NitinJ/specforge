// Comments API for the v2 daemon — JSON over HTTP, backed by the global store's
// per-spec comment store (store-comments.mjs) + inbox (store-inbox.mjs). The
// store-id-keyed analogue of v1's server/api.mjs. Block anchors are resolved
// client-side (the browser has the DOM), so the server never parses the spec.

import { readMeta, writeMeta } from './meta.mjs';
import {
  loadComments, mutateComments, createThread, addComment, resolveThread,
  editComment, findThread,
} from './store-comments.mjs';
import { renameSpec, deleteSpec } from './store.mjs';
import { sanitizeTitle, sanitizeTags, sanitizeCollection } from './organize.mjs';
import { submitBatch, reviewProgressForSpec } from './store-inbox.mjs';
import { requestExport } from './store-export.mjs';
import { setStatus } from './lifecycle.mjs';
import { detach, isStale } from './attach.mjs';
import { readPrefs, writePrefs } from './store-prefs.mjs';
import { readBlocks, writeBlocks } from './store-blocks.mjs';
import { normalizeAuthor, isReservedName } from './mentions.mjs';
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

/**
 * True iff the spec is NOT a protected template; otherwise 403s and returns
 * false. Template specs (meta.template) are edited through their spec.html
 * only — their identity (title/collection/status) is fixed so the scaffolding
 * source can't be renamed away, re-shelved, or closed (a closed spec blocks
 * edits). Comments/detach stay open — that IS the template-editing flow.
 */
function notTemplateOr403(id, res) {
  const meta = readMeta(id);
  if (!meta || !meta.template) return true;
  sendJson(res, 403, { error: 'template specs are protected' });
  return false;
}

/** GET /api/spec/:id/comments — stored threads. */
export function handleCommentsGet(id, res) {
  if (!specOr404(id, res)) return;
  const store = loadComments(id);
  sendJson(res, 200, { specId: id, threads: store.threads });
}

/**
 * The display name for a write arriving over HTTP.
 *
 * `kind` is never taken from the request: a client that could set it would be
 * able to post as the agent. The name itself is self-asserted by design, and
 * only has to be usable. A request with no name at all keeps the pre-authors
 * default so a browser that has not yet been through the naming dialog still
 * works.
 *
 * @returns {{author:string} | {error:string}}
 */
function authorFor(body) {
  if (body == null || body.author === undefined) return { author: 'human' };
  const author = normalizeAuthor(body.author);
  if (!author) {
    return { error: isReservedName(body.author) ? `the name "${String(body.author).trim()}" is reserved` : 'author must be a non-empty name' };
  }
  return { author };
}

/** POST /api/spec/:id/comments — create a thread { anchor, body, author? }. Human-only. */
export function handleCommentCreate(id, body, res) {
  if (!specOr404(id, res)) return;
  const who = authorFor(body);
  if (who.error) return sendJson(res, 400, { error: who.error });
  let thread;
  try {
    thread = mutateComments(id, (store) => createThread(store, {
      anchor: body.anchor, body: body.body, author: who.author, kind: 'human',
    }));
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
  sendJson(res, 201, { thread });
}

/** POST /api/spec/:id/comments/:tid/reply — add a comment { body, author? }. Human-only. */
export function handleCommentReply(id, tid, body, res) {
  if (!specOr404(id, res)) return;
  const who = authorFor(body);
  if (who.error) return sendJson(res, 400, { error: who.error });
  let comment;
  try {
    comment = mutateComments(id, (store) => addComment(store, tid, {
      body: body.body, author: who.author, kind: 'human',
    }));
  } catch (e) {
    return sendJson(res, 400, { error: e.message });
  }
  sendJson(res, 201, { comment });
}

/**
 * PATCH /api/spec/:id/comments/:tid/anchor — record the block id a thread
 * resolved to, so a comment written before ids existed becomes an exact anchor.
 *
 * Deliberately narrow: it sets `anchor.block.bid` and nothing else. The rest of
 * the anchor is left untouched so an older client (or a rolled-back plugin) can
 * still resolve the thread the way it always did, and comment bodies and thread
 * state are out of reach entirely — this must never look like an edit.
 */
export function handleAnchorPatch(id, tid, body, res) {
  if (!specOr404(id, res)) return;
  const bid = body && typeof body.bid === 'string' ? body.bid.trim() : '';
  if (!bid) return sendJson(res, 400, { error: 'bid required' });
  try {
    const anchor = mutateComments(id, (store) => {
      const thread = findThread(store, tid);
      if (!thread) throw new Error(`thread not found: ${tid}`);
      if (!thread.anchor || !thread.anchor.block) throw new Error('thread has no block anchor');
      thread.anchor.block.bid = bid;
      return thread.anchor;
    });
    sendJson(res, 200, { ok: true, anchor });
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
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
  // Don't re-queue while one is in flight — a second request would reset the
  // signal and the next hook would launch the export skill a second time in
  // parallel (orphaned Doc + a race on the persisted url). Re-export is fine
  // once the previous run reached done/error.
  const cur = meta.export && meta.export.state;
  if (cur === 'requested' || cur === 'working') {
    return sendJson(res, 409, { error: 'an export is already in progress', export: meta.export });
  }
  sendJson(res, 202, { ok: true, export: requestExport(id) });
}

/** POST /api/spec/:id/status — set lifecycle status (the action button). */
export function handleStatus(id, body, res) {
  if (!specOr404(id, res)) return;
  if (!notTemplateOr403(id, res)) return;
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

/** GET /api/spec/:id/blocks — the block registry, or null if there isn't one yet.
 *  Null is a normal answer, not an error: the client rebuilds from the page. */
export function handleBlocksGet(id, res) {
  if (!specOr404(id, res)) return;
  sendJson(res, 200, { specId: id, registry: readBlocks(id) });
}

/** PUT /api/spec/:id/blocks — store a reconciled registry.
 *  Guarded on version so two tabs reconciling from different snapshots can't
 *  overwrite each other; a 409 tells the client to re-read and try once more. */
export function handleBlocksPut(id, body, res) {
  if (!specOr404(id, res)) return;
  const current = readBlocks(id);
  const expected = current ? current.version : 0;
  const base = body && Number.isInteger(body.baseVersion) ? body.baseVersion : null;
  if (base !== null && base !== expected) {
    return sendJson(res, 409, { error: 'stale registry', version: expected });
  }
  sendJson(res, 200, { ok: true, registry: writeBlocks(id, body) });
}

/** POST /api/spec/:id/rename — set the title (meta + the spec's own <h1>/<title>). */
export function handleRename(id, body, res) {
  if (!specOr404(id, res)) return;
  if (!notTemplateOr403(id, res)) return;
  const title = sanitizeTitle(body && body.title);
  if (!title) return sendJson(res, 400, { error: 'title required' });
  const meta = renameSpec(id, title);
  sendJson(res, 200, { ok: true, title: meta.title });
}

/** PATCH /api/spec/:id/organize — set tags and/or collection (only the keys present). */
export function handleOrganize(id, body, res) {
  if (!specOr404(id, res)) return;
  if (!notTemplateOr403(id, res)) return;
  const meta = readMeta(id);
  if (body && 'tags' in body) meta.tags = sanitizeTags(body.tags);
  if (body && 'collection' in body) {
    const coll = sanitizeCollection(body.collection);
    // "Templates" is the reserved pinned group for template specs only.
    if (coll && coll.toLowerCase() === 'templates') {
      return sendJson(res, 400, { error: 'the Templates collection is reserved for template specs' });
    }
    meta.collection = coll;
  }
  writeMeta(id, meta);
  sendJson(res, 200, { ok: true, tags: meta.tags || [], collection: meta.collection || null });
}

/** POST /api/spec/:id/detach — free the spec from its session (sessionless; browser). */
export function handleDetach(id, res) {
  if (!specOr404(id, res)) return;
  detach(id);
  sendJson(res, 200, { ok: true, id });
}

/**
 * DELETE /api/spec/:id — permanently remove a spec. Refused for protected
 * template specs (403). Detaches first so no session index keeps a dangling
 * reference, then deletes the whole store dir.
 */
export function handleDelete(id, res) {
  if (!specOr404(id, res)) return;
  if (!notTemplateOr403(id, res)) return;
  detach(id);
  deleteSpec(id);
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
