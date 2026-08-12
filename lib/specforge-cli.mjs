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
import { resolve } from 'node:path';
import { createSpec, specHtmlPath } from './store.mjs';
import { templateHtmlFor } from './store-templates.mjs';
import { listSpecs, readMeta, SPEC_TYPES, DEFAULT_TYPE } from './meta.mjs';
import { attach, detach, specsForSession, heartbeat } from './attach.mjs';
import { ensureDaemon as realEnsureDaemon, specUrl } from './daemon-client.mjs';
import { loadComments, addComment, mutateComments } from './store-comments.mjs';
import { listPendingForSpec, markBatchDone, advanceBatchProgress } from './store-inbox.mjs';
import { markExportWorking, finishExport } from './store-export.mjs';
import { setStatus } from './lifecycle.mjs';

// Scaffolding source: the store's per-type template spec when present (edited
// through SpecForge itself), else the bundled shell — see store-templates.mjs.

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
  const html = templateHtmlFor(type);
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
  // A watcher with no session identity can never match a spec — fail loudly
  // instead of silently polling nothing until timeout (a detached background
  // process may lack the env var; pass --session <id> there).
  if (!session) {
    throw new Error('wait-batch: no session id (CLAUDE_CODE_SESSION_ID unset) — pass --session <id>');
  }
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
    heartbeat(session);
    const pending = specsForSession(session).flatMap((id) =>
      listPendingForSpec(id).map((b) => ({ specId: id, batchId: b.batchId })));
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

/**
 * Publish a spec on a public URL, or return the one it already has.
 *
 * The daemon owns the listener and the tunnel, so a publication survives this
 * command exiting and shows up in `shares` from any terminal.
 */
export async function cmdShare({ id, rotate = false } = {}, deps = {}) {
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  if (!id) throw new Error('share: <id> required');
  if (!readMeta(id)) throw new Error(`share: unknown spec ${id}`);
  const { url } = await ensure();
  const r = await fetch(new URL(`/api/spec/${id}/share`, url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rotate: !!rotate }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `share failed (${r.status})`);
  return { ok: true, id, url: body.share.url, share: body.share };
}

/** Take a spec's public URL down. The link dies for everyone holding it. */
export async function cmdUnshare({ id } = {}, deps = {}) {
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  if (!id) throw new Error('unshare: <id> required');
  const { url } = await ensure();
  const r = await fetch(new URL(`/api/spec/${id}/share`, url), { method: 'DELETE' });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `unshare failed (${r.status})`);
  return { ok: true, id, wasPublished: body.wasPublished };
}

/**
 * Point publishing at an origin someone else serves, or hand the tunnel back.
 *
 * With no argument this prints the current setting. The daemon reads it at
 * startup, so it has to be restarted for a change to take effect, which the
 * result says rather than leaving it to be discovered.
 */
export async function cmdOrigin({ url, clear = false } = {}) {
  const { readConfig, setPublicOrigin } = await import('./store-config.mjs');
  if (!url && !clear) {
    const current = readConfig().publicOrigin || null;
    return { publicOrigin: current, managedBy: current ? 'you' : 'specforge' };
  }
  const config = setPublicOrigin(clear ? null : url);
  return {
    ok: true,
    publicOrigin: config.publicOrigin || null,
    managedBy: config.publicOrigin ? 'you' : 'specforge',
    note: 'restart the daemon for this to take effect',
  };
}

/**
 * Take this machine from nothing to a permanent share URL.
 *
 * The manual version is seven steps across a browser, a CLI, a config file and a
 * system service, and it is the first thing a new teammate has to do.
 */
export async function cmdSetupTunnel({ hostname, force = false, installService = false } = {}) {
  const { setupTunnel } = await import('./setup-tunnel.mjs');
  return setupTunnel({ hostname, force, installService });
}

/** What is public right now. With no expiry, this is how a share stays visible. */
export async function cmdShares({} = {}, deps = {}) {
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  const { url } = await ensure();
  const r = await fetch(new URL('/api/shares', url));
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `shares failed (${r.status})`);
  return { shares: body.shares };
}

/** Post a claude reply to a thread (the review flow's append-only reply). */
export async function cmdReply({ id, tid, body } = {}) {
  if (!id || !tid) throw new Error('reply: <id> <threadId> required');
  if (!body) throw new Error('reply: --body required');
  if (!readMeta(id)) throw new Error(`reply: unknown spec ${id}`);
  // Only this path writes agent comments. `kind` is what marks them; the name
  // is display only, so a person called claude cannot reply as the agent.
  const comment = mutateComments(id, (store) => addComment(store, tid, { body, author: 'claude', kind: 'agent' }));
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

/** Mark a queued export as in-progress (the dropdown shows "Exporting…"). */
export async function cmdExportWorking({ id } = {}) {
  if (!id) throw new Error('export-working: <id> required');
  return { ok: markExportWorking(id), id };
}

/** Report an export outcome — the Doc link (--url) or a failure (--error). */
export async function cmdExportDone({ id, url, error } = {}) {
  if (!id) throw new Error('export-done: <id> required');
  if (!url && !error) throw new Error('export-done: --url or --error required');
  const ex = finishExport(id, { url, error });
  return { ok: true, id, export: ex };
}

// --- arg parsing + dispatch ---

/** Flags that stand alone. Everything else takes the next argument as a value. */
export const BOOLEAN_FLAGS = new Set(['clear', 'rotate', 'write', 'force', 'install-service']);

export function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      // A boolean flag is the last word of its command as often as not, and
      // demanding a value for it made `origin --clear` throw before it ran.
      if (BOOLEAN_FLAGS.has(name)) { flags[name] = true; continue; }
      if (i + 1 >= argv.length) throw new Error(`flag --${name} requires a value`);
      flags[name] = argv[++i];
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
  share: (p, f) => cmdShare({ id: p[0], rotate: f.rotate === true || f.rotate === 'true' }),
  unshare: (p) => cmdUnshare({ id: p[0] }),
  shares: () => cmdShares({}),
  origin: (p, f) => cmdOrigin({ url: p[0], clear: f.clear === true || f.clear === 'true' }),
  'setup-tunnel': (p, f) => cmdSetupTunnel({
    hostname: p[0] || f.hostname,
    force: f.force === true || f.force === 'true',
    installService: f['install-service'] === true || f['install-service'] === 'true',
  }),
  reply: (p, f) => cmdReply({ id: p[0], tid: p[1], body: f.body }),
  'batch-done': (p) => cmdBatchDone({ id: p[0], batchId: p[1] }),
  'batch-working': (p) => cmdBatchWorking({ id: p[0], batchId: p[1] }),
  'export-working': (p) => cmdExportWorking({ id: p[0] }),
  'export-done': (p, f) => cmdExportDone({ id: p[0], url: f.url, error: f.error }),
  status: (p) => cmdStatus({ id: p[0], status: p[1] }),
  'wait-batch': (p, f) => cmdWaitBatch({
    timeout: f.timeout != null && Number.isFinite(Number(f.timeout)) ? Number(f.timeout) : undefined,
    interval: f.interval != null && Number.isFinite(Number(f.interval)) ? Number(f.interval) : undefined,
  }, f.session ? { session: f.session } : {}),
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
