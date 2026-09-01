#!/usr/bin/env node
// The `specforge` CLI — the deterministic backend behind the v2 commands
// (design §8). Each spec-producing command ensures the daemon is up and attaches
// the spec to the current Claude session ($CLAUDE_CODE_SESSION_ID). Skills drive
// the authoring (HTML); this CLI owns the store + lock + daemon plumbing.
//
//   specforge create  [--title T] [--origin O] [--type T] [--project P]
//                                                          scaffold a store spec
//                                                          (--project defaults to
//                                                          the selected project)
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
//   specforge share-project <name> [--rotate]     publish a project at /p/<token>
//   specforge unshare-project <name>              take a project's public URL down
//   specforge join <url> [--name N]               subscribe to a shared project
//   specforge leave <url|token|name>              drop a subscription
//   specforge contribute <id> <projectUrl>        list your spec in their project
//   specforge withdraw <id> <projectUrl>          take it back out
//   specforge prune <project> <token>             drop an entry from your project

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSpec, specHtmlPath } from './store.mjs';
import { templateHtmlFor, templatePrompts } from './store-templates.mjs';
import { stripTemplateBlocks } from './rules/template-blocks.mjs';
import { listSpecs, readMeta, DEFAULT_TYPE, LEGACY_TYPE } from './meta.mjs';
import { specTypes, isSpecType } from './spec-types.mjs';
import {
  attach, detach, specsForSession, heartbeat, setWatcher, clearWatcher, HEARTBEAT_MS,
} from './attach.mjs';
import { ensureDaemon as realEnsureDaemon, specUrl } from './daemon-client.mjs';
import { loadComments, addComment, mutateComments } from './store-comments.mjs';
import { listPendingForSpec, markBatchDone, advanceBatchProgress } from './store-inbox.mjs';
import { WATCH_CMD } from './store-drain.mjs';
import { markExportWorking, finishExport } from './store-export.mjs';
import { finishGenerate } from './store-generate.mjs';
import { exportMd, importMd } from './store-md.mjs';
import { setStatus } from './lifecycle.mjs';

// Scaffolding source: the store's per-type template spec when present (edited
// through SpecForge itself), else the bundled shell — see store-templates.mjs.

function validateType(cmd, type) {
  if (!isSpecType(type)) {
    throw new Error(`${cmd}: invalid type "${type}" — one of: ${specTypes().join(', ')}`);
  }
}

function sessionId(deps) {
  return deps.session !== undefined
    ? deps.session
    : process.env.SPECFORGE_SESSION_ID || process.env.CLAUDE_CODE_SESSION_ID || '';
}

/**
 * Which project a new spec is filed into.
 *
 * An absent flag inherits the project the home page is showing, so a spec an
 * agent creates while you are working inside one lands there rather than
 * unfiled. `--project ""` is how you say "nowhere" over the top of that, and
 * All projects (no stored selection) is nowhere by definition.
 */
async function projectForNewSpec(project) {
  const { sanitizeProject } = await import('./organize.mjs');
  if (project !== undefined) return sanitizeProject(project);
  const { readGlobalPrefs } = await import('./global-prefs.mjs');
  return sanitizeProject(readGlobalPrefs().project);
}

