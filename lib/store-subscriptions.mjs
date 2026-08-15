// Subscriptions to other people's shared projects, at
// <STORE_ROOT>/subscriptions.json.
//
// A subscription is a pointer — {name, origin, token} — and never content: the
// Shared-with-me rail it feeds links out to the owner's origin, so nothing is
// mirrored, synced, or merged. Joining appends here, leaving removes, and the
// index reads the file per render. The name is display-only, refreshed from the
// remote's public meta whenever the rail can reach it.

import {
  mkdirSync, readFileSync, writeFileSync, renameSync, openSync, closeSync, rmSync, statSync,
} from 'node:fs';
import { storeRoot, subscriptionsPath } from './store-paths.mjs';
import { isToken } from './tokens.mjs';

/** How many subscriptions the file will hold, and how long a name may be. */
const MAX_SUBS = 100;
const MAX_NAME = 60;

/** An origin a card may link to: http(s), no path, no credentials. */
function validOrigin(raw) {
  try {
    const u = new URL(raw);
    return (u.protocol === 'https:' || u.protocol === 'http:')
      && u.username === '' && u.password === ''
      && u.pathname === '/' && !u.search && !u.hash;
  } catch {
    return false;
  }
}

/**
 * A project share URL, taken apart.
 *
 * Exactly `<origin>/p/<token>` (a trailing slash tolerated): a spec share, a
 * deep link into the project, or anything else is null, so a paste of the wrong
 * link fails at join time rather than as a card that never loads.
 *
 * @returns {{origin:string, token:string}|null}
 */
export function parseShareUrl(raw) {
  let u;
  try {
    u = new URL(String(raw));
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  const m = u.pathname.match(/^\/p\/([^/]+)\/?$/);
  if (!m || !isToken(m[1])) return null;
  return { origin: u.origin, token: m[1] };
}

function sanitize(rec) {
  if (!rec || typeof rec !== 'object') return null;
  if (!isToken(rec.token) || !validOrigin(rec.origin)) return null;
  const name = String(rec.name || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return {
    name: name || 'Shared project',
    origin: new URL(rec.origin).origin,
    token: rec.token,
    addedAt: typeof rec.addedAt === 'string' ? rec.addedAt : '',
  };
}

/** Every subscription, sanitized. Unknown shapes and corrupt files read as []. */
export function readSubscriptions() {
  try {
    const raw = JSON.parse(readFileSync(subscriptionsPath(), 'utf8'));
    if (!Array.isArray(raw)) return [];
    return raw.map(sanitize).filter(Boolean).slice(0, MAX_SUBS);
  } catch {
    return [];
  }
}

/** Atomic write (temp + rename), so a reader never sees a torn file. */
function writeAll(subs) {
  mkdirSync(storeRoot(), { recursive: true });
  const tmp = `${subscriptionsPath()}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(subs, null, 2));
  renameSync(tmp, subscriptionsPath());
}

const LOCK_STALE_MS = 5000;
const LOCK_WAIT_MS = 3000;
const LOCK_RETRY_MS = 20;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Run `fn` under an exclusive lock — the O_EXCL lockfile discipline
 * comments.json uses (lib/store-comments.mjs), with one deliberate difference:
 * exceeding the wait budget throws instead of proceeding unlocked.
 *
 * `withCommentsLock` degrades to a best-effort write because its caller is a
 * request handler inside the daemon, where hanging or failing a reviewer's
 * comment is worse than a rare lost update. Nothing here has that shape: join
 * and leave are one-shot CLI commands, so refusing costs the user one re-run
 * and never silently drops a subscription someone else just added. A stale
 * lock from a dead holder is still reclaimed, so a crash cannot wedge the file.
 */
function withSubscriptionsLock(fn) {
  mkdirSync(storeRoot(), { recursive: true });
  const path = `${subscriptionsPath()}.lock`;
  let fd;
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try { fd = openSync(path, 'wx'); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) { rmSync(path, { force: true }); continue; }
      } catch { continue; }
      if (Date.now() >= deadline) {
        throw new Error('subscriptions.json is locked by another specforge process; try again');
      }
      sleepSync(LOCK_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    try { closeSync(fd); } catch { /* already closed */ }
    try { rmSync(path, { force: true }); } catch { /* already gone */ }
  }
}

/**
 * Add a subscription, or refresh the name of one already held.
 *
 * Keyed by origin+token: joining the same project twice is what someone does
 * when they lost track, and it must not produce two cards.
 */
export function addSubscription({ name, origin, token }) {
  const rec = sanitize({ name, origin, token, addedAt: new Date().toISOString() });
  if (!rec) throw new Error('join: not a usable subscription (origin or token malformed)');
  return withSubscriptionsLock(() => {
    const subs = readSubscriptions();
    const existing = subs.find((s) => s.origin === rec.origin && s.token === rec.token);
    if (existing) {
      existing.name = rec.name;
    } else {
      if (subs.length >= MAX_SUBS) throw new Error(`join: subscription limit (${MAX_SUBS}) reached`);
      subs.push(rec);
    }
    writeAll(subs);
    return rec;
  });
}

/**
 * Remove by URL, token, or display name — whichever the caller still has.
 *
 * A URL or token names exactly one subscription. A display name may not (two
 * unreachable joins both default to "Shared project"), and removing every
 * match would delete projects the caller did not name, so an ambiguous name
 * is refused with the distinguishing tokens in the message.
 *
 * @returns {boolean} whether anything was removed
 */
export function removeSubscription(key) {
  return withSubscriptionsLock(() => {
    const parsed = parseShareUrl(key);
    const subs = readSubscriptions();
    const matches = subs.filter((s) => {
      if (parsed) return s.origin === parsed.origin && s.token === parsed.token;
      if (isToken(key)) return s.token === key;
      return s.name === String(key || '').replace(/\s+/g, ' ').trim();
    });
    if (!matches.length) return false;
    if (matches.length > 1) {
      throw new Error(`leave: ${matches.length} subscriptions are named "${matches[0].name}"; `
        + `name one by token instead: ${matches.map((s) => s.token).join(', ')}`);
    }
    writeAll(subs.filter((s) => s !== matches[0]));
    return true;
  });
}
