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

import { listSpecs, LEGACY_TYPE } from '../lib/meta.mjs';
import { specTypes } from '../lib/spec-types.mjs';
import { sessionDisplay } from '../lib/session-label.mjs';
import { readGlobalPrefs } from '../lib/global-prefs.mjs';
import { specSignals, REVIEW_TITLE } from '../lib/spec-signals.mjs';
import { STATUSES } from '../lib/lifecycle.mjs';
import { readSubscriptions } from '../lib/store-subscriptions.mjs';
import { groupByCollection } from '../lib/collections.mjs';
import { THEME_CSS, BODY_FONT, CONTENT_WIDTH, LIST_CSS } from './theme.mjs';

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

/** "attached?" label: the friendly session label when owned, 'free' otherwise. */
function attachedLabel(meta) {
  return meta.attachedSession ? esc(sessionDisplay(meta)) : 'free';
}

/** The hostname of a share URL, which is the part worth showing in a strip. */
function prettyHost(url) {
  try {
    return new URL(url).hostname.replace(/\.trycloudflare\.com$/, '');
  } catch {
    return String(url || '');
  }
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
/**
 * Working specs grouped by project: named projects, then No project.
 *
 * The ranking rule is groupByCollection's, one level up. The difference is that
 * a name in `ranked` with no specs is still a group: a project is created before
 * anything is filed into it, and one you cannot see is one you cannot drop a
 * spec into. A collection has no such moment — it comes into being by having a
 * member — so groupByCollection has nothing to add.
 *
 * No project is always last and always present, even at zero, because it is
 * where a spec goes when it is taken out of everything else.
 */
function groupByProject(specs, ranked = []) {
  const groups = new Map();
  for (const m of specs) {
    const key = m.project || '';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  }
  for (const name of ranked) if (name && !groups.has(name)) groups.set(name, []);
  const rank = new Map(ranked.map((name, i) => [name, i]));
  const at = (k) => (rank.has(k) ? rank.get(k) : Number.MAX_SAFE_INTEGER);
  const named = [...groups.keys()].filter((k) => k !== '')
    .sort((a, b) => at(a) - at(b) || a.toLowerCase().localeCompare(b.toLowerCase()));
  return {
    order: [...named, ''].map((k) => ({ key: k, specs: groups.get(k) || [] })),
    named,
  };
}

// groupByCollection now lives in lib/collections.mjs: the public project page
// groups the same way, and the two must not drift.

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
  const rawType = m.type || LEGACY_TYPE;
  const rawStatus = m.status || 'draft';
  const att = attachedLabel(m);
  const tags = Array.isArray(m.tags) ? m.tags : [];
  const coll = m.collection || '';
  const proj = m.project || '';
  const key = esc(`${m.id} ${titleRaw} ${rawType} ${rawStatus} ${m.attachedSession ? sessionDisplay(m) : 'free'} ${tags.join(' ')} ${coll} ${proj}`.toLowerCase());
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
  return `<li class="row${edge}" data-k="${key}" data-id="${id}" data-s="${esc(rawStatus)}" data-t="${esc(rawType)}" data-u="${m.updated || 0}" data-c="${esc(coll)}" data-p="${esc(proj)}" data-rv="${esc(sig.review)}" data-lv="${isLive ? 1 : 0}" data-pb="${sig.shareLive ? 1 : 0}">
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

/** The label a project key reads as. '' is the absence of one, never a name. */
const NO_PROJECT = 'No project';

/**
 * One project in the rail.
 *
 * All projects and No project are neither draggable nor menued, for the reason
 * Uncollected is not: neither is a project anyone named, so there is nothing to
 * rename, nothing to delete, and nowhere to put them but first and last.
 * `kind` is 'all' | 'none' | 'named'.
 */
/**
 * A subscription card: a link out to the owner's origin, never a proxy.
 *
 * The server renders the last-known name; the client refreshes name and spec
 * count from the remote's public meta on every load, and a fetch that fails
 * flips the card to unreachable — the honest state when the owner's machine is
 * off (spec 82f5dabccf, R2).
 */
function subRowHtml(s) {
  const href = `${s.origin}/p/${s.token}`;
  return `<a class="srow" href="${esc(href)}" target="_blank" rel="noopener" data-meta="${esc(`${href}/api/meta`)}">
    <span class="sname">${esc(s.name)}</span><span class="snc" hidden></span><span class="soff" hidden>unreachable</span>
  </a>`;
}

function projRowHtml(key, count, kind, selected, share) {
  const on = selected ? ' on' : '';
  const label = kind === 'all' ? 'All projects' : kind === 'none' ? NO_PROJECT : esc(key);
  const attr = kind === 'all' ? 'data-all="1"' : `data-p="${esc(key)}"`;
  const acts = kind === 'named' ? kebabHtml(`Actions for ${key}`) : '';
  const drag = kind === 'named' ? ' draggable="true"' : '';
  // The URL rides on the row so the header can read it off the selection
  // without a second request, and so a menu built later already knows. Only
  // when the tunnel actually answers: advertising a link that does not serve
  // is worse than showing none, which is the rule the spec badge follows.
  const url = share && share.live && share.url ? ` data-share-url="${esc(share.url)}"` : '';
  const mark = url ? `<span class="pshared" title="Shared">${ICON_SHARE}</span>` : '';
  return `<div class="prow" ${attr}${drag}${url}>
    <button class="pnav${on}" type="button" ${attr}><span class="projname">${label}</span>${mark}<span class="nc">${count}</span></button>
    ${acts}
  </div>`;
}

/**
 * @param {object} [opts]
 * @param {(id:string) => {url:string|null, live:boolean}|null} [opts.shareInfo]
 *   from the daemon's publications registry. The record on disk holds only a
 *   token, so the public URL is composed by whoever knows the current origin.
 * @param {string|null} [opts.project] the ?project= override, from a spec page's
 *   header chip. Wins over the stored selection for this render; the page then
 *   persists it the way a rail click does, so the two converge without the GET
 *   itself writing anything.
 */
export function renderIndex({ shareInfo, projectShareInfo, project } = {}) {
  const prefs = readGlobalPrefs();
  const subs = readSubscriptions();
  const theme = prefs.theme === 'dark' ? 'dark' : 'light';
  const all = listSpecs().sort((a, b) => (b.updated || 0) - (a.updated || 0));
  // Templates are excluded from the list; they are configuration and live on
  // /settings now (spec 094abd0b9d, P7).
  const specs = all.filter((m) => !m.template);
  const n = specs.length;
  const sigs = new Map(specs.map((m) => [m.id, specSignals(m.id, shareInfo, m)]));
  const sigOf = (m) => sigs.get(m.id);

  const projOrder = groupByProject(specs, prefs.projects).order;
  // A selection naming a project that no longer exists is not an error worth
  // reporting: it happens whenever a project is deleted with the page open
  // elsewhere. It falls back to All projects, which shows everything, rather
  // than to an empty pane that looks like the store lost the specs.
  const known = new Set(projOrder.map((p) => p.key));
  const asked = typeof project === 'string' ? project : prefs.project;
  const selected = typeof asked === 'string' && known.has(asked) ? asked : null;
  // The collections rail is one row per distinct name across the whole store,
  // not one per (project, collection) pair. The order is a flat list of names
  // shared across projects, so a name has one row and one rank wherever it is
  // used; the client hides the rows the selected project has no members of.
  const { order, named } = groupByCollection(specs, prefs.collectionOrder);
  const inView = selected === null ? specs : specs.filter((m) => (m.project || '') === selected);

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

  // Counted within the selected project, which is what the rail is filtering.
  const collRows = order.map(({ key }) => collRowHtml(
    key,
    inView.filter((m) => (m.collection || '') === key).length,
  )).join('\n');

  const pShare = typeof projectShareInfo === 'function' ? projectShareInfo : () => null;
  const projRows = [
    projRowHtml('', n, 'all', selected === null),
    ...projOrder.map(({ key, specs: list }) => projRowHtml(
      key, list.length, key === '' ? 'none' : 'named', selected === key,
      key === '' ? null : pShare(key),
    )),
  ].join('\n');
  // The header's share control, for the project currently on screen. Its state
  // is re-derived client-side on every selection change, from the rail row.
  const selShare = selected ? pShare(selected) : null;
  const selLive = !!(selShare && selShare.live && selShare.url);

  // Groups are keyed by the pair: a project section holding one collection
  // section per collection IN THAT PROJECT. An empty project gets a rail row but
  // no section, because there is nothing to head.
  //
  // Every project's section is rendered, because switching between them is a DOM
  // pass rather than a request. The ones the selection excludes are rendered
  // already hidden, so the page the server sends agrees with the header and the
  // counts it also sends — with no script, or before it runs, a selected project
  // must not show another project's specs.
  //
  // `lead` marks the first section that is actually SHOWN, at both levels. The
  // top-of-list spacing hangs off it rather than off :first-child, because a
  // filter hides sections without reordering them: :first-child would keep
  // giving the tight spacing to something the reader cannot see, and the first
  // visible project would sit under the gap meant to separate it from another.
  // The client re-marks it on every filter pass; this is the same answer for the
  // first paint.
  let leadProject = true;
  const groups = projOrder.filter(({ specs: list }) => list.length).map(({ key: pk, specs: plist }) => {
    const inner = groupByCollection(plist, prefs.collectionOrder).order.map(({ key, specs: list }, i) => `<section class="grp${i === 0 ? ' lead' : ''}" data-p="${esc(pk)}" data-coll="${esc(key)}">
  <h2>${key === '' ? 'Uncollected' : esc(key)} <span class="gcount">${list.length}</span></h2>
  <div class="card"><ul class="rows">${list.map((m) => rowHtml(m, sigOf(m))).join('\n')}</ul></div>
</section>`).join('\n');
    const hidden = selected !== null && selected !== pk;
    const off = hidden ? ' style="display:none"' : '';
    const lead = !hidden && leadProject ? ' lead' : '';
    if (!hidden) leadProject = false;
    return `<section class="pgrp${lead}" data-p="${esc(pk)}"${off}>
  <h2 class="ph">${pk === '' ? NO_PROJECT : esc(pk)} <span class="gcount">${plist.length}</span></h2>
${inner}
</section>`;
  }).join('\n');

  // The templates strip moved to /settings (spec 094abd0b9d, P7): at the foot of
  // this page it sat below every spec, which is where a thing is hardest to
  // find, and it is configuration rather than work in progress.
  const strip = '';

  return `<!DOCTYPE html><html lang="en" data-theme="${theme}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>SpecForge</title>
<link rel="stylesheet" href="/public/ui.css">
<script src="/public/ui.js" defer></script>
<style>
${THEME_CSS}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:${BODY_FONT}}
  a{color:inherit;text-decoration:none}
  button{font:inherit;color:inherit}

  /* ── shell: fixed rail + scrolling list ───────────────────────────── */
  .app{display:flex;align-items:flex-start;min-height:100vh}
  /* A column so the configuration row can be pushed to the bottom by margin
     rather than positioned there, which keeps it below the rail's content on a
     short viewport instead of floating over it. */
  .side{position:sticky;top:0;flex:none;width:238px;height:100vh;overflow-y:auto;padding:0 12px 24px;
        display:flex;flex-direction:column;
        border-right:1px solid var(--line);background:color-mix(in srgb,var(--surface) 50%,var(--bg))}
  .cfg{margin-top:auto;display:flex;align-items:center;gap:9px;padding:9px 10px;border-radius:8px;
       border:1px solid var(--line);color:var(--muted);font-size:13px;text-decoration:none}
  .cfg:hover{border-color:var(--accent);color:var(--accent)}
  /* not ".main" — the row's left cluster already owns that name */
  .pane{flex:1;min-width:0}

  .brand{display:flex;align-items:center;gap:9px;height:56px;padding:0 8px;font-size:16px;font-weight:650;letter-spacing:-.01em}
  .brand svg{color:var(--accent);flex:none}
  .shead{display:flex;align-items:center;gap:6px;margin:20px 0 6px;padding:0 8px;font-size:10.5px;font-weight:650;
         text-transform:uppercase;letter-spacing:.07em;color:var(--faint)}
  .shint{padding:2px 8px 0;font-size:11.5px;color:var(--faint);line-height:1.45}

  .nav,.cnav,.pnav{display:flex;align-items:center;gap:8px;width:100%;height:29px;padding:0 8px;border:none;border-radius:7px;
             background:none;color:var(--muted);font-size:13px;text-align:left;cursor:pointer;transition:background .12s,color .12s}
  .nav:hover,.cnav:hover,.pnav:hover{background:var(--surface2);color:var(--ink)}
  .nav.on,.cnav.on,.pnav.on{background:var(--accent-soft);color:var(--accent);font-weight:560}
  .nc{margin-left:auto;font-size:11.5px;color:var(--faint);font-variant-numeric:tabular-nums}
  .nav.on .nc,.cnav.on .nc,.pnav.on .nc{color:inherit;opacity:.7}
  /* .projname, not .pname: the collection picker already uses .pname for its own
     item labels, and one class on two unrelated components is one place for a
     later change to leak. */
  .cname,.projname{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  .crow,.prow{display:flex;align-items:center;gap:2px;border-radius:7px}
  .crow .cnav,.prow .pnav{min-width:0}
  .crow[draggable="true"],.prow[draggable="true"]{cursor:grab}
  .crow.dragging,.prow.dragging{opacity:.4;cursor:grabbing}
  /* While a drag is in flight the rail is a list you are rearranging, not a set
     of filters — the hover highlight would read as "click me". */
  .colls.rearranging .cnav:hover,.projs.rearranging .pnav:hover{background:none;color:var(--muted)}
  .colls.rearranging .crow:not(.dragging),.projs.rearranging .prow:not(.dragging){box-shadow:inset 0 0 0 1px transparent}
  /* A collection the selected project has no members of is not a filter that
     leads anywhere, so it leaves the rail rather than sitting there at zero. */
  .crow[hidden]{display:none}

  /* "+ New project" is an action, not a filter, so it does not wear the rail's
     selected treatment. Named .projnew rather than .pnew because the collection
     picker already owns that name for its "create this one" button. */
  .projnew{display:block;width:100%;height:26px;margin-top:2px;padding:0 8px;border:none;border-radius:7px;
        background:none;color:var(--faint);font-size:12.5px;text-align:left;cursor:pointer}
  .projnew:hover{background:var(--surface2);color:var(--ink)}

  /* ── Shared with me: subscription cards, links out to other origins ── */
  .subs{display:flex;flex-direction:column;gap:1px}
  .srow{display:flex;align-items:center;gap:6px;height:28px;padding:0 8px;border-radius:7px;
        color:var(--ink);font-size:13px;text-decoration:none}
  .srow:hover{background:var(--surface2)}
  .srow .sname{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .srow .snc{color:var(--faint);font-size:11.5px}
  .srow .soff{color:var(--muted);font-size:11px;font-style:italic}
  .srow.off .sname{color:var(--muted)}

  /* ── sticky top: search + toolbar ─────────────────────────────────── */
  .top{position:sticky;top:0;z-index:10;background:color-mix(in srgb,var(--bg) 88%,transparent);
       backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border-bottom:1px solid var(--line)}
  .topin{max-width:1180px;margin:0 auto;padding:0 28px}
  @media(max-width:960px){.topin{padding:0 18px}}
  header{display:flex;align-items:center;gap:16px;height:56px}
  .htitle{font-size:15px;font-weight:600;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

  /* Sharing the project you are looking at, from where you are looking at it.
     Quiet until used: a plain control beside the title, replaced by the link
     itself once the project is public. */
  .pshare{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto;height:26px;padding:0 10px;
    border:1px solid var(--line);border-radius:7px;background:var(--surface);color:var(--muted);
    font-size:12.5px;cursor:pointer;white-space:nowrap}
  .pshare:hover{color:var(--ink);border-color:var(--line2)}
  .pshare[hidden]{display:none}
  .pshare-on{display:inline-flex;align-items:center;gap:6px;flex:0 0 auto}
  .pshare-on[hidden]{display:none}
  .pshare-link{display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;
    border:1px solid color-mix(in srgb,var(--live) 35%,var(--line));border-radius:7px;
    background:color-mix(in srgb,var(--live) 8%,transparent);color:var(--live);
    font-size:12.5px;text-decoration:none;white-space:nowrap;max-width:260px;overflow:hidden;text-overflow:ellipsis}
  .pshare-link[hidden]{display:none}
  .pshare-link:hover{filter:brightness(1.08)}
  .pshare-act{height:26px;padding:0 9px;border:1px solid var(--line);border-radius:7px;
    background:var(--surface);color:var(--muted);font-size:12px;cursor:pointer;white-space:nowrap}
  .pshare-act:hover{color:var(--ink);border-color:var(--line2)}
  /* The rail's own marker, so a shared project reads as shared from the list. */
  .pshared{display:inline-flex;align-items:center;color:var(--live);margin-left:5px}
  @media(max-width:760px){ .pshare-act,.pshare span{display:none} }
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

  /* ── project + collection groups ──────────────────────────────────── */
  /* Two levels, and the reader has to see which is which without reading them.
     The project takes a scale jump and a rule spanning the content column; the
     collection heading is untouched at 11px uppercase. 17 against 11 is a real
     step, and the rule is the edge you cross going from one project to the next.
     Nothing is added but a hairline: a panel per project would put a card inside
     a panel inside a page, which is three borders deep and louder than anything
     else here.

     The project heading only earns its line when more than one project is on
     screen. Inside a project the page header already names it, so body.inproj
     takes it away rather than repeating it. */
  .pgrp{margin:40px 0 0}
  .pgrp.lead{margin-top:8px}
  .ph{display:flex;align-items:center;gap:7px;font-size:17px;font-weight:660;letter-spacing:-.02em;
      color:var(--ink);text-transform:none;margin:0;padding:0 0 10px 2px;
      border-bottom:1px solid var(--line2)}
  /* At 17px a filled pill reads as a badge on a title rather than a count, so
     the project wears plain numerals. The collections keep their pill, which
     leaves a second signal of which level you are looking at. */
  .ph .gcount{background:none;color:var(--faint);font-weight:400;font-size:13px;padding:0 0 0 2px}
  body.inproj .ph{display:none}
  body.inproj .pgrp{margin-top:0}
${LIST_CSS}
  /* Everything below is the owner's alone: a heading that sticks under this
     page's toolbar, and the controls a reviewer has no use for. */
  /* The 18px is the space under the project heading. With the heading hidden it
     would be a gap under nothing, so inside a project it goes back to the 8px
     the page had before. Keyed on .lead rather than :first-of-type, so a filter
     that hides the first collection moves the spacing with it. */
  .pgrp .grp.lead{margin-top:18px}
  body.inproj .pgrp .grp.lead{margin-top:8px}
  .tpls h2{display:flex;align-items:center;gap:5px;font-size:11px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);font-weight:650;margin:0 0 7px 2px}
  /* the collection you are inside stays named while you scroll it */
  .grp h2{position:sticky;top:94px;z-index:5;background:var(--bg);padding:5px 2px;margin:0 0 3px;cursor:pointer;user-select:none}
  .grp h2:hover{color:var(--ink)}
  .chev{margin-left:2px;color:var(--faint);transition:transform .14s}
  .grp.collapsed .chev{transform:rotate(-90deg)}
  .grp.collapsed .card{display:none}

  /* ── one-line row: the owner's additions to the shared row ────────── */
  .row.edge-live{border-left-color:var(--live)}
  .row.edge-off{border-left-color:var(--line2)}
  .row.picked{background:var(--accent-soft)}
  .sel{flex:none;width:14px;height:14px;margin:0;accent-color:var(--accent);cursor:pointer;opacity:0;transition:opacity .12s}
  .row:hover .sel,.sel:checked,.sel:focus-visible,body.picking .sel{opacity:1}
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
  .live{display:inline-flex;align-items:center;gap:5px;font-size:11px;font-weight:550;color:var(--live)}
  .live .dot{width:7px;height:7px;border-radius:50%;background:var(--live);animation:pulse 2.4s ease-in-out infinite}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}
  @media(prefers-reduced-motion:reduce){.live .dot{animation:none}}
  .off{font-size:11px;color:var(--faint);white-space:nowrap}
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

  /* The snackbar and both dialogs are styled by /public/ui.css, off the generic
     palette names this page already declares for the review layer. */

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
    .side{position:static;width:auto;height:auto;border-right:none;border-bottom:1px solid var(--line);padding-bottom:12px;display:block}
    .cfg{margin-top:10px;display:inline-flex}
    .side .brand{height:48px}
    .views,.colls{display:flex;flex-wrap:wrap;gap:4px}
    .nav,.cnav{width:auto}
    .crow{width:auto}
    .tags,.id,.upd{display:none}
  }
