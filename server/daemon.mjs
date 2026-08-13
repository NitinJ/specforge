#!/usr/bin/env node
// SpecForge v2 global daemon (design §5): one server per machine, serving the
// global store at ~/.specforge. (The v1 per-project review server — server/app,
// server/start, server/api — has been retired.)
//
// Routes:
//   GET  /healthz                              → 200 "ok"
//   GET  /                                      → index: a table of all store specs
//   GET  /spec/<id>                             → spec.html with the review layer injected
//   GET  /events?spec=<id>                      → SSE live-reload for a spec
//   GET  /public/*                              → review-layer client assets
//   GET/POST /api/spec/<id>/comments            → list / create threads
//   POST /api/spec/<id>/comments/submit         → freeze a review batch
//   POST /api/spec/<id>/comments/<tid>/reply    → reply to a thread
//   PATCH /api/spec/<id>/comments/<tid>/comment/<cid> → edit an unsubmitted comment
//   POST /api/spec/<id>/comments/<tid>/resolve  → resolve a thread (human)
//   GET/PUT  /api/spec/<id>/prefs               → per-spec UI prefs (theme/width/filter)
//   GET/PUT  /api/prefs                         → store-wide UI prefs (index theme)
//   POST /api/spec/<id>/rename                  → set title (meta + spec <h1>/<title>)
//   PATCH /api/spec/<id>/organize               → set tags / collection
//
// ensureServer() (below) is the singleton entrypoint every v2 command calls:
// reuse a healthy daemon if one is advertised, else acquire the lock, bind a
// port with fall-forward, write server.json, and return the URL.

import http from 'node:http';
import { watch } from 'node:fs';
import { readSpecHtml, specHtmlPath } from '../lib/store.mjs';
import { inboxDir } from '../lib/store-paths.mjs';
import { agentBusy } from '../lib/store-inbox.mjs';
import { renderIndex } from './index-page.mjs';
import { injectReviewLayer } from './inject.mjs';
import { serveStatic } from './static.mjs';
import {
  readServerState, writeServerState, clearServerState,
  acquireLock, releaseLock, lockHolderPid, isAlive, healthOk,
} from '../lib/daemon-state.mjs';
import {
  sendJson, readJsonBody, handleCommentsGet, handleCommentCreate,
  handleCommentReply, handleCommentResolve, handleCommentEdit, handleAnchorPatch, handleSubmit,
  handleMeta, handleStatus, handleResolveAll, handleDetach,
  handlePrefsGet, handlePrefsPut, handleGlobalPrefsGet, handleGlobalPrefsPut,
  handleBlocksGet, handleBlocksPut,
  handleRename, handleOrganize, handleExport, handleDelete,
} from '../lib/store-api.mjs';
import { createDaemonDrain } from '../lib/store-watch.mjs';
import { ensureTemplates } from '../lib/store-templates.mjs';
import { createPublications } from '../lib/publications.mjs';

// Publications live for the daemon's lifetime, which is what lets a share
// outlive the terminal that made it. One registry per process.
export const publications = createPublications();

const DEFAULT_PORT = 4180;
const PORT_RETRY_LIMIT = 20; // up to 20 retries after the first attempt = 21 ports probed

// The index page lives in index-page.mjs; re-exported here because tests and
// callers import it from the daemon (the module that serves it).
export { renderIndex };

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function serveSpec(id, res) {
  let html;
  try {
    html = readSpecHtml(id);
  } catch {
    return send(res, 404, 'text/plain; charset=utf-8', 'spec not found');
  }
  send(res, 200, 'text/html; charset=utf-8', injectReviewLayer(html, { specId: id }));
}

/**
 * SSE live-reload: push a `reload` event when the spec's spec.html changes.
 *
 * Held while an agent is mid-round. Answering a batch of comments is many writes
 * — a reply, a section rewritten, a table amended — and reloading on each one
 * threw the reader back to the top of a document that was still being edited.
 * The round is the unit worth seeing, so the writes coalesce into one reload
 * when the agent marks the batch done, which is the same moment the action
 * button turns into "Review replies".
 */
