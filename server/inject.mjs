// Serve-time injection: overlay the live tracker, the live-reload client, and the
// review UI (comments) onto a content-only spec. The on-disk file is never
// modified here — injection happens only in the HTTP response.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { renderLiveTracker } from '../lib/tracker.mjs';
import { blockComponents } from '../components/index.mjs';
import { readPrefs } from '../lib/store-prefs.mjs';
import { readGlobalPrefs } from '../lib/global-prefs.mjs';

/** Absolute path to the CLI, for the Reconnect prompt an agent is meant to run. */
const CLI_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'specforge-cli.mjs');

/**
 * @param {string} html raw spec HTML read from disk
 * @param {{specId:string, transport?:'sse'|'poll', api?:string}} opts
 *   `transport` says how this page learns the spec changed. The daemon holds an
 *   event stream; a publication cannot (measured: Cloudflare's edge returns the
 *   response headers of an SSE response and then buffers every body byte), so
 *   it polls. The listener that answers the request knows which it is, which
 *   saves every published page from probing for a stream that never speaks.
 *   `api` is the base path for the comments API, which carries no spec id on a
 *   publication.
 * @returns {string} HTML with the live tracker + review layer injected
 */
export function injectReviewLayer(html, { specId, transport = 'sse', api } = {}) {
  let out = renderLiveTracker(html);

  // ui.css first: review.css is the layer's own chrome, and where the two speak
  // about the same thing (a dialog, a message) the layer's sheet should win.
  const head = `<link rel="stylesheet" href="/public/ui.css">\n<link rel="stylesheet" href="/public/review.css">`;
  if (out.includes('</head>')) out = out.replace('</head>', `${head}\n</head>`);

  // theme + font are store-wide (global-prefs); width/filter/fit/toc are per-spec.
  // Merge so the client boots with one flat prefs object as before. Named rather
  // than spread: ui.json also holds the index page's collection order, and this
  // same layer is what a published spec serves to a stranger.
  const { theme, font } = readGlobalPrefs();
  const layer = reviewSnippet(specId, { ...(theme ? { theme } : {}), ...(font ? { font } : {}), ...readPrefs(specId) }, transport, api);
  if (out.includes('</body>')) {
    out = out.replace('</body>', `${layer}\n</body>`);
  } else {
    out += layer;
  }
  return out;
}

/**
 * Live-reload over an event stream: the loopback case.
 *
 * The stream is held only while the tab is visible. Not an optimisation — the
 * daemon becomes unusable with a handful of specs open without it.
 *
 * A browser allows about six concurrent connections per origin over HTTP/1.1,
 * counted across every tab, and an event stream is a response that deliberately
 * never completes: it holds one of those six for as long as its tab exists. At
 * six open specs the origin is saturated, and every other request queues behind
 * streams that will never finish — so Submit does not fail, it waits forever,
 * which looks exactly like a dead button. The tabs holding a stream stay healthy
 * and show no banner, because it is their neighbours' requests that starve.
 * (A publication is served over HTTP/2, which multiplexes, and is immune.)
 *
 * A hidden tab is one nobody is reading, and only one can be visible at a time,
 * so releasing on hide keeps the cost at about one connection however many specs
 * are open. Coming back asks whether the document moved meanwhile, which is
 * precisely what the dropped stream would have told us.
 */
function sseWatcher(id) {
  return `  var es=null;
  // The spec mtime the page currently on screen was built from. Captured at load
  // and refreshed on the way out, both moments when the stream was live and the
  // page therefore current.
  var shownAt=null;
  var statePath='/api/spec/'+encodeURIComponent(${id})+'/state';
  function specMtime(){
    return fetch(statePath,{cache:'no-store'})
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(s){ return s ? s.spec : null; })
      .catch(function(){ return null; });
  }
  function openStream(){
    if(es) return;
    try {
      es=new EventSource('/events?spec='+encodeURIComponent(${id}));
      es.addEventListener('reload', function(){ location.reload(); });
      es.onopen=connected;
      es.onerror=disconnected;
    } catch (e) { set('○ offline','#9aa3b2'); showBanner(); }
  }
  function closeStream(){
    if(!es) return;
    try { es.close(); } catch (e) {}
    es=null;
  }
  document.addEventListener('visibilitychange', function(){
    if(document.hidden){
      // Nothing is re-read here on purpose. Asking for the mtime on the way out
      // is a request that resolves AFTER the stream is gone, so a change landing
      // in that gap would be recorded as already-seen and the page would come
      // back stale. shownAt was captured at load and the live stream has kept it
      // true ever since: any change while visible reloads the page, which
      // captures it again.
      closeStream();
      // A stream we let go of on purpose is not a lost connection. Leaving the
      // banner armed would greet every return with "Live connection lost".
      disarmBanner(); hideBanner();
    } else {
      openStream();
      specMtime().then(function(v){
        if(shownAt!==null && v!==null && v!==shownAt) location.reload();
      });
    }
  });
  // Captured at load, including when the tab starts hidden (opened in a
  // background tab), so a spec that changes before it is ever looked at still
  // reloads on first view.
  specMtime().then(function(v){ if(shownAt===null) shownAt=v; });
  if(!document.hidden) openStream();`;
}

