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

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { createSpec, specHtmlPath } from './store.mjs';
import { listSpecs, readMeta } from './meta.mjs';
import { attach, detach, specsForSession } from './attach.mjs';
import { ensureDaemon as realEnsureDaemon, specUrl } from './daemon-client.mjs';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(REPO, 'templates', 'spec-base.html');

function sessionId(deps) {
  return deps.session !== undefined ? deps.session : process.env.CLAUDE_CODE_SESSION_ID || '';
}

/** Scaffold a new store spec from the template, attach it to this session. */
export async function cmdCreate({ title, origin = null } = {}, deps = {}) {
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  const id = createSpec({ title, origin, html: readFileSync(TEMPLATE, 'utf8') });
  const session = sessionId(deps);
  if (session) attach(id, session);
  const { url } = await ensure();
  return { id, htmlPath: specHtmlPath(id), url: specUrl(url, id), status: 'draft' };
}

/** Ingest an existing .html spec file into the store, attach it to this session. */
export async function cmdImport({ file, title } = {}, deps = {}) {
  if (!file) throw new Error('import: <file> required');
  const ensure = deps.ensureDaemon || realEnsureDaemon;
  const abs = resolve(file);
  const id = createSpec({ title, origin: abs, html: readFileSync(abs, 'utf8') });
  const session = sessionId(deps);
  if (session) attach(id, session);
  const { url } = await ensure();
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
  return { rows: listSpecs().map(row), indexUrl: url };
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
  detach(id);
  return { ok: true, id };
}

// --- arg parsing + dispatch ---

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) flags[a.slice(2)] = argv[++i];
    else positional.push(a);
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
