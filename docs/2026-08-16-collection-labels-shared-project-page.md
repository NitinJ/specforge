---
title: "Sections, placement and theme on the shared project page"
type: design-impl
status: draft
specforge_id: f081f883da
---

# Sections, placement and theme on the shared project page

## TL;DR

<!-- sf:box class="panel" -->

The public project page groups its specs under collection headings, the way the owner sees the same project on their own home page. The "Add to my SpecForge" block moves above the list, and the page gains a light/dark toggle. All of it is server-rendered markup plus one small script for the toggle. Filtering and a clickable rail stay deferred ([§5](#deferred)): those need browser code per control, and grouping does not.

## 1 · Overview

The public project page renders one row per spec carrying title, type, status and a relative timestamp. A spec's `collection` is a string on its meta and is not rendered, so a reviewer reading a shared project cannot tell which collection a spec belongs to. The owner sees that grouping on the home page.

Two projects hold collections today: `Figur design studio` distributes 20 specs over 6 collections plus 1 uncollected, and `specforge` has 0 collections over 23 specs.

`node scripts/report-project-shape.mjs`, 2026-08-16, counted from `~/.specforge/specs/*/meta.json`

## 2 · Goals & non-goals

<!-- sf:section id="goals" -->

#### Goals

- A spec's collection name is visible on its row on the page served at `/p/<token>`.
- Specs are grouped under their collection, in the same order the owner's home page uses.
- A project with no collections renders the flat list it renders today.
- A reader meets the "Add to my SpecForge" block without scrolling.
- A reader can choose light or dark against their OS preference, and the choice survives a reload.
- No row overflows its width down to 420px.

#### Non-goals

| Out of scope | Why |
| --- | --- |
| Filtering, searching, sorting or grouping by anything | Owner decision, 2026-08-16. A displayed label costs a span; a control that narrows the list costs the controls plus the browser code that decides which rows to hide. See [§5](#deferred). |
| A collections rail | Same decision. The rail is only useful if clicking it filters. |
| Tags on the public page | Owner decision, 2026-08-16. |
| The project name on each row | Every spec on the page belongs to the project the token resolves to, and the page heading already names it. A per-row copy repeats one word once per spec, 23 times for project `specforge`. |
| Collection labels on contributed rows | A contributed entry carries title, owner, origin, token and `addedAt`. This machine holds no collection for a spec another machine serves. |

## 3 · Design

The page partitions a project's specs by collection and emits a section per group: a heading carrying the collection name and a count, then the rows. The row itself is unchanged, and carries no collection label, because the heading states it once for every row beneath it.

Rendering is entirely server-side. The page gains no browser code, which is what separates this from the deferred levels in [§5](#deferred): a section is markup, a filter is markup plus a script that decides which rows to hide.

#### Page anatomy

| Position | Block | Change |
| --- | --- | --- |
| 1 | Project name and subtitle | unchanged |
| 2 | "Add to my SpecForge" panel | unchanged (moved above the list earlier in this stage) |
| 3 | One section per collection: heading, count, rows | added |
| 4 | Uncollected section | added last, and only when something is in it |
| 5 | "From other machines" section | added the contributed rows, always last |

#### Group order

Groups come out of `groupByCollection`, which moves from `server/index-page.mjs` to `lib/collections.mjs` and is now imported by both pages. Named collections rank by the owner's arranged order (`collectionOrder` in global prefs), then alphabetically for anything unranked; `Uncollected` is always last and appears only when a spec has no collection.

The extraction is 12 lines and exists for one reason: a reader looking at a shared project and the owner looking at that project selected on their own home page must see the same groups in the same order. Two copies of the rule would disagree the first time either was tuned.

#### Projects with no collections

A project where no spec carries a collection renders the flat list it renders today, with no heading. One heading over every row names nothing. Project `specforge` is in this state: 23 specs, 0 collections.

#### Contributed rows

A contributed entry carries title, owner, origin, token and `addedAt`, and no collection. Its rows form a section headed "From other machines", placed after every collection. Filing them under one of the owner's groups would assert a collection this machine does not hold.

#### What crosses the wire

The page already serves title, type, status and update time for every spec in the project. It now also serves the collection names of the specs in this project, as headings. No collection name that has no member in this project can appear, because the page renders only this project's specs.

#### Theme

The page followed `prefers-color-scheme` with no way to disagree with it. A toggle now sits at the top right, beside the project name.

Three states, in the order the cascade needs them: `:root` carries dark as the base, `@media (prefers-color-scheme: light)` supplies light through `:root:not([data-theme="dark"])`, and `:root[data-theme="light"]` wins over both. The guard on the media query is what lets an explicit dark choice survive a light OS; without it the toggle would work in one direction only.

The choice is stored in the reader's own `localStorage` under `sf-theme`, and applied by a snippet in `<head>` so a reader who chose light does not see a dark flash first. The button's icon shows the theme in force, not the one a click would produce: with nothing stored it asks `matchMedia` what the browser actually resolved to, because the attribute is absent in that state.

## 4 · Decisions

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| D1 | How far to take the shared project page | Display the collection label only. | Owner decision, 2026-08-16, taken against a three-level option table. Level 1 costs a span and a CSS rule; level 2 (search, status, type, sort, count) and level 3 (rail plus grouping) each cost a PR with browser code and tests per control. |
| D2 | A spec with no collection | Render nothing. | An empty chip asserts that a spec has a collection whose name is blank. 1 of 20 specs in `Figur design studio` and 23 of 23 in `specforge` are uncollected, so the empty case is the common one. |
| D3 | Contributed rows | No collection label. | This machine holds no meta for a spec another machine serves. Inventing a blank label there would read as "no collection" rather than "not known here". |
| D4 | Sections rather than a label per row | Group under headings; the row carries no collection. | Owner decision, 2026-08-16, after seeing the label shipped. A label on every row leaves the reader to sort 20 rows into 6 groups by eye; a heading does it once. It is also what the owner's home page does for the same project, so the two now read alike. |
| D5 | Where the grouping rule lives | `lib/collections.mjs`, imported by both pages. | 12 lines. A reader on a shared project and the owner on that project selected must see the same groups in the same order; two copies would disagree the first time either was tuned. |
| D6 | Where a reader's theme choice is stored | The reader's own `localStorage`. | The page makes no writes off the browser (spec `82f5dabccf`, R9), and a colour preference is not worth being the exception. It also means two readers of the same link can disagree, which a store-side setting could not express. |
| D7 | Which theme the toggle's icon shows | The one in force. | The convention is ambiguous, so the page picks one and states it: a sun means the page is light now, not that a click makes it light. It matches the home page's toggle (`index-page.mjs`), which shows a moon in dark. With nothing stored the attribute is absent, so the current theme comes from `matchMedia` rather than from a default. |

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
- [x] 1.4 Move the join block above the list and shed row fields at narrow widths.
      verify: a test asserts the block precedes the first row and fails against the old order; screenshots at 1000px, 640px and 420px show no row overflowing
- [x] 1.5 Replace the per-row label with collection sections, moving `groupByCollection` to `lib/collections.mjs`.
      verify: 8 tests over grouping, counts, order, the no-collections case and contributed rows; the home page renders the same groups in the same order as the shared page, checked by screenshot of both
- [x] 1.6 Add the light/dark toggle.
      verify: 6 tests over flipping, persistence, head-order and the no-write guarantee; screenshots under both OS schemes, each toggled, confirm the choice overrides the OS in both directions

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

Narrow viewports shed the type first, then the collection

The chip does not shrink and the type, status and stamp never wrap, so below about 640px the title was the only item left to give and collapsed toward an ellipsis. The page carried no media query before this change. Two breakpoints now drop fields in order of how little they carry: `type` at 640px, the collection at 460px. Title, status and recency survive to the narrowest width, because those are what a row is scanned for. Raised in review of PR #181.

The label shipped, then was replaced by sections

Level 1 was scoped as a label on each row and shipped that way in PR #181. Seen rendered, a label per row still left a reader sorting 20 rows into 6 groups by eye. Sections were then costed properly: the earlier estimate bundled grouping with a clickable rail, but grouping alone is server-rendered markup with no browser code, and the browser code was what made the rail expensive. The label is now removed, because a heading states the collection once for every row under it.

An invalid nesting the tests and the browser both tolerated

The page wrapped its row markup in a `<ul>` at the call site. Once rows became `<section>` elements each holding their own `<ul>`, that produced `<ul><section>…</section></ul>`. Every test passed and both screenshots looked correct, because browsers recover from it. Found while restructuring the header. The call site now emits the markup as built.

"Add to my SpecForge" moved above the list

Spec `82f5dabccf` placed it under the spec list on the reasoning that a reader came to read and keeping the project is their second want. The consequence was that on any project past a screenful the block sat below the fold, so a reader browsing a long project (20 rows for `Figur design studio`) never saw it. It is now a panel between the subtitle and the list, sized as a quiet panel rather than a banner. Owner decision, 2026-08-16. A test asserts its position rather than its presence, because every other join test passes wherever the block sits.

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
