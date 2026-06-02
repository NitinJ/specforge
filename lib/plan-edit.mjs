// Surgical edits to a spec's machine-readable state: task status, stage PR, and
// the document status. Attribute-order tolerant; these keep the spec the
// canonical source of truth during implementation.

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Set `data-sf-status` on the task whose `data-sf-task` matches taskId. */
export function setTaskStatus(html, taskId, status) {
  const id = escapeRe(taskId);
  const after = new RegExp(`(<li\\b[^>]*\\bdata-sf-task="${id}"[^>]*\\bdata-sf-status=")[^"]*(")`);
  if (after.test(html)) return html.replace(after, `$1${status}$2`);
  const before = new RegExp(`(<li\\b[^>]*\\bdata-sf-status=")[^"]*("[^>]*\\bdata-sf-task="${id}")`);
  if (before.test(html)) return html.replace(before, `$1${status}$2`);
  return html;
}

/** Set (or add) `data-sf-pr` on the stage whose `data-sf-stage` matches stage. */
export function setStagePr(html, stage, pr) {
  const s = escapeRe(stage);
  const existing = new RegExp(`(<li\\b[^>]*\\bdata-sf-stage="${s}"[^>]*\\bdata-sf-pr=")[^"]*(")`);
  if (existing.test(html)) return html.replace(existing, `$1${pr}$2`);
  const stageTag = new RegExp(`(<li\\b[^>]*\\bdata-sf-stage="${s}")`);
  if (stageTag.test(html)) return html.replace(stageTag, `$1 data-sf-pr="${pr}"`);
  return html;
}

/** Set the document status: the `data-sf-spec-status` root attribute + header badge. */
export function setSpecStatus(html, status) {
  let out;
  if (/<html\b[^>]*\bdata-sf-spec-status="/.test(html)) {
    out = html.replace(/(<html\b[^>]*\bdata-sf-spec-status=")[^"]*(")/, `$1${status}$2`);
  } else {
    out = html.replace(/<html\b/, `<html data-sf-spec-status="${status}"`);
  }
  // Header badge: `status: <span …>TEXT</span>`
  out = out.replace(/(status:\s*<span[^>]*>)[\s\S]*?(<\/span>)/, `$1${status}$2`);
  return out;
}
