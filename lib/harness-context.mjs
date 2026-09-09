import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const CLAUDE_HARNESS = 'claude';
export const PI_HARNESS = 'pi';
export const CODEX_HARNESS = 'codex';

const HARNESSES = new Set([CLAUDE_HARNESS, PI_HARNESS, CODEX_HARNESS]);

/** Resolve the host without treating a compatibility alias as host identity. */
export function resolveHarness(env = process.env, explicit = '') {
  if (HARNESSES.has(explicit)) return explicit;
  if (HARNESSES.has(env.SPECFORGE_HARNESS)) return env.SPECFORGE_HARNESS;
  if (env.CODEX_THREAD_ID || env.CODEX_SESSION_ID) return CODEX_HARNESS;
  if (env.CLAUDE_CODE_SESSION_ID) return CLAUDE_HARNESS;
  if (env.PLUGIN_ROOT) return CODEX_HARNESS;
  return CLAUDE_HARNESS;
}

/** Resolve one owning session. Hook payloads and explicit CLI flags win. */
export function resolveSessionId(env = process.env, explicit) {
  if (explicit !== undefined && explicit !== null) return String(explicit);
  return env.SPECFORGE_SESSION_ID
    || env.CODEX_THREAD_ID
    || env.CODEX_SESSION_ID
    || env.CLAUDE_CODE_SESSION_ID
    || '';
}

/** Resolve an installed plugin root without requiring Markdown shell expansion. */
export function resolvePluginRoot(env = process.env, explicit = '') {
  return explicit
    || env.SPECFORGE_PLUGIN_ROOT
    || env.PLUGIN_ROOT
    || env.CLAUDE_PLUGIN_ROOT
    || '';
}

/** Stable filename key which preserves every existing safe session filename. */
export function sessionKey(sessionId) {
  if (/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(sessionId || '')) return sessionId;
  return `encoded~${Buffer.from(String(sessionId || ''), 'utf8').toString('base64url')}`;
}

/** Reverse a filename key so session listings retain the native owner id. */
export function sessionIdFromKey(key) {
  if (!String(key).startsWith('encoded~')) return key;
  try { return Buffer.from(String(key).slice('encoded~'.length), 'base64url').toString('utf8'); }
  catch { return ''; }
}

/** Display attribution for new agent replies. */
export function agentAuthor(env = process.env, explicit = '') {
  return resolveHarness(env, explicit);
}

/** True when an ES module is the process entry, including paths with spaces. */
export function isDirectRun(metaUrl, argvPath = process.argv[1]) {
  return !!argvPath && metaUrl === pathToFileURL(resolve(argvPath)).href;
}
