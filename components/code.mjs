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
    css: `.codeblock{margin:14px 0}
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
];
