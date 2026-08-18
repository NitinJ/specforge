// Headings: the outline a reader navigates by.
//
// Measured across the 133 specs in the store before this family existed: 1,431
// h2, 1,358 h3, 1,601 h4 and 146 h5, with no definition anywhere of what any of
// them meant. The styling had held together by copying — 117 specs shared one h2
// rule — but nothing said which level to reach for, so h4 drifted between a real
// subdivision and a decorative kicker, and h5 was used 146 times while no shell
// styled it at all.
//
// Three levels carry the outline and one is a label:
//
//   h2  section          numbered, separated by a rule, the spine of the document
//   h3  subsection       a division of a section, still part of the outline
//   h4  sub-subsection   the deepest navigable level
//   h5  label            a kicker over a run of prose; NOT in the outline
//
// The contents rail lists h2, h3 and h4 and stops. That is the same boundary the
// rail enforces in review.js (TOC_DEEPEST), stated here because this is where an
// author looks to find out which level to write.

export const headings = [
  {
    name: 'h2', family: 'heading', kind: 'element', block: true,
    rule: 'A section: one of the numbered parts the spec is built from. Always titles a section element, and is the level the contents rail treats as the spine.',
    requires: ['a section element to title'],
    css: `h2{font-size:21px;margin:56px 0 14px;padding-top:12px;border-top:1px solid var(--line)}
main > section:first-of-type > h2,main > h2:first-of-type{border-top:none;margin-top:18px}`,
    example: '<section id="design"><h2>4 · Design</h2><p>The shape of it.</p></section>',
  },
  {
    name: 'h3', family: 'heading', kind: 'element', block: true,
    rule: 'A subsection: a division of a section big enough that a reader would navigate to it. In the contents rail, nested under its section.',
    requires: [],
    css: 'h3{font-size:16.5px;margin:34px 0 8px}',
    example: '<h3>4.1 · Where the boundary sits</h3>',
  },
  {
    name: 'h4', family: 'heading', kind: 'element', block: true,
    rule: 'A sub-subsection: the deepest level the contents rail lists. Reach for it when a subsection has parts worth navigating to; if they are not worth navigating to, they are a label.',
    requires: [],
    css: 'h4{font-size:15px;margin:24px 0 6px;font-weight:650}',
    example: '<h4>Counting method</h4>',
  },
  {
    name: 'h5', family: 'heading', kind: 'element', block: true,
    rule: 'A label over a run of prose, not a division of the document. Deliberately absent from the contents rail: a rail that lists every label stops being an outline. If it belongs in the outline it is an h4.',
    requires: [],
    css: `h5{font-size:13px;margin:22px 0 6px;color:var(--muted);
  text-transform:uppercase;letter-spacing:.08em;font-weight:700}`,
    example: '<h5>Worked example</h5>',
  },
];