</style></head><body${selected === null ? '' : ' class="inproj"'}>
<div class="app">
<aside class="side">
  <span class="brand"><svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2l1.2 2.6L14 5.8l-2.8 1.2L10 9.6 8.8 7 6 5.8l2.8-1.2z"/><rect x="4" y="11" width="12" height="3.4" rx="1.2"/><rect x="6" y="15.4" width="8" height="2.6" rx="1"/></svg>SpecForge</span>
  <div class="shead">Projects</div>
  <nav class="projs" id="projs" aria-label="Projects">${projRows}</nav>
  <button class="projnew" id="projnew" type="button">+ New project</button>
  ${subs.length ? `<div class="shead">Shared with me</div>
  <nav class="subs" id="subs" aria-label="Shared with me">${subs.map(subRowHtml).join('\n')}</nav>` : ''}
  <div class="shead">Views</div>
  <nav class="views" id="views" aria-label="Views">${views}</nav>
  <div class="shead" id="chead">Collections</div>
  <nav class="colls" id="colls" aria-label="Collections">${collRows}</nav>
  ${named.length ? '' : '<p class="shint">Select specs with the checkbox, then move them into a collection.</p>'}
  <a class="cfg" id="cfg" href="/settings">⚙<span>Configuration</span></a>
</aside>
<main class="pane">
<div class="top"><div class="topin">
<header>
  <span class="htitle" id="htitle">${selected === null ? 'All specs' : selected === '' ? NO_PROJECT : esc(selected)}</span>
  <button class="pshare" id="pshare" type="button"${selected && !selLive ? '' : ' hidden'}>${ICON_SHARE}<span>Share project</span></button>
  <span class="pshare-on" id="pshare-on"${selLive ? '' : ' hidden'}>
    <a class="pshare-link" id="pshare-link" target="_blank" rel="noopener"${selLive ? ` href="${esc(selShare.url)}"` : ''}${selLive ? '' : ' hidden'}>${ICON_SHARE}<span id="pshare-host">${selLive ? esc(prettyHost(selShare.url)) : ''}</span></a>
    <button class="pshare-act" id="pshare-copy" type="button" title="Copy the link">Copy</button>
    <button class="pshare-act" id="pshare-off" type="button" title="Stop sharing this project">Unshare</button>
  </span>
  <span class="spacer"></span>
  <span class="searchbox"><svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="6" cy="6" r="4.2"/><path d="M9.2 9.2L12.5 12.5"/></svg><input class="search" id="search" type="search" placeholder="Search specs, tags, collections…" autocomplete="off" aria-label="Search"><span class="skey">/</span></span>
  <button class="toggle" id="theme" type="button" aria-label="Toggle theme" title="Toggle theme">${theme === 'dark'
    ? '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M12.5 9.5A5.5 5.5 0 1 1 5.5 2.5a4.5 4.5 0 0 0 7 7z"/></svg>'
    : '<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="7.5" cy="7.5" r="3.2"/><path d="M7.5 1v1.8M7.5 12.2V14M1 7.5h1.8M12.2 7.5H14M2.9 2.9l1.3 1.3M10.8 10.8l1.3 1.3M12.1 2.9l-1.3 1.3M4.2 10.8l-1.3 1.3"/></svg>'}</button>
