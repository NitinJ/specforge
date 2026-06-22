#!/usr/bin/env node
// The `specforge` CLI — the deterministic backend behind the v2 commands
// (design §8). Each spec-producing command ensures the daemon is up and attaches
// the spec to the current Claude session ($CLAUDE_CODE_SESSION_ID). Skills drive
// the authoring (HTML); this CLI owns the store + lock + daemon plumbing.
//
//   specforge create  [--title T] [--origin O] [--type T]   scaffold a store spec
//                                                 (type ∈ design|research|design-impl|impl)
//   specforge import <file> [--title T] [--type T] ingest an existing .html spec
//   specforge open <id>                           attach + return the spec url
//   specforge listall                             every spec: id·title·status·attached
//   specforge list                                specs attached to this session
//   specforge detach <id>                         free a spec from its session
//   specforge comments <id>                       threads + pending batches (review)
//   specforge reply <id> <tid> --body "…"         post a claude reply to a thread
//   specforge batch-working <id> <batchId>        mark a batch as being worked on
//   specforge batch-done <id> <batchId>           clear a processed review batch
//   specforge status <id> <state>                 set lifecycle status (meta + badge)
//   specforge wait-batch [--timeout s] [--interval s]  block until this session has a
//                                                 pending review batch (the auto-watcher)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createSpec, specHtmlPath } from './store.mjs';
import { listSpecs, readMeta, SPEC_TYPES, DEFAULT_TYPE, TYPE_SHELL } from './meta.mjs';
import { attach, detach, specsForSession, heartbeat } from './attach.mjs';
import { ensureDaemon as realEnsureDaemon, specUrl } from './daemon-client.mjs';
import { loadComments, addComment, mutateComments } from './store-comments.mjs';
import { listPendingForSpec, markBatchDone, advanceBatchProgress } from './store-inbox.mjs';
import { setStatus } from './lifecycle.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
// Two shells: impl types (design-impl, impl) get the full Stages/Tasks + live
// tracker + Runtime; doc types (design, research) get a chrome-only shell.
const IMPL_TEMPLATE = join(REPO, 'templates', 'spec-base.html');
const DOC_TEMPLATE = join(REPO, 'templates', 'spec-base-doc.html');
const templateFor = (type) => (TYPE_SHELL[type] === 'doc' ? DOC_TEMPLATE : IMPL_TEMPLATE);

function validateType(cmd, type) {
  if (!SPEC_TYPES.includes(type)) {
    throw new Error(`${cmd}: invalid type "${type}" — one of: ${SPEC_TYPES.join(', ')}`);
  }
}

function sessionId(deps) {
  return deps.session !== undefined ? deps.session : process.env.CLAUDE_CODE_SESSION_ID || '';
}

/** Scaffold a new store spec from the template, attach it to this session. */
export async function cmdCreate({ title, origin = null, type = DEFAULT_TYPE } = {}, deps = {}) {
  validateType('create', type);
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  const html = readFileSync(templateFor(type), 'utf8');
  const { url } = await ensure(); // confirm the daemon before writing any store state
  const id = createSpec({ title, origin, html, type });
  const session = sessionId(deps);
  if (session) attach(id, session);
  return { id, htmlPath: specHtmlPath(id), url: specUrl(url, id), status: 'draft', type };
}

/** Ingest an existing .html spec file into the store, attach it to this session. */
export async function cmdImport({ file, title, type = DEFAULT_TYPE } = {}, deps = {}) {
  if (!file) throw new Error('import: <file> required');
  validateType('import', type);
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  const abs = resolve(file);
  const html = readFileSync(abs, 'utf8'); // fail before touching the store/daemon
  const { url } = await ensure();
  const id = createSpec({ title, origin: abs, html, type }); // import keeps the source html; type is metadata
  const session = sessionId(deps);
  if (session) attach(id, session);
  return { id, htmlPath: specHtmlPath(id), url: specUrl(url, id), status: 'draft', type };
}

/** Attach an existing spec to this session and return its url (open from index). */
export async function cmdOpen({ id } = {}, deps = {}) {
  if (!id) throw new Error('open: <id> required');
  if (!readMeta(id)) throw new Error(`open: unknown spec ${id}`);
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  const session = sessionId(deps);
  if (session) attach(id, session); // throws if locked by another live session
  const { url } = await ensure();
  return { id, url: specUrl(url, id) };
}

/** Ensure the daemon is up and return the browser index url (no spec needed). */
export async function cmdStart(_args = {}, deps = {}) {
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  const { url } = await ensure();
  return { url };
}

/**
 * Block until any spec attached to this session has a pending review batch, then
 * return `{ ready: true, pending }`. The review watcher runs this as a background
 * task; its completion wakes the session, which reviews the pending specs and
 * relaunches the watcher. Bounded by `timeout` so a long idle never hangs the
 * task — on timeout it returns `{ ready: false, pending: [] }` and the caller re-arms.
 */
