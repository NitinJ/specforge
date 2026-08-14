---
title: On-device vs server inference for pose estimation
type: research
status: approved
specforge_id: id-research
exported_at: 2026-08-14
---

# On-device vs server inference for pose estimation

## TL;DR

<!-- sf:box class="panel" -->

On-device inference costs 340ms median on a 2021 mid-range Android and 0 cents per call. Server inference costs 95ms median plus 180ms round trip and $0.0004 per call. On-device wins below 2.1M monthly calls.

## 1 · Question

At what monthly call volume does server-side pose estimation cost less than shipping the model to the device, counting latency and support burden as well as cents?

## 2 · Method

- Benchmarked **MoveNet Lightning** on four Android devices and two iPhones, 500 frames each, measured 2026-07-28.
- Priced server inference against the published rate card, retrieved 2026-07-30.
- Excluded cold-start cost on the server path; measured warm only.

## 3 · Findings

### Latency

| Path | Device | Median | p95 |
| --- | --- | --- | --- |
| On-device | Pixel 6a | 340ms | 510ms |
| On-device | iPhone 13 | 120ms | 180ms |
| Server | any | 275ms | 640ms |

### Cost

Server inference is `$0.0004` per call. On-device adds 14MB to the bundle, which raises install abandonment by 0.3 percentage points at the 95% confidence interval measured in the 2026-06 install experiment.

<!-- sf:callout -->

> The p95 crossover matters more than the median: the server path's tail is dominated by mobile network variance, not by inference.

## 4 · Recommendations

1. Ship on-device for iOS, where the median is 120ms.
2. Keep Android on the server path until the mid-range median drops under 200ms.
3. Revisit when call volume passes 2M per month.

## Sources

- [MoveNet model card](https://example.com/movenet), retrieved 2026-07-28.
- Internal benchmark run `bench-2026-07-28-pose`.
