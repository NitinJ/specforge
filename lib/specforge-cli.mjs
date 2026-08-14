#!/usr/bin/env node
// The `specforge` CLI — the deterministic backend behind the v2 commands
// (design §8). Each spec-producing command ensures the daemon is up and attaches
// the spec to the current Claude session ($CLAUDE_CODE_SESSION_ID). Skills drive
// the authoring (HTML); this CLI owns the store + lock + daemon plumbing.
//
//   specforge create  [--title T] [--origin O] [--type T]   scaffold a store spec
//                            (type ∈ general|design|research|design-impl|impl|deck;
//                             general is the default: scaffold only, sections per use case)
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
//   specforge export-md <id> [--out path] [--zip] render the spec as GFM markdown
//                                                 (+ a <name>.assets/ dir for diagrams,
//                                                  or one <name>.zip with --zip)
//   specforge import-md <file> [--title T] [--type T]  convert a .md into a NEW spec
//                                                 (never writes over an existing one)
//   specforge wait-batch [--timeout s] [--interval s]  block until this session has a
//                                                 pending review batch (the auto-watcher)

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createSpec, specHtmlPath } from './store.mjs';
import { templateHtmlFor } from './store-templates.mjs';
import { listSpecs, readMeta, SPEC_TYPES, DEFAULT_TYPE, LEGACY_TYPE } from './meta.mjs';
import {
  attach, detach, specsForSession, heartbeat, setWatcher, clearWatcher, HEARTBEAT_MS,
} from './attach.mjs';
import { ensureDaemon as realEnsureDaemon, specUrl } from './daemon-client.mjs';
import { loadComments, addComment, mutateComments } from './store-comments.mjs';
import { listPendingForSpec, markBatchDone, advanceBatchProgress } from './store-inbox.mjs';
import { WATCH_CMD } from './store-drain.mjs';
import { markExportWorking, finishExport } from './store-export.mjs';
import { exportMd, importMd } from './store-md.mjs';
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
  // Stamped here rather than trusted from the shell. The shell comes from the
  // store's template spec when one exists, and that copy can be older than the
  // library; stamping the scaffold means a new spec carries the current version
  // whatever it was built from.
  //
  // A deck is not stamped: its shell still defines 18 of the library's classes,
  // so a stamped deck would carry two definitions of a card. Stage 7 reconciles
  // them, and the exclusion lives beside the template list it mirrors.
  const { stampHtml } = await import('./components-stamp.mjs');
  const { stampsAtCreate } = await import('./components-build.mjs');
  const shell = templateHtmlFor(type);
  const html = stampsAtCreate(type) ? stampHtml(shell, { force: true }) : shell;
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
 * relaunches the watcher.
 *
 * It does NOT give up on an idle spec. It used to stop after twenty minutes and
 * wait to be relaunched, which only happened when the session next took a turn —
 * so an idle-but-open session went deaf, and comments submitted into it sat
 * unread with the page still calling the spec connected. A watcher that stops
 * listening because nothing has happened yet has the failure exactly backwards.
 *
 * What ends it instead is its session going away. The process is a descendant of
 * the `claude` process that launched it, so when that exits this is reparented
 * and its ppid changes — which is checked every poll. A watcher outliving its
 * session would be worse than one that dies too early: it would go on beating,
 * and the spec would claim to be listening with nobody home. When it does die
 * the spec reads disconnected, and Reconnect moves it to a live session.
 *
 * `timeout` (seconds) still bounds a run when a caller asks for it — tests do,
 * and it is the escape hatch for a watcher you want to stop on its own. Omitted,
 * there is no deadline.
 */
export async function cmdWaitBatch({ timeout = null, interval = HEARTBEAT_MS / 1000 } = {}, deps = {}) {
  const session = sessionId(deps);
  // A watcher with no session identity can never match a spec — fail loudly
  // instead of silently polling nothing (a detached background process may lack
  // the env var; pass --session <id> there).
  if (!session) {
    throw new Error('wait-batch: no session id (CLAUDE_CODE_SESSION_ID unset) — pass --session <id>');
  }
  const sleep = deps.sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  const clock = deps.now || (() => Date.now());
  // Only a finite timeout makes a deadline. A non-finite one (a bad --timeout)
  // is treated as absent rather than as NaN, which would compare false forever.
  const bounded = timeout != null && Number.isFinite(timeout);
  const deadline = bounded ? clock() + timeout * 1000 : Infinity;
  // Capped at the beat, never slower. The browser calls a spec disconnected two
  // beats after the last one, so a watcher polling less often than that would
  // report itself absent while it was running and perfectly able to pick the
  // next batch up. Polling faster is fine and stays the caller's choice.
  const asked = (Number.isFinite(interval) ? interval : HEARTBEAT_MS / 1000) * 1000;
  const everyMs = Math.min(asked, HEARTBEAT_MS);
  const ppid = deps.ppid || (() => process.ppid);
  const launchedUnder = ppid();
  // Announce the process, and stop announcing it however this ends. The Stop
  // hook asks whether a watcher is RUNNING, which the heartbeat cannot answer at
  // the moment of handover: this exits to deliver a batch, leaving a beat that
  // stays fresh for another half minute with nothing behind it.
  setWatcher(session, deps.pid ? deps.pid() : process.pid);
  try {
    return await watchLoop();
  } finally {
    clearWatcher(session);
  }

  async function watchLoop() {
  for (;;) {
    // Each poll beats. This loop IS the thing that picks a batch up while the
    // session is idle, so its beat is the only honest answer to "would comments
    // submitted right now reach an agent" — which is what the browser shows.
    heartbeat(session);
    const pending = specsForSession(session).flatMap((id) =>
      listPendingForSpec(id).map((b) => ({ specId: id, batchId: b.batchId })));
    // Delivering is how this process ends, so every pickup costs the session its
    // watcher. `next` says so at the one moment the agent is certain to be
    // reading — this return is what woke it — rather than relying on it having
    // the skill's last step in mind.
    if (pending.length) {
      return {
        ready: true,
        pending,
        next: `Run the specforge:review-spec skill for each pending spec, then re-arm this watcher in the background: ${WATCH_CMD}`,
      };
    }
    // Reparented: whatever launched this is gone, so the session is too. Stop
    // beating rather than keep a dead session's specs looking connected.
    if (ppid() !== launchedUnder) return { ready: false, pending: [], reason: 'session-ended' };
    if (clock() >= deadline) return { ready: false, pending: [], reason: 'timeout' };
    await sleep(everyMs);
  }
  }
}

