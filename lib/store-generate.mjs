// Template-generation relay. The browser asks for a template, a Claude session
// writes it.
//
// The daemon runs no model, so "Add a template" is a relay in the same shape as
// the Google Docs export beside it (store-export.mjs): the route stamps a
// one-shot request on meta.generate, the session's hooks surface it and route
// Claude to the generate-template skill, and the skill reports the
// result back through the CLI. The state rides the template spec's own meta so
// it reaches the browser on the /meta poll the page already makes.
//
// Lifecycle:  requested → working → done | error
//
// The prompt stays on the meta after the request finishes. It is the only record
// of how a template was asked for, and the form that carried it is gone by then.
//
// Spec 45395008a2, task 2.1.

import { readMeta, writeMeta } from './meta.mjs';
import { specsForSession } from './attach.mjs';

/** Longest prompt kept. Past this it is a spec, not a description of one. */
export const MAX_PROMPT = 4000;

/**
 * Queue generation of `id`'s template from `prompt` (the browser route).
 *
 * @param {string} id the template spec's store id
 * @param {string} prompt what the user typed
 * @returns {object} meta.generate
 */
export function requestGenerate(id, prompt, now = new Date().toISOString()) {
  const meta = readMeta(id);
  if (!meta) throw new Error(`unknown spec ${id}`);
  const text = String(prompt == null ? '' : prompt).trim().slice(0, MAX_PROMPT);
  // Refused rather than defaulted: a request with no prompt would send the skill
  // to write a template from nothing, and it would produce something.
  if (!text) throw new Error('a prompt is required to generate a template');
  meta.generate = { state: 'requested', prompt: text, requestedAt: now };
  return writeMeta(id, meta).generate;
}

/**
 * Template specs a session owns whose generation is still waiting for it.
 *
 * Read-only. The hook advances them via markGenerateWorking as it surfaces
 * them, so a re-Stop never re-nudges, exactly as the export relay does.
 */
export function generateRequestsForSession(sessionId) {
  return specsForSession(sessionId)
    .map((id) => readMeta(id))
    .filter((m) => m && m.generate && m.generate.state === 'requested');
}

/**
 * Advance requested → working (the hook on surface, or the skill on start).
 *
 * Returns false for anything not currently `requested`, which is what keeps a
 * request from being surfaced twice (I5): a second surface would re-run the
 * skill over a template the user may already have edited.
 */
export function markGenerateWorking(id) {
  const meta = readMeta(id);
  if (!meta || !meta.generate || meta.generate.state !== 'requested') return false;
  meta.generate.state = 'working';
  writeMeta(id, meta);
  return true;
}

/**
 * Record the outcome: written (done) or an error message.
 *
 * Accepts a finish from any state, including one no hook ever advanced. The
 * skill may report before a hook ran, and refusing that would discard a result
 * that already exists on disk.
 */
export function finishGenerate(id, { error } = {}, now = new Date().toISOString()) {
  const meta = readMeta(id);
  if (!meta) throw new Error(`unknown spec ${id}`);
  const prompt = (meta.generate && meta.generate.prompt) || '';
  const requestedAt = (meta.generate && meta.generate.requestedAt) || now;
  meta.generate = error
    ? { state: 'error', error: String(error), prompt, requestedAt, at: now }
    : { state: 'done', prompt, requestedAt, at: now };
  return writeMeta(id, meta).generate;
}

/** Instruction text routing Claude to the generate-template skill. */
export function generateReason(metas) {
  const lines = metas.map((m) => `  - ${m.id} (kind "${m.type}")\n      prompt: ${m.generate.prompt}`);
  return [
    `SpecForge: ${metas.length} template(s) waiting to be written:`,
    ...lines,
    '',
    'Run the generate-template skill now for each: turn the prompt into',
    'the template spec\'s HTML, lint it, then report back with',
    'specforge template-done <id> (or --error "<msg>" if it cannot be written).',
    'The user is watching a dialog until this finishes.',
  ].join('\n');
}
