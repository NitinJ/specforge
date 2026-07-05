// SpecForge index (home) page — server-rendered, single string, no build step.
// Design: docs in the PR — Linear/Notion-grade dense list, collections as the
// primary grouping, status chips + type/sort controls, protected template specs
// in a bottom strip. All state is in-memory; everything inlined (CSP-friendly).

import { listSpecs, DEFAULT_TYPE } from '../lib/meta.mjs';
import { sessionDisplay } from '../lib/session-label.mjs';
import { readGlobalPrefs } from '../lib/global-prefs.mjs';
import { isStale } from '../lib/attach.mjs';

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** "attached?" label: the friendly session label when owned, 'free' otherwise. */
function attachedLabel(meta) {
  return meta.attachedSession ? esc(sessionDisplay(meta)) : 'free';
}

/** Compact "x ago" for the updated stamp (empty when unknown). */
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

/** Working specs grouped: named collections (alpha), then Uncollected. */
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

const STATUSES = ['draft', 'in_review', 'approved', 'implementing', 'done', 'closed'];
const label = (s) => s.replace(/_/g, ' ');

/** One working-spec row. */
function rowHtml(m) {
  const id = esc(m.id);
  const titleRaw = m.title || 'Untitled';
  const title = esc(titleRaw);
  const rawType = m.type || DEFAULT_TYPE;
  const rawStatus = m.status || 'draft';
  const att = attachedLabel(m);
  const tags = Array.isArray(m.tags) ? m.tags : [];
  const coll = m.collection || '';
  const key = esc(`${m.id} ${titleRaw} ${rawType} ${rawStatus} ${m.attachedSession ? sessionDisplay(m) : 'free'} ${tags.join(' ')} ${coll}`.toLowerCase());
  const chips = tags.map((t) => `<span class="chip" data-tag="${esc(t)}">${esc(t)}<button class="x" type="button" title="Remove tag" aria-label="Remove tag">×</button></span>`).join('');
  const live = m.attachedSession
    ? (isStale(m) ? '<span class="off" title="' + att + '">○ disconnected</span>' : '<span class="live" title="' + att + '"><span class="dot"></span> live</span>')
    : '';
  const edge = m.attachedSession ? (isStale(m) ? ' edge-off' : ' edge-live') : '';
  return `<li class="row${edge}" data-k="${key}" data-id="${id}" data-s="${esc(rawStatus)}" data-t="${esc(rawType)}" data-u="${m.updated || 0}">
  <div class="main">
    <div class="titlerow"><a class="title" href="/spec/${id}">${title}</a><button class="rename" type="button" title="Rename" aria-label="Rename">✎</button><input class="rename-in" type="text" value="${esc(titleRaw)}" aria-label="New name" hidden></div>
    <div class="sub"><span class="id">${id}</span><span class="att" hidden>${att}</span><span class="tags">${chips}<button class="addtag" type="button" title="Add tag">+ tag</button><input class="addtag-in" type="text" placeholder="tag…" aria-label="Add tag" hidden></span></div>
  </div>
  <div class="meta">
    <div class="l1"><span class="badge t">${esc(rawType)}</span><span class="badge s s-${esc(rawStatus)}"><span class="sdot"></span>${esc(label(rawStatus))}</span></div>
    <div class="l2">${live}<span class="upd">${esc(relativeTime(m.updated))}</span><button class="collbtn" type="button" title="Move to collection" aria-label="Move to collection">▣</button><input class="coll" list="collections" value="${esc(coll)}" placeholder="Uncollected" aria-label="Collection" hidden></div>
  </div>
</li>`;
}

/** One protected template card (bottom strip). */
function tplCard(m) {
  const id = esc(m.id);
  return `<a class="tcard" href="/spec/${id}" data-id="${id}">
  <span class="tname">${esc(m.title || id)}</span>
  <span class="trow"><span class="badge t">${esc(m.type || DEFAULT_TYPE)}</span><span class="badge tpl">template</span></span>
</a>`;
}

