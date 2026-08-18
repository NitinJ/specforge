// The configuration page, served at /settings.
//
// Where the prompt text that steers agents is read and edited: a tab per class
// (Language, Sections, Rules, Actions), and the Templates strip beneath them.
// Server-rendered like every other page in this product, for the same reason:
// the shell is one string, the theme is CSS variables, and there is no build
// step to keep working.
//
// Stage 0 lands the route and the shell only, so the page harness exists before
// the page does. The tabs arrive in stage 3, Sections and Rules in stage 4.
//
// Spec 094abd0b9d §6.

/** The classes, in tab order. Each becomes a tab in stage 3 and 4. */
export const CLASSES = [
  { id: 'language', label: 'Language' },
  { id: 'sections', label: 'Sections' },
  { id: 'rules', label: 'Rules' },
  { id: 'actions', label: 'Actions' },
];

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * Render the settings page.
 *
 * @param {object} [opts]
 * @param {string} [opts.tab] which class is open; defaults to the first
 * @returns {string} a complete HTML document
 */
export function renderSettings(opts = {}) {
  const active = CLASSES.some((c) => c.id === opts.tab) ? opts.tab : CLASSES[0].id;

  const tabs = CLASSES.map((c) => `
      <a class="tab${c.id === active ? ' on' : ''}" href="/settings?tab=${c.id}"
         data-tab="${c.id}"${c.id === active ? ' aria-current="page"' : ''}>${esc(c.label)}</a>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Configuration — SpecForge</title>
<script>
// Applied before the body paints, so a reader who chose light does not get a
// dark flash first. Same contract as the shared project page.
(function(){try{var t=localStorage.getItem('sf-theme');
if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();
</script>
<style>
  /* Three states, in the order the cascade needs them: dark is the base, the OS
     preference supplies light unless the reader explicitly chose dark, and an
     explicit choice wins over both. */
  :root{--bg:#0f1115;--panel:#171a21;--panel2:#1d212b;--ink:#e6e8ee;--muted:#9aa3b2;
    --line:#2a2f3a;--accent:#6ea8fe;--green:#3fb950;--amber:#d29922;--red:#f85149}
  @media (prefers-color-scheme: light){
    :root:not([data-theme="dark"]){--bg:#fbfaf7;--panel:#ffffff;--panel2:#f5f3ee;--ink:#222629;
      --muted:#5f6873;--line:#e4e0d7;--accent:#2563eb;--green:#15803d;--amber:#b45309;--red:#b91c1c}
  }
  :root[data-theme="light"]{--bg:#fbfaf7;--panel:#ffffff;--panel2:#f5f3ee;--ink:#222629;
    --muted:#5f6873;--line:#e4e0d7;--accent:#2563eb;--green:#15803d;--amber:#b45309;--red:#b91c1c}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  main{max-width:960px;margin:0 auto;padding:32px 24px 80px}
  .head{display:flex;align-items:flex-start;gap:16px}
  .head .htext{flex:1 1 auto;min-width:0}
  h1{font-size:22px;margin:0 0 4px}
  .sub{color:var(--muted);font-size:13px;margin:0 0 22px}
  .back{color:var(--muted);text-decoration:none;font-size:13px}
  .back:hover{color:var(--accent)}
  .theme{flex:none;display:inline-flex;align-items:center;justify-content:center;
    width:32px;height:32px;padding:0;border:1px solid var(--line);border-radius:8px;
    background:var(--panel);color:var(--muted);cursor:pointer}
  .theme:hover{border-color:var(--accent);color:var(--accent)}
  .theme svg{display:block}
  .tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 20px}
  .tab{padding:7px 14px;border:1px solid var(--line);border-radius:8px;background:var(--panel);
    color:var(--muted);text-decoration:none;font-size:13.5px}
  .tab:hover{border-color:var(--accent);color:var(--accent)}
  .tab.on{border-color:var(--accent);color:var(--ink);font-weight:600}
  .empty{color:var(--muted);padding:40px 0}
</style>
</head>
<body>
<main>
  <div class="head">
    <div class="htext">
      <a class="back" href="/">&larr; Home</a>
      <h1>Configuration</h1>
      <p class="sub">The instructions SpecForge hands your agents. Edits apply to the next spec, verify or action.</p>
    </div>
    <button class="theme" id="sf-theme" type="button" aria-label="Toggle theme" title="Toggle theme"></button>
  </div>

  <nav class="tabs" id="sf-tabs" aria-label="Settings sections">${tabs}
  </nav>

  <div id="sf-tabpanel" data-tab="${active}">
    <p class="empty">Nothing to configure here yet.</p>
  </div>
</main>
<script>
(function(){
  // Theme toggle. The choice lives in this browser's localStorage; the page
  // writes nothing to the store, so a preference cannot become a daemon call.
  var SUN='<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor"'
    +' stroke-width="1.5" aria-hidden="true"><circle cx="7.5" cy="7.5" r="3.2"/>'
    +'<path d="M7.5 1v1.8M7.5 12.2V14M1 7.5h1.8M12.2 7.5H14M2.9 2.9l1.3 1.3'
    +'M10.8 10.8l1.3 1.3M12.1 2.9l-1.3 1.3M4.2 10.8l-1.3 1.3"/></svg>';
  var MOON='<svg width="15" height="15" viewBox="0 0 15 15" fill="none" stroke="currentColor"'
    +' stroke-width="1.5" aria-hidden="true"><path d="M12.5 9.5A5.5 5.5 0 1 1 5.5 2.5'
    +'a4.5 4.5 0 0 0 7 7z"/></svg>';
  var btn=document.getElementById('sf-theme');
  if(!btn) return;
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
  // With no choice stored the CSS follows the OS live, so the icon subscribes to
  // the same signal or it starts naming a theme no longer in force.
  try{
    var mq=window.matchMedia('(prefers-color-scheme: light)');
    if(mq.addEventListener) mq.addEventListener('change',paint);
    else if(mq.addListener) mq.addListener(paint);
  }catch(e){}
})();
</script>
</body>
</html>`;
}