/** Scaffold a new store spec from the template, attach it to this session. */
export async function cmdCreate({ title, origin = null, type = DEFAULT_TYPE, project } = {}, deps = {}) {
  validateType('create', type);
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  // Stamped here rather than trusted from the shell. The shell comes from the
  // store's template spec when one exists, and that copy can be older than the
  // library; stamping the scaffold means a new spec carries the current version
  // whatever it was built from.
  const { stampHtml } = await import('./components-stamp.mjs');
  const { stampsAtCreate } = await import('./components-build.mjs');
  const shell = templateHtmlFor(type);
  // The prompts are read before the strip and returned to the caller: the
  // guidance reaches the agent, and the file it authors into never carries it.
  const prompts = templatePrompts(type);
  const stripped = stripTemplateBlocks(shell);
  const html = stampsAtCreate(type) ? stampHtml(stripped, { force: true }) : stripped;
  const proj = await projectForNewSpec(project);
  const { url } = await ensure(); // confirm the daemon before writing any store state
  const id = createSpec({ title, origin, html, type });
  if (proj) {
    const { readMeta, writeMeta } = await import('./meta.mjs');
    const meta = readMeta(id);
    meta.project = proj;
    writeMeta(id, meta);
  }
  const session = sessionId(deps);
  if (session) attach(id, session);
  // The writing contract rides beside the section prompts: both are guidance
  // the agent needs before it writes. This is the contract in force, not the
  // user's edits to it, because the agent has to be handed the rules it must
  // follow and not a diff against a file it is no longer told to read.
  const { languageContract } = await import('./language-contract.mjs');
  const language = languageContract();
  // The skeleton replaces the whole-file read (spec 3067be852a, R3): the tool
  // wrote the shell, so it knows where every section and placeholder sits.
  // Per-section reads via spec-nav fill the blanks; the style block, the TOC and
  // the ids never need re-reading because the agent never touches them.
  const { sections } = await import('./spec-nav.mjs');
  const htmlPath = specHtmlPath(id);
  const written = readFileSync(htmlPath, 'utf8');
  const skeleton = sections(written).map((s) => ({
    id: s.id,
    lines: `${s.lineStart}-${s.lineEnd}`,
    title: s.header,
    fills: (s.html.match(/\{\{[^}]*\}\}/g) || []).slice(0, 8),
  }));
  return {
    id,
    htmlPath,
    url: specUrl(url, id),
    status: 'draft',
    type,
    project: proj,
    language,
    prompts,
    skeleton,
  };
}

