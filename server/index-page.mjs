// SpecForge index (home) page — server-rendered, single string, no build step.
//
// The store grows to hundreds of specs, so the page is built around narrowing:
// a left rail of saved views (All / Needs you / Live / Shared) and collections,
// a dense one-line row per spec, and every filter combining in-memory. Each row
// carries the three signals you would otherwise have to open the spec to learn —
// whether a session is attached, whether comments are waiting, whether it is
// published — computed by lib/spec-signals.mjs so the index and the spec's own
// review layer never disagree.
//
// Collections are derived from meta, not stored separately: renaming one is a
// PATCH per member spec, deleting one clears the field. That keeps the model at
// one source of truth and needs no new endpoints.
//
// All state is in-memory; everything inlined (CSP-friendly).

import { listSpecs, LEGACY_TYPE, SPEC_TYPES } from '../lib/meta.mjs';
import { sessionDisplay } from '../lib/session-label.mjs';
import { readGlobalPrefs } from '../lib/global-prefs.mjs';
import { specSignals, REVIEW_TITLE } from '../lib/spec-signals.mjs';
import { STATUSES } from '../lib/lifecycle.mjs';

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

const ICON_COMMENT = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M1.9 2.2h10.2v7H6.6L3.4 11.6V9.2H1.9z"/></svg>';
const ICON_SHARE = '<svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><circle cx="7" cy="7" r="5.2"/><path d="M1.8 7h10.4M7 1.8c1.7 1.8 1.7 8.6 0 10.4M7 1.8C5.3 3.6 5.3 10.4 7 12.2"/></svg>';

/** The comment signal: one bubble, coloured by what the spec is waiting on. */
function reviewHtml(sig) {
  if (sig.review === 'clear') return '';
  const n = sig.review === 'needs' ? sig.needs
    : sig.review === 'replied' ? sig.replied
      : sig.review === 'discussion' ? sig.discussion : sig.sent;
  const count = n ? `<span class="rvn">${n}</span>` : '';
  return `<span class="rv rv-${sig.review}" title="${esc(REVIEW_TITLE[sig.review])}">${ICON_COMMENT}${count}</span>`;
}

/**
 * The share signal, shown only while the tunnel actually answers — a dead link
 * on the index would be worse than no link at all.
 */
function shareHtml(sig) {
  if (!sig.shareLive || !sig.shareUrl) return '';
  let host = sig.shareUrl;
  try { host = new URL(sig.shareUrl).hostname.replace(/\.trycloudflare\.com$/, ''); } catch { /* keep raw */ }
  return `<a class="pub" href="${esc(sig.shareUrl)}" target="_blank" rel="noopener" title="Shared · ${esc(host)}">${ICON_SHARE}</a>`;
}

/** One working-spec row. */
function rowHtml(m, sig) {
  const id = esc(m.id);
  const titleRaw = m.title || 'Untitled';
  const title = esc(titleRaw);
  const rawType = m.type || LEGACY_TYPE;
  const rawStatus = m.status || 'draft';
  const att = attachedLabel(m);
  const tags = Array.isArray(m.tags) ? m.tags : [];
  const coll = m.collection || '';
  const key = esc(`${m.id} ${titleRaw} ${rawType} ${rawStatus} ${m.attachedSession ? sessionDisplay(m) : 'free'} ${tags.join(' ')} ${coll}`.toLowerCase());
  const chips = tags.map((t) => `<span class="chip" data-tag="${esc(t)}">${esc(t)}<button class="x" type="button" title="Remove tag" aria-label="Remove tag">×</button></span>`).join('');
  // "Connected" is a beating watcher, not merely an attached session — see
  // specConnected. A spec whose session closed reads disconnected within 30s
  // instead of claiming to be live for the half-hour the lock takes to go stale.
  const isLive = sig.connected;
  const live = m.attachedSession
    ? (isLive ? '<span class="live" title="' + att + '"><span class="dot"></span> live</span>'
      : '<span class="off" title="' + att + '">○ disconnected</span>')
    : '';
  const edge = m.attachedSession ? (isLive ? ' edge-live' : ' edge-off') : '';
  return `<li class="row${edge}" data-k="${key}" data-id="${id}" data-s="${esc(rawStatus)}" data-t="${esc(rawType)}" data-u="${m.updated || 0}" data-c="${esc(coll)}" data-rv="${esc(sig.review)}" data-lv="${isLive ? 1 : 0}" data-pb="${sig.shareLive ? 1 : 0}">
  <input class="sel" type="checkbox" aria-label="Select ${title}">
  <div class="main">
    <a class="title" href="/spec/${id}" title="${title}">${title}</a>
    <button class="rename" type="button" title="Rename" aria-label="Rename">✎</button>
    <input class="rename-in" type="text" value="${esc(titleRaw)}" aria-label="New name" hidden>
    <span class="tags">${chips}<button class="addtag" type="button" title="Add tag">+ tag</button><input class="addtag-in" type="text" placeholder="tag…" aria-label="Add tag" hidden></span>
    <span class="id" title="Spec id">${id}</span>
    <span class="att" hidden>${att}</span>
  </div>
  <div class="meta">
    <span class="sig">${reviewHtml(sig)}${shareHtml(sig)}</span>
    <span class="lv">${live}</span>
    <span class="badge t">${esc(rawType)}</span>
    <span class="badge s s-${esc(rawStatus)}"><span class="sdot"></span>${esc(rawStatus)}</span>
    <span class="upd">${esc(relativeTime(m.updated))}</span>
    <span class="acts"><button class="collbtn" type="button" title="Move to collection" aria-label="Move to collection">▣</button><input class="coll" list="collections" value="${esc(coll)}" placeholder="Uncollected" aria-label="Collection" hidden><button class="del" type="button" title="Delete spec" aria-label="Delete spec">🗑</button></span>
  </div>
  <div class="delconfirm" hidden><span class="dcmsg">Delete <b>${title}</b>? This can't be undone.</span><button class="dcno" type="button">Cancel</button><button class="dcyes" type="button">Delete</button></div>
</li>`;
}

