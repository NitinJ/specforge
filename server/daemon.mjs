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
//   GET/PUT  /api/spec/<id>/prefs               → per-spec UI prefs (theme/width/filter)
//   GET/PUT  /api/prefs                         → store-wide UI prefs (index theme)
//
// ensureServer() (below) is the singleton entrypoint every v2 command calls:
// reuse a healthy daemon if one is advertised, else acquire the lock, bind a
// port with fall-forward, write server.json, and return the URL.

import http from 'node:http';
import { watch } from 'node:fs';
import { listSpecs, DEFAULT_TYPE } from '../lib/meta.mjs';
import { sessionDisplay } from '../lib/session-label.mjs';
import { readGlobalPrefs } from '../lib/global-prefs.mjs';
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
  handlePrefsGet, handlePrefsPut, handleGlobalPrefsGet, handleGlobalPrefsPut,
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

/** "attached?" cell: the friendly session label (folder · "prompt") when owned, 'free' otherwise. */
function attachedLabel(meta) {
  return meta.attachedSession ? esc(sessionDisplay(meta)) : 'free';
}

/** Compact "x ago" for the Updated column (empty when unknown). */
function relativeTime(ms, now = Date.now()) {
  if (!ms) return '';
  const s = Math.max(0, Math.floor((now - ms) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}

export function renderIndex() {
  const theme = readGlobalPrefs().theme === 'dark' ? 'dark' : 'light';
  const specs = listSpecs().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const rows = specs.map((m) => {
    const id = esc(m.id);
    const title = esc(m.title || 'Untitled');
    const rawType = m.type || DEFAULT_TYPE;
    const rawStatus = m.status || 'draft';
    const type = esc(rawType);
    const status = esc(rawStatus);
    const att = attachedLabel(m);
    // lowercase haystack for the client-side search filter — built from RAW values
    // (the single outer esc() encodes once; pre-escaping would double-encode).
    const key = esc(`${m.id} ${m.title || ''} ${rawType} ${rawStatus} ${m.attachedSession ? sessionDisplay(m) : 'free'}`.toLowerCase());
    return `<tr data-k="${key}">
  <td class="spec"><a href="/spec/${id}">${title}</a><div class="id">${id}</div></td>
  <td><span class="badge t">${type}</span></td>
  <td><span class="badge s s-${status}">${status}</span></td>
  <td class="att">${att}</td>
  <td class="upd">${esc(relativeTime(m.updated))}</td>
</tr>`;
  }).join('\n');
  const n = specs.length;
  return `<!DOCTYPE html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>SpecForge</title>
<style>
  :root[data-theme="light"]{--bg:#fbfaf7;--panel:#fff;--ink:#1f2329;--muted:#5c6470;--line:#e6e3dc;--accent:#2f6feb;--green:#1a7f37;--amber:#9a6700;--row:#fff}
  :root[data-theme="dark"]{--bg:#0f1115;--panel:#161922;--ink:#e6e8ee;--muted:#9aa3b2;--line:#2a2f3a;--accent:#6ea8fe;--green:#3fb950;--amber:#d29922;--row:#161922}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:960px;margin:0 auto;padding:40px 24px 64px}
  header{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:20px}
  h1{font-size:22px;margin:0;font-weight:700} h1 span{color:var(--accent)}
  .count{color:var(--muted);font-size:13px}
  .spacer{flex:1}
  .search{flex:1;min-width:160px;max-width:320px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);font-size:14px}
  .search:focus{outline:none;border-color:var(--accent)}
  .toggle{padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);font-size:13px;cursor:pointer}
  .toggle:hover{border-color:var(--accent)}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  table{border-collapse:collapse;width:100%}
  th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top}
  tr:last-child td{border-bottom:none}
  th{color:var(--muted);font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
  tbody tr:hover{background:color-mix(in srgb,var(--accent) 7%,transparent)}
  a{color:var(--ink);text-decoration:none;font-weight:600} a:hover{color:var(--accent)}
  .spec .id{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--muted);font-weight:400;margin-top:2px}
  .badge{display:inline-block;font-size:11.5px;border:1px solid var(--line);border-radius:999px;padding:1px 9px;color:var(--muted);white-space:nowrap}
  .s{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 40%,var(--line))}
  .s-approved,.s-done{color:var(--green);border-color:color-mix(in srgb,var(--green) 40%,var(--line))}
  .s-in_review{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 40%,var(--line))}
  .s-draft,.s-closed{color:var(--muted);border-color:var(--line)}
  .att{color:var(--muted);font-size:13px} .upd{color:var(--muted);font-size:13px;white-space:nowrap}
  .empty{color:var(--muted);padding:48px 0;text-align:center}
  #nohits{display:none;color:var(--muted);padding:32px 0;text-align:center}
  @media(max-width:640px){.upd,th.upd-h{display:none}}
</style></head><body><div class="wrap">
<header>
  <h1><span>Spec</span>Forge</h1>
  <span class="count" id="count">${n} spec${n === 1 ? '' : 's'}</span>
  <span class="spacer"></span>
  <input class="search" id="search" type="search" placeholder="Search specs…" autocomplete="off" aria-label="Search specs">
  <button class="toggle" id="theme" type="button" aria-label="Toggle theme">${theme === 'dark' ? '☾ Dark' : '☀ Light'}</button>
</header>
${n
    ? `<div class="card"><table>
<thead><tr><th>spec</th><th>type</th><th>status</th><th>session</th><th class="upd-h">updated</th></tr></thead>
<tbody id="rows">
${rows}
</tbody>
</table></div>
<div id="nohits">No specs match your search.</div>`
    : '<p class="empty">No specs yet. Create one with <code>/specforge:create</code>.</p>'}
</div>
<script>
(function(){
  var root=document.documentElement, btn=document.getElementById('theme');
  if(btn) btn.onclick=function(){
    var next=root.getAttribute('data-theme')==='dark'?'light':'dark';
    root.setAttribute('data-theme',next);
    btn.textContent=next==='dark'?'\\u263e Dark':'\\u2600 Light';
    try{fetch('/api/prefs',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:next})}).catch(function(){});}catch(e){}
  };
  var search=document.getElementById('search'), count=document.getElementById('count'), nohits=document.getElementById('nohits');
  var rows=[].slice.call(document.querySelectorAll('#rows tr')), total=rows.length;
  if(search) search.oninput=function(){
    var q=search.value.trim().toLowerCase(), shown=0;
    rows.forEach(function(r){
      var hit=!q||r.getAttribute('data-k').indexOf(q)!==-1;
      r.style.display=hit?'':'none'; if(hit) shown++;
    });
    if(count) count.textContent=q?(shown+' of '+total):(total+' spec'+(total===1?'':'s'));
    if(nohits) nohits.style.display=shown?'none':'block';
  };
})();
</script>
</body></html>`;
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
