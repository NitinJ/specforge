// The public project index, served at /p/<token>.
//
// A directory, not a store: rows are computed per request from spec meta, which
// is what makes the page always show the project as it is now (a spec filed
// tomorrow appears; one moved out is gone). Every status is listed — a draft is
// as visible as an approved spec (spec 82f5dabccf, Q3).
//
// Read-only by construction: the page carries links and nothing else, because a
// reviewer's write surface is a spec page's comments, never the listing.

import { listSpecs } from '../lib/meta.mjs';
import { listContributions } from '../lib/store-project-shares.mjs';
import { readGlobalPrefs } from '../lib/global-prefs.mjs';
import { groupByCollection, UNCOLLECTED } from '../lib/collections.mjs';
import { projectCollaborators } from '../lib/collaborators.mjs';
import { THEME_CSS, BODY_FONT, CONTENT_WIDTH, LIST_CSS } from './theme.mjs';

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Compact "x ago" for the updated stamp (empty when unknown). */
function relativeTime(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** The specs currently in this project, newest first. */
export function projectSpecs(name) {
  return listSpecs()
    .filter((m) => (m.project || null) === name)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

/**
 * Render the project index for a share token.
 *
 * @param {string} name the project (already resolved from the token)
 * @param {string} token rides into each spec link, which is scoped to it
 */
export function renderProjectPage(name, token) {
  // The same row anatomy the owner sees: title on the left taking what is left,
  // then the signals in fixed-width slots so they line up as columns down the
  // list. The controls that ride on the owner's row (select, tags, actions) are
  // not here, because a reviewer has none of them.
  const localRow = (m) => `
    <li class="row">
      <span class="main"><a class="title" href="/p/${token}/spec/${m.id}">${esc(m.title || 'Untitled')}</a></span>
      <span class="badge t">${esc(m.type || '')}</span>
      <span class="badge s s-${esc(m.status || 'draft')}"><span class="sdot"></span>${esc(m.status || 'draft')}</span>
      <span class="upd">${esc(relativeTime(m.updated))}</span>
    </li>`;

  // Grouped under collection headings rather than labelled per row, which is
  // what the owner sees for the same project on their own home page. A label on
  // every row leaves the reader to sort 20 rows into 6 groups by eye; the
  // heading does it once. The order is groupByCollection's, shared with the home
  // page so the two cannot disagree about which group comes first.
  //
  // A project with no collections at all gets no headings: one heading over
  // every row names nothing, and the store has such projects (specforge holds 23
  // specs and 0 collections).
  const specs = projectSpecs(name);
  const { order, named } = groupByCollection(specs, readGlobalPrefs().collectionOrder);
  const local = named.length
    ? order.map(({ key, specs: list }) => `
  <section class="grp">
    <h2>${key === '' ? UNCOLLECTED : esc(key)} <span class="gcount">${list.length}</span></h2>
    <div class="card"><ul class="rows">${list.map(localRow).join('')}</ul></div>
  </section>`).join('')
    : (specs.length ? `<div class="card"><ul class="rows">${specs.map(localRow).join('')}</ul></div>` : '');

  // Contributed rows link OFF this origin, to the machine that owns the spec.
  // Nothing about them is served from here: the title and owner are the
  // metadata their contributor registered, and the link is theirs to answer.
  // Their own section, always last: this machine holds no collection for them,
  // so they belong to no group above and filing them under one would claim it.
  const contribs = listContributions(name);
  const contributed = contribs.length ? `
  <section class="grp">
    <h2>From other machines <span class="gcount">${contribs.length}</span></h2>
    <div class="card"><ul class="rows">${contribs.map((e) => `
    <li class="row">
      <span class="main"><a class="title" href="${esc(`${e.origin}/s/${e.token}`)}" target="_blank" rel="noopener">${esc(e.title)}</a></span>
      <span class="by">${esc(e.owner)}</span>
      <span class="elsewhere" title="Served from ${esc(e.origin)}">elsewhere</span>
      <span class="upd">${esc(relativeTime(Date.parse(e.addedAt) || 0))}</span>
    </li>`).join('')}</ul></div>
  </section>` : '';

  const rows = `${local}${contributed}`;

  // Who else is in here. A reader arriving at the link cannot otherwise tell
  // whether they are the first person on the project or the fifth, and the names
  // are already on every comment in every spec — this only gathers them where
  // the reader meets them first.
  //
  // Local specs only. A contributed row is served by another machine and its
  // comments live there; the person who contributed it is named on the row
  // itself, which is a different fact from having reviewed the project.
  //
  // Read per request from each spec's comment store, like every other number on
  // this page. Nothing is cached: a project's rows are already recomputed per
  // request, and a stale collaborator list would be worse than none.
  const people = projectCollaborators(specs.map((m) => m.id));
  const plural = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const collaborators = people.length ? `
  <section class="collab">
    <h2>Collaborators <span class="gcount">${people.length}</span></h2>
    <ul class="people">${people.map((p) => `
      <li class="person" title="${esc(`${plural(p.comments, 'comment')} on ${plural(p.specs, 'spec')}`)}">${esc(p.name)}</li>`).join('')}</ul>
  </section>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — SpecForge</title>
<script>
// Applied before the body paints, so a reader who chose light does not get a
// dark flash first. No choice stored leaves the attribute off, which is how the
// OS preference below stays in charge.
(function(){try{var t=localStorage.getItem('sf-theme');
if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();
</script>
<style>
${THEME_CSS}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);font:${BODY_FONT}}
  main{max-width:${CONTENT_WIDTH};margin:0 auto;padding:32px 28px 80px}
  @media(max-width:960px){main{padding:24px 18px 60px}}
  h1{font-size:22px;margin:0 0 4px}
  .sub{color:var(--muted);font-size:13px;margin:0 0 24px}
  /* The title and the toggle share a line: the toggle is chrome, so it sits at
     the edge rather than in the reading column. */
  .head{display:flex;align-items:flex-start;gap:16px}
  .head .htext{flex:1 1 auto;min-width:0}
  .theme{flex:none;display:inline-flex;align-items:center;justify-content:center;
    width:32px;height:32px;padding:0;border:1px solid var(--line);border-radius:8px;
    background:var(--panel);color:var(--muted);cursor:pointer}
  .theme:hover{border-color:var(--accent);color:var(--accent)}
  .theme svg{display:block}
  ul{list-style:none;margin:0;padding:0}
  a{color:inherit;text-decoration:none}
${LIST_CSS}
  .by{color:var(--muted);font-size:12px;white-space:nowrap}
  .elsewhere{font-size:11.5px;color:var(--muted);border:1px dashed var(--line);
    border-radius:999px;padding:1px 8px;white-space:nowrap}
  .upd{color:var(--muted);font-size:12px;white-space:nowrap}
  .empty{color:var(--muted);padding:24px 0}
  /* Above the list, where a reader meets it without scrolling: under the list it
     was below the fold on any project past a screenful, so the readers most
     likely to want their own copy were the ones least likely to see it. Kept to
     a quiet panel rather than a banner, because reading the specs is still what
     the page is for. */
  .join{margin:0 0 22px;padding:13px 15px;border:1px solid var(--line);
    border-radius:10px;background:var(--panel)}
  .join h2{font-size:13.5px;margin:0 0 3px}
  .join p{color:var(--muted);font-size:12.5px;margin:0 0 10px;max-width:60ch}
  .cmd{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
  .cmd code{flex:1 1 auto;min-width:0;overflow-x:auto;white-space:nowrap;
    padding:8px 10px;border:1px solid var(--line);border-radius:8px;
    background:var(--panel);font:12.5px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
  .cmd button{flex:0 0 auto;padding:8px 14px;border:1px solid var(--line);border-radius:8px;
    background:var(--panel);color:var(--ink);font-size:12.5px;cursor:pointer}
  .cmd button:hover{border-color:var(--accent);color:var(--accent)}

  /* Collaborators — names, laid out as a wrapping row of chips rather than a
     list, because the set is read as a group ("who is in here") and never
     scanned down. Sits directly under the title, above the join panel: it is
     one line about the project, not a section of it. The heading borrows .grp's
     size and its count pill, so it reads as the same kind of label as the
     collection headings further down. */
  .collab{margin:0 0 20px}
  .collab h2{display:flex;align-items:baseline;gap:8px;font-size:13px;font-weight:650;
    letter-spacing:.02em;color:var(--muted);margin:0 0 7px;padding:0 2px}
  .people{display:flex;flex-wrap:wrap;gap:7px}
  /* No link and no hover lift: a name here is a fact, and dressing it as a
     control promises a person page this product does not have. The tooltip
     carries the counts rather than the chip, which keeps the row scannable at
     any project size. */
  .person{font-size:12.5px;color:var(--ink);background:var(--panel);
    border:1px solid var(--line);border-radius:999px;padding:3px 11px;
    max-width:22ch;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

  /* The row's own responsive ladder is in the shared list block, so this page
     and the home page shed the same columns at the same widths. */
</style>
</head>
<body>
<main>
  <div class="head">
    <div class="htext">
      <h1>${esc(name)}</h1>
      <p class="sub">A shared SpecForge project. Open a spec to read and comment.</p>
    </div>
    <button class="theme" id="sf-theme" type="button" aria-label="Toggle theme" title="Toggle theme"></button>
  </div>
${collaborators}
  <section class="join">
    <h2>Add to my SpecForge</h2>
    <p>Use SpecForge yourself? Join this project and it appears on your own home
      page, under Shared with me, alongside your projects.</p>
    <div class="cmd">
      <code id="sf-join-cmd">specforge join ${esc(`/p/${token}`)}</code>
      <button type="button" id="sf-join-copy">Copy</button>
    </div>
  </section>

  ${rows || '<p class="empty">No specs in this project right now.</p>'}
</main>
<script>
(function(){
  // Theme toggle. The reader's choice lives in their own localStorage, never on
  // the owner's machine: this page makes no writes off the browser, and a
  // preference is not worth being the exception.
  var SUN='<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor"'
    +' stroke-width="1.5" aria-hidden="true"><circle cx="7.5" cy="7.5" r="3.2"/>'
    +'<path d="M7.5 1v1.8M7.5 12.2V14M1 7.5h1.8M12.2 7.5H14M2.9 2.9l1.3 1.3'
    +'M10.8 10.8l1.3 1.3M12.1 2.9l-1.3 1.3M4.2 10.8l-1.3 1.3"/></svg>';
  var MOON='<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor"'
    +' stroke-width="1.5" aria-hidden="true"><path d="M12.5 9.5A5.5 5.5 0 1 1 5.5 2.5'
    +'a4.5 4.5 0 0 0 7 7z"/></svg>';
  var btn=document.getElementById('sf-theme');
  if(btn){
    // With nothing stored the attribute is absent and the OS decides, so ask the
    // browser what it actually resolved to rather than assuming a default.
    var current=function(){
      var set=document.documentElement.getAttribute('data-theme');
      if(set==='light'||set==='dark') return set;
      try{
        return window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches
          ? 'light' : 'dark';
      }catch(e){ return 'dark'; }
    };
    var paint=function(){ btn.innerHTML=current()==='dark'?MOON:SUN; };
    paint();
    btn.onclick=function(){
      var next=current()==='dark'?'light':'dark';
      document.documentElement.setAttribute('data-theme',next);
      try{ localStorage.setItem('sf-theme',next); }catch(e){}
      paint();
    };
    // With no choice stored the CSS follows the OS live, so an OS that switches
    // at sunset repaints the page while the icon stays where it was and starts
    // naming a theme that is no longer in force. Repaint on the same signal.
    // A no-op once a choice is stored: the attribute answers current() first.
    try{
      var mq=window.matchMedia('(prefers-color-scheme: light)');
      if(mq.addEventListener) mq.addEventListener('change',paint);
      else if(mq.addListener) mq.addListener(paint);
    }catch(e){}
  }

  // The server serves this through a tunnel and does not know the origin the
  // reader arrived on, so the command is completed here, from the address bar.
  var cmd=document.getElementById('sf-join-cmd');
  var copy=document.getElementById('sf-join-copy');
  if(!cmd||!copy) return;
  var full='specforge join '+location.origin+'/p/'+${JSON.stringify(token)};
  cmd.textContent=full;
  copy.onclick=function(){
    var done=function(){
      var was=copy.textContent;
      copy.textContent='Copied';
      setTimeout(function(){copy.textContent=was;},1200);
    };
    // No clipboard (insecure context, or refused): select it instead, so it is
    // one keystroke away rather than a dead button.
    var fallback=function(){
      try{
        var r=document.createRange(); r.selectNodeContents(cmd);
        var s=window.getSelection(); s.removeAllRanges(); s.addRange(r);
      }catch(e){}
    };
    try{ navigator.clipboard.writeText(full).then(done,fallback); }
    catch(e){ fallback(); }
  };
})();
</script>
</body>
</html>`;
}
