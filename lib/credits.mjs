// Who wrote a spec and which agents reviewed it.
//
// An agent is named by its harness and its model: (claude, claude-fable-5-1),
// (codex, gpt-6-astra), (pi, glm-5.3-flash). Both are stored on meta.json, as
// `author` (one agent) and `reviewers` (a list), each {harness, model}.
//
// The harness is detected, the same way reply attribution detects it. The model
// is what the agent says it is: no harness hands its model id to a subprocess
// reliably, and the agent always knows its own. A credit with no model is kept
// rather than refused, because "written by Codex" is still true and useful.
//
// Both fields default to absent and are read as `m.author || null` and
// `m.reviewers || []`, so a meta.json written before this needs no migration.

import { readMeta, mutateMeta } from './meta.mjs';
import { resolveHarness } from './harness-context.mjs';

export const CREDIT_ROLES = ['author', 'reviewer'];

/** A value from argv or env, cut to what can be shown safely in a chip. */
function clean(value, max) {
  return String(value ?? '').trim().replace(/[^\w.:@+\-/ ]/g, '').slice(0, max);
}

/**
 * The glyph each harness wears on its credit chip, beside its colour. A harness
 * SpecForge does not know gets a plain dot and the neutral colour.
 */
const MARKS = { claude: '✳', codex: '◆', pi: 'π' };

/** The harness as a CSS class key: a known harness, or "other". */
export function harnessKey(harness) {
  return Object.hasOwn(MARKS, harness) ? harness : 'other';
}

/** The glyph for a harness's credit chip. */
export function harnessMark(harness) {
  return MARKS[harnessKey(harness)] || '•';
}

/** "claude" reads as "Claude". Every harness name is one lowercase word. */
export function harnessLabel(harness) {
  const h = String(harness || '');
  return h.charAt(0).toUpperCase() + h.slice(1);
}

/**
 * A --harness flag, normalized, or '' when none was given. Throws on a name
 * SpecForge does not know: resolveHarness would drop it and fall back to
 * detection, recording a wrong credit that persists.
 */
export function checkHarnessFlag(harness) {
  const flag = clean(harness, 20).toLowerCase();
  if (flag && resolveHarness({}, flag) !== flag) {
    throw new Error(`unknown harness "${flag}"`);
  }
  return flag;
}

/**
 * The agent running this command, as a credit.
 *
 * @param {{harness?:string, model?:string}} [explicit] flags, which win
 * @param {object} [env] process env; SPECFORGE_MODEL is the fallback for model
 * @returns {{harness:string, model:string|null}}
 */
export function agentIdentity({ harness, model } = {}, env = process.env) {
  const flag = checkHarnessFlag(harness);
  const h = clean(resolveHarness(env, flag), 20).toLowerCase();
  const m = clean(model || env.SPECFORGE_MODEL || '', 80);
  return { harness: h, model: m || null };
}

/** "Claude · claude-fable-5-1", or "Claude" when the model is unknown. */
export function creditLabel(agent) {
  if (!agent || !agent.harness) return '';
  return agent.model ? `${harnessLabel(agent.harness)} · ${agent.model}` : harnessLabel(agent.harness);
}

/** Same harness and same model. A missing model matches only a missing model. */
export function sameAgent(a, b) {
  return !!a && !!b && a.harness === b.harness && (a.model || null) === (b.model || null);
}

/**
 * Whether this agent is the spec's author. The same harness with a model
 * missing on either side counts: a wrong reviewer credit is worse than a
 * missing one.
 */
export function isAuthor(author, agent) {
  if (!author || !agent) return false;
  return sameAgent(author, agent)
    || (author.harness === agent.harness && (!author.model || !agent.model));
}

/**
 * The reviewer list with this agent in it, or null when nothing changes.
 *
 * One entry per agent. A credit that names the model replaces an earlier one
 * from the same harness that did not, and a credit with no model adds nothing
 * when that harness is already listed: it is less information about someone
 * already credited.
 */
function withReviewer(list, agent) {
  const out = Array.isArray(list) ? list.filter((r) => r && r.harness) : [];
  if (out.some((r) => sameAgent(r, agent))) return null;
  if (!agent.model && out.some((r) => r.harness === agent.harness)) return null;
  const vague = out.findIndex((r) => r.harness === agent.harness && !r.model);
  if (agent.model && vague !== -1) {
    out[vague] = agent;
    return out;
  }
  out.push(agent);
  return out;
}

/**
 * Record an agent as a spec's author or as one of its reviewers.
 *
 * The author is one agent and a new author credit replaces it. Reviewers
 * accumulate. Writes only when something changed, so a repeated credit does not
 * move the spec's `updated` time on the home page.
 *
 * @returns {object} the spec's meta after the write
 */
export function recordCredit(id, role, agent) {
  if (!CREDIT_ROLES.includes(role)) {
    throw new Error(`role must be one of: ${CREDIT_ROLES.join(', ')}`);
  }
  if (!agent || !agent.harness) throw new Error('a credit needs a harness');
  if (!readMeta(id)) throw new Error(`unknown spec ${id}`);
  const who = { harness: agent.harness, model: agent.model || null };
  // Two agents replying at once would each read the same list and the second
  // write would drop the first credit. Serialized on meta.lock, not the comments
  // lock it used to take: a credit is written to meta.json, and the watcher beat
  // holds meta.lock, so the comments lock left the beat free to race it.
  // Returning nothing writes nothing, which is what keeps a repeated credit from
  // moving the spec's `updated` time.
  return mutateMeta(id, (meta) => {
    if (role === 'author') {
      return sameAgent(meta.author, who) ? null : { ...meta, author: who };
    }
    const next = withReviewer(meta.reviewers, who);
    return next ? { ...meta, reviewers: next } : null;
  });
}