/** One protected template card (bottom strip). */
function tplCard(m) {
  const id = esc(m.id);
  return `<a class="tcard" href="/spec/${id}" data-id="${id}">
  <span class="tname">${esc(m.title || id)}</span>
  <span class="trow"><span class="badge t">${esc(m.type || LEGACY_TYPE)}</span><span class="badge tpl">template</span></span>
</a>`;
}

/** One collection in the rail: filter button + rename / delete affordances. */
function collRowHtml(key, count) {
  const name = key === '' ? 'Uncollected' : esc(key);
  const acts = key === '' ? '' : `<span class="cacts"><button class="cedit" type="button" title="Rename collection" aria-label="Rename collection">✎</button><button class="cdel" type="button" title="Delete collection" aria-label="Delete collection">×</button></span>
    <input class="cin" type="text" value="${esc(key)}" aria-label="Collection name" hidden>
    <span class="cconfirm" hidden><span class="ccmsg">Ungroup ${count}?</span><button class="cno" type="button">No</button><button class="cyes" type="button">Yes</button></span>`;
  return `<div class="crow" data-c="${esc(key)}">
    <button class="cnav" type="button" data-c="${esc(key)}"><span class="cname">${name}</span><span class="nc">${count}</span></button>
    ${acts}
  </div>`;
}

/**
 * @param {object} [opts]
 * @param {(id:string) => {url:string|null, live:boolean}|null} [opts.shareInfo]
 *   from the daemon's publications registry. The record on disk holds only a
 *   token, so the public URL is composed by whoever knows the current origin.
 */
