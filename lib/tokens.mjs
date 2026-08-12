// Publication tokens.
//
// A published spec is addressed at <origin>/s/<token>. Once the origin is shared
// with one reviewer it is known to everyone who has any link, so the token is
// the only thing separating one published spec from another, and the only thing
// separating a published spec from an unpublished one.
//
// A spec id is not usable here: it is 10 hex characters and appears in
// owner-facing URLs, CLI arguments and the index page, so it is neither secret
// nor long enough to resist guessing.

import { randomBytes } from 'node:crypto';

export const TOKEN_BYTES = 16;
export const TOKEN_LENGTH = TOKEN_BYTES * 2;

const TOKEN_RE = new RegExp(`^[0-9a-f]{${TOKEN_LENGTH}}$`);

/** @returns {string} a fresh token, lowercase hex */
export function newToken() {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

/**
 * Whether a value is shaped like a token this module minted.
 *
 * Anchored and exact-length so nothing a request path can carry (a spec id, a
 * traversal, a token with trailing whitespace) reaches a lookup.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isToken(value) {
  return typeof value === 'string' && TOKEN_RE.test(value);
}
