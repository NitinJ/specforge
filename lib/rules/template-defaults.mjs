// What each type's template ships with, before you edit it.
//
// These seed the store templates. Once a template exists in the store its own
// blocks are authoritative, so editing `template-design` in SpecForge changes
// what a design spec is judged against and this file stops mattering for that
// type. It is the starting position and the fallback, not the settlement.
//
// Why this is data here rather than markup in the shells: `design-impl` and
// `impl` scaffold from the SAME bundled shell (templates/spec-base.html), and
// their rule lists differ — impl wants `design-lives-elsewhere` and
// `plan-is-the-bulk`, design-impl wants `runtime-stubs-present`. One shell
// cannot carry two blocks. Duplicating a 500-line shell per type to hold four
// lines of rules is the alternative, and it means every future shell edit is
// made twice. So the blocks are rendered into the template spec at seed time,
// keyed by type. See Runtime · V4 in the design.
//
// Rules marked `corpus` came out of the review mining and carry the comment that
// produced them, so a template rule is as grounded as a global one (D12).

/** Per-type rules, added on top of the global list. */
export const TEMPLATE_RULES = {
  design: [
    {
      id: 'no-build-plan',
      ask: 'There is no stage or task list. A design spec that grew one is a design-impl spec, and should be rescaffolded rather than stretched.',
      fix: 'Move the plan into a design-impl spec and link to it.',
    },
  ],

  research: [
    {
      id: 'findings-cite-sources',
      ask: "Every finding names where it came from. A research spec's whole value is its provenance.",
      fix: 'Cite the source next to the finding, not in a list at the end.',
    },
    {
      id: 'method-states-scope',
      ask: 'The method says what was searched, over what period, and what was not looked at.',
      fix: 'State the scope and the gaps, so a reader knows what the absence of a finding means.',
    },
    {
      id: 'recommendations-follow-findings',
      ask: 'Each recommendation traces to a finding above it, and no finding is invented in the recommendations.',
      fix: 'Point each recommendation at its finding, or demote it to an open question.',
    },
    {
      id: 'gaps-are-declared',
      ask: 'The Open questions section names what the research could not answer. Research that claims completeness is the least trustworthy kind.',
      fix: 'Write down what you could not find out.',
    },
    {
      id: 'findings-name-what-they-break',
      corpus: 'If these are "Findings", then I assume that these are intended to be fixed? Can we mention whats wrong with the finding? what rule/best-principle does it break? and how will this be fixed',
      ask: 'Each finding says what rule or principle it violates and, on one line, how it gets fixed.',
      fix: 'Name the rule it breaks and the one-line fix.',
    },
  ],

  'design-impl': [
    {
      id: 'stages-are-pr-sized',
      ask: 'One stage is one PR. A stage that touches nine files across four subsystems is a plan, not a stage.',
      fix: 'Split it. A stage a reviewer cannot hold is a stage that gets rubber-stamped.',
    },
    {
      id: 'tasks-have-verify',
      ask: 'Every task carries a verify: note stating how you would know it is done.',
      fix: 'Write the check you would run, not the work you would do.',
    },
    {
      id: 'tracker-mirrors-plan',
      ask: 'The task tracker has a row per task in the plan, with matching statuses.',
      fix: 'Regenerate the tracker from the plan rather than editing both.',
    },
    {
      id: 'stage-zero-is-test-setup',
      ask: 'The first stage stands up whatever later stages need to be tested without human input.',
      fix: 'Move the human-gated setup into Stage 0.',
    },
    {
      id: 'runtime-stubs-present',
      ask: 'The Runtime section exists and is empty at creation. It is filled during implementation, and a spec that ships it pre-filled is describing work it has not done.',
      fix: 'Empty the Runtime section. It is a record, not a plan.',
    },
    {
      id: 'stages-are-explained-plainly',
      corpus: 'For each stage write a simple, human readable, Explain like i am a junior engineer (ELIJE) style 2 liner on what the stage is doing',
      ask: 'Each stage carries a two-line plain-language summary of what it does, readable by someone who has not read the design.',
      fix: 'Write the two lines. If you cannot, the stage is doing more than one thing.',
    },
    {
      id: 'fixes-carry-a-guard',
      corpus: 'After this, we will have a test that prevents this from happening in future? and enforces this rule',
      ask: 'A stage that fixes a defect says what test stops it coming back.',
      severity: 'advisory',
      fix: 'Name the test. A fix with no guard is a fix with a half-life.',
    },
  ],

  impl: [
    {
      id: 'design-lives-elsewhere',
      ask: 'The design prose is light and points at the design spec it implements, rather than restating it.',
      fix: 'Link the design spec and delete the restatement.',
    },
    {
      id: 'tasks-have-verify',
      ask: 'Every task carries a verify: note stating how you would know it is done.',
      fix: 'Write the check you would run, not the work you would do.',
    },
    {
      id: 'tracker-mirrors-plan',
      ask: 'The task tracker has a row per task in the plan, with matching statuses.',
      fix: 'Regenerate the tracker from the plan rather than editing both.',
    },
    {
      id: 'stage-zero-is-test-setup',
      ask: 'The first stage stands up whatever later stages need to be tested without human input.',
      fix: 'Move the human-gated setup into Stage 0.',
    },
    {
      id: 'plan-is-the-bulk',
      ask: 'The implementation plan is the longest section. If it is not, the spec is a design spec wearing the wrong type.',
      fix: 'Rescaffold as design-impl, or move the design prose out.',
    },
    {
      id: 'stages-are-explained-plainly',
      corpus: 'For each stage write a simple, human readable, Explain like i am a junior engineer (ELIJE) style 2 liner on what the stage is doing',
      ask: 'Each stage carries a two-line plain-language summary of what it does, readable by someone who has not read the design.',
      fix: 'Write the two lines. If you cannot, the stage is doing more than one thing.',
    },
    {
      id: 'fixes-carry-a-guard',
      corpus: 'After this, we will have a test that prevents this from happening in future? and enforces this rule',
      ask: 'A stage that fixes a defect says what test stops it coming back.',
      severity: 'advisory',
      fix: 'Name the test. A fix with no guard is a fix with a half-life.',
    },
  ],

  general: [
    {
      id: 'sections-fit-the-document',
      ask: 'The sections are the ones this kind of document needs, chosen deliberately. A postmortem wants timeline and root cause; a runbook wants preconditions and rollback.',
      fix: 'Pick the sections this document needs and delete the ones it does not.',
    },
  ],

  // The override that justifies the mechanism: a global rule turned off for one
  // type, by id. A deck is allowed the line a spec is not.
  deck: [
    { id: 'no-aphorisms', severity: 'off' },
  ],
};