export function renderIndex({ shareInfo } = {}) {
  const theme = readGlobalPrefs().theme === 'dark' ? 'dark' : 'light';
  const all = listSpecs().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const tpls = all.filter((m) => m.template);
  const specs = all.filter((m) => !m.template);
  const n = specs.length;
  const sigs = new Map(specs.map((m) => [m.id, specSignals(m.id, shareInfo, m)]));
  const sigOf = (m) => sigs.get(m.id);

  const { order, named } = groupByCollection(specs);
  const datalist = `<datalist id="collections">${named.map((c) => `<option value="${esc(c)}"></option>`).join('')}</datalist>`;

  const counts = Object.fromEntries(STATUSES.map((s) => [s, specs.filter((m) => (m.status || 'draft') === s).length]));
  const chipsBar = ['all', ...STATUSES].map((s) => {
    const c = s === 'all' ? n : counts[s];
    return `<button class="fchip${s === 'all' ? ' on' : ''}${s !== 'all' && !c ? ' zero' : ''}" type="button" data-f="${s}">${s === 'all' ? 'All' : esc(s)}<span class="fc">${c}</span></button>`;
  }).join('');

  const nAttn = specs.filter((m) => ['needs', 'replied'].includes(sigOf(m).review)).length;
  const nLive = specs.filter((m) => sigOf(m).connected).length;
  const nPub = specs.filter((m) => sigOf(m).shareLive).length;
  const views = [
    ['all', 'All specs', n],
    ['attn', 'Needs you', nAttn],
    ['live', 'Live', nLive],
    ['shared', 'Shared', nPub],
  ].map(([v, text, c]) => `<button class="nav${v === 'all' ? ' on' : ''}" type="button" data-view="${v}">${text}<span class="nc">${c}</span></button>`).join('');

  const collRows = order.map(({ key, specs: list }) => collRowHtml(key, list.length)).join('\n');

  const groups = order.map(({ key, specs: list }) => `<section class="grp" data-coll="${esc(key)}">
  <h2>${key === '' ? 'Uncollected' : esc(key)} <span class="gcount">${list.length}</span></h2>
  <div class="card"><ul class="rows">${list.map((m) => rowHtml(m, sigOf(m))).join('\n')}</ul></div>
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
    --s-draft:#6b7280;--s-approved:#16a34a;--s-discussion:#0d9488;
    --shadow:0 1px 2px rgba(28,32,36,.05),0 4px 12px rgba(28,32,36,.04);
    /* review-layer compat: pages sometimes read these generic names */
    --panel:var(--surface);--green:var(--live);--amber:#b45309;--red:#cf222e
  }
  :root[data-theme="dark"]{
    --bg:#101114;--surface:#17181c;--surface2:#1f2126;--ink:#e8eaed;--muted:#9aa1ab;--faint:#6b7280;
    --line:#26282e;--line2:#34373f;--accent:#818cf8;--accent-soft:#232441;--live:#4ade80;
    --s-draft:#9aa1ab;--s-approved:#4ade80;--s-discussion:#2dd4bf;
    --shadow:none;
    --panel:var(--surface);--green:var(--live);--amber:#e5a54b;--red:#f85149
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",sans-serif}
  a{color:inherit;text-decoration:none}
  button{font:inherit;color:inherit}

  /* ── shell: fixed rail + scrolling list ───────────────────────────── */
  .app{display:flex;align-items:flex-start;min-height:100vh}
  .side{position:sticky;top:0;flex:none;width:238px;height:100vh;overflow-y:auto;padding:0 12px 24px;
        border-right:1px solid var(--line);background:color-mix(in srgb,var(--surface) 50%,var(--bg))}
  /* not ".main" — the row's left cluster already owns that name */
  .pane{flex:1;min-width:0}

  .brand{display:flex;align-items:center;gap:9px;height:56px;padding:0 8px;font-size:16px;font-weight:650;letter-spacing:-.01em}
  .brand svg{color:var(--accent);flex:none}
  .shead{display:flex;align-items:center;gap:6px;margin:20px 0 6px;padding:0 8px;font-size:10.5px;font-weight:650;
         text-transform:uppercase;letter-spacing:.07em;color:var(--faint)}
  .shint{padding:2px 8px 0;font-size:11.5px;color:var(--faint);line-height:1.45}

  .nav,.cnav{display:flex;align-items:center;gap:8px;width:100%;height:29px;padding:0 8px;border:none;border-radius:7px;
             background:none;color:var(--muted);font-size:13px;text-align:left;cursor:pointer;transition:background .12s,color .12s}
  .nav:hover,.cnav:hover{background:var(--surface2);color:var(--ink)}
  .nav.on,.cnav.on{background:var(--accent-soft);color:var(--accent);font-weight:560}
  .nc{margin-left:auto;font-size:11.5px;color:var(--faint);font-variant-numeric:tabular-nums}
  .nav.on .nc,.cnav.on .nc{color:inherit;opacity:.7}
  .cname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  .crow{position:relative;display:flex;align-items:center}
  .cacts{position:absolute;right:6px;display:flex;gap:2px;opacity:0;transition:opacity .12s}
  .crow:hover .cacts,.cacts:focus-within{opacity:1}
  .crow:hover .nc{opacity:0}
  .cedit,.cdel{background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;line-height:1;padding:3px 4px;border-radius:5px}
  .cedit:hover{color:var(--accent);background:var(--surface2)}
  .cdel:hover{color:var(--red);background:var(--surface2)}
  .cin{width:100%;padding:4px 8px;border:1px solid var(--accent);border-radius:7px;background:var(--bg);color:var(--ink);font:inherit;font-size:13px}
  .cin:focus{outline:none}
  .cconfirm{display:flex;align-items:center;gap:6px;width:100%;padding:2px 8px;font-size:11.5px;color:var(--muted)}
  .cconfirm[hidden]{display:none}
  .ccmsg{margin-right:auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .cno,.cyes{background:none;border:1px solid var(--line2);border-radius:5px;font-size:11px;padding:1px 7px;cursor:pointer}
  .cyes{border-color:var(--red);color:var(--red)}
  .cno:hover{border-color:var(--muted)} .cyes:hover{background:var(--red);color:#fff}

  /* ── sticky top: search + toolbar ─────────────────────────────────── */
  .top{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 88%,transparent);
       backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
  .topin{max-width:1180px;margin:0 auto;padding:0 28px}
  @media(max-width:960px){.topin{padding:0 18px}}
  header{display:flex;align-items:center;gap:16px;height:56px}
  .htitle{font-size:15px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .spacer{flex:1}
  .searchbox{position:relative;display:flex;align-items:center}
  .searchbox svg{position:absolute;left:10px;color:var(--faint);pointer-events:none}
  .search{width:280px;min-width:160px;height:34px;padding:0 34px 0 32px;border:1px solid var(--line);border-radius:8px;background:var(--surface);color:var(--ink);font-size:13.5px}
  :root[data-theme="dark"] .search{background:var(--surface2)}
  .search:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
  .skey{position:absolute;right:9px;font:11px ui-monospace,Menlo,monospace;color:var(--faint);border:1px solid var(--line);border-radius:4px;padding:0 5px;pointer-events:none}
  .search:focus~.skey,.search:not(:placeholder-shown)~.skey{display:none}
  .toggle{width:32px;height:32px;display:flex;align-items:center;justify-content:center;background:none;border:none;border-radius:8px;color:var(--muted);cursor:pointer;flex:none}
  .toggle:hover{background:var(--surface2);color:var(--ink)}
  .toolbar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding:2px 0 11px}
  .fchip{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 11px;border-radius:999px;border:1px solid var(--line);background:none;color:var(--muted);font-size:12px;font-weight:500;cursor:pointer;transition:color .12s,border-color .12s,background .12s}
  .fchip:hover{border-color:var(--line2);color:var(--ink)}
  .fchip.on{color:var(--accent);background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 40%,transparent)}
  .fchip.zero{opacity:.4}
  .fchip .fc{color:var(--faint);font-weight:400;font-variant-numeric:tabular-nums}
  .tsel{height:26px;padding:0 24px 0 10px;border-radius:999px;border:1px solid var(--line);background:var(--bg) url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 10 10"><path d="M2 3.5l3 3 3-3" fill="none" stroke="%239aa1ab" stroke-width="1.5"/></svg>') no-repeat right 8px center;color:var(--muted);font-size:12px;cursor:pointer;appearance:none;-webkit-appearance:none}
  .tsel:hover{border-color:var(--line2);color:var(--ink)}
  .tsel:focus{outline:none;border-color:var(--accent)}
  .count{margin-left:auto;color:var(--faint);font-size:12px;white-space:nowrap;font-variant-numeric:tabular-nums}

  .wrap{max-width:1180px;margin:0 auto;padding:0 28px 96px}
  @media(max-width:960px){.wrap{padding:0 18px 96px}}

  /* ── collection groups ────────────────────────────────────────────── */
  .grp{margin:22px 0 0}
  .grp h2,.tpls h2{display:flex;align-items:center;gap:5px;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:650;margin:0 0 7px 2px}
  /* the collection you are inside stays named while you scroll it */
  .grp h2{position:sticky;top:94px;z-index:5;background:var(--bg);padding:5px 2px;margin:0 0 3px;cursor:pointer;user-select:none}
  .grp h2:hover{color:var(--ink)}
  .gcount{display:inline-block;background:var(--surface2);border-radius:999px;padding:0 7px;color:var(--faint);font-weight:500;font-variant-numeric:tabular-nums}
  .chev{margin-left:2px;color:var(--faint);transition:transform .14s}
  .grp.collapsed .chev{transform:rotate(-90deg)}
  .grp.collapsed .card{display:none}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:11px;box-shadow:var(--shadow);overflow:hidden}
  .rows{list-style:none;margin:0;padding:0}

  /* ── one-line row ─────────────────────────────────────────────────── */
  .row{position:relative;display:flex;align-items:center;gap:10px;padding:0 14px;min-height:38px;
       border-bottom:1px solid var(--line);border-left:2px solid transparent;transition:background .12s}
  .row:last-child{border-bottom:none}
  .row:hover{background:color-mix(in srgb,var(--ink) 3%,transparent)}
  .row.edge-live{border-left-color:var(--live)}
  .row.edge-off{border-left-color:var(--line2)}
  .row.picked{background:var(--accent-soft)}
  .sel{flex:none;width:14px;height:14px;margin:0;accent-color:var(--accent);cursor:pointer;opacity:0;transition:opacity .12s}
  .row:hover .sel,.sel:checked,.sel:focus-visible,body.picking .sel{opacity:1}
  .main{display:flex;align-items:center;gap:8px;min-width:0;flex:1}
  /* Takes whatever the row has left. A fixed cap truncated titles at a third of
     the row while the space beside them sat empty. */
  .title{font-weight:540;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:0 1 auto;min-width:0}
  .title:hover{color:var(--accent)}
  .rename{background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;opacity:0;transition:opacity .12s;padding:0;flex:none}
  .row:hover .rename,.rename:focus-visible{opacity:1}
  .rename:hover{color:var(--accent)}
  .rename-in{padding:3px 8px;border:1px solid var(--accent);border-radius:6px;background:var(--bg);color:var(--ink);font:inherit;font-size:13.5px;min-width:240px}
  .rename-in:focus{outline:none}
  .tags{display:inline-flex;gap:4px;align-items:center;min-width:0;overflow:hidden}
  .chip{display:inline-flex;align-items:center;gap:3px;font-size:11.5px;background:var(--surface2);color:var(--muted);border-radius:999px;padding:0 7px;white-space:nowrap}
  .chip .x{background:none;border:none;color:transparent;cursor:pointer;font-size:12px;line-height:1;padding:0}
  .chip:hover .x{color:var(--muted)}
  .chip .x:hover{color:var(--red)}
  .addtag{font-size:11px;color:var(--muted);background:none;border:1px dashed var(--line2);border-radius:999px;padding:0 7px;cursor:pointer;opacity:0;transition:opacity .12s;white-space:nowrap}
  .row:hover .addtag,.addtag:focus-visible{opacity:1}
  .addtag:hover{color:var(--accent);border-color:var(--accent)}
  .addtag-in{font-size:12px;padding:1px 8px;border:1px solid var(--accent);border-radius:999px;background:var(--bg);color:var(--ink);width:110px}
  .addtag-in:focus{outline:none}
  .id{font:11px ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:var(--faint);opacity:0;transition:opacity .12s;flex:none}
  .row:hover .id{opacity:1}

  /* Fixed-width slots, so the signals read as columns down the list rather than
     as a ragged right edge. Empty slots still hold their place. */
  .meta{display:flex;align-items:center;gap:9px;flex:none;margin-left:auto}
  .meta>*{flex:none}
  .sig{display:inline-flex;align-items:center;justify-content:flex-end;gap:8px;width:46px}
  .lv{display:inline-flex;align-items:center;justify-content:flex-end;width:82px}
  .rv{display:inline-flex;align-items:center;gap:3px;font-size:11.5px;font-weight:560;font-variant-numeric:tabular-nums}
  .rv-needs{color:var(--amber)} .rv-replied{color:var(--accent)}
  .rv-awaiting{color:var(--faint)} .rv-discussion{color:var(--s-discussion)}
  .pub{display:inline-flex;color:var(--live)}
  .pub:hover{filter:brightness(1.15)}
  .badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);white-space:nowrap}
  .badge.t{font-size:10.5px;font-weight:550;text-transform:uppercase;letter-spacing:.05em;background:var(--surface2);padding:1px 6px;border-radius:5px;color:var(--faint);width:84px;justify-content:center}
  .badge.s{font-size:11.5px;width:92px}
  .badge.s .sdot{width:6px;height:6px;border-radius:50%;background:var(--muted);flex:none}
  .s-draft .sdot{background:var(--s-draft)}
  .s-approved .sdot{background:var(--s-approved)} .s-approved{color:var(--s-approved)}
  .live{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:550;color:var(--live)}
  .live .dot{width:7px;height:7px;border-radius:50%;background:var(--live);animation:pulse 2.4s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
  @media(prefers-reduced-motion:reduce){.live .dot{animation:none}}
  .off{font-size:11px;color:var(--faint);white-space:nowrap}
  .upd{font:11px ui-monospace,Menlo,monospace;color:var(--faint);white-space:nowrap;width:58px;text-align:right}
  .acts{display:inline-flex;align-items:center;gap:2px;width:34px;justify-content:flex-end}
  .collbtn{background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;opacity:0;transition:opacity .12s;padding:0 2px}
  .row:hover .collbtn,.collbtn:focus-visible{opacity:1}
  .collbtn:hover{color:var(--accent)}
  .del{background:none;border:none;color:var(--muted);cursor:pointer;font-size:12px;opacity:0;transition:opacity .12s,color .12s;padding:0 2px;filter:grayscale(1)}
  .row:hover .del,.del:focus-visible{opacity:.75}
  .del:hover{opacity:1;color:var(--red);filter:none}
  /* two-step confirm — an overlay bar over the row, so the layout never shifts */
  .delconfirm{position:absolute;inset:0;display:none;align-items:center;justify-content:flex-end;gap:10px;padding:0 16px;background:color-mix(in srgb,var(--surface) 92%,var(--red));border-left:2px solid var(--red)}
  .row.confirming .delconfirm{display:flex}
  .row.confirming .main,.row.confirming .meta,.row.confirming .sel{opacity:.25}
  .dcmsg{margin-right:auto;font-size:13px;color:var(--ink)}
  .dcmsg b{font-weight:600}
  .dcno{background:none;border:1px solid var(--line2);color:var(--muted);border-radius:6px;font-size:12px;padding:3px 12px;cursor:pointer;transition:color .12s,border-color .12s}
  .dcno:hover{color:var(--ink);border-color:var(--muted)}
  .dcyes{background:var(--red);border:1px solid var(--red);color:#fff;border-radius:6px;font-size:12px;font-weight:560;padding:3px 12px;cursor:pointer;transition:filter .12s}
  .dcyes:hover{filter:brightness(1.08)}
  .coll{width:130px;padding:3px 8px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);font-size:12px}
  .coll:focus{outline:none;border-color:var(--accent)}

  /* ── bulk bar ─────────────────────────────────────────────────────── */
  .bulk{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:20;display:flex;align-items:center;gap:10px;
        padding:8px 12px;border:1px solid var(--line2);border-radius:11px;background:var(--surface);box-shadow:0 8px 28px rgba(0,0,0,.16)}
  .bulk[hidden]{display:none}
  .bn{font-size:12.5px;font-weight:560;white-space:nowrap}
  .bsep{width:1px;height:20px;background:var(--line)}
  .bcoll{width:190px;height:28px;padding:0 9px;border:1px solid var(--line);border-radius:7px;background:var(--bg);color:var(--ink);font-size:12.5px}
  .bcoll:focus{outline:none;border-color:var(--accent)}
  .bbtn{height:28px;padding:0 11px;border:1px solid var(--line);border-radius:7px;background:none;color:var(--muted);font-size:12.5px;cursor:pointer}
  .bbtn:hover{color:var(--ink);border-color:var(--line2)}

  /* one-shot warning, carried across the reload a fan-out triggers */
  .toast{position:fixed;left:22px;bottom:22px;z-index:30;display:flex;align-items:center;gap:10px;max-width:460px;
         padding:9px 12px;border:1px solid var(--red);border-radius:10px;font-size:12.5px;color:var(--ink);
         background:color-mix(in srgb,var(--surface) 88%,var(--red));box-shadow:0 8px 28px rgba(0,0,0,.16)}
  .tx{background:none;border:none;color:var(--muted);font-size:14px;line-height:1;cursor:pointer;padding:0}
  .tx:hover{color:var(--ink)}

  /* ── templates strip ──────────────────────────────────────────────── */
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
  .search:focus-visible,.coll:focus-visible,.rename-in:focus-visible,.addtag-in:focus-visible,.cin:focus-visible,.bcoll:focus-visible{outline:none}

  @media(max-width:1180px){.badge.t{display:none}}
  @media(max-width:900px){
    .app{display:block}
    .side{position:static;width:auto;height:auto;border-right:none;border-bottom:1px solid var(--line);padding-bottom:12px}
    .side .brand{height:48px}
    .views,.colls{display:flex;flex-wrap:wrap;gap:4px}
    .nav,.cnav{width:auto}
    .crow{width:auto}
    .cacts{display:none}
    .tags,.id,.upd{display:none}
  }
</style></head><body>
<div class="app">
<aside class="side">
  <span class="brand"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2l1.2 2.6L14 5.8l-2.8 1.2L10 9.6 8.8 7 6 5.8l2.8-1.2z"/><rect x="4" y="11" width="12" height="3.4" rx="1.2"/><rect x="6" y="15.4" width="8" height="2.6" rx="1"/></svg>SpecForge</span>
  <nav class="views" id="views" aria-label="Views">${views}</nav>
  <div class="shead">Collections</div>
  <nav class="colls" id="colls" aria-label="Collections">${collRows}</nav>
  ${named.length ? '' : '<p class="shint">Select specs with the checkbox, then move them into a collection.</p>'}
</aside>
<main class="pane">
<div class="top"><div class="topin">
<header>
  <span class="htitle" id="htitle">All specs</span>
  <span class="spacer"></span>
  <span class="searchbox"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6" cy="6" r="4.2"/><path d="M9.2 9.2L12.5 12.5"/></svg><input class="search" id="search" type="search" placeholder="Search specs, tags, collections…" autocomplete="off" aria-label="Search"><span class="skey">/</span></span>
  <button class="toggle" id="theme" type="button" aria-label="Toggle theme" title="Toggle theme">${theme === 'dark'
    ? '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12.5 9.5A5.5 5.5 0 1 1 5.5 2.5a4.5 4.5 0 0 0 7 7z"/></svg>'
    : '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7.5" cy="7.5" r="3.2"/><path d="M7.5 1v1.8M7.5 12.2V14M1 7.5h1.8M12.2 7.5H14M2.9 2.9l1.3 1.3M10.8 10.8l1.3 1.3M12.1 2.9l-1.3 1.3M4.2 10.8l-1.3 1.3"/></svg>'}</button>
</header>
${n ? `<div class="toolbar">${chipsBar}
  <select class="tsel" id="ftype" aria-label="Filter by type"><option value="">All types</option>${SPEC_TYPES.map((t) => `<option>${esc(t)}</option>`).join('')}</select>
  <select class="tsel" id="fsort" aria-label="Sort"><option value="recent">Recent</option><option value="title">Title A–Z</option><option value="status">Status</option></select>
  <span class="count" id="count">${n} spec${n === 1 ? '' : 's'}</span>
</div>` : ''}
</div></div>
<div class="wrap">
${n ? `${datalist}\n<div id="groups">${groups}</div>\n<div id="nohits">No specs match. <button type="button" id="clearf">Clear filters</button></div>`
    : '<p class="empty">No specs yet. Create one with <code>/specforge:create</code>.</p>'}
${strip}
</div>
</main>
</div>
<div class="bulk" id="bulk" hidden>
  <span class="bn" id="bn">0 selected</span><span class="bsep"></span>
  <input class="bcoll" id="bcoll" list="collections" type="text" placeholder="Move to collection…" aria-label="Move to collection">
  <button class="bbtn" id="bclear" type="button">Ungroup</button>
  <button class="bbtn" id="bcancel" type="button">Cancel</button>
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
    else if(t.classList.contains('del')){var rd=rowOf(t);rd.querySelector('.delconfirm').hidden=false;rd.classList.add('confirming');}
    else if(t.classList.contains('dcno')){var rn=rowOf(t);rn.classList.remove('confirming');rn.querySelector('.delconfirm').hidden=true;}
    else if(t.classList.contains('dcyes')){var rz=rowOf(t),idz=rz.getAttribute('data-id');t.disabled=true;
      // Key on the HTTP status: a non-2xx (404/403-template/500) means the spec
      // was NOT deleted, so keep the row and back out of the confirm.
      api(idz,'','DELETE').then(function(x){
        if(!x||!x.ok){throw new Error('delete failed');}
        rz.remove(); removeRow(idz);
      }).catch(function(){t.disabled=false;rz.classList.remove('confirming');rz.querySelector('.delconfirm').hidden=true;});}
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
    } else if(t.classList&&t.classList.contains('cin')){
      if(e.key==='Enter'){renameColl(t.closest('.crow'),t.value.trim());}
      else if(e.key==='Escape'){endCollEdit(t.closest('.crow'));}
    } else if(t.classList&&t.classList.contains('bcoll')){
      if(e.key==='Enter'){var bv=t.value.trim(); if(bv) bulkSet(bv);}
      else if(e.key==='Escape'){clearPick();}
    } else if(t.id==='search'&&e.key==='Escape'){t.value='';t.blur();applyFilters();}
    else if(e.key==='Escape'){clearPick();}
  });

  document.addEventListener('change',function(e){
    if(e.target.classList.contains('coll')){var r=rowOf(e.target),id=r.getAttribute('data-id');
      api(id,'/organize','PATCH',{collection:e.target.value}).then(function(){location.reload();}).catch(function(){});}
    else if(e.target.classList.contains('sel')){
      var rs=rowOf(e.target); if(rs) rs.classList.toggle('picked',e.target.checked);
      paintBulk();
    }
  });
  document.addEventListener('focusout',function(e){
    if(e.target.classList&&e.target.classList.contains('coll')) endColl(rowOf(e.target));
  });

  // --- filters: search + view + collection + status + type, all combining ---
  var search=document.getElementById('search'), count=document.getElementById('count'), nohits=document.getElementById('nohits');
  var ftype=document.getElementById('ftype'), fsort=document.getElementById('fsort'), htitle=document.getElementById('htitle');
  var rows=[].slice.call(document.querySelectorAll('.row[data-id]')), total=rows.length;
  var grps=[].slice.call(document.querySelectorAll('.grp')), tplstrip=document.querySelector('.tpls');
  var chips=[].slice.call(document.querySelectorAll('.fchip'));
  var navs=[].slice.call(document.querySelectorAll('.nav[data-view]'));
  var cnavs=[].slice.call(document.querySelectorAll('.cnav'));
  var fstatus='all', fview='all', fcoll=null;
  var SORDER={draft:0,approved:1};
  var VIEWNAME={all:'All specs',attn:'Needs you',live:'Live',shared:'Shared'};

  function viewOk(r){
    if(fview==='attn'){var rv=r.getAttribute('data-rv');return rv==='needs'||rv==='replied';}
    if(fview==='live') return r.getAttribute('data-lv')==='1';
    if(fview==='shared') return r.getAttribute('data-pb')==='1';
    return true;
  }
  function base(r,q,ty){
    return (!q||r.getAttribute('data-k').indexOf(q)!==-1)
      &&(!ty||r.getAttribute('data-t')===ty)
      &&viewOk(r)
      &&(fcoll===null||r.getAttribute('data-c')===fcoll);
  }
  function applyFilters(){
    var q=(search&&search.value.trim().toLowerCase())||'';
    var ty=(ftype&&ftype.value)||'';
    var shown=0;
    rows.forEach(function(r){
      var hit=base(r,q,ty)&&(fstatus==='all'||r.getAttribute('data-s')===fstatus);
      r.style.display=hit?'':'none';
      if(hit)shown++;
    });
    grps.forEach(function(g){
      var vis=[].slice.call(g.querySelectorAll('.row[data-id]')).filter(function(r){return r.style.display!=='none';}).length;
      var gc=g.querySelector('.gcount'); if(gc) gc.textContent=vis;
      g.style.display=vis?'':'none';
    });
    // live chip counts within the current search+view+collection+type slice
    chips.forEach(function(ch){
      var f=ch.getAttribute('data-f');
      var c=rows.filter(function(r){return base(r,q,ty)&&(f==='all'||r.getAttribute('data-s')===f);}).length;
      var fc=ch.querySelector('.fc'); if(fc) fc.textContent=c;
      ch.classList.toggle('zero',f!=='all'&&!c);
    });
    var filtered=!!q||fstatus!=='all'||!!ty||fview!=='all'||fcoll!==null;
    if(count) count.textContent=filtered?(shown+' of '+total):(total+' spec'+(total===1?'':'s'));
    if(nohits) nohits.style.display=shown?'none':'block';
    // Templates are not rows and never match a filter; showing them under one
    // reads as "these are your results".
    if(tplstrip) tplstrip.style.display=filtered?'none':'';
    if(htitle) htitle.textContent=fcoll===null?VIEWNAME[fview]:(fcoll===''?'Uncollected':fcoll);
  }
  // Drop a deleted row from the in-memory set and refresh counts/groups.
  function removeRow(id){
    rows=rows.filter(function(r){return r.getAttribute('data-id')!==id;});
    total=rows.length;
    applyFilters();
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
  function paintNav(){
    navs.forEach(function(x){x.classList.toggle('on',fcoll===null&&x.getAttribute('data-view')===fview);});
    cnavs.forEach(function(x){x.classList.toggle('on',fcoll!==null&&x.getAttribute('data-c')===fcoll);});
  }
  chips.forEach(function(ch){ch.onclick=function(){
    var f=ch.getAttribute('data-f');
    fstatus=(fstatus===f)?'all':f;
    chips.forEach(function(x){x.classList.toggle('on',x.getAttribute('data-f')===fstatus);});
    applyFilters();
  };});
  navs.forEach(function(nv){nv.onclick=function(){
    fview=nv.getAttribute('data-view'); fcoll=null; paintNav(); applyFilters();
  };});
  cnavs.forEach(function(cv){cv.onclick=function(){
    var c=cv.getAttribute('data-c');
    fcoll=(fcoll===c)?null:c; if(fcoll!==null) fview='all';
    paintNav(); applyFilters();
  };});
  if(search) search.oninput=applyFilters;
  if(ftype) ftype.onchange=applyFilters;
  if(fsort) fsort.onchange=applySort;
  var clearf=document.getElementById('clearf');
  if(clearf) clearf.onclick=function(){
    if(search)search.value=''; if(ftype)ftype.value=''; fstatus='all'; fview='all'; fcoll=null;
    chips.forEach(function(x){x.classList.toggle('on',x.getAttribute('data-f')==='all');});
    paintNav(); applyFilters();
  };

  // --- collapsible groups, remembered across loads ---
  var CKEY='sf-index-collapsed';
  function readCollapsed(){try{return JSON.parse(localStorage.getItem(CKEY)||'[]');}catch(e){return [];}}
  var collapsed=readCollapsed();
  grps.forEach(function(g){
    var c=g.getAttribute('data-coll');
    if(collapsed.indexOf(c)!==-1) g.classList.add('collapsed');
    var h=g.querySelector('h2'); if(!h) return;
    var chev=document.createElement('span'); chev.className='chev'; chev.textContent='\\u25be';
    h.appendChild(chev);
    h.onclick=function(){
      g.classList.toggle('collapsed');
      var next=readCollapsed().filter(function(x){return x!==c;});
      if(g.classList.contains('collapsed')) next.push(c);
      try{localStorage.setItem(CKEY,JSON.stringify(next));}catch(e){}
    };
  });

  // --- selection + bulk collection moves ---
  var bulk=document.getElementById('bulk'), bn=document.getElementById('bn'), bcoll=document.getElementById('bcoll');
  function picked(){return rows.filter(function(r){var s=r.querySelector('.sel');return s&&s.checked;});}
  function paintBulk(){
    var p=picked();
    document.body.classList.toggle('picking',p.length>0);
    if(!bulk) return;
    bulk.hidden=p.length===0;
    if(bn) bn.textContent=p.length+' selected';
  }
  function clearPick(){
    rows.forEach(function(r){var s=r.querySelector('.sel'); if(s&&s.checked){s.checked=false;r.classList.remove('picked');}});
    if(bcoll) bcoll.value='';
    paintBulk();
  }
  // Every collection move is a fan-out of one PATCH per member, and any of them
  // can fail on its own. fetch resolves for a 404 or a 403 as readily as a 200,
  // so the count of successes has to come from the status: reloading on a bare
  // Promise.all would show a half-renamed collection as a finished one.
  //
  // The reload still happens either way — it is what makes the page show the
  // true state — so the warning is handed to the next load rather than painted
  // on a page that is about to be replaced.
  function setColl(list,value,what){
    if(!list.length) return;
    Promise.all(list.map(function(r){
      return api(r.getAttribute('data-id'),'/organize','PATCH',{collection:value})
        .then(function(x){return !!(x&&x.ok);},function(){return false;});
    })).then(function(oks){
      var done=oks.filter(Boolean).length;
      if(done<list.length) warn(done+' of '+list.length+' specs moved — '+(what||'the rest')+' could not be updated');
      location.reload();
    });
  }
  // Shown now and again after the reload lands, since the reload is what
  // replaces the page the first one is painted on.
  var MSGKEY='sf-index-msg';
  function warn(text){try{sessionStorage.setItem(MSGKEY,text);}catch(e){} showMsg(text);}
  function showMsg(text){
    var el=document.createElement('div'); el.className='toast'; el.setAttribute('role','status'); el.textContent=text;
    var x=document.createElement('button'); x.type='button'; x.className='tx'; x.setAttribute('aria-label','Dismiss'); x.textContent='\\u00d7';
    x.onclick=function(){el.remove();};
    el.appendChild(x); document.body.appendChild(el);
  }
  (function showCarriedMsg(){
    var text=null;
    try{text=sessionStorage.getItem(MSGKEY); if(text) sessionStorage.removeItem(MSGKEY);}catch(e){}
    if(text) showMsg(text);
  })();
  function bulkSet(value){setColl(picked(),value);}
  var bclear=document.getElementById('bclear'), bcancel=document.getElementById('bcancel');
  if(bclear) bclear.onclick=function(){bulkSet('');};
  if(bcancel) bcancel.onclick=clearPick;

  // --- collection rename / delete (derived from meta: fan out over members) ---
  function membersOf(c){return rows.filter(function(r){return r.getAttribute('data-c')===c;});}
  function endCollEdit(crow){
    crow.querySelector('.cnav').hidden=false;
    var cin=crow.querySelector('.cin'); if(cin){cin.hidden=true;cin.value=crow.getAttribute('data-c');}
    var cf=crow.querySelector('.cconfirm'); if(cf) cf.hidden=true;
  }
  function renameColl(crow,name){
    var from=crow.getAttribute('data-c');
    if(!name||name===from){endCollEdit(crow);return;}
    setColl(membersOf(from),name,'some are still in "'+from+'"');
  }
  document.addEventListener('click',function(e){
    var t=e.target;
    if(t.classList.contains('cedit')){
      var cr=t.closest('.crow'); cr.querySelector('.cnav').hidden=true;
      var ci=cr.querySelector('.cin'); ci.hidden=false; ci.focus(); ci.select();
    } else if(t.classList.contains('cdel')){
      var cr2=t.closest('.crow'); cr2.querySelector('.cnav').hidden=true; cr2.querySelector('.cconfirm').hidden=false;
    } else if(t.classList.contains('cno')){
      endCollEdit(t.closest('.crow'));
    } else if(t.classList.contains('cyes')){
      var cr3=t.closest('.crow'), from=cr3.getAttribute('data-c');
      setColl(membersOf(from),'','some are still in "'+from+'"');
    }
  });
})();
</script>
</body></html>`;
}
