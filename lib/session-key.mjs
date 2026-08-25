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
 * The filename a key is stored under, with no character a filesystem reserves.
 *
 * A legacy record keeps its bare filename, so nothing on disk moves: the store
 * holds `abc.json` and this returns `abc` for both `abc` and `claude:abc`.
 */
export function encodeKey(key) {
  const s = String(key || '');
  if (!s) return '';
  const { harness, raw } = parseKey(s);
  if (harness === LEGACY_HARNESS) return raw;
  return `${harness}${FILE_SEP}${raw}`;
}

/**
 * The key a filename stands for. The inverse of `encodeKey` for every key it
 * produces.
 */
export function decodeKey(name) {
  const s = String(name || '');
  if (!s) return '';
  const at = s.indexOf(FILE_SEP);
  if (at === -1) return sessionKey(LEGACY_HARNESS, s);
  return sessionKey(s.slice(0, at), s.slice(at + FILE_SEP.length));
}
