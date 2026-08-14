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

import { listSpecs, DEFAULT_TYPE } from '../lib/meta.mjs';
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

/**
 * Working specs grouped: named collections, then Uncollected.
 *
 * `ranked` is the order the user arranged (Move up / Move down). Anything it does
 * not name — a collection created since, or one never moved — falls in after,
 * alphabetically, so a fresh store reads A-Z and stays predictable until someone
 * takes a position on it. Uncollected is always last: it is the absence of a
 * collection, not one you can place.
 */
function groupByCollection(specs, ranked = []) {
  const groups = new Map();
  for (const m of specs) {
    const key = m.collection || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  const rank = new Map(ranked.map((name, i) => [name, i]));
  const at = (k) => (rank.has(k) ? rank.get(k) : Number.MAX_SAFE_INTEGER);
  const named = [...groups.keys()].filter((k) => k !== '')
    .sort((a, b) => at(a) - at(b) || a.toLowerCase().localeCompare(b.toLowerCase()));
  const order = groups.has('') ? [...named, ''] : named;
  return { order: order.map((k) => ({ key: k, specs: groups.get(k) })), named };
}

/**
 * The one actions affordance, on a spec row and on a collection alike.
 *
 * Everything it opens used to be a separate glyph that only existed while the
 * pointer was over its row — three of them on a spec, two on a collection, all at
 * opacity:0 the rest of the time, and the collection pair display:none below
 * 900px. A menu button is one target, always in the layout, reachable by tab and
 * by touch, and it has somewhere to put the next action.
 */
function kebabHtml(label) {
  return `<button class="kebab" type="button" aria-haspopup="menu" aria-expanded="false" aria-label="${esc(label)}" title="${esc(label)}">⋯</button>`;
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
  const rawType = m.type || DEFAULT_TYPE;
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
    <span class="acts">${kebabHtml(`Actions for ${title}`)}</span>
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

/**
 * One collection in the rail: the filter button, plus the actions menu.
 *
 * Named collections are draggable — dragging is how you reorder them, and the
 * menu's Move up / Move down is the same thing for a keyboard. Uncollected is
 * neither draggable nor menued: it is not a collection anyone named, so there is
 * nothing to rename, nothing to delete, and nowhere to put it but last.
 */
function collRowHtml(key, count) {
  const name = key === '' ? 'Uncollected' : esc(key);
  const acts = key === '' ? '' : kebabHtml(`Actions for ${key}`);
  const drag = key === '' ? '' : ' draggable="true"';
  return `<div class="crow" data-c="${esc(key)}"${drag}>
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
  const prefs = readGlobalPrefs();
  const theme = prefs.theme === 'dark' ? 'dark' : 'light';
  const all = listSpecs().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const tpls = all.filter((m) => m.template);
  const specs = all.filter((m) => !m.template);
  const n = specs.length;
  const sigs = new Map(specs.map((m) => [m.id, specSignals(m.id, shareInfo, m)]));
  const sigOf = (m) => sigs.get(m.id);

  const { order, named } = groupByCollection(specs, prefs.collectionOrder);

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

  .crow{display:flex;align-items:center;gap:2px;border-radius:7px}
  .crow .cnav{min-width:0}
  .crow[draggable="true"]{cursor:grab}
  .crow.dragging{opacity:.4;cursor:grabbing}
  /* While a drag is in flight the rail is a list you are rearranging, not a set
     of filters — the hover highlight would read as "click me". */
  .colls.rearranging .cnav:hover{background:none;color:var(--muted)}
  .colls.rearranging .crow:not(.dragging){box-shadow:inset 0 0 0 1px transparent}

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
  .acts{display:inline-flex;align-items:center;width:26px;justify-content:flex-end}

  /* ── the actions button, on a row and in the rail ─────────────────── */
  /* Present at all times. Dimmed, not hidden: an action you cannot see is an
     action nobody finds, and hover is not something a touch screen has. */
  .kebab{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;
         background:none;border:none;border-radius:6px;color:var(--faint);font-size:15px;line-height:1;cursor:pointer;
         transition:background .12s,color .12s}
  .kebab:hover,.kebab[aria-expanded="true"]{background:var(--surface2);color:var(--ink)}
  .row:hover .kebab{color:var(--muted)}
  .crow .kebab{opacity:.75}
  .crow:hover .kebab,.crow .kebab:focus-visible,.crow .kebab[aria-expanded="true"]{opacity:1}

  /* ── popovers: the actions menu and the collection picker ─────────── */
  .pop{position:absolute;z-index:60;background:var(--surface);border:1px solid var(--line2);border-radius:10px;
       box-shadow:0 10px 32px rgba(0,0,0,.18);padding:5px;min-width:200px}
  .pop[hidden]{display:none}
  .mitem{display:flex;align-items:center;gap:9px;width:100%;height:30px;padding:0 9px;border:none;border-radius:7px;
         background:none;color:var(--ink);font-size:13px;text-align:left;cursor:pointer}
  .mitem:hover{background:var(--surface2)}
  .mitem.danger{color:var(--red)}
  .mitem.danger:hover{background:color-mix(in srgb,var(--red) 12%,transparent)}
  .mic{width:15px;text-align:center;color:var(--faint);flex:none}
  .mitem.danger .mic{color:inherit}
  .msep{height:1px;margin:5px 7px;background:var(--line)}

  .pick{width:262px;padding:8px}
  .pfilter{width:100%;height:30px;padding:0 10px;margin-bottom:6px;border:1px solid var(--line);border-radius:7px;
           background:var(--bg);color:var(--ink);font:inherit;font-size:13px}
  .pfilter:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
  .plist{max-height:236px;overflow-y:auto}
  .pitem{display:flex;align-items:center;gap:8px;width:100%;height:30px;padding:0 8px;border:none;border-radius:7px;
         background:none;color:var(--ink);font-size:13px;text-align:left;cursor:pointer}
  .pitem:hover,.pitem.active{background:var(--surface2)}
  .pitem.on{color:var(--accent);font-weight:560}
  .ptick{width:13px;flex:none;color:var(--accent)}
  .pname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .pcount{margin-left:auto;font-size:11.5px;color:var(--faint);font-variant-numeric:tabular-nums}
  .pnone{border-top:1px solid var(--line);margin-top:5px;padding-top:5px;border-radius:0 0 7px 7px}
  .pnew{display:flex;align-items:center;gap:8px;width:100%;height:30px;margin-top:5px;padding:0 8px;
        border:none;border-top:1px solid var(--line);border-radius:0;background:none;color:var(--accent);
        font-size:13px;text-align:left;cursor:pointer}
  .pnew[hidden]{display:none}
  .pnew:hover{background:var(--accent-soft)}
  .pempty{padding:8px;color:var(--faint);font-size:12.5px;text-align:center}

  /* ── dialogs (native <dialog>: Esc, focus trap and backdrop for free) ── */
  .dlg{width:min(94vw,400px);padding:18px;border:1px solid var(--line2);border-radius:12px;
       background:var(--surface);color:var(--ink);box-shadow:0 18px 48px rgba(0,0,0,.3)}
  .dlg::backdrop{background:rgba(12,14,18,.42)}
  .dlg h3{margin:0 0 12px;font-size:15px;font-weight:600;letter-spacing:-.01em}
  .dlab{display:block;margin-bottom:5px;font-size:12px;color:var(--muted)}
  .din{width:100%;height:34px;padding:0 10px;border:1px solid var(--line);border-radius:8px;
       background:var(--bg);color:var(--ink);font:inherit;font-size:13.5px}
  .din:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
  .dbody{margin:0;font-size:13.5px;color:var(--muted);line-height:1.55}
  .dbody b{color:var(--ink);font-weight:600}
  .dacts{display:flex;justify-content:flex-end;gap:8px;margin-top:18px}
  .btn{height:32px;padding:0 14px;border:1px solid var(--line2);border-radius:8px;background:none;color:var(--ink);
       font-size:13px;cursor:pointer;transition:background .12s,border-color .12s,filter .12s}
  .btn:hover{background:var(--surface2)}
  .btn.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:560}
  .btn.danger{background:var(--red);border-color:var(--red);color:#fff;font-weight:560}
  .btn.primary:hover,.btn.danger:hover{filter:brightness(1.08);background:var(--accent)}
  .btn.danger:hover{background:var(--red)}

  /* ── bulk bar ─────────────────────────────────────────────────────── */
  .bulk{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:20;display:flex;align-items:center;gap:10px;
        padding:8px 12px;border:1px solid var(--line2);border-radius:11px;background:var(--surface);box-shadow:0 8px 28px rgba(0,0,0,.16)}
  .bulk[hidden]{display:none}
  .bn{font-size:12.5px;font-weight:560;white-space:nowrap}
  .bsep{width:1px;height:20px;background:var(--line)}
  .bbtn{height:28px;padding:0 11px;border:1px solid var(--line);border-radius:7px;background:none;color:var(--muted);font-size:12.5px;cursor:pointer}
  .bbtn:hover{color:var(--ink);border-color:var(--line2)}
  .bbtn.primary{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:560}
  .bbtn.primary:hover{color:#fff;filter:brightness(1.08)}

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
  .search:focus-visible,.addtag-in:focus-visible,.pfilter:focus-visible,.din:focus-visible{outline:none}

  @media(max-width:1180px){.badge.t{display:none}}
  @media(max-width:900px){
    .app{display:block}
    .side{position:static;width:auto;height:auto;border-right:none;border-bottom:1px solid var(--line);padding-bottom:12px}
    .side .brand{height:48px}
    .views,.colls{display:flex;flex-wrap:wrap;gap:4px}
    .nav,.cnav{width:auto}
    .crow{width:auto}
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
  <select class="tsel" id="ftype" aria-label="Filter by type"><option value="">All types</option><option>design</option><option>research</option><option>design-impl</option><option>impl</option></select>
  <select class="tsel" id="fsort" aria-label="Sort"><option value="recent">Recent</option><option value="title">Title A–Z</option><option value="status">Status</option></select>
  <span class="count" id="count">${n} spec${n === 1 ? '' : 's'}</span>
</div>` : ''}
</div></div>
<div class="wrap">
${n ? `<div id="groups">${groups}</div>\n<div id="nohits">No specs match. <button type="button" id="clearf">Clear filters</button></div>`
    : '<p class="empty">No specs yet. Create one with <code>/specforge:create</code>.</p>'}
${strip}
</div>
</main>
</div>
<div class="bulk" id="bulk" hidden>
  <span class="bn" id="bn">0 selected</span><span class="bsep"></span>
  <button class="bbtn primary" id="bmove" type="button" aria-haspopup="dialog" aria-expanded="false">Move to collection…</button>
  <button class="bbtn" id="bcancel" type="button">Cancel</button>
</div>

<!-- One menu, one picker, two dialogs — reused by every row and every collection,
     so there is exactly one of each interaction to learn and to maintain. -->
<div class="pop menu" id="menu" role="menu" hidden></div>
<div class="pop pick" id="cpick" role="dialog" aria-label="Move to collection" hidden>
  <input class="pfilter" id="pfilter" type="text" autocomplete="off" placeholder="Filter or new name…" aria-label="Filter collections, or type a new name">
  <div class="plist" id="plist"></div>
  <button class="pnew" id="pnew" type="button" hidden></button>
</div>
<dialog class="dlg" id="dprompt" aria-labelledby="dp-title">
  <h3 id="dp-title">Rename</h3>
  <label class="dlab" id="dp-label" for="dp-input">Name</label>
  <input class="din" id="dp-input" type="text" autocomplete="off">
  <div class="dacts"><button class="btn" id="dp-cancel" type="button">Cancel</button><button class="btn primary" id="dp-ok" type="button">Save</button></div>
</dialog>
<dialog class="dlg" id="dconfirm" aria-labelledby="dc-title">
  <h3 id="dc-title">Delete</h3>
  <p class="dbody" id="dc-body"></p>
  <div class="dacts"><button class="btn" id="dc-cancel" type="button">Cancel</button><button class="btn danger" id="dc-ok" type="button">Delete</button></div>
</dialog>
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
      row.getAttribute('data-c')].join(' ').toLowerCase());
  }
  function endAddTag(row){row.querySelector('.addtag').hidden=false;row.querySelector('.addtag-in').hidden=true;}
  // ---- one popover at a time: the actions menu and the collection picker ----
  var pop=null, popOwner=null;
  function place(el,anchor){
    // Below the button, right-aligned to it, flipped up when the bottom is close.
    var r=anchor.getBoundingClientRect(), sx=window.pageXOffset, sy=window.pageYOffset;
    el.hidden=false;
    var w=el.offsetWidth||220, h=el.offsetHeight||160;
    var left=Math.max(8,Math.min(r.right+sx-w, sx+document.documentElement.clientWidth-w-8));
    var below=r.bottom+sy+6, above=r.top+sy-h-6;
    el.style.left=left+'px';
    el.style.top=(r.bottom+h+10>window.innerHeight&&above>sy?above:below)+'px';
  }
  function openPop(el,anchor){
    closePop();
    pop=el; popOwner=anchor;
    place(el,anchor);
    if(anchor) anchor.setAttribute('aria-expanded','true');
  }
  function closePop(){
    if(!pop) return;
    pop.hidden=true;
    if(popOwner) popOwner.setAttribute('aria-expanded','false');
    pop=null; popOwner=null;
  }

  /** items: {icon,label,run} or {sep:true}. */
  function openMenu(anchor,items){
    var m=document.getElementById('menu');
    m.innerHTML='';
    items.forEach(function(it){
      if(it.sep){var s=document.createElement('div');s.className='msep';m.appendChild(s);return;}
      var b=document.createElement('button');
      b.type='button'; b.className='mitem'+(it.danger?' danger':''); b.setAttribute('role','menuitem');
      var ic=document.createElement('span'); ic.className='mic'; ic.textContent=it.icon; ic.setAttribute('aria-hidden','true');
      var lb=document.createElement('span'); lb.textContent=it.label;
      b.appendChild(ic); b.appendChild(lb);
      b.onclick=function(){
        // Focus goes back to the button that opened the menu before the action
        // runs — so Move up leaves you on the collection you moved, wherever it
        // landed — and an action that opens a dialog or the picker takes it from
        // there, since it focuses its own field synchronously.
        var owner=popOwner;
        closePop();
        if(owner&&owner.focus) owner.focus();
        it.run();
      };
      m.appendChild(b);
    });
    // role="menu" promises arrow keys; this is that promise.
    m.onkeydown=function(e){
      var all=[].slice.call(m.querySelectorAll('.mitem'));
      var i=all.indexOf(document.activeElement);
      var to=null;
      if(e.key==='ArrowDown') to=all[(i+1)%all.length];
      else if(e.key==='ArrowUp') to=all[(i<=0?all.length:i)-1];
      else if(e.key==='Home') to=all[0];
      else if(e.key==='End') to=all[all.length-1];
      if(to){e.preventDefault(); to.focus();}
    };
    openPop(m,anchor);
    var first=m.querySelector('.mitem'); if(first) first.focus();
  }

  // ---- the collection picker: pick a name, never spell one ----
  // The list is read off the rows, which is where the collections live (they are
  // derived from spec meta, not stored anywhere of their own).
  function collections(){
    var counts={};
    rows.forEach(function(r){var c=r.getAttribute('data-c'); if(c) counts[c]=(counts[c]||0)+1;});
    return Object.keys(counts).sort(function(a,b){return a.toLowerCase().localeCompare(b.toLowerCase());})
      .map(function(k){return {name:k,count:counts[k]};});
  }
  function pickItem(value,label,count,current){
    var b=document.createElement('button');
    b.type='button'; b.className='pitem'+(value===current?' on':'')+(value===''?' pnone':'');
    b.setAttribute('data-v',value);
    var tick=document.createElement('span'); tick.className='ptick'; tick.textContent=value===current?'\\u2713':''; tick.setAttribute('aria-hidden','true');
    var name=document.createElement('span'); name.className='pname'; name.textContent=label;
    b.appendChild(tick); b.appendChild(name);
    if(count!=null){var c=document.createElement('span'); c.className='pcount'; c.textContent=count; b.appendChild(c);}
    return b;
  }
  /**
   * @param anchor the button it hangs off
   * @param current the collection the target is in now ('' = uncollected)
   * @param onPick called with the chosen name ('' to ungroup)
   */
  function openPicker(anchor,current,onPick){
    var pick=document.getElementById('cpick'), list=document.getElementById('plist');
    var filter=document.getElementById('pfilter'), create=document.getElementById('pnew');
    var all=collections();
    filter.value='';
    function paint(){
      var q=filter.value.trim(), lq=q.toLowerCase();
      list.innerHTML='';
      var hits=all.filter(function(c){return !lq||c.name.toLowerCase().indexOf(lq)!==-1;});
      hits.forEach(function(c){list.appendChild(pickItem(c.name,c.name,c.count,current));});
      // Uncollected is a destination, not a collection: it never matches a filter
      // and never carries a count, it is just "take this out of wherever it is".
      if(!q) list.appendChild(pickItem('','Uncollected',null,current));
      else if(!hits.length){var e=document.createElement('div'); e.className='pempty'; e.textContent='No collection matches'; list.appendChild(e);}
      // Offered only when what you typed is not already a collection — otherwise
      // "Create" beside the identically named thing invites a duplicate.
      var exact=all.some(function(c){return c.name.toLowerCase()===lq;});
      create.hidden=!q||exact;
      create.textContent='';
      var plus=document.createElement('span'); plus.className='mic'; plus.textContent='+'; plus.setAttribute('aria-hidden','true');
      var lbl=document.createElement('span'); lbl.textContent='Create "'+q+'"';
      create.appendChild(plus); create.appendChild(lbl);
    }
    function choose(v){closePop(); onPick(v);}
    paint();
    filter.oninput=paint;
    list.onclick=function(e){var b=e.target.closest('.pitem'); if(b) choose(b.getAttribute('data-v'));};
    create.onclick=function(){var v=filter.value.trim(); if(v) choose(v);};
    filter.onkeydown=function(e){
      if(e.key!=='Enter') return;
      e.preventDefault();
      var first=list.querySelector('.pitem');
      if(!create.hidden){create.onclick();}
      else if(first){choose(first.getAttribute('data-v'));}
    };
    openPop(pick,anchor);
    filter.focus();
  }

  // ---- dialogs ----
  // jsdom has no <dialog> behaviour at all, so both calls are guarded: a real
  // browser gets showModal (focus trap, Esc, backdrop) and the test DOM gets the
  // open attribute, which is what showModal reflects anyway.
  function showDlg(d){ if(d.showModal) d.showModal(); else d.setAttribute('open',''); }
  function hideDlg(d){ if(d.close) d.close(); else d.removeAttribute('open'); }
  /** @param o {title,label,value,ok,onOk} */
  function askName(o){
    var d=document.getElementById('dprompt'), i=document.getElementById('dp-input');
    document.getElementById('dp-title').textContent=o.title;
    document.getElementById('dp-label').textContent=o.label;
    document.getElementById('dp-ok').textContent=o.ok||'Save';
    i.value=o.value||'';
    d.onOk=function(){var v=i.value.trim(); if(v&&v!==o.value) o.onOk(v);};
    showDlg(d); i.focus(); i.select();
  }
  /** @param o {title,body,ok,onOk} */
  function askConfirm(o){
    var d=document.getElementById('dconfirm');
    document.getElementById('dc-title').textContent=o.title;
    document.getElementById('dc-body').textContent=o.body;
    document.getElementById('dc-ok').textContent=o.ok||'Delete';
    d.onOk=o.onOk;
    showDlg(d);
    document.getElementById('dc-cancel').focus();
  }
  (function wireDialogs(){
    [['dprompt','dp-ok','dp-cancel'],['dconfirm','dc-ok','dc-cancel']].forEach(function(ids){
      var d=document.getElementById(ids[0]);
      document.getElementById(ids[1]).onclick=function(){var f=d.onOk; hideDlg(d); if(f) f();};
      document.getElementById(ids[2]).onclick=function(){hideDlg(d);};
    });
    document.getElementById('dp-input').onkeydown=function(e){
      if(e.key==='Enter'){e.preventDefault(); document.getElementById('dp-ok').click();}
    };
  })();

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
    // Anywhere that is not the open popover or the button that opened it.
    if(pop&&!t.closest('.pop')&&t!==popOwner&&!(popOwner&&popOwner.contains(t))) closePop();
    if(t.classList.contains('addtag')){var r2=rowOf(t);t.hidden=true;var a=r2.querySelector('.addtag-in');a.hidden=false;a.value='';a.focus();}
    else if(t.classList.contains('x')){var r3=rowOf(t),chip=t.closest('.chip'),id=r3.getAttribute('data-id');
      var next=tagsOf(r3).filter(function(x){return x!==chip.getAttribute('data-tag');});
      api(id,'/organize','PATCH',{tags:next}).then(function(){chip.remove();updateKey(r3);}).catch(function(){});}
    else if(t.classList.contains('kebab')){
      // The same button in two places; which menu it opens is decided by what it
      // sits in, so neither the row nor the rail needs its own handler.
      if(pop===document.getElementById('menu')&&popOwner===t){closePop();return;}
      var row=rowOf(t);
      if(row) rowMenu(t,row); else collMenu(t,t.closest('.crow'));
    }
  });

  function rowMenu(btn,row){
    var id=row.getAttribute('data-id'), title=row.querySelector('.title').textContent;
    openMenu(btn,[
      {icon:'\\u270e',label:'Rename\\u2026',run:function(){
        askName({title:'Rename spec',label:'Name',value:title,onOk:function(v){
          api(id,'/rename','POST',{title:v}).then(function(x){return x.ok?x.json():null;}).then(function(d){
            if(d){row.querySelector('.title').textContent=d.title;updateKey(row);}
          }).catch(function(){});
        }});
      }},
      {icon:'\\u25a4',label:'Move to collection\\u2026',run:function(){
        openPicker(btn,row.getAttribute('data-c'),function(v){setColl([row],v);});
      }},
      {sep:true},
      {icon:'\\ud83d\\uddd1',label:'Delete spec\\u2026',danger:true,run:function(){
        askConfirm({title:'Delete spec',body:'Delete "'+title+'"? This cannot be undone.',onOk:function(){
          // Key on the HTTP status: a non-2xx (404/403-template/500) means the
          // spec was NOT deleted, so keep the row.
          api(id,'','DELETE').then(function(x){
            if(!x||!x.ok) throw new Error('delete failed');
            row.remove(); removeRow(id);
          }).catch(function(){});
        }});
      }},
    ]);
  }

  function collMenu(btn,crow){
    var name=crow.getAttribute('data-c');
    var items=[];
    if(crow.previousElementSibling) items.push({icon:'\\u2191',label:'Move up',run:function(){moveColl(crow,-1);}});
    if(nextNamed(crow)) items.push({icon:'\\u2193',label:'Move down',run:function(){moveColl(crow,1);}});
    if(items.length) items.push({sep:true});
    openMenu(btn,items.concat([
      {icon:'\\u270e',label:'Rename\\u2026',run:function(){
        askName({title:'Rename collection',label:'Collection name',value:name,onOk:function(v){
          // The order is a list of names, so a rename has to be applied to it too
          // — and before the reload the move fans out into, or the collection
          // reappears at the bottom under its new name.
          putOrderThen(collOrder().map(function(c){return c===name?v:c;}),function(){
            setColl(membersOf(name),v,'some are still in "'+name+'"');
          });
        }});
      }},
      {icon:'\\ud83d\\uddd1',label:'Delete collection\\u2026',danger:true,run:function(){
        var n=membersOf(name).length;
        askConfirm({
          title:'Delete collection',
          // Says what actually happens, because "delete" next to a count of specs
          // reads like it takes the specs with it. It does not.
          body:'Delete "'+name+'"? '+(n===1
            ?'Its 1 spec is not deleted \\u2014 it becomes uncollected.'
            :'Its '+n+' specs are not deleted \\u2014 they become uncollected.'),
          onOk:function(){
            putOrderThen(collOrder().filter(function(c){return c!==name;}),function(){
              setColl(membersOf(name),'','some are still in "'+name+'"');
            });
          },
        });
      }},
    ]));
  }

  // ---- collection order (Move up / Move down) ----
  // The rail is the order. Reading it back off the DOM means the two can never
  // disagree, and a move is then a DOM move plus one PUT — no reload, so the
  // scroll position and any open filter survive it.
  var colls=document.getElementById('colls');
  /** The named collections, top to bottom. Uncollected is not one of them. */
  function collOrder(){
    return [].slice.call(document.querySelectorAll('.crow')).map(function(c){return c.getAttribute('data-c');})
      .filter(function(c){return c!=='';});
  }
  /** The next collection row that is not Uncollected, which never moves. */
  function nextNamed(crow){
    var n=crow.nextElementSibling;
    return n&&n.getAttribute('data-c')!==''?n:null;
  }
  var ORDER_FAILED='The collection order could not be saved.';
  /** Store the order. @param done called with whether it landed. */
  function putOrder(order,done){
    fetch('/api/prefs',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({collectionOrder:order})})
      .then(function(x){done(!!(x&&x.ok));},function(){done(false);});
  }
  /**
   * Write the order a rename or a delete implies, then do the thing itself —
   * whether or not the write landed. Refusing to rename a collection because a
   * cosmetic order failed to save would be the worse failure. The message is the
   * carried one, since what follows reloads the page over the top of it.
   */
  function putOrderThen(order,then){
    putOrder(order,function(ok){ if(!ok) warn(ORDER_FAILED); then(); });
  }
  function grpFor(name){
    for(var i=0;i<grps.length;i++){ if(grps[i].getAttribute('data-coll')===name) return grps[i]; }
    return null;
  }
  /**
   * Put the list in the rail's order. The page's groups are the same order and
   * the two must never read differently, so this runs after every rail change.
   * Appending in sequence is the whole algorithm; Uncollected goes last because
   * it is the absence of a collection, not a position anyone chose.
   */
  function syncGroups(){
    var host=document.getElementById('groups');
    if(!host) return;
    collOrder().forEach(function(name){ var g=grpFor(name); if(g) host.appendChild(g); });
    var un=grpFor(''); if(un) host.appendChild(un);
  }
  /** Restore an order taken earlier from collOrder() — the undo for a failed write. */
  function setRail(order){
    var un=null;
    order.forEach(function(name){
      for(var i=0;i<crows.length;i++){ if(crows[i].getAttribute('data-c')===name) colls.appendChild(crows[i]); }
    });
    for(var i=0;i<crows.length;i++){ if(crows[i].getAttribute('data-c')==='') un=crows[i]; }
    if(un) colls.appendChild(un);
    syncGroups();
  }
  /**
   * Persist the rail as it now stands, and put it back if the write does not
   * land.
   *
   * One write is in flight at a time and a move made during one is coalesced
   * into a single write after it, because the rail IS the desired state — there
   * is nothing to queue but "send it again". Letting them overlap would let two
   * settle out of order, and an older failure would then roll back over a newer
   * order that did save.
   *
   * The rollback target is the last order the store is KNOWN to hold, not the
   * one this move started from: after a coalesced write, "before" is a position
   * halfway through a gesture that was never stored.
   */
  var savedOrder=null, writing=false, pendingWrite=false;
  function commitOrder(){
    if(writing){ pendingWrite=true; return; }
    writing=true;
    var sending=collOrder();
    putOrder(sending,function(ok){
      writing=false;
      if(ok) savedOrder=sending;
      // A move made while this was in flight is a newer statement of intent than
      // this result. Send that instead — rolling back first would wipe it off
      // the rail and then store the wipe. If it fails in turn, ITS handler is
      // the one that rolls back, to the same place.
      if(pendingWrite){ pendingWrite=false; commitOrder(); return; }
      if(!ok){ showMsg(ORDER_FAILED); setRail(savedOrder||sending); }
    });
  }
  function moveColl(crow,dir){
    var sib=dir<0?crow.previousElementSibling:nextNamed(crow);
    if(!sib) return;
    if(dir<0) colls.insertBefore(crow,sib); else colls.insertBefore(sib,crow);
    syncGroups();
    commitOrder();
  }

  // ---- drag to reorder ----
  // The row moves under the pointer rather than a line being drawn between rows:
  // the rail is short and the result is the preview, so there is nothing to
  // interpret about where it will land. Uncollected is not a target and never a
  // passenger, which is why every lookup here filters it out.
  var crows=[].slice.call(document.querySelectorAll('.crow'));
  // What the store holds right now: the page was rendered from it.
  savedOrder=collOrder();
  var dragging=null, dragFrom=null;
  if(colls){
    colls.addEventListener('dragstart',function(e){
      var row=e.target.closest&&e.target.closest('.crow');
      if(!row||row.getAttribute('data-c')==='') return;
      dragging=row; dragFrom=collOrder();
      row.classList.add('dragging');
      colls.classList.add('rearranging');
      closePop();
      if(e.dataTransfer){
        e.dataTransfer.effectAllowed='move';
        // Firefox starts no drag at all without something on the transfer.
        try{e.dataTransfer.setData('text/plain',row.getAttribute('data-c'));}catch(err){}
      }
    });
    colls.addEventListener('dragover',function(e){
      if(!dragging) return;
      var over=e.target.closest&&e.target.closest('.crow');
      if(!over||over===dragging||over.getAttribute('data-c')==='') return;
      e.preventDefault();
      if(e.dataTransfer) e.dataTransfer.dropEffect='move';
      var r=over.getBoundingClientRect();
      var after=e.clientY>r.top+r.height/2;
      colls.insertBefore(dragging,after?over.nextSibling:over);
      syncGroups();
    });
    // Dropping is not what commits — dragend fires for a drop and for an abort
    // alike, and by then the rail already reads the way it will stay.
    colls.addEventListener('drop',function(e){e.preventDefault();});
    colls.addEventListener('dragend',function(){
      if(!dragging) return;
      dragging.classList.remove('dragging');
      colls.classList.remove('rearranging');
      var before=dragFrom;
      dragging=null; dragFrom=null;
      if(before.join('\\u0000')!==collOrder().join('\\u0000')) commitOrder();
    });
  }

  document.addEventListener('keydown',function(e){
    var t=e.target;
    if(e.key==='/'&&!(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'))){
      var s=document.getElementById('search'); if(s){e.preventDefault();s.focus();s.select();} return;
    }
    if(e.key==='Escape'&&pop){var o=popOwner;closePop();if(o&&o.focus)o.focus();return;}
    // A modal dialog handles its own Escape; the keypress still bubbles to here,
    // and clearing the selection out from under an open dialog is a surprise.
    if(e.key==='Escape'&&document.querySelector('.dlg[open]')) return;
    if(t.classList&&t.classList.contains('addtag-in')){
      if(e.key==='Enter'){var r2=rowOf(t),id2=r2.getAttribute('data-id'),v2=t.value.trim(),cur=tagsOf(r2);
        if(v2 && cur.map(function(x){return x.toLowerCase();}).indexOf(v2.toLowerCase())===-1){
          api(id2,'/organize','PATCH',{tags:cur.concat([v2])}).then(function(x){return x.ok?x.json():null;}).then(function(d){if(d){paintChips(r2,d.tags);updateKey(r2);}endAddTag(r2);}).catch(function(){endAddTag(r2);});
        } else {endAddTag(r2);}}
      else if(e.key==='Escape'){endAddTag(rowOf(t));}
    } else if(t.id==='search'&&e.key==='Escape'){t.value='';t.blur();applyFilters();}
    else if(e.key==='Escape'){clearPick();}
  });

  document.addEventListener('change',function(e){
    if(e.target.classList.contains('sel')){
      var rs=rowOf(e.target); if(rs) rs.classList.toggle('picked',e.target.checked);
      paintBulk();
    }
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
  var bulk=document.getElementById('bulk'), bn=document.getElementById('bn');
  function picked(){return rows.filter(function(r){var s=r.querySelector('.sel');return s&&s.checked;});}
  function paintBulk(){
    var p=picked();
    document.body.classList.toggle('picking',p.length>0);
    if(!bulk) return;
    bulk.hidden=p.length===0;
    if(bn) bn.textContent=p.length+' selected';
  }
  function clearPick(){
    closePop();
    rows.forEach(function(r){var s=r.querySelector('.sel'); if(s&&s.checked){s.checked=false;r.classList.remove('picked');}});
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
  // The selection moves through the same picker a single row does, so there is
  // one way to name a destination rather than a menu here and a text field there.
  var bmove=document.getElementById('bmove'), bcancel=document.getElementById('bcancel');
  if(bmove) bmove.onclick=function(){
    if(pop===document.getElementById('cpick')&&popOwner===bmove){closePop();return;}
    // No current collection: the selection may span several.
    openPicker(bmove,null,function(v){setColl(picked(),v);});
  };
  if(bcancel) bcancel.onclick=clearPick;

  /** A collection is derived from meta, so its members are its only definition. */
  function membersOf(c){return rows.filter(function(r){return r.getAttribute('data-c')===c;});}
})();
</script>
</body></html>`;
}