export async function cmdWaitBatch({ timeout = 1200, interval = 15 } = {}, deps = {}) {
  const session = sessionId(deps);
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const clock = deps.now || (() => Date.now());
  // Guard non-finite values (e.g. a bad --timeout/--interval) — a NaN deadline
  // would make `clock() >= deadline` forever false and poll without ever exiting.
  const maxMs = (Number.isFinite(timeout) ? timeout : 1200) * 1000;
  const everyMs = (Number.isFinite(interval) ? interval : 15) * 1000;
  const deadline = clock() + maxMs;
  for (;;) {
    // Each poll bumps the owned specs' heartbeat — so the watcher running keeps the
    // session "live" (and its lock fresh) even across idle turns, and the browser's
    // live/disconnected reflects an actually-alive session, not just turn activity.
    if (session) heartbeat(session);
    const pending = session
      ? specsForSession(session).flatMap((id) =>
        listPendingForSpec(id).map((b) => ({ specId: id, batchId: b.batchId })))
      : [];
    if (pending.length) return { ready: true, pending };
    if (clock() >= deadline) return { ready: false, pending: [] };
    await sleep(everyMs);
  }
}

function row(meta) {
  return {
    id: meta.id,
    title: meta.title,
    type: meta.type || DEFAULT_TYPE,
    status: meta.status,
    attached: meta.attachedSession || 'free',
  };
}

/** Every spec in the store. */
export async function cmdListall(_args = {}, deps = {}) {
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  const { url } = await ensure();
  // Include this session so the picker can classify rows: free / attached here / held elsewhere.
  return { rows: listSpecs().map(row), indexUrl: url, session: sessionId(deps) };
}

/** Specs attached to this session. */
export async function cmdList(_args = {}, deps = {}) {
  const session = sessionId(deps);
  const rows = specsForSession(session).map((id) => row(readMeta(id))).filter(Boolean);
  return { session, rows };
}

/** Free a spec from whatever session owns it. */
export async function cmdDetach({ id } = {}, deps = {}) {
  if (!id) throw new Error('detach: <id> required');
  if (!readMeta(id)) throw new Error(`detach: unknown spec ${id}`);
  detach(id);
  return { ok: true, id };
}

/** Threads + pending review batches for a spec (drives review-spec). */
export async function cmdComments({ id } = {}) {
  if (!id) throw new Error('comments: <id> required');
  if (!readMeta(id)) throw new Error(`comments: unknown spec ${id}`);
  return {
    specId: id,
    htmlPath: specHtmlPath(id),
    threads: loadComments(id).threads,
    pending: listPendingForSpec(id),
  };
}

/** Post a claude reply to a thread (the review flow's append-only reply). */
export async function cmdReply({ id, tid, body } = {}) {
  if (!id || !tid) throw new Error('reply: <id> <threadId> required');
  if (!body) throw new Error('reply: --body required');
  if (!readMeta(id)) throw new Error(`reply: unknown spec ${id}`);
  const comment = mutateComments(id, (store) => addComment(store, tid, { body, author: 'claude' }));
  return { ok: true, comment };
}

/** Clear a processed review batch so the drain layer stops surfacing it. */
export async function cmdBatchDone({ id, batchId } = {}) {
  if (!id || !batchId) throw new Error('batch-done: <id> <batchId> required');
  return { ok: markBatchDone(id, batchId), id, batchId };
}

/** Mark a batch as actively being worked on (the action button shows "Working on comments"). */
export async function cmdBatchWorking({ id, batchId } = {}) {
  if (!id || !batchId) throw new Error('batch-working: <id> <batchId> required');
  return { ok: advanceBatchProgress(id, batchId, 'working'), id, batchId };
}

/** Set a spec's lifecycle status (draft/in_review/approved/implementing/done/closed). */
export async function cmdStatus({ id, status } = {}) {
  if (!id || !status) throw new Error('status: <id> <state> required');
  const meta = setStatus(id, status); // validates state + spec existence
  return { ok: true, id, status: meta.status };
}

// --- arg parsing + dispatch ---

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      if (i + 1 >= argv.length) throw new Error(`flag --${a.slice(2)} requires a value`);
      flags[a.slice(2)] = argv[++i];
    } else positional.push(a);
  }
  return { positional, flags };
}

const COMMANDS = {
  create: (p, f) => cmdCreate({ title: f.title, origin: f.origin, type: f.type }),
  import: (p, f) => cmdImport({ file: p[0], title: f.title, type: f.type }),
  open: (p) => cmdOpen({ id: p[0] }),
  start: () => cmdStart(),
  listall: () => cmdListall(),
  list: () => cmdList(),
  detach: (p) => cmdDetach({ id: p[0] }),
  comments: (p) => cmdComments({ id: p[0] }),
  reply: (p, f) => cmdReply({ id: p[0], tid: p[1], body: f.body }),
  'batch-done': (p) => cmdBatchDone({ id: p[0], batchId: p[1] }),
  'batch-working': (p) => cmdBatchWorking({ id: p[0], batchId: p[1] }),
  status: (p) => cmdStatus({ id: p[0], status: p[1] }),
  'wait-batch': (p, f) => cmdWaitBatch({
    timeout: f.timeout != null && Number.isFinite(Number(f.timeout)) ? Number(f.timeout) : undefined,
    interval: f.interval != null && Number.isFinite(Number(f.interval)) ? Number(f.interval) : undefined,
  }),
};

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const fn = COMMANDS[cmd];
  if (!fn) {
    process.stderr.write(`specforge: unknown command ${cmd || '(none)'}\n` +
      `commands: ${Object.keys(COMMANDS).join(', ')}\n`);
    process.exit(2);
  }
  const { positional, flags } = parseArgs(rest);
  try {
    const result = await fn(positional, flags);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (err) {
    process.stderr.write(`specforge ${cmd}: ${err.message}\n`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
