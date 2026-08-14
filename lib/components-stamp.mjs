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
 * The first `<style>` element's contents, and where it sits.
 *
 * Everything here works inside that range and nowhere else. A spec is free to
 * write the marker text in its prose: the design spec for this library shows the
 * markers inside a `<pre><code>` example, and an earlier version of this file
 * matched that example and replaced it with the whole stylesheet. Scoping to the
 * stylesheet makes documenting the format safe.
 */
function styleRange(html) {
  // Any valid opening tag, not the bare one the templates happen to use: an
  // imported spec can arrive with `<style type="text/css">` or `<STYLE>`, and
  // refusing to stamp it would be a refusal nobody could act on.
  const open = /<style\b[^>]*>/i.exec(html);
  if (!open) return null;
  const from = open.index + open[0].length;
  const close = /<\/style\s*>/i.exec(html.slice(from));
  if (!close) return null;
  const to = from + close.index;
  return { from, to, css: html.slice(from, to) };
}

/** The opening `<html>` tag, however it was written. */
const HTML_TAG_RE = /<html\b[^>]*>/i;

/** The version attribute inside a tag: any quoting, any spacing, any case. */
const ATTR_RE = new RegExp(`${ATTR}\\s*=\\s*["'](\\d+)["']`, 'i');

/**
 * Whether `<html>` itself opted in, and at which version.
 *
 * Prose mentioning the attribute does not count, which is why this reads the tag
 * rather than the document. The tag is matched loosely for the opposite reason:
 * an imported spec can arrive with `<HTML>`, single quotes, or spaces around the
 * equals sign, and reading a valid opt-in as absent would silently skip that
 * spec in both `sync --all` and the lint.
 *
 * @returns {number|null} the version, or null when it never opted in
 */
export function optedInVersion(html) {
  const tag = html.match(HTML_TAG_RE);
  const m = tag && tag[0].match(ATTR_RE);
  return m ? Number(m[1]) : null;
}

export function optedIn(html) {
  return optedInVersion(html) !== null;
}

/**
 * What a spec's block says about itself.
 *
 * @returns {{present:boolean, version:number|null, edited:boolean}}
 *   `edited` is true when the body no longer hashes to what its own closing
 *   marker recorded, which is the only signal that a person changed it.
 */
export function readBlock(html) {
  const style = styleRange(html);
  const m = style && style.css.match(BLOCK_RE);
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

  const style = styleRange(html);
  if (!style) throw new Error('no <style> element to stamp the component block into');

  const css = buildCss().trim();
  // Confined to the stylesheet: replacing across the whole document would hit a
  // spec that shows the markers in a code example.
  const nextCss = block.present
    ? style.css.replace(BLOCK_RE, () => css)
    // Library first, so a spec's own rules can still override a component.
    : `\n${css}\n${style.css}`;
  const out = html.slice(0, style.from) + nextCss + html.slice(style.to);
  return setAttr(out);
}

/**
 * Record the library version on <html>, replacing an older value.
 *
 * Scoped to the tag: a document-wide replace would rewrite the attribute where a
 * spec merely writes about it.
 */
function setAttr(html) {
  return html.replace(HTML_TAG_RE, (tag) => {
    // Parsed, not sliced. `tag.indexOf('html')` returns -1 on `<HTML>`, and the
    // slice that followed produced `<htmlML LANG="en">`: a corrupted root tag on
    // exactly the imported documents the loose matching was added to support.
    const m = tag.match(/^<(html)\b([\s\S]*?)\s*>$/i);
    if (!m) return tag;
    const [, name, attrs] = m;
    // Matched the same way it is read, so an existing attribute written with
    // single quotes or spacing is updated rather than duplicated.
    const next = ATTR_RE.test(attrs)
      ? attrs.replace(ATTR_RE, `${ATTR}="${VERSION}"`)
      : `${attrs} ${ATTR}="${VERSION}"`;
    // The document's own casing is preserved: rewriting <HTML> to <html> is a
    // change nobody asked for.
    return `<${name}${next}>`;
  });
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
    // Read from the <html> tag, not from anywhere in the file: the design spec
    // for this library writes the attribute name in its prose, and a
    // document-wide test read that as consent.
    if (!optedIn(html)) { out.skipped.push(id); continue; }
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
