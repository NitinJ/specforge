// I2: lib/spec-tree.mjs is the only module that walks the parent edge.
//
// The point of the rule is that cycle handling, ordering and dangling-pointer
// behaviour are decided once. A second module that reads `meta.parent` to
// traverse will eventually disagree about one of them, and the disagreement
// will show up as a tree that renders differently in two places rather than as
// an error anyone notices.
//
// So this reads the source, and the rule it enforces is deliberately blunt: no
// module outside the allow-list mentions `.parent` at all.
//
// The first version of this test tried to tell "following the edge" apart from
// "reporting the field" with regexes over single lines. It was mutated to prove
// it worked and it did not: a two-line walk
//
//     let cur = meta.parent;
//     while (cur) { const m = readMeta(cur); cur = m.parent; }
//
// slipped straight past, because neither line matched on its own. Guessing
// intent from a line of source does not work, so intent is declared instead. A
// site that legitimately reads the field for output writes
//
//     // spec-tree-ok: <reason>
//
// on the line or the one above it. That makes every exception a deliberate act
// with a reason attached and keeps the check itself trivial to trust.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readdirSync, readFileSync, statSync, writeFileSync, rmSync,
} from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const SEARCHED = ['lib', 'server'];

/** The module that owns the walk, plus the sites allowed to read the field. */
const ALLOWED = new Map([
  ['lib/spec-tree.mjs', 'owns the walk'],
  ['lib/meta.mjs', 'declares the field on defaultMeta'],
  ['lib/store.mjs', "sets a new spec's own parent at creation"],
]);

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'public') continue;
        walk(full);
      } else if (/\.(mjs|js)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  for (const d of SEARCHED) walk(join(ROOT, d));
  return out;
}

const MARKER = /spec-tree-ok:/;

/** Every unmarked `.parent` mention outside the allow-list. */
export function parentReadsOutsideOwner(files) {
  const offenders = [];
  for (const file of files) {
    const rel = relative(ROOT, file);
    if (ALLOWED.has(rel)) continue;

    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!/\.parent\b/.test(line)) return;
      // A comment explaining the field is not a read of it.
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (MARKER.test(line)) return;
      if (i > 0 && MARKER.test(lines[i - 1])) return;
      offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
    });
  }
  return offenders;
}

test('no module outside spec-tree.mjs reads the parent field unmarked', () => {
  const offenders = parentReadsOutsideOwner(sourceFiles());
  assert.deepEqual(
    offenders,
    [],
    `unmarked parent reads outside lib/spec-tree.mjs:\n${offenders.join('\n')}`,
  );
});

test('the allow-list names files that exist, so it cannot rot silently', () => {
  for (const rel of ALLOWED.keys()) {
    assert.ok(statSync(join(ROOT, rel)).isFile(), `${rel} is on the allow-list but does not exist`);
  }
});

test('the scan actually reaches the source tree', () => {
  const files = sourceFiles().map((f) => relative(ROOT, f));
  assert.ok(files.includes('lib/spec-tree.mjs'), 'scan missed the module it is about');
  assert.ok(files.includes('server/daemon.mjs'), 'scan missed the server directory');
  assert.ok(files.length > 50, `scan found only ${files.length} files`);
});

test('the detector catches a two-line walk, which the first version did not', () => {
  // Guards the guard, against the exact mutation that defeated the previous
  // implementation. Written to a real file under a searched directory, because
  // the earlier version passed a synthetic string and still missed the real one.
  const probe = join(ROOT, 'lib', '__spec_tree_guard_probe.mjs');
  writeFileSync(probe, [
    'export function walk(meta, readMeta) {',
    '  let cur = meta.parent;',
    '  while (cur) { const m = readMeta(cur); cur = m.parent; }',
    '  return cur;',
    '}',
    '',
  ].join('\n'));
  try {
    const offenders = parentReadsOutsideOwner(sourceFiles());
    assert.ok(
      offenders.some((o) => o.includes('__spec_tree_guard_probe.mjs')),
      `the detector missed a hand-rolled walk. Offenders: ${JSON.stringify(offenders)}`,
    );
  } finally {
    rmSync(probe, { force: true });
  }
});

test('the marker is what makes a legitimate read pass', () => {
  const probe = join(ROOT, 'lib', '__spec_tree_marker_probe.mjs');
  writeFileSync(probe, [
    'export function report(meta) {',
    '  // spec-tree-ok: reports one spec\'s own value, does not follow it',
    '  return { parent: meta.parent || null };',
    '}',
    '',
  ].join('\n'));
  try {
    const offenders = parentReadsOutsideOwner(sourceFiles());
    assert.equal(
      offenders.some((o) => o.includes('__spec_tree_marker_probe.mjs')),
      false,
      `a marked read was reported anyway: ${JSON.stringify(offenders)}`,
    );
  } finally {
    rmSync(probe, { force: true });
  }
});
