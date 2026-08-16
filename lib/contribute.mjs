// Listing one of your specs in someone else's shared project.
//
// Two callers do this: the CLI (`specforge contribute`) and the daemon, behind
// the spec menu's "Add to a shared project". They differ only in how the spec
// gets published — the CLI asks the daemon over HTTP, the daemon does it
// in-process — so that step is injected and everything after it lives here.
// Kept in one place because the after-steps are the subtle ones: registering
// with the creator, remembering the token the entry is keyed by, and retiring
// whatever a previous rotate left behind.

import { parseShareUrl } from './store-subscriptions.mjs';
import {
  rememberContribution, contributedToken, staleTokens, forgetContribution,
} from './store-contributed.mjs';

/**
 * Ask a creator to drop entries under these spec tokens.
 *
 * A failed delete is returned rather than swallowed: the caller keeps owing it,
 * so a stale entry never outlives the only record of its key.
 *
 * @returns {Promise<string[]>} the tokens still not retired
 */
async function retireEntries(fetchImpl, parsed, tokens) {
  const failed = [];
  for (const t of tokens) {
    try {
      const r = await fetchImpl(`${parsed.origin}/p/${parsed.token}/contribute/${t}`, {
        method: 'DELETE',
      });
      if (!r.ok) failed.push(t);
    } catch {
      failed.push(t);
    }
  }
  return failed;
}

/**
 * Publish a spec (via `share`) and register a pointer to it with a project's
 * creator.
 *
 * @param {object} opts
 * @param {string} opts.specId
 * @param {string} opts.projectUrl the creator's `<origin>/p/<token>`
 * @param {string} opts.title what to list it as
 * @param {string} [opts.owner] the contributor's display name
 * @param {() => Promise<{token:string, url:string}>} opts.share publishes the
 *   spec and returns its own token and public URL
 * @param {Function} [opts.fetchImpl]
 */
export async function contributeSpec({
  specId, projectUrl, title, owner, share, fetchImpl = fetch,
}) {
  const parsed = parseShareUrl(projectUrl);
  if (!parsed) throw new Error('contribute: expected a project share URL, <origin>/p/<token>');

  // Published first: an entry pointing at an unpublished spec is a dead link on
  // someone else's page, and sharing is idempotent so this is safe to repeat.
  const mine = await share();
  if (!mine || !mine.url) {
    throw new Error('contribute: this spec has no public URL yet (is the tunnel up?)');
  }
  const myOrigin = new URL(mine.url).origin;

  const r = await fetchImpl(`${parsed.origin}/p/${parsed.token}/contribute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin: myOrigin,
      token: mine.token,
      title: title || 'Untitled',
      // Self-declared, like every display name here: a session label is a
      // machine detail rather than a person.
      owner: owner || 'someone',
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `contribute failed (${r.status})`);

  const where = { origin: parsed.origin, token: parsed.token, specId };
  // Everything this spec was listed under before now: the token from the last
  // contribute, plus anything a previous run could not retire.
  const owed = [...new Set([contributedToken(where), ...staleTokens(where)].filter(Boolean))]
    .filter((t) => t !== mine.token);
  const stillOwed = await retireEntries(fetchImpl, parsed, owed);

  rememberContribution({ ...where, specToken: mine.token, stale: stillOwed });
  return {
    ok: true,
    id: specId,
    project: parsed.origin,
    token: mine.token,
    url: mine.url,
    replaced: owed.filter((t) => !stillOwed.includes(t)),
    unretired: stillOwed,
  };
}

/**
 * Take a spec back out of a project.
 *
 * Withdrawn by the token it was REGISTERED under, which the local record
 * remembers: a rotate since then changed the spec's current token, and the
 * entry over there still names the old one.
 *
 * @param {() => string|null} opts.currentToken the spec's share token on disk,
 *   used only for an entry registered before the local record existed
 */
export async function withdrawSpec({
  specId, projectUrl, currentToken, fetchImpl = fetch,
}) {
  const parsed = parseShareUrl(projectUrl);
  if (!parsed) throw new Error('withdraw: expected a project share URL, <origin>/p/<token>');

  const where = { origin: parsed.origin, token: parsed.token, specId };
  const token = contributedToken(where) || (currentToken ? currentToken() : null);
  if (!token) {
    throw new Error(`withdraw: ${specId} was never shared, so it cannot be listed anywhere`);
  }

  const r = await fetchImpl(`${parsed.origin}/p/${parsed.token}/contribute/${token}`, {
    method: 'DELETE',
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `withdraw failed (${r.status})`);

  // Anything an earlier rotate left behind goes with it; what still will not
  // retire is kept, so the row is only forgotten once nothing is owed.
  const stillOwed = await retireEntries(fetchImpl, parsed, staleTokens(where));
  if (stillOwed.length) {
    rememberContribution({ ...where, specToken: token, stale: stillOwed });
  } else {
    forgetContribution(where);
  }
  return { ok: true, id: specId, removed: !!body.removed, unretired: stillOwed };
}
