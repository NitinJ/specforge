// Serve-time injection: overlay the live tracker, the live-reload client, and the
// review UI (comments) onto a content-only spec. The on-disk file is never
// modified here — injection happens only in the HTTP response.

import { renderLiveTracker } from '../lib/tracker.mjs';
import { readPrefs } from '../lib/store-prefs.mjs';
import { readGlobalPrefs } from '../lib/global-prefs.mjs';

/**
 * @param {string} html raw spec HTML read from disk
 * @param {{specId:string}} opts
 * @returns {string} HTML with the live tracker + review layer injected
 */
export function injectReviewLayer(html, { specId }) {
  let out = renderLiveTracker(html);

  const head = `<link rel="stylesheet" href="/public/review.css">`;
  if (out.includes('</head>')) out = out.replace('</head>', `${head}\n</head>`);

  // theme + font are store-wide (global-prefs); width/filter/fit/toc are per-spec.
  // Merge so the client boots with one flat prefs object as before.
  const layer = reviewSnippet(specId, { ...readGlobalPrefs(), ...readPrefs(specId) });
  if (out.includes('</body>')) {
    out = out.replace('</body>', `${layer}\n</body>`);
  } else {
    out += layer;
  }
  return out;
}

function reviewSnippet(specId, prefs) {
  const id = JSON.stringify(specId);
  // Embed the persisted prefs (store-wide theme/font + per-spec width/…) so
  // review.js applies them on boot with no flash and no extra round-trip.
  const prefsJson = JSON.stringify(prefs || {});
  return `<!-- specforge:review-layer -->
<div id="sf-live" class="sf-live">● live</div>
<div id="sf-disconnected" class="sf-disconnected" role="alert" hidden>
  <span class="sf-dc-dot"></span>
  <span class="sf-dc-msg">Live connection lost. This spec may be stale, and new comments will not save until it reconnects.</span>
  <button type="button" class="sf-dc-reload" onclick="location.reload()">Reload</button>
</div>
<script>window.SPECFORGE = { specId: ${id}, prefs: ${prefsJson} };</script>
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
  try {
    var es=new EventSource('/events?spec='+encodeURIComponent(${id}));
    es.addEventListener('reload', function(){ location.reload(); });
    es.onopen=connected;
    es.onerror=disconnected;
  } catch (e) { set('○ offline','#9aa3b2'); showBanner(); }
})();
</script>
<script src="/public/review.js" defer></script>`;
}