/**
 * Live-reload by asking: the published case.
 *
 * Reloads when the spec file's mtime moves. The comments mtime is returned too
 * and deliberately ignored here, because the rail refetches comments on its own
 * and a full reload on every comment would throw away whatever the reader was
 * typing.
 *
 * `busy` says an agent is part-way through answering a batch. Its writes land
 * one section at a time, so they are remembered and taken as a single reload
 * once the round finishes — the same hold the event stream applies.
 */
function pollWatcher(api, interval) {
  // Off the api base, never the origin root: every route a publication has lives
  // under its token, so a root path is served by nothing and every poll fails.
  return `  var statePath=${JSON.stringify(`${api}/state`)};
  var last=null, misses=0, held=false;
  function poll(){
    fetch(statePath, { cache: 'no-store' }).then(function(r){
      if(!r.ok) throw new Error('state '+r.status);
      return r.json();
    }).then(function(s){
      misses=0; connected();
      if(last===null){ last=s.spec; return; }
      if(s.spec!==last){ last=s.spec; held=true; }
      if(held && !s.busy){ location.reload(); }
    }).catch(function(){ if(++misses>1) disconnected(); });
  }
  poll();
  setInterval(poll, ${interval});`;
}

/** How often a published page asks whether the spec moved. */
const POLL_INTERVAL_MS = 5000;

function reviewSnippet(specId, prefs, transport, api) {
  const id = JSON.stringify(specId);
  // Embed the persisted prefs (store-wide theme/font + per-spec width/…) so
  // review.js applies them on boot with no flash and no extra round-trip.
  //
  // `cli` is the path the Reconnect prompt tells an agent to run, and it is
  // omitted from a published copy: a reviewer cannot reconnect someone else's
  // spec, so the button never renders there, and a filesystem path on the
  // author's machine is not something to hand a stranger.
  const base = api || `/api/spec/${specId}`;
  const cfg = JSON.stringify({
    specId, prefs: prefs || {}, transport, api: base,
    // The library's block components, so the review client can anchor a comment
    // to every one of them. Without this the client's selector list and the
    // lint's idea of what is commentable drift apart, and the lint silences a
    // warning about text nobody can actually comment on.
    blocks: blockComponents(),
    ...(transport === 'poll' ? {} : { cli: CLI_PATH }),
  });
  const watcher = transport === 'poll' ? pollWatcher(base, POLL_INTERVAL_MS) : sseWatcher(id);
  return `<!-- specforge:review-layer -->
<div id="sf-live" class="sf-live">● live</div>
<div id="sf-disconnected" class="sf-disconnected" role="alert" hidden>
  <span class="sf-dc-dot"></span>
  <span class="sf-dc-msg">Live connection lost. This spec may be stale, and new comments will not save until it reconnects.</span>
  <button type="button" class="sf-dc-reload" onclick="location.reload()">Reload</button>
</div>
<script>window.SPECFORGE = ${cfg};</script>
<script>
(function(){
  var pill=document.getElementById('sf-live');
  var banner=document.getElementById('sf-disconnected');
  var timer=null, GRACE=4000;
  function set(t,c){ if(pill){pill.textContent=t; pill.style.color=c;} }
  function showBanner(){ if(banner){ banner.hidden=false; } }
  function hideBanner(){ if(banner){ banner.hidden=true; } }
  // Debounce: only surface the banner if the connection stays down past GRACE,
  // so a normal live-reload or a momentary blip never flashes it.
  function armBanner(){ if(timer==null){ timer=setTimeout(function(){ timer=null; showBanner(); }, GRACE); } }
  function disarmBanner(){ if(timer!=null){ clearTimeout(timer); timer=null; } }
  function connected(){ disarmBanner(); hideBanner(); set('● live','#3fb950'); }
  function disconnected(){ set('● reconnecting','#d29922'); armBanner(); }
${watcher}
})();
</script>
<script src="/public/ui.js" defer></script>
<script src="/public/reconcile.js" defer></script>
<script src="/public/review.js" defer></script>`;
}
