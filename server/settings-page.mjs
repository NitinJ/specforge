// The configuration page, served at /settings.
//
// Where the prompt text that steers agents is read and edited: a tab per class
// (Language, Sections, Rules, Actions), and a Templates tab beside them.
// Server-rendered like every other page in this product, for the same reason:
// the shell is one string, the theme is CSS variables, and there is no build
// step to keep working.
//
// Stage 0 lands the route and the shell only, so the page harness exists before
// the page does. The tabs arrive in stage 3, Sections and Rules in stage 4.
//
// Spec 094abd0b9d §6.

import { listSpecs } from '../lib/meta.mjs';
import { ensureTemplates } from '../lib/store-templates.mjs';
import { customTypes } from '../lib/spec-types.mjs';

/**
 * The tabs, in order. The first four are prompt classes; Templates is the
 * objects the Sections and Rules tabs write into, given a tab of its own so it
 * sits beside them rather than beneath every one of them.
 */
export const CLASSES = [
  { id: 'language', label: 'Language' },
  { id: 'sections', label: 'Sections' },
  { id: 'rules', label: 'Rules' },
  { id: 'actions', label: 'Actions' },
  { id: 'templates', label: 'Templates' },
];

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/**
 * One template card. Opens the template spec, which is how it has always been
 * edited.
 *
 * A custom kind's card carries a remove control; a built-in's does not, because
 * a built-in cannot be removed and a control that only ever refuses is worse
 * than no control. The card stays an anchor and the control is a button beside
 * it rather than inside it, because a button inside a link is a click target
 * that does two things.
 */
function tplCard(m, custom) {
  const remove = custom ? `
      <button class="tdel" type="button" data-slug="${esc(m.type || '')}"
        title="Remove this kind" aria-label="Remove the ${esc(m.type || '')} kind">✕</button>` : '';
  return `<div class="tcardwrap${custom ? ' custom' : ''}">
      <a class="tcard" href="/spec/${esc(m.id)}" data-id="${esc(m.id)}">
        <span class="tname">${esc(m.type || m.id)}</span>
        <span class="tsub">${custom ? 'yours' : 'template'}</span>
      </a>${remove}
    </div>`;
}

/**
 * The Add form: a name, a prompt, and which shell family the kind uses.
 *
 * The shell is asked rather than inferred (Q2). A kind either carries an
 * implementation plan or it does not, the words for that are plain, and it
 * removes a guess from the one step that takes a minute to redo.
 */
function addForm() {
  return `<div class="addform" id="sf-add-form" hidden>
      <div class="fld">
        <label for="sf-add-name">Name</label>
        <input id="sf-add-name" type="text" maxlength="60" placeholder="Postmortem" autocomplete="off">
      </div>
      <div class="fld">
        <label for="sf-add-prompt">What it is for, and what is in it</label>
        <textarea id="sf-add-prompt" rows="5" maxlength="4000"
          placeholder="A postmortem for a production incident. Sections: what happened, timeline, impact with numbers, root cause, what we are changing. Use it when an incident is over and we are writing up what went wrong."></textarea>
        <p class="hint">Describe the sections and when this kind should be used. An agent writes the
          template from this, and you refine it afterwards by commenting on it.</p>
      </div>
      <div class="fld">
        <label>Does this kind of spec carry an implementation plan?</label>
        <label class="radio"><input type="radio" name="sf-add-shell" value="doc" checked> No, it is a document</label>
        <label class="radio"><input type="radio" name="sf-add-shell" value="impl"> Yes, stages and a task tracker</label>
      </div>
      <p class="adderr" id="sf-add-err" hidden></p>
      <div class="addacts">
        <button class="btn" id="sf-add-go" type="button">Create template</button>
        <button class="btn quiet" id="sf-add-cancel" type="button">Cancel</button>
      </div>
    </div>`;
}

/**
 * The wait.
 *
 * The user chose to be held here rather than land on a half-written spec (D5),
 * which makes this dialog's honesty the feature. The bar is indeterminate
 * because the daemon cannot see how far along the skill is and a bar claiming
 * 70% would be invented (D6); the elapsed counter is the true signal. The three
 * lines say what the wait buys, which is the only reason to sit through it.
 */
function waitDialog() {
  return `<div class="waitmask" id="sf-wait" role="dialog" aria-modal="true"
      aria-labelledby="sf-wait-title" hidden>
      <div class="waitcard">
        <h3 id="sf-wait-title">Writing your template</h3>

        <div class="waitrun" id="sf-wait-run">
          <div class="bar" id="sf-wait-bar" role="progressbar" aria-label="Working"><span></span></div>
          <p class="waitmeta"><span id="sf-wait-elapsed">0:00</span>
            <span class="eta" id="sf-wait-eta">Usually under a minute.</span></p>
          <p class="waitwhat">Claude is turning your description into a template spec.
            When it lands you will be able to:</p>
          <ul class="waitnext" id="sf-wait-next">
            <li>read the sections it chose</li>
            <li>comment on any section to change it</li>
            <li>create specs of this kind from now on</li>
          </ul>
        </div>

        <p class="waitslow" id="sf-wait-slow" hidden>This is taking longer than usual. The session
          will finish it whenever it next settles, and the template is already there to open.</p>
        <p class="waiterr" id="sf-wait-err" hidden></p>
        <p class="waitkept" id="sf-wait-kept" hidden>The kind was still created, and its template is
          the plain shell it started as. Open it and comment on a section to build it up by hand.</p>

        <div class="addacts">
          <a class="btn" id="sf-wait-open" href="" hidden>Open it anyway</a>
          <button class="btn" id="sf-wait-keep" type="button" hidden>Keep waiting</button>
          <button class="btn quiet" id="sf-wait-cancel" type="button">Cancel</button>
        </div>
      </div>
    </div>`;
}

/**
 * The confirm for removing a kind.
 *
 * The only irreversible action on this page, so it names both things that go
 * rather than asking "are you sure". The refusal when specs still use the kind
 * lands in the same dialog, because it is the answer to the question just
 * asked and a second surface for it would be a second place to look.
 */
