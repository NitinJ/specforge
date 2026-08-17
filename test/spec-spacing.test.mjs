// Section spacing in the shells new specs are built from.
//
// `h2:first-of-type{border-top:none;margin-top:18px}` reads as "the first
// heading needs no rule above it" and is not what it does. Every h2 is the only
// h2 inside its own <section>, so it is first-of-type in every one of them: the
// exception applied everywhere, and the 48px of air and the separator defined on
// the line above it never once took effect.
//
// A selector that is wrong in this direction is invisible — the page looks
// deliberate, just tight — so it is worth a test that names the shape rather
// than the numbers.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TPL = join(ROOT, 'templates');
const shells = readdirSync(TPL).filter((f) => /^spec-base.*\.html$/.test(f));

test('there are shells to check', () => {
  assert.ok(shells.length >= 4, `found ${shells.length}`);
});

/** A shell's CSS with comments removed, so prose about a selector is not a use of it. */
const cssOf = (f) => readFileSync(join(TPL, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('no shell selects the first heading without saying first WHAT', () => {
  // `h2:first-of-type` on its own is the bug: it asks for the first h2 among its
  // siblings, and an h2 wrapped in its own section has no h2 siblings at all.
  // The same fragment preceded by a combinator is fine, which is why this looks
  // for the selector at the start of a rule rather than anywhere in the file.
  for (const f of shells) {
    assert.equal(
      /(^|[{}\n,])\s*h2:first-of-type/.test(cssOf(f)), false,
      `${f} still uses a bare h2:first-of-type, which matches every section's heading`,
    );
  }
});

test('a shell that separates its sections scopes the exception to the first one', () => {
  // The deck shell pages its sections and defines no separator, so it is exempt
  // from the rule rather than failing it.
  for (const f of shells) {
    const css = cssOf(f);
    if (!/h2\{[^}]*border-top/.test(css)) continue;
    assert.match(
      css, /section:first-of-type\s*>\s*h2/,
      `${f} defines a separator but never turns it off for the first section`,
    );
  }
});

test('no comment in a shell writes a tag in prose', () => {
  // Several tools here read the shell with regexes — the markdown importer
  // counts `<section` to find sections, and the exporter slices on them. A tag
  // written inside a CSS comment counts as markup to all of them, and the
  // failure lands somewhere unrelated: writing "its own <section>" in a comment
  // here broke the importer's table of contents.
  for (const f of shells) {
    const comments = readFileSync(join(TPL, f), 'utf8').match(/\/\*[\s\S]*?\*\//g) || [];
    for (const c of comments) {
      assert.equal(
        /<\/?[a-z][a-z0-9]*[\s>]/i.test(c), false,
        `${f} has a comment containing a tag: ${c.slice(0, 80)}`,
      );
    }
  }
});

test('a section heading is given real room above it', () => {
  // The number is a judgement and will move; that it is not the 18px the broken
  // exception left behind is the property worth holding.
  for (const f of shells) {
    const css = cssOf(f);
    const m = css.match(/(?:^|\n)\s*h2\{[^}]*margin:(\d+)px/);
    if (!m) continue;
    assert.ok(Number(m[1]) >= 40, `${f} sets h2 margin-top to ${m[1]}px`);
  }
});