/** Ingest an existing .html spec file into the store, attach it to this session. */
export async function cmdImport({ file, title, type = DEFAULT_TYPE } = {}, deps = {}) {
  if (!file) throw new Error('import: <file> required');
  validateType('import', type);
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  const abs = resolve(file);
  // Stripped on the way in as well: importing a file that happens to carry a
  // rules block or a prompt must not smuggle authoring scaffolding into a spec.
  const html = stripTemplateBlocks(readFileSync(abs, 'utf8')); // fail before touching the store/daemon
  const { url } = await ensure();
  const id = createSpec({ title, origin: abs, html, type }); // import keeps the source html; type is metadata
  const session = sessionId(deps);
  if (session) attach(id, session);
  // Carried for the same reason import-md carries it: the convert-spec skill
  // edits what lands here, and that is authoring.
  const { languageContract } = await import('./language-contract.mjs');
  return {
    id, htmlPath: specHtmlPath(id), url: specUrl(url, id), status: 'draft', type,
    language: languageContract(),
  };
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
    throw new Error('wait-batch: no session id (SPECFORGE_SESSION_ID / CLAUDE_CODE_SESSION_ID unset) — pass --session <id>');
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
        next: `Run the review-spec skill for each pending spec, then re-arm this watcher in the background: ${WATCH_CMD}`,
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

/**
 * One line per spec: the default list/listall output (spec 3067be852a, R2).
 * The machine shape stays behind --json; a browse rarely needs 49 tokens of
 * pretty-printed JSON per row when five fields on one line carry the decision.
 * The session rides in as context, not as a column: `attached` renders `mine`
 * when it names the calling session, so the picker can classify rows from the
 * compact lines alone (greptile PR 256: dropping the session id broke the
 * detach flow's mine-vs-held-elsewhere read).
 */
export function formatRowsCompact(rows, session = '') {
  return rows.map((r) => [
    r.id,
    r.status,
    r.type,
    session && r.attached === session ? 'mine' : (r.attached || 'free'),
    r.title,
  ].join('  ')).join('\n');
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

/**
 * Threads + pending review batches for a spec (drives review-spec).
 *
 * Batch-scoped by default: the payload carries only the threads named in the
 * spec's pending batches. Resolved history and discussion threads are exactly
 * what review-spec is told to leave alone, so shipping them made every pickup
 * pay O(spec history) for O(batch) work (spec 3067be852a, R1): 61.6KB on the
 * store's most-reviewed spec where 6.6KB does the same job. `--all` restores
 * the full dump for the flows that genuinely want history.
 *
 * Every thread carries its resolved `actions`. That is not decoration: an action
 * arrives in the body as a bare token reading like ordinary English, and leaving
 * the expansion as something the agent must look up in a skill file failed four
 * times out of four. The instruction, the command and what not to do ride on the
 * thread the agent is already reading.
 */
export async function cmdComments({ id, all = false } = {}) {
  if (!id) throw new Error('comments: <id> required');
  if (!readMeta(id)) throw new Error(`comments: unknown spec ${id}`);
  const { actionsForThread } = await import('./actions/for-thread.mjs');
  const cli = fileURLToPath(import.meta.url);
  const pending = listPendingForSpec(id);
  // Scoped to what is pending. A thread accumulates, so resolving every comment
  // on it would replay an action answered last week: the wake-up text would
  // announce work already done and batch-done would demand a second draft for
  // it. With nothing pending there is no outstanding request to resolve.
  const batchIds = new Set(pending.map((b) => b.batchId));
  // The spec itself, so an @import can be resolved against the aside it answers:
  // what it merges and whether it replaces the section are properties of that
  // aside, not of the action.
  const { readSpecHtml } = await import('./store.mjs');
  const html = readSpecHtml(id);
  // Which blocks still exist, so an aside naming one that has been deleted is
  // not turned into a placement the agent cannot find. Bids live in the registry
  // rather than in the spec, and the registry is derived and disposable: no file
  // means unknown, which leaves the aside's own block standing.
  const { readBlocks } = await import('./store-blocks.mjs');
  const reg = readBlocks(id);
  const bids = reg ? new Set(reg.blocks.map((b) => b.bid)) : undefined;
  const wanted = all ? null : new Set(pending.flatMap((b) => b.threadIds || []));
  const threads = loadComments(id).threads
    .filter((t) => !wanted || wanted.has(t.id))
    .map((t) => {
      const actions = actionsForThread(t, { specId: id, cli, batchIds, html, bids });
      return actions.length ? { ...t, actions } : t;
    });
  // The authoring preamble, carried here as well as at create: a register that
  // switched between the spec body and the replies and asides written into it
  // would read as two authors (spec 094abd0b9d, D8). Empty when unset, which is
  // every store that has not customized it.
  const { languageContract } = await import('./language-contract.mjs');
  const language = languageContract();
  return {
    specId: id,
    htmlPath: specHtmlPath(id),
    language,
    threads,
    pending,
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
  return { shares: body.shares, projects: body.projects || [] };
}

/**
 * Publish a project on a public URL, or return the one it already has.
 *
 * One token covers the whole project: the gateway evaluates membership per
 * request, so a spec created into the project tomorrow is covered by the URL
 * handed out today.
 */
export async function cmdShareProject({ name, rotate = false } = {}, deps = {}) {
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  if (!name) throw new Error('share-project: <name> required');
  const { url } = await ensure();
  const r = await fetch(new URL(`/api/project/${encodeURIComponent(name)}/share`, url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rotate: !!rotate }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `share-project failed (${r.status})`);
  return { ok: true, project: body.share.project, url: body.share.url, share: body.share };
}

/**
 * Subscribe to someone else's shared project.
 *
 * Daemonless on purpose: a subscription is a line in a local file plus one
 * best-effort fetch of the remote's public meta for a display name. The rail
 * refreshes that name on every index load, so joining while the owner's
 * machine is off still works; the card just starts as unreachable.
 */
export async function cmdJoin({ url, name } = {}, deps = {}) {
  const { parseShareUrl, addSubscription } = await import('./store-subscriptions.mjs');
  const parsed = parseShareUrl(url);
  if (!parsed) throw new Error('join: expected a project share URL, <origin>/p/<token>');
  const fetchImpl = deps.fetchImpl || fetch;
  let remoteName = null;
  let reachable = false;
  try {
    const r = await fetchImpl(`${parsed.origin}/p/${parsed.token}/api/meta`, {
      signal: AbortSignal.timeout(5000),
    });
    if (r.ok) {
      const meta = await r.json();
      if (meta && typeof meta.project === 'string') remoteName = meta.project;
      reachable = true;
    }
  } catch { /* the owner's machine is off; the card will say so */ }
  const rec = addSubscription({
    name: name || remoteName || 'Shared project',
    origin: parsed.origin,
    token: parsed.token,
  });
  return { ok: true, ...rec, reachable };
}

/**
 * List one of your specs in someone else's shared project.
 *
 * Two steps on this machine: publish the spec under your own token (the
 * existing share flow, so your daemon serves it and its comments land in your
 * store), then register a pointer with the creator's gateway. No spec content
 * leaves; the creator gets {origin, token, title, owner} and links to you.
 */
export async function cmdContribute({ id, url, owner } = {}, deps = {}) {
  const { contributeSpec } = await import('./contribute.mjs');
  if (!id) throw new Error('contribute: <specId> required');
  const meta = readMeta(id);
  if (!meta) throw new Error(`contribute: unknown spec ${id}`);
  return contributeSpec({
    specId: id,
    projectUrl: url,
    title: meta.title,
    owner,
    // The CLI has no registry of its own; publishing is the daemon's job and it
    // asks over HTTP, which is the only thing that differs from the daemon's
    // own path through contributeSpec.
    share: async () => {
      const mine = await cmdShare({ id }, deps);
      return { token: mine.share && mine.share.token, url: mine.url };
    },
    fetchImpl: deps.fetchImpl || fetch,
  });
}

/**
 * Take your spec back out of someone else's shared project.
 *
 * Withdrawn by the token it was REGISTERED under, which the local record
 * remembers: a rotate since then changed the spec's current token, and the
 * entry over there still names the old one.
 */
export async function cmdWithdraw({ id, url } = {}, deps = {}) {
  const { withdrawSpec } = await import('./contribute.mjs');
  const { readShareToken } = await import('./store-share.mjs');
  if (!id) throw new Error('withdraw: <specId> required');
  return withdrawSpec({
    specId: id,
    projectUrl: url,
    currentToken: () => readShareToken(id),
    fetchImpl: deps.fetchImpl || fetch,
  });
}

/**
 * Drop someone else's entry from a project you created.
 *
 * Local: the entries live in this machine's store, so no daemon or network is
 * involved. The creator's half of D10 — a contributor withdraws their own, and
 * the creator can remove any.
 */
export async function cmdPrune({ name, token } = {}) {
  const { removeContribution } = await import('./store-project-shares.mjs');
  if (!name) throw new Error('prune: <project> required');
  if (!token) throw new Error('prune: <token> required');
  if (!removeContribution(name, token)) {
    throw new Error(`prune: no contribution with token ${token} in ${name}`);
  }
  return { ok: true, project: name, token };
}

/** Drop a subscription, by URL, token, or display name. */
export async function cmdLeave({ key } = {}) {
  const { removeSubscription } = await import('./store-subscriptions.mjs');
  if (!key) throw new Error('leave: <url|token|name> required');
  const removed = removeSubscription(key);
  if (!removed) throw new Error(`leave: no subscription matches ${key}`);
  return { ok: true, removed: key };
}

/** Take a project's public URL down. The link dies for everyone holding it. */
export async function cmdUnshareProject({ name } = {}, deps = {}) {
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  if (!name) throw new Error('unshare-project: <name> required');
  const { url } = await ensure();
  const r = await fetch(new URL(`/api/project/${encodeURIComponent(name)}/share`, url), { method: 'DELETE' });
  const body = await r.json();
  if (!r.ok) throw new Error(body.error || `unshare-project failed (${r.status})`);
  return { ok: true, project: name, wasPublished: body.wasPublished };
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

/**
 * Clear a processed review batch so the drain layer stops surfacing it.
 *
 * Refuses while an aside action in the batch has produced no aside. That is the
 * backstop under the delivery fix rather than the mechanism: what let this
 * feature fail four times running was that nothing noticed. The agent edited the
 * section, replied as though it had drafted something, and closed the batch, and
 * every layer agreed the work was done.
 *
 * `--force` is for the case the check cannot see: an aside written and then
 * imported or deleted by the reader before the batch was closed. Delete is a
 * browser action now, so this is a live race rather than a rare one: the reader
 * can reject a draft while the batch that produced it is still open.
 */
export async function cmdBatchDone({ id, batchId, force } = {}) {
  if (!id || !batchId) throw new Error('batch-done: <id> <batchId> required');
  if (!force) {
    const { asideGaps } = await import('./actions/aside-gaps.mjs');
    const { readSpecHtml } = await import('./store.mjs');
    const batch = listPendingForSpec(id).find((b) => b.batchId === batchId);
    if (batch) {
      const ids = new Set(batch.threadIds || []);
      const threads = loadComments(id).threads.filter((t) => ids.has(t.id));
      const gaps = asideGaps(threads, readSpecHtml(id), {
        specId: id,
        cli: fileURLToPath(import.meta.url),
        // This batch only: an action answered in an earlier round on the same
        // thread is not something to demand a second draft for.
        batchIds: new Set([batchId]),
      });
      if (gaps.length) {
        throw new Error(
          `batch-done: ${gaps.length} aside action(s) in this batch produced no aside.\n`
          + 'An aside action writes a draft beside the section; it does not edit the section. '
          + 'If you edited the section instead, undo that first.\n\n'
          + gaps.map((g) => `  ${g.thread}  @${g.action} on §${g.section}\n    ${g.run}`).join('\n\n')
          + '\n\nThen run batch-done again. If the reader already imported or deleted it, pass --force.'
        );
      }
    }
  }
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
  // Convert re-authors the document, so it is authoring and carries the same
  // direction create does. Raised in review of PR #203: without it a converted
  // spec comes out in the house register while every other spec comes out in
  // the user's.
  const { languageContract } = await import('./language-contract.mjs');
  return { ...result, url: specUrl(url, result.id), language: languageContract() };
}

/**
 * Verify a stored spec against its type's rules.
 *
 * Answers everything a function can and reports the rest as pending, which is
 * the agent's work list. `ok` is false while anything blocking has failed AND
 * while anything blocking is still unjudged: reporting an unanswered rule as a
 * pass would manufacture assurance (D5).
 */
export async function cmdVerify({ id, judged } = {}) {
  if (!id) throw new Error('verify: <id> required');
  const meta = readMeta(id);
  if (!meta) throw new Error(`verify: unknown spec ${id}`);
  const { readSpecHtml } = await import('./store.mjs');
  const { verifySpec } = await import('./verify-spec.mjs');
  const type = meta.type || LEGACY_TYPE;
  const ids = String(judged || '').split(',').map((s) => s.trim()).filter(Boolean);
  return { id, ...verifySpec(readSpecHtml(id), type, { judged: ids }) };
}

/**
 * Print the context-menu actions, with their standing instructions.
 *
 * The instruction an agent runs lives in one place. A skill that carried its own
 * copy would mean improving an instruction takes two edits and a diff nobody
 * runs, so the skill reads this instead.
 */
/**
 * Write an aside into a stored spec.
 *
 * The agent runs this rather than hand-writing the section, because the markup
 * carries three things it can get wrong (the two attributes, the numbered id,
 * the placement) and getting any of them wrong produces a draft the reader
 * cannot see or answer.
 */
export async function cmdAside({ id, section, action, file, body, block, thread, batch } = {}) {
  if (!id) throw new Error('aside: <specId> required');
  if (!section) throw new Error('aside: --section <sourceSectionId> required');
  if (!action) throw new Error('aside: --action <actionId> required');
  const meta = readMeta(id);
  if (!meta) throw new Error(`aside: unknown spec ${id}`);
  const { readSpecHtml, writeSpecHtml } = await import('./store.mjs');
  const { writeAside } = await import('./actions/write-aside.mjs');
  const content = file ? readFileSync(resolve(file), 'utf8') : body;
  if (!content) throw new Error('aside: --file <path> or --body <html> required');
  const out = writeAside(readSpecHtml(id), { section, action, body: content, block, thread, batch });
  writeSpecHtml(id, out.html);
  return {
    id, asideId: out.id, section, action, block: block || null, thread: thread || null, batch: batch || null,
  };
}

export async function cmdActions({ id, scope } = {}) {
  const { allActions, actionById, forScope } = await import('./actions/all.mjs');
  const { SCOPES } = await import('./actions/index.mjs');
  if (id) {
    const action = actionById(id);
    if (!action) throw new Error(`unknown action ${JSON.stringify(id)}`);
    return { action };
  }
  if (scope) {
    if (!SCOPES.includes(scope)) {
      throw new Error(`unknown scope ${JSON.stringify(scope)}, expected one of ${SCOPES.join(', ')}`);
    }
    return { scope, actions: forScope(scope) };
  }
  // The effective set, so `specforge actions` lists what the user actually has,
  // custom entries included, rather than what the plugin shipped with.
  return { actions: allActions() };
}

/** Report an export outcome — the Doc link (--url) or a failure (--error). */
export async function cmdExportDone({ id, url, error } = {}) {
  if (!id) throw new Error('export-done: <id> required');
  if (!url && !error) throw new Error('export-done: --url or --error required');
  const ex = finishExport(id, { url, error });
  return { ok: true, id, export: ex };
}

/**
 * Report that a template has been written, or could not be.
 *
 * Unlike export-done there is no url to report: what the skill produced is the
 * template spec's own HTML, already on disk. Success is the absence of an
 * error, which is why --error is the only flag.
 */
export async function cmdTemplateDone({ id, error } = {}) {
  if (!id) throw new Error('template-done: <id> required');
  const generate = finishGenerate(id, { error });
  return { ok: true, id, generate };
}

// --- arg parsing + dispatch ---

/** Flags that stand alone. Everything else takes the next argument as a value. */
export const BOOLEAN_FLAGS = new Set(['clear', 'rotate', 'write', 'force', 'install-service', 'zip', 'all', 'plan', 'dry', 'json']);

/**
 * Commands whose default output is a report for a human to read, with `--json`
 * for a caller to parse, and whose `exit` field becomes the process exit code so
 * a harness can gate on it without parsing anything.
 */
const REPORTING_COMMANDS = new Set(['verify']);

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
export const COMMANDS = Object.assign(Object.create(null), {
  // `project` is passed through only when the flag is present: undefined means
  // "inherit the selection", '' means "nowhere", and the two are not the same.
  create: (p, f) => cmdCreate({
    title: f.title, origin: f.origin, type: f.type,
    ...('project' in f ? { project: f.project === true ? '' : f.project } : {}),
  }),
  import: (p, f) => cmdImport({ file: p[0], title: f.title, type: f.type }),
  open: (p) => cmdOpen({ id: p[0] }),
  start: () => cmdStart(),
  listall: () => cmdListall(),
  list: () => cmdList(),
  detach: (p) => cmdDetach({ id: p[0] }),
  comments: (p, f) => cmdComments({ id: p[0], all: f.all === true || f.all === 'true' }),
  share: (p, f) => cmdShare({ id: p[0], rotate: f.rotate === true || f.rotate === 'true' }),
  unshare: (p) => cmdUnshare({ id: p[0] }),
  shares: () => cmdShares({}),
  'share-project': (p, f) => cmdShareProject({ name: p.join(' '), rotate: f.rotate === true || f.rotate === 'true' }),
  'unshare-project': (p) => cmdUnshareProject({ name: p.join(' ') }),
  join: (p, f) => cmdJoin({ url: p[0], name: f.name }),
  leave: (p) => cmdLeave({ key: p.join(' ') }),
  contribute: (p, f) => cmdContribute({ id: p[0], url: p[1], owner: f.owner }),
  withdraw: (p) => cmdWithdraw({ id: p[0], url: p[1] }),
  // A project name can carry spaces and often reaches argv unquoted, so the
  // token is taken from the end and everything before it is the name.
  prune: (p, f) => cmdPrune({
    name: (f.token ? p : p.slice(0, -1)).join(' '),
    token: f.token || p[p.length - 1],
  }),
  origin: (p, f) => cmdOrigin({ url: p[0], clear: f.clear === true || f.clear === 'true' }),
  'setup-tunnel': (p, f) => cmdSetupTunnel({
    hostname: p[0] || f.hostname,
    force: f.force === true || f.force === 'true',
    installService: f['install-service'] === true || f['install-service'] === 'true',
  }),
  reply: (p, f) => cmdReply({ id: p[0], tid: p[1], body: f.body }),
  'batch-done': (p, f) => cmdBatchDone({
    id: p[0], batchId: p[1], force: f.force === true || f.force === 'true',
  }),
  'batch-working': (p) => cmdBatchWorking({ id: p[0], batchId: p[1] }),
  'export-working': (p) => cmdExportWorking({ id: p[0] }),
  'export-done': (p, f) => cmdExportDone({ id: p[0], url: f.url, error: f.error }),
  'template-done': (p, f) => cmdTemplateDone({ id: p[0], error: f.error }),
  'export-md': (p, f) => cmdExportMd({ id: p[0], out: f.out, exportedAt: f.date, zip: f.zip === true }),
  'import-md': (p, f) => cmdImportMd({ file: p[0], title: f.title, type: f.type, date: f.date, owner: f.owner }),
  status: (p) => cmdStatus({ id: p[0], status: p[1] }),
  verify: (p, f) => cmdVerify({ id: p[0], judged: f.judged }),
  actions: (p, f) => cmdActions({ id: p[0], scope: f.scope }),
  aside: (p, f) => cmdAside({
    id: p[0],
    section: f.section,
    action: f.action,
    file: f.file,
    body: f.body,
    block: f.block,
    thread: f.thread,
    batch: f.batch,
  }),
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
    // Compact default for the list surface (spec 3067be852a, R2): one line per
    // spec. --json is the machine shape the functions return.
    if ((cmd === 'list' || cmd === 'listall') && flags.json !== true) {
      process.stdout.write(formatRowsCompact(result.rows || [], result.session) + '\n');
      if (cmd === 'listall' && result.indexUrl) process.stdout.write(`\nindex: ${result.indexUrl}\n`);
      process.exit(0);
    }
    if (REPORTING_COMMANDS.has(cmd) && flags.json !== true) {
      const { formatReport } = await import('./verify-spec.mjs');
      process.stdout.write(`${formatReport(result)}\n`);
    } else {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
    // 0 the gate passed, 1 it did not. A harness gates on this, and create-spec
    // is not finished until it gets 0.
    if (REPORTING_COMMANDS.has(cmd) && result.exit) process.exit(result.exit);
  } catch (err) {
    process.stderr.write(`specforge ${cmd}: ${err.message}\n`);
    process.exit(1);
  }
}

const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) main();
