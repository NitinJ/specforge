// Notices: one block component, `.callout`, with a required type class.
//
// The type carries the meaning; the tone follows from the type and is never set
// directly. That split is the whole point. Measured in the store before this
// existed: 640 callouts, 273 of them with no type at all, and 135 distinct
// hand-written opening labels doing the work a type should do. Choosing a color
// is easier than choosing a meaning, so the library removes the choice.
//
// Seven types are the generic documentation set four systems converged on
// (GitHub alerts, Docusaurus, Material for MkDocs, Obsidian). Five name a claim
// a document never makes and a spec always does, and they line up with the
// language contract: every sentence carries a decision, a measurement, a source,
// an assumption, or a specification.

/** Base rules for `.callout` itself, shared by every type. */
export const calloutBase = `.callout{position:relative;border-left:3px solid var(--accent);background:var(--panel);
  border-radius:0 10px 10px 0;padding:12px 16px;margin:16px 0}
.callout::before{display:block;font-size:10.5px;font-weight:700;letter-spacing:.09em;
  text-transform:uppercase;color:var(--accent);margin-bottom:5px}
.callout > :first-of-type{margin-top:0}
.callout > :last-child{margin-bottom:0}`;

/**
 * Tone is the color axis, and it is the only one. Four levels, each a canonical
 * palette token, so a theme variant that overrides the tokens re-tints every
 * notice without knowing any of their names.
 */
export const TONE_CSS = {
  neutral: '',
  positive: `.callout.{name}{border-left-color:var(--green)}
.callout.{name}::before{color:var(--green)}`,
  caution: `.callout.{name}{border-left-color:var(--amber);background:color-mix(in srgb,var(--amber) 7%,var(--panel))}
.callout.{name}::before{color:var(--amber)}`,
  critical: `.callout.{name}{border-left-color:var(--red);background:color-mix(in srgb,var(--red) 8%,var(--panel))}
.callout.{name}::before{color:var(--red)}`,
};

/**
 * @param {object} d
 * @returns {object} a full component definition
 */
function notice(d) {
  const toned = (TONE_CSS[d.tone] || '').replaceAll('{name}', d.name);
  return {
    family: 'notice',
    kind: 'class',
    block: true,
    ...d,
    // The label is generated, never typed. A hand-written label is what drifted
    // into 135 variants, and a generated one cannot.
    css: [toned, `.callout.${d.name}::before{content:"${d.label}"}`, d.extraCss || '']
      .filter(Boolean).join('\n'),
    example: d.example || `<div class="callout ${d.name}">${d.rule}</div>`,
  };
}

export const notices = [
  notice({
    name: 'note', tone: 'neutral', label: 'Note',
    rule: 'Context a reader needs that is not itself a claim about the design.',
    requires: [],
  }),
  notice({
    name: 'tip', tone: 'positive', label: 'Tip',
    rule: 'Advice that makes something easier and is safe to ignore.',
    requires: [],
  }),
  notice({
    name: 'success', tone: 'positive', label: 'Success',
    rule: 'A settled good outcome: a check that passed, a target that was met.',
    requires: [],
  }),
  notice({
    name: 'warning', tone: 'caution', label: 'Warning',
    rule: 'A hazard the reader can avoid by knowing about it.',
    requires: ['what to do instead'],
  }),
  notice({
    name: 'danger', tone: 'critical', label: 'Danger',
    rule: 'An action that breaks something irreversibly.',
    requires: ['what breaks', 'whether it is recoverable'],
  }),
  notice({
    name: 'example', tone: 'neutral', label: 'Example',
    rule: 'A concrete instance of a rule stated elsewhere.',
    requires: ['a reference to the rule'],
  }),
  notice({
    name: 'quote', tone: 'neutral', label: 'Quote',
    rule: 'Words that are somebody else’s, with attribution.',
    requires: ['attribution'],
    // A double edge separates it from the other neutrals without a sixth color.
    extraCss: `.callout.quote{border-left-style:double;border-left-width:6px}
.callout.quote p{font-style:italic}`,
    example: '<div class="callout quote"><p>The port is the singleton.</p><p class="footnote">PR #123</p></div>',
  }),
  notice({
    name: 'decision', tone: 'neutral', label: 'Decision',
    rule: 'A choice made, with the criterion it was made on.',
    requires: ['the criterion', 'the alternative not taken'],
    // Filled, because a decision is the notice a reader comes back to look for.
    // Treatment rather than a sixth color keeps the palette contract (Q5).
    extraCss: '.callout.decision{background:color-mix(in srgb,var(--accent) 8%,var(--panel))}',
    example: '<div class="callout decision">The port is the singleton. <strong>Criterion:</strong> a lockfile cannot be released on SIGKILL. <strong>Not taken:</strong> a pid file with a liveness probe.</div>',
  }),
  notice({
    name: 'assumption', tone: 'caution', label: 'Assumption',
    rule: 'Something believed but not verified.',
    requires: ['what would falsify it'],
    example: '<div class="callout assumption">34 components cover what specs need. <strong>Falsified by:</strong> an author reaching for a class outside the registry.</div>',
  }),
  notice({
    name: 'risk', tone: 'caution', label: 'Risk',
    rule: 'A specific way this can fail, named precisely enough to design against.',
    requires: ['the trigger', 'the consequence'],
    example: '<div class="callout risk">The stamped block is hand-edited. <strong>Trigger:</strong> styling a one-off inside the markers. <strong>Consequence:</strong> the next sync overwrites it.</div>',
  }),
  notice({
    name: 'deviation', tone: 'critical', label: 'Deviation',
    rule: 'A departure from a stated principle, house rule, or existing pattern.',
    requires: ['a quote of what is departed from', 'why'],
    example: '<div class="callout deviation"><strong>Departs from:</strong> the quoted rule. <strong>Why:</strong> the reason.</div>',
  }),
  notice({
    name: 'constraint', tone: 'neutral', label: 'Constraint',
    rule: 'A fixed limit the design works within and cannot change.',
    requires: ['the limit', 'its unit', 'where it comes from'],
    // Dashed, because a limit is a boundary.
    extraCss: '.callout.constraint{border-left-style:dashed}',
    example: '<div class="callout constraint">A spec renders from file:// with no network. <strong>Source:</strong> house rules, Format.</div>',
  }),
];
