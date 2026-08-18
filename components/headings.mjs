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
//   h2  section          25px    numbered, separated by a rule, the spine
//   h3  subsection       19.5px  a division of a section, still in the outline
//   h4  sub-subsection   16.5px  the deepest navigable level
//   h5  label            12.5px  a kicker over prose; NOT in the outline
//
// The steps are ~1.28x apart against 16px body text, which is the smallest gap
// at which two adjacent levels read as different sizes rather than as a
// rendering wobble. The first version of this family ran 21 / 16.5 / 15 and the
// specimen on the library page showed the problem: h3 and h4 were 1.5px apart
// and indistinguishable, so three navigable levels behaved like two. h4 sits
// just above body size and carries weight 700 — at this depth the reader is
// told "heading" by weight, not by scale.
//
// The contents rail lists h2, h3 and h4 and stops. That is the same boundary the
// rail enforces in review.js (TOC_DEEPEST), stated here because this is where an
// author looks to find out which level to write.

export const headings = [
  {
    name: 'h2', family: 'heading', kind: 'element', block: true,
    rule: 'A section: one of the numbered parts the spec is built from. Always titles a section element, and is the level the contents rail treats as the spine.',
    requires: ['a section element to title'],
    css: `h2{font-size:25px;font-weight:650;letter-spacing:-.01em;margin:56px 0 14px;
  padding-top:12px;border-top:1px solid var(--line)}
main > section:first-of-type > h2,main > h2:first-of-type{border-top:none;margin-top:18px}`,
    example: '<section id="design"><h2>4 · Design</h2><p>The shape of it.</p></section>',
  },
  {
    name: 'h3', family: 'heading', kind: 'element', block: true,
    rule: 'A subsection: a division of a section big enough that a reader would navigate to it. In the contents rail, nested under its section.',
    requires: [],
    css: 'h3{font-size:19.5px;font-weight:650;margin:34px 0 8px}',
    example: '<h3>4.1 · Where the boundary sits</h3>',
  },
  {
    name: 'h4', family: 'heading', kind: 'element', block: true,
    rule: 'A sub-subsection: the deepest level the contents rail lists. Reach for it when a subsection has parts worth navigating to; if they are not worth navigating to, they are a label.',
    requires: [],
    css: 'h4{font-size:16.5px;margin:24px 0 6px;font-weight:700}',
    example: '<h4>Counting method</h4>',
  },
  {
    name: 'h5', family: 'heading', kind: 'element', block: true,
    rule: 'A label over a run of prose, not a division of the document. Deliberately absent from the contents rail: a rail that lists every label stops being an outline. If it belongs in the outline it is an h4.',
    requires: [],
    css: `h5{font-size:12.5px;margin:22px 0 6px;color:var(--muted);
  text-transform:uppercase;letter-spacing:.09em;font-weight:700}`,
    example: '<h5>Worked example</h5>',
  },
];