function deleteDialog() {
  return `<div class="waitmask" id="sf-del" role="dialog" aria-modal="true"
      aria-labelledby="sf-del-title" hidden>
      <div class="waitcard">
        <h3 id="sf-del-title">Remove this kind?</h3>
        <div id="sf-del-stakes">
          <p class="delwhat" id="sf-del-what"></p>
          <ul class="delgoes" id="sf-del-goes">
            <li>the kind itself, so nothing can be created with it</li>
            <li>its template, and everything you have written into it</li>
          </ul>
          <p class="delnote">This cannot be undone. Specs already written with it are untouched.</p>
        </div>
        <p class="waiterr" id="sf-del-err" hidden></p>
        <div class="addacts">
          <button class="btn danger" id="sf-del-go" type="button">Remove it</button>
          <button class="btn quiet" id="sf-del-cancel" type="button">Cancel</button>
        </div>
      </div>
    </div>`;
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
  // Seeded on demand, so a fresh store shows the strip rather than an empty box:
  // the templates exist as soon as anything asks for them.
  ensureTemplates();
  const templates = listSpecs().filter((m) => m.template)
    .sort((a, b) => String(a.type || '').localeCompare(String(b.type || '')));
  // Which cards are the user's. Read from the registry rather than inferred from
  // the card, because "is this removable" is the registry's answer and a second
  // way of working it out is a second way to get it wrong.
  const mine = new Set(customTypes().map((t) => t.slug));

  const tabs = CLASSES.map((c) => `
      <a class="tab${c.id === active ? ' on' : ''}" href="/settings?tab=${c.id}"
         data-tab="${c.id}"${c.id === active ? ' aria-current="page"' : ''}>${esc(c.label)}</a>`).join('');

  // The Templates tab is rendered here rather than by the page script: it is a
  // list of links, nothing on it is fetched or written, and a tab that needs
  // no request should not start with "Loading…".
  const panel = active === 'templates'
    ? `<p class="lede">What every new spec of a type starts from. Click one to open and edit it as a spec.</p>
    <div class="tstrip">${templates.map((m) => tplCard(m, mine.has(m.type))).join('')}
      <button class="tcard addcard" id="sf-add-type" type="button">
        <span class="tname">+ Add a template</span>
        <span class="tsub">a new kind of spec</span>
      </button>
    </div>
    ${addForm()}
    ${waitDialog()}
    ${deleteDialog()}`
    : '<p class="empty" id="sf-loading">Loading…</p>';
  // Nothing on the Templates tab lives in prompts.json or a template block, so
  // there is nothing for the reset control to reset.
  const reset = active === 'templates' ? '' : `
    <span class="spacer"></span>
    <button class="btn quiet" id="sf-reset-class" type="button">Reset this section to shipped ⟲</button>`;

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
  .types{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 16px}
  .chip.type{cursor:pointer;background:var(--panel);padding:4px 12px;font-weight:500}
  .chip.type:hover{border-color:var(--accent);color:var(--accent)}
  .chip.type.on{border-color:var(--accent);color:var(--ink);font-weight:650}
  code{font-size:.9em;background:var(--panel2);border:1px solid var(--line);border-radius:5px;padding:.05em .35em}

  /* Master and detail. The tree is the document's own shape, so it is read
     top to bottom; the pane beside it edits whatever is selected. Below 760px
     they stack, because a 264px column and a textarea do not share a phone. */
  .split{display:grid;grid-template-columns:264px minmax(0,1fr);gap:18px;align-items:start}
  .tree{border:1px solid var(--line);border-radius:9px;background:var(--panel);
    padding:6px;max-height:min(70vh,620px);overflow:auto}
  .tgroup{margin:10px 9px 4px;font-size:11px;text-transform:uppercase;
    letter-spacing:.06em;color:var(--muted)}
  .tgroup:first-child{margin-top:4px}
  /* The font shorthand is avoided on purpose: font:13px/1.45 inherit is invalid
     CSS and the whole declaration is dropped, which nothing shows until you
     measure a rendered row. The class is subrow rather than sub or tsub: this
     page has one flat class namespace, .sub is its subtitle (22px bottom
     margin) and .tsub is a template card's caption (display:block), and a tree
     row silently inherited each of them in turn. */
  .tnode{display:flex;align-items:center;gap:8px;width:100%;text-align:left;
    padding:6px 9px;border:1px solid transparent;border-radius:7px;background:none;
    color:var(--ink);font-family:inherit;font-size:13px;line-height:1.45;cursor:pointer}
  .tnode:hover{background:var(--panel2)}
  /* Only the section row is outlined. A selected section can own several rows,
     and outlining each of them draws three boxes for one selection. */
  .tnode.on{border-color:var(--accent);background:var(--panel2);font-weight:600}
  .tnode.subrow{color:var(--muted);font-size:12.5px}
  .tnode.subrow.in{background:var(--panel2);color:var(--ink)}
  .tnode.dead{cursor:default;opacity:.5}
  .tnode.dead:hover{background:none}
  .tnode .tlabel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tnode .dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--accent)}
  .tnode.add{color:var(--accent);font-weight:600}
  .detail{min-width:0}
  .detail h3{margin:0 0 2px;font-size:15px}
  .detail .path{color:var(--muted);font-size:12px;margin:0 0 14px}
  .detail .fld{margin:0 0 12px}
  .detail .fld h4{margin:0 0 4px;font-size:12px;text-transform:uppercase;
    letter-spacing:.05em;color:var(--muted)}
  .detail input,.detail select{padding:7px 10px;border:1px solid var(--line);border-radius:8px;
    background:var(--panel);color:var(--ink);font-size:13px}
  .detail input:focus,.detail select:focus{outline:none;border-color:var(--accent)}
  .ro{border:1px solid var(--line);border-radius:8px;background:var(--panel2);
    padding:10px 12px;font-size:13px;color:var(--muted)}

  /* The shipped contract, verbatim. It is a markdown document rather than a
     field, so it is shown as written: a re-render could only lose fidelity. */
  .contract{border:1px solid var(--line);border-radius:9px;background:var(--panel2);
    padding:12px 14px;margin:0 0 6px;max-height:240px;overflow:auto}
  .contract pre{margin:0;white-space:pre-wrap;word-break:break-word;color:var(--muted);
    font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .count{color:var(--muted);font-size:12px;margin-left:auto}
  .count.over{color:var(--red);font-weight:600}

  .tstrip{display:flex;gap:10px;flex-wrap:wrap}
  .tcard{flex:0 0 auto;min-width:110px;padding:11px 14px;border:1px solid var(--line);
    border-radius:9px;background:var(--panel);text-decoration:none;color:var(--ink)}
  .tcard:hover{border-color:var(--accent)}
  .tname{display:block;font-weight:600;font-size:13.5px}
  .tsub{display:block;color:var(--muted);font-size:12px;margin-top:2px}
  /* The Add card is a button among links, so it says so with a dashed edge
     rather than by looking identical to the six things it is not. */
  .addcard{border-style:dashed;cursor:pointer;text-align:left;font-family:inherit}
  .addcard .tname{color:var(--accent)}

  /* A card and its remove control. The control sits beside the link rather than
     inside it: a button inside an anchor is one click target doing two things.
     Shown on hover and on focus, because a destructive control that is always
     visible on six cards is six chances to hit the wrong one, and one that is
     only on hover is unreachable by keyboard. */
  .tcardwrap{position:relative;display:flex}
  .tdel{position:absolute;top:5px;right:5px;width:20px;height:20px;padding:0;
    display:flex;align-items:center;justify-content:center;
    border:1px solid transparent;border-radius:6px;background:none;
    color:var(--muted);font:12px/1 inherit;cursor:pointer;opacity:0;
    transition:opacity .12s ease,color .12s ease,border-color .12s ease}
  /* :focus for the reveal, not :focus-visible. A control that is invisible while
     focused is broken however the focus arrived, and :focus-visible deliberately
     does not match programmatic focus. review.css learned this on the code-block
     copy button and says so there; the ring below stays on :focus-visible,
     which is what that selector is for. */
  .tcardwrap:hover .tdel,.tdel:focus{opacity:1}
  .tdel:hover{color:var(--red);border-color:var(--red)}
  .tdel:focus-visible{outline:none;border-color:var(--accent)}
  @media (hover:none){.tdel{opacity:1}}

  .btn.danger{border-color:var(--red);color:var(--red);font-weight:600}
  .btn.danger:hover{background:color-mix(in srgb,var(--red) 10%,transparent)}
  .delwhat{margin:0 0 8px;font-size:13.5px;color:var(--ink)}
  .delgoes{margin:0 0 12px;padding-left:18px;color:var(--muted);font-size:13px;line-height:1.7}
  .delnote{margin:0 0 14px;font-size:12.5px;color:var(--muted)}

  .addform{margin:18px 0 0;padding:16px;border:1px solid var(--line);
    border-radius:10px;background:var(--panel);max-width:620px}
  .addform .fld{margin:0 0 14px}
  .addform label{display:block;font-size:12px;text-transform:uppercase;
    letter-spacing:.05em;color:var(--muted);margin:0 0 5px}
  .addform label.radio{display:flex;align-items:center;gap:7px;text-transform:none;
    letter-spacing:normal;font-size:13px;color:var(--ink);margin:0 0 4px}
  .addform input[type=text],.addform textarea{width:100%;box-sizing:border-box;
    padding:8px 10px;border:1px solid var(--line);border-radius:8px;
    background:var(--panel2);color:var(--ink);font-family:inherit;font-size:13px;line-height:1.5}
  .addform textarea{resize:vertical}
  .addform input[type=text]:focus,.addform textarea:focus{outline:none;border-color:var(--accent)}
  .addform .hint{color:var(--muted);font-size:12px;margin:6px 0 0;max-width:58ch}
  .adderr{color:var(--red);font-size:12.5px;margin:0 0 12px}
  .addacts{display:flex;gap:8px;align-items:center}
  .addacts .btn{text-decoration:none}

  /* The wait. Fixed rather than inline: it is the only thing happening, and a
     dialog you can scroll away from is one you can lose. */
  .waitmask{position:fixed;inset:0;z-index:60;display:flex;align-items:center;
    justify-content:center;padding:20px;background:rgba(0,0,0,.45)}
  .waitmask[hidden]{display:none}
  .waitcard{width:min(460px,100%);padding:20px 22px;border:1px solid var(--line);
    border-radius:12px;background:var(--panel);box-shadow:0 18px 48px rgba(0,0,0,.35)}
  .waitcard h3{margin:0 0 14px;font-size:16px}
  /* Indeterminate on purpose (D6): it says work is happening and claims nothing
     about how much is left.

     A moving stripe rather than a travelling block: a block that leaves the
     track spends part of every cycle off-screen, and a screenshot at one of
     those moments shows an empty bar. This is filled at every instant, so there
     is no frame where the dialog looks stalled. */
  .bar{height:6px;border-radius:999px;background:var(--panel2);overflow:hidden;margin:0 0 12px}
  .bar span{display:block;height:100%;border-radius:999px;
    background:linear-gradient(90deg,
      color-mix(in srgb,var(--accent) 25%,transparent) 0%,
      var(--accent) 50%,
      color-mix(in srgb,var(--accent) 25%,transparent) 100%);
    background-size:220% 100%;animation:sweep 1.6s linear infinite}
  @keyframes sweep{0%{background-position:120% 0}100%{background-position:-120% 0}}
  @media (prefers-reduced-motion:reduce){.bar span{animation:none;background:var(--accent);opacity:.55}}
  .waitmeta{display:flex;gap:10px;align-items:baseline;margin:0 0 14px;
    font-size:12.5px;line-height:1.4;color:var(--muted)}
  /* Monospace on the counter alone: it changes every second, and a proportional
     digit shifts the words beside it on every tick. */
  .waitmeta #sf-wait-elapsed{color:var(--ink);font-weight:600;
    font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
  .waitwhat{margin:0 0 6px;font-size:13px;color:var(--ink)}
  .waitnext{margin:0 0 16px;padding-left:18px;color:var(--muted);font-size:13px;line-height:1.7}
  .waitslow,.waiterr,.waitkept{margin:0 0 14px;font-size:13px;line-height:1.55}
  .waitslow{color:var(--amber)}
  .waiterr{color:var(--red)}
  .waitkept{color:var(--muted)}

  @media (max-width:760px){
    .split{grid-template-columns:minmax(0,1fr)}
    .tree{max-height:250px}
  }
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

  <nav class="tabs" id="sf-tabs" aria-label="Settings sections">${tabs}${reset}
  </nav>

  <div id="sf-tabpanel" data-tab="${active}">
    ${panel}
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
    var max=L.max||4000;
    panel.innerHTML=''
      +'<p class="lede">Your authoring direction: tone, sentence length, language. '
      +'It reaches the agent wherever it writes spec prose, and where it disagrees '
      +'with the house register yours wins.</p>'
      +'<p><b>SpecForge’s writing rules</b> <span class="chip">shipped</span></p>'
      +'<div class="contract"><pre id="sf-contract"></pre></div>'
      +'<div class="acts" style="margin-bottom:22px">'
      +'<button class="btn quiet" id="sf-lang-copy" type="button">Copy into mine ↓</button>'
      +'<span class="note">Read-only. Yours is added on top of these, so copy them in '
      +'only if you mean to restate them.</span>'
      +'</div>'
      +'<p><b>Yours, on top of those</b> <span id="sf-lang-state">'+chip(L.customized)+'</span></p>'
      +'<textarea id="sf-lang" placeholder="Write terse. No metaphors, even in asides."></textarea>'
      +'<div class="acts">'
      +'<button class="btn primary" id="sf-lang-save" type="button">Save</button>'
      +'<button class="btn" id="sf-lang-reset" type="button"'+(L.customized?'':' disabled')
      +'>Reset to default</button>'
      +'<span class="note" id="sf-lang-msg"></span>'
      +'<span class="count" id="sf-lang-count"></span>'
      +'</div>';
    // textContent, not innerHTML: the contract is a markdown document and is
    // shown as written rather than rendered, so nothing in it can become markup.
    document.getElementById('sf-contract').textContent=L.contract||'';
    var ta=document.getElementById('sf-lang');
    var count=document.getElementById('sf-lang-count');
    ta.value=L.value;

    // The store truncates silently at the cap, so the one place a human types
    // this is where the limit has to be visible. Over the cap the save is
    // refused rather than quietly losing the tail.
    function tally(){
      var n=ta.value.trim().length;
      count.textContent=n+' / '+max;
      count.className=n>max?'count over':'count';
      return n;
    }
    ta.oninput=tally;
    tally();

    document.getElementById('sf-lang-copy').onclick=function(){
      // Backslashes are doubled because this script is a template literal in
      // the module that serves it: a lone \\n would arrive as a real newline
      // inside a quoted string and stop the page parsing.
      var mine=ta.value.replace(/\\s+$/,'');
      ta.value=mine?mine+'\\n\\n'+L.contract:L.contract;
      tally();
      ta.focus();
    };
    document.getElementById('sf-lang-save').onclick=function(){
      if(tally()>max){
        flash('sf-lang-msg','Too long by '+(tally()-max)+' characters. Nothing was saved.','err');
        return;
      }
      // Empty means "no direction", and clearing is explicit in the store: an
      // empty string would merge as a no-op, so it is sent as null.
      var v=ta.value.trim();
      save({language:v?v:null}).then(function(){ flash('sf-lang-msg','Saved'); });
    };
    document.getElementById('sf-lang-reset').onclick=function(){
      save({language:null}).then(function(){ flash('sf-lang-msg','Reset'); });
    };
  }

  function flash(id,text,tone){
    var n=document.getElementById(id);
    if(!n) return;
    n.textContent=text;
    // A refusal is not a confirmation: it says why nothing was written, so it
    // is red and stays up long enough to read a sentence.
    n.className=tone==='err'?'err':'saved';
    setTimeout(function(){ if(n){ n.textContent=''; n.className='note'; } },
      tone==='err'?6000:1400);
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
        patch[t.getAttribute('data-f')]=t.value.trim();
      });
      if(isCustom(id)){
        var a=findAction(id);
        var merged={};
        for(var k in a){ if(k!=='hidden'&&k!=='customized') merged[k]=a[k]; }
        // Assigned whatever the box now holds, empty included: emptying the
        // import instruction has to fall back to the default rather than
        // silently keeping the old text.
        for(var p in patch){ merged[p]=patch[p]; }
        var rest=state.actions.custom.filter(function(c){return c.id!==id;})
          .map(function(c){ var o={}; for(var k2 in c){ if(k2!=='hidden') o[k2]=c[k2]; } return o; });
        return void save({actions:{custom:rest.concat([merged])}}).then(function(){ openId=null; render(); });
      }
      // setOverride, not a plain patch: a patch replaces the whole overrides map
      // and would drop every other action's edits.
      var body={id:id};
      for(var f in patch){ body[f]=patch[f]; }
      return void api('PUT','/api/prompts',{setOverride:body}).then(function(s){
        state=s; openId=null; render();
      });
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

  // ---- Sections and Rules -------------------------------------------------
  //
  // These two live in the template specs rather than in prompts.json, because
  // they are per type and that is where they already lived. The pane is a
  // better editor over the same data, so the type picker is part of the tab.
  var tmpl=null;
  var TYPE=null;
  // What the detail pane is showing. Held here rather than in the DOM so a
  // re-render after a write lands the reader back where they were editing.
  var pick=null;      // Sections: a section id
  var pickRule=null;  // Rules: a rule id, or '+new'

  /** The custom rules only. Shipped ones are re-attached by the API on write. */
  function otherRules(){
    return tmpl.rules.filter(function(r){return !r.shipped;}).map(function(r){
      var o={id:r.id,ask:r.ask,fix:r.fix};
      if(r.severity) o.severity=r.severity;
      return o;
    });
  }
  function allPrompts(){
    return tmpl.prompts.map(function(p){ return {section:p.section,text:p.text}; });
  }

  function loadTemplate(type){
    return api('GET','/api/template/'+encodeURIComponent(type)+'/blocks')
      .then(function(t){ tmpl=t; TYPE=t.type; render(); return t; });
  }
  function saveTemplate(body){
    return api('PUT','/api/template/'+encodeURIComponent(TYPE)+'/blocks',body)
      .then(function(t){ tmpl=t; openId=null; render(); return t; });
  }

  function typePicker(){
    return '<div class="types">'+tmpl.types.map(function(t){
      return '<button class="chip type'+(t===TYPE?' on':'')+'" data-type="'+esc(t)+'" type="button">'
        +esc(t)+'</button>';
    }).join('')+'</div>';
  }

  function promptFor(section){
    for(var i=0;i<tmpl.prompts.length;i++){
      if(tmpl.prompts[i].section===section) return tmpl.prompts[i];
    }
    return null;
  }
  function sectionFor(id){
    for(var i=0;i<tmpl.sections.length;i++){
      if(tmpl.sections[i].id===id) return tmpl.sections[i];
    }
    return null;
  }
  /** The first section a prompt could attach to, so the pane is never blank. */
  function firstHolder(){
    for(var i=0;i<tmpl.sections.length;i++){
      if(tmpl.sections[i].canHold) return tmpl.sections[i].id;
    }
    return null;
  }

  function treeNode(attrs,label,dotted){
    var n=el('button',attrs);
    n.type='button';
    n.appendChild(el('span',{class:'tlabel'},label));
    // The dot is the whole answer to "which of these has guidance", which is the
    // question the tree is scanned for. A chip per row would say it louder and
    // make the column unreadable.
    if(dotted) n.appendChild(el('span',{class:'dot',title:'has guidance'}));
    return n;
  }

  function renderSections(){
    // The document's own shape, not a list of what has been written. A tab that
    // showed only sections already carrying guidance could not be used to add
    // any, which is what it is for.
    panel.innerHTML='<p class="lede">Guidance the agent reads before it writes one section '
      +'of a spec of this type. It is handed over at create and stripped from the file, so a '
      +'reader never sees it.</p>'
      +typePicker()
      +'<div class="split"><div class="tree" id="sf-tree"></div>'
      +'<div class="detail" id="sf-detail"></div></div>';

    if(pick===null||!sectionFor(pick)) pick=firstHolder();
    var tree=document.getElementById('sf-tree');
    if(!tmpl.sections.length){
      tree.appendChild(el('p',{class:'note'},'This template has no sections.'));
    }
    tmpl.sections.forEach(function(s){
      // A nested section is a target of its own, so it is indented rather than
      // folded into its parent. Indent is on the node because depth is data.
      var indent=9+(s.depth||0)*14;
      if(!s.canHold){
        tree.appendChild(treeNode({class:'tnode dead',style:'padding-left:'+indent+'px',
          title:'This section has no id, so guidance has nowhere to attach'},s.heading,false));
        return;
      }
      tree.appendChild(treeNode({
        class:'tnode'+(s.id===pick?' on':''),'data-sec':s.id,
        style:'padding-left:'+indent+'px',
      },s.heading,s.hasPrompt));
      // Sub-headings are the section's shape and are shown for that reason. They
      // select the section they belong to: guidance attaches per section, so a
      // row that selected nothing would be a row you can click and get nowhere.
      s.subheadings.forEach(function(h){
        tree.appendChild(treeNode({
          class:'tnode subrow'+(s.id===pick?' in':''),'data-sec':s.id,
          style:'padding-left:'+(indent+17)+'px',
        },h.text,false));
      });
    });

    renderSectionDetail();
  }

  function renderSectionDetail(){
    var host=document.getElementById('sf-detail');
    if(!host) return;
    var s=sectionFor(pick);
    if(!s){
      host.innerHTML='<p class="note">Pick a section on the left.</p>';
      return;
    }
    var p=promptFor(s.id);
    var isShipped=(tmpl.shipped.prompts||[]).some(function(x){return x.section===s.id;});
    host.innerHTML='<h3>'+esc(s.heading)+' '+chip(p?p.customized:false)+'</h3>'
      +'<p class="path"><code>'+esc(s.id)+'</code>'
      +(s.subheadings.length?' · '+esc(s.subheadings.map(function(h){return h.text;}).join(' · ')):'')
      +'</p>'
      +'<div class="fld"><h4>guidance</h4>'
      +'<textarea id="sd-text" placeholder="How this section should be written."></textarea></div>'
      +'<div class="acts">'
      +'<button class="btn primary" id="sd-save" type="button">Save</button>'
      +(isShipped?'<button class="btn" id="sd-reset" type="button">Reset to shipped</button>':'')
      +'<button class="btn quiet" id="sd-del" type="button"'+(p?'':' disabled')+'>Remove</button>'
      +'<span class="note" id="sd-msg"></span>'
      +'</div>';
    document.getElementById('sd-text').value=p?p.text:'';

    document.getElementById('sd-save').onclick=function(){
      var text=document.getElementById('sd-text').value.trim();
      if(!text){
        flash('sd-msg','Write the guidance, or use Remove to take it off.','err');
        return;
      }
      writePrompt(s.id,text);
    };
    document.getElementById('sd-del').onclick=function(){ writePrompt(s.id,null); };
    var reset=document.getElementById('sd-reset');
    if(reset){
      reset.onclick=function(){
        var ship=(tmpl.shipped.prompts||[]).filter(function(x){return x.section===s.id;})[0];
        writePrompt(s.id,ship?ship.text:null);
      };
    }
  }

  /** Write one section's guidance. A null text takes it off. */
  function writePrompt(section,text){
    var next=allPrompts().filter(function(p){return p.section!==section;});
    if(text) next.push({section:section,text:text});
    return saveTemplate({prompts:next,rules:otherRules()});
  }

  function ruleFor(id){
    for(var i=0;i<tmpl.rules.length;i++){ if(tmpl.rules[i].id===id) return tmpl.rules[i]; }
    return null;
  }

  function renderRules(){
    panel.innerHTML='<p class="lede">What a spec of this type is judged against by '
      +'<code>specforge verify</code>. Shipped rules come from SpecForge and are the floor '
      +'under every spec, so they are read-only; your own sit beside them.</p>'
      +typePicker()
      +'<div class="split"><div class="tree" id="sf-tree"></div>'
      +'<div class="detail" id="sf-detail"></div></div>';

    var shipped=tmpl.rules.filter(function(r){return r.shipped;});
    var mine=tmpl.rules.filter(function(r){return !r.shipped;});
    if(pickRule!=='+new'&&!ruleFor(pickRule)){
      pickRule=mine.length?mine[0].id:(shipped.length?shipped[0].id:'+new');
    }

    var tree=document.getElementById('sf-tree');
    tree.appendChild(el('div',{class:'tgroup'},'Shipped for this type'));
    if(!shipped.length) tree.appendChild(el('p',{class:'note'},'None for this type.'));
    shipped.forEach(function(r){
      tree.appendChild(treeNode({
        class:'tnode'+(r.id===pickRule?' on':''),'data-rule':r.id,
      },r.id,false));
    });
    tree.appendChild(el('div',{class:'tgroup'},'Custom'));
    if(!mine.length) tree.appendChild(el('p',{class:'note'},'None yet.'));
    mine.forEach(function(r){
      tree.appendChild(treeNode({
        class:'tnode'+(r.id===pickRule?' on':''),'data-rule':r.id,
      },r.id,true));
    });
    tree.appendChild(treeNode({
      class:'tnode add'+(pickRule==='+new'?' on':''),'data-rule':'+new',
    },'+ New rule',false));

    renderRuleDetail();
  }

  function renderRuleDetail(){
    var host=document.getElementById('sf-detail');
    if(!host) return;
    if(pickRule==='+new') return void renderNewRule(host);
    var r=ruleFor(pickRule);
    if(!r){ host.innerHTML='<p class="note">Pick a rule on the left.</p>'; return; }

    if(r.shipped){
      // Read, not edit (D9). Shown in full rather than hidden behind a lock:
      // knowing what the floor says is the reason to add anything beside it.
      host.innerHTML='<h3>'+esc(r.id)+' <span class="chip">shipped</span></h3>'
        +'<p class="path">'+esc(r.severity||'blocking')+' · read-only</p>'
        +'<div class="fld"><h4>what must be true</h4>'
        +'<div class="ro">'+esc(r.ask||'(no sentence: this entry only changes severity)')+'</div></div>'
        +(r.fix?'<div class="fld"><h4>how to fix it</h4><div class="ro">'+esc(r.fix)+'</div></div>':'')
        +'<p class="note">Shipped rules are the floor under every spec of this type. '
        +'Add your own instead.</p>';
      return;
    }

    host.innerHTML='<h3>'+esc(r.id)+' <span class="chip on">custom</span></h3>'
      +'<p class="path">Judged on every spec of type <code>'+esc(tmpl.type)+'</code>.</p>'
      +'<div class="fld"><h4>what must be true</h4>'
      +'<textarea id="rd-ask" placeholder="This is what the reviewer reads."></textarea></div>'
      +'<div class="fld"><h4>how to fix it</h4>'
      +'<input id="rd-fix" type="text" size="52" placeholder="What to do when it fails"></div>'
      +'<div class="fld"><h4>severity</h4>'
      +'<select id="rd-sev"><option value="blocking">blocking</option>'
      +'<option value="advisory">advisory</option></select></div>'
      +'<div class="acts">'
      +'<button class="btn primary" id="rd-save" type="button">Save</button>'
      +'<button class="btn quiet" id="rd-del" type="button">Remove</button>'
      +'<span class="note" id="rd-msg"></span>'
      +'</div>';
    document.getElementById('rd-ask').value=r.ask||'';
    document.getElementById('rd-fix').value=r.fix||'';
    document.getElementById('rd-sev').value=r.severity||'blocking';

    document.getElementById('rd-save').onclick=function(){
      var ask=document.getElementById('rd-ask').value.trim();
      if(!ask){ flash('rd-msg','A rule with no sentence checks nothing.','err'); return; }
      var next=otherRules().map(function(x){
        return x.id===r.id
          ? {id:r.id,ask:ask,fix:document.getElementById('rd-fix').value.trim(),
             severity:document.getElementById('rd-sev').value}
          : x;
      });
      saveTemplate({rules:next,prompts:allPrompts()});
    };
    document.getElementById('rd-del').onclick=function(){
      pickRule=null;
      saveTemplate({
        rules:otherRules().filter(function(x){return x.id!==r.id;}),
        prompts:allPrompts(),
      });
    };
  }

  function renderNewRule(host){
    host.innerHTML='<h3>New rule</h3>'
      +'<p class="path">Judged on every spec of type <code>'+esc(tmpl.type)+'</code>.</p>'
      +'<div class="fld"><h4>id</h4>'
      +'<input id="nr-id" type="text" size="34" placeholder="e.g. no_vendor_quotes"></div>'
      +'<div class="fld"><h4>what must be true</h4>'
      +'<textarea id="nr-ask" placeholder="This is what the reviewer reads."></textarea></div>'
      +'<div class="fld"><h4>how to fix it</h4>'
      +'<input id="nr-fix" type="text" size="52" placeholder="What to do when it fails"></div>'
      +'<div class="fld"><h4>severity</h4>'
      +'<select id="nr-sev"><option value="blocking">blocking</option>'
      +'<option value="advisory">advisory</option></select></div>'
      +'<div class="acts"><button class="btn primary" id="nr-create" type="button">Add rule</button>'
      +'<span class="err" id="nr-err"></span></div>';
    document.getElementById('nr-create').onclick=addRule;
  }

  function addRule(){
    var id=document.getElementById('nr-id').value.trim();
    var ask=document.getElementById('nr-ask').value.trim();
    var err=document.getElementById('nr-err');
    err.textContent='';
    if(!id||!ask){ err.textContent='An id and what must be true are both required.'; return; }
    if(!/^[a-z][a-z0-9_-]*$/.test(id)){
      err.textContent='An id is lowercase letters, digits, underscore or dash.';
      return;
    }
    if(ruleFor(id)){
      err.textContent='This type already has a rule with that id.';
      return;
    }
    var next=otherRules();
    next.push({
      id:id, ask:ask,
      fix:document.getElementById('nr-fix').value.trim(),
      severity:document.getElementById('nr-sev').value,
    });
    // Select what was just made, so the pane shows the new rule rather than
    // dropping the reader back on whatever was open before.
    pickRule=id;
    saveTemplate({rules:next,prompts:allPrompts()});
  }

  // Selection only. Every control inside the detail pane binds its own handler,
  // so this listener answers one question: which thing is being edited.
  panel.addEventListener('click',function(e){
    if(!e.target.closest) return;
    var t=e.target.closest('.type');
    if(t) {
      // A different type is a different document: neither selection carries over.
      pick=null;
      pickRule=null;
      return void loadTemplate(t.getAttribute('data-type'));
    }
    if(!tmpl) return;
    var node=e.target.closest('[data-sec],[data-rule]');
    if(!node) return;
    if(node.hasAttribute('data-sec')){
      pick=node.getAttribute('data-sec');
      return void renderSections();
    }
    pickRule=node.getAttribute('data-rule');
    return void renderRules();
  });

  // ---- shell --------------------------------------------------------------
  function render(){
    // Templates arrived rendered: a list of links the server wrote into the
    // panel, with nothing to fetch and nothing to write.
    if(TAB==='templates') return;
    if(TAB==='language'||TAB==='actions'){
      if(!state) return;
      return void (TAB==='language'?renderLanguage():renderActions());
    }
    if(!tmpl) return;
    return void (TAB==='sections'?renderSections():renderRules());
  }

  if(resetBtn){
    resetBtn.onclick=function(){
      var what=(TAB==='sections'||TAB==='rules')
        ? 'every '+TAB.slice(0,-1)+' setting for '+TYPE
        : 'every '+TAB+' setting';
      if(!window.confirm('Reset '+what+' to what SpecForge ships with?')) return;
      if(TAB==='sections'||TAB==='rules'){
        // The class goes with it: both tabs share the route, and the confirm
        // named only this one.
        return void api('POST','/api/template/'+encodeURIComponent(TYPE)+'/blocks',{class:TAB})
          .then(function(t){ tmpl=t; openId=null; render(); });
      }
      api('POST','/api/prompts/reset',{class:TAB}).then(function(s){
        state=s; openId=null; render();
      });
    };
  }

  if(TAB==='sections'||TAB==='rules') loadTemplate('design-impl');
  else if(TAB!=='templates') load();
})();

