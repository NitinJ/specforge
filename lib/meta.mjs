// meta.json IO for the v2 global spec store.
//
// Each spec carries a meta.json at ~/.specforge/specs/<id>/meta.json describing
// its lifecycle + session ownership. Path resolution lives in store-paths.mjs;
// this module is pure IO over the per-spec dir.
//
// Concurrency: several processes write this file — the daemon, the CLI, and one
// review watcher per connected harness. Anything that reads it, changes it and
// writes it back goes through `mutateMeta`, which holds the spec's lock across
// all three steps. `readMeta` + `writeMeta` at a call site is a lost update
// waiting to happen and is only correct where nothing else can be writing.
//
// Shape:
//   { id, title, type, status, origin, attachedSession, heartbeat, tags,
//     collection, project, created, updated }
//
// `project` and `collection` together are the spec's address on the home page.
// Both default to null and both are read as `m.project || null`, so a meta.json
// written before either field existed needs no migration and no repair pass.

import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { specDir, metaPath, metaLockPath, specsDir, isReservedId } from './store-paths.mjs';
import { isSpecType } from './spec-types.mjs';
import { withFileLock } from './file-lock.mjs';

// The kind list moved to lib/spec-types.mjs, where it is the built-in table plus
// whatever the store adds. `SPEC_TYPES` is gone rather than deprecated: it was a
// module-level array, and a reader that kept using it would silently validate
// against six kinds forever instead of failing (spec 45395008a2, D7). Ask
// `specTypes()` for the list and `isSpecType()` for one answer.
//
// spec-types.mjs reads the filesystem and imports nothing from here, which is
// what keeps this import one-way.

// What a NEW spec gets when nothing else fits: the general shell (scaffold only,
// one TL;DR section, sections decided per use case). It is the last resort, not a
// preference — a request that reads as design / research / impl still picks that
// type. It also catches an unknown --type, so a typo scaffolds a usable spec
// rather than an implementation plan nobody asked for.
export const DEFAULT_TYPE = 'general';

// What an EXISTING spec with no type field is read as. Untyped specs predate the
// field and were all authored in the design-impl shape (stages, tracker, Runtime),
// so reading them as DEFAULT_TYPE would relabel them and misreport what they hold.
// Separate from DEFAULT_TYPE on purpose: one is for writing, one is for reading.
export const LEGACY_TYPE = 'design-impl';

/** A fresh meta object for a new spec (status draft, unattached). */
export function defaultMeta({ id, title, origin = null, type = DEFAULT_TYPE }) {
  const now = Date.now();
  return {
    id,
    title: title || 'Untitled',
    type: isSpecType(type) ? type : DEFAULT_TYPE,
    status: 'draft',
    origin,
    attachedSession: null,
    heartbeat: 0,
    tags: [],
    collection: null,
    project: null,
    created: now,
    updated: now,
  };
}

/** Read a spec's meta.json, or null if it doesn't exist / is unreadable. */
export function readMeta(id) {
  try {
    return JSON.parse(readFileSync(metaPath(id), 'utf8'));
  } catch {
    return null;
  }
}

/** Write a spec's meta.json (plain write; bumps `updated`). */
export function writeMeta(id, meta) {
  mkdirSync(specDir(id), { recursive: true });
  const out = { ...meta, updated: Date.now() };
  writeFileSync(metaPath(id), JSON.stringify(out, null, 2));
  return out;
}

/**
 * Read-modify-write meta.json under the spec's lock.
 *
 * `readMeta` then `writeMeta` at a call site is a lost update waiting to happen:
 * meta.json has several writers across two processes, and whichever writes
 * second overwrites the first's whole file with a snapshot taken before it.
 *
 * A lock only one writer takes is not a lock, so this exists to be the one way
 * the field is changed. `fn` receives the meta read INSIDE the lock and returns
 * the version to write; returning null or undefined writes nothing.
 *
 * Not used for the watcher beat, which needs to write without bumping `updated`
 * (a beat is not an edit to the document) and takes the same lock itself.
 */
export function mutateMeta(id, fn) {
  return withFileLock(metaLockPath(id), () => {
    const meta = readMeta(id);
    if (!meta) return null;
    const next = fn(meta);
    return next ? writeMeta(id, next) : meta;
  });
}

/** All store specs' meta objects (skips dirs without a readable meta.json). */
export function listSpecs() {
  const root = specsDir();
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    // A reserved entry has a meta.json so the comments API works on it; this is
    // what keeps it out of the index, the counts and every picker.
    if (isReservedId(e.name)) continue;
    if (!existsSync(join(root, e.name, 'meta.json'))) continue;
    const meta = readMeta(e.name);
    if (meta) out.push(meta);
  }
  return out;
}

/**
 * Spec ids carrying this type, excluding template specs.
 *
 * Read before a kind is deleted: removing one that specs still carry would leave
 * their `type` naming nothing, and defaultMeta would read them as `general` on
 * the next write, changing their shape without anyone asking (I6).
 *
 * Template specs are excluded because a kind's own template carries the kind.
 * Counting it would make every kind permanently in use by itself, and nothing
 * would ever be deletable.
 */
export function specsOfType(type) {
  return listSpecs()
    .filter((m) => m.type === type && !m.template)
    .map((m) => m.id);
}
