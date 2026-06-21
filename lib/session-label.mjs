// A friendly label for the session that owns a spec, instead of a raw uuid.
//
// Claude Code (CLI) doesn't persist a human-readable session name on disk, so we
// derive one ourselves from what IS reliably available: the project folder the
// session runs in (captured at attach) and its first prompt (captured by the
// UserPromptSubmit hook) — e.g.  workspace · "improve the home page".

/** One-line, length-bounded snippet of a prompt (collapses whitespace). */
export function promptSnippet(text, max = 60) {
  if (typeof text !== 'string') return '';
  const s = text.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
}

/**
 * Display label for a spec's owning session, or null when the spec is free.
 * Prefers `folder · "first prompt"`; falls back to the short id if neither part
 * was captured (e.g. attached before this feature, or a session with no prompt).
 */
export function sessionDisplay(meta) {
  if (!meta || !meta.attachedSession) return null;
  const parts = [];
  if (meta.sessionCwd) parts.push(meta.sessionCwd);
  if (meta.sessionPrompt) parts.push('"' + meta.sessionPrompt + '"');
  return parts.length ? parts.join(' · ') : 'session ' + String(meta.attachedSession).slice(0, 8);
}
