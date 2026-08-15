---
title: Every notice type
type: design
status: draft
specforge_id: id-notices
exported_at: 2026-08-14
---

# Every notice type

## TL;DR

One notice of every type in the library, so the round trip has to carry all twelve. Before the exporter derived its list from the definitions, eleven of these came back as a bare callout.

## 1 · Notices

<!-- sf:callout variant="note" -->

> Note body: Context a reader needs that is not itself a claim about the design.

<!-- sf:callout variant="tip" -->

> Tip body: Advice that makes something easier and is safe to ignore.

<!-- sf:callout variant="success" -->

> Success body: A settled good outcome: a check that passed, a target that was met.

<!-- sf:callout variant="warning" -->

> Warning body: A hazard the reader can avoid by knowing about it.

<!-- sf:callout variant="danger" -->

> Danger body: An action that breaks something irreversibly.

<!-- sf:callout variant="example" -->

> Example body: A concrete instance of a rule stated elsewhere.

<!-- sf:callout variant="quote" -->

> Quote body: Words that are somebody else’s, with attribution.

<!-- sf:callout variant="decision" -->

> Decision body: A choice made, with the criterion it was made on.

<!-- sf:callout variant="assumption" -->

> Assumption body: Something believed but not verified.

<!-- sf:callout variant="risk" -->

> Risk body: A specific way this can fail, named precisely enough to design against.

<!-- sf:callout variant="deviation" -->

> Deviation body: A departure from a stated principle, house rule, or existing pattern.

<!-- sf:callout variant="constraint" -->

> Constraint body: A fixed limit the design works within and cannot change.

## 2 · Legacy tones

<!-- sf:section id="legacy" -->

Markdown written before the library still has to open, so the three tone modifiers stay readable.

<!-- sf:callout variant="warn" -->

> A pre-library caution.

<!-- sf:callout variant="good" -->

> A pre-library positive.

<!-- sf:callout variant="bad" -->

> A pre-library negative.

<!-- sf:callout -->

> A pre-library notice with no modifier at all.
