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
import { listSpecs, DEFAULT_TYPE } from '../lib/meta.mjs';
import { sessionDisplay } from '../lib/session-label.mjs';
import { readGlobalPrefs } from '../lib/global-prefs.mjs';
import { isStale } from '../lib/attach.mjs';
import { readSpecHtml, specHtmlPath } from '../lib/store.mjs';
import { injectReviewLayer } from './inject.mjs';
import { serveStatic } from './static.mjs';
import {
  readServerState, writeServerState, clearServerState,
  acquireLock, releaseLock, lockHolderPid, isAlive, healthOk,
} from '../lib/daemon-state.mjs';
import {
  sendJson, readJsonBody, handleCommentsGet, handleCommentCreate,
  handleCommentReply, handleCommentResolve, handleCommentEdit, handleSubmit,
  handleMeta, handleStatus, handleResolveAll, handleDetach,
  handlePrefsGet, handlePrefsPut, handleGlobalPrefsGet, handleGlobalPrefsPut,
  handleRename, handleOrganize, handleExport,
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

/** Order specs into collection groups: named collections (alpha) then Uncollected. */
function groupByCollection(specs) {
  const groups = new Map();
  for (const m of specs) {
    const key = m.collection || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const named = [...groups.keys()].filter((k) => k !== '')
    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  const order = groups.has('') ? [...named, ''] : named;
  return { order: order.map((k) => ({ key: k, specs: groups.get(k) })), named };
}

/** One spec row, with rename / tag / collection controls. */
function rowHtml(m) {
  const id = esc(m.id);
  const titleRaw = m.title || 'Untitled';
  const title = esc(titleRaw);
  const rawType = m.type || DEFAULT_TYPE;
  const rawStatus = m.status || 'draft';
  const att = attachedLabel(m);
  const tags = Array.isArray(m.tags) ? m.tags : [];
  const coll = m.collection || '';
  // lowercase haystack for search — RAW values (single outer esc() encodes once).
  const key = esc(`${m.id} ${titleRaw} ${rawType} ${rawStatus} ${m.attachedSession ? sessionDisplay(m) : 'free'} ${tags.join(' ')} ${coll}`.toLowerCase());
  const chips = tags.map((t) => `<span class="chip" data-tag="${esc(t)}">${esc(t)}<button class="x" type="button" title="Remove tag" aria-label="Remove tag">×</button></span>`).join('');
  return `<tr data-k="${key}" data-id="${id}">
  <td class="spec">
    <div class="titlerow"><a class="title" href="/spec/${id}">${title}</a><button class="rename" type="button" title="Rename" aria-label="Rename">✎</button><input class="rename-in" type="text" value="${esc(titleRaw)}" aria-label="New name" hidden></div>
    <div class="id">${id}</div>
    <div class="tags">${chips}<button class="addtag" type="button" title="Add tag">+ tag</button><input class="addtag-in" type="text" placeholder="tag…" aria-label="Add tag" hidden></div>
  </td>
  <td><span class="badge t">${esc(rawType)}</span></td>
  <td><span class="badge s s-${esc(rawStatus)}">${esc(rawStatus)}</span></td>
  <td class="att">${att}</td>
  <td class="link">${m.attachedSession ? (isStale(m) ? '<span class="off">● disconnected</span>' : '<span class="live">● live</span>') : ''}</td>
  <td class="upd">${esc(relativeTime(m.updated))}</td>
  <td><input class="coll" list="collections" value="${esc(coll)}" placeholder="Uncollected" aria-label="Collection"></td>
</tr>`;
}

export function renderIndex() {
  const theme = readGlobalPrefs().theme === 'dark' ? 'dark' : 'light';
  const specs = listSpecs().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const n = specs.length;
  const { order, named } = groupByCollection(specs);
  const datalist = `<datalist id="collections">${named.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>`;
  const groups = order.map(({ key, specs: list }) => `<section class="grp">
  <h2>${key === '' ? 'Uncollected' : esc(key)} <span class="gcount">${list.length}</span></h2>
  <div class="card"><table><tbody>${list.map(rowHtml).join('\n')}</tbody></table></div>
</section>`).join('\n');
  return `<!DOCTYPE html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>SpecForge</title>
<style>
  :root[data-theme="light"]{--bg:#fbfaf7;--panel:#fff;--ink:#1f2329;--muted:#5c6470;--line:#e6e3dc;--accent:#2f6feb;--green:#1a7f37;--amber:#9a6700;--red:#cf222e;--row:#fff}
  :root[data-theme="dark"]{--bg:#0f1115;--panel:#161922;--ink:#e6e8ee;--muted:#9aa3b2;--line:#2a2f3a;--accent:#6ea8fe;--green:#3fb950;--amber:#d29922;--red:#f85149;--row:#161922}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:1280px;margin:0 auto;padding:40px 24px 64px}
  td.spec{width:60%}
  header{display:flex;align-items:center;gap:16px;flex-wrap:wrap;margin-bottom:20px}
  h1{font-size:22px;margin:0;font-weight:700} h1 span{color:var(--accent)}
  .count{color:var(--muted);font-size:13px}
  .spacer{flex:1}
  .search{flex:1;min-width:160px;max-width:320px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);font-size:14px}
  .search:focus{outline:none;border-color:var(--accent)}
  .toggle{padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--panel);color:var(--ink);font-size:13px;cursor:pointer}
  .toggle:hover{border-color:var(--accent)}
  .grp{margin-bottom:22px}
  .grp h2{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600;margin:0 0 8px 2px}
  .grp h2 .gcount{opacity:.65;font-weight:400;margin-left:4px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;overflow:hidden}
  table{border-collapse:collapse;width:100%}
  td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--line);vertical-align:top}
  tr:last-child td{border-bottom:none}
  tbody tr:hover{background:color-mix(in srgb,var(--accent) 7%,transparent)}
  a{color:var(--ink);text-decoration:none;font-weight:600} a:hover{color:var(--accent)}
  .titlerow{display:flex;align-items:center;gap:6px}
  .rename{background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;opacity:0;transition:opacity .1s;padding:0}
  tr:hover .rename{opacity:1} .rename:hover{color:var(--accent)}
  .rename-in{padding:4px 8px;border:1px solid var(--accent);border-radius:6px;background:var(--bg);color:var(--ink);font:inherit;font-size:14px;min-width:220px}
  .spec .id{font-family:ui-monospace,Menlo,monospace;font-size:11.5px;color:var(--muted);font-weight:400;margin-top:2px}
  .tags{display:flex;flex-wrap:wrap;gap:4px;align-items:center;margin-top:5px}
  .chip{display:inline-flex;align-items:center;gap:3px;font-size:11px;background:color-mix(in srgb,var(--accent) 10%,transparent);border:1px solid color-mix(in srgb,var(--accent) 25%,var(--line));border-radius:999px;padding:1px 4px 1px 8px}
  .chip .x{background:none;border:none;color:var(--muted);cursor:pointer;font-size:13px;line-height:1;padding:0} .chip .x:hover{color:var(--red)}
  .addtag{font-size:11px;color:var(--muted);background:none;border:1px dashed var(--line);border-radius:999px;padding:1px 8px;cursor:pointer} .addtag:hover{color:var(--accent);border-color:var(--accent)}
  .addtag-in{font-size:12px;padding:2px 8px;border:1px solid var(--accent);border-radius:999px;background:var(--bg);color:var(--ink);width:110px}
  .badge{display:inline-block;font-size:11.5px;border:1px solid var(--line);border-radius:999px;padding:1px 9px;color:var(--muted);white-space:nowrap}
  .s{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 40%,var(--line))}
  .s-approved,.s-done{color:var(--green);border-color:color-mix(in srgb,var(--green) 40%,var(--line))}
  .s-in_review{color:var(--amber);border-color:color-mix(in srgb,var(--amber) 40%,var(--line))}
  .s-draft,.s-closed{color:var(--muted);border-color:var(--line)}
  .att{color:var(--muted);font-size:13px} .upd{color:var(--muted);font-size:13px;white-space:nowrap}
  .link{font-size:12.5px;white-space:nowrap} .link .live{color:var(--green)} .link .off{color:var(--muted)}
  .coll{width:130px;padding:5px 8px;border:1px solid var(--line);border-radius:6px;background:var(--panel);color:var(--ink);font-size:12.5px}
  .coll:focus{outline:none;border-color:var(--accent)}
  .empty{color:var(--muted);padding:48px 0;text-align:center}
  #nohits{display:none;color:var(--muted);padding:32px 0;text-align:center}
  @media(max-width:680px){.upd,.att{display:none}}
</style></head><body><div class="wrap">
<header>
  <h1><span>Spec</span>Forge</h1>
  <span class="count" id="count">${n} spec${n === 1 ? '' : 's'}</span>
  <span class="spacer"></span>
  <input class="search" id="search" type="search" placeholder="Search specs, tags, collections…" autocomplete="off" aria-label="Search">
  <button class="toggle" id="theme" type="button" aria-label="Toggle theme">${theme === 'dark' ? '☾ Dark' : '☀ Light'}</button>
</header>
${n ? `${datalist}\n<div id="groups">${groups}</div>\n<div id="nohits">No specs match your search.</div>`
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

  function api(id,path,method,body){return fetch('/api/spec/'+encodeURIComponent(id)+path,{method:method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
  function tr(el){return el.closest('tr');}
  function tagsOf(row){return [].slice.call(row.querySelectorAll('.chip')).map(function(c){return c.getAttribute('data-tag');});}
  // Keep the search haystack in sync after an in-place edit (rename / tags) — else
  // a search for the new name/tag wouldn't match the row until a reload.
  function updateKey(row){
    row.setAttribute('data-k',[row.getAttribute('data-id'),
      row.querySelector('.title').textContent,
      row.querySelector('.badge.t').textContent,
      row.querySelector('.badge.s').textContent,
      row.querySelector('.att').textContent,
      tagsOf(row).join(' '),
      row.querySelector('.coll').value].join(' ').toLowerCase());
  }
  function endRename(row){row.querySelector('.title').hidden=false;row.querySelector('.rename').hidden=false;row.querySelector('.rename-in').hidden=true;}
  function endAddTag(row){row.querySelector('.addtag').hidden=false;row.querySelector('.addtag-in').hidden=true;}
  function paintChips(row,tags){
    var box=row.querySelector('.tags'), add=box.querySelector('.addtag');
    [].slice.call(box.querySelectorAll('.chip')).forEach(function(c){c.remove();});
    tags.forEach(function(t){
      var s=document.createElement('span'); s.className='chip'; s.setAttribute('data-tag',t); s.textContent=t;
      var x=document.createElement('button'); x.type='button'; x.className='x'; x.title='Remove tag'; x.setAttribute('aria-label','Remove tag'); x.textContent='\\u00d7';
      s.appendChild(x); box.insertBefore(s,add);
    });
  }

  document.addEventListener('click',function(e){
    var t=e.target;
    if(t.classList.contains('rename')){var r=tr(t);r.querySelector('.title').hidden=true;t.hidden=true;var i=r.querySelector('.rename-in');i.hidden=false;i.focus();i.select();}
    else if(t.classList.contains('addtag')){var r2=tr(t);t.hidden=true;var a=r2.querySelector('.addtag-in');a.hidden=false;a.value='';a.focus();}
    else if(t.classList.contains('x')){var r3=tr(t),chip=t.closest('.chip'),id=r3.getAttribute('data-id');
      var next=tagsOf(r3).filter(function(x){return x!==chip.getAttribute('data-tag');});
      api(id,'/organize','PATCH',{tags:next}).then(function(){chip.remove();updateKey(r3);}).catch(function(){});}
  });

  document.addEventListener('keydown',function(e){
    var t=e.target;
    if(t.classList.contains('rename-in')){
      if(e.key==='Enter'){var r=tr(t),id=r.getAttribute('data-id'),v=t.value.trim();if(!v){endRename(r);return;}
        api(id,'/rename','POST',{title:v}).then(function(x){return x.ok?x.json():null;}).then(function(d){if(d){r.querySelector('.title').textContent=d.title;t.value=d.title;updateKey(r);}endRename(r);}).catch(function(){endRename(r);});}
      else if(e.key==='Escape'){endRename(tr(t));}
    } else if(t.classList.contains('addtag-in')){
      if(e.key==='Enter'){var r2=tr(t),id2=r2.getAttribute('data-id'),v2=t.value.trim(),cur=tagsOf(r2);
        if(v2 && cur.map(function(x){return x.toLowerCase();}).indexOf(v2.toLowerCase())===-1){
          api(id2,'/organize','PATCH',{tags:cur.concat([v2])}).then(function(x){return x.ok?x.json():null;}).then(function(d){if(d){paintChips(r2,d.tags);updateKey(r2);}endAddTag(r2);}).catch(function(){endAddTag(r2);});
        } else {endAddTag(r2);}}
      else if(e.key==='Escape'){endAddTag(tr(t));}
    }
  });

  // Reassign collection → reload to regroup under the right header.
  document.addEventListener('change',function(e){
    if(e.target.classList.contains('coll')){var r=tr(e.target),id=r.getAttribute('data-id');
      api(id,'/organize','PATCH',{collection:e.target.value}).then(function(){location.reload();}).catch(function(){});}
  });

  var search=document.getElementById('search'), count=document.getElementById('count'), nohits=document.getElementById('nohits');
  var rows=[].slice.call(document.querySelectorAll('tr[data-id]')), total=rows.length;
  var grps=[].slice.call(document.querySelectorAll('.grp'));
  if(search) search.oninput=function(){
    var q=search.value.trim().toLowerCase(), shown=0;
    rows.forEach(function(r){var hit=!q||r.getAttribute('data-k').indexOf(q)!==-1;r.style.display=hit?'':'none';if(hit)shown++;});
    grps.forEach(function(g){
      var vis=[].slice.call(g.querySelectorAll('tr[data-id]')).filter(function(r){return r.style.display!=='none';}).length;
      var gc=g.querySelector('.gcount'); if(gc) gc.textContent=vis; // track the visible count
      g.style.display=vis?'':'none';
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
    const editC = path.match(/^\/api\/spec\/([\w-]+)\/comments\/([\w-]+)\/comment\/([\w-]+)$/);
    if (editC) {
      if (method !== 'PATCH') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleCommentEdit(editC[1], editC[2], editC[3], b, res))
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
