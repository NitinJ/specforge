// Session keys: how a conversation is named, across every agent CLI.
//
// A session id is unique only inside the CLI that issued it. Claude Code issues
// a UUID, Pi issues its own, and both run on one machine against one store, so
// the raw id is not a safe key. A key is `<harness>:<raw id>`.
//
// The colon never reaches a filename. It is reserved on Windows, where NTFS
// reads it as an alternate data stream separator, so the on-disk form encodes it
// as `__` and `decodeKey` applies the inverse. Code, logs and `doctor` print the
// readable form; only the store sees the encoded one (spec e9ddcddef6, Q3, I12).
//
// A key with no harness in it is a record written before harnesses existed, and
// reads as Claude Code. That is every one of the 111 specs in the store today,
// and getting it wrong detaches all of them at once (I2).

/** The harness a key with no prefix belongs to. */
export const LEGACY_HARNESS = 'claude';

/** What the colon becomes on disk. */
const FILE_SEP = '__';

/**
 * Compose a session key.
 * @param {string} harness the harness id
 * @param {string} raw the id that CLI issued
 * @returns {string} `<harness>:<raw>`, or '' when either part is missing
 */
export function sessionKey(harness, raw) {
  if (!harness || !raw) return '';
  return `${harness}:${raw}`;
}

/**
 * Split a key into its parts.
 *
 * Splits on the FIRST colon only: a raw id containing one belongs to the id, not
 * to the harness.
 *
 * @param {string} key
 * @returns {{harness: string, raw: string}}
 */
export function parseKey(key) {
  const s = String(key || '');
  const at = s.indexOf(':');
  if (at === -1) return { harness: LEGACY_HARNESS, raw: s };
  return { harness: s.slice(0, at), raw: s.slice(at + 1) };
}

/** The harness a key belongs to, with an unprefixed key reading as Claude Code. */
export function harnessOf(key) {
  return parseKey(key).harness;
}

/**
 * Normalise a key that may predate harnesses.
 *
 * `claude:abc` and a bare `abc` name the same session, and comparing them as
 * strings says otherwise. Everything that compares keys goes through this.
 */
export function normalizeKey(key) {
  const s = String(key || '');
  if (!s) return '';
  const { harness, raw } = parseKey(s);
  return sessionKey(harness, raw);
}

/** True when two keys name the same session, whichever form each is written in. */
export function sameSession(a, b) {
  const left = normalizeKey(a);
  return Boolean(left) && left === normalizeKey(b);
}

/**
 * Everything a session id may contribute to a filename unescaped.
 *
 * A session id is opaque: it comes from a CLI, or straight from `--session` on
 * the command line, so it may contain anything at all. Two characters matter.
 * A path separator would put the record in a subdirectory or outside the store
 * entirely, and `_` would let an id forge the `__` delimiter. Both are escaped,
 * which leaves `__` able to mean only one thing.
 *
 * A UUID is `[0-9a-f-]`, so every id either CLI actually issues passes through
 * untouched and none of the 111 files on disk moves.
 */
const SAFE = /[^A-Za-z0-9.-]/g;

const escapePart = (s) => String(s).replace(SAFE, (c) =>
  '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0'));

const unescapePart = (s) => String(s).replace(/%([0-9A-Fa-f]{2})/g, (_, hex) =>
  String.fromCharCode(parseInt(hex, 16)));

/** A name that would address something other than one file in the sessions dir. */
const isTraversal = (name) => name === '.' || name === '..' || name === '';

/**
 * The filename a key is stored under: one path segment, reversible, with no
 * character a filesystem reserves and no way to escape the sessions directory.
 *
 * A Claude Code key keeps its bare filename, so nothing on disk moves: the store
 * holds `abc.json` and this returns `abc` for both `abc` and `claude:abc`.
 *
 * @returns {string} the name, or '' for a key that cannot be stored safely
 */
export function encodeKey(key) {
  const s = String(key || '');
  if (!s) return '';
  const { harness, raw } = parseKey(s);
  const name = harness === LEGACY_HARNESS
    ? escapePart(raw)
    : `${escapePart(harness)}${FILE_SEP}${escapePart(raw)}`;
  return isTraversal(name) ? '' : name;
}

/**
 * The key a filename stands for. The exact inverse of `encodeKey` for every key
 * it produces, including ids carrying `__`, a slash, or a percent sign.
 */
export function decodeKey(name) {
  const s = String(name || '');
  if (!s) return '';
  const at = s.indexOf(FILE_SEP);
  if (at === -1) return sessionKey(LEGACY_HARNESS, unescapePart(s));
  return sessionKey(unescapePart(s.slice(0, at)), unescapePart(s.slice(at + FILE_SEP.length)));
}
