#!/usr/bin/env node
// Agent-facing spec navigation CLI. Gives an LLM a resident section MAP plus a
// tiny on-demand tool surface (section / grep / search / around / neighbors /
// xrefs) so it can navigate a spec without reading the whole file. Output is
// terse text by default; --json emits machine-readable shapes.
//
//   spec-nav map                 [--spec <path> | --project <dir>] [--json]
//   spec-nav section <id>        […] [--json]
//   spec-nav grep <regex>        […] [--json] [--limit N]
//   spec-nav search <query…>     […] [--json] [--limit N]
//   spec-nav around <anchor>     […] [--json] [--context N]
//   spec-nav neighbors <id>      […] [--json]
//   spec-nav xrefs <id>          […] [--json]

import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, basename } from 'node:path';
import { loadConfig } from './config.mjs';
import { getActive } from './active.mjs';
import { resolveSpec, specId as hashSpecId } from './paths.mjs';
import { loadIndex, writeIndex } from './spec-nav-index.mjs';
import * as nav from './spec-nav.mjs';

function fail(msg) {
  console.error(msg);
  process.exit(2);
}

/** Pull `--name value` flags out of argv, returning { positionals, flags }. */
function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') flags.json = true;
    else if (a === '--spec') flags.spec = argv[++i];
    else if (a === '--project') flags.project = argv[++i];
    else if (a === '--limit') flags.limit = Number(argv[++i]);
    else if (a === '--context') flags.context = Number(argv[++i]);
    else positionals.push(a);
  }
  return { positionals, flags };
}

/**
 * Resolve the target spec + its index. Precedence:
 *   1. --spec <path>  → that file (specsDir = its project; standalone OK)
 *   2. --project/-cwd → the project's active spec (.specforge/active.json)
 * @returns {{specsDir:string, spec:{file,relPath,id}, html:string, index:object}}
 */
function resolveTarget(flags) {
  if (flags.spec) {
    const file = resolve(flags.spec);
    if (!existsSync(file)) fail(`spec not found: ${flags.spec}`);
    // Treat the project's specsDir as the index home; fall back to the file's dir.
    const projectDir = flags.project ? resolve(flags.project) : process.cwd();
    const specsDir = loadConfig(projectDir).specsDir;
    let relPath;
    try {
      relPath = relative(specsDir, file);
    } catch {
      relPath = basename(file);
    }
    if (relPath.startsWith('..')) relPath = basename(file);
    const spec = { file, relPath, id: hashSpecId(relPath) };
    const html = readFileSync(file, 'utf8');
    return { specsDir, spec, html, index: loadIndex(specsDir, spec) };
  }

  const projectDir = flags.project ? resolve(flags.project) : process.cwd();
  const specsDir = loadConfig(projectDir).specsDir;
  const active = getActive(specsDir);
  if (!active) fail('no --spec given and no active spec (.specforge/active.json). Pass --spec <path>.');
  const spec = resolveSpec(specsDir, active.specId);
  if (!spec) fail(`active spec not found: ${active.specId}`);
  const html = readFileSync(spec.file, 'utf8');
  return { specsDir, spec, html, index: loadIndex(specsDir, spec) };
}

const out = (flags, obj, text) => {
  if (flags.json) console.log(JSON.stringify(obj, null, 2));
  else console.log(text);
};

// ---------------------------------------------------------------------------

const { positionals, flags } = parseArgs(process.argv.slice(2));
const [cmd, ...args] = positionals;
if (!cmd) fail('usage: spec-nav <map|section|grep|search|around|neighbors|xrefs> …');

const t = resolveTarget(flags);

if (cmd === 'map') {
  const m = nav.map(t.index);
  if (flags.json) { out(flags, m); }
  else {
    const lines = [`${t.spec.relPath}  (status: ${t.index.status}, ${m.sections.length} sections)`];
    for (const s of m.sections) {
      lines.push(`  ${s.id.padEnd(16)} h${s.level}  ${s.header.padEnd(40).slice(0, 40)}  ~${s.tokenEst}t`);
    }
    const planStr = m.plan.map((p) => {
      const tasks = p.tasks.map((tk) => `${tk.id}${tk.status === 'done' ? '✓' : ''}`).join(' ');
      return `S${p.stage}${p.pr ? `(${p.pr})` : ''} ${tasks}`;
    }).join(' | ');
    if (planStr) lines.push(`plan: ${planStr}`);
    out(flags, m, lines.join('\n'));
  }
} else if (cmd === 'section') {
  const id = args[0];
  if (!id) fail('usage: section <id>');
  const s = nav.section(t.index, t.html, id);
  if (!s) fail(`section not found: ${id}`);
  out(flags, s, `${s.id}  (${s.header})  lines ${s.lineStart}-${s.lineEnd}\n` +
    `neighbors: ${s.neighborIds.join(', ') || '—'}   refsTo: ${s.refsTo.join(', ') || '—'}\n\n${s.text}`);
} else if (cmd === 'grep') {
  const re = args[0];
  if (!re) fail('usage: grep <regex>');
  let hits = nav.grep(t.html, re);
  if (flags.limit) hits = hits.slice(0, flags.limit);
  out(flags, hits, hits.map((h) => `${h.id.padEnd(16)} l.${h.line}  ${h.match}`).join('\n') || '(no matches)');
} else if (cmd === 'search') {
  const query = args.join(' ');
  if (!query) fail('usage: search <query…>');
  const hits = nav.search(t.index, t.html, query, { limit: flags.limit || 5 });
  out(flags, hits, hits.map((h, i) =>
    `${i + 1}. ${h.id.padEnd(16)} ${h.score.toFixed(3)}  "${h.snippet}"  (lines ${h.lineStart}-${h.lineEnd})`
  ).join('\n') || '(no matches)');
} else if (cmd === 'around') {
  const anchor = args[0];
  if (anchor === undefined) fail('usage: around <line|id|text>');
  const w = nav.around(t.html, anchor, flags.context ?? 3, t.index);
  if (!w) fail(`anchor not found: ${anchor}`);
  out(flags, w, w.lines.map((l) => `${String(l.line).padStart(4)}${l.mark ? '>' : ' '} ${l.text}`).join('\n'));
} else if (cmd === 'neighbors') {
  const id = args[0];
  if (!id) fail('usage: neighbors <id>');
  const n = nav.neighbors(t.index, id);
  if (!n) fail(`section not found: ${id}`);
  out(flags, n, `${n.id}  (${n.header})\n` +
    `  prev: ${n.prev ? `${n.prev.id.padEnd(16)} ${n.prev.header}` : '—'}\n` +
    `  next: ${n.next ? `${n.next.id.padEnd(16)} ${n.next.header}` : '—'}`);
} else if (cmd === 'xrefs') {
  const id = args[0];
  if (!id) fail('usage: xrefs <id>');
  const x = nav.xrefs(t.index, id);
  if (!x) fail(`section not found: ${id}`);
  out(flags, x, `${x.id}  (${x.header})\n` +
    `  refsTo:   ${x.refsTo.map((r) => r.id).join(', ') || '—'}\n` +
    `  refsFrom: ${x.refsFrom.map((r) => `${r.id}(${r.via})`).join(', ') || '—'}`);
} else if (cmd === 'reindex') {
  // Hidden helper: force-regenerate the on-disk index (used by tests/tooling).
  const p = writeIndex(t.specsDir, t.spec);
  out(flags, { wrote: p }, `wrote ${p}`);
} else {
  fail(`unknown command: ${cmd}`);
}