function serveEvents(id, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  let closed = false;
  const safeWrite = (chunk) => {
    if (closed) return;
    try { res.write(chunk); } catch { closed = true; }
  };

  let debounce = null;
  let watcher = null;
  let inbox = null;
  let held = false; // the spec moved while an agent had it

  // The release edge is a batch file being removed, so watch for it rather than
  // polling: without this the held reload would wait for the next spec write,
  // which on a finished round never comes. Armed at the moment of the first hold
  // rather than up front — that is when a batch is known to exist, so the inbox
  // directory does too, and merely opening a page never creates one.
  const armInbox = () => {
    if (inbox || closed) return;
    try {
      inbox = watch(inboxDir(id), () => { if (!closed && held) flush(); });
    } catch {
      inbox = null;
    }
  };
  const flush = () => {
    if (closed) return;
    if (agentBusy(id)) { held = true; armInbox(); return; }
    held = false;
    safeWrite('event: reload\ndata: {}\n\n');
  };
  try {
    watcher = watch(specHtmlPath(id), () => {
      if (closed) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(flush, 100);
      debounce.unref?.();
    });
  } catch {
    watcher = null; // spec may not exist yet / be unreadable — heartbeat-only stream
  }
  const heartbeat = setInterval(() => safeWrite(': ping\n\n'), 25000);
  heartbeat.unref?.();

  const cleanup = () => {
    closed = true;
    clearInterval(heartbeat);
    if (debounce) clearTimeout(debounce);
    if (watcher) { try { watcher.close(); } catch { /* already closed */ } }
    if (inbox) { try { inbox.close(); } catch { /* already closed */ } }
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

/**
 * Create the v2 daemon HTTP server (no listen — caller binds).
 * @returns {import('node:http').Server}
 */
export function createDaemon() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;

    // --- Store-wide prefs (the index theme) ---
    if (path === '/api/prefs') {
      if (method === 'GET') return handleGlobalPrefsGet(res);
      if (method === 'PUT') {
        return readJsonBody(req)
          .then((b) => handleGlobalPrefsPut(b, res))
          .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    // --- Comments API (store-keyed) ---
    const list = path.match(/^\/api\/spec\/([\w-]+)\/comments$/);
    if (list) {
      if (method === 'GET') return handleCommentsGet(list[1], res);
      if (method === 'POST') {
        return readJsonBody(req)
          .then((b) => handleCommentCreate(list[1], b, res))
          .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    const submit = path.match(/^\/api\/spec\/([\w-]+)\/comments\/submit$/);
    if (submit) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleSubmit(submit[1], res);
    }
    const reply = path.match(/^\/api\/spec\/([\w-]+)\/comments\/([\w-]+)\/reply$/);
    if (reply) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleCommentReply(reply[1], reply[2], b, res))
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const editC = path.match(/^\/api\/spec\/([\w-]+)\/comments\/([\w-]+)\/comment\/([\w-]+)$/);
    if (editC) {
      if (method !== 'PATCH') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleCommentEdit(editC[1], editC[2], editC[3], b, res))
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const anchorP = path.match(/^\/api\/spec\/([\w-]+)\/comments\/([\w-]+)\/anchor$/);
    if (anchorP) {
      if (method !== 'PATCH') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleAnchorPatch(anchorP[1], anchorP[2], b, res))
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const resolveAll = path.match(/^\/api\/spec\/([\w-]+)\/comments\/resolve-all$/);
    if (resolveAll) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleResolveAll(resolveAll[1], res);
    }
    const resolve = path.match(/^\/api\/spec\/([\w-]+)\/comments\/([\w-]+)\/resolve$/);
    if (resolve) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleCommentResolve(resolve[1], resolve[2], res);
    }
    const meta = path.match(/^\/api\/spec\/([\w-]+)\/meta$/);
    if (meta) {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      // The registry, not the file, composes the public URL and decides whether
      // it actually serves: the record holds only a token.
      return handleMeta(meta[1], res, (id) => publications.shareInfo(id));
    }
    const status = path.match(/^\/api\/spec\/([\w-]+)\/status$/);
    if (status) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleStatus(status[1], b, res))
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const prefs = path.match(/^\/api\/spec\/([\w-]+)\/prefs$/);
    if (prefs) {
      if (method === 'GET') return handlePrefsGet(prefs[1], res);
      if (method === 'PUT') {
        return readJsonBody(req)
          .then((b) => handlePrefsPut(prefs[1], b, res))
          .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    const blocks = path.match(/^\/api\/spec\/([\w-]+)\/blocks$/);
    if (blocks) {
      if (method === 'GET') return handleBlocksGet(blocks[1], res);
      if (method === 'PUT') {
        return readJsonBody(req)
          .then((b) => handleBlocksPut(blocks[1], b, res))
          .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    const rename = path.match(/^\/api\/spec\/([\w-]+)\/rename$/);
    if (rename) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleRename(rename[1], b, res))
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const organize = path.match(/^\/api\/spec\/([\w-]+)\/organize$/);
    if (organize) {
      if (method !== 'PATCH') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleOrganize(organize[1], b, res))
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const det = path.match(/^\/api\/spec\/([\w-]+)\/detach$/);
    if (det) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleDetach(det[1], res);
    }
    const exp = path.match(/^\/api\/spec\/([\w-]+)\/export$/);
    if (exp) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleExport(exp[1], res);
    }
    // --- Publications (loopback only; a publication never serves these) ---
    if (path === '/api/shares') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      // The origin and the local port are reported alongside the list because
      // this is the surface for answering why a link is not working.
      return sendJson(res, 200, {
        origin: publications.origin(),
        localPort: publications.localPort(),
        shares: publications.list(),
      });
    }
    const shareR = path.match(/^\/api\/spec\/([\w-]+)\/share$/);
    if (shareR) {
      if (method === 'POST') {
        // rotate revokes the token already sent and mints a new one, which is
        // the only way to kill a link without unpublishing the spec.
        return readJsonBody(req).catch(() => ({}))
          .then((b) => publications.share(shareR[1], { rotate: !!(b && b.rotate) }))
          .then((share) => sendJson(res, 201, { ok: true, share }))
          .catch((e) => sendJson(res, 400, { error: e.message }));
      }
      if (method === 'DELETE') {
        return publications.unshare(shareR[1])
          .then((was) => sendJson(res, 200, { ok: true, wasPublished: was }))
          .catch((e) => sendJson(res, 400, { error: e.message }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    // Bare spec resource — DELETE removes it (the id is anchored, so this never
    // shadows the /meta, /prefs, /comments, … sub-routes above).
    const specRes = path.match(/^\/api\/spec\/([\w-]+)$/);
    if (specRes) {
      if (method !== 'DELETE') return sendJson(res, 405, { error: 'method not allowed' });
      // Revoke first, and keep new shares for this spec refused for the whole
      // delete. The delete removes the directory holding the share record, so a
      // share committing anywhere inside it would leave a public URL serving a
      // spec that no longer exists, with nothing on disk left to find it by.
      return publications.unshareThen(specRes[1], () => handleDelete(specRes[1], res))
        .catch((e) => sendJson(res, 500, { error: e.message }));
    }

    if (method === 'GET') {
      if (path === '/healthz') return send(res, 200, 'text/plain; charset=utf-8', 'ok');
      // The index shows a Shared marker per spec; the registry, not the record
      // on disk, decides whether that link actually answers.
      if (path === '/') {
        return send(res, 200, 'text/html; charset=utf-8',
          renderIndex({ shareInfo: (id) => publications.shareInfo(id) }));
      }
      if (path === '/events') return serveEvents(url.searchParams.get('spec') || '', req, res);
      const sm = path.match(/^\/spec\/([\w-]+)$/);
      if (sm) return serveSpec(sm[1], res);
      const pub = path.match(/^\/public\/([\w.-]+)$/);
      if (pub) return serveStatic(pub[1], res);
    }

    return send(res, 404, 'text/plain; charset=utf-8', 'not found');
  });
}

function listenWithFallback(server, port, host, retryLimit) {
  return new Promise((resolve, reject) => {
    let tries = 0;
    const tryPort = (p) => {
      const onError = (err) => {
        if (err.code === 'EADDRINUSE' && tries < retryLimit) {
          tries++;
          tryPort(p + 1);
        } else {
          reject(err);
        }
      };
      server.once('error', onError);
      server.listen(p, host, () => {
        server.removeListener('error', onError);
        // Resolve the *actual* bound port (p may be 0 → OS-assigned).
        resolve(server.address().port);
      });
    };
    tryPort(port);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Singleton daemon entrypoint. Returns the base url of a healthy daemon,
 * starting one in-process if needed.
 *
 *  - If server.json advertises a daemon whose pid is alive AND /healthz is 200,
 *    reuse its url (no new server).
 *  - Else acquire server.lock (O_EXCL). If the lock is held by a *live* pid,
 *    another ensureServer() is mid-start: briefly retry reading server.json and
 *    reuse it. A lock held by a dead pid is reclaimed.
 *  - Bind a port (DEFAULT_PORT with fall-forward), write server.json, return url.
 *
 * Single-user / KISS: the lockfile is the only mutual-exclusion primitive — no
 * elaborate CAS. Safe under two near-simultaneous calls.
 *
 * @returns {Promise<{url:string, server:import('node:http').Server|null, port:number}>}
 *   server is null when an existing daemon was reused.
 */
export async function ensureServer({ port = DEFAULT_PORT } = {}) {
  // 1. Reuse a healthy advertised daemon.
  const existing = readServerState();
  if (existing && isAlive(existing.pid) && (await healthOk(existing.url))) {
    return { url: existing.url, server: null, port: existing.port };
  }

  // 2. Acquire the singleton lock.
  if (!acquireLock()) {
    const holder = lockHolderPid();
    if (holder && isAlive(holder)) {
      // Another start is in flight — give it a moment, then reuse its state.
      for (let i = 0; i < 20; i++) {
        await sleep(50);
        const s = readServerState();
        if (s && isAlive(s.pid) && (await healthOk(s.url))) {
          return { url: s.url, server: null, port: s.port };
        }
      }
      // Holder never produced a healthy daemon; fall through and reclaim.
    }
    // Stale lock (dead holder, or holder that never came up) — reclaim it.
    releaseLock();
    if (!acquireLock()) {
      // Lost a genuine race; reuse whatever the winner advertised if healthy.
      const s = readServerState();
      if (s && isAlive(s.pid) && (await healthOk(s.url))) {
        return { url: s.url, server: null, port: s.port };
      }
      throw new Error('could not acquire daemon lock');
    }
  }

  // 3. We hold the lock — bind and advertise. The daemon owner also seeds the
  // per-type template specs (idempotent — existing/edited templates untouched).
  // Best-effort: a failed seed (read-only/full disk) must not abort startup —
  // it would leak the just-acquired lock, and create falls back to the bundled
  // shells anyway.
  try {
    ensureTemplates();
  } catch {
    /* templateHtmlFor falls back to the bundled shells */
  }
  const server = createDaemon();
  let boundPort;
  try {
    boundPort = await listenWithFallback(server, port, '127.0.0.1', PORT_RETRY_LIMIT);
  } catch (err) {
    releaseLock();
    throw err;
  }
  const url = `http://127.0.0.1:${boundPort}/`;
  writeServerState({ port: boundPort, pid: process.pid, url });

  // Republish on the tokens the previous daemon minted, which is what makes the
  // links it handed out keep working. Records from the older per-spec-tunnel
  // scheme cannot be honoured and are reaped instead.
  try {
    await publications.restore();
  } catch {
    /* a share record we cannot read must not stop the daemon starting */
  }

  // Mirror the listener onto IPv6 loopback (best-effort). A Windows browser
  // resolves `localhost` to ::1 first — under WSL2 mirrored networking an
  // IPv4-only bind makes localhost links flake while 127.0.0.1 works. Same
  // port, same handler; skipped silently where ::1 is unavailable. EADDRINUSE
  // is retried briefly: on a fast restart the previous daemon's ::1 socket can
  // still be closing after its lock is released (cleanup can't await close),
  // and giving up on the first conflict would silently regress to IPv4-only.
  let server6 = null;
  for (let attempt = 0; attempt < 3 && !server6; attempt++) {
    if (attempt > 0) await sleep(150);
    const candidate = createDaemon();
    try {
      await new Promise((resolve, reject) => {
        candidate.once('error', reject);
        candidate.listen(boundPort, '::1', resolve);
      });
      candidate.on('error', () => {}); // a later runtime error must never crash the daemon
      server6 = candidate;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') break; // no IPv6 / other failure → skip for good
    }
  }

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (server6) server6.close();
    clearServerState();
    releaseLock();
  };
  server.on('close', cleanup);
  process.once('exit', cleanup);

  return { url, server, port: boundPort };
}

// Runnable like start.mjs: `node server/daemon.mjs` starts the daemon and keeps
// it alive until SIGINT/SIGTERM, clearing server.json + releasing the lock.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  ensureServer().then(({ url, server }) => {
    if (!server) {
      console.log(`SpecForge daemon already running: ${url}`);
      process.exit(0);
    }
    console.log(`SpecForge daemon: ${url}`);
    // Opt-in headless orphan-drain (default off — never spawn Claude unprompted).
    let drainer = null;
    if (process.env.SPECFORGE_DAEMON_DRAIN) {
      drainer = createDaemonDrain({ log: (m) => console.log(m) }).start();
    }
    // server.close() fires the 'close' handler registered in ensureServer(),
    // which clears server.json + releases the lock; draining in-flight requests.
    // Tunnels are torn down before the process exits, and awaited. A cloudflared
    // child outlives its parent, so exiting without waiting leaves a public
    // endpoint up with nothing tracking it. stopAll() resolves only once each
    // child has actually exited (SIGTERM, escalating to SIGKILL), so this is the
    // one place that can guarantee it; startup reaping is the backstop for a
    // daemon that was killed outright.
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      if (drainer) drainer.stop();
      publications.stopAll()
        .catch(() => { /* reaped by clearStale on the next start */ })
        .then(() => server.close(() => process.exit(0)));
    };
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
  }).catch((err) => {
    console.error(`daemon failed to start: ${err.message}`);
    process.exit(1);
  });
}
