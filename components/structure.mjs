// Structure: the blocks a spec is built out of.
//
// `.grid` formalizes the `grid2` that 17 specs invented independently, and
// `figure` formalizes the `fig` that 10 did. A class several specs reach for and
// none can find is the definition of a gap in the library.

export const structure = [
  {
    name: 'panel', family: 'structure', kind: 'class', block: true,
    rule: 'A block that stands apart from the flow and is read as a unit. The TL;DR is a panel.',
    requires: [],
    css: `.panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;
  padding:18px 20px;margin:16px 0;box-shadow:var(--shadow)}`,
    example: '<div class="panel"><p>Read as a unit.</p></div>',
  },
  {
    name: 'card', family: 'structure', kind: 'class', block: true,
    rule: 'One of three or more peer items of the same kind, each a few lines. Use inside a grid.',
    requires: [],
    css: `.card{background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:14px 16px;margin:12px 0}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin:14px 0}
.grid .card{margin:0}`,
    variants: ['grid'],
    example: '<div class="grid"><div class="card">One</div><div class="card">Two</div></div>',
  },
  {
    name: 'steps', family: 'structure', kind: 'class', block: true,
    rule: 'An ordered procedure where the order is load-bearing. One action per step.',
    requires: ['each item is an action'],
    css: `.steps{list-style:none;counter-reset:sfstep;padding-left:0;margin:14px 0}
.steps > li{counter-increment:sfstep;position:relative;padding-left:34px;margin:10px 0}
.steps > li::before{content:counter(sfstep);position:absolute;left:0;top:1px;
  width:22px;height:22px;border-radius:50%;
  background:color-mix(in srgb,var(--accent) 14%,var(--panel2));
  border:1px solid color-mix(in srgb,var(--accent) 40%,var(--line));
  color:var(--accent);font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}`,
    example: '<ol class="steps"><li>Write the failing test.</li><li>Make it pass.</li></ol>',
  },
  {
    name: 'checklist', family: 'structure', kind: 'class', block: true,
    rule: 'Conditions to verify, in any order. If the order matters it is steps.',
    requires: ['independent, checkable items'],
    variants: ['ok'],
    css: `.checklist{list-style:none;padding-left:0;margin:14px 0}
.checklist > li{position:relative;padding-left:26px;margin:7px 0}
.checklist > li::before{content:"\\25a1";position:absolute;left:2px;color:var(--muted);font-size:15px;line-height:1.3}
.checklist > li.ok::before{content:"\\2611";color:var(--green)}`,
    example: '<ul class="checklist"><li class="ok">Tints derive from a token</li><li>Registry agrees</li></ul>',
  },
  {
    name: 'figure', family: 'structure', kind: 'element', block: true,
    rule: 'Any diagram or image. The caption states what the reader should conclude, not what the picture contains.',
    requires: ['a figcaption'],
    // The svg rule came from the general shell, which had grown its own copy of
    // this component plus one rule the library was missing. An inline diagram
    // that overflows its figure is the common failure, and it belongs here rather
    // than in one of five shells.
    css: `figure{margin:18px 0}
figure svg{max-width:100%;height:auto;display:block}
figcaption{color:var(--muted);font-size:12.5px;margin-top:6px}`,
    example: `<figure><svg viewBox="0 0 220 48" role="img" aria-label="A spec, stamped and served">
  <rect class="svg-box" x="1" y="8" width="96" height="32" rx="8"/><text class="svg-lbl" x="49" y="28" text-anchor="middle">spec</text>
  <path class="svg-arrow" d="M100 24 H124"/>
  <rect class="svg-box-a" x="124" y="8" width="94" height="32" rx="8"/><text class="svg-lbl" x="171" y="28" text-anchor="middle">stamped</text>
</svg><figcaption>The lint runs on the stamped file, so what is checked is what is served.</figcaption></figure>`,
  },
  {
    // No class of its own: the marker is the declared language, which the review
    // layer, the highlighter and the markdown exporter already read. An
    // element-kind entry keeps it out of componentClasses() and out of the
    // stamped stylesheet, and carries the selector an author actually writes.
    // The paint lives in review.css, because a diagram only exists where the
    // review layer does.
    name: 'mermaid', family: 'structure', kind: 'element', selector: 'pre[data-lang="mermaid"]', block: true,
    rule: 'A graph: nodes and the relationships between them, where the layout follows from the relationships rather than from where you put things. Flowchart, sequence, state, ER, class.',
    requires: ['mermaid source, and no hand-placed coordinates'],
    example: `<pre data-lang="mermaid"><code>flowchart LR
  A[collector] --&gt; B{queue full?}
  B -- yes --&gt; C[retry queue]
  B -- no --&gt; D[(store)]</code></pre>`,
  },
  {
    name: 'flow', family: 'structure', kind: 'class', block: true,
    rule: 'A sequence of stages over time or through components, where the exact placement carries meaning. If the layout follows from the relationships, use mermaid instead. Inline SVG, nodes and edges from palette tokens.',
    requires: ['an aria-label saying what the diagram shows'],
    variants: ['svg-box', 'svg-box-a', 'svg-lbl', 'svg-lbl-m', 'svg-arrow'],
    css: `.flow{margin:18px 0}
.flow svg{max-width:100%;height:auto}
.svg-box{fill:var(--panel);stroke:var(--line);stroke-width:1}
.svg-box-a{fill:var(--panel);stroke:var(--accent);stroke-width:1.5}
.svg-lbl{fill:var(--ink);font-size:12px;font-weight:600}
.svg-lbl-m{fill:var(--muted);font-size:11px}
.svg-arrow{stroke:var(--muted);stroke-width:1.4;fill:none}`,
    example: `<div class="flow"><svg viewBox="0 0 330 48" role="img" aria-label="authored, then stamped, then linted">
  <rect class="svg-box" x="1" y="8" width="94" height="32" rx="8"/><text class="svg-lbl" x="48" y="28" text-anchor="middle">authored</text>
  <path class="svg-arrow" d="M98 24 H120"/>
  <rect class="svg-box-a" x="120" y="8" width="94" height="32" rx="8"/><text class="svg-lbl" x="167" y="28" text-anchor="middle">stamped</text>
  <path class="svg-arrow" d="M217 24 H239"/>
  <rect class="svg-box" x="239" y="8" width="90" height="32" rx="8"/><text class="svg-lbl" x="284" y="28" text-anchor="middle">linted</text>
</svg></div>`,
  },
];
