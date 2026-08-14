---
title: Bulk export for saved searches
type: design-impl
status: draft
specforge_id: id-design-impl
exported_at: 2026-08-14
---

# Bulk export for saved searches

## TL;DR

<!-- sf:box class="panel" -->

A saved search exports to CSV through a queued job, capped at 50,000 rows, delivered as a signed link that expires in 24 hours.

## 1 · Overview

Export runs inline today and times out past roughly 8,000 rows. The request holds a web worker for the whole render, so two concurrent exports degrade search for everyone.

## 2 · Goals & non-goals

<!-- sf:section id="goals" -->

#### Goals

- 50,000 rows export without holding a web worker.
- A user sees progress and a failure reason.

#### Non-goals

- XLSX output.
- Scheduled recurring exports.

## 3 · Design

The request enqueues a job and returns `202` with a job id. A worker streams rows to object storage in 1,000-row pages, then writes a signed URL onto the job record.

| Component | Change |
| --- | --- |
| `SearchController` | Enqueue instead of render; return the job id. |
| `ExportWorker` | New. Pages the query, streams CSV, uploads. |
| `jobs` table | New columns: `row_count`, `signed_url`, `expires_at`. |

```sql
ALTER TABLE jobs
  ADD COLUMN row_count integer,
  ADD COLUMN signed_url text,
  ADD COLUMN expires_at timestamptz;
```

<!-- sf:callout variant="warn" -->

> The 50,000 row cap is enforced in the worker, not the query. A query returning more rows exports the first 50,000 and marks the job `truncated`.

## 4 · Decisions

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| D1 | Delivery | Signed URL, 24h expiry | Email attachments hit size limits past roughly 8MB. |

## 5 · Implementation plan

<!-- sf:section id="impl-plan" -->

Stages and tasks. One stage is one PR.

### Stage 0 · Job scaffolding (PR 311)

- [x] 0.1 Add the three `jobs` columns and the migration.
      verify: migration applies and rolls back on a scratch database
- [x] 0.2 Job fixture factory for tests.
      verify: a test creates a queued job and reads it back

**Verifiable output:** a queued job row an agent can inspect

### Stage 1 · Worker

- [x] 1.1 Page the query in 1,000-row batches.
      verify: a 3,500-row fixture produces 4 batches
- [ ] 1.2 Stream CSV to object storage.
      <!-- sf:task id="1.2" status="in_progress" -->
      verify: the uploaded object matches the fixture byte for byte
- [ ] 1.3 Signed URL generation.
      <!-- sf:task id="1.3" status="blocked" -->
      verify: the URL 403s after expiry
- [ ] 1.4 Progress percentage on the job record.
      <!-- sf:task id="1.4" status="deferred" -->
      verify: the UI shows a moving bar

**Verifiable output:** a CSV in the bucket for a seeded search

## 7 · Runtime

#### Design decisions (implementation time)

- none yet

#### Deviations

- none yet

#### Tradeoffs

- none yet
