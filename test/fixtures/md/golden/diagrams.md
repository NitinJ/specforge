---
title: Ingest pipeline topology
type: design
status: draft
specforge_id: id-diagrams
exported_at: 2026-08-14
---

# Ingest pipeline topology

## TL;DR

<!-- sf:box class="panel" -->

Two diagrams, one wrapped in a figure with a caption and one bare with an aria-label. This fixture exists to exercise SVG extraction, so its prose is thin on purpose.

## 1 · Architecture

![Collector feeds the queue, the queue feeds the writer](ingest-pipeline-topology.assets/architecture-1.svg)

<!-- sf:svg id="architecture-1" -->

*Collector, queue, writer. The writer is the only component this spec adds.*

The collector batches on a 200ms timer, so a burst never opens more than five connections to the queue.

## 2 · Request flow

<!-- sf:section id="flow" -->

![Retry path from the writer back onto the queue](ingest-pipeline-topology.assets/flow-1.svg)

<!-- sf:svg id="flow-1" -->

A failed write returns to the retry queue with its attempt count incremented.
