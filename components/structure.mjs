// Structure: the blocks a spec is built out of.
//
// `.grid` formalizes the `grid2` that 17 specs invented independently, and
// `figure` formalizes the `fig` that 10 did. A class several specs reach for and
// none can find is the definition of a gap in the library.

export const structure = [
  {
    // The native layer, entire. `<details>` is interactive with no script, so
    // this ships exactly like a static component — a stamped stylesheet and
    // nothing else — and a spec carrying one is fully usable opened from disk.
    //
    // Built on the element rather than on a custom accordion because the element
    // brings keyboard operation, the correct screen-reader announcement,
    // find-in-page expansion and a markdown form, and a hand-rolled one buys
    // styling freedom by giving up all four.
    // `class`, not `element`, though the author writes a tag too. The kind is
    // what decides two lists: the classes the lint accepts, and the blocks a
    // reviewer can comment on. Registered as an element it would be neither, so
    // a disclosure would fail the lint that governs it and refuse comments (I4).
    // `selector` carries what an author actually types.
    name: 'disclosure', family: 'structure', kind: 'class', block: true,
    selector: '<details class="disclosure">', layer: 'interactive', needs: 'none',
    rule: 'Detail a reader needs on a second pass and not on the first: the full error table behind a cited count, the working for a rejected option, a long transcript. Never for content the argument depends on, and never as a way to make a long section look short.',
    requires: ['a summary that says what is inside, so the block can be skipped without opening it'],
    // No rule here hides content, because there is no script to bring it back:
    // the collapsing is the element's own, which every engine can undo and
    // find-in-page already does.
    css: `details.disclosure{border:1px solid var(--line);border-radius:10px;
  background:var(--panel);margin:16px 0}
details.disclosure > summary{cursor:pointer;padding:11px 16px;font-weight:650;
  color:var(--accent);list-style:none;display:flex;align-items:center;gap:9px}
details.disclosure > summary::-webkit-details-marker{display:none}
details.disclosure > summary::before{content:"";flex:none;width:0;height:0;
  border-left:5px solid currentColor;border-top:4px solid transparent;
  border-bottom:4px solid transparent;transition:transform .15s ease}
details.disclosure[open] > summary::before{transform:rotate(90deg)}
details.disclosure > summary:hover{background:color-mix(in srgb,var(--accent) 7%,transparent)}
details.disclosure > summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
details.disclosure[open] > summary{border-bottom:1px solid var(--line)}
details.disclosure > :not(summary){padding:0 16px}
details.disclosure > :not(summary):first-of-type{padding-top:12px}
details.disclosure > :last-child{padding-bottom:14px}
@media print{
  details.disclosure{break-inside:avoid}
  details.disclosure > summary::before{display:none}
  details.disclosure::details-content{content-visibility:visible}
}`,
    example: `<details class="disclosure">
  <summary>How the 61% was measured</summary>
  <p>Every spec in the store parsed for headings, counted against the levels the contents rail can reach. n=133, 2026-08-18.</p>
</details>`,
  },
  {
    // The disclosure's rule forbids putting a heading behind a summary, and that
    // rule is right: a part of the argument a reader cannot see in the outline is
    // a part they miss. This is the other case, and it needs different markup.
    // A runtime log, a changelog, a section of dated entries: the reader wants
    // the list of entries, then one of them. The heading stays a real heading
    // with its id, so the outline, the contents rail and the markdown export are
    // all unchanged; only what sits under it folds.
    //
    // The grouping is done by the script rather than by the author, because the
    // alternative is a wrapper element per entry, and a wrapper that must be
    // added to every entry is a wrapper an author eventually forgets.
    name: 'fold', family: 'structure', kind: 'class', block: false,
    selector: 'h3.fold', layer: 'interactive', needs: 'script', detect: 'h3.fold',
    rule: 'A section of entries a reader picks one of rather than reads through: a runtime log, a changelog, dated findings. Never on an argument, where folding hides a step the next section depends on, and never to make a long section look short.',
    requires: ['an id on the heading, so the contents rail can still reach it'],
    variants: ['sf-fold', 'sf-fold-body'],
    // Folded closed by default, which is the whole point, so the hiding rule is
    // behind [data-sf-live] and a document with no script shows every entry.
    // `open` on the heading starts one expanded.
    css: `h3.fold .sf-fold{appearance:none;background:none;border:0;cursor:pointer;
  color:var(--muted);padding:0;margin:0 8px 0 0;border-radius:3px;
  width:16px;height:16px;display:inline-flex;align-items:center;justify-content:center;
  vertical-align:1px;transition:color .12s ease,background-color .12s ease}
h3.fold .sf-fold::before{content:"";width:6px;height:6px;
  border-right:1.8px solid currentColor;border-bottom:1.8px solid currentColor;
  transform:translateX(-1px) rotate(-45deg);transition:transform .15s ease}
h3.fold .sf-fold[aria-expanded="true"]::before{transform:translateY(-1px) rotate(45deg)}
h3.fold:hover .sf-fold{color:var(--accent)}
h3.fold .sf-fold:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
[data-sf-live] .sf-fold-body[hidden]{display:none}
@media print{
  [data-sf-live] .sf-fold-body[hidden]{display:block}
  [data-sf-live] h3.fold .sf-fold{display:none}
}`,
    example: '<h3 class="fold" id="s11-9">11.9 · 2026-08-31 · The crawl, and the heuristic that was withdrawn</h3>',
  },
  {
    // Authored as a run of labelled panels, all visible. The script adds the
    // strip and hides all but one; with no script the reader gets every panel in
    // order, which is longer and complete. That is the enhancement contract, and
    // it is the same fallback GOV.UK ships for the same component.
    //
    // No document product surveyed ships tabs natively: Notion has none,
    // Confluence sends you to the Marketplace, and Google Docs' tabs are
    // document-level navigation. The demand is real (the Marketplace app exists)
    // and the risk is too, which is why the rule below is narrow.
    name: 'tabs', family: 'structure', kind: 'class', block: true,
    layer: 'interactive', needs: 'script', detect: '.tabs',
    rule: 'Two to five alternative forms of one thing, where a reader needs exactly one: the same command per platform, the same config per environment, before against after. Never for sequential content, and never where a reader has to compare two panels side by side.',
    requires: ['each panel is a .tab with a data-label', 'the panels are alternatives, not steps'],
    variants: ['tab', 'sf-tablist', 'sf-tab', 'sf-selected'],
    // Every hiding rule is under [data-sf-live], which only the served script
    // sets. Written as a bare `.tabs > .tab{display:none}` this would sit in the
    // stamped block of every spec and a reader opening the file from disk would
    // lose every panel but the first, permanently and silently.
    css: `.tabs{margin:16px 0}
.tabs > .tab{border:1px solid var(--line);border-radius:10px;padding:12px 16px;margin:10px 0}
.tabs > .tab::before{content:attr(data-label);display:block;font-size:12.5px;font-weight:700;
  letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:6px}
[data-sf-live] .tabs{border:1px solid var(--line);border-radius:10px;overflow:hidden}
[data-sf-live] .tabs > .tab{border:none;border-radius:0;margin:0;padding:14px 16px}
[data-sf-live] .tabs > .tab::before{display:none}
[data-sf-live] .tabs > .tab[hidden]{display:none}
[data-sf-live] .sf-tablist{display:flex;flex-wrap:wrap;gap:2px;padding:4px 4px 0;
  background:var(--panel2);border-bottom:1px solid var(--line)}
[data-sf-live] .sf-tab{appearance:none;background:none;border:none;cursor:pointer;
  font:600 13px inherit;color:var(--muted);padding:8px 14px;border-radius:8px 8px 0 0;
  border-bottom:2px solid transparent}
[data-sf-live] .sf-tab:hover{color:var(--ink);background:color-mix(in srgb,var(--accent) 7%,transparent)}
[data-sf-live] .sf-tab:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}
[data-sf-live] .sf-tab.sf-selected{color:var(--accent);background:var(--panel);
  border-bottom-color:var(--accent)}
@media print{
  [data-sf-live] .sf-tablist{display:none}
  [data-sf-live] .tabs > .tab[hidden]{display:block}
  [data-sf-live] .tabs > .tab::before{display:block}
}`,
    example: `<div class="tabs">
  <div class="tab" data-label="macOS"><pre><code>brew install specforge</code></pre></div>
  <div class="tab" data-label="Linux"><pre><code>npm i -g specforge</code></pre></div>
  <div class="tab" data-label="Windows"><pre><code>winget install specforge</code></pre></div>
</div>`,
  },
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
    //
    // The `max-width:100%` cap is why the review layer offers a full-screen
    // preview on a figure holding artwork: at the reading width a detailed
    // picture is capped down to illegibility, and the preview is where it is
    // read (spec 2cc9bae1bc). The cap deliberately does not follow it there.
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
