// Code components.
//
// A filename caption is a real path when the code corresponds to one. A caption
// that names no file is decoration and the rule says not to write it.

export const code = [
  {
    name: 'codeblock', family: 'code', kind: 'class', block: true,
    rule: 'Code or configuration a reader will copy, or compare against a file on disk.',
    requires: ['a filename caption when the code corresponds to a path'],
    variants: ['filename'],
    // `position:relative` lives here, not with `copy`, because `.codeblock` is
    // this component's selector and two definitions of one selector across two
    // components is the drift the single registry exists to prevent.
    css: `.codeblock{margin:14px 0;position:relative}
.codeblock .filename{display:block;font-family:var(--mono);font-size:11.5px;color:var(--muted);
  background:var(--panel2);border:1px solid var(--line);border-bottom:none;
  border-radius:8px 8px 0 0;padding:5px 12px}
.codeblock .filename + pre{border-radius:0 0 8px 8px;margin:0}`,
    example: '<div class="codeblock"><span class="filename">lib/config.mjs</span><pre><code>export const PALETTE_TOKENS = [];</code></pre></div>',
  },
  {
    name: 'diff', family: 'code', kind: 'class', block: true,
    rule: 'A change to existing code, where the before matters as much as the after.',
    requires: ['added and removed lines marked'],
    variants: ['add', 'del', 'ctx'],
    css: `.diff{font-family:var(--mono);font-size:13px;line-height:1.6;background:var(--code);
  border:1px solid var(--line);border-radius:8px;padding:10px 0;margin:14px 0;overflow:auto}
.diff .add,.diff .del,.diff .ctx{display:block;padding:0 14px;white-space:pre}
.diff .add{background:color-mix(in srgb,var(--green) 15%,transparent)}
.diff .del{background:color-mix(in srgb,var(--red) 15%,transparent)}
.diff .ctx{color:var(--muted)}`,
    example: '<div class="diff"><span class="del">- old line</span><span class="add">+ new line</span></div>',
  },
  {
    // The smallest possible consumer of the enhancement channel, and the one
    // that proves it: nothing is authored, so the whole component is the script
    // finding a block and adding a control to it.
    //
    // Automatic rather than opt-in because code in a spec exists to be run, and
    // a per-block flag would be a decision an author has to make 40 times with
    // the same answer.
    name: 'copy', family: 'code', kind: 'class', block: false,
    selector: 'automatic on every .codeblock',
    layer: 'interactive', needs: 'script', detect: '.codeblock',
    rule: 'Nothing to author. The review layer attaches a copy control to every code block, because code in a spec exists to be run. It is absent with no script, which costs a reader a selection rather than the code.',
    requires: [],
    variants: ['copied'],
    // No hiding: with no script the control is never added, and the block is
    // exactly what it was. That is the enhancement contract at its simplest.
    css: `.copy{position:absolute;top:6px;right:8px;z-index:1;
  font:600 11px var(--mono);letter-spacing:.02em;
  color:var(--muted);background:var(--panel);border:1px solid var(--line);
  border-radius:6px;padding:3px 9px;cursor:pointer;opacity:0;transition:opacity .12s ease}
/* :focus, not :focus-visible, for the reveal. A control that is invisible while
   focused is broken however the focus arrived, and :focus-visible deliberately
   does not match programmatic focus. The ring below stays on :focus-visible,
   which is what that selector is for. */
.codeblock:hover .copy,.copy:focus{opacity:1}
.copy:hover{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 45%,var(--line))}
.copy:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
.copy.copied{color:var(--green);border-color:color-mix(in srgb,var(--green) 45%,var(--line));opacity:1}
@media (hover:none){.copy{opacity:1}}
@media print{[data-sf-live] .copy{display:none}}`,
    example: '<div class="codeblock"><span class="filename">lib/config.mjs</span><pre><code>export const PALETTE_TOKENS = [];</code></pre></div>',
  },
];