</header>
${n ? `<div class="toolbar">${chipsBar}
  <select class="tsel" id="ftype" aria-label="Filter by type"><option value="">All types</option>${specTypes().map((t) => `<option>${esc(t)}</option>`).join('')}</select>
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
  <button class="bbtn" id="bproj" type="button" aria-haspopup="dialog" aria-expanded="false">Move to project…</button>
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
<!-- The snackbar and both dialogs come from /public/ui.js, which builds them on
     demand — the same ones a spec page gets, so a message and a confirmation
     look and behave the same wherever you meet them. -->
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
   * The projects the picker offers, read off the RAIL rather than the rows.
   *
   * A project can hold nothing and still exist — that is the whole point of
   * being able to create one before filing anything into it — so a list derived
   * from the rows would omit exactly the project you just made and are trying to
   * move something into.
   */
  function projects(){
    return prows.filter(function(pr){return pr.getAttribute('data-p')!=='';})
      .map(function(pr){
        var nc=pr.querySelector('.nc');
        return {name:pr.getAttribute('data-p'),count:nc?+nc.textContent:0};
      });
  }
  /**
   * @param anchor the button it hangs off
   * @param current the group the target is in now ('' = none)
   * @param onPick called with the chosen name ('' to take it out of everything)
   * @param kind 'collection' (default) or 'project' — the same popover either
   *   way, so there is one thing to learn about naming a destination
   */
  function openPicker(anchor,current,onPick,kind){
    var pick=document.getElementById('cpick'), list=document.getElementById('plist');
    var filter=document.getElementById('pfilter'), create=document.getElementById('pnew');
    var isProj=kind==='project';
    var all=isProj?projects():collections();
    var noneLabel=isProj?NO_PROJECT:'Uncollected';
    var emptyText=isProj?'No project matches':'No collection matches';
    pick.setAttribute('aria-label',isProj?'Move to project':'Move to collection');
    filter.placeholder=isProj?'Filter or new project…':'Filter or new name…';
    filter.value='';
    function paint(){
      var q=filter.value.trim(), lq=q.toLowerCase();
      list.innerHTML='';
      var hits=all.filter(function(c){return !lq||c.name.toLowerCase().indexOf(lq)!==-1;});
      hits.forEach(function(c){list.appendChild(pickItem(c.name,c.name,c.count,current));});
      // Uncollected / No project is a destination, not a group: it never matches
      // a filter and never carries a count, it is just "take this out of
      // wherever it is".
      if(!q) list.appendChild(pickItem('',noneLabel,null,current));
      else if(!hits.length){var e=document.createElement('div'); e.className='pempty'; e.textContent=emptyText; list.appendChild(e);}
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

  // ---- dialogs + messages ----
  // All four live in /public/ui.js, which a spec page loads too. This page used
  // to carry its own of each, and the two disagreed on where a message appears
  // and whether it ever goes away.
  function askName(o){ SFUI.prompt(o); }
  /**
   * The name the store will actually hold for what was typed.
   *
   * sanitizeCollection / sanitizeProject collapse internal whitespace and cap at
   * 60 characters before writing, so comparing raw input against the rail would
   * miss "spec  forge" colliding with an existing "spec forge" — and a
   * collision that slips past the check merges two groups with no warning.
   * Mirrored here so the page decides identity the same way the server does.
   */
  function normName(s){ return String(s==null?'':s).replace(/\\s+/g,' ').trim().slice(0,60); }
  function askConfirm(o){ SFUI.confirm(o); }

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
      // The same button in three places; which menu it opens is decided by what
      // it sits in, so no row and neither rail needs its own handler.
      if(pop===document.getElementById('menu')&&popOwner===t){closePop();return;}
      var row=rowOf(t), prow=t.closest('.prow');
      if(row) rowMenu(t,row);
      else if(prow) projMenu(t,prow);
      else collMenu(t,t.closest('.crow'));
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
      {icon:'\\u25f1',label:'Move to project\\u2026',run:function(){
        openPicker(btn,row.getAttribute('data-p'),function(v){setProj([row],v);},'project');
      }},
      // Deliberately its own action rather than another destination in the
      // picker above. Filing a spec locally and listing it in someone else's
      // project are different operations: the first is exclusive and changes
      // nothing outside this machine, the second is additive and PUBLISHES the
      // spec. One picker doing both would let a tidy-up publish by accident,
      // and a local project sharing a name with a shared one would show two
      // identical-looking rows that do very different things.
      {icon:'\\ud83d\\udce4',label:'Add to a shared project\\u2026',run:function(){
        openContributeMenu(btn,row);
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

  /**
   * The projects this machine has joined, as a menu.
   *
   * Fetched rather than rendered with the page: a subscription can be added
   * from a terminal while the page is open, and this is a rarely-opened menu,
   * so one request when it is opened beats state that can be wrong.
   */
  function openContributeMenu(btn,row){
    var id=row.getAttribute('data-id');
    var title=row.querySelector('.title').textContent;
    fetch('/api/subscriptions').then(function(r){return r.json();}).then(function(body){
      var subs=(body&&body.subscriptions)||[];
      if(!subs.length){
        // The reason is actionable, so it is said rather than left as an empty
        // menu: they have not joined a project yet.
        return openMenu(btn,[{icon:'',label:'No shared projects joined yet',run:function(){}}]);
      }
      openMenu(btn,subs.map(function(s){
        return {icon:'\\ud83d\\udcc1',label:s.name,run:function(){contributeRow(id,title,s);}};
      }));
    }).catch(function(){warn('Could not load your shared projects.');});
  }

  /** Publish this spec and list it in a joined project. */
  function contributeRow(id,title,sub){
    api(id,'/contribute','POST',{url:sub.url}).then(function(r){
      return r.ok?r.json().then(function(d){return {ok:true,d:d};})
        :r.json().then(function(d){return {ok:false,d:d};}).catch(function(){return {ok:false,d:null};});
    }).then(function(out){
      if(!out.ok) return warn((out.d&&out.d.error)||('Could not add "'+title+'" to "'+sub.name+'".'));
      warn('Added "'+title+'" to "'+sub.name+'".');
    }).catch(function(){warn('Could not add "'+title+'" to "'+sub.name+'".');});
  }

  function collMenu(btn,crow){
    var name=crow.getAttribute('data-c');
    var items=[];
    if(crow.previousElementSibling) items.push({icon:'\\u2191',label:'Move up',run:function(){moveColl(crow,-1);}});
    if(nextNamed(crow)) items.push({icon:'\\u2193',label:'Move down',run:function(){moveColl(crow,1);}});
    // Renaming or deleting a collection is an act on ONE collection, and after
    // projects a name alone does not always identify one: "UI" in two projects
    // is two collections with two memberships. Offered whenever the name IS
    // unambiguous — inside a project, or from All projects when every spec
    // carrying that name sits in the same project, which is every collection in
    // a store that uses no projects. Reordering is always offered: the order is
    // a flat list of names, shared across projects by design.
    if(fproj===null&&projectsUsing(name).length>1){ openMenu(btn,items); return; }
    if(items.length) items.push({sep:true});
    openMenu(btn,items.concat([
      {icon:'\\u270e',label:'Rename\\u2026',run:function(){
        askName({title:'Rename collection',label:'Collection name',value:name,onOk:function(raw){
          var v=normName(raw);
          if(!v||v===name) return;
          // The order is a list of names, so a rename has to be applied to it too
          // — and before the reload the move fans out into, or the collection
          // reappears at the bottom under its new name.
          putOrderThen(renamedOrder(name,v),function(){
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
            putOrderThen(deletedOrder(name),function(){
              setColl(membersOf(name),'','some are still in "'+name+'"');
            });
          },
        });
      }},
    ]));
  }
  /** The distinct projects holding a spec in a collection of this name. */
  function projectsUsing(name){
    var seen={}, out=[];
    rows.forEach(function(r){
      if(r.getAttribute('data-c')!==name) return;
      var p=r.getAttribute('data-p');
      if(!Object.prototype.hasOwnProperty.call(seen,p)){ seen[p]=1; out.push(p); }
    });
    return out;
  }
  /** True when a collection of this name survives in some OTHER project. */
  function usedElsewhere(name){
    return rows.some(function(r){return r.getAttribute('data-c')===name&&!projOk(r);});
  }
  /**
   * The order after renaming this project's collection.
   *
   * The order is one flat list of names shared by every project, so a rename
   * here can only REPLACE the old name if no other project still has a
   * collection called that. When one does, the new name is inserted beside the
   * old rather than over it, and both keep a rank.
   */
  function renamedOrder(name,v){
    var keep=usedElsewhere(name), out=[];
    collOrder().forEach(function(c){
      if(c!==name){ if(out.indexOf(c)===-1) out.push(c); return; }
      if(keep) out.push(c);
      if(out.indexOf(v)===-1) out.push(v);
    });
    if(out.indexOf(v)===-1) out.push(v);
    return out;
  }
  /** The order after deleting this project's collection, keeping the name if
   *  another project still uses it. */
  function deletedOrder(name){
    var keep=usedElsewhere(name);
    return collOrder().filter(function(c){return keep||c!==name;});
  }

  /**
   * A project in the rail: reorder it, rename it, or delete it.
   *
   * Rename and delete are the collection pair one level up, and deliberately the
   * same shape: write the name list first, then fan out one PATCH per member,
   * then reload. Doing the list second would land the project at the bottom
   * under its new name, which is the reason the collection code gives.
   */
  function projMenu(btn,prow){
    var name=prow.getAttribute('data-p');
    var items=[];
    if(prow.previousElementSibling&&prow.previousElementSibling.hasAttribute('data-p')) items.push({icon:'\\u2191',label:'Move up',run:function(){moveProj(prow,-1);}});
    if(projRail.nextNamed(prow)) items.push({icon:'\\u2193',label:'Move down',run:function(){moveProj(prow,1);}});
    if(items.length) items.push({sep:true});
    // Sharing sits above the destructive pair, and reads the row rather than
    // the header so it is right whichever project the kebab belongs to.
    var shared=prow.getAttribute('data-share-url');
    var shareItems=shared?[
      {icon:'\\ud83d\\udd17',label:'Copy link',run:function(){copyLink(shared,null);}},
      {icon:'\\u2716',label:'Unshare\\u2026',run:function(){unshareProject(name);}},
    ]:[
      {icon:'\\ud83d\\udd17',label:'Share project',run:function(){shareProject(name,function(url){copyLink(url,null);});}},
    ];
    openMenu(btn,items.concat(shareItems,[{sep:true}],[
      {icon:'\\u270e',label:'Rename\\u2026',run:function(){
        askName({title:'Rename project',label:'Project name',value:name,onOk:function(raw){
          var v=normName(raw);
          if(!v||v===name) return;
          var rename=function(){
            projRail.putThen(projRail.order().map(function(p){return p===name?v:p;}),function(){
              setProj(membersOfProject(name),v,'some are still in "'+name+'"');
            });
          };
          // Renaming onto a name already in use is not a rename, it is a merge:
          // both sets of specs end up under one name and the other project stops
          // existing. That may well be what was wanted, so it is offered rather
          // than refused — but not silently, because nothing here undoes it.
          if(projRail.order().indexOf(v)===-1){ rename(); return; }
          var mine=membersOfProject(name).length, theirs=membersOfProject(v).length;
          askConfirm({
            title:'Merge projects',
            body:'"'+v+'" already exists. Its '+theirs+' spec'+(theirs===1?'':'s')+' and "'+name+'"\\u2019s '+mine+' will end up in one project called "'+v+'", and "'+name+'" will be gone.',
            ok:'Merge',
            danger:false,
            onOk:rename,
          });
        }});
      }},
      {icon:'\\ud83d\\uddd1',label:'Delete project\\u2026',danger:true,run:function(){
        var n=membersOfProject(name).length;
        askConfirm({
          title:'Delete project',
          // Same reason the collection dialog spells it out: "delete" beside a
          // count of specs reads like it takes them with it. It does not, and
          // the collections they are in travel with them.
          body:'Delete "'+name+'"? '+(n===1
            ?'Its 1 spec is not deleted \\u2014 it moves to No project.'
            :'Its '+n+' specs are not deleted \\u2014 they move to No project.'),
          onOk:function(){
            projRail.putThen(projRail.order().filter(function(p){return p!==name;}),function(){
              setProj(membersOfProject(name),'','some are still in "'+name+'"');
            });
          },
        });
      }},
    ]));
  }

  // ---- rail order (Move up / Move down, and drag) ----
  // The rail is the order. Reading it back off the DOM means the two can never
  // disagree, and a move is then a DOM move plus one PUT — no reload, so the
  // scroll position and any open filter survive it.
  //
  // One controller, two rails. Collections and projects are the same list
  // problem at two levels: an ordered set of named rows with one unnamed row
  // (Uncollected, No project) pinned last that is never a passenger and never a
  // target. Two copies of this would be two places for a fix to land in one of.
  function makeRail(cfg){
    // cfg: {nav, rowSel, keyAttr, prefKey, failMsg, after}
    var nav=cfg.nav;
    var saved=null, writing=false, pendingWrite=false;
    /** The named rows, top to bottom. The unnamed one is not one of them. */
    function order(){
      return [].slice.call(document.querySelectorAll(cfg.rowSel))
        .map(function(r){return r.getAttribute(cfg.keyAttr);})
        .filter(function(k){return k!=='';});
    }
    /** The next row that is not the unnamed one, which never moves. */
    function nextNamed(row){
      var n=row.nextElementSibling;
      return n&&n.getAttribute(cfg.keyAttr)!==''&&n.getAttribute(cfg.keyAttr)!==null?n:null;
    }
    /** Store the order. @param done called with whether it landed. */
    function put(list,done){
      var body={}; body[cfg.prefKey]=list;
      fetch('/api/prefs',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
        .then(function(x){done(!!(x&&x.ok));},function(){done(false);});
    }
    /**
     * Write the order a rename or a delete implies, then do the thing itself —
     * whether or not the write landed. Refusing to rename because a cosmetic
     * order failed to save would be the worse failure. The message is the
     * carried one, since what follows reloads the page over the top of it.
     */
    function putThen(list,then){
      put(list,function(ok){ if(!ok) warn(cfg.failMsg); then(); });
    }
    /**
     * Persist the rail as it now stands, and put it back if the write does not
     * land.
     *
     * One write is in flight at a time and a move made during one is coalesced
     * into a single write after it, because the rail IS the desired state —
     * there is nothing to queue but "send it again". Letting them overlap would
     * let two settle out of order, and an older failure would then roll back
     * over a newer order that did save.
     *
     * The rollback target is the last order the store is KNOWN to hold, not the
     * one this move started from: after a coalesced write, "before" is a
     * position halfway through a gesture that was never stored.
     */
    function commit(){
      if(writing){ pendingWrite=true; return; }
      writing=true;
      var sending=order();
      put(sending,function(ok){
        writing=false;
        if(ok) saved=sending;
        // A move made while this was in flight is a newer statement of intent
        // than this result. Send that instead — rolling back first would wipe it
        // off the rail and then store the wipe. If it fails in turn, ITS handler
        // is the one that rolls back, to the same place.
        if(pendingWrite){ pendingWrite=false; commit(); return; }
        if(!ok){ showMsg(cfg.failMsg); restore(saved||sending); }
      });
    }
    /** Restore an order taken earlier from order() — the undo for a failed write. */
    function restore(list){
      var all=[].slice.call(document.querySelectorAll(cfg.rowSel));
      var unnamed=null;
      list.forEach(function(name){
        for(var i=0;i<all.length;i++){ if(all[i].getAttribute(cfg.keyAttr)===name) nav.appendChild(all[i]); }
      });
      for(var i=0;i<all.length;i++){ if(all[i].getAttribute(cfg.keyAttr)==='') unnamed=all[i]; }
      if(unnamed) nav.appendChild(unnamed);
      if(cfg.after) cfg.after();
    }
    function move(row,dir){
      var sib=dir<0?row.previousElementSibling:nextNamed(row);
      if(!sib) return;
      if(dir<0) nav.insertBefore(row,sib); else nav.insertBefore(sib,row);
      if(cfg.after) cfg.after();
      commit();
    }
    // ---- drag to reorder ----
    // The row moves under the pointer rather than a line being drawn between
    // rows: the rail is short and the result is the preview, so there is nothing
    // to interpret about where it will land. The unnamed row is not a target and
    // never a passenger, which is why every lookup here filters it out.
    var dragging=null, dragFrom=null;
    if(nav){
      nav.addEventListener('dragstart',function(e){
        var row=e.target.closest&&e.target.closest(cfg.rowSel);
        if(!row||row.getAttribute(cfg.keyAttr)==='') return;
        dragging=row; dragFrom=order();
        row.classList.add('dragging');
        nav.classList.add('rearranging');
        closePop();
        if(e.dataTransfer){
          e.dataTransfer.effectAllowed='move';
          // Firefox starts no drag at all without something on the transfer.
          try{e.dataTransfer.setData('text/plain',row.getAttribute(cfg.keyAttr));}catch(err){}
        }
      });
      nav.addEventListener('dragover',function(e){
        if(!dragging) return;
        var over=e.target.closest&&e.target.closest(cfg.rowSel);
        if(!over||over===dragging||over.getAttribute(cfg.keyAttr)==='') return;
        e.preventDefault();
        if(e.dataTransfer) e.dataTransfer.dropEffect='move';
        var r=over.getBoundingClientRect();
        var after=e.clientY>r.top+r.height/2;
        nav.insertBefore(dragging,after?over.nextSibling:over);
        if(cfg.after) cfg.after();
      });
      // Dropping is not what commits — dragend fires for a drop and for an abort
      // alike, and by then the rail already reads the way it will stay.
      nav.addEventListener('drop',function(e){e.preventDefault();});
      nav.addEventListener('dragend',function(){
        if(!dragging) return;
        dragging.classList.remove('dragging');
        nav.classList.remove('rearranging');
        var before=dragFrom;
        dragging=null; dragFrom=null;
        if(before.join('\\u0000')!==order().join('\\u0000')) commit();
      });
    }
    // What the store holds right now: the page was rendered from it.
    saved=order();
    return {order:order,nextNamed:nextNamed,putThen:putThen,move:move};
  }

  var colls=document.getElementById('colls');
  var projs=document.getElementById('projs');
  var collRail=makeRail({
    nav:colls, rowSel:'.crow', keyAttr:'data-c', prefKey:'collectionOrder',
    failMsg:'The collection order could not be saved.', after:syncGroups,
  });
  var projRail=makeRail({
    nav:projs, rowSel:'.prow[data-p]', keyAttr:'data-p', prefKey:'projects',
    failMsg:'The project order could not be saved.', after:syncProjGroups,
  });
  var collOrder=collRail.order, nextNamed=collRail.nextNamed;
  var putOrderThen=collRail.putThen;
  function moveColl(crow,dir){ collRail.move(crow,dir); }
  function moveProj(prow,dir){ projRail.move(prow,dir); }
  /**
   * Put the groups in the rail's order. The page's groups are the same order and
   * the two must never read differently, so this runs after every rail change.
   * Appending in sequence is the whole algorithm; the unnamed group goes last
   * because it is the absence of a name, not a position anyone chose.
   *
   * Collections are ordered within each project section, since the same name in
   * two projects is two groups that both take the name's rank.
   */
  function syncGroups(){
    pgrps.forEach(function(pg){
      var mine={};
      [].slice.call(pg.querySelectorAll('.grp')).forEach(function(g){mine[g.getAttribute('data-coll')]=g;});
      collOrder().forEach(function(name){ if(mine[name]) pg.appendChild(mine[name]); });
      if(mine['']) pg.appendChild(mine['']);
    });
    // A different collection is first now, so the spacing has to move with it.
    markLead();
  }
  function syncProjGroups(){
    var host=document.getElementById('groups');
    if(!host) return;
    var mine={};
    pgrps.forEach(function(pg){mine[pg.getAttribute('data-p')]=pg;});
    projRail.order().forEach(function(name){ if(mine[name]) host.appendChild(mine[name]); });
    if(mine['']) host.appendChild(mine['']);
    // A different project is first now, so the spacing has to move with it.
    markLead();
  }

  document.addEventListener('keydown',function(e){
    var t=e.target;
    if(e.key==='/'&&!(t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA'||t.tagName==='SELECT'))){
      var s=document.getElementById('search'); if(s){e.preventDefault();s.focus();s.select();} return;
    }
    if(e.key==='Escape'&&pop){var o=popOwner;closePop();if(o&&o.focus)o.focus();return;}
    // A modal dialog handles its own Escape; the keypress still bubbles to here,
    // and clearing the selection out from under an open dialog is a surprise.
    if(e.key==='Escape'&&window.SFUI&&SFUI.dialogOpen()) return;
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
  var grps=[].slice.call(document.querySelectorAll('.grp'));
  var chips=[].slice.call(document.querySelectorAll('.fchip'));
  var navs=[].slice.call(document.querySelectorAll('.nav[data-view]'));
  var cnavs=[].slice.call(document.querySelectorAll('.cnav'));
  var pgrps=[].slice.call(document.querySelectorAll('.pgrp'));
  var pnavs=[].slice.call(document.querySelectorAll('.pnav'));
  var prows=[].slice.call(document.querySelectorAll('.prow[data-p]'));
  var crows=[].slice.call(document.querySelectorAll('.crow'));
  var fstatus='all', fview='all', fcoll=null;
  // Which project the page is showing: null = All projects, '' = No project, a
  // name = that project. Read off the rail the server rendered, so the page
  // starts where the store says it left off rather than resetting on every load.
  var fproj=(function(){
    var on=document.querySelector('.pnav.on');
    return on&&!on.hasAttribute('data-all')?on.getAttribute('data-p'):null;
  })();
  var SORDER={draft:0,approved:1};
  var VIEWNAME={all:'All specs',attn:'Needs you',live:'Live',shared:'Shared'};
  var NO_PROJECT=${JSON.stringify(NO_PROJECT)};

  function viewOk(r){
    if(fview==='attn'){var rv=r.getAttribute('data-rv');return rv==='needs'||rv==='replied';}
    if(fview==='live') return r.getAttribute('data-lv')==='1';
    if(fview==='shared') return r.getAttribute('data-pb')==='1';
    return true;
  }
  /**
   * The project narrows everything else, search included.
   *
   * A search that reached outside the selected project would answer a question
   * nobody asked and put rows on screen the rail says are not here. All projects
   * is the way to search the whole store, and it is where the page opens.
   */
  function projOk(r){ return fproj===null||r.getAttribute('data-p')===fproj; }
  function base(r,q,ty){
    return (!q||r.getAttribute('data-k').indexOf(q)!==-1)
      &&(!ty||r.getAttribute('data-t')===ty)
      &&viewOk(r)
      &&projOk(r)
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
    // A project section with nothing left in it goes too, heading and all.
    pgrps.forEach(function(pg){
      var vis=[].slice.call(pg.querySelectorAll('.grp')).filter(function(g){return g.style.display!=='none';}).length;
      var gc=pg.querySelector('.ph .gcount');
      if(gc) gc.textContent=[].slice.call(pg.querySelectorAll('.row[data-id]')).filter(function(r){return r.style.display!=='none';}).length;
      pg.style.display=vis?'':'none';
    });
    markLead();
    // The collections rail is the whole store's names; inside a project only the
    // ones with members there are filters that lead anywhere, so the rest leave
    // rather than sitting at zero. The count is always the visible slice.
    var anyColl=0;
    crows.forEach(function(cr){
      var c=cr.getAttribute('data-c');
      var n=rows.filter(function(r){return r.getAttribute('data-c')===c&&projOk(r);}).length;
      var nc=cr.querySelector('.nc'); if(nc) nc.textContent=n;
      cr.hidden=!n&&c!==fcoll;
      if(!cr.hidden) anyColl++;
    });
    // An empty project has no collections, and a heading over nothing reads as
    // something that failed to load.
    var chead=document.getElementById('chead');
    if(chead) chead.hidden=!anyColl;
    // live chip counts within the current search+view+collection+type slice
    chips.forEach(function(ch){
      var f=ch.getAttribute('data-f');
      var c=rows.filter(function(r){return base(r,q,ty)&&(f==='all'||r.getAttribute('data-s')===f);}).length;
      var fc=ch.querySelector('.fc'); if(fc) fc.textContent=c;
      ch.classList.toggle('zero',f!=='all'&&!c);
    });
    var filtered=!!q||fstatus!=='all'||!!ty||fview!=='all'||fcoll!==null||fproj!==null;
    if(count) count.textContent=filtered?(shown+' of '+total):(total+' spec'+(total===1?'':'s'));
    if(nohits) nohits.style.display=shown?'none':'block';
    // Inside a project the page header names it, so the project headings in the
    // body would be repeating it back.
    document.body.classList.toggle('inproj',fproj!==null);
    if(htitle) htitle.textContent=
      fcoll!==null?(fcoll===''?'Uncollected':fcoll)
      :fview!=='all'?VIEWNAME[fview]
      :fproj===null?VIEWNAME.all:(fproj===''?NO_PROJECT:fproj);
    syncShare();
  }

  // ---- sharing the project on screen -------------------------------------
  //
  // The control follows the selection, and its state is read off the rail row
  // the server already rendered rather than fetched: the row carries the URL
  // when the project is published and the tunnel answers.
  var pshareBtn=document.getElementById('pshare');
  var pshareOn=document.getElementById('pshare-on');
  var pshareLink=document.getElementById('pshare-link');
  var pshareHost=document.getElementById('pshare-host');
  var pshareCopy=document.getElementById('pshare-copy');
  var pshareOff=document.getElementById('pshare-off');

  /** The rail row for a project name, or null. */
  function prowFor(name){
    if(name===null||name==='') return null;
    return document.querySelector('.prow[data-p="'+cssEscape(name)+'"]');
  }
  function cssEscape(v){
    return (window.CSS&&CSS.escape)?CSS.escape(v):String(v).replace(/["\\\\]/g,'\\\\$&');
  }
  function sharedUrlOf(name){
    var row=prowFor(name);
    return row?row.getAttribute('data-share-url'):null;
  }
  /** Point the header controls at whatever project is selected now. */
  function syncShare(){
    if(!pshareBtn||!pshareOn) return;
    // A collection or a view is not a project, and neither is All or No project.
    var name=(fcoll===null&&fview==='all'&&fproj)?fproj:null;
    var url=name?sharedUrlOf(name):null;
    pshareBtn.hidden=!name||!!url;
    pshareOn.hidden=!url;
    if(pshareLink){
      pshareLink.hidden=!url;
      if(url){ pshareLink.href=url; if(pshareHost) pshareHost.textContent=hostOf(url); }
    }
  }
  function hostOf(u){
    try{ return new URL(u).hostname.replace(/\\.trycloudflare\\.com$/,''); }catch(e){ return u; }
  }
  function projApi(name,method){
    return fetch('/api/project/'+encodeURIComponent(name)+'/share',
      {method:method,headers:{'Content-Type':'application/json'},body:method==='POST'?'{}':undefined});
  }
  /** Publish, then record the URL on the row so every surface agrees. */
  function shareProject(name,after){
    projApi(name,'POST').then(function(r){return r.ok?r.json():null;}).then(function(d){
      if(!d||!d.share||!d.share.url) return warn('Could not share "'+name+'".');
      var row=prowFor(name);
      if(row) row.setAttribute('data-share-url',d.share.url);
      syncShare();
      if(after) after(d.share.url);
    }).catch(function(){warn('Could not share "'+name+'".');});
  }
  function unshareProject(name){
    // Asks first: the link is already in someone's chat, and stopping breaks it
    // for everyone at once. Re-sharing returns the SAME link, which is the one
    // thing worth saying, because it makes this reversible.
    askConfirm({
      title:'Stop sharing',
      body:'Anyone with the link loses access immediately. Sharing "'+name+'" again gives back the same link.',
      ok:'Stop sharing',
      onOk:function(){
        projApi(name,'DELETE').then(function(r){
          if(!r.ok) return warn('Could not stop sharing "'+name+'".');
          var row=prowFor(name);
          if(row) row.removeAttribute('data-share-url');
          syncShare();
        }).catch(function(){warn('Could not stop sharing "'+name+'".');});
      },
    });
  }
  function copyLink(url,btn){
    var done=function(){
      if(!btn) return;
      var was=btn.textContent; btn.textContent='Copied';
      setTimeout(function(){btn.textContent=was;},1200);
    };
    try{ navigator.clipboard.writeText(url).then(done,function(){warn(url);}); }
    catch(e){ warn(url); }
  }
  if(pshareBtn) pshareBtn.onclick=function(){
    var name=(fcoll===null&&fview==='all'&&fproj)?fproj:null;
    if(name) shareProject(name,function(url){copyLink(url,null);});
  };
  if(pshareCopy) pshareCopy.onclick=function(){
    var name=(fcoll===null&&fview==='all'&&fproj)?fproj:null;
    var url=name&&sharedUrlOf(name);
    if(url) copyLink(url,pshareCopy);
  };
  if(pshareOff) pshareOff.onclick=function(){
    var name=(fcoll===null&&fview==='all'&&fproj)?fproj:null;
    if(name) unshareProject(name);
  };
  /**
   * Put the top-of-list spacing on the first section that is actually SHOWN, at
   * both levels.
   *
   * :first-child cannot do this. A filter hides sections without reordering
   * them, so it would leave the tight spacing on something invisible and drop
   * the first section the reader sees under a gap meant to separate two of them.
   *
   * Called after anything that changes which section comes first: a filter pass,
   * and either rail reorder. The DOM is queried fresh each time rather than
   * reusing the load-time list, because a reorder moves the sections and the
   * load-time list keeps its original order.
   */
  function markLead(){
    var first=true;
    [].slice.call(document.querySelectorAll('#groups .pgrp')).forEach(function(pg){
      var on=pg.style.display!=='none';
      pg.classList.toggle('lead',on&&first);
      if(on) first=false;
      var grpsIn=[].slice.call(pg.querySelectorAll('.grp'));
      var shown=grpsIn.filter(function(g){return g.style.display!=='none';})[0];
      grpsIn.forEach(function(g){ g.classList.toggle('lead',g===shown); });
    });
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
    // The project is a separate axis from the view and the collection: it stays
    // marked while you move between them, because it did not stop being true.
    pnavs.forEach(function(x){
      x.classList.toggle('on',x.hasAttribute('data-all')?fproj===null:x.getAttribute('data-p')===fproj);
    });
  }
  /** Store which project is showing, so the next load opens here. */
  function putSelection(){
    try{fetch('/api/prefs',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:fproj})}).catch(function(){});}catch(e){}
  }
  function selectProject(p){
    fproj=p;
    // The collection filter belongs to the project you were in: "UI" here is not
    // "UI" there, so carrying it across would narrow to a collection this
    // project may not have.
    fcoll=null;
    closePop();
    paintNav(); applyFilters(); putSelection();
  }
  pnavs.forEach(function(pv){pv.onclick=function(){
    selectProject(pv.hasAttribute('data-all')?null:pv.getAttribute('data-p'));
  };});
  // A project is made before anything is in it, so creating one is a name and
  // nothing else. The page reloads into it: the rail, the groups and the
  // selection all come from the server, so there is one place that decides what
  // a project looks like rather than two that must agree.
  var projnew=document.getElementById('projnew');
  if(projnew) projnew.onclick=function(){
    askName({title:'New project',label:'Project name',value:'',ok:'Create',onOk:function(raw){
      var v=normName(raw);
      if(!v) return;
      var next=projRail.order();
      // A name that normalises onto an existing project is that project, so it
      // is selected rather than added a second time.
      if(next.indexOf(v)===-1) next.push(v);
      projRail.putThen(next,function(){
        fetch('/api/prefs',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({project:v})})
          .then(function(){location.reload();},function(){location.reload();});
      });
    }});
  };
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
  function setColl(list,value,what){ return fanOut(list,{collection:value},what); }
  /** The same fan-out one level up. Only the project key is sent, so the
   *  collection each spec is in travels with it. */
  function setProj(list,value,what){ return fanOut(list,{project:value},what); }
  function fanOut(list,patch,what){
    if(!list.length){ location.reload(); return; }
    Promise.all(list.map(function(r){
      return api(r.getAttribute('data-id'),'/organize','PATCH',patch)
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
  function showMsg(text){ return SFUI.snack(text,{tone:'err'}); }
  // ui.js is a deferred script, so it has not run while this one is parsing.
  // Everything else here is reached from an event; this is the one thing that
  // would fire at parse time.
  (function carriedMsg(){
    function show(){
      var text=null;
      try{text=sessionStorage.getItem(MSGKEY); if(text) sessionStorage.removeItem(MSGKEY);}catch(e){}
      if(text) showMsg(text);
    }
    if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',show);
    else show();
  })();
  // The selection moves through the same picker a single row does, so there is
  // one way to name a destination rather than a menu here and a text field there.
  var bmove=document.getElementById('bmove'), bcancel=document.getElementById('bcancel');
  var bproj=document.getElementById('bproj');
  if(bmove) bmove.onclick=function(){
    if(pop===document.getElementById('cpick')&&popOwner===bmove){closePop();return;}
    // No current collection: the selection may span several.
    openPicker(bmove,null,function(v){setColl(picked(),v);});
  };
  if(bproj) bproj.onclick=function(){
    if(pop===document.getElementById('cpick')&&popOwner===bproj){closePop();return;}
    openPicker(bproj,null,function(v){setProj(picked(),v);},'project');
  };
  if(bcancel) bcancel.onclick=clearPick;

  /**
   * A collection is derived from meta, so its members are its only definition —
   * and after projects, its members WITHIN the project you are looking at. The
   * same name in another project is another collection, so a rename here must
   * not reach it.
   */
  function membersOf(c){return rows.filter(function(r){return r.getAttribute('data-c')===c&&projOk(r);});}
  /** A project's members: every row filed under it, whatever collection. */
  function membersOfProject(p){return rows.filter(function(r){return r.getAttribute('data-p')===p;});}

  // The server rendered the selection; this makes the rest of the page agree
  // with it — the rail narrowed, the counts scoped, the project headings gone.
  paintNav();
  applyFilters();
  // A selection that arrived in the URL (a spec page's header chip) has not been
  // stored yet. Persisting it here rather than on the GET keeps the request free
  // of side effects, and stops the stored selection disagreeing with the screen,
  // which would make "specforge create" file into a project you are not looking
  // at.
  //
  // Only when the ask was honoured. A name that no longer exists falls back to
  // All projects for display, and storing THAT would let a stale link silently
  // clear a selection the user still wants — a worse outcome than the stale link
  // itself, because it outlives the page.
  (function(){
    if(!/[?&]project=/.test(location.search)) return;
    var asked=new URLSearchParams(location.search).get('project');
    if(asked===fproj) putSelection();
  })();

  // Shared-with-me cards: refresh name + spec count from each remote's public
  // meta on every load (nothing is stored beyond the pointer), and flip a card
  // to unreachable when its owner's machine does not answer. Cross-origin: the
  // gateway allows CORS on exactly this one read-only route.
  (function(){
    var cards=[].slice.call(document.querySelectorAll('#subs .srow'));
    cards.forEach(function(a){
      var ctl=new AbortController();
      var timer=setTimeout(function(){ctl.abort();},5000);
      fetch(a.getAttribute('data-meta'),{signal:ctl.signal}).then(function(r){
        clearTimeout(timer);
        if(!r.ok) throw new Error('unreachable');
        return r.json();
      }).then(function(m){
        if(m&&typeof m.project==='string'&&m.project){a.querySelector('.sname').textContent=m.project;}
        if(m&&typeof m.specs==='number'){var nc=a.querySelector('.snc');nc.textContent=m.specs;nc.hidden=false;}
      }).catch(function(){
        clearTimeout(timer);
        a.querySelector('.soff').hidden=false;
        a.classList.add('off');
      });
    });
  })();
})();
</script>
</body></html>`;
}