export function renderIndex() {
  const theme = readGlobalPrefs().theme === 'dark' ? 'dark' : 'light';
  const all = listSpecs().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const tpls = all.filter((m) => m.template);
  const specs = all.filter((m) => !m.template);
  const n = specs.length;
  const { order, named } = groupByCollection(specs);
  const datalist = `<datalist id="collections">${named.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>`;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, specs.filter((m) => (m.status || 'draft') === s).length]));
  const chipsBar = ['all', ...STATUSES].map((s) => {
    const c = s === 'all' ? n : counts[s];
    return `<button class="fchip${s === 'all' ? ' on' : ''}${s !== 'all' && !c ? ' zero' : ''}" type="button" data-f="${s}">${s === 'all' ? 'All' : esc(label(s))}<span class="fc">${c}</span></button>`;
  }).join('');
  const groups = order.map(({ key, specs: list }) => `<section class="grp" data-coll="${esc(key)}">
  <h2>${key === '' ? 'Uncollected' : esc(key)} <span class="gcount">${list.length}</span></h2>
  <div class="card"><ul class="rows">${list.map(rowHtml).join('\n')}</ul></div>
</section>`).join('\n');
  const strip = tpls.length ? `<section class="tpls">
  <h2>Templates <span class="gcount">${tpls.length}</span></h2>
  <div class="tstrip">${tpls.map(tplCard).join('\n')}</div>
</section>` : '';

  return `<!DOCTYPE html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>SpecForge</title>
<style>
  :root[data-theme="light"]{
    --bg:#faf9f6;--surface:#ffffff;--surface2:#f3f1ec;--ink:#1c2024;--muted:#6b7280;--faint:#9aa1ab;
    --line:#e7e4dd;--line2:#d5d1c8;--accent:#4f46e5;--accent-soft:#eef0fd;--live:#16a34a;
    --s-draft:#6b7280;--s-in_review:#b45309;--s-approved:#0d9488;--s-implementing:#4f46e5;--s-done:#16a34a;--s-closed:#9aa1ab;
    --shadow:0 1px 2px rgba(28,32,36,.05),0 4px 12px rgba(28,32,36,.04);
    /* review-layer compat: pages sometimes read these generic names */
    --panel:var(--surface);--green:var(--live);--amber:#b45309;--red:#cf222e
  }
  :root[data-theme="dark"]{
    --bg:#101114;--surface:#17181c;--surface2:#1f2126;--ink:#e8eaed;--muted:#9aa1ab;--faint:#6b7280;
    --line:#26282e;--line2:#34373f;--accent:#818cf8;--accent-soft:#232441;--live:#4ade80;
    --s-draft:#9aa1ab;--s-in_review:#e5a54b;--s-approved:#2dd4bf;--s-implementing:#818cf8;--s-done:#4ade80;--s-closed:#6b7280;
    --shadow:none;
    --panel:var(--surface);--green:var(--live);--amber:#e5a54b;--red:#f85149
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif}
  a{color:inherit;text-decoration:none}
  button{font:inherit;color:inherit}
  .wrap{max-width:1040px;margin:0 auto;padding:0 32px 64px}
  @media(max-width:960px){.wrap{padding:0 24px 48px}}

  /* sticky header + toolbar */
  .top{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 86%,transparent);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
  .topin{max-width:1040px;margin:0 auto;padding:0 32px}
  @media(max-width:960px){.topin{padding:0 24px}}
  header{display:flex;align-items:center;gap:16px;height:56px}
  .brand{display:flex;align-items:center;gap:9px;font-size:17px;font-weight:650;letter-spacing:-.01em}
  .brand svg{color:var(--accent);flex:none}
  .spacer{flex:1}
  .searchbox{position:relative;display:flex;align-items:center}
  .searchbox svg{position:absolute;left:10px;color:var(--faint);pointer-events:none}
  .search{width:280px;min-width:180px;height:36px;padding:0 34px 0 32px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font-size:13.5px}
  :root[data-theme="dark"] .search{background:var(--surface2)}
  .search:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
  .skey{position:absolute;right:9px;font:11px ui-monospace,Menlo,monospace;color:var(--faint);border:1px solid var(--line);border-radius:4px;padding:0 5px;pointer-events:none}
  .search:focus~.skey,.search:not(:placeholder-shown)~.skey{display:none}
  .toggle{width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:none;border:none;border-radius:8px;color:var(--muted);cursor:pointer}
  .toggle:hover{background:var(--surface2);color:var(--ink)}
  .toolbar{display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 0 12px}
  .fchip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border-radius:999px;border:1px solid var(--line);background:none;color:var(--muted);font-size:12px;font-weight:500;cursor:pointer;transition:color .12s,border-color .12s,background .12s}
  .fchip:hover{border-color:var(--line2);color:var(--ink)}
  .fchip.on{color:var(--accent);background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 40%,transparent)}
  .fchip.zero{opacity:.4}
  .fchip .fc{color:var(--faint);font-weight:400}
  .tsel{height:26px;padding:0 24px 0 10px;border-radius:999px;border:1px solid var(--line);background:var(--bg) url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" fill="none" stroke="%239aa1ab" stroke-width="1.5"/></svg>') no-repeat right 8px center;color:var(--muted);font-size:12px;cursor:pointer;appearance:none;-webkit-appearance:none}
  .tsel:hover{border-color:var(--line2);color:var(--ink)}
  .tsel:focus{outline:none;border-color:var(--accent)}
  .count{margin-left:auto;color:var(--faint);font-size:12px;white-space:nowrap}

  /* collection groups */
  .grp{margin:28px 0 0}
  .grp h2,.tpls h2{font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:650;margin:0 0 8px 2px}
  .gcount{display:inline-block;background:var(--surface2);border-radius:999px;padding:0 7px;color:var(--faint);font-weight:500;margin-left:4px}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:12px;box-shadow:var(--shadow);overflow:hidden}
  .rows{list-style:none;margin:0;padding:0}
  .row{display:grid;grid-template-columns:1fr auto;gap:4px 16px;align-items:center;padding:11px 16px;border-bottom:1px solid var(--line);border-left:2px solid transparent;transition:background .12s}
  .row:last-child{border-bottom:none}
  .row:hover{background:color-mix(in srgb,var(--ink) 3%,transparent)}
  .row.edge-live{border-left-color:var(--live)}
  .row.edge-off{border-left-color:var(--line2)}
  .titlerow{display:flex;align-items:center;gap:7px;min-width:0}
  .title{font-weight:560;font-size:14px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .title:hover{color:var(--accent)}
  .rename{background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;opacity:0;transition:opacity .12s;padding:0}
  .row:hover .rename,.rename:focus-visible{opacity:1}
  .rename:hover{color:var(--accent)}
  .rename-in{padding:3px 8px;border:1px solid var(--accent);border-radius:6px;background:var(--bg);color:var(--ink);font:inherit;font-size:13.5px;min-width:220px}
  .sub{display:flex;align-items:center;gap:10px;min-width:0}
  .id{font:11.5px ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:var(--faint)}
  .tags{display:inline-flex;flex-wrap:wrap;gap:4px;align-items:center}
  .chip{display:inline-flex;align-items:center;gap:3px;font-size:12px;background:var(--surface2);color:var(--muted);border-radius:999px;padding:1px 8px}
  .chip .x{background:none;border:none;color:transparent;cursor:pointer;font-size:13px;line-height:1;padding:0}
  .chip:hover .x{color:var(--muted)}
  .chip .x:hover{color:var(--red)}
  .addtag{font-size:11px;color:var(--muted);background:none;border:1px dashed var(--line2);border-radius:999px;padding:0 8px;cursor:pointer;opacity:0;transition:opacity .12s}
  .row:hover .addtag,.addtag:focus-visible{opacity:1}
  .addtag:hover{color:var(--accent);border-color:var(--accent)}
  .addtag-in{font-size:12px;padding:1px 8px;border:1px solid var(--accent);border-radius:999px;background:var(--bg);color:var(--ink);width:110px}
  .meta{display:flex;flex-direction:column;align-items:flex-end;gap:3px}
  .l1,.l2{display:flex;align-items:center;gap:8px}
  .badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);white-space:nowrap}
  .badge.t{font-size:11px;font-weight:550;text-transform:uppercase;letter-spacing:.05em;background:var(--surface2);padding:2px 7px;border-radius:5px}
  .badge.s .sdot{width:6px;height:6px;border-radius:50%;background:var(--muted)}
  .s-draft .sdot{background:var(--s-draft)} .s-in_review .sdot{background:var(--s-in_review)}
  .s-approved .sdot{background:var(--s-approved)} .s-implementing .sdot{background:var(--s-implementing)}
  .s-done .sdot{background:var(--s-done)} .s-closed .sdot{background:var(--s-closed)}
  .s-done,.s-closed{color:var(--faint)}
  .live{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:550;color:var(--live)}
  .live .dot{width:7px;height:7px;border-radius:50%;background:var(--live);animation:pulse 2.4s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
  @media(prefers-reduced-motion:reduce){.live .dot{animation:none}}
  .off{font-size:11.5px;color:var(--muted)}
  .upd{font:11.5px ui-monospace,Menlo,monospace;color:var(--faint);white-space:nowrap}
  .collbtn{background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;opacity:0;transition:opacity .12s;padding:0 2px}
  .row:hover .collbtn,.collbtn:focus-visible{opacity:1}
  .collbtn:hover{color:var(--accent)}
  .coll{width:130px;padding:3px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);font-size:12px}
  .coll:focus{outline:none;border-color:var(--accent)}

  /* templates strip */
  .tpls{margin:40px 0 0}
  .tstrip{display:flex;gap:12px;flex-wrap:wrap}
  .tcard{flex:1 1 210px;max-width:250px;display:flex;flex-direction:column;gap:8px;background:var(--surface2);border:1px dashed var(--line2);border-radius:12px;padding:12px 14px;transition:border-color .12s}
  .tcard:hover{border-color:var(--accent)}
  .tname{font-weight:560;font-size:13.5px}
  .trow{display:flex;gap:6px;align-items:center}
  .badge.tpl{font-size:11px;font-weight:550;text-transform:uppercase;letter-spacing:.05em;color:var(--accent);background:var(--accent-soft);padding:2px 7px;border-radius:5px}

  .empty,#nohits{color:var(--muted);padding:56px 0;text-align:center}
  #nohits{display:none}
  #nohits button{background:none;border:none;color:var(--accent);cursor:pointer;text-decoration:underline;padding:0}
  .empty code{background:var(--surface2);border-radius:6px;padding:2px 8px;font-size:12.5px}
  :focus-visible{outline:2px solid var(--accent);outline-offset:2px}
  .search:focus-visible,.coll:focus-visible,.rename-in:focus-visible,.addtag-in:focus-visible{outline:none}
  @media(max-width:860px){.meta{flex-direction:row;gap:8px}.l1 .badge.t{display:none}}
</style></head><body>
<div class="top"><div class="topin">
<header>
  <span class="brand"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2l1.2 2.6L14 5.8l-2.8 1.2L10 9.6 8.8 7 6 5.8l2.8-1.2z"/><rect x="4" y="11" width="12" height="3.4" rx="1.2"/><rect x="6" y="15.4" width="8" height="2.6" rx="1"/></svg>SpecForge</span>
  <span class="spacer"></span>
  <span class="searchbox"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6" cy="6" r="4.2"/><path d="M9.2 9.2L12.5 12.5"/></svg><input class="search" id="search" type="search" placeholder="Search specs, tags, collections…" autocomplete="off" aria-label="Search"><span class="skey">/</span></span>
  <button class="toggle" id="theme" type="button" aria-label="Toggle theme" title="Toggle theme">${theme === 'dark'
    ? '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12.5 9.5A5.5 5.5 0 1 1 5.5 2.5a4.5 4.5 0 0 0 7 7z"/></svg>'
    : '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7.5" cy="7.5" r="3.2"/><path d="M7.5 1v1.8M7.5 12.2V14M1 7.5h1.8M12.2 7.5H14M2.9 2.9l1.3 1.3M10.8 10.8l1.3 1.3M12.1 2.9l-1.3 1.3M4.2 10.8l-1.3 1.3"/></svg>'}</button>
</header>
${n ? `<div class="toolbar">${chipsBar}
  <select class="tsel" id="ftype" aria-label="Filter by type"><option value="">All types</option><option>design</option><option>research</option><option>design-impl</option><option>impl</option></select>
  <select class="tsel" id="fsort" aria-label="Sort"><option value="recent">Recent</option><option value="title">Title A–Z</option><option value="status">Status</option></select>
  <span class="count" id="count">${n} spec${n === 1 ? '' : 's'}</span>
