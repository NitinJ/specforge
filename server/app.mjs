// SpecForge review server (Stage 2): index, serve-with-injection, SSE live-reload.
// Zero dependencies — Node built-ins only.

import http from 'node:http';
import { readFileSync, watch } from 'node:fs';
import { buildIndex, resolveSpec } from '../lib/paths.mjs';
import { getTitle, getStatus } from '../lib/spec.mjs';
import { injectReviewLayer } from './inject.mjs';
import { serveStatic } from './static.mjs';
import {
  sendJson, readJsonBody, handleCommentsGet, handleCommentCreate,
  handleCommentReply, handleCommentResolve, handleSubmit, handleAwait,
} from './api.mjs';

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

function renderIndex(specsDir) {
  const items = buildIndex(specsDir);
  const rows = items.map((s) =>
    `<li><a href="/spec/${s.id}">${esc(s.title)}</a> <span class="s">${esc(s.status)}</span>` +
    `<div class="p">${esc(s.relPath)}</div></li>`
  ).join('\n');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>SpecForge</title>
<style>
  body{margin:0;background:#0f1115;color:#e6e8ee;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:760px;margin:0 auto;padding:48px 24px}
  h1{font-size:22px} h1 span{color:#6ea8fe}
  .sub{color:#9aa3b2;font-size:14px;margin-bottom:24px}
  ul{list-style:none;padding:0} li{border:1px solid #2a2f3a;border-radius:10px;padding:12px 16px;margin:10px 0;background:#171a21}
  a{color:#e6e8ee;text-decoration:none;font-weight:600} a:hover{color:#6ea8fe}
  .s{color:#6ea8fe;font-size:11.5px;border:1px solid #2a2f3a;border-radius:999px;padding:1px 8px;margin-left:6px}
  .p{color:#9aa3b2;font-size:12px;margin-top:4px;font-family:ui-monospace,Menlo,monospace}
  .empty{color:#9aa3b2}
</style></head><body><div class="wrap">
<h1><span>Spec</span>Forge</h1>
<div class="sub">${items.length} spec${items.length === 1 ? '' : 's'} in ${esc(specsDir)}</div>
${items.length ? `<ul>\n${rows}\n</ul>` : '<p class="empty">No specs found yet. Create one with create-spec.</p>'}
</div></body></html>`;
}

function serveSpec(specsDir, id, res) {
  const spec = resolveSpec(specsDir, id);
  if (!spec) return send(res, 404, 'text/plain; charset=utf-8', 'spec not found');
  let html;
  try {
    html = readFileSync(spec.file, 'utf8');
  } catch {
    return send(res, 404, 'text/plain; charset=utf-8', 'spec not readable');
  }
  send(res, 200, 'text/html; charset=utf-8', injectReviewLayer(html, { specId: id }));
}

function serveEvents(specsDir, id, req, res) {
  const spec = resolveSpec(specsDir, id);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  let closed = false;
  // Guarded write: never touch the response after cleanup (a watcher callback may
  // still be queued when the socket is already gone).
  const safeWrite = (chunk) => {
    if (closed) return;
    try {
      res.write(chunk);
    } catch {
      closed = true;
    }
  };

  let debounce = null;
  let watcher = null;
  if (spec) {
    try {
      watcher = watch(spec.file, () => {
        if (closed) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => safeWrite('event: reload\ndata: {}\n\n'), 100);
        debounce.unref?.();
      });
    } catch {
      watcher = null;
    }
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
 * Create the review server.
 * @param {{specsDir:string}} config
 * @returns {import('node:http').Server}
 */
export function createApp(config) {
  const specsDir = config.specsDir;
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;

    // --- Comments API ---
    const list = path.match(/^\/api\/spec\/([\w-]+)\/comments$/);
    if (list) {
      if (method === 'GET') return handleCommentsGet(specsDir, list[1], res);
      if (method === 'POST') {
        return readJsonBody(req)
          .then((b) => handleCommentCreate(specsDir, list[1], b, res))
          .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    const submit = path.match(/^\/api\/spec\/([\w-]+)\/comments\/submit$/);
    if (submit) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleSubmit(specsDir, submit[1], res);
    }
    const awaitReview = path.match(/^\/api\/spec\/([\w-]+)\/await$/);
    if (awaitReview) {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      const t = Number(url.searchParams.get('timeout'));
      const timeoutMs = Number.isFinite(t) && t >= 0 ? Math.min(t, 60000) : 25000;
      return handleAwait(specsDir, awaitReview[1], timeoutMs, res);
    }
    const reply = path.match(/^\/api\/spec\/([\w-]+)\/comments\/([\w-]+)\/reply$/);
    if (reply) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleCommentReply(specsDir, reply[1], reply[2], b, res))
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const resolve = path.match(/^\/api\/spec\/([\w-]+)\/comments\/([\w-]+)\/resolve$/);
    if (resolve) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleCommentResolve(specsDir, resolve[1], resolve[2], res);
    }

    // --- GET-only routes ---
    if (method === 'GET') {
      if (path === '/') return send(res, 200, 'text/html; charset=utf-8', renderIndex(specsDir));
      if (path === '/healthz') return send(res, 200, 'text/plain; charset=utf-8', 'ok');
      if (path === '/events') return serveEvents(specsDir, url.searchParams.get('spec') || '', req, res);
      const sm = path.match(/^\/spec\/([\w-]+)$/);
      if (sm) return serveSpec(specsDir, sm[1], res);
      const pub = path.match(/^\/public\/([\w.-]+)$/);
      if (pub) return serveStatic(pub[1], res);
    }

    return send(res, 404, 'text/plain; charset=utf-8', 'not found');
  });
}

// re-export for callers/tests
export { getTitle, getStatus };