/**
 * Per-type authoring guidance, attached to one section.
 *
 * A prompt is never checked and never reported. It is handed to the agent before
 * the section has any content and removed on the way into the spec. The first
 * two come from the corpus: open-questions drew 44 corrections and decisions
 * drew 9, and what those ask for is how to write the section rather than a
 * property to test once it is written.
 *
 * The three runtime sections are here for a different reason. They are the only
 * sections written months after the spec was, by an agent that has the code in
 * front of it and not the document, and left to itself it writes a bullet list
 * of things it did. What they need is not more instruction on what qualifies but
 * a shape to fill: the same card every time, with the same labels in the same
 * order. Keyed by section id, so a type whose shell has no such section is not
 * handed guidance for it.
 */

/** The card every runtime entry is, given the labels that entry kind uses. */
const RUNTIME_CARD = (labels) => `Every entry is a card, and the card is always the same: one paragraph holding a bold sentence, then one paragraph per part, each opening with a bold label and a colon. Written out, that is <div class="card"><p><strong>the sentence</strong></p><p><strong>Label:</strong> the part</p></div>. Replace the "none yet" stub the first time this list gets an entry. No other shape: not a table, not a bullet list, not a paragraph of prose.

The labels are fixed and come in this order, each written with a colon after it: ${labels}.

The bold sentence is a finished declarative sentence stating what is true, never a topic label: "The kept fixture reports what one run wrote. It does not compare two." rather than "Fixture design". Each labelled part continues its label, so it starts lowercase and carries no subject of its own. Name the concrete thing in <code>: a function, an endpoint, a file, a rule. Why gives the reason and only the reason, and it earns its place by naming what the alternative would have cost. No first person, no "we decided to", no hedging.`;

export const TEMPLATE_PROMPTS = {
  'open-questions': `Every question here is a decision only the reader can make. Before writing one, check it is a genuine fork. A question with a sensible default is not a question: decide it, record it in Decisions, and leave it out of this section.

For each question that survives that test, give the reader everything the call needs, twice over. First in plain words, assuming no knowledge of this codebase and no reading of the sections above. Then in the technical terms the choice actually turns on, because the plain version alone cannot be acted on. Say what is being asked of them and what happens either way.

Never leave a question open ended. Offer options they can pick from, each with its consequence stated, so that a one-word answer settles it. If you cannot construct the options, you do not yet understand the question well enough to ask it.`,

  decisions: `A decision row is read by someone deciding whether to overturn it. Give the choice, the reason in plain words, and what the choice costs. Where it was close, name the option not taken and why it lost.

Write the reason so it holds up without the Design section beside it. A row that reads "chose X because it is the right approach" records nothing and will be re-litigated.`,

  'impl-decisions': `Written during implementation, append-only. Records where the design changed after review, not how the code was written. The reader is the human who approved the design sections and needs to know that what they approved is no longer exactly true.

An entry qualifies only if keeping the spec truthful would require editing a design section: a component boundary, an interface contract, the data model, a rule's meaning, an invariant, a decision, or a stage's scope. If nothing there needs updating, the entry does not belong here. Dependency choices, parsing mechanics, code organization, branch and PR process, and tooling fixes go in commits and PR descriptions. An empty section on nontrivial work suggests unreported drift; a thirty-entry section suggests that test was ignored.

${RUNTIME_CARD('<strong>The call</strong>, then <strong>Why</strong>')}

Entries are grouped by the stage that made them, under an <h3> reading "Stage N · the stage's name", in stage order.`,

  deviations: `${RUNTIME_CARD('<strong>Plan</strong>, then <strong>Instead</strong>, then <strong>Why</strong>')}

One flat list in stage order, no stage headings. Plan is what the spec asked for, quoted closely enough that a reader can check it. Instead is what was built. Why is what makes the difference acceptable, and it is the part a reviewer actually reads: name what blocked the planned route and what the deviation costs. A deviation with no cost stated reads as one nobody examined.

The design section this contradicts is updated to match. This list is the audit trail; the design sections are the truth. An entry here that leaves its design section stale is a defect, not a record.`,

  tradeoffs: `${RUNTIME_CARD('<strong>Chosen</strong>, then <strong>Instead of</strong>, then <strong>Why</strong>')}

One flat list in stage order, no stage headings. This section is for what was given up, not for every choice with two options: an entry belongs here when a guarantee was weakened or work was deferred under implementation pressure. A choice where the rejected option was simply worse is a design decision and belongs in that section instead. Instead of names the alternative as something that could have been built, not as a strawman. Where a tradeoff leaves work behind, name the follow-up task id.`,
};

/** Every type that ships a rules block. */
export const TYPES_WITH_RULES = Object.keys(TEMPLATE_RULES);
