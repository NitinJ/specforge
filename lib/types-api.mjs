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

import { addCustomType, specType, slugify, SHELLS, templateIdFor } from './spec-types.mjs';
import { ensureTemplates } from './store-templates.mjs';
import { requestGenerate, MAX_PROMPT } from './store-generate.mjs';
import { liveSessions, attach } from './attach.mjs';
import { readMeta } from './meta.mjs';

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
      // A kind whose template spec is somehow gone reads as done rather than
      // stuck: there is nothing left to wait for, and the dialog's way out is
      // to open it.
      generate: (meta && meta.generate) || { state: 'done' },
    },
  };
}
