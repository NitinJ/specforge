---
title: Mermaid diagrams in SpecForge
type: design-impl
status: approved
specforge_id: cb25fc2943
exported_at: 2026-08-15
---

# Mermaid diagrams in SpecForge

## TL;DR

<!-- sf:box class="panel" -->

A mermaid diagram is a code block whose declared language is `mermaid`. The review layer renders it in the reader's browser from a vendored bundle (3.40 MB raw, 959 KB gzipped, mermaid 11.16.1, MIT) fetched only by a spec that carries a diagram. `review.css` repaints the result from the 13 palette tokens; a theme flip is measured to change the painted colours with no re-render.

A diagram is one commentable block, and that block is the `<pre>` the source already sits in, so `BLOCK_SEL` does not change. It exports to markdown as a plain ```` ```mermaid ```` fence with no sidecar asset and renders natively on GitHub, which inline SVG does not.

Per-node comments are measured feasible and deferred out of v1; the evidence is in the [appendix](#appendix) so the container design does not foreclose them.

## 1 · Overview

A SpecForge spec draws a diagram two ways today, both of which require the author to place every element by hand.

- **223** inline \<svg> elements, in 49 of 120 specs
- **29** ASCII sketches in undeclared \<pre> blocks, in 23 specs
- **136** \<pre> blocks in the store, 45 with a declared language

scripts/count-specforge-ascii-diagrams.mjs, 2026-08-15

The ASCII count is a glyph heuristic: four or more box-drawing or arrow glyphs over three or more lines. The sample holds at least one false positive, a config block using `---` separators, so 29 is an upper bound.

Both forms are hand-positioned. Moving one node in a `.flow` SVG means editing the x coordinate of every node after it and both endpoints of every path that touches it. An ASCII sketch cannot be re-laid out at all: its layout is its characters.

Mermaid states the relationships and computes the layout. That makes a diagram editable by an agent in one line, which neither current form is.

## 2 · Requirements

#### Problem

An agent authoring a spec cannot add or change a graph-shaped diagram without computing geometry. The cost falls on every edit, not just the first draft, and it is why 23 specs reached for ASCII instead: an ASCII sketch is cheaper to write than an SVG and cheaper to change than either, at the cost of not surviving a font change and not exporting as a diagram.

#### Product requirements

- An agent writes a diagram as source text in one block and computes no coordinate.
- The reader sees it rendered under every review-layer theme and in both light and dark.
- A reviewer comments on a diagram the same way as on any other block, with no new gesture.
- Markdown export keeps the diagram as editable source, not as a binary or linked asset.

#### Engineering requirements

- MUST fetch from no external host at render time. The daemon serves `/public/<file>` with no subpaths, so the renderer is exactly one file.
- MUST cost a spec with no diagram nothing, matching the bargain `initHighlight()` and the reading fonts already make.
- MUST degrade to the source text, with no error, in a spec opened from `file://` where no review layer exists.
- MUST NOT orphan a comment thread when a diagram renders, fails to render, or renders on one load and not the next.
- MUST keep the store inert: no SVG is generated on the server or written to `spec.html`.

## 3 · Goals & non-goals

<!-- sf:section id="goals" -->

#### Goals

- Render mermaid in the review layer, on the daemon over loopback and on a publication behind the tunnel.
- Paint every rendered diagram from the palette tokens, so it follows all eight review-layer themes and the light and dark switch without re-rendering.
- Let a reviewer comment on a diagram as a whole, using the existing block machinery.
- Round-trip a diagram through `export-md` and `import-md` as a ```` ```mermaid ```` fence, with no sidecar asset and no new marker in the SF-MD dialect.
- Publish the rule for choosing mermaid over SVG over HTML into `references/spec-components.md`, generated from `components/` like every other component rule.

#### Non-goals

- **Per-node comments.** Measured feasible ([appendix](#appendix)) and deferred. v1 anchors a thread to the diagram, not to a box inside it.
- **Server-side rendering.** No SVG is produced by the daemon, written to `spec.html`, or added to the PDF path.
- **Editing a diagram in the browser.** The source is authored in the file.
- **Migrating any existing diagram.** Neither the 223 inline SVGs nor the 29 ASCII sketches are converted, on demand or otherwise (D12). They are correct and they keep working. Mermaid is what a new diagram reaches for.
- **Rendering from `file://`.** A spec opened straight from disk shows the source as a code block, the same trade the themes, the comment rail and the highlighter already make. A mermaid browser extension renders the source in place there, which is why this costs less than the equivalent gap would for the highlighter.

## 4 · Design

#### Summary

**A mermaid diagram is a code block whose declared language is `mermaid`.** That sentence is the design. Four mechanisms the codebase already has are reused rather than duplicated:

- `declaredLang()` already resolves a language from `data-lang`, `class="lang-x"` or `class="language-x"` on the code, the pre or its parent (`server/public/review.js:493`). Mermaid claims `mermaid`; Prism has no such grammar and already skips a language it does not carry.
- `initHighlight()` already lazily appends a vendored script only when a block declares a language (`:540`). `initMermaid()` is the same shape.
- `BLOCK_SEL` already contains `pre` (`:145`), so the diagram is commentable with no change to the selector list.
- GFM already carries a fenced block with an info string, so a diagram round-trips as source text with no new SF-MD marker.

