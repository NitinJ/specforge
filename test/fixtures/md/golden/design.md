---
title: Retry policy for webhook delivery
type: design
status: draft
specforge_id: id-design
exported_at: 2026-08-14
---

# Retry policy for webhook delivery

## TL;DR

<!-- sf:box class="panel" -->

Deliveries retry 5 times on an exponential backoff capped at 15 minutes, then land in a dead-letter queue.

## 1 · Overview

A failed webhook is retried immediately and then dropped. Subscribers on flaky hosts lose events with no record, and support has no way to replay them.

This spec covers delivery retries only. Subscription management is unchanged.

## 2 · Goals & non-goals

<!-- sf:section id="goals" -->

#### Goals

- No event is dropped without a dead-letter record.
- A subscriber down for 15 minutes receives every event it missed.

#### Non-goals

- Ordering guarantees across retries.
- Per-subscriber backoff tuning.

## 3 · Design

### Backoff schedule

Attempt *n* waits `min(2^n seconds, 900)` with full jitter. The schedule is fixed, not per subscriber.

| Attempt | Nominal delay | Cumulative |
| --- | --- | --- |
| 1 | 2s | 2s |
| 2 | 4s | 6s |
| 3 | 60s | 66s |
| 4 | 900s | 16m 6s |
| 5 | 900s | 31m 6s |

### Classification

Only these outcomes retry:

- A connection error, which covers:
  - DNS failure
  - TLS handshake failure
  - Read timeout past 10s
- A `5xx` response.
- A `429` response, honouring `Retry-After` when it is under 900s.

A `4xx` other than `429` is terminal: the subscriber rejected the payload and a retry sends the same bytes.

#### Worker loop

```js
async function deliver(event, attempt = 1) {
  const res = await post(event.url, event.body);
  if (res.ok) return mark(event, 'delivered');
  if (!retryable(res) || attempt === 5) return deadLetter(event, res);
  return schedule(event, attempt + 1, backoff(attempt));
}
```

<!-- sf:callout variant="warn" -->

> The dead-letter queue has no automatic drain. An operator replays it with `webhooks replay <id>`, which is deliberate: an automatic drain re-sends events a subscriber already rejected.

<!-- sf:callout variant="good" -->

> Replay is idempotent. Each delivery carries the original `event_id`, so a subscriber that already processed it can discard the duplicate.

See the [delivery runbook](https://example.com/runbook) for the operator side.

## 4 · Decisions

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| D1 | How many attempts? | 5 | Covers a 30 minute outage; a longer tail holds queue capacity for subscribers that are gone. |
| D2 | Jitter? | Full jitter | A fixed schedule synchronises every failed delivery onto the same second. |

## 5 · Open questions

- [ ] **Q1 · open** Should the dead-letter queue expire records, and after how long?
- [x] **Q2 · resolved** Does `Retry-After` override the schedule? Yes, when it is under 900s.
- [ ] **Q3 · dropped** Per-subscriber concurrency limits. Out of scope, tracked separately. <!-- sf:q state="dropped" -->
