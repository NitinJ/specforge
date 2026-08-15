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
 * the section has any content and removed on the way into the spec. These two
 * come from the corpus: open-questions drew 44 corrections and decisions drew 9,
 * and what those ask for is how to write the section rather than a property to
 * test once it is written.
 */
export const TEMPLATE_PROMPTS = {
  'open-questions': `Every question here is a decision only the reader can make. Before writing one, check it is a genuine fork. A question with a sensible default is not a question: decide it, record it in Decisions, and leave it out of this section.

For each question that survives that test, give the reader everything the call needs, twice over. First in plain words, assuming no knowledge of this codebase and no reading of the sections above. Then in the technical terms the choice actually turns on, because the plain version alone cannot be acted on. Say what is being asked of them and what happens either way.

Never leave a question open ended. Offer options they can pick from, each with its consequence stated, so that a one-word answer settles it. If you cannot construct the options, you do not yet understand the question well enough to ask it.`,

  decisions: `A decision row is read by someone deciding whether to overturn it. Give the choice, the reason in plain words, and what the choice costs. Where it was close, name the option not taken and why it lost.

Write the reason so it holds up without the Design section beside it. A row that reads "chose X because it is the right approach" records nothing and will be re-litigated.`,
};

/** Every type that ships a rules block. */
export const TYPES_WITH_RULES = Object.keys(TEMPLATE_RULES);
