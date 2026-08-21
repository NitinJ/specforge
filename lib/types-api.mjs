// The two routes behind "Add a template" on the configuration page.
//
// POST /api/types      create a kind, its template spec, and the request to
//                      write it
// GET  /api/types/:slug what the waiting dialog polls
//
// Both return {status, body} rather than writing to a response, so the daemon
// owns the socket and this owns the decision. Same split as prompts-api and
// template-blocks-api beside it.
//
// The order inside create matters more than it looks: everything that can be
// refused is refused before the first write, so a refusal leaves no kind that
// half exists (I3). The one thing that cannot be checked in advance is whether
// the session survives the next millisecond, and that failure is recoverable
// because the request is surfaced again whenever that session next settles.
//
// Spec 45395008a2, tasks 3.1, 3.2, 3.3.

import { rmSync } from 'node:fs';

import {
  addCustomType, removeCustomType, specType, slugify, SHELLS, templateIdFor,
} from './spec-types.mjs';
import { ensureTemplates } from './store-templates.mjs';
import { requestGenerate, MAX_PROMPT } from './store-generate.mjs';
import { liveSessions, attach } from './attach.mjs';
import { readMeta, specsOfType } from './meta.mjs';
import { specDir } from './store-paths.mjs';

/** What to tell someone whose store has no agent listening. */
const NO_SESSION = 'No Claude Code session is listening. Start one in the SpecForge '
  + 'directory and arm its review watcher (specforge wait-batch), then try again.';

/** The path a template spec is read at. */
const specUrlFor = (id) => `/spec/${id}`;

/**
 * Create a custom kind and queue its template for writing.
 *
 * @param {{name?:string, prompt?:string, shell?:string}} body
 * @returns {{status:number, body:object}}
 */
export function handleTypeCreate(body = {}) {
  const name = typeof body.name === 'string' ? body.name : '';
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const shell = body.shell === undefined ? 'doc' : body.shell;

  // Validated in the order that costs least first, and all of it before any
  // write. A name that makes no slug and a store with no session are both
  // ordinary states, not exceptions.
  const slug = slugify(name);
  if (!slug) {
    return { status: 400, body: { error: `name ${JSON.stringify(name)} does not make a usable slug` } };
  }
  if (!prompt) {
    return { status: 400, body: { error: 'a prompt is required: it is what the template is written from' } };
  }
  if (prompt.length > MAX_PROMPT) {
    return { status: 400, body: { error: `prompt is longer than ${MAX_PROMPT} characters` } };
  }
  if (!SHELLS.includes(shell)) {
    return { status: 400, body: { error: `shell must be one of: ${SHELLS.join(', ')}` } };
  }
  if (specType(slug)) {
    return { status: 409, body: { error: `the kind "${slug}" already exists` } };
  }
  const [session] = liveSessions();
  if (!session) {
    return { status: 503, body: { error: NO_SESSION } };
  }

  let kind;
  try {
    kind = addCustomType({ name, whenToUse: prompt, shell });
  } catch (e) {
    // addCustomType re-checks what is checked above, plus the reserved ids this
    // does not know about. Its message is the specific one.
    return { status: 409, body: { error: e.message } };
  }

  // Seeds the template spec for the kind just added, and leaves every existing
  // template alone: ensureTemplates has always skipped what already exists.
  ensureTemplates();
  const templateId = templateIdFor(kind.slug);
  attach(templateId, session);
  const generate = requestGenerate(templateId, prompt);

  return {
    status: 201,
    body: {
      slug: kind.slug,
      label: kind.label,
      shell: kind.shell,
      templateId,
      specUrl: specUrlFor(templateId),
      session,
      generate,
    },
  };
}

/**
 * What the waiting dialog polls.
 *
 * Custom kinds only. A built-in has no generation state, so answering for one
 * would hand the dialog something it cannot wait on; the Templates tab already
 * lists the built-ins from the store.
 */
/**
 * Remove a custom kind, and the template spec that belongs to it.
 *
 * Counts first. A kind still carried by specs cannot go: their `type` would name
 * nothing, defaultMeta would read them as `general` on the next write, and they
 * would change shape without anyone asking (I6). The count rides in the answer
 * so the page can say how many rather than "some".
 *
 * Destroying the template spec is the one place this product breaks the rule
 * that a template spec is never destroyed, argued in §4 and approved as D8. It
 * is scoped to custom kinds by the built-in refusal below, which is why that
 * refusal is here as well as in removeCustomType.
 *
 * @returns {{status:number, body:object}}
 */
export async function handleTypeDelete(slug, { revoke } = {}) {
  const kind = specType(slug);
  if (!kind) return { status: 404, body: { error: `unknown kind ${JSON.stringify(slug)}` } };
  if (kind.builtin) {
    return { status: 403, body: { error: `"${slug}" is a built-in kind and cannot be removed` } };
  }

  const inUse = specsOfType(slug);
  if (inUse.length) {
    return {
      status: 409,
      body: {
        error: `${inUse.length} spec${inUse.length === 1 ? '' : 's'} still use this kind. `
          + 'Change their type, or delete them, before removing it.',
        inUse: inUse.length,
      },
    };
  }

  const templateId = templateIdFor(slug);

  // Every refusal is behind us, so revoking now cannot unpublish a template that
  // is going to survive. The barrier wrapped the whole handler at first, which
  // meant a 403 or a 409 had already taken the link down (raised in review of
  // PR #228). It is passed in rather than imported because the registry lives on
  // the daemon instance that owns the tunnel.
  const commit = () => remove(slug, templateId);
  return revoke ? revoke(templateId, commit) : commit();
}

/** The destructive half, once nothing is left to refuse. */
function remove(slug, templateId) {
  // The spec first, then the row.
  //
  // Reversed from the obvious order on purpose. Removing the row first and then
  // failing to remove the directory reports a 200 for a kind that is half gone:
  // no row, but a template spec still on the index. Doing the fallible part
  // first means a failure there leaves everything exactly as it was, which is
  // the rule create already follows (I3).
  //
  // Nothing is detached first. The session record is a reverse index and
  // meta.attachedSession is the source of truth (attach.mjs L21-24), so once the
  // directory is gone specsForSession filters the entry out by itself. Detaching
  // ahead of a step that can fail would leave a surviving template unattached,
  // which is a mutation the refusal was supposed to prevent.
  try {
    rmSync(specDir(templateId), { recursive: true, force: true });
  } catch (e) {
    return {
      status: 500,
      body: { error: `could not remove the template spec: ${e.message}` },
    };
  }
  const removedRow = removeCustomType(slug);

  return {
    status: 200,
    body: { slug, removed: { row: removedRow, templateId } },
  };
}

export function handleTypeGet(slug) {
  const kind = specType(slug);
  if (!kind || kind.builtin) return { status: 404, body: { error: `unknown kind ${JSON.stringify(slug)}` } };
  const templateId = templateIdFor(kind.slug);
  const meta = readMeta(templateId);
  return {
    status: 200,
    body: {
      slug: kind.slug,
      label: kind.label,
      shell: kind.shell,
      templateId,
      specUrl: specUrlFor(templateId),
      // A kind whose template spec is missing or unreadable is an error, not a
      // completion. Reporting done would send the dialog to a spec that answers
      // 404, and would bury a real generation error behind a success (raised in
      // review of PR #224). It needs the spec directory to have been removed by
      // hand, so the message says where to look rather than what to click.
      generate: (meta && meta.generate) || {
        state: meta ? 'done' : 'error',
        error: meta ? undefined : `the template spec ${templateId} is missing from the store`,
      },
    },
  };
}
