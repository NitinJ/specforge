// Putting the component stylesheet into a spec, and taking it back out to check
// on it.
//
// A spec is a single self-contained HTML file that must render opened straight
// from disk (house rules, Format). That rules out linking a stylesheet the
// daemon serves, so the library is copied into every spec between two markers.
// A generated block inside a hand-authored file needs two guarantees, and both
// live here:
//
//   1. Re-stamping a spec that has not changed rewrites nothing. `sync --all`
//      runs over the whole store, and a stamp that reordered its own output
//      would show up as a diff on every spec nobody edited.
//   2. A block someone edited by hand is refused rather than silently replaced.
//      The closing marker carries a hash of the body, so an older version and a
//      hand-edit are told apart: the first is re-stamped, the second stops.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { buildCss, buildBody, blockHash, START, VERSION } from './components-build.mjs';
import { storeRoot } from './store-paths.mjs';

/** The attribute on <html> that says a spec is on the library. */
export const ATTR = 'data-sf-components';

const BLOCK_RE = /\/\* specforge:components v(\d+) start[\s\S]*?\/\* specforge:components end(?: sha=([0-9a-f]+))? \*\//;

/**
 * What a spec's block says about itself.
 *
 * @returns {{present:boolean, version:number|null, edited:boolean}}
 *   `edited` is true when the body no longer hashes to what its own closing
 *   marker recorded, which is the only signal that a person changed it.
 */
export function readBlock(html) {
  const m = html.match(BLOCK_RE);
  if (!m) return { present: false, version: null, edited: false };
  const [full, version, sha] = m;
  const body = full
    .replace(/^\/\* specforge:components v\d+ start[^*]*\*\//, '')
    .replace(/\/\* specforge:components end(?: sha=[0-9a-f]+)? \*\/$/, '');
  return {
    present: true,
    version: Number(version),
    // A block with no recorded hash predates the hash and cannot be judged, so
    // it is treated as untouched rather than as edited.
    edited: sha ? blockHash(body) !== sha : false,
  };
}

/**
 * Insert or replace the block, and record the version on <html>.
 *
 * @param {string} html
 * @param {{force?:boolean}} [opts] force replaces a hand-edited block
 */
export function stampHtml(html, opts = {}) {
  const block = readBlock(html);
  if (block.present && block.edited && !opts.force) {
    throw new Error('the component block was edited by hand; re-run with --force to overwrite it');
  }

  const css = buildCss();
  let out;
  if (block.present) {
    out = html.replace(BLOCK_RE, () => css.trim());
  } else {
    const styleAt = html.indexOf('<style>');
    if (styleAt === -1) throw new Error('no <style> element to stamp the component block into');
    const insertAt = styleAt + '<style>'.length;
    // Library first, so a spec's own rules can still override a component.
    out = `${html.slice(0, insertAt)}\n${css.trim()}\n${html.slice(insertAt)}`;
  }
  return setAttr(out);
}

/** Record the library version on <html>, replacing an older value. */
function setAttr(html) {
  if (new RegExp(`${ATTR}="\\d+"`).test(html)) {
    return html.replace(new RegExp(`${ATTR}="\\d+"`), `${ATTR}="${VERSION}"`);
  }
  return html.replace(/<html\b([^>]*)>/, `<html$1 ${ATTR}="${VERSION}">`);
}

const specPath = (id) => join(storeRoot(), 'specs', id, 'spec.html');

/**
 * Stamp one spec in the store.
 * @returns {{id:string, changed:boolean, version:number}}
 */
export function syncSpec(id, opts = {}) {
  const path = specPath(id);
  const before = readFileSync(path, 'utf8');
  const after = stampHtml(before, opts);
  if (after === before) return { id, changed: false, version: VERSION };
  writeFileSync(path, after);
  return { id, changed: true, version: VERSION };
}

/**
 * Stamp every spec that has opted in.
 *
 * D5 says migration is never automatic, so a spec without the attribute is
 * skipped rather than adopted. A hand-edited spec is reported and the run
 * continues: one spec someone customised should not stop the other 110.
 */
export function syncAll(opts = {}) {
  const root = join(storeRoot(), 'specs');
  const out = { synced: [], unchanged: [], skipped: [], refused: [] };
  if (!existsSync(root)) return out;

  for (const id of readdirSync(root).sort()) {
    const path = specPath(id);
    try {
      if (!statSync(join(root, id)).isDirectory() || !existsSync(path)) continue;
    } catch { continue; }

    const html = readFileSync(path, 'utf8');
    if (!new RegExp(`${ATTR}="`).test(html)) { out.skipped.push(id); continue; }
    try {
      const r = syncSpec(id, opts);
      (r.changed ? out.synced : out.unchanged).push(id);
    } catch (err) {
      out.refused.push({ id, reason: err.message });
    }
  }
  return out;
}

/** Stamp a template file in the repo, which always carries the current version. */
export function stampFile(path, opts = {}) {
  const before = readFileSync(path, 'utf8');
  const after = stampHtml(before, opts);
  if (after === before) return { path, changed: false };
  writeFileSync(path, after);
  return { path, changed: true };
}

export { buildBody };
