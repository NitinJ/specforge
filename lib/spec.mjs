// Tolerant parsing + structural checks for SpecForge spec HTML.
//
// SpecForge owns the spec format, so lightweight regex parsing is sufficient and
// keeps the plugin dependency-free. Specs do not nest <section> elements, which
// makes section extraction unambiguous.

/** Read an HTML attribute value out of an element's attribute string. */
export function getAttr(attrs, name) {
  const m = attrs.match(new RegExp(`\\b${name}="([^"]*)"`));
  return m ? m[1] : null;
}

/** All `<section id="…">` ids, in document order (may contain duplicates). */
export function getSectionIds(html) {
  const ids = [];
  const re = /<section\b[^>]*\bid="([^"]+)"/g;
  let m;
  while ((m = re.exec(html))) ids.push(m[1]);
  return ids;
}

/** Section ids that appear more than once. */
export function duplicateSectionIds(html) {
  const seen = new Set();
  const dups = new Set();
  for (const id of getSectionIds(html)) {
    if (seen.has(id)) dups.add(id);
    seen.add(id);
  }
  return [...dups];
}

/** Inner HTML of a `<section id="…">…</section>` (first match), or null. */
export function sectionBody(html, id) {
  const m = html.match(
    new RegExp(`<section\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</section>`)
  );
  return m ? m[1] : null;
}

/**
 * Which of `required` section ids are present / missing.
 * @returns {{present:string[], missing:string[]}}
 */
export function requiredSectionStatus(html, required) {
  const have = new Set(getSectionIds(html));
  const present = [];
  const missing = [];
  for (const id of required) (have.has(id) ? present : missing).push(id);
  return { present, missing };
}

/**
 * Check the light/dark theme contract every spec must satisfy. The spec ships
 * the theme CSS (light/dark vars, a [data-theme] override, prefers-color-scheme);
 * applying + persisting the choice is the review layer's job, so there's no
 * in-spec toggle / localStorage requirement.
 * @returns {{ok:boolean, missing:string[]}}
 */
export function checkThemeContract(html) {
  const checks = {
    'css-variables': /:root\s*\{[\s\S]*?--bg\s*:/.test(html),
    'light-override': /\[data-theme=["']light["']\]/.test(html) || html.includes('data-theme="light"'),
    'prefers-color-scheme': html.includes('prefers-color-scheme'),
  };
  const missing = Object.entries(checks).filter(([, ok]) => !ok).map(([k]) => k);
  return { ok: missing.length === 0, missing };
}

/**
 * Parse the structured implementation plan into stages and tasks.
 * @returns {{stage:string, pr:string|null, tasks:{id:string, status:string}[]}[]}
 */
export function parsePlan(html) {
  const plan = sectionBody(html, 'impl-plan');
  if (!plan) return [];
  const stages = [];
  let current = null;
  const tagRe = /<li\b([^>]*\bdata-sf-(?:stage|task)="[^"]*"[^>]*)>/g;
  let m;
  while ((m = tagRe.exec(plan))) {
    const attrs = m[1];
    const stage = getAttr(attrs, 'data-sf-stage');
    if (stage !== null) {
      current = { stage, pr: getAttr(attrs, 'data-sf-pr'), tasks: [] };
      stages.push(current);
      continue;
    }
    const task = getAttr(attrs, 'data-sf-task');
    if (task !== null) {
      const entry = { id: task, status: getAttr(attrs, 'data-sf-status') || 'todo' };
      if (current) current.tasks.push(entry);
      else stages.push({ stage: null, pr: null, tasks: [entry] });
    }
  }
  return stages;
}

/** True if the plan has at least one stage and one task with a status. */
export function hasStructuredPlan(html) {
  const plan = parsePlan(html);
  return plan.some((s) => s.tasks.length > 0);
}

/** Strip HTML tags and collapse whitespace. */
function stripTags(s) {
  return s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** The spec's display title (from <title>, with a trailing " — Spec" removed). */
export function getTitle(html) {
  const m = html.match(/<title>([\s\S]*?)<\/title>/i);
  if (!m) return 'Untitled spec';
  return stripTags(m[1]).replace(/\s*[—-]\s*Spec\s*$/i, '').trim() || 'Untitled spec';
}

/**
 * The spec's lifecycle status. Prefers an explicit `data-sf-spec-status` on the
 * root element, then the header status badge, defaulting to "draft".
 */
export function getStatus(html) {
  const attr = html.match(/<html\b[^>]*\bdata-sf-spec-status="([^"]+)"/i);
  if (attr) return attr[1].trim();
  const badge = html.match(/status:\s*<span[^>]*>([\s\S]*?)<\/span>/i);
  if (badge) return stripTags(badge[1]);
  return 'draft';
}
