---
title: Collection labels on the shared project page
type: design-impl
status: draft
specforge_id: f081f883da
---

# Collection labels on the shared project page

## TL;DR

<!-- sf:box class="panel" -->

Each row on the public project page shows the spec's collection name. One span in the row markup, one CSS rule, one test. No filtering, no rail, no grouping: those are recorded in [§5](#deferred) and not built. Scope set by the owner on 2026-08-16 after a three-level option table.

## 1 · Overview

The public project page renders one row per spec carrying title, type, status and a relative timestamp. A spec's `collection` is a string on its meta and is not rendered, so a reviewer reading a shared project cannot tell which collection a spec belongs to. The owner sees that grouping on the home page.

Two projects hold collections today: `Figur design studio` distributes 20 specs over 6 collections plus 1 uncollected, and `specforge` has 0 collections over 23 specs.

`node scripts/report-project-shape.mjs`, 2026-08-16, counted from `~/.specforge/specs/*/meta.json`

## 2 · Goals & non-goals

<!-- sf:section id="goals" -->

#### Goals

- A spec's collection name is visible on its row on the page served at `/p/<token>`.
- A spec with no collection renders no label rather than an empty box.

#### Non-goals

| Out of scope | Why |
| --- | --- |
| Filtering, searching, sorting or grouping by anything | Owner decision, 2026-08-16. A displayed label costs a span; a control that narrows the list costs the controls plus the browser code that decides which rows to hide. See [§5](#deferred). |
| A collections rail | Same decision. The rail is only useful if clicking it filters. |
| Tags on the public page | Owner decision, 2026-08-16. |
| The project name on each row | Every spec on the page belongs to the project the token resolves to, and the page heading already names it. A per-row copy repeats one word once per spec, 23 times for project `specforge`. |
| Collection labels on contributed rows | A contributed entry carries title, owner, origin, token and `addedAt`. This machine holds no collection for a spec another machine serves. |

## 3 · Design

The local-spec row gains one span between the title and the type. It reads `m.collection` from the meta the page already loads through `listSpecs()`, and renders nothing when that is null.

#### Row anatomy

| Position | Field | Change |
| --- | --- | --- |
| 1 | Title, linking to the spec under the same token | unchanged |
| 2 | Collection | added muted, squared chip; absent when the spec has no collection |
| 3 | Type | unchanged |
| 4 | Status | unchanged |
| 5 | Relative updated | unchanged |

#### What crosses the wire

The page already serves title, type, status and update time for every spec in the project. It now also serves the collection name for those specs. Nothing else is added, and no collection name that has no member in this project can appear, because the page renders only this project's specs.

#### Styling

A 6px-radius chip with a 1px border in `--line` and text in `--muted`, distinguishing it from the status pill, which is a 999px-radius chip that carries colour. Two muted plain-text spans side by side (collection and type) would read as one run-on string.

## 4 · Decisions

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| D1 | How far to take the shared project page | Display the collection label only. | Owner decision, 2026-08-16, taken against a three-level option table. Level 1 costs a span and a CSS rule; level 2 (search, status, type, sort, count) and level 3 (rail plus grouping) each cost a PR with browser code and tests per control. |
| D2 | A spec with no collection | Render nothing. | An empty chip asserts that a spec has a collection whose name is blank. 1 of 20 specs in `Figur design studio` and 23 of 23 in `specforge` are uncollected, so the empty case is the common one. |
| D3 | Contributed rows | No collection label. | This machine holds no meta for a spec another machine serves. Inventing a blank label there would read as "no collection" rather than "not known here". |
| D4 | Chip rather than plain text | Bordered chip, muted. | Collection and type would otherwise be two adjacent muted strings with no visual boundary. |

## 5 · Deferred

Analysed on 2026-08-16 and not built. Recorded so the reasoning is available if the shared page grows.

| Level | What it adds | Cost | State |
| --- | --- | --- | --- |
| 1 | Collection name visible on each row | One span, one CSS rule, one test | this spec |
| 2 | Search, status chips, type filter, sort, live count | One PR. Each control needs markup plus the browser code that hides rows and updates counts. The values are already on the page; making them filterable is the work. | deferred |
| 3 | Collections rail with counts, clickable, rows grouped under headings | One further PR, plus a two-column layout and a narrow-viewport breakpoint | deferred |

Two findings from that analysis stand on their own and are not part of this spec:

- `relativeTime` is defined twice with different thresholds. The home page carries months and years; the public page stops at days, so a spec updated 14 months ago reads "420d ago" there and "1y ago" at home.
- The public page renders an empty type for a spec with no type field, where the home page reads it as `design-impl`. 2 of 23 specs in project `specforge` are affected.

Neither blocks this change. Both would need fixing before level 2, because a type filter cannot reach a row whose type is blank.

## 6 · Implementation plan

<!-- sf:section id="impl-plan" -->

One stage, one PR. Test first, then the change.

<!-- sf:callout variant="constraint" -->

> Local only. Nothing here publishes, and no stage needs a tunnel.

### Stage 1 · The collection label

- [x] 1.1 Write the failing test: a project holding one collected and one uncollected spec renders the collection name once, on the collected row only.
      verify: the test fails against the current page with the collection name absent
- [x] 1.2 Add the span and the CSS rule to the local-spec row.
      verify: the test passes; contributed rows carry no collection markup (D3)
- [x] 1.3 Screenshot the served page for a project with collections and one without.
      verify: `Figur design studio` shows a chip per collected row; `specforge` shows rows with no chip and no gap where one would be

**Testing:** row markup for the collected, uncollected and contributed cases · unit test over the rendered string, run red first

**Verifiable output:** `npm test` green, plus the two screenshots

## 8 · Runtime

Filled during implementation.

#### Design decisions (implementation time)

Choices made where the spec was ambiguous.

The chip does not shrink

The row is a flex line whose title is the flexible item. With the chip left shrinkable, it absorbed whatever the title did not use, so one collection rendered at a different width on every row: `Figur tree generator` appeared as "Figur tree gen…", "Figur tree gener…" and in full, down a single page, reading as three collections. `flex:none` on the chip fixes its width to its content and lets the title take the squeeze instead. The 220px cap stays, so a long name truncates at the same point on every row rather than at a different one per row.

The chip sits between title and type, not after status

Collection and type both answer "what is this"; status and the update stamp answer "where is it up to". Keeping the first pair adjacent means the eye crosses one boundary rather than two.

#### Deviations

Intentional departures from the spec, and why.

- none

#### Tradeoffs

Alternatives considered and why the chosen path won.

A test cannot see the width defect

The five tests assert markup, and every one passed while the same collection was rendering at three widths. The defect is a layout outcome, visible only in a rendered page. It was found by screenshotting `Figur design studio`, which is the third defect in this area found that way rather than by a green suite (spec 82f5dabccf records the other two). The screenshot step in task 1.3 is the check that catches this class, and it is why the stage carries one.

The 220px cap over wrapping the chip

A collection name longer than 220px truncates with an ellipsis rather than wrapping the row to two lines. The list is scanned vertically, so a row of uneven height costs more than a truncated label; the full name is on the spec page itself. No collection in the store reaches the cap today: the longest is `Code and architecture cleanup`.

## Appendix

| Reference | What it holds |
| --- | --- |
| spec `82f5dabccf` | Team collaboration: shared projects and reviewer mode. The page this spec changes was designed there. |
| `server/project-page.mjs` | The page this spec changes. |
| `lib/meta.mjs` | `listSpecs`, and the `collection` field this spec renders. |
| `scripts/report-project-shape.mjs` | The measurement in [§1](#overview). |
| `scripts/check-collection-overlap.mjs` | Checks whether a collection name is used in more than one project. 15 names, 0 spanning, on 2026-08-16. |
