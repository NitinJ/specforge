// The block registry: SpecForge's memory of a spec's block sequence, kept at
// ~/.specforge/specs/<id>/blocks.json so comments keep their place when the
// spec is edited.
//
// Two properties this file exists to guarantee:
//
//   1. The registry is DERIVED and DISPOSABLE. Nothing about a comment requires
//      it. A missing, unreadable or malformed file reads as "no registry", the
//      client rebuilds it from the page, and comments meanwhile resolve exactly
//      as they did before this existed. The worst case is the old behaviour.
//   2. The server does NOT understand it. It stores and returns JSON; every
//      decision about which block is which is made client-side, where the DOM
//      is. That keeps the long-standing rule that the server never parses a spec.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { specDir, blocksPath } from './store-paths.mjs';

const SCHEMA = 1;

/** Read a spec's registry, or null when there isn't a usable one. Never throws:
 *  a corrupt or future-schema file is indistinguishable from no file, which is
 *  the safe path — the client just rebuilds. */
export function readBlocks(id) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(blocksPath(id), 'utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  if (raw.schema !== SCHEMA) return null;       // a format we don't know: rebuild
  if (!Array.isArray(raw.blocks)) return null;
  return raw;
}

/**
 * Persist a registry. Shape is validated but not interpreted — entries that
 * aren't {bid, tag, hash} strings are dropped rather than trusted, so a bad
 * client can't poison the file for a good one.
 * @returns {{schema:number,version:number,seq:number,blocks:object[]}} what was stored
 */
export function writeBlocks(id, data) {
  const blocks = Array.isArray(data && data.blocks) ? data.blocks : [];
  const retired = Array.isArray(data && data.retired) ? data.retired : [];
  const clean = {
    schema: SCHEMA,
    version: Number.isInteger(data && data.version) ? data.version : 1,
    seq: Number.isInteger(data && data.seq) ? data.seq : blocks.length,
    // Ids of blocks that once existed and are now deleted. Kept so a later load
    // still knows a comment's block was removed rather than merely unfindable —
    // and kept in FULL: truncating drops the oldest first, and a thread whose id
    // is dropped stops reading as an orphan and re-attaches to unrelated text.
    retired: retired.filter((b) => typeof b === 'string'),
    blocks: blocks
      .filter((b) => b && typeof b.bid === 'string' && typeof b.tag === 'string' && typeof b.hash === 'string')
      .map((b) => ({ bid: b.bid, tag: b.tag, hash: b.hash })),
  };
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(blocksPath(id), JSON.stringify(clean));
  return clean;
}

export { SCHEMA };
