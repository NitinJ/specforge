// Serve-time injection: overlay the live tracker and a live-reload client onto a
// content-only spec. The on-disk file is never modified here — injection happens
// only in the HTTP response.

import { renderLiveTracker } from '../lib/tracker.mjs';

/**
 * @param {string} html raw spec HTML read from disk
 * @param {{specId:string}} opts
 * @returns {string} HTML with the live tracker + live-reload client injected
 */
export function injectReviewLayer(html, { specId }) {
  let out = renderLiveTracker(html);
  const layer = liveReloadSnippet(specId);
  if (out.includes('</body>')) {
    out = out.replace('</body>', `${layer}\n</body>`);
  } else {
    out += layer;
  }
  return out;
}

function liveReloadSnippet(specId) {
  const id = JSON.stringify(specId);
  return `<!-- specforge:review-layer -->
<div id="sf-live" style="position:fixed;left:14px;bottom:12px;z-index:40;font:11px/1.4 ui-monospace,Menlo,monospace;color:#9aa3b2;background:rgba(0,0,0,.35);border:1px solid rgba(128,128,128,.35);border-radius:999px;padding:3px 9px">● live</div>
<script>
(function(){
  var pill=document.getElementById('sf-live');
  function set(t,c){ if(pill){pill.textContent=t; pill.style.color=c;} }
  try {
    var es=new EventSource('/events?spec='+encodeURIComponent(${id}));
    es.addEventListener('reload', function(){ location.reload(); });
    es.onopen=function(){ set('● live','#3fb950'); };
    es.onerror=function(){ set('● reconnecting','#d29922'); };
  } catch (e) { set('○ offline','#9aa3b2'); }
})();
</script>`;
}