</div>` : ''}
</div></div>
<div class="wrap">
${n ? `${datalist}\n<div id="groups">${groups}</div>\n<div id="nohits">No specs match. <button type="button" id="clearf">Clear filters</button></div>`
    : '<p class="empty">No specs yet. Create one with <code>/specforge:create</code>.</p>'}
${strip}
</div>
<script>
(function(){
  var root=document.documentElement, btn=document.getElementById('theme');
  var SUN='<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7.5" cy="7.5" r="3.2"/><path d="M7.5 1v1.8M7.5 12.2V14M1 7.5h1.8M12.2 7.5H14M2.9 2.9l1.3 1.3M10.8 10.8l1.3 1.3M12.1 2.9l-1.3 1.3M4.2 10.8l-1.3 1.3"/></svg>';
  var MOON='<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12.5 9.5A5.5 5.5 0 1 1 5.5 2.5a4.5 4.5 0 0 0 7 7z"/></svg>';
  if(btn) btn.onclick=function(){
    var next=root.getAttribute('data-theme')==='dark'?'light':'dark';
    root.setAttribute('data-theme',next);
    btn.innerHTML=next==='dark'?MOON:SUN;
    try{fetch('/api/prefs',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({theme:next})}).catch(function(){});}catch(e){}
  };

  function api(id,path,method,body){return fetch('/api/spec/'+encodeURIComponent(id)+path,{method:method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});}
  function rowOf(el){return el.closest('.row');}
  function tagsOf(row){return [].slice.call(row.querySelectorAll('.chip')).map(function(c){return c.getAttribute('data-tag');});}
  function updateKey(row){
    row.setAttribute('data-k',[row.getAttribute('data-id'),
      row.querySelector('.title').textContent,
      row.getAttribute('data-t'),
      row.getAttribute('data-s'),
      row.querySelector('.att').textContent,
      tagsOf(row).join(' '),
      row.querySelector('.coll').value].join(' ').toLowerCase());
  }
  function endRename(row){row.querySelector('.title').hidden=false;row.querySelector('.rename').hidden=false;row.querySelector('.rename-in').hidden=true;}
  function endAddTag(row){row.querySelector('.addtag').hidden=false;row.querySelector('.addtag-in').hidden=true;}
  function endColl(row){row.querySelector('.collbtn').hidden=false;row.querySelector('.coll').hidden=true;}
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
    if(t.classList.contains('rename')){var r=rowOf(t);r.querySelector('.title').hidden=true;t.hidden=true;var i=r.querySelector('.rename-in');i.hidden=false;i.focus();i.select();}
    else if(t.classList.contains('addtag')){var r2=rowOf(t);t.hidden=true;var a=r2.querySelector('.addtag-in');a.hidden=false;a.value='';a.focus();}
    else if(t.classList.contains('collbtn')){var r4=rowOf(t);t.hidden=true;var c=r4.querySelector('.coll');c.hidden=false;c.focus();}
    else if(t.classList.contains('x')){var r3=rowOf(t),chip=t.closest('.chip'),id=r3.getAttribute('data-id');
      var next=tagsOf(r3).filter(function(x){return x!==chip.getAttribute('data-tag');});
      api(id,'/organize','PATCH',{tags:next}).then(function(){chip.remove();updateKey(r3);}).catch(function(){});}
  });

  document.addEventListener('keydown',function(e){
    var t=e.target;
    if(e.key==='/'&&!(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'))){
      var s=document.getElementById('search'); if(s){e.preventDefault();s.focus();s.select();} return;
    }
    if(t.classList&&t.classList.contains('rename-in')){
      if(e.key==='Enter'){var r=rowOf(t),id=r.getAttribute('data-id'),v=t.value.trim();if(!v){endRename(r);return;}
        api(id,'/rename','POST',{title:v}).then(function(x){return x.ok?x.json():null;}).then(function(d){if(d){r.querySelector('.title').textContent=d.title;t.value=d.title;updateKey(r);}endRename(r);}).catch(function(){endRename(r);});}
      else if(e.key==='Escape'){endRename(rowOf(t));}
    } else if(t.classList&&t.classList.contains('addtag-in')){
      if(e.key==='Enter'){var r2=rowOf(t),id2=r2.getAttribute('data-id'),v2=t.value.trim(),cur=tagsOf(r2);
        if(v2 && cur.map(function(x){return x.toLowerCase();}).indexOf(v2.toLowerCase())===-1){
          api(id2,'/organize','PATCH',{tags:cur.concat([v2])}).then(function(x){return x.ok?x.json():null;}).then(function(d){if(d){paintChips(r2,d.tags);updateKey(r2);}endAddTag(r2);}).catch(function(){endAddTag(r2);});
        } else {endAddTag(r2);}}
      else if(e.key==='Escape'){endAddTag(rowOf(t));}
    } else if(t.classList&&t.classList.contains('coll')){
      if(e.key==='Escape'){endColl(rowOf(t));}
    } else if(t.id==='search'&&e.key==='Escape'){t.value='';t.blur();applyFilters();}
  });

  document.addEventListener('change',function(e){
    if(e.target.classList.contains('coll')){var r=rowOf(e.target),id=r.getAttribute('data-id');
      api(id,'/organize','PATCH',{collection:e.target.value}).then(function(){location.reload();}).catch(function(){});}
  });
  document.addEventListener('focusout',function(e){
    if(e.target.classList&&e.target.classList.contains('coll')) endColl(rowOf(e.target));
  });

  // --- search + status chips + type filter + sort (combined, in-memory) ---
  var search=document.getElementById('search'), count=document.getElementById('count'), nohits=document.getElementById('nohits');
  var ftype=document.getElementById('ftype'), fsort=document.getElementById('fsort');
  var rows=[].slice.call(document.querySelectorAll('.row[data-id]')), total=rows.length;
  var grps=[].slice.call(document.querySelectorAll('.grp'));
  var chips=[].slice.call(document.querySelectorAll('.fchip'));
  var fstatus='all';
  var SORDER={implementing:0,in_review:1,draft:2,approved:3,done:4,closed:5};

  function applyFilters(){
    var q=(search&&search.value.trim().toLowerCase())||'';
    var ty=(ftype&&ftype.value)||'';
    var shown=0;
    rows.forEach(function(r){
      var hit=(!q||r.getAttribute('data-k').indexOf(q)!==-1)
        &&(fstatus==='all'||r.getAttribute('data-s')===fstatus)
        &&(!ty||r.getAttribute('data-t')===ty);
      r.style.display=hit?'':'none';
      if(hit)shown++;
    });
    grps.forEach(function(g){
      var vis=[].slice.call(g.querySelectorAll('.row[data-id]')).filter(function(r){return r.style.display!=='none';}).length;
      var gc=g.querySelector('.gcount'); if(gc) gc.textContent=vis;
      g.style.display=vis?'':'none';
    });
    // live chip counts within the current q+type slice
    chips.forEach(function(ch){
      var f=ch.getAttribute('data-f');
      var c=rows.filter(function(r){
        return (!q||r.getAttribute('data-k').indexOf(q)!==-1)
          &&(!ty||r.getAttribute('data-t')===ty)
          &&(f==='all'||r.getAttribute('data-s')===f);
      }).length;
      var fc=ch.querySelector('.fc'); if(fc) fc.textContent=c;
      ch.classList.toggle('zero',f!=='all'&&!c);
    });
    if(count) count.textContent=(q||fstatus!=='all'||ty)?(shown+' of '+total):(total+' spec'+(total===1?'':'s'));
    if(nohits) nohits.style.display=shown?'none':'block';
  }
  function applySort(){
    var mode=(fsort&&fsort.value)||'recent';
    grps.forEach(function(g){
      var ul=g.querySelector('.rows'); if(!ul) return;
      var list=[].slice.call(ul.children);
      list.sort(function(a,b){
        if(mode==='title') return a.querySelector('.title').textContent.localeCompare(b.querySelector('.title').textContent);
        if(mode==='status') return (SORDER[a.getAttribute('data-s')]||9)-(SORDER[b.getAttribute('data-s')]||9);
        return (+b.getAttribute('data-u'))-(+a.getAttribute('data-u'));
      });
      list.forEach(function(li){ul.appendChild(li);});
    });
  }
  chips.forEach(function(ch){ch.onclick=function(){
    var f=ch.getAttribute('data-f');
    fstatus=(fstatus===f)?'all':f;
    chips.forEach(function(x){x.classList.toggle('on',x.getAttribute('data-f')===fstatus);});
    applyFilters();
  };});
  if(search) search.oninput=applyFilters;
  if(ftype) ftype.onchange=applyFilters;
  if(fsort) fsort.onchange=applySort;
  var clearf=document.getElementById('clearf');
  if(clearf) clearf.onclick=function(){
    if(search)search.value=''; if(ftype)ftype.value=''; fstatus='all';
    chips.forEach(function(x){x.classList.toggle('on',x.getAttribute('data-f')==='all');});
    applyFilters();
  };
})();
</script>
</body></html>`;
}