#### Concepts

| Concept | What it is | Inputs | Outputs |
| --- | --- | --- | --- |
| **Source block** | A `<pre data-lang="mermaid">` holding diagram source. Inert text on disk. | Agent-authored text | The commentable block, and the render target |
| **Renderer** | Mermaid 11.16.1 UMD vendored at `server/public/mermaid.js`, fetched lazily by `review.js` | Source text, one id per block | Inline SVG, replacing the pre's children |
| **Palette bridge** | Rules in `review.css` that repaint mermaid's output from the 13 palette tokens | Rendered SVG, current theme | A diagram in the spec's colours |
| **Settled page** | The state in which every declared diagram has rendered or definitively failed | Render outcomes | Permission for the block reconcile to write |

#### Authoring form

One marker, not two. `data-lang` is already the house spelling for a code block's language and is already read by the highlighter, so no new class is introduced and the components lint gains nothing to check.

```html
<pre data-lang="mermaid"><code>flowchart LR
  A[collector] --> B{queue full?}
  B -- yes --> C[retry queue]
  B -- no --> D[(store)]</code></pre>
```

A caption is added by wrapping in `<figure>`, which is the existing rule for any diagram and needs nothing new.

#### Architecture

![The source stays inert on disk; the daemon injects the review layer; review.js lazily fetches the vendored renderer and replaces the pre's children with SVG; review.css repaints that SVG from the palette tokens](2026-08-15-mermaid-diagrams-spec.assets/design-1.svg)

<!-- sf:svg id="design-1" -->

*Everything blue is new or changed. Nothing crosses the server boundary: the daemon never parses a spec and never sees an SVG. This spec's own diagrams are inline SVG, because a spec about mermaid must render before mermaid exists.*

#### Current state, grounded in code

| Component | Current state (file ref) | Supports? | Change required |
| --- | --- | --- | --- |
| `declaredLang()` | Resolves `data-lang`, `lang-`, `language-` over code, pre, parent · `server/public/review.js:493` | yes | None. Mermaid reads the same answer. |
| `initHighlight()` | Appends `/public/prism.js` only when a block declares a language · `:540` | yes | None. It is the pattern `initMermaid()` copies. |
| `BLOCK_SEL` | Contains `pre`, plus block components from the injected config · `:145` | yes | None. |
| `boot()` | `initHighlight()`, `buildChrome()`, `syncBlocks(load)` · `:272` | partly | The reconcile must run after the render settles. |
| Block registry | Identity from `tag` + normalised `textContent`, retirement is durable · `lib/store-blocks.mjs`, `server/public/reconcile.js` | partly | Must not write while a declared diagram is unrendered. |
| `renderCode()` | Language read **only** from the `<code>` class · `lib/html-to-md.mjs:308` | no | Must read `data-lang`. See the defect below. |
| `md-to-html` | Fence to `<pre><code class="lang-x">` · `lib/md-to-html.mjs:283` | yes | None. `declaredLang()` matches `lang-`. |
| Components registry | `selector` is a live field, used by `li[data-sf-q]` · `components/spec.mjs:32`; a component with no `css` is skipped in the stamp · `lib/components-build.mjs:63` | yes | Add an element-kind entry with an explicit selector and no CSS. |
| `scripts/build-prism.mjs` | Concatenates grammars into one file because the daemon serves no subpaths | yes | None. `build-mermaid.mjs` is its sibling. |

<!-- sf:callout variant="risk" -->

> **A defect this spec has to fix anyway.** `renderCode()` reads the language only from the `<code>` element's class, but the house rule tells authors to write `<pre data-lang="python">`. Measured: **45 declared languages across 15 specs are dropped on every `export-md`** today. A mermaid diagram exported as a bare fence stops being a diagram, so this is on the critical path rather than adjacent to it.

#### Rendering and boot order

Mermaid render is asynchronous and it changes the page's block text. The reconcile keys block identity on `tag` \+ normalised `textContent`, so running it against a half-rendered page produces one answer at boot and a different one a moment later. Two rules settle it.

1. **Reconcile only a settled page.** `syncBlocks` is chained behind `initMermaid()`, which resolves immediately when the spec declares no diagram. Every spec in the store today takes that path, so their boot is unchanged.
2. **Never write the registry from an unsettled page.** If any declared diagram failed to render, the reconcile still runs for reading and the `PUT` is skipped. Reads fall back to content matching, which is the behaviour that predates the registry.

initHighlight(); buildChrome(); \- syncBlocks(load); \+ initMermaid().then(function (ok) { syncBlocks(load, { write: ok }); });

Rule 2 is what stops a thread from orphaning. Retirement is durable by design (`lib/store-blocks.mjs`: *"kept in FULL: truncating drops the oldest first, and a thread whose id is dropped stops reading as an orphan"*). Without the guard, one load with the renderer unreachable would retire every diagram's block id permanently.

#### Theming

Mermaid emits a `<style>` block inside the SVG carrying concrete colours. Two routes out were tested; one is closed.

| Approach | Measured result |
| --- | --- |
| `themeVariables: { primaryColor: 'var(--panel)' }` | throws `Unsupported color format: "var(--panel)"`. Mermaid parses the value as a colour, so the config route is closed. |
| Default render, then flip `data-theme` | frozen node fill stays `rgb(236,236,255)` in both themes. |
| `review.css` override on the palette tokens | works fill `rgb(23,26,33)` → `rgb(255,255,255)`, label `rgb(230,232,238)` → `rgb(34,38,41)` across a theme flip, with no re-render. |

scripts/probe-mermaid-theme.mjs, mermaid 11.16.1, Chromium 1228, 2026-08-15.

`!important` is required, not stylistic: mermaid's own rules are id-scoped (`#<id> .node rect`, specificity 1-1-1) and a class-scoped override cannot outrank them. This mirrors the Prism token mapping already in `review.css`, and it is why the bridge lives there rather than in the stamped component block: the stamped block ships to every spec, including the 120 that will never carry a diagram, and the render only exists where the review layer does.

14\.9 ms

Method: mean of 5 warm renders, Chromium 1228 · scripts/probe-mermaid-theme.mjs · 2026-08-15 · high confidence, single machine

Render cost is not what gates boot; the 959 KB fetch is. On loopback that is immaterial. Over the tunnel it is the dominant term, accepted on 2026-08-15 without a measurement (D11).

#### Block identity and comments

The commentable block is the `<pre>`, and the SVG replaces its children. The reader clicks the diagram and gets a thread on it, with no new gesture and no change to `BLOCK_SEL`.

The block's text has three possible values, and the two failure modes are not the same failure (D10).

| State | The block shows | Deterministic? | Registry write |
| --- | --- | --- | --- |
| Rendered | The diagram. Block text is the node labels. | Yes, given the source | allowed |
| Renderer unreachable: `file://`, offline, a failed fetch | The source, as a code block. Nothing has been decided about this diagram. | No, it depends on the network | skipped |
| Renderer loaded, source fails to parse | The error. Not the source. | Yes, a bad source fails the same way every time | allowed |

The middle row is the one rule 2 exists for: it is the only state whose text depends on something other than the source, so it is the only one that must not be written down. A parse failure is a settled outcome and is treated as one.

#### Markdown interop

A diagram round-trips as source text through the fence that GFM already has.

| Direction | Path | Fidelity |
| --- | --- | --- |
| Export | `<pre data-lang="mermaid">` → ```` ```mermaid ```` fence | Lossless once `renderCode()` reads `data-lang`. No sidecar file, no `sf:` marker. |
| Import | ```` ```mermaid ```` fence → `<pre><code class="lang-mermaid">` | Lossless today. `declaredLang()` already matches `lang-`. |
| On GitHub | The fence renders as a diagram natively | better than SVG, which GitHub strips and which SF-MD therefore lifts to a linked `.svg` file. |

This is the one place mermaid beats inline SVG outright, and it is a fidelity argument rather than a taste one: an SVG diagram leaves the spec as `<name>.assets/<section>-k.svg` plus an image reference and comes back by inlining, while a mermaid diagram is the same text at both ends and is readable in the markdown itself.

<!-- sf:callout variant="warning" -->

> The language precedence now has two implementations: `declaredLang()` in browser JS and `renderCode()` in Node ESM. They cannot share code across that boundary. A table-driven test asserting both give the same answer for the same markup is the guard, and it is a task in Stage 5 rather than a note.

#### Choosing between mermaid, SVG and HTML

Three ways to draw now exist, so the rule for picking one is part of the deliverable. It is generated into `references/spec-components.md` from the component entry, which is where an authoring agent already reads.

| If the diagram is | Use | Because |
| --- | --- | --- |
| A graph: nodes and the relationships between them, where the layout is derivable. Flowchart, state machine, sequence, ER, class. | `pre[data-lang="mermaid"]` | The relationships are the content and the position is not. Editable in one line, and it survives markdown as source. |
| A picture where position carries meaning: a timeline to scale, a screen layout, an annotated arrangement, anything with no matching mermaid diagram type. | `.flow` or `figure` with inline SVG | Mermaid computes layout and will not honour a specific placement. Costs a sidecar file on export. |
| Not a diagram: a comparison, a grid of peer items, a UI mock, anything that must reflow at the reader's width. | `table`, `.grid`, `.card`, `.steps` | A diagram of a table is a table drawn badly. The component library already covers these and they reflow, which no SVG does. |

<!-- sf:callout variant="constraint" -->

> A mermaid diagram past roughly 15 nodes stops being readable at a spec's column width. Past that, split it or state the same thing in a table. This is asserted from the `--maxw` content width, not measured against readers.

#### Design options considered

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| Vendor the UMD bundle, fetched lazily | Works offline, on loopback and behind the tunnel. No external host. Matches the Prism and web-font bargain exactly. | A 3.40 MB generated blob in the repo. A 959 KB first fetch for a reader on a diagram spec. | chosen The self-contained posture is the one property no other option keeps. |
| Trimmed bundle, fewer diagram types | Smaller. | Adds a bundler dependency. An agent writing an unbundled diagram type gets silence rather than a diagram. Saving is unmeasured and the layout engines dominate the bundle. | rejected Pays a real failure mode for an unquantified saving. |
| Load from a CDN | Nothing in the repo. | Breaks the no-external-fetch requirement, dies offline, and gives a published spec a third-party dependency the tunnel does not control. | rejected Contradicts an engineering requirement. |
| Render to SVG at author time and store the result | No client bundle at all. Renders from `file://`. | Puts a renderer on the server, writes generated SVG into `spec.html`, and makes the source and the picture two things that can disagree. Loses the markdown fidelity argument entirely. | rejected The daemon never parses a spec, and that rule is worth more than `file://` rendering. |

## 5 · Testing

Test-infrastructure design only. Writing the tests is implementation.

**jsdom cannot cover this design.** Mermaid needs layout and text measurement to produce a diagram, and the palette bridge is a question about computed style. Both are exactly the class of defect that got through last time: the `<script src="undefined">` bug in `review.js` passed every jsdom test and was visible in one Chromium render, and the file now carries a comment warning about it.

The test-infra change is one harness, in Stage 0:

- A Chromium run over a fixture spec served by a real daemon, extending `test-e2e/review.e2e.mjs`, asserting on the rendered DOM and on `getComputedStyle` before and after a theme flip.
- An `ok/skip` guard so CI without a browser skips rather than fails, which is what the existing e2e file already does.

Everything else is covered by the existing `node --test` suite: the language precedence table, the markdown round-trip, the registry write guard (which is pure logic once the render outcome is a parameter), and the component registry entry.

## 6 · Decisions

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| D1 | How does the renderer ship? | Vendored UMD at `server/public/mermaid.js`, fetched lazily | Owner's call, 2026-08-15. The only option that keeps the no-external-fetch requirement. Cost: 3.40 MB in the repo, 959 KB on a reader's first diagram spec. |
| D2 | Comment granularity in v1 | Whole diagram only | Owner's call, 2026-08-15. Per-node is measured feasible ([appendix](#appendix)) and deferred, so v1 adds no sequencing inside the SVG. |
| D3 | How is a diagram declared? | `<pre data-lang="mermaid">`, one marker | Reuses the highlighter's language contract and the markdown exporter with no special case. Adds no class, so the components lint is unchanged. |
| D4 | Where does the palette bridge live? | `review.css`, not the stamped component block | The render exists only where the review layer does, and the stamped block ships to 120 specs that carry no diagram. |
| D5 | What element carries the comment? | The `<pre>`, with the SVG replacing its children | `BLOCK_SEL` already contains `pre`. The failure state is the source shown as a code block, which is the fallback the highlighter already promises. |
| D6 | What stops a thread orphaning? | Chain `syncBlocks` behind `initMermaid()`; skip the registry write when any declared diagram is unrendered | Retirement is durable by design. Without the guard one unrendered load would retire every diagram's block id permanently. |
| D7 | How does the registry carry the rule? | Element-kind entry, `selector: 'pre[data-lang="mermaid"]'`, no `css` | Mirrors `li[data-sf-q]`. Leaves `componentClasses()` and `blockComponents()` untouched, and `components-build.mjs:63` already skips an entry with no CSS. |
| D8 | Fix `renderCode()`'s language read here? | Yes, in this workstream | Mermaid's markdown fidelity depends on it, and it restores 45 dropped labels across 15 specs as a side effect. |
| D9 | Renderer security posture | `securityLevel: 'strict'` plus a `maxTextSize` cap | Strict disables `click` directives and sanitises label HTML; verified rendering correctly in the probe. A published spec is read by strangers, and an imported spec's source is untrusted. |
| D10 | What does a *parse* failure show? | The error, and not the source | Owner's call, 2026-08-15 (Q1). A reader cannot act on mermaid source. This is distinct from the renderer being unreachable, where the source is all there is to show. |
| D11 | Is 959 KB acceptable on a publication? | Yes, accepted | Owner's call, 2026-08-15 (Q2). Taken without a prior tunnel measurement, so no figure gates Stage 1. |
| D12 | Migrate any existing diagram? | No, none, in any form | Owner's call, 2026-08-15 (Q3). Covers the 223 inline SVGs and the 29 ASCII sketches alike. Mermaid is what a new diagram uses. |

## 7 · Open questions

All three were settled in review on 2026-08-15. The gate is clear.

- [x] **Q1 resolved** When a diagram fails to *parse*, does the reader see the source, or an error? **The error only.** Mermaid source is not something a reader can act on, and the author, who can, is reading the file rather than the page. This is stricter than the recommendation, which kept the source alongside the error. Carried into D10 and task 2.5.
- [x] **Q2 resolved** Is a 959 KB lazy fetch acceptable for a published spec read over the tunnel? **Yes.** Accepted without a prior latency measurement. Carried into D11.
- [ ] **Q3 dropped** Should the 29 ASCII sketches be converted on demand? **No. No migrations.** Carried into D12 and the non-goals in §3. <!-- sf:q state="dropped" -->

## 8 · Design alignment

| Guidance (quoted) | Verdict | How & why | Reference |
| --- | --- | --- | --- |
| "A spec is a **single self-contained `.html` file** ... It must open correctly straight from disk." | partly misaligned | A rendered diagram needs a fetched script, so it does not render from disk. The file still opens correctly and shows the source. The deviation is the one the review layer, the themes and the highlighter already take. Accepted in review on 2026-08-15, on the ground that a mermaid browser extension renders the source in place, so a reader on `file://` is not blocked the way a reader of unhighlighted code is. | `templates/house-rules.md` · Format |
| "Highlighting is a review-layer feature ... A spec opened straight from `file://` shows plain code, the same trade the theme variants and the comment rail already make." | aligned | Mermaid takes the identical trade, and the fallback is not merely similar to the highlighter's, it is the same code block. | `templates/house-rules.md` · Code blocks |
| "The server does **NOT** understand it ... every decision is made client-side, where the DOM is. That keeps the long-standing rule that the server never parses a spec." | aligned | Rendering is client-side. The daemon serves bytes and gains no knowledge of mermaid. | `lib/store-blocks.mjs` header |
| "A component added here appears in all five \[consumers\]. That is the property the whole design rests on." | aligned | The selection rule is a registry entry, so `references/spec-components.md` is generated rather than written and cannot drift from the CSS. | `components/index.mjs` header |
| "**Do not declare** \[a language\] on a block that is not code ... Leave them undeclared; that is the supported way to say 'this is not a language'." | new tribal knowledge | Mermaid inverts this for exactly one value. `mermaid` must be declared, and it is the only declared language that is never highlighted. Left unstated the two rules read as contradictory, so house-rules gains a sentence naming the exception. This is a task in Stage 6, not a note. | `templates/house-rules.md` · Code blocks |
| "Use the **canonical palette tokens** for every color ... The review layer's theme variants re-tint a spec by overriding exactly these." | aligned | Every diagram colour derives from the 13 tokens. Mermaid's own palette is overridden rather than added to, so no fourteenth token appears. | `templates/house-rules.md` · Palette tokens |

## 9 · Invariants

| Was true before | Now | Who relied on it |
| --- | --- | --- |
| A `<pre>`'s rendered text equals its authored text. | A mermaid `<pre>`'s text becomes the node labels once rendered, and stays the source when it is not. | The block reconcile, every comment anchor's `text`, and the quoted excerpt shown in the rail and returned by `specforge comments`. |
| `review.js` never changed a block's text, so the page was settled by the time `boot()` ran. | It does, for mermaid blocks, asynchronously. | `syncBlocks`, which is why D6 exists. |
| Every review-layer asset is small: `prism.js` is 34 KB and a web font is fetched only when chosen. | One asset is 959 KB gzipped. | Any assumption that lazy-loading is free. Accepted on 2026-08-15 (D11), without a tunnel measurement. |
| A declared language survives `export-md`. | Measured false today: 45 labels across 15 specs are already dropped. D8 makes the invariant true rather than restoring it. | Markdown export fidelity, and anything round-tripping a spec through `.md`. |
| A spec's diagrams are all present in its HTML, so any consumer that reads the file sees them. | A mermaid diagram exists only after a browser runs. | `tools/spec-pdf.mjs` and any non-browser consumer. **Checked in Stage 2, not assumed: it does not render them.** The tool reads `spec.html` over `file://` deliberately, so the review layer is absent and a diagram prints as its source in a code block. Verified against a rendered preview. Not fixed; the fix is to inject the vendored bundle in that tool. |

## 10 · Implementation plan

<!-- sf:section id="impl-plan" -->

One stage = one PR, tests first. The §7 gate cleared on 2026-08-15.

### Stage 0 · Render harness

- [x] 0.1 Extend `test-e2e/review.e2e.mjs` with a helper that serves a fixture spec from a temp store and returns a Chromium page, using the pinned browser rather than the shared instance.
      verify: the helper opens a fixture and reads back a known block's `textContent`
- [x] 0.2 Add a `getComputedStyle` assertion helper that reads a property before and after flipping `data-theme`.
      verify: it proves a palette-driven element changes and a hard-coded one does not
- [x] 0.3 Skip cleanly when no browser is installed, matching the existing e2e guard.
      verify: the run reports skip, not fail, with the browser path removed

**Testing:** the harness against the existing review layer, before any mermaid code exists.

**Verifiable output:** a green e2e run that asserts on computed style, with no mermaid in the tree.

### Stage 1 · Vendor the renderer

- [x] 1.1 Add `mermaid` as a devDependency and write `scripts/build-mermaid.mjs`, mirroring `build-prism.mjs`: one file to `server/public/mermaid.js`, upstream MIT licence reproduced, generated-do-not-edit header.
      verify: the script is idempotent and reports version and size
- [x] 1.2 Pin the size with a test that fails if the artifact grows past a stated bound, so a dependency bump cannot silently double the fetch.
      verify: the test fails against a deliberately padded file

**Testing:** unit test on the built artifact's presence, header and size; a request test for `GET /public/mermaid.js`.

**Verifiable output:** `GET /public/mermaid.js` returns 200 and the recorded byte size.

### Stage 2 · Render, and the boot order

- [x] 2.1 Add `initMermaid()` to `review.js`, shaped like `initHighlight()`: find blocks whose declared language is `mermaid`, resolve immediately when there are none, otherwise append the script once and render each block with `securityLevel: 'strict'`.
      verify: a spec with no diagram issues no request for mermaid.js
- [x] 2.2 Declare the script path with the other boot-time constants at the top of the file, and pin it with a test that reads the file. This is the `<script src="undefined">` trap the file already warns about three times.
      verify: the test fails when the constant is moved below `boot()`
- [x] 2.3 Chain `syncBlocks` behind the render and pass the settled flag through.
      verify: e2e reads a diagram block's text after boot and gets labels, never source
- [x] 2.4 Check whether `tools/spec-pdf.mjs` renders diagrams, and record the answer in §9 either way.
      verify: a PDF of a fixture spec is inspected, not assumed
- [x] 2.5 On a parse failure, replace the block with mermaid's error rather than the source (D10), and keep the source visible only when the renderer never loaded.
      verify: a fixture with a deliberate syntax error shows the error and no source; the same fixture with the script route 404ing shows the source and no error

**Testing:** Chromium e2e for the render; jsdom for the no-diagram fast path and the constant-placement test.

**Verifiable output:** a fixture spec's flowchart present as inline SVG with four `g.node` elements.

### Stage 3 · Palette bridge

- [x] 3.1 Write the override rules in `review.css`: node fill and stroke, label colour, edge stroke, arrowhead fill, cluster fill, edge-label background, and sequence-diagram actor boxes, every value from a palette token.
      verify: no literal colour appears in the mermaid block of review.css
- [x] 3.2 Neutralise the code-block chrome on a rendered `<pre>` (background, border, mono font) and inherit the reading font for labels.
      verify: a rendered diagram shows no code-block border
- [x] 3.3 Assert the flip across light and dark and screenshot three of the eight themes.
      verify: computed fill and label colour both change; screenshots reviewed by eye

**Testing:** computed-style assertions from the Stage 0 helper, plus rendered screenshots. Rendering is what catches this class of defect; jsdom cannot.

**Verifiable output:** one diagram, three themes, three screenshots, and a passing flip assertion.

### Stage 4 · Comments on a diagram

- [x] 4.1 Thread the settled flag into `syncBlocks` so the registry `PUT` is skipped when any declared diagram is unrendered, while reads still reconcile.
      verify: with the script route returning 404, blocks.json is byte-identical after a load
- [x] 4.2 Add the round trip: comment on a diagram, reload, and confirm the thread resolves to the same block.
      verify: the thread is not an orphan and quotes the diagram
- [x] 4.3 Add the hostile case: comment on a diagram, then load once with the renderer unreachable, then load normally.
      verify: the thread still resolves after all three loads

**Testing:** Chromium e2e for both loads; a unit test for the write guard, which is pure logic once the outcome is a parameter.

**Verifiable output:** a thread that survives a renderer outage.

### Stage 5 · Markdown interop

- [x] 5.1 Teach `renderCode()` the same precedence `declaredLang()` uses: `data-lang` then class, over code, pre and parent.
      verify: a `<pre data-lang="python">` fixture exports as a python fence
- [x] 5.2 Add the table-driven test asserting both implementations agree on the same markup, since they cannot share code across the browser and Node boundary.
      verify: the table covers all three spellings on all three elements and both sides pass it
- [x] 5.3 Add a mermaid fixture to `test/fixtures/md/` and a round-trip test through export and import.
      verify: source text is byte-identical at both ends, no asset written
- [x] 5.4 Re-measure the store: the 45 dropped labels now survive export.
      verify: the count of declared languages in the exported markdown equals 45

**Testing:** existing `node --test` suite; golden fixtures under `test/fixtures/md/`.

**Verifiable output:** a round-tripped mermaid fence, and 45 recovered language labels.

### Stage 6 · Agent guidance and docs

- [x] 6.1 Add the mermaid entry to `components/structure.mjs`: element kind, `selector: 'pre[data-lang="mermaid"]'`, no CSS, carrying the selection rule and an example.
      verify: `components build` reports the entry and regenerates references/spec-components.md
- [x] 6.2 Add the three-way choice rows to the `SELECTION` table in `lib/components-rules.mjs`.
      verify: the generated rules file carries them
- [x] 6.3 Add a Diagrams section to `templates/house-rules.md`, and the sentence naming `mermaid` as the one declared language that is never highlighted (§8).
      verify: the two rules no longer read as contradictory
- [x] 6.4 Documentation updates (§13) and testing journeys (§14).
      verify: README and the create-spec skill mention diagrams; the journey table is landed

**Testing:** the components build's own idempotence check, plus the lint on a fixture spec carrying a diagram.

**Verifiable output:** an agent reading only `references/spec-components.md` can pick correctly between the three forms.

## 12 · Runtime

Filled during implementation. Shipped in seven PRs: #148, #149, #151, #153, #154, #155 and the guidance PR. Unit suite 1307 pass, e2e 30 pass.

#### Design decisions (implementation time)

Choices made where the spec was silent, most of them forced by a failure.

| # | Decision | Why |
| --- | --- | --- |
| R1 | A load timeout (15s) on the renderer, and exactly one settlement | The comment rail loads behind the render. Without it a request that neither completes nor fails left a spec with no *comments*, which is a worse failure than no diagram. |
| R2 | A render that lands after the page settled is dropped | R1 created this in exchange. Changing a block after the reconcile ran against it anchors every comment on the page to text that is no longer there. The diagram stays as source until the next load, which is consistent with what was recorded. |
| R3 | An unsettled page skips the reconcile entirely, not just the write | Not writing was not enough. `reconcileBlocks` populates `goneBids` in memory either way, so a page with one diagram rendered and one not showed orphaned comments having written nothing. |
| R4 | Nothing inside a rendered diagram is a commentable block | Mermaid renders labels as `<p>` in a foreignObject and `<p>` is in `BLOCK_SEL`, so a diagram was silently several blocks. This is what makes per-node comments a real non-goal rather than an intention. |
| R5 | Mermaid's injected stylesheet is moved to `<head>` | It sits inside the SVG, so it was part of the block's `textContent`: a diagram's identity was a kilobyte of generated CSS, and the rail quoted it back at the reader. |
| R6 | `applyLang` replaces the language class rather than appending | Given `data-lang="yaml" class="language-sql"` the review layer decided yaml and highlighted sql. Deciding one language and applying another is a bug at any frequency. |
| R7 | A wrapper's declared language reaches the block it wraps and no further | Carrying it down a whole subtree labelled every descendant. `declaredLang()` stops at the immediate parent, and the table is only a contract if both sides answer it identically. |
| R8 | Mermaid is told the page's real font family, and the bridge sets no font at all | A label's box is sized around its measured text. `fontFamily: 'inherit'` is not a family, so mermaid measured in a fallback while the CSS painted in the monospace face inherited through the `<pre>`: 87px of text in a 60px slot, and every label clipped mid-word. |
| R9 | Rendering waits for `document.fonts.ready` | A reading font is fetched on demand, so even the right family measures wrong before it arrives. A rejected promise counts as ready: a font that will not load is not a reason to withhold the diagram. |
| R10 | The settle timeout is armed before either wait | R9 added a second way to wait. The timer was armed only where the script is fetched, so a page that already had mermaid could wait on fonts forever, and the comment rail loads behind it. |

<!-- sf:callout variant="risk" -->

> **The clipping was invisible to the whole automated suite.** Thirty-two browser tests passed while every label in the first real spec was cut off mid-word, because the e2e fixture uses no web font and the shell's default sans is close enough to mermaid's fallback that nothing overflows.
>
> The regression test passed against broken code twice before it worked: comparing a label to its shape hides the overflow in the shape's padding, and comparing under the default font hides it entirely. It reproduces only against the `foreignObject` mermaid sized, under a wide reading font. Rendering a real document, with real preferences, is what found it.

#### Deviations

| Departure | Why |
| --- | --- |
| Stage 0 **repaired** the e2e harness before extending it | It had not run since the v2 store landed: `review.e2e.mjs` imported `server/app.mjs` and `lib/paths.mjs`, neither of which exists. CI runs only the unit tier, so nothing said so. |
| Stage 1 also changed static-asset caching | `serveStatic` answered `no-store`, which forbids keeping a copy at all. Invisible at prism's 34 KB; at 3.4 MB it is the whole bundle again on every live-reload while a spec is being authored, which would have made D11 false in practice. |
| Task 4.1 landed in Stage 2 | Review found the missing write guard there, and a flag threaded through but read by nobody is worse than the guard. |
| Stage 4 added R4 and R5, neither planned | Both were found by the lifecycle tests, and both broke the v1 promise that a diagram is one block. |
| Stage 5 also fixed `review.js` (R6) and `structural-equivalence.mjs` | The agreement test found the first immediately. The second is a third implementation of the same rule, which reported the round trip as lossy at the moment it became lossless. |

#### Tradeoffs

- **`!important` against stripping mermaid's stylesheet.** Stripping would remove the need to outrank it, and would also remove the layout rules mixed in with the colours. Overriding is the smaller bet; the stylesheet is moved rather than deleted (R5) for the same reason.
- **The wrapper-declared language was implemented although no spec uses it.** Measured 0 of 46. Implementing it costs ten lines and removes a known exception from a table that is meant to be a contract.
- **The PDF path was left alone.** `tools/spec-pdf.mjs` reads over `file://` deliberately, so a diagram prints as its source. Inspected rather than assumed, recorded in §9, and out of scope for these stages. The fix is to inject the vendored bundle in that tool.
- **Test totals are counted one file per process.** `--test-force-exit` truncates the TAP report: `npm test` printed 1182 where `node --test` printed 1214 on the same tree. The exit code is correct in every mode, so CI's verdict was never in question, but every printed total is a floor. Pre-existing and untouched.

## 13 · Documentation updates

<!-- sf:section id="doc-updates" -->

Landed as task 6.4.

| What changed | To reflect in the docs |
| --- | --- |
| New handlers / APIs | `GET /public/mermaid.js`. `scripts/build-mermaid.mjs` as a build step alongside `build-prism.mjs`. |
| New patterns | A third way to draw, and the rule for choosing between the three. Generated into `references/spec-components.md`; summarised in `templates/house-rules.md`. |
| New features | Mermaid rendering, themed from the palette; comments on a diagram; ```` ```mermaid ```` markdown round-trip. |
| New invariants | `mermaid` is the one declared language never highlighted. The block reconcile writes only from a settled page. A declared language now survives export. |
| Removed / renamed | Nothing removed. The Code blocks section of house-rules gains an exception rather than losing a rule. |

## 14 · Testing journeys

<!-- sf:section id="test-journeys" -->

Landed as task 6.4.

| Change | Journey | What it exercises |
| --- | --- | --- |
| add | Author, render, review a diagram | An agent creates a spec with a mermaid block; the daemon serves it; the diagram renders; a human comments on it; the agent replies through `review-spec`; the thread survives a reload. |
| add | Diagram survives a renderer outage | A spec with a comment on a diagram is loaded once with `/public/mermaid.js` unreachable, then loaded normally. The thread must resolve on both, and `blocks.json` must not change on the failed load. |
| add | Diagram round-trips through markdown | `export-md` then `import-md` on a spec carrying a mermaid block and a python block. Both languages survive; no asset is written for the diagram. |
| modify | Existing review e2e | Gains the computed-style helper from Stage 0. The no-diagram path must stay byte-identical in behaviour, since 120 of 120 specs take it. |

## Appendix

#### A · Per-node comments: the deferred feasibility evidence

Recorded because it is the reason v1's container design does not foreclose per-node comments, and because re-deriving it costs another probe.

**The finding: mermaid's node labels are stable exactly where its DOM ids are not, and SpecForge already keys block identity on text rather than on id.** Per-node comments therefore need no new identity machinery, only a class applied after render and the same settled-page sequencing v1 already introduces.

| Question | Measured answer |
| --- | --- |
| Is there a per-node element? | Yes for flowchart, state, ER and class: `<g class="node">` whose `textContent` is the label. **No for sequence diagrams**, which render actors as separate `<rect>` and `<text>` with no grouping element. |
| Are mermaid's node ids usable as an anchor? | No. Inserting one node above the others moved `flowchart-A-0` to `A-1`, `B-1` to `B-3` and `C-3` to `C-5`. The trailing counter is a global sequence, so any earlier edit shifts every later id. |
| Is the label stable? | Yes. Across two renders of the same source the label sequence was identical, and after the insert above, the three surviving labels were unchanged. |
| What would be excluded? | Sequence diagrams entirely; nodes with empty labels (the `[*]` start marker renders as a `g.node` with no text); duplicate labels, which stay ambiguous the same way duplicate paragraphs already are and which `legacyMatch` already refuses to resolve permanently. |

scripts/probe-mermaid-dom.mjs, mermaid 11.16.1, Chromium 1228, 2026-08-15.

#### B · Measurements

| Quantity | Value | How |
| --- | --- | --- |
| Bundle, raw | 3.40 MB | `dist/mermaid.min.js`, mermaid 11.16.1 |
| Bundle, gzipped | 959 KB | `zlib.gzipSync` over the same file |
| Render, warm | 14.9 ms per diagram | mean of 5, Chromium 1228 |
| Specs in the store | 120 | `~/.specforge/specs` |
| Inline SVG elements | 223, in 49 specs | `count-specforge-ascii-diagrams.mjs` |
| ASCII sketches | 29, in 23 specs (upper bound) | glyph heuristic; sample holds a false positive |
| Code blocks | 136, of which 45 declare a language | same script |
| Declared languages lost on export | 45, across 15 specs | `count-specforge-lang-labels.mjs` read against `html-to-md.mjs:308` |

#### C · Probe scripts

Written for this spec, kept outside the repo in `~/workspace/scripts/`: `probe-mermaid-dom.mjs` (node structure, id stability, determinism), `probe-mermaid-theme.mjs` (theming routes, render cost), `count-specforge-ascii-diagrams.mjs` (store census).

#### D · Reference

- Mermaid 11.16.1, MIT. Same licence posture as the vendored Prism 1.30.
- `templates/house-rules.md` · Format, Code blocks, Palette tokens, Markdown interop.
- `references/spec-components.md`, generated from `components/`.