(function(){
  // Add a template: the form, and the wait.
  //
  // Its own unit rather than part of the tab machinery above, because it shares
  // nothing with it: no state object, no re-render, one route in and one out.
  var addBtn=document.getElementById('sf-add-type');
  if(!addBtn) return;

  var POLL_MS=2000;
  // Past this the dialog stops claiming and offers a way out (E4). Nothing is
  // cancelled: the request stays queued and the session finishes it when it
  // next settles, which is what the copy says.
  var DEADLINE_MS=180000;

  var form=document.getElementById('sf-add-form');
  var nameEl=document.getElementById('sf-add-name');
  var promptEl=document.getElementById('sf-add-prompt');
  var errEl=document.getElementById('sf-add-err');
  var wait=document.getElementById('sf-wait');
  var runEl=document.getElementById('sf-wait-run');
  var elapsedEl=document.getElementById('sf-wait-elapsed');
  var slowEl=document.getElementById('sf-wait-slow');
  var waitErrEl=document.getElementById('sf-wait-err');
  var openEl=document.getElementById('sf-wait-open');
  var keepEl=document.getElementById('sf-wait-keep');

  var startedAt=0, ticker=null, poller=null;

  function show(el,on){ if(on) el.removeAttribute('hidden'); else el.setAttribute('hidden',''); }
  function fail(msg){ errEl.textContent=msg; show(errEl,true); }

  function shell(){
    var picked=document.querySelector('input[name="sf-add-shell"]:checked');
    return picked?picked.value:'doc';
  }

  function mmss(ms){
    var s=Math.floor(ms/1000);
    var sec=s%60;
    return Math.floor(s/60)+':'+(sec<10?'0':'')+sec;
  }

  function stop(){
    if(ticker){ clearInterval(ticker); ticker=null; }
    if(poller){ clearInterval(poller); poller=null; }
  }

  addBtn.onclick=function(){
    show(form,true);
    show(errEl,false);
    try{ nameEl.focus(); }catch(e){}
  };
  document.getElementById('sf-add-cancel').onclick=function(){ show(form,false); };

  document.getElementById('sf-add-go').onclick=function(){
    var name=(nameEl.value||'').trim();
    var prompt=(promptEl.value||'').trim();
    show(errEl,false);
    // Checked here as well as on the route: a refusal that costs a round trip
    // reads as the server disagreeing with you, and this one is just a blank
    // field.
    if(!name) return fail('Give the template a name.');
    if(!prompt) return fail('Describe the sections and when this kind should be used.');

    fetch('/api/types',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({name:name,prompt:prompt,shell:shell()})
    }).then(function(r){
      return r.json().then(function(body){ return {ok:r.ok,body:body}; });
    }).then(function(res){
      // The form stays open with what was typed. Every refusal here is one the
      // user can act on, and retyping a five-line prompt to act on it is not
      // something to ask.
      if(!res.ok) return fail(res.body&&res.body.error?res.body.error:'Could not create that template.');
      show(form,false);
      begin(res.body);
    }).catch(function(){ fail('Could not reach SpecForge. Is the daemon still running?'); });
  };

  // Put every optional part of the dialog back where it starts.
  //
  // One place rather than a line per element in begin(), because the bug this
  // fixes was two elements added later that begin() did not know to reset: a
  // second creation on the same page inherited the first one's failure line and
  // its hidden estimate (raised in review of PR #225). A reset that has to be
  // extended by hand each time an element is added will miss the next one too.
  function resetWait(){
    ['sf-wait-open','sf-wait-keep','sf-wait-slow','sf-wait-err','sf-wait-kept']
      .forEach(function(id){ show(document.getElementById(id),false); });
    show(document.getElementById('sf-wait-eta'),true);
    waitErrEl.textContent='';
    show(runEl,true);
  }

  function begin(created){
    // The destination is known the moment the kind exists, so the anchor carries
    // it from the start: "Open it anyway" and the automatic navigation are the
    // same link, and there is no second place for the URL to be wrong.
    openEl.setAttribute('href',created.specUrl+'?created=template');
    resetWait();
    show(wait,true);
    startedAt=Date.now();
    elapsedEl.textContent='0:00';
    ticker=setInterval(function(){ elapsedEl.textContent=mmss(Date.now()-startedAt); },1000);
    poller=setInterval(function(){ poll(created.slug); },POLL_MS);
  }

  function poll(slug){
    if(Date.now()-startedAt>=DEADLINE_MS) return slow();
    fetch('/api/types/'+encodeURIComponent(slug))
      .then(function(r){ return r.json(); })
      .then(function(body){
        var state=(body&&body.generate&&body.generate.state)||'working';
        if(state==='done') return done();
        if(state==='error') return failed(body.generate.error);
      })
      // A failed poll is the daemon restarting, not a failed generation. The
      // state is on disk; keep waiting.
      .catch(function(){});
  }

  function done(){
    stop();
    openEl.click();
  }

  function failed(message){
    stop();
    show(runEl,false);
    waitErrEl.textContent=message||'The template could not be written.';
    show(waitErrEl,true);
    // Said explicitly, because the error alone reads as "nothing happened" and
    // what actually happened is that the kind exists with an unwritten template.
    show(document.getElementById('sf-wait-kept'),true);
    show(openEl,true);
  }

  function slow(){
    stop();
    // The estimate goes with the ticker. Leaving "usually under a minute" beside
    // an elapsed 3:22 is the dialog arguing with itself, and the amber line
    // below is now the honest statement of where things stand.
    show(document.getElementById('sf-wait-eta'),false);
    show(slowEl,true);
    show(openEl,true);
    show(keepEl,true);
  }

  keepEl.onclick=function(){
    // Resumes the poll. It does not re-create anything: the kind and the request
    // both already exist, and asking twice would queue a second write over the
    // same template.
    show(slowEl,false);
    show(keepEl,false);
    show(document.getElementById('sf-wait-eta'),true);
    startedAt=Date.now();
    var slug=(openEl.getAttribute('href')||'').replace(/^\\/spec\\/template-/,'').replace(/\\?.*$/,'');
    ticker=setInterval(function(){ elapsedEl.textContent=mmss(Date.now()-startedAt); },1000);
    poller=setInterval(function(){ poll(slug); },POLL_MS);
  };

  document.getElementById('sf-wait-cancel').onclick=function(){
    // Stops this page waiting. It cannot stop the agent, because nothing can,
    // and the template is on the Templates tab either way.
    stop();
    show(wait,false);
  };

  // ---- removing a kind ----------------------------------------------------
  //
  // The only irreversible action on this page. It confirms, it names both things
  // that go, and the server counts specs before agreeing, so the refusal a user
  // is most likely to hit lands in the dialog they just opened.
  var del=document.getElementById('sf-del');
  var delWhat=document.getElementById('sf-del-what');
  var delErr=document.getElementById('sf-del-err');
  var delGo=document.getElementById('sf-del-go');
  var pending=null;

  document.querySelectorAll('.tdel').forEach(function(btn){
    btn.onclick=function(){
      pending=btn.getAttribute('data-slug');
      delWhat.textContent='Removing "'+pending+'" takes away:';
      show(delErr,false);
      show(document.getElementById('sf-del-stakes'),true);
      show(delGo,true);
      show(del,true);
      try{ delGo.focus(); }catch(e){}
    };
  });

  document.getElementById('sf-del-cancel').onclick=function(){
    pending=null;
    show(del,false);
  };

  delGo.onclick=function(){
    if(!pending) return;
    fetch('/api/types/'+encodeURIComponent(pending),{method:'DELETE'})
      .then(function(r){
        return r.json().then(function(body){ return {ok:r.ok,body:body}; });
      })
      .then(function(res){
        if(res.ok){
          // Reloaded rather than patched out of the DOM: the strip is rendered by
          // the server from the registry, and a page that removes the card
          // itself is a second renderer that can disagree with the first.
          return void location.reload();
        }
        // A refusal is the answer to the question just asked, so it lands here
        // rather than somewhere else. Remove is withdrawn with it, and so is
        // what-you-would-lose: nothing is going to be lost, and "this cannot be
        // undone" above a refusal is the dialog contradicting itself.
        delErr.textContent=res.body&&res.body.error?res.body.error:'Could not remove that kind.';
        show(document.getElementById('sf-del-stakes'),false);
        show(delErr,true);
        show(delGo,false);
      })
      .catch(function(){
        delErr.textContent='Could not reach SpecForge. Is the daemon still running?';
        show(delErr,true);
      });
  };
})();
</script>
</body>
</html>`;
}
