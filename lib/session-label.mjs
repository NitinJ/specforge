// Display label for the session that owns a spec. Claude Code (CLI) doesn't
// persist a human-readable session name, and a derived "folder · first prompt"
// label read poorly, so we just show the short session id.

/** `session <8-char id>` when owned, or null when the spec is free. */
export function sessionDisplay(meta) {
  if (!meta || !meta.attachedSession) return null;
  return 'session ' + String(meta.attachedSession).slice(0, 8);
}
