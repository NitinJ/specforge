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
  .tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 8px;align-items:center}
  .tab{padding:7px 14px;border:1px solid var(--line);border-radius:8px;background:var(--panel);
    color:var(--muted);text-decoration:none;font-size:13.5px}
  .tab:hover{border-color:var(--accent);color:var(--accent)}
  .tab.on{border-color:var(--accent);color:var(--ink);font-weight:600}
  .spacer{flex:1 1 auto}
  .empty{color:var(--muted);padding:40px 0}

  .lede{color:var(--muted);font-size:13px;margin:0 0 16px}
  .chip{display:inline-block;font-size:11.5px;font-weight:600;padding:1px 9px;border-radius:999px;
    border:1px solid var(--line);color:var(--muted);white-space:nowrap;vertical-align:middle}
  .chip.on{border-color:var(--accent);color:var(--accent)}
  .btn{padding:7px 14px;border:1px solid var(--line);border-radius:8px;background:var(--panel);
    color:var(--ink);font-size:13px;cursor:pointer}
  .btn:hover{border-color:var(--accent);color:var(--accent)}
  .btn.primary{border-color:var(--accent);color:var(--accent);font-weight:600}
  .btn.quiet{border:none;background:none;color:var(--muted);padding:6px 8px}
  .btn.quiet:hover{color:var(--accent)}
  .btn[disabled]{opacity:.5;cursor:default}
  .row{display:flex;align-items:center;gap:10px;padding:10px 13px;border:1px solid var(--line);
    border-radius:9px;background:var(--panel);margin:8px 0}
  .row .nm{font-weight:550;white-space:nowrap}
  .row .gap{flex:1 1 auto;min-width:0}
  .row.off .nm,.row.off .ic{opacity:.5}
  .ic{width:20px;text-align:center;flex:none}
  .vis{flex:none;border:none;background:none;cursor:pointer;font-size:14px;color:var(--muted);padding:2px 4px}
  .vis:hover{color:var(--accent)}
  .note{color:var(--muted);font-size:12px;white-space:nowrap}
  textarea{width:100%;min-height:110px;resize:vertical;padding:10px 12px;border:1px solid var(--line);
    border-radius:8px;background:var(--panel);color:var(--ink);
    font:13px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  textarea:focus{outline:none;border-color:var(--accent)}
  .ed{border:1px solid var(--accent);border-radius:9px;background:var(--panel);padding:12px 14px;margin:8px 0}
  .ed h4{margin:0 0 4px;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:var(--muted)}
  .ed .fld{margin:0 0 12px}
  .acts{display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap}
  .sec{margin:22px 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
  .new{border:1px dashed var(--line);border-radius:9px;padding:12px 14px;margin:8px 0}
  .new .grid{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
  .new input,.new select{padding:7px 10px;border:1px solid var(--line);border-radius:8px;
    background:var(--panel);color:var(--ink);font-size:13px}
  .new input:focus,.new select:focus{outline:none;border-color:var(--accent)}
  .err{color:var(--red);font-size:12.5px;margin-top:8px}
  .saved{color:var(--green);font-size:12.5px}
  @media (max-width:560px){
    .row{flex-wrap:wrap}
    .note{white-space:normal}
  }
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
    <span class="spacer"></span>
    <button class="btn quiet" id="sf-reset-class" type="button">Reset this section to shipped ⟲</button>
  </nav>

  <div id="sf-tabpanel" data-tab="${active}">
    <p class="empty" id="sf-loading">Loading…</p>
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

(function(){
  // The tabs. State lives on the server and the page re-renders from what a
  // write answers with, so what is on screen is always what the store holds
  // rather than what the page hoped it wrote.
  var panel=document.getElementById('sf-tabpanel');
  var resetBtn=document.getElementById('sf-reset-class');
  if(!panel) return;
  var TAB=panel.getAttribute('data-tab');
  var state=null;

  function esc(s){
    return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;')
      .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  function el(tag,attrs,text){
    var n=document.createElement(tag);
    for(var k in attrs){ if(attrs[k]!=null) n.setAttribute(k,attrs[k]); }
    if(text!=null) n.textContent=text;
    return n;
  }
  function api(method,url,body){
    return fetch(url,{
      method:method,
      headers:{'Content-Type':'application/json'},
      body:body===undefined?undefined:JSON.stringify(body),
    }).then(function(r){ return r.json(); });
  }
  function load(){
    return api('GET','/api/prompts').then(function(s){ state=s; render(); return s; });
  }
  function save(patch){
    return api('PUT','/api/prompts',patch).then(function(s){ state=s; render(); return s; });
  }

  function chip(customized){
    return '<span class="chip'+(customized?' on':'')+'">'
      +(customized?'customized':'default')+'</span>';
  }

  // ---- Language -----------------------------------------------------------
  function renderLanguage(){
    var L=state.language;
    panel.innerHTML=''
      +'<p class="lede">Your authoring direction: tone, sentence length, language. '
      +'It reaches the agent wherever it writes spec prose, and where it disagrees '
      +'with the house register yours wins.</p>'
      +'<p><b>Authoring direction</b> '+chip(L.customized)+'</p>'
      +'<textarea id="sf-lang" placeholder="Write terse. No metaphors, even in asides."></textarea>'
      +'<div class="acts">'
      +'<button class="btn primary" id="sf-lang-save" type="button">Save</button>'
      +'<button class="btn" id="sf-lang-reset" type="button"'+(L.customized?'':' disabled')
      +'>Reset to default</button>'
      +'<span class="note" id="sf-lang-msg"></span>'
      +'</div>';
    var ta=document.getElementById('sf-lang');
    ta.value=L.value;
    document.getElementById('sf-lang-save').onclick=function(){
      // Empty means "no direction", and clearing is explicit in the store: an
      // empty string would merge as a no-op, so it is sent as null.
      var v=ta.value.trim();
      save({language:v?v:null}).then(function(){ flash('sf-lang-msg','Saved'); });
    };
    document.getElementById('sf-lang-reset').onclick=function(){
      save({language:null}).then(function(){ flash('sf-lang-msg','Reset'); });
    };
  }

  function flash(id,text){
    var n=document.getElementById(id);
    if(!n) return;
    n.textContent=text;
    n.className='saved';
    setTimeout(function(){ if(n){ n.textContent=''; n.className='note'; } },1400);
  }

  // ---- Actions ------------------------------------------------------------
  function actionRow(a,isCustom){
    var row=el('div',{class:'row'+(a.hidden?' off':''),'data-id':a.id});
    var vis=el('button',{
      class:'vis','data-act':'vis',type:'button',
      title:a.hidden?'Show in menus':'Hide from menus',
      'aria-label':(a.hidden?'Show ':'Hide ')+a.label,
    },a.hidden?'⃠':'👁');
    row.appendChild(vis);
    row.appendChild(el('span',{class:'ic'},a.icon||'✦'));
    row.appendChild(el('span',{class:'nm'},a.label));
    if(isCustom){
      row.appendChild(el('span',{class:'chip'},a.id));
    }
    // Kind and scope on every row, shipped ones included: two shipped actions
    // are both labelled Delete (one deletes a block, one dismisses a draft), so
    // the label alone does not say which row you are about to edit.
    row.appendChild(el('span',{class:'chip'},a.kind+' · '+a.scope));
    if(!isCustom) row.insertAdjacentHTML('beforeend',chip(a.customized));
    row.appendChild(el('span',{class:'gap'}));
    if(a.hidden){
      row.appendChild(el('span',{class:'note'},'hidden from menus · still resolves on old threads'));
    }
    row.appendChild(el('button',{class:'btn quiet','data-act':'edit',type:'button'},'Edit'));
    if(isCustom){
      row.appendChild(el('button',{class:'btn quiet','data-act':'del',type:'button'},'Delete'));
    }
    return row;
  }

  function editor(a,isCustom){
    var box=el('div',{class:'ed','data-id':a.id});
    box.innerHTML=''
      +'<div class="fld"><h4>instruction</h4>'
      +'<textarea data-f="instruction"></textarea></div>'
      +(a.kind==='aside'
        ?'<div class="fld"><h4>import instruction</h4><textarea data-f="importInstruction"></textarea></div>'
        :'')
      +'<div class="acts">'
      +'<button class="btn primary" data-act="save" type="button">Save</button>'
      +(isCustom?'':'<button class="btn" data-act="reset" type="button">Reset to default</button>')
      +'<button class="btn quiet" data-act="close" type="button">Close</button>'
      +'</div>';
    box.querySelector('[data-f="instruction"]').value=a.instruction||'';
    var imp=box.querySelector('[data-f="importInstruction"]');
    if(imp) imp.value=a.importInstruction||'';
    box.setAttribute('data-custom',isCustom?'1':'');
    return box;
  }

  var openId=null;

  function renderActions(){
    panel.innerHTML='<p class="lede">What each menu entry tells the agent. '
      +'Hiding an action removes it from menus; an id inside a comment sent earlier '
      +'still resolves, so nothing you hide breaks an old thread.</p>'
      +'<div class="sec">Shipped actions</div><div id="sf-shipped"></div>'
      +'<div class="sec">Custom actions</div><div id="sf-custom"></div>'
      +'<div class="new" id="sf-new"></div>';

    var shipped=document.getElementById('sf-shipped');
    state.actions.shipped.forEach(function(a){
      shipped.appendChild(actionRow(a,false));
      if(openId===a.id) shipped.appendChild(editor(a,false));
    });

    var custom=document.getElementById('sf-custom');
    if(!state.actions.custom.length){
      custom.appendChild(el('p',{class:'note'},'None yet. Create one below.'));
    }
    state.actions.custom.forEach(function(a){
      custom.appendChild(actionRow(a,true));
      if(openId===a.id) custom.appendChild(editor(a,true));
    });

    var groups=state.actions.groups.map(function(g){
      return '<option value="'+esc(g.id)+'">'+esc(g.label)+'</option>';
    }).join('');
    document.getElementById('sf-new').innerHTML=''
      +'<div class="grid">'
      +'<input id="nf-label" type="text" placeholder="Label" size="16">'
      +'<input id="nf-icon" type="text" placeholder="Icon" size="3">'
      +'<select id="nf-kind"><option value="aside">aside</option>'
      +'<option value="in-place">in-place</option></select>'
      +'<select id="nf-scope"><option value="local">local</option>'
      +'<option value="global">global</option></select>'
      +'<select id="nf-group">'+groups+'</select>'
      +'</div>'
      +'<textarea id="nf-instruction" placeholder="What the agent should do when this is used."></textarea>'
      +'<div class="acts"><button class="btn primary" id="nf-create" type="button">Create action</button>'
      +'<span class="note">The id is generated from the label, always prefixed x_</span></div>'
      +'<div class="err" id="nf-err"></div>';
    document.getElementById('nf-create').onclick=createAction;
  }

  function findAction(id){
    var all=state.actions.shipped.concat(state.actions.custom);
    for(var i=0;i<all.length;i++){ if(all[i].id===id) return all[i]; }
    return null;
  }
  function isCustom(id){ return id.indexOf('x_')===0; }

  panel.addEventListener('click',function(e){
    var btn=e.target.closest?e.target.closest('[data-act]'):null;
    if(!btn) return;
    var holder=btn.closest('[data-id]');
    if(!holder) return;
    var id=holder.getAttribute('data-id');
    var act=btn.getAttribute('data-act');

    if(act==='vis'){
      var hiddenNow=(state.actions.shipped.concat(state.actions.custom))
        .filter(function(a){return a.hidden;}).map(function(a){return a.id;});
      var next=hiddenNow.indexOf(id)>=0
        ? hiddenNow.filter(function(x){return x!==id;})
        : hiddenNow.concat([id]);
      return void save({actions:{hidden:next.length?next:null}});
    }
    if(act==='edit'){ openId=(openId===id?null:id); return void render(); }
    if(act==='close'){ openId=null; return void render(); }
    if(act==='del'){
      return void api('PUT','/api/prompts',{deleteCustom:id}).then(function(s){
        state=s; openId=null; render();
      });
    }
    if(act==='save'){
      var box=btn.closest('.ed');
      var patch={};
      box.querySelectorAll('textarea[data-f]').forEach(function(t){
        patch[t.getAttribute('data-f')]=t.value.trim()||null;
      });
      if(isCustom(id)){
        var a=findAction(id);
        var merged={};
        for(var k in a){ if(k!=='hidden'&&k!=='customized') merged[k]=a[k]; }
        for(var p in patch){ if(patch[p]!=null) merged[p]=patch[p]; }
        var rest=state.actions.custom.filter(function(c){return c.id!==id;})
          .map(function(c){ var o={}; for(var k2 in c){ if(k2!=='hidden') o[k2]=c[k2]; } return o; });
        return void save({actions:{custom:rest.concat([merged])}}).then(function(){ openId=null; render(); });
      }
      var ov={};
      ov[id]=patch;
      return void save({actions:{overrides:ov}}).then(function(){ openId=null; render(); });
    }
    if(act==='reset'){
      // A custom action has no shipped text to go back to; its editor shows the
      // control only for shipped entries.
      if(isCustom(id)) return;
      return void api('PUT','/api/prompts',{resetOverride:id}).then(function(s){
        state=s; openId=null; render();
      });
    }
  });

  function createAction(){
    var label=document.getElementById('nf-label').value.trim();
    var instruction=document.getElementById('nf-instruction').value.trim();
    var err=document.getElementById('nf-err');
    err.textContent='';
    if(!label||!instruction){
      err.textContent='A label and an instruction are both required: a menu entry that says nothing does nothing.';
      return;
    }
    var slug=label.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
    if(!slug||!/^[a-z]/.test(slug)) slug='action_'+Date.now();
    var id='x_'+slug;
    if(findAction(id)){
      err.textContent='You already have an action with that name.';
      return;
    }
    var made={
      id:id,label:label,
      icon:document.getElementById('nf-icon').value.trim()||'✦',
      kind:document.getElementById('nf-kind').value,
      scope:document.getElementById('nf-scope').value,
      group:document.getElementById('nf-group').value,
      instruction:instruction,
    };
    var rest=state.actions.custom.map(function(c){
      var o={}; for(var k in c){ if(k!=='hidden') o[k]=c[k]; } return o;
    });
    save({actions:{custom:rest.concat([made])}});
  }

  // ---- shell --------------------------------------------------------------
  function render(){
    if(!state) return;
    if(TAB==='language') return void renderLanguage();
    if(TAB==='actions') return void renderActions();
    panel.innerHTML='<p class="empty">Nothing to configure here yet.</p>';
  }

  if(resetBtn){
    resetBtn.hidden=(TAB!=='language'&&TAB!=='actions');
    resetBtn.onclick=function(){
      if(!window.confirm('Reset every '+TAB+' setting to what SpecForge ships with?')) return;
      api('POST','/api/prompts/reset',{class:TAB}).then(function(s){
        state=s; openId=null; render();
      });
    };
  }

  load();
})();
</script>
</body>
</html>`;
}
