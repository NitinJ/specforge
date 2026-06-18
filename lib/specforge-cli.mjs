#!/usr/bin/env node
// The `specforge` CLI — the deterministic backend behind the v2 commands
// (design §8). Each spec-producing command ensures the daemon is up and attaches
// the spec to the current Claude session ($CLAUDE_CODE_SESSION_ID). Skills drive
// the authoring (HTML); this CLI owns the store + lock + daemon plumbing.
//
//   specforge create  [--title T] [--origin O]   scaffold a store spec from the
//                                                 template, attach, return paths
//   specforge import <file> [--title T]           ingest an existing .html spec
//   specforge open <id>                           attach + return the spec url
//   specforge listall                             every spec: id·title·status·attached
//   specforge list                                specs attached to this session
//   specforge detach <id>                         free a spec from its session
//   specforge comments <id>                       threads + pending batches (review)
//   specforge reply <id> <tid> --body "…"         post a claude reply to a thread
//   specforge batch-done <id> <batchId>           clear a processed review batch
//   specforge status <id> <state>                 set lifecycle status (meta + badge)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createSpec, specHtmlPath } from './store.mjs';
import { listSpecs, readMeta } from './meta.mjs';
import { attach, detach, specsForSession } from './attach.mjs';
import { ensureDaemon as realEnsureDaemon, specUrl } from './daemon-client.mjs';
import { loadComments, saveComments, addComment } from './store-comments.mjs';
import { listPendingForSpec, markBatchDone } from './store-inbox.mjs';
import { setStatus } from './lifecycle.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(REPO, 'templates', 'spec-base.html');

function sessionId(deps) {
  return deps.session !== undefined ? deps.session : process.env.CLAUDE_CODE_SESSION_ID || '';
}

/** Scaffold a new store spec from the template, attach it to this session. */
export async function cmdCreate({ title, origin = null } = {}, deps = {}) {
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  const html = readFileSync(TEMPLATE, 'utf8');
  const { url } = await ensure(); // confirm the daemon before writing any store state
  const id = createSpec({ title, origin, html });
  const session = sessionId(deps);
  if (session) attach(id, session);
  return { id, htmlPath: specHtmlPath(id), url: specUrl(url, id), status: 'draft' };
}

/** Ingest an existing .html spec file into the store, attach it to this session. */
export async function cmdImport({ file, title } = {}, deps = {}) {
  if (!file) throw new Error('import: <file> required');
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  const abs = resolve(file);
  const html = readFileSync(abs, 'utf8'); // fail before touching the store/daemon
  const { url } = await ensure();
  const id = createSpec({ title, origin: abs, html });
  const session = sessionId(deps);
  if (session) attach(id, session);
  return { id, htmlPath: specHtmlPath(id), url: specUrl(url, id), status: 'draft' };
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

function row(meta) {
  return {
    id: meta.id,
    title: meta.title,
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
  const store = loadComments(id);
  const comment = addComment(store, tid, { body, author: 'claude' });
  saveComments(id, store);
  return { ok: true, comment };
}

/** Clear a processed review batch so the drain layer stops surfacing it. */
export async function cmdBatchDone({ id, batchId } = {}) {
  if (!id || !batchId) throw new Error('batch-done: <id> <batchId> required');
  return { ok: markBatchDone(id, batchId), id, batchId };
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
  create: (p, f) => cmdCreate({ title: f.title, origin: f.origin }),
  import: (p, f) => cmdImport({ file: p[0], title: f.title }),
  open: (p) => cmdOpen({ id: p[0] }),
  listall: () => cmdListall(),
  list: () => cmdList(),
  detach: (p) => cmdDetach({ id: p[0] }),
  comments: (p) => cmdComments({ id: p[0] }),
  reply: (p, f) => cmdReply({ id: p[0], tid: p[1], body: f.body }),
  'batch-done': (p) => cmdBatchDone({ id: p[0], batchId: p[1] }),
  status: (p) => cmdStatus({ id: p[0], status: p[1] }),
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
