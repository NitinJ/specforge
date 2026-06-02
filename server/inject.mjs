// Serve-time injection: overlay the live tracker, the live-reload client, and the
// review UI (comments) onto a content-only spec. The on-disk file is never
// modified here — injection happens only in the HTTP response.

import { renderLiveTracker } from '../lib/tracker.mjs';

/**
 * @param {string} html raw spec HTML read from disk
 * @param {{specId:string}} opts
 * @returns {string} HTML with the live tracker + review layer injected
 */
export function injectReviewLayer(html, { specId }) {
  let out = renderLiveTracker(html);

  const head = `<link rel="stylesheet" href="/public/review.css">`;
  if (out.includes('</head>')) out = out.replace('</head>', `${head}\n</head>`);

  const layer = reviewSnippet(specId);
  if (out.includes('</body>')) {
    out = out.replace('</body>', `${layer}\n</body>`);
  } else {
    out += layer;
  }
  return out;
}

function reviewSnippet(specId) {
  const id = JSON.stringify(specId);
  return `<!-- specforge:review-layer -->
<div id="sf-live" class="sf-live">● live</div>
<script>window.SPECFORGE = { specId: ${id} };</script>
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
</script>
<script src="/public/review.js" defer></script>`;
}
