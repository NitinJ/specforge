// Serve-time injection: overlay the live tracker, the live-reload client, and the
// review UI (comments) onto a content-only spec. The on-disk file is never
// modified here — injection happens only in the HTTP response.

import { renderLiveTracker } from '../lib/tracker.mjs';
import { readPrefs } from '../lib/store-prefs.mjs';
import { readGlobalPrefs } from '../lib/global-prefs.mjs';

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

  const head = `<link rel="stylesheet" href="/public/review.css">`;
  if (out.includes('</head>')) out = out.replace('</head>', `${head}\n</head>`);

  // theme + font are store-wide (global-prefs); width/filter/fit/toc are per-spec.
  // Merge so the client boots with one flat prefs object as before.
  const layer = reviewSnippet(specId, { ...readGlobalPrefs(), ...readPrefs(specId) }, transport, api);
  if (out.includes('</body>')) {
    out = out.replace('</body>', `${layer}\n</body>`);
  } else {
    out += layer;
  }
  return out;
}

/** Live-reload over an event stream: the loopback case. */
function sseWatcher(id) {
  return `  try {
    var es=new EventSource('/events?spec='+encodeURIComponent(${id}));
    es.addEventListener('reload', function(){ location.reload(); });
    es.onopen=connected;
    es.onerror=disconnected;
  } catch (e) { set('○ offline','#9aa3b2'); showBanner(); }`;
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
function pollWatcher(interval) {
  return `  var last=null, misses=0, held=false;
  function poll(){
    fetch('/api/state', { cache: 'no-store' }).then(function(r){
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
  const cfg = JSON.stringify({
    specId, prefs: prefs || {}, transport, api: api || `/api/spec/${specId}`,
  });
  const watcher = transport === 'poll' ? pollWatcher(POLL_INTERVAL_MS) : sseWatcher(id);
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
<script src="/public/reconcile.js" defer></script>
<script src="/public/review.js" defer></script>`;
}
