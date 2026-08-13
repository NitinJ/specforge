// The title repair (tools/repair-titles.mjs).
//
// It exists because getTitle used to store titles still HTML-escaped. Two things
// are worth holding it to. Running it twice must be the same as running it once,
// since it is documented as safe to re-run and a repair that keeps changing its
// answer eventually writes a title nobody wrote. And it must not touch a spec
// whose listing name has merely drifted from its <h1>, which is common and
// deliberate — against the real store, taking the document as the answer rather
// than as corroboration would have renamed 39 specs, several to "{{TITLE}}".

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

import { createSpec } from '../lib/store.mjs';
import { readMeta } from '../lib/meta.mjs';
import { metaPath } from '../lib/store-paths.mjs';

const TOOL = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'tools', 'repair-titles.mjs');

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-repair-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

const doc = (title) => `<!DOCTYPE html><html><head><title>${title}</title></head><body><h1>${title}</h1></body></html>`;

/** Create a spec whose meta.title is stale, the way some reader left it. */
function specWithStoredTitle(html, storedTitle) {
  const id = createSpec({ title: 'placeholder', html });
  const meta = readMeta(id);
  writeFileSync(metaPath(id), JSON.stringify({ ...meta, title: storedTitle }, null, 2));
  return id;
}

/**
 * A spec left the way the OLD reader left it: meta.title is the raw inner text
 * of <title>, tags stripped but entities never decoded. `titleMarkup` is what
 * the document carries, so it is both the document's title and what was stored.
 */
const specAsOldReaderLeftIt = (titleMarkup) => specWithStoredTitle(doc(titleMarkup), titleMarkup);

const run = () => execFileSync(process.execPath, [TOOL, '--confirm'],
  { encoding: 'utf8', env: { ...process.env, SPECFORGE_HOME: home } });

test('an escaped title is repaired to the text it was always meant to be', () => {
  const id = specAsOldReaderLeftIt('Links, App Links &amp; Routing');
  run();
  assert.equal(readMeta(id).title, 'Links, App Links & Routing');
});

test('running it again changes nothing', () => {
  const id = specAsOldReaderLeftIt('Links, App Links &amp; Routing');
  run();
  const once = readMeta(id).title;
  const out = run();
  assert.match(out, /nothing to repair/);
  assert.equal(readMeta(id).title, once, 'the repair is idempotent');
});

// The case a blind decode gets wrong: this title really does contain the text
// "&lt;", so it is stored doubly escaped. Decoding on every pass peels a layer
// per run until the title becomes "<", which nobody wrote.
test('a title that legitimately contains an entity is not peeled apart', () => {
  const id = specAsOldReaderLeftIt('write &amp;lt; for less-than');
  run();
  assert.equal(readMeta(id).title, 'write &lt; for less-than');
  run();
  run();
  assert.equal(readMeta(id).title, 'write &lt; for less-than', 'still the same after three runs');
});

test('a document with no title of its own leaves the stored name alone', () => {
  // Otherwise a spec whose html lost its <title> would be renamed to the
  // "Untitled spec" placeholder, losing the only record of what it was called.
  const id = specWithStoredTitle('<html><body><p>no title element</p></body></html>', 'A Real Name');
  run();
  assert.equal(readMeta(id).title, 'A Real Name');
});

// The document is corroboration, not the answer. A listing name that has drifted
// from the <h1> is ordinary — a spec renamed in the index, or a template still
// holding its placeholder — and renaming it here would destroy the only record
// of what it was called.
test('a name that simply differs from the document is not a title to repair', () => {
  const id = specWithStoredTitle(doc('{{TITLE}}'), 'Selling VTON &amp; Catalog-to-Model');
  const out = run();
  assert.match(out, /nothing to repair/);
  assert.equal(readMeta(id).title, 'Selling VTON &amp; Catalog-to-Model',
    'escaped, but not what this document would have produced');
});

test('a title that already matches its document is left untouched', () => {
  const id = specWithStoredTitle(doc('Already Correct'), 'Already Correct');
  const out = run();
  assert.match(out, /nothing to repair/);
  assert.equal(readMeta(id).title, 'Already Correct');
});

test('without --confirm it reports and writes nothing', () => {
  const id = specAsOldReaderLeftIt('Links &amp; Routing');
  const out = execFileSync(process.execPath, [TOOL],
    { encoding: 'utf8', env: { ...process.env, SPECFORGE_HOME: home } });
  assert.match(out, /would fix/);
  assert.equal(readMeta(id).title, 'Links &amp; Routing', 'a dry run is a dry run');
});
