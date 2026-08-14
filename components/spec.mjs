// Spec-structural components: the three that carry machine-read state.
//
// These are listed so the inventory is the whole vocabulary rather than only the
// new part of it. Two of them already existed and are read by tooling outside
// the library: the tracker and the enforcement hooks parse the stage and task
// attributes, and the pre-implementation gate refuses to start while any
// `data-sf-q="open"` remains. Their markup contract is not the library's to
// change.

export const spec = [
  {
    // Named for the class an author writes. The stage and task state rides on
    // data attributes rather than classes, because the tracker and the
    // enforcement hooks parse the attributes.
    name: 'sf-stages', family: 'spec', kind: 'class', block: true,
    rule: 'The implementation plan. One stage is one PR; each task carries a verify note.',
    requires: ['data-sf-stage', 'data-sf-task', 'data-sf-status'],
    variants: ['sf-tasks', 'sh', 'verify'],
    css: `ol.sf-stages{list-style:none;padding-left:0}
li[data-sf-stage]{background:var(--panel);border:1px solid var(--line);border-radius:12px;
  padding:14px 16px;margin:12px 0;box-shadow:var(--shadow)}
li[data-sf-stage]>.sh{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
li[data-sf-stage]>.sh h3{margin:0;font-size:15.5px}
ul.sf-tasks{list-style:none;padding-left:4px;margin:10px 0 2px}
li[data-sf-task]{margin:6px 0;font-size:14px}
li[data-sf-task] .verify{display:block;color:var(--muted);font-size:12.5px;margin:2px 0 0 20px}`,
    example: '<ol class="sf-stages"><li data-sf-stage="1"><div class="sh"><h3>Stage 1: Name</h3></div><ul class="sf-tasks"><li data-sf-task="1.1" data-sf-status="todo">Task<span class="verify">verify: how</span></li></ul></li></ol>',
  },
  {
    // No element is named `question`; the component is an attribute on a list
    // item, so it carries the selector an author actually writes.
    name: 'question', family: 'spec', kind: 'element', selector: 'li[data-sf-q]', block: true,
    rule: 'An unresolved question. While one is open the pre-implementation gate refuses to start.',
    requires: ['data-sf-q of open, resolved, or dropped'],
    example: '<ul><li data-sf-q="open"><strong>Q1 — <span class="tag warn">open</span></strong> The question.</li></ul>',
  },
  {
    name: 'evidence', family: 'spec', kind: 'class', block: true,
    rule: 'A claim that rests on a measurement or an external source.',
    requires: ['the value', 'the method', 'the retrieval date', 'a confidence'],
    variants: ['val', 'meta'],
    css: `.evidence{background:var(--panel2);border:1px solid var(--line);border-left:3px solid var(--muted);
  border-radius:0 10px 10px 0;padding:11px 14px;margin:14px 0}
.evidence .val{font-size:19px;font-weight:700;line-height:1.3}
.evidence .meta{color:var(--muted);font-size:12px;margin-top:3px}`,
    example: '<div class="evidence"><p class="val">338 classes</p><p class="meta">Method: parse every spec.html · n=111 · 2026-08-14</p></div>',
  },
];
