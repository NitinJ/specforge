---
title: Rotate the signing key
type: impl
status: draft
specforge_id: id-impl
exported_at: 2026-08-14
---

# Rotate the signing key

## TL;DR

<!-- sf:box class="panel" -->

Dual-publish both keys for one token lifetime (14 days), cut signing to the new key, then retire the old one.

## 1 · Overview

Design is settled in spec `a91f0c2b44`. This is the build plan only. The constraint that shapes every stage: a token signed with the old key must stay verifiable until it expires, so the two keys overlap for a full 14-day lifetime.

## 2 · Implementation plan

<!-- sf:section id="impl-plan" -->

### Stage 1 · Publish both keys

- [ ] 1.1 Serve both keys from the JWKS endpoint, new key first.
      verify: the endpoint returns two keys and a client picks by `kid`
- [ ] 1.2 Verify against either key.
      verify: tokens signed with both keys validate

**Verifiable output:** a JWKS response with two entries

### Stage 2 · Cut over and retire

- [ ] 2.1 Sign with the new key.
      verify: a fresh token carries the new `kid`
- [ ] 2.2 Drop the old key 14 days after cutover.
      verify: JWKS returns one key; old tokens are rejected

**Verifiable output:** a single-key JWKS response
