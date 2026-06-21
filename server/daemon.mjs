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
//   POST /api/spec/<id>/comments/<tid>/resolve  → resolve a thread (human)
//
// ensureServer() (below) is the singleton entrypoint every v2 command calls:
// reuse a healthy daemon if one is advertised, else acquire the lock, bind a
// port with fall-forward, write server.json, and return the URL.

import http from 'node:http';
import { watch } from 'node:fs';
import { listSpecs, DEFAULT_TYPE } from '../lib/meta.mjs';
import { readSpecHtml, specHtmlPath } from '../lib/store.mjs';
import { injectReviewLayer } from './inject.mjs';
import { serveStatic } from './static.mjs';
import {
  readServerState, writeServerState, clearServerState,
  acquireLock, releaseLock, lockHolderPid, isAlive, healthOk,
} from '../lib/daemon-state.mjs';
import {
  sendJson, readJsonBody, handleCommentsGet, handleCommentCreate,
  handleCommentReply, handleCommentResolve, handleSubmit,
  handleMeta, handleStatus, handleResolveAll, handleDetach,
  handlePrefsGet, handlePrefsPut,
} from '../lib/store-api.mjs';
import { createDaemonDrain } from '../lib/store-watch.mjs';

const DEFAULT_PORT = 4180;
const PORT_RETRY_LIMIT = 20; // up to 20 retries after the first attempt = 21 ports probed

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

/** "attached?" cell: 'session abc12345' when owned, 'free' otherwise. */
function attachedLabel(meta) {
  return meta.attachedSession
    ? `session ${esc(String(meta.attachedSession).slice(0, 8))}`
    : 'free';
}

function renderIndex() {
  const specs = listSpecs().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const rows = specs.map((m) => {
    const id = esc(m.id);
    const title = esc(m.title || 'Untitled');
    return `<tr>
  <td class="id"><a href="/spec/${id}">${id}</a></td>
  <td><a href="/spec/${id}">${title}</a></td>
  <td><span class="t">${esc(m.type || DEFAULT_TYPE)}</span></td>
  <td><span class="s">${esc(m.status || 'draft')}</span></td>
  <td class="att">${attachedLabel(m)}</td>
</tr>`;
  }).join('\n');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>SpecForge</title>
<style>
  body{margin:0;background:#0f1115;color:#e6e8ee;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:880px;margin:0 auto;padding:48px 24px}
  h1{font-size:22px;margin:0 0 4px} h1 span{color:#6ea8fe}
  .sub{color:#9aa3b2;font-size:14px;margin-bottom:24px}
  table{border-collapse:collapse;width:100%}
  th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #2a2f3a;vertical-align:top}
  th{color:#9aa3b2;font-size:12px;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
  a{color:#e6e8ee;text-decoration:none;font-weight:600} a:hover{color:#6ea8fe}
  .id a{font-family:ui-monospace,Menlo,monospace;font-weight:500;color:#9aa3b2}
  .s{color:#6ea8fe;font-size:11.5px;border:1px solid #2a2f3a;border-radius:999px;padding:1px 8px}
  .t{color:#9aa3b2;font-size:11.5px;border:1px solid #2a2f3a;border-radius:999px;padding:1px 8px}
  .att{color:#9aa3b2;font-size:13px;font-family:ui-monospace,Menlo,monospace}
  .empty{color:#9aa3b2}
</style></head><body><div class="wrap">
<h1><span>Spec</span>Forge</h1>
<div class="sub">${specs.length} spec${specs.length === 1 ? '' : 's'} in the store</div>
${specs.length
    ? `<table>
<thead><tr><th>id</th><th>title</th><th>type</th><th>status</th><th>attached?</th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`
    : '<p class="empty">No specs yet. Create one with the create command.</p>'}
</div></body></html>`;
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

/** SSE live-reload: push a `reload` event whenever the spec's spec.html changes. */
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
  try {
    watcher = watch(specHtmlPath(id), () => {
      if (closed) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => safeWrite('event: reload\ndata: {}\n\n'), 100);
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
      return handleMeta(meta[1], res);
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
    const det = path.match(/^\/api\/spec\/([\w-]+)\/detach$/);
    if (det) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleDetach(det[1], res);
    }

    if (method === 'GET') {
      if (path === '/healthz') return send(res, 200, 'text/plain; charset=utf-8', 'ok');
      if (path === '/') return send(res, 200, 'text/html; charset=utf-8', renderIndex());
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

  // 3. We hold the lock — bind and advertise.
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

  let cleaned = false;
  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
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
    const shutdown = () => {
      if (drainer) drainer.stop();
      server.close(() => process.exit(0));
    };
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
  }).catch((err) => {
    console.error(`daemon failed to start: ${err.message}`);
    process.exit(1);
  });
}