function row(meta) {
  return {
    id: meta.id,
    title: meta.title,
    type: meta.type || LEGACY_TYPE,
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

/** Set a spec's lifecycle status (draft or approved). */
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

/**
 * Render a spec as markdown on disk. Local and synchronous: unlike the Google
 * Docs export this needs no session relay, because nothing outside the process
 * has to run.
 */
export async function cmdExportMd({ id, out, exportedAt, zip } = {}) {
  if (!id) throw new Error('export-md: <id> required');
  return exportMd(id, { out, exportedAt, zip });
}

/**
 * Convert a markdown file into a NEW spec, attached to this session.
 *
 * Deterministic: no model runs here, which is what makes it testable and usable
 * headless. The convert-spec skill layers the agent pass on top of the result.
 */
export async function cmdImportMd({ file, title, type, date, owner } = {}, deps = {}) {
  if (!file) throw new Error('import-md: <file> required');
  if (type) validateType('import-md', type);
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  const { url } = await ensure();
  const result = importMd(file, { title, type, date, owner });
  const session = sessionId(deps);
  if (session) attach(result.id, session);
  return { ...result, url: specUrl(url, result.id) };
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
export const BOOLEAN_FLAGS = new Set(['clear', 'rotate', 'write', 'force', 'install-service', 'zip', 'all', 'plan', 'dry']);

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

/**
 * `components <sub>`: build, sync, migrate.
 *
 * `migrate` is the only one that takes a spec apart, so it has a plan mode. The
 * agent pass runs `--plan` to read the blocks the codemod could not type, then
 * re-runs with `--assign <file>` carrying its decisions. A plain run finalizes
 * with the classifier's defaults rather than stopping, per design §12.
 */
async function cmdComponents({ sub, id, all, force, plan, dry, assign }) {
  const { cmdComponentsBuild } = await import('./components-build.mjs');
  const { syncSpec, syncAll } = await import('./components-stamp.mjs');
  // Null-prototype, so a name off Object.prototype is not a subcommand:
  // `components constructor` used to resolve and exit 0 printing {}.
  const subs = Object.assign(Object.create(null), {
    build: () => cmdComponentsBuild(),
    sync: () => {
      if (all) return syncAll({ force });
      if (!id) throw new Error('sync needs a spec id, or --all');
      return syncSpec(id, { force });
    },
    migrate: async () => {
      if (!id) throw new Error('migrate needs a spec id');
      const { assertSpecId } = await import('./store-paths.mjs');
      assertSpecId(id);
      const { migrateSpec, codemod, ambiguousBlocks } = await import('./components-migrate.mjs');
      const { readSpecHtml } = await import('./store.mjs');
      if (plan) {
        // What the agent reads: the codemod applied in memory, and every callout
        // it could not type. Nothing is written, so a plan can be run twice.
        return { id, blocks: ambiguousBlocks(codemod(readSpecHtml(id)).html) };
      }
      let assignments;
      if (assign) {
        const raw = JSON.parse(readFileSync(assign, 'utf8'));
        assignments = raw && raw.assignments ? raw.assignments : raw;
      }
      return migrateSpec(id, { dry, assign: assignments });
    },
  });
  const fn = subs[sub];
  if (!fn) throw new Error(`unknown subcommand ${sub || '(none)'}; expected: ${Object.keys(subs).join(', ')}`);
  return fn();
}

// Null-prototype for the same reason as the components subcommands: `specforge
// constructor` resolved off Object.prototype and exited 0 printing [].
const COMMANDS = Object.assign(Object.create(null), {
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
  'export-md': (p, f) => cmdExportMd({ id: p[0], out: f.out, exportedAt: f.date, zip: f.zip === true }),
  'import-md': (p, f) => cmdImportMd({ file: p[0], title: f.title, type: f.type, date: f.date, owner: f.owner }),
  status: (p) => cmdStatus({ id: p[0], status: p[1] }),
  components: (p, f) => cmdComponents({
    sub: p[0],
    id: p[1],
    all: f.all === true || f.all === 'true',
    force: f.force === true || f.force === 'true',
    plan: f.plan === true || f.plan === 'true',
    dry: f.dry === true || f.dry === 'true',
    assign: f.assign,
  }),
  'wait-batch': (p, f) => cmdWaitBatch({
    timeout: f.timeout != null && Number.isFinite(Number(f.timeout)) ? Number(f.timeout) : undefined,
    interval: f.interval != null && Number.isFinite(Number(f.interval)) ? Number(f.interval) : undefined,
  }, f.session ? { session: f.session } : {}),
});

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
