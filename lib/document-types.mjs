// The document kinds that ship with the plugin, as data.
//
// Each is: a name, the one line that tells an agent when to pick it, and the
// sections it scaffolds, each with the guidance the authoring agent reads before
// writing that section and never ships.
//
// This is the only definition. The registry reads the names and the when-to-use
// lines from here, the seeder builds each kind's shell from the sections, and
// the prompt map is derived from them too. Committing twelve generated HTML
// shells beside it was the alternative, and the generated copy is the one that
// drifts: a section renamed here and not there produces a template whose prompts
// are keyed to sections that no longer exist.
//
// `general` appears here for its prompt alone. It is a built-in with a shell
// worth keeping, and `promptOnly` says so.
//
// Every reader of these documents is on the team. No section asks the author to
// orient a stranger, restate context both people already have, or write for an
// investor, a customer or an auditor. Where a kind needs that later, it is a
// different kind.

const P = (...lines) => lines.join(' ');

export const DOCUMENT_TYPES = [
  // ---------------------------------------------------------------- general --
  // Already a built-in kind, and already the fallback. What it lacked was any
  // guidance on how to choose sections, which is the whole job when the type has
  // no opinion. `promptOnly` attaches that and leaves the shipped shell alone.
  {
    name: 'general',
    slug: 'general',
    promptOnly: true,
    sections: [
      {
        id: 'tldr',
        prompt: P(
          'This type has no sections of its own. Deciding them is the work, and it',
          'is done before any prose is written.',
          'First check that no other type fits. Run `spec-types` and read the',
          '"when to use" line on each: a document that matches one of them is',
          'better served by it, because that type carries sections and guidance',
          'this one cannot. Reach for general only when nothing else fits, never to',
          'avoid choosing. If the document turns out to need stages and tasks, it',
          'is a design-impl or impl spec: say so and rescaffold rather than growing',
          'a plan here.',
          'Then work out the sections from what the document has to do for its',
          'reader, and write them down before drafting. A proposal wants context,',
          'proposal, impact, decision. A postmortem wants timeline, impact, root',
          'cause, actions. A runbook wants preconditions, steps, verification,',
          'rollback. A comparison wants criteria, options, the comparison, a',
          'recommendation. Do not import another type\'s section list wholesale, and',
          'do not add a section because most documents have one: a Goals section on',
          'a postmortem is filler.',
          'Test each candidate section by asking what a reader does differently',
          'having read it. A section that fails that is cut. Order them so a reader',
          'who stops halfway has still got the useful half.',
          'Then: stable kebab-case ids, one TOC link per section in document order,',
          'and the TL;DR written last. Everything else the house rules and the',
          'language contract say still applies here.',
        ),
      },
    ],
  },

  // ---------------------------------------------------------------- 1 pager --
  {
    name: 'Design 1 pager',
    slug: 'design-1-pager',
    whenToUse: P(
      'A direction to approve before anyone writes the full design.',
      'One page: the problem, the approach, what it gains, what it costs, and the',
      'decisions needed before it is written up. Pick this when the work is large',
      'enough that a rejected design spec would waste a day. The full design-impl',
      'spec follows once the direction is approved.',
    ),
    sections: [
      {
        id: 'problem', toc: '1 · The problem', heading: '1 · The problem',
        body: '    <p>{{ What is wrong today, in three lines. What it costs, with a number where one exists. }}</p>',
        prompt: P(
          'Three lines. State what is wrong today and what it costs, with a number',
          'where one exists (time lost, money spent, failures per week). Do not',
          'explain why the problem matters after stating it: the cost is the',
          'reason. Do not narrate how the problem was discovered. If you cannot',
          'say what it costs, say that instead, because a problem with no cost is',
          'the first thing the reader will push back on.',
        ),
      },
      {
        id: 'approach', toc: '2 · The approach', heading: '2 · The approach',
        body: '    <p>{{ The shape of the answer, in a paragraph. Enough that a reader can disagree with it. }}</p>\n'
          + '    <p>{{ One diagram only if the shape is hard to say in words. }}</p>',
        prompt: P(
          'One paragraph, plus at most one diagram. Say the shape of the answer,',
          'not its implementation: what the pieces are and how they relate. The',
          'test is whether a reader can disagree with it. If the paragraph could',
          'describe three different designs, it is too vague; if it names files and',
          'function signatures, this is a design spec and not a 1 pager. Do not',
          'list alternatives here.',
        ),
      },
      {
        id: 'gains', toc: '3 · What it gains', heading: '3 · What it gains',
        body: '    <ul><li>{{ A capability the team or a user has afterwards and does not have now. }}</li></ul>',
        prompt: P(
          'A short list. Each item is a capability that exists afterwards and does',
          'not exist now, stated as a thing someone can do. Not "better X", not',
          '"cleaner Y". If an item is the absence of a problem rather than the',
          'presence of a capability, it belongs in section 1 as part of the cost.',
        ),
      },
      {
        id: 'costs', toc: '4 · What it costs', heading: '4 · What it costs',
        body: '    <p><strong>Appetite:</strong> {{ how much time this is worth, decided before the design }}</p>\n'
          + '    <ul><li>{{ Work, in days or PRs. }}</li>\n'
          + '      <li>{{ What gets harder, or is foreclosed. }}</li>\n'
          + '      <li>{{ What has to be thrown away or migrated. }}</li></ul>',
        prompt: P(
          'Open with the appetite: how much time this problem is worth, decided',
          'from its value rather than from what the approach happens to need. That',
          'ordering is the point. An estimate asks how long the design takes; an',
          'appetite says how much it is worth, and if the approach does not fit,',
          'the approach changes rather than the budget.',
          'Then three kinds of cost, one line each: the work in days or PRs, what',
          'gets harder or is foreclosed afterwards, and what has to be discarded or',
          'migrated. A 1 pager with no cost section is a pitch. Where the honest',
          'answer to one of the three is "nothing", write "nothing" rather than',
          'dropping the line, because the reader is checking that it was',
          'considered.',
        ),
      },
      {
        id: 'decide-first', toc: '5 · Decide before writing it up', heading: '5 · Decide before writing it up',
        body: '    <ul><li>{{ A question only the reader can answer, and what you would assume if they do not. }}</li></ul>',
        prompt: P(
          'The questions that would change the design if answered differently, and',
          'that you cannot settle yourself. Scope and taste only: anything you could',
          'look up or decide, decide. For each, give the assumption you will proceed',
          'on if it goes unanswered, so silence still produces a spec. Keep it to',
          'three or fewer. More than three means the direction is not formed enough',
          'to review.',
        ),
      },
      {
        id: 'ask', toc: '6 · The ask', heading: '6 · The ask',
        body: '    <p>{{ Approve, redirect, or drop. Say which one you are asking for and what happens next in each case. }}</p>',
        prompt: P(
          'One short paragraph naming what you want back: approve, redirect, or',
          'drop. Say what you will do next in each case. This is the section that',
          'makes the document cheap to answer, so do not hedge it into a summary of',
          'the page above. The whole document stays under one page. If it does not,',
          'it is a design spec, and the right move is to say so and rescaffold.',
        ),
      },
    ],
  },

  // -------------------------------------------------------------------- PRD --
  {
    name: 'PRD',
    slug: 'prd',
    whenToUse: P(
      'What we are building and what done means, from the product side. Users,',
      'requirements, the experience, and the numbers that say it worked. Pick this',
      'when the question is what the product should do; pick design or design-impl',
      'when the question is how it should be built.',
    ),
    sections: [
      {
        id: 'tldr', toc: 'TL;DR', heading: 'TL;DR', panel: true,
        body: '      <p style="margin-bottom:0">{{ Who has the problem. }} {{ What we are building. }} {{ The number that says it worked. }} {{ The question still open. }}</p>',
        prompt: P(
          'Four sentences: who has the problem, what we are building, the number',
          'that says it worked, and the biggest open question. Write it last. A',
          'reader who stops here should be able to say whether this is worth',
          'building. No background and no motivation narrative.',
        ),
      },
      {
        id: 'problem', toc: '1 · The problem', heading: '1 · The problem',
        body: '    <p>{{ Who has it, what they do today instead, and what that costs them. }}</p>\n'
          + '    <p class="sub">Evidence: {{ what makes this real rather than assumed: a support thread, a session, a number, a conversation. Say "assumed" where it is assumed. }}</p>',
        prompt: P(
          'Who has the problem, what they do today instead, and what that costs',
          'them. Then the evidence line: what makes this real rather than assumed.',
          'A support thread, a recorded session, a metric, a conversation, with',
          'enough detail to find it again. Where the problem is assumed rather than',
          'observed, write "assumed" and say what would confirm it. An unmarked',
          'assumption here is the most expensive mistake in the document.',
        ),
      },
      {
        id: 'users', toc: '2 · Who it is for', heading: '2 · Who it is for',
        body: '    <table>\n'
          + '      <thead><tr><th>Segment</th><th>What they are trying to do</th><th>Priority</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ segment }}</td><td>{{ the job }}</td><td><span class="tag good">primary</span></td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'One row per segment, with exactly one marked primary. The primary segment',
          'is the one whose experience wins every time two segments want different',
          'things, so naming two is the same as naming none. Say what each segment',
          'is trying to do, not who they are demographically.',
        ),
      },
      {
        id: 'requirements', toc: '3 · Requirements', heading: '3 · Requirements',
        body: '    <table>\n'
          + '      <thead><tr><th style="width:52px">#</th><th>Requirement</th><th>Why</th><th style="width:90px">Priority</th></tr></thead>\n'
          + '      <tbody><tr><td>R1</td><td>{{ A testable statement of what the product must do. }}</td><td>{{ Which segment and which job. }}</td><td><span class="tag good">must</span></td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Numbered R1, R2, R3, each a statement that can be shown true or false by',
          'looking at the product. "Fast" is not a requirement; "the grid renders',
          'within 400ms of the response" is. Every requirement traces to a segment',
          'and a job from section 2: a requirement that traces to nothing is a',
          'feature somebody wanted, and it should be visible as such rather than',
          'buried. Priorities are must, should, or later, and a list where',
          'everything is a must has not been prioritised. Keep the whole document',
          'short. A long PRD is a design document that has not admitted it, and the',
          'thing being specified here is what the product does, not how.',
        ),
      },
      {
        id: 'experience', toc: '4 · The experience', heading: '4 · The experience',
        body: '    <p>{{ What the user does, start to finish. Steps, not screens. }}</p>\n'
          + '    <p class="sub">The failure paths, and what the user sees on each: {{ … }}</p>',
        prompt: P(
          'The path through the product from the user\'s side, as steps rather than',
          'screens, so it stays true when the screens change. Then the failure',
          'paths: what the user sees when the thing they wanted cannot happen. A',
          'PRD that describes only the happy path leaves every error message to be',
          'invented during implementation. Screen-level detail belongs in a UX',
          'spec; link to it rather than duplicating it.',
        ),
      },
      {
        id: 'success', toc: '5 · What success looks like', heading: '5 · What success looks like',
        body: '    <table>\n'
          + '      <thead><tr><th>Measure</th><th>Today</th><th>Target</th><th>Checked when</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ what is counted }}</td><td>{{ baseline, or "unknown" }}</td><td>{{ number }}</td><td>{{ date or event }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Numbers, with today\'s value beside the target and a date when it gets',
          'checked. Where the baseline is unknown, write "unknown" and say how it',
          'will be measured before launch, because a target with no baseline cannot',
          'be met or missed. Include at least one measure that would tell you this',
          'was the wrong thing to build, not only ones that confirm it worked.',
        ),
      },
      {
        id: 'risks', toc: '6 · The four risks', heading: '6 · The four risks',
        body: '    <table>\n'
          + '      <thead><tr><th style="width:110px">Risk</th><th>Is it real here?</th><th>What reduces it, before we build</th></tr></thead>\n'
          + '      <tbody>\n'
          + '        <tr><td>Value</td><td>{{ will anyone choose this? }}</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>Usability</td><td>{{ can they work out how? }}</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>Feasibility</td><td>{{ can we build it, with what we have? }}</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>Viability</td><td>{{ does it work for the business: cost, margin, support, legal? }}</td><td>{{ … }}</td></tr>\n'
          + '      </tbody>\n'
          + '    </table>',
        prompt: P(
          'The four product risks, as Cagan names them. For each: whether it is',
          'genuinely live for this piece of work, and what reduces it before',
          'anything is built. Value and viability are the two that get skipped, and',
          'they are the two that make a built feature worthless rather than late.',
          'Where a risk is not real here, write one line saying why rather than',
          'deleting the row, because the reader is checking that it was considered.',
          'Where the answer is an experiment, name the experiment and what result',
          'would stop the work.',
        ),
      },
      {
        id: 'scope', toc: '7 · Out of scope', heading: '7 · Out of scope',
        body: '    <ul><li>{{ Something a reader would reasonably expect here, and why it is not. }}</li></ul>',
        prompt: P(
          'Only the things a reader would reasonably expect to be in scope. Each',
          'with the reason it is not, and where it goes instead if it goes anywhere.',
          'A list of things nobody was going to build is filler.',
        ),
      },
      {
        id: 'dependencies', toc: '8 · Dependencies', heading: '8 · Dependencies',
        body: '    <ul><li>{{ What has to exist or be true first, and who owns it. }}</li></ul>',
        prompt: P(
          'What has to exist or be true before this can ship: another piece of work,',
          'a vendor, an account, a decision, a migration. Name who owns each and its',
          'current state. A dependency with no owner is the one that slips.',
        ),
      },
      {
        id: 'decisions', toc: '9 · Decisions', heading: '9 · Decisions',
        body: '    <table>\n'
          + '      <thead><tr><th style="width:42px">#</th><th>Decision</th><th>Choice</th><th>What it costs</th></tr></thead>\n'
          + '      <tbody><tr><td>D1</td><td>{{ the question }}</td><td>{{ the choice }}</td><td>{{ what it forecloses or makes harder }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Product decisions already made, each with what the choice costs rather',
          'than why it is good. "Chose X because X is right" is a restatement. The',
          'cost column is what makes this table worth reading again in six months.',
        ),
      },
      {
        id: 'open-questions', toc: '10 · Open questions', heading: '10 · Open questions',
        body: '    <ul>\n'
          + '      <li data-sf-q="open"><strong>Q1 <span class="tag warn">open</span></strong> {{ The question, who decides, and the assumption in force until they do. }}</li>\n'
          + '    </ul>',
        prompt: P(
          'Scope and taste only. Anything answerable by looking it up or by making a',
          'reasonable call has been decided and belongs in section 8. Each question',
          'names who decides and the assumption in force until they do. Keep them as',
          'prose rather than splitting each into labelled fields.',
        ),
      },
    ],
  },

  // -------------------------------------------------------- Marketing spec --
  {
    name: 'Marketing spec',
    slug: 'marketing-spec',
    whenToUse: P(
      'A piece of marketing work: what we are saying, to whom, where it runs, what',
      'has to be made, and how we know it worked. Pick this for a campaign, a',
      'launch message, a landing page or a content push. Not for the product',
      'itself, which is a PRD.',
    ),
    sections: [
      {
        id: 'tldr', toc: 'TL;DR', heading: 'TL;DR', panel: true,
        body: '      <p style="margin-bottom:0">{{ What we are doing. }} {{ Who it is aimed at. }} {{ The outcome it is for, with a number. }}</p>',
        prompt: P(
          'Three sentences: what we are doing, who it is aimed at, and the outcome',
          'it is for with a number attached. Written last.',
        ),
      },
      {
        id: 'objective', toc: '1 · What this is for', heading: '1 · What this is for',
        body: '    <p>{{ The business outcome, with a number and a date. }}</p>\n'
          + '    <p class="sub">If this works, the next thing we do is {{ … }}. If it does not, {{ … }}.</p>',
        prompt: P(
          'The business outcome, with a number and a date. Then what happens next in',
          'either case. Awareness and engagement are not outcomes unless you can say',
          'what they are worth here; if you cannot, name the outcome one step',
          'further down. The pair of follow-on sentences is what stops this being a',
          'campaign that runs and is never judged.',
        ),
      },
      {
        id: 'audience', toc: '2 · Who we are talking to', heading: '2 · Who we are talking to',
        body: '    <p>{{ Who they are, what they already believe, and what they are doing when this reaches them. }}</p>\n'
          + '    <p class="sub">What they have to believe afterwards that they do not believe now: {{ … }}</p>',
        prompt: P(
          'Who they are, what they already believe about this category, and what',
          'they are doing at the moment the message reaches them. Then the belief',
          'change: the one thing they have to believe afterwards that they do not',
          'believe now. If the belief change is "this exists", say so, because',
          'awareness work and persuasion work are written differently.',
        ),
      },
      {
        id: 'message', toc: '3 · What we are saying', heading: '3 · What we are saying',
        body: '    <p><strong>The one thing they must remember:</strong> {{ a single sentence, in the words a customer would use }}</p>\n'
          + '    <p><strong>Proof points:</strong> {{ what makes it credible: a number, a demo, a name, a guarantee }}</p>\n'
          + '    <p class="sub">Tone: {{ … }} · What we are deliberately not claiming: {{ … }}</p>',
        prompt: P(
          'One proposition, in a single sentence, in the words a customer would use',
          'rather than the words the team uses internally. Single-minded is the',
          'whole discipline here: two propositions is none, and if it cannot be',
          'written as one sentence the brief is not ready. Then the proof points',
          'that make it credible. A claim with no proof is what gets us into',
          'trouble later, so where the proof does not exist yet, either make it a',
          'dependency or weaken the claim now. Give the tone in three words, and',
          'say what we are deliberately not claiming, which is how a writer working',
          'from this knows where the edge is. No em dashes, and no superlative that',
          'cannot be checked.',
        ),
      },
      {
        id: 'mandatories', toc: '4 · Mandatories', heading: '4 · Mandatories',
        body: '    <ul><li>{{ Something every asset must carry or must avoid: a name, a logo, a legal line, a claim we cannot make, a word we do not use. }}</li></ul>',
        prompt: P(
          'What every asset must carry and what none of them may do. Brand marks and',
          'how they are used, legal or platform lines that have to appear, claims we',
          'are not allowed to make, words we do not use. This is the shortest',
          'section and the one whose absence causes rework, because it is the set of',
          'constraints a writer cannot infer from the proposition. Where there are',
          'none, write "none" rather than leaving it empty.',
        ),
      },
      {
        id: 'channels', toc: '5 · Where it runs', heading: '5 · Where it runs',
        body: '    <table>\n'
          + '      <thead><tr><th>Channel</th><th>Why this one</th><th>What it costs</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ channel }}</td><td>{{ why the audience is there }}</td><td>{{ money and time }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'One row per channel, each justified by where the audience already is',
          'rather than by what is available. Cost in money and in hours, because for',
          'a two-person team the hours are the binding constraint. A channel nobody',
          'has time to run is not a channel.',
        ),
      },
      {
        id: 'assets', toc: '6 · What has to be made', heading: '6 · What has to be made',
        body: '    <table>\n'
          + '      <thead><tr><th>Asset</th><th>Spec</th><th>Who makes it</th><th>By when</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ what }}</td><td>{{ size, length, format, count }}</td><td>{{ who }}</td><td>{{ date }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Every artifact the campaign needs, with its concrete spec: dimensions,',
          'word count, duration, how many variants. This is the section someone',
          'works from at 11pm, so an entry that says "hero image" and nothing else',
          'has failed. Name who makes each one and when it is due.',
        ),
      },
      {
        id: 'measurement', toc: '7 · How we know it worked', heading: '7 · How we know it worked',
        body: '    <table>\n'
          + '      <thead><tr><th>Measure</th><th>Baseline</th><th>Target</th><th>Where it is read</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ what }}</td><td>{{ today }}</td><td>{{ number }}</td><td>{{ which dashboard, query or tool }}</td></tr></tbody>\n'
          + '    </table>\n'
          + '    <p class="sub">Instrumentation that has to exist first: {{ … }}</p>',
        prompt: P(
          'Numbers with baselines, and for each one the exact place it gets read: a',
          'dashboard, a query, a tool. A measure nobody can look up is not a',
          'measure. Separate the business measures (signups, revenue, conversion)',
          'from the traffic ones (reach, clicks): a campaign judged only on clicks',
          'can succeed while selling nothing, and at least one measure here must be',
          'a business one. List the instrumentation that has to be in place before',
          'the campaign starts, since it cannot be added retroactively.',
        ),
      },
      {
        id: 'cost', toc: '8 · Cost and time', heading: '8 · Cost and time',
        body: '    <p>{{ Total spend, and the hours it takes off the build. }}</p>\n'
          + '    <p class="sub">What we would stop doing to afford it: {{ … }}</p>',
        prompt: P(
          'Total spend and, separately, the hours it takes off building the product.',
          'Then what gets dropped to afford it. For a two-person pre-funding team',
          'the second number is the real one and the trade is the decision, so a',
          'section that gives money and not hours is only half the cost.',
        ),
      },
      {
        id: 'decisions', toc: '9 · Decisions', heading: '9 · Decisions',
        body: '    <table>\n'
          + '      <thead><tr><th style="width:42px">#</th><th>Decision</th><th>Choice</th><th>What it rules out</th></tr></thead>\n'
          + '      <tbody><tr><td>D1</td><td>{{ the question }}</td><td>{{ the choice }}</td><td>{{ what it rules out }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Decisions already made, each with what it rules out. Positioning, tone,',
          'channel and pricing calls belong here, so the writer does not reopen them',
          'and the next campaign knows what was tried.',
        ),
      },
      {
        id: 'open-questions', toc: '10 · Open questions', heading: '10 · Open questions',
        body: '    <ul>\n'
          + '      <li data-sf-q="open"><strong>Q1 <span class="tag warn">open</span></strong> {{ The question, and the assumption in force until it is answered. }}</li>\n'
          + '    </ul>',
        prompt: P(
          'Scope and taste only, each with the assumption in force until it is',
          'answered. Prose, not labelled fields.',
        ),
      },
    ],
  },

  // ---------------------------------------------------------------- UX spec --
  {
    name: 'UX spec',
    slug: 'ux-spec',
    whenToUse: P(
      'The interaction design of one piece of product: the flows, every state a',
      'screen can be in, the words on it, and the keyboard and screen reader',
      'behaviour. Pick this before a frontend spec, which is how it gets built.',
    ),
    sections: [
      {
        id: 'tldr', toc: 'TL;DR', heading: 'TL;DR', panel: true,
        body: '      <p style="margin-bottom:0">{{ What the user is trying to do. }} {{ The shape of the flow. }} {{ The riskiest interaction decision. }}</p>',
        prompt: P(
          'Three sentences: what the user is trying to do, the shape of the flow,',
          'and the interaction decision carrying the most risk. Written last.',
        ),
      },
      {
        id: 'context', toc: '1 · What the user is doing', heading: '1 · What the user is doing',
        body: '    <p>{{ The job, in the user\'s terms. What they know when they arrive, and what they are holding. }}</p>\n'
          + '    <p class="sub">Where they came from: {{ … }} · What they do next: {{ … }}</p>',
        prompt: P(
          'The job in the user\'s terms, what they already know when they arrive, and',
          'what they are bringing with them (a file, an id, a half-finished thing).',
          'Then where they came from and where they go next, because a flow',
          'designed without its edges is one that dead-ends in practice.',
        ),
      },
      {
        id: 'flows', toc: '2 · Flows', heading: '2 · Flows',
        body: '    <p>{{ The happy path as numbered steps: what the user does, what the product does back. }}</p>\n'
          + '    <p>{{ Every branch off it, and where each one rejoins or ends. }}</p>',
        prompt: P(
          'The happy path as numbered steps, alternating what the user does and what',
          'the product does back. Then every branch off it, each saying where it',
          'rejoins the path or how it ends. A branch that neither rejoins nor ends',
          'is a hole. Use a mermaid flowchart when the branching is hard to follow',
          'in prose, and prose when it is not.',
        ),
      },
      {
        id: 'states', toc: '3 · Every state', heading: '3 · Every state',
        body: '    <table>\n'
          + '      <thead><tr><th>State</th><th>When</th><th>What the user sees</th><th>What they can do</th></tr></thead>\n'
          + '      <tbody>\n'
          + '        <tr><td>empty</td><td>{{ when }}</td><td>{{ what }}</td><td>{{ the one action that gets them out of it }}</td></tr>\n'
          + '        <tr><td>loading</td><td>{{ when }}</td><td>{{ what }}</td><td>{{ can they cancel? }}</td></tr>\n'
          + '        <tr><td>partial</td><td>{{ when }}</td><td>{{ what }}</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>error</td><td>{{ which error }}</td><td>{{ what }}</td><td>{{ the recovery }}</td></tr>\n'
          + '        <tr><td>success</td><td>{{ when }}</td><td>{{ what }}</td><td>{{ … }}</td></tr>\n'
          + '      </tbody>\n'
          + '    </table>',
        prompt: P(
          'Every state the surface can be in, not only the ones with a design.',
          'Empty, loading, partial, each distinct error, success, and offline or',
          'stale where they apply. For each: when it happens, what the user sees,',
          'and what they can do about it. This is the section that gets skipped and',
          'the one that costs the most when it is: a state with no design here',
          'becomes a blank screen in production. An error row with no recovery',
          'action is not finished.',
        ),
      },
      {
        id: 'content', toc: '4 · Words', heading: '4 · Words',
        body: '    <table>\n'
          + '      <thead><tr><th>Where</th><th>Text</th><th>Why this wording</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ label, button, error, empty state }}</td><td>{{ the exact words }}</td><td>{{ only where the choice is not obvious }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'The exact words, not descriptions of them. Every button, label, error and',
          'empty state, written out. Error text says what happened and what to do',
          'next, never a status code alone. No emoji anywhere in product UI. No em',
          'dashes. Give a reason only where the wording choice is not obvious.',
        ),
      },
      {
        id: 'interaction', toc: '5 · Interaction detail', heading: '5 · Interaction detail',
        body: '    <ul><li>{{ What responds to what, how fast, and what the user sees while they wait. }}</li></ul>\n'
          + '    <p class="sub">Destructive actions and how they are confirmed or undone: {{ … }}</p>',
        prompt: P(
          'The behaviour a static design cannot carry: what responds to what, how',
          'quickly, what appears during the wait, what is optimistic and what waits',
          'for the server. Give timings as numbers. Then destructive actions: which',
          'ones confirm, which ones undo, and which ones do neither and why that is',
          'acceptable.',
        ),
      },
      {
        id: 'accessibility', toc: '6 · Keyboard, focus and screen reader', heading: '6 · Keyboard, focus and screen reader',
        body: '    <ul><li>Tab order: {{ … }}</li>\n'
          + '      <li>Focus on open, and where it returns on close: {{ … }}</li>\n'
          + '      <li>What is announced, and as what: {{ … }}</li>\n'
          + '      <li>Anything that only works with a pointer: {{ … }}</li></ul>\n'
          + '    <table>\n'
          + '      <thead><tr><th>WCAG 2.2 AA</th><th>Applies here?</th><th>How it is met</th></tr></thead>\n'
          + '      <tbody>\n'
          + '        <tr><td>2.4.11 Focus not obscured</td><td>{{ sticky headers, overlays }}</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>2.5.8 Target size (24 × 24 CSS px)</td><td>{{ … }}</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>2.5.7 Dragging movements</td><td>{{ any drag has a non-drag alternative }}</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>3.3.8 Accessible authentication</td><td>{{ paste allowed, no memory test }}</td><td>{{ … }}</td></tr>\n'
          + '      </tbody>\n'
          + '    </table>',
        prompt: P(
          'Tab order, where focus goes when something opens and where it returns',
          'when it closes, what a screen reader announces and with what role, and',
          'anything that currently works only with a pointer. Name that last one',
          'rather than leaving it to be discovered: keyboard behaviour designed',
          'after the fact is keyboard behaviour that does not exist.',
          'Then the table. WCAG 2.2 AA is the baseline the accessibility laws now',
          'reference, and these four are the criteria that most often fail on a',
          'surface that was already 2.1 compliant: focus obscured by sticky chrome,',
          'targets under 24 by 24 CSS pixels, a drag with no single-pointer',
          'alternative, and a login that blocks paste. Add rows for any other',
          'criterion this surface puts at risk. Where one does not apply, say why in',
          'a few words rather than deleting the row.',
        ),
      },
      {
        id: 'decisions', toc: '7 · Decisions', heading: '7 · Decisions',
        body: '    <table>\n'
          + '      <thead><tr><th style="width:42px">#</th><th>Decision</th><th>Choice</th><th>What it costs</th></tr></thead>\n'
          + '      <tbody><tr><td>D1</td><td>{{ the question }}</td><td>{{ the choice }}</td><td>{{ what it makes harder }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Interaction decisions with a real alternative, each with what the choice',
          'costs. Skip the ones where only one option was ever plausible.',
        ),
      },
      {
        id: 'open-questions', toc: '8 · Open questions', heading: '8 · Open questions',
        body: '    <ul>\n'
          + '      <li data-sf-q="open"><strong>Q1 <span class="tag warn">open</span></strong> {{ The question, and the assumption in force until it is answered. }}</li>\n'
          + '    </ul>',
        prompt: P('Scope and taste only, each with the assumption in force until answered. Prose.'),
      },
    ],
  },

  // ---------------------------------------------------------- Frontend spec --
  {
    name: 'Frontend design spec',
    slug: 'frontend-design-spec',
    whenToUse: P(
      'How a piece of UI is built: component structure, where state lives, how data',
      'is fetched, styling, performance budget and tests. Pick this after a UX spec',
      'has settled what the interface does.',
    ),
    sections: [
      {
        id: 'tldr', toc: 'TL;DR', heading: 'TL;DR', panel: true,
        body: '      <p style="margin-bottom:0">{{ What is being built. }} {{ The structural decision that shapes the rest. }} {{ The risk that would sink it. }}</p>',
        prompt: P(
          'Three sentences: what is being built, the structural decision that shapes',
          'everything else, and the biggest risk. Written last.',
        ),
      },
      {
        id: 'scope', toc: '1 · Scope', heading: '1 · Scope',
        body: '    <p>{{ What is being built, and the UX spec it implements. }}</p>\n'
          + '    <p class="sub">Existing code this touches: {{ paths }} · What is reused rather than written: {{ … }}</p>',
        prompt: P(
          'What is being built and which UX spec it implements, by id. Then the',
          'existing code it touches, as real paths, and what is reused rather than',
          'written. Check the paths against the tree rather than from memory: a',
          'spec becomes untrustworthy fastest by citing code that has moved.',
        ),
      },
      {
        id: 'structure', toc: '2 · Component structure', heading: '2 · Component structure',
        body: '    <p>{{ The tree. Which component owns which piece of the surface. }}</p>\n'
          + '<pre data-lang="mermaid">{{ a graph, if the tree is deeper than two levels }}</pre>\n'
          + '    <p class="sub">Where the boundaries are, and why there: {{ … }}</p>',
        prompt: P(
          'The component tree and what each node owns. Draw it as a mermaid graph',
          'only when it is deeper than two levels; a shallow tree is clearer as a',
          'list. Then say why the boundaries sit where they do. A component split',
          'that follows the visual layout rather than the data is the usual mistake,',
          'so if that is what this does, say why it is right here.',
        ),
      },
      {
        id: 'state', toc: '3 · State', heading: '3 · State',
        body: '    <table>\n'
          + '      <thead><tr><th>State</th><th>Lives in</th><th>Who writes it</th><th>Survives a reload?</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ what }}</td><td>{{ component, store, URL, server }}</td><td>{{ who }}</td><td>{{ yes/no, and where }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'One row per piece of state: where it lives, who is allowed to write it,',
          'and whether it survives a reload. State with two writers is the defect',
          'this table exists to catch, so if a row has two, that is the design',
          'problem to resolve before writing code. Say explicitly which state is in',
          'the URL, because that decides what can be linked to.',
        ),
      },
      {
        id: 'data', toc: '4 · Data', heading: '4 · Data',
        body: '    <table>\n'
          + '      <thead><tr><th>Call</th><th>When</th><th>While it is in flight</th><th>On failure</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ endpoint }}</td><td>{{ mount, interaction, poll }}</td><td>{{ what the user sees }}</td><td>{{ retry, fall back, surface }}</td></tr></tbody>\n'
          + '    </table>\n'
          + '    <p class="sub">Caching and invalidation: {{ … }}</p>',
        prompt: P(
          'Every network call: when it fires, what the user sees while it is in',
          'flight, and what happens when it fails. Then caching and what invalidates',
          'it. The failure column is the one that gets left until later and then',
          'never written, so fill it for every row, including "the error surfaces',
          'and the user retries" where that is the answer.',
        ),
      },
      {
        id: 'styling', toc: '5 · Styling', heading: '5 · Styling',
        body: '    <p>{{ Which tokens, which existing components, what is new. }}</p>\n'
          + '    <p class="sub">Responsive behaviour, and the breakpoints that matter: {{ … }} · Theme: {{ what changes between light and dark }}</p>',
        prompt: P(
          'Which design tokens and existing components this uses, and what is',
          'genuinely new. Then responsive behaviour at the breakpoints that actually',
          'change the layout, not every breakpoint in the system. Say what changes',
          'between themes; a component that only works in one theme is a defect',
          'found by a user rather than by you.',
        ),
      },
      {
        id: 'performance', toc: '6 · Performance budget', heading: '6 · Performance budget',
        body: '    <table>\n'
          + '      <thead><tr><th>Measure</th><th>Budget</th><th>Measured how</th></tr></thead>\n'
          + '      <tbody>\n'
          + '        <tr><td>INP</td><td>under 200ms</td><td>{{ field data at p75, or a lab proxy }}</td></tr>\n'
          + '        <tr><td>LCP</td><td>under 2.5s</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>CLS</td><td>under 0.1</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>Bundle added</td><td>{{ kB gzipped }}</td><td>{{ … }}</td></tr>\n'
          + '      </tbody>\n'
          + '    </table>',
        prompt: P(
          'Numbers with the way each is measured. The Core Web Vitals thresholds are',
          'INP under 200ms, LCP under 2.5s and CLS under 0.1, each at the 75th',
          'percentile of real users over 28 days, so a lab number is a proxy and',
          'should be labelled as one. INP replaced FID and measures the whole',
          'interaction rather than only the delay before it starts, which is why a',
          'surface that felt fine under FID can fail it. CLS is mostly won by giving',
          'every image, video, iframe and injected slot explicit dimensions, so say',
          'here where those come from. Add the bundle delta in gzipped kB and the',
          'latency of the specific interaction this feature is about. A budget with',
          'no measurement method is a wish. Where nothing here is performance',
          'sensitive, write that sentence and say what would change it.',
        ),
      },
      {
        id: 'testing', toc: '7 · How this is tested', heading: '7 · How this is tested',
        body: '    <ul><li>{{ A behaviour, and the test that proves it. }}</li></ul>\n'
          + '    <p class="sub">What only shows up in a browser: {{ … }}</p>',
        prompt: P(
          'Behaviours paired with the tests that prove them, not a list of test file',
          'names. Then, separately, what a headless DOM cannot see: layout, real',
          'pointer behaviour, rasterization, focus, scroll. Those get driven in a',
          'browser, and a walk that calls click() on an element proves nothing about',
          'whether a pointer could have reached it.',
        ),
      },
      {
        id: 'decisions', toc: '8 · Decisions', heading: '8 · Decisions',
        body: '    <table>\n'
          + '      <thead><tr><th style="width:42px">#</th><th>Decision</th><th>Choice</th><th>What it costs</th></tr></thead>\n'
          + '      <tbody><tr><td>D1</td><td>{{ the question }}</td><td>{{ the choice }}</td><td>{{ easier / harder / forecloses }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Each with what gets easier, what gets harder, and what is foreclosed. A',
          'decision row that gives only the upside has not been thought through in',
          'public.',
        ),
      },
      {
        id: 'open-questions', toc: '9 · Open questions', heading: '9 · Open questions',
        body: '    <ul>\n'
          + '      <li data-sf-q="open"><strong>Q1 <span class="tag warn">open</span></strong> {{ The question, and the assumption in force until it is answered. }}</li>\n'
          + '    </ul>',
        prompt: P('Scope and taste only, each with the assumption in force until answered. Prose.'),
      },
    ],
  },

  // ------------------------------------------------------------ Exploration --
  {
    name: 'Exploration spec',
    slug: 'exploration-spec',
    whenToUse: P(
      'Map a subject nobody here knows yet: what exists, what the words mean, and',
      'which few things decide outcomes. The output is understanding, not a verdict.',
      'Pick research instead when there is a specific question with a right answer,',
      'and code-exploration when the subject is this codebase.',
    ),
    sections: [
      {
        id: 'tldr', toc: 'TL;DR', heading: 'TL;DR', panel: true,
        body: '      <p style="margin-bottom:0">{{ The one thing understood now that was not before, in a sentence. }} {{ What it changes about what we were going to do. }}</p>',
        prompt: P(
          'Two sentences: the one thing understood now that was not before, and what',
          'it changes about what we were going to do. If the honest answer to the',
          'second is "nothing", write that. An exploration that changes nothing is a',
          'useful result and pretending otherwise wastes the next reader\'s time.',
        ),
      },
      {
        id: 'question', toc: '1 · What I am trying to understand', heading: '1 · What I am trying to understand',
        body: '    <p>{{ The subject, and what prompted looking at it now. }}</p>\n'
          + '    <p class="sub">What I would do differently depending on the answer: {{ … }}</p>',
        prompt: P(
          'The subject and what prompted looking at it now. Then the line that keeps',
          'an exploration honest: what would be done differently depending on what',
          'is found. An exploration where the answer changes no decision is a',
          'reading exercise, and it is better to notice that here than after the',
          'work.',
        ),
      },
      {
        id: 'landscape', toc: '2 · The landscape', heading: '2 · The landscape',
        body: '    <p>{{ What exists, how it is usually done, and who does it. }}</p>\n'
          + '    <table>\n'
          + '      <thead><tr><th>Approach</th><th>Who uses it</th><th>What it is good at</th><th>Where it breaks</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ … }}</td><td>{{ … }}</td><td>{{ … }}</td><td>{{ … }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'What exists and how the problem is usually solved, with names attached.',
          'The table earns its place through the last column: where each approach',
          'breaks is what a survey normally omits and what is actually worth',
          'knowing. Cite where each claim came from. Where something is inferred',
          'rather than read, mark it inferred.',
        ),
      },
      {
        id: 'vocabulary', toc: '3 · Vocabulary', heading: '3 · Vocabulary',
        body: '    <table>\n'
          + '      <thead><tr><th>Term</th><th>What it actually means</th><th>What it is often confused with</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ term }}</td><td>{{ definition }}</td><td>{{ the near neighbour }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'The terms the next document will need, defined so it can use them without',
          'redefining them. The third column is the point: a term is understood when',
          'you can say what it is not. Include the terms that sound',
          'interchangeable and are not, because those are where the expensive',
          'misunderstandings live.',
        ),
      },
      {
        id: 'matters', toc: '4 · What actually matters', heading: '4 · What actually matters',
        body: '    <ul><li>{{ A thing that decides outcomes here, and why it dominates the others. }}</li></ul>',
        prompt: P(
          'The few variables that decide outcomes in this space, and why each',
          'dominates the things around it. Three or four, not ten. This is the',
          'section that turns a survey into something usable: it says where to spend',
          'attention. If everything seems to matter equally, the subject has not',
          'been understood yet, and saying so is a better result than a flat list.',
        ),
      },
      {
        id: 'surprises', toc: '5 · What surprised me', heading: '5 · What surprised me',
        body: '    <ul><li>{{ What I expected, what is actually true, and what that invalidates. }}</li></ul>',
        prompt: P(
          'Each item gives what was expected, what turned out to be true, and what',
          'that invalidates. Surprises are where an exploration pays for itself,',
          'because they are the assumptions that were about to be built on. If',
          'nothing was surprising, say so plainly.',
        ),
      },
      {
        id: 'next', toc: '6 · What I would look at next', heading: '6 · What I would look at next',
        body: '    <ul><li>{{ The next question, why it is next, and roughly what answering it takes. }}</li></ul>\n'
          + '    <p class="sub">What I deliberately did not look at: {{ … }}</p>',
        prompt: P(
          'The next questions in order, each with why it is next and roughly what',
          'answering it costs. Then what was deliberately not looked at, which is',
          'what bounds the confidence of everything above.',
        ),
      },
      {
        id: 'sources', toc: 'Sources', heading: 'Sources',
        body: '    <ul><li>{{ Where a claim above came from, findable again. }}</li></ul>',
        prompt: P(
          'Every source a claim above rests on, in enough detail to find again: a',
          'URL, a document and section, a person and date. A claim in the body with',
          'no source here should either get one or be marked as inference.',
        ),
      },
    ],
  },

  // ------------------------------------------------------- Code exploration --
  {
    name: 'Code exploration spec',
    slug: 'code-exploration-spec',
    whenToUse: P(
      'Find out how something in this codebase actually works, and write it down so',
      'the next person does not repeat the reading. Entry points, real behaviour,',
      'dependents, traps, and where a change would go. Pick this over exploration',
      'when the subject is code we own.',
    ),
    sections: [
      {
        id: 'tldr', toc: 'TL;DR', heading: 'TL;DR', panel: true,
        body: '      <p style="margin-bottom:0">{{ How it works, in two sentences. }} {{ The thing that is not what you would expect. }}</p>',
        prompt: P(
          'Two sentences on how it works, then the one thing that is not what a',
          'reader would expect. Written last. A reader who stops here should be able',
          'to hold a correct rough model.',
        ),
      },
      {
        id: 'question', toc: '1 · What I needed to find out', heading: '1 · What I needed to find out',
        body: '    <p>{{ The question, and what it is blocking. }}</p>\n'
          + '    <p class="sub">Commit read at: {{ sha }} · Branch: {{ … }}</p>',
        prompt: P(
          'The question and what it is blocking. Then the commit sha the reading was',
          'done at. Code moves, and a description with no commit attached cannot be',
          'checked later or trusted after a refactor.',
        ),
      },
      {
        id: 'entry-points', toc: '2 · Where to start reading', heading: '2 · Where to start reading',
        body: '    <table>\n'
          + '      <thead><tr><th>File</th><th>What it owns</th><th>Read it if</th></tr></thead>\n'
          + '      <tbody><tr><td><code>{{ path:line }}</code></td><td>{{ … }}</td><td>{{ … }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'The files someone should open, in the order they should open them, with',
          'path and line. Say what each one owns and when it is worth reading, so a',
          'reader with a narrower question can stop early. Verify every path and',
          'line against the tree; a stale reference here costs more than no',
          'reference.',
        ),
      },
      {
        id: 'how-it-works', toc: '3 · How it actually works', heading: '3 · How it actually works',
        body: '    <p>{{ The real path through the code, in order. }}</p>\n'
          + '<pre data-lang="mermaid">{{ a sequence or flowchart when the order is the hard part }}</pre>\n'
          + '    <p class="sub">Where the names lie: {{ a function or variable whose name does not match what it does }}</p>',
        prompt: P(
          'The actual path through the code, in the order it executes. Not the path',
          'the architecture doc describes, and not the path the names imply. Draw it',
          'when the ordering or the branching is the hard part. The last line is',
          'where the names lie: a function or field whose name does not match what',
          'it does. That is the single most useful thing this document can carry.',
        ),
      },
      {
        id: 'dependents', toc: '4 · What depends on this', heading: '4 · What depends on this',
        body: '    <table>\n'
          + '      <thead><tr><th>Caller</th><th>What it relies on</th><th>Breaks if</th></tr></thead>\n'
          + '      <tbody><tr><td><code>{{ path:line }}</code></td><td>{{ the behaviour, not the signature }}</td><td>{{ … }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Who calls this and what they rely on, stated as behaviour rather than as',
          'a signature: the callers that break are usually the ones depending on',
          'ordering, timing or a side effect that no type describes. Say how the',
          'list was found (grep, a call graph, tests) so the reader knows how',
          'complete it is.',
        ),
      },
      {
        id: 'surprises', toc: '5 · Surprises and traps', heading: '5 · Surprises and traps',
        body: '    <ul><li>{{ What looks safe and is not, and what happens if you do it. }}</li></ul>',
        prompt: P(
          'The things that look safe and are not: an ordering that matters, a cache',
          'that is not invalidated, a retry that is not idempotent, a test that',
          'passes for the wrong reason. Each says what happens if you do the obvious',
          'thing. This is the section that saves the next person a day.',
        ),
      },
      {
        id: 'change', toc: '6 · Where a change would go', heading: '6 · Where a change would go',
        body: '    <p>{{ The seam a change belongs at, and why there rather than the obvious place. }}</p>\n'
          + '    <p class="sub">What would have to be tested: {{ … }}</p>',
        prompt: P(
          'The seam a change belongs at and why there rather than the place it first',
          'looks like it goes. Then what would have to be tested to land it safely.',
          'Stop before designing the change; if a design is forming, it belongs in a',
          'design 1 pager and this document links to it.',
        ),
      },
      {
        id: 'unread', toc: '7 · What I did not read', heading: '7 · What I did not read',
        body: '    <ul><li>{{ An area skipped, and what that means for the confidence above. }}</li></ul>',
        prompt: P(
          'What was skipped, and what that means for the confidence of everything',
          'above. A code exploration with no such section reads as complete, and',
          'none of them are. Be specific: "did not read the retry path" is useful,',
          '"did not read everything" is not.',
        ),
      },
    ],
  },

  // ----------------------------------------------------- Design exploration --
  {
    name: 'Design exploration spec',
    slug: 'design-exploration-spec',
    whenToUse: P(
      'Generate several ways to solve a problem and compare them, before committing',
      'to one. Three to five options, each sketched far enough to argue with, then a',
      'recommendation. Pick this when the solution space is genuinely open; pick a',
      'design 1 pager when there is already one approach worth approving.',
    ),
    sections: [
      {
        id: 'tldr', toc: 'TL;DR', heading: 'TL;DR', panel: true,
        body: '      <p style="margin-bottom:0">{{ The problem in a sentence. }} {{ How many options, and what separates them. }} {{ What I would pick, and how confident. }}</p>',
        prompt: P(
          'Three sentences: the problem, what separates the options from each other,',
          'and what you would pick with how confident you are. Written last.',
        ),
      },
      {
        id: 'problem', toc: '1 · The problem', heading: '1 · The problem',
        body: '    <p>{{ What has to be true afterwards. }}</p>\n'
          + '    <table>\n'
          + '      <thead><tr><th style="width:52px">#</th><th>What a good answer has to do</th><th>Hard or soft</th></tr></thead>\n'
          + '      <tbody><tr><td>C1</td><td>{{ … }}</td><td>{{ hard: rules an option out · soft: scores it }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'What has to be true afterwards, then the criteria as a numbered table.',
          'Mark each hard or soft: a hard criterion rules an option out, a soft one',
          'only scores it. Write these before sketching the options. Criteria',
          'written afterwards describe the option already preferred, which is how a',
          'comparison becomes a justification.',
        ),
      },
      {
        id: 'options', toc: '2 · The options', heading: '2 · The options',
        body: '    <div class="panel">\n'
          + '      <h4 style="margin-top:0">A · {{ name }}</h4>\n'
          + '      <p>{{ How it works, in a paragraph. }}</p>\n'
          + '      <p class="sub">Best case: {{ … }} · Worst case: {{ … }} · What it assumes: {{ … }}</p>\n'
          + '    </div>\n'
          + '    <div class="panel">\n'
          + '      <h4 style="margin-top:0">B · {{ name }}</h4>\n'
          + '      <p>{{ … }}</p>\n'
          + '      <p class="sub">Best case: {{ … }} · Worst case: {{ … }} · What it assumes: {{ … }}</p>\n'
          + '    </div>',
        prompt: P(
          'Three to five options, one panel each, sketched far enough that someone',
          'could argue against them. Each carries its best case, its worst case, and',
          'what it assumes.',
          'Sketch all of them before evaluating any. Parallel exploration produces',
          'more divergent options and better final results than refining one idea',
          'serially, and the mechanism is that it stops the first idea anchoring',
          'everything after it. If options B and C are variations on A, the space',
          'has not been searched: go back and generate one that starts from a',
          'different premise, even a premise you expect to reject.',
          'Every option must be one a reasonable person would argue for. An option',
          'included to make another look good teaches the reader nothing and is',
          'worse than having four.',
        ),
      },
      {
        id: 'comparison', toc: '3 · Side by side', heading: '3 · Side by side',
        body: '    <table class="sortable">\n'
          + '      <thead><tr><th>Criterion</th><th>A</th><th>B</th><th>C</th></tr></thead>\n'
          + '      <tbody><tr><td>C1 {{ … }}</td><td>{{ … }}</td><td>{{ … }}</td><td>{{ … }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'One row per criterion from section 1, in the same order and using the same',
          'numbers. Cells say what actually happens under that criterion, not a mark',
          'out of five: a score hides the reasoning that makes the comparison worth',
          'reading. A criterion where every option scores the same is not',
          'discriminating and should be cut or sharpened.',
        ),
      },
      {
        id: 'recommendation', toc: '4 · What I would pick', heading: '4 · What I would pick',
        body: '    <p>{{ The option, and the criterion that decided it. }}</p>\n'
          + '    <p class="sub">What would change my mind: {{ … }} · What I would take from the runner-up: {{ … }}</p>',
        prompt: P(
          'Name the option and the single criterion that decided it. Then two',
          'things: what would change your mind, stated concretely enough that it',
          'could actually happen, and what is worth taking from the runner-up. The',
          'first keeps the recommendation falsifiable; the second is usually where',
          'the best answer is.',
        ),
      },
      {
        id: 'discarded', toc: '5 · Ruled out early', heading: '5 · Ruled out early',
        body: '    <ul><li>{{ An option considered and dropped before it was sketched, and which criterion killed it. }}</li></ul>',
        prompt: P(
          'Options considered and dropped before they were worth sketching, each',
          'with the hard criterion that killed it. This stops the same suggestion',
          'coming back in review, and it shows the space was actually searched.',
        ),
      },
      {
        id: 'open-questions', toc: '6 · Open questions', heading: '6 · Open questions',
        body: '    <ul>\n'
          + '      <li data-sf-q="open"><strong>Q1 <span class="tag warn">open</span></strong> {{ The question, and which option it would change. }}</li>\n'
          + '    </ul>',
        prompt: P(
          'Each question says which option it would change if answered one way',
          'rather than another. A question that changes nothing is not blocking the',
          'decision and should be dropped.',
        ),
      },
    ],
  },

  // -------------------------------------------------------- Security review --
  {
    name: 'Security review',
    slug: 'security-review',
    whenToUse: P(
      'Review something we built for the ways it can be abused: what is worth',
      'protecting, where the trust boundaries are, what was found, and what gets',
      'fixed in what order. Pick this for a feature, a service or a dependency',
      'surface, before it is exposed to anyone.',
    ),
    sections: [
      {
        id: 'tldr', toc: 'TL;DR', heading: 'TL;DR', panel: true,
        body: '      <p style="margin-bottom:0">{{ What was reviewed. }} {{ How many findings, at what severities. }} {{ The one that has to be fixed before this ships. }}</p>',
        prompt: P(
          'Three sentences: what was reviewed, the finding count by severity, and',
          'the single one that blocks shipping. If nothing blocks shipping, say that',
          'plainly. Written last.',
        ),
      },
      {
        id: 'scope', toc: '1 · Scope', heading: '1 · Scope',
        body: '    <p>{{ What was reviewed, at which commit, and how: read, run, or both. }}</p>\n'
          + '    <p class="sub">Not reviewed: {{ … }} · Why not: {{ … }}</p>',
        prompt: P(
          'What was reviewed, at which commit, and by what method: reading, running,',
          'fuzzing, dependency scan. Then what was not reviewed and why. The second',
          'half is the part that matters: a review with no stated boundary gets read',
          'as covering everything, and that is how a gap becomes a surprise.',
        ),
      },
      {
        id: 'assets', toc: '2 · What an attacker wants', heading: '2 · What an attacker wants',
        body: '    <table>\n'
          + '      <thead><tr><th>Asset</th><th>Where it lives</th><th>Value to an attacker</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ customer data, keys, credits, uptime }}</td><td>{{ … }}</td><td>{{ … }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'What an attacker would actually want: customer data, credentials and',
          'keys, anything that costs money to consume, and availability. Where each',
          'lives, and what it is worth to them. Findings are ranked against this',
          'table, so an asset missing here produces a finding that reads as',
          'unimportant.',
        ),
      },
      {
        id: 'surface', toc: '3 · Attack surface', heading: '3 · Attack surface',
        body: '<pre data-lang="mermaid">{{ the data flow, with the trust boundaries marked }}</pre>\n'
          + '    <table>\n'
          + '      <thead><tr><th>Entry point</th><th>Who can reach it</th><th>Trusted input?</th><th>What it can do</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ endpoint, upload, webhook, job, dependency }}</td><td>{{ anonymous, tenant, admin }}</td><td>{{ … }}</td><td>{{ … }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Draw the data flow first, with the trust boundaries marked: where',
          'untrusted input enters and where sensitive data leaves. The diagram is',
          'not decoration, it is what makes the next section systematic instead of',
          'a list of whatever came to mind.',
          'Then the table: every way in. Endpoints, uploads, webhooks, queue',
          'consumers, scheduled jobs, third-party callbacks, installed dependencies.',
          'For each, who can reach it, whether its input is trusted, and what it can',
          'do once inside. Most real findings sit on a boundary somebody assumed was',
          'inside.',
        ),
      },
      {
        id: 'stride', toc: '4 · STRIDE at each boundary', heading: '4 · STRIDE at each boundary',
        body: '    <table>\n'
          + '      <thead><tr><th>Boundary</th><th>S</th><th>T</th><th>R</th><th>I</th><th>D</th><th>E</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ boundary }}</td><td>{{ … }}</td><td>{{ … }}</td><td>{{ … }}</td><td>{{ … }}</td><td>{{ … }}</td><td>{{ … }}</td></tr></tbody>\n'
          + '    </table>\n'
          + '    <p class="footnote">Spoofing · Tampering · Repudiation · Information disclosure · Denial of service · Elevation of privilege</p>',
        prompt: P(
          'One row per trust boundary from the diagram above, and for each of the',
          'six STRIDE categories, what an attacker would try there and what stops',
          'them. This is a checklist rather than an insight generator, and that is',
          'its value: it is what turns "we thought about security" into coverage you',
          'can point at. A cell where nothing stops them becomes a finding in the',
          'next section, with its number. A cell that genuinely does not apply says',
          'so in two words rather than being left blank, because a blank cell and a',
          'considered "not applicable" look identical afterwards.',
        ),
      },
      {
        id: 'findings', toc: '5 · Findings', heading: '5 · Findings',
        body: '    <table>\n'
          + '      <thead><tr><th style="width:52px">#</th><th>Finding</th><th>Impact</th><th>Likelihood</th><th style="width:80px">Severity</th><th>What an attacker gets</th><th>How to reproduce</th></tr></thead>\n'
          + '      <tbody><tr><td>F1</td><td>{{ … }}</td><td>{{ low/med/high }}</td><td>{{ low/med/high }}</td><td><span class="tag bad">high</span></td><td>{{ concretely, not "compromise" }}</td><td>{{ steps, or the code path }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Numbered findings, each traceable to a boundary and a STRIDE cell above.',
          'Severity is impact against section 2 combined with likelihood, not how',
          'clever the bug is: a trivial bug on a boundary anyone can reach outranks',
          'an elegant one behind an admin login. Rate impact and likelihood',
          'separately and show both, because a single number hides which half drove',
          'it and therefore which half a fix has to change.',
          'Say what the attacker gets concretely: "reads any tenant\'s uploads",',
          'not "data exposure". Give repro steps or the exact code path so the fix',
          'can be verified. Describe the class of problem and the path to it; do not',
          'write a working exploit into the document.',
        ),
      },
      {
        id: 'fixes', toc: '6 · What to fix, in order', heading: '6 · What to fix, in order',
        body: '    <table>\n'
          + '      <thead><tr><th>Finding</th><th>Fix</th><th>Effort</th><th>Before shipping?</th></tr></thead>\n'
          + '      <tbody><tr><td>F1</td><td>{{ … }}</td><td>{{ hours or days }}</td><td>{{ yes/no }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Ordered by what it buys per hour spent, not by severity alone: a medium',
          'finding fixed in ten minutes goes before a high one that needs a',
          'redesign. Each row says whether it blocks shipping. Name the test that',
          'stops each one coming back, because a fix with no guard has a half-life.',
        ),
      },
      {
        id: 'accepted', toc: '7 · Risks accepted', heading: '7 · Risks accepted',
        body: '    <ul><li>{{ The risk, why it is acceptable now, and what would make it unacceptable. }}</li></ul>',
        prompt: P(
          'Risks being carried deliberately, each with why it is acceptable at this',
          'size and the specific change that would make it unacceptable: a user',
          'count, a data type, a customer, a jurisdiction. An accepted risk with no',
          'trigger is a forgotten risk. This section is the honest one; a security',
          'review with everything either fixed or absent is not describing a real',
          'system.',
        ),
      },
      {
        id: 'open-questions', toc: '8 · Open questions', heading: '8 · Open questions',
        body: '    <ul>\n'
          + '      <li data-sf-q="open"><strong>Q1 <span class="tag warn">open</span></strong> {{ The question, and what it blocks. }}</li>\n'
          + '    </ul>',
        prompt: P('Each question says what it blocks. Prose, not labelled fields.'),
      },
    ],
  },

  // ------------------------------------------------------------- Test plan --
  {
    name: 'Test plan',
    slug: 'test-plan',
    whenToUse: P(
      'What has to be true before one change ships, and what proves it: automated',
      'coverage per behaviour, what only a human can check, the data it needs, and',
      'what is deliberately untested. Pick this per feature. It is not the',
      'codebase-wide testing strategy.',
    ),
    sections: [
      {
        id: 'tldr', toc: 'TL;DR', heading: 'TL;DR', panel: true,
        body: '      <p style="margin-bottom:0">{{ What is being tested. }} {{ What working means for it. }} {{ The behaviour that breaks quietly. }}</p>',
        prompt: P(
          'Three sentences: what is being tested, what working means for it, and the',
          'behaviour most likely to break while going unnoticed. That last one is',
          'what this plan exists to catch. Written last.',
        ),
      },
      {
        id: 'scope', toc: '1 · What working means', heading: '1 · What working means',
        body: '    <p>{{ The change, and the specs it implements. }}</p>\n'
          + '    <ul><li>{{ A statement that must be true afterwards, checkable by looking. }}</li></ul>',
        prompt: P(
          'The change and the spec it implements, then working stated as a list of',
          'things that must be true afterwards, each checkable by looking. "The',
          'feature works" is not one of them. Every item here is claimed by',
          'something in section 3 or section 4; an item claimed by neither is an',
          'untested requirement and the plan should say so.',
        ),
      },
      {
        id: 'risk', toc: '2 · What breaking would cost', heading: '2 · What breaking would cost',
        body: '    <table>\n'
          + '      <thead><tr><th>If this breaks</th><th>Who notices</th><th>How long until we know</th><th>Cost</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ … }}</td><td>{{ user, us, nobody }}</td><td>{{ … }}</td><td>{{ … }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'One row per way this can break. The column that decides everything else',
          'is who notices: a failure only a user notices needs a test, and a failure',
          'nobody notices needs a test and an alarm. Effort in the sections below is',
          'allocated from this table, so a plan that tests everything equally has',
          'skipped it.',
        ),
      },
      {
        id: 'automated', toc: '3 · Automated coverage', heading: '3 · Automated coverage',
        body: '    <table>\n'
          + '      <thead><tr><th>Behaviour</th><th>Test</th><th>Level</th><th>Fails when</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ … }}</td><td><code>{{ file::name }}</code></td><td>{{ unit, integration, e2e }}</td><td>{{ what has to break for this to go red }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'One row per behaviour, not per test file. The last column is the one that',
          'makes the table worth writing: say what has to break for the test to go',
          'red, because a test that cannot answer that is testing its own mocks.',
          'Prefer the cheapest level that can actually observe the behaviour. Write',
          'the test before the implementation and confirm it fails first.',
        ),
      },
      {
        id: 'human', toc: '4 · What only a human can check', heading: '4 · What only a human can check',
        body: '    <table>\n'
          + '      <thead><tr><th style="width:42px">#</th><th>Step</th><th>Expected</th></tr></thead>\n'
          + '      <tbody><tr><td>1</td><td>{{ copy-pasteable }}</td><td>{{ what you should see }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Numbered steps, each copy-pasteable, with what should be seen. This is',
          'for what a headless environment genuinely cannot observe: layout, real',
          'pointer behaviour, rendering, focus, scroll position, whether a thing',
          'looks like what it came from. Drive a real pointer rather than calling',
          'click(), which reaches an element whether or not a pointer could get to',
          'it. Keep the whole walk under thirty minutes.',
        ),
      },
      {
        id: 'data', toc: '5 · Entry criteria: data and environment', heading: '5 · Entry criteria: data and environment',
        body: '    <p>{{ What has to be running before testing can start, and the exact command. }}</p>\n'
          + '    <p class="sub">Fixtures and accounts: {{ … }} · What must not run at the same time: {{ … }}</p>',
        prompt: P(
          'The entry criteria: what has to be true before testing can start. What',
          'must be running, with the exact command, and which fixtures or accounts',
          'the tests need. Then what must not run at the same time. A shared',
          'database with two suites against it produces failures that are not real',
          'and root causes that are not there, so name the conflict here rather than',
          'debugging it later.',
        ),
      },
      {
        id: 'not-tested', toc: '6 · Deliberately not tested', heading: '6 · Deliberately not tested',
        body: '    <ul><li>{{ What, why it is acceptable, and what would change that. }}</li></ul>',
        prompt: P(
          'What is knowingly left uncovered, why that is acceptable now, and what',
          'would change it. Untested and unmentioned reads as tested to the next',
          'person, which is the mistake this section exists to prevent.',
        ),
      },
      {
        id: 'gate', toc: '7 · Exit criteria', heading: '7 · Exit criteria',
        body: '    <ul><li>{{ What must be green, run how, before this ships. }}</li></ul>\n'
          + '    <p class="sub">What we ship with anyway, if it comes to it: {{ … }}</p>',
        prompt: P(
          'The exit criteria: the exact commands that must pass before this ships,',
          'in order, and where each runs. Run the suite the way the runner runs it',
          'rather than the way it runs on your machine, because a test that reads an',
          'ambient session or a local file passes locally and fails in CI. Name the',
          'browser walk as part of the gate where section 4 has one.',
          'Then the line that makes the gate real: what would be shipped with',
          'anyway, and what would not. A gate with no stated exception is one that',
          'gets waived silently the first time it is inconvenient.',
        ),
      },
    ],
  },

  // -------------------------------------------------------- Product phasing --
  {
    name: 'Product phasing spec',
    slug: 'product-phasing-spec',
    whenToUse: P(
      'Break a body of work into phases, each ending in a capability the team or a',
      'user gains. Says what forces the order, what ends each phase, and what is',
      'deferred to which one. Pick this before an implementation plan, which',
      'sequences PRs inside a phase.',
    ),
    sections: [
      {
        id: 'tldr', toc: 'TL;DR', heading: 'TL;DR', panel: true,
        body: '      <p style="margin-bottom:0">{{ Where this ends up. }} {{ How many phases, and the capability each one gains. }} {{ What forces the order. }}</p>',
        prompt: P(
          'Three sentences: where this ends up, the phases and the capability each',
          'gains, and what forces the order. Written last.',
        ),
      },
      {
        id: 'goal', toc: '1 · Where this ends up', heading: '1 · Where this ends up',
        body: '    <p>{{ The state of the product after the last phase, described as what it can do. }}</p>\n'
          + '    <p class="sub">What is true today that will not be: {{ … }}</p>',
        prompt: P(
          'The end state described as what the product can do, not as what was',
          'built. Then what is true today that will not be afterwards. Phases are',
          'judged against this section, so a goal stated as a list of components',
          'produces phases stated as a list of components.',
        ),
      },
      {
        id: 'phases', toc: '2 · The phases', heading: '2 · The phases',
        body: '    <div class="panel">\n'
          + '      <h4 style="margin-top:0">Phase 1 · Capability: {{ what can be done afterwards that cannot be done now }}</h4>\n'
          + '      <p>{{ What it takes, at the level of pieces rather than tasks. }}</p>\n'
          + '      <p class="sub">Still cannot: {{ … }} · Rough size: {{ … }} · Confidence: <span class="tag good">validated</span></p>\n'
          + '    </div>\n'
          + '    <div class="panel">\n'
          + '      <h4 style="margin-top:0">Phase 2 · Capability: {{ … }}</h4>\n'
          + '      <p>{{ … }}</p>\n'
          + '      <p class="sub">Still cannot: {{ … }} · Rough size: {{ … }} · Confidence: <span class="tag warn">in discovery</span></p>\n'
          + '    </div>',
        prompt: P(
          'One panel per phase. The heading names the capability gained, in the form',
          '"Capability: X", never the mechanism used to get it: a phase called',
          '"introduce the queue" is organised around the designer\'s interest rather',
          'than the reader\'s.',
          'Each panel says what it takes at the level of pieces, what still cannot',
          'be done afterwards, a rough size, and a confidence: validated, in',
          'discovery, or undefined. Confidence is what makes a phase list honest',
          'about its own tail. Only the near phases can be validated, the middle',
          'ones are still being worked out, and the far ones may never happen. A',
          'plan where every phase is equally certain is a plan that has not thought',
          'about its own uncertainty.',
          'The first phase should be a thin slice through every layer rather than',
          'one layer built completely: a walking skeleton proves the pieces connect,',
          'which is the risk worth retiring first, and a horizontal phase proves',
          'nothing until the phase after it lands.',
          'The "still cannot" line is what keeps each phase honest about being',
          'partial.',
        ),
      },
      {
        id: 'order', toc: '3 · Why this order', heading: '3 · Why this order',
        body: '    <table>\n'
          + '      <thead><tr><th>Phase</th><th>Cannot start until</th><th>Forced, or chosen?</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ … }}</td><td>{{ … }}</td><td>{{ forced by a real dependency · chosen for risk or value }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'What each phase cannot start until, and whether that is a real dependency',
          'or a preference. Separating the two is the whole point: the chosen',
          'orderings can be revisited when something changes, and a plan that',
          'presents preference as necessity cannot be replanned.',
          'Foundational work that has to precede visible work (a migration, a',
          'schema, an auth change) is a forced ordering and should be named as one,',
          'because it is the ordering most often argued with by someone looking at',
          'the user-visible list.',
        ),
      },
      {
        id: 'gates', toc: '4 · What ends each phase', heading: '4 · What ends each phase',
        body: '    <table>\n'
          + '      <thead><tr><th>Phase</th><th>Done when</th><th>Observable how</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ … }}</td><td>{{ … }}</td><td>{{ who does what, and sees what }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Done stated as something observable: someone does a specific thing and',
          'sees a specific result. Not "the code is merged". A phase whose gate is',
          'the absence of remaining tasks has no gate, and it is the phase that',
          'quietly extends.',
        ),
      },
      {
        id: 'deferred', toc: '5 · Deferred', heading: '5 · Deferred',
        body: '    <table>\n'
          + '      <thead><tr><th>Deferred</th><th>To which phase</th><th>What it costs to wait</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ … }}</td><td>{{ … }}</td><td>{{ … }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'What is knowingly left out of the early phases, which phase it lands in,',
          'and what waiting costs. Include the things that will be asked about in',
          'review, since an omission with no row here reads as an oversight.',
        ),
      },
      {
        id: 'risks', toc: '6 · What would reorder this', heading: '6 · What would reorder this',
        body: '    <ul><li>{{ A thing that could happen, and how the phases change if it does. }}</li></ul>',
        prompt: P(
          'Concrete events that would change the plan, each with what the phases',
          'become if it happens. A finding in phase 1, a dependency that does not',
          'arrive, a number that comes back wrong. Not a generic risk register: only',
          'events that would actually reorder the work.',
        ),
      },
      {
        id: 'open-questions', toc: '7 · Open questions', heading: '7 · Open questions',
        body: '    <ul>\n'
          + '      <li data-sf-q="open"><strong>Q1 <span class="tag warn">open</span></strong> {{ The question, and which phase it blocks. }}</li>\n'
          + '    </ul>',
        prompt: P('Each says which phase it blocks. Scope and taste only. Prose.'),
      },
    ],
  },

  // ------------------------------------------------------------ Launch plan --
  {
    name: 'Launch plan',
    slug: 'launch-plan',
    whenToUse: P(
      'Getting something out: what must be true before we go, the ordered sequence,',
      'how to undo it, what to watch and for how long. Pick this for a deploy, a',
      'store submission, an enablement or a public announcement.',
    ),
    sections: [
      {
        id: 'tldr', toc: 'TL;DR', heading: 'TL;DR', panel: true,
        body: '      <p style="margin-bottom:0">{{ What is launching, to whom, when. }} {{ The step that cannot be undone. }} {{ Who is watching afterwards. }}</p>',
        prompt: P(
          'Three sentences: what is launching, to whom and when; the step that cannot',
          'be undone; and who is watching afterwards. Written last.',
        ),
      },
      {
        id: 'what', toc: '1 · What is launching', heading: '1 · What is launching',
        body: '    <p>{{ The change, and the commit or version going out. }}</p>\n'
          + '    <p class="sub">Who gets it: {{ everyone, a cohort, one account }} · What they will notice: {{ … }}</p>',
        prompt: P(
          'The change and the exact commit or version. Then who receives it and what',
          'they will notice. If the answer to the second is "nothing", say so: a',
          'silent launch is planned differently from a visible one.',
        ),
      },
      {
        id: 'readiness', toc: '2 · Readiness', heading: '2 · Readiness',
        body: '    <table>\n'
          + '      <thead><tr><th>Must be true</th><th>Checked how</th><th>State</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ … }}</td><td>{{ the command, the dashboard, the person }}</td><td><span class="tag warn">not yet</span></td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Everything that must be true before starting, each with how it gets',
          'checked: a command, a dashboard, a person who confirms. Include the',
          'unglamorous ones, which are the ones that stop a launch at 9pm:',
          'migrations applied, secrets present, quotas raised, certificates valid,',
          'the previous version still deployable.',
        ),
      },
      {
        id: 'sequence', toc: '3 · The sequence', heading: '3 · The sequence',
        body: '    <table>\n'
          + '      <thead><tr><th style="width:42px">#</th><th>Step</th><th>Command or action</th><th>Reversible?</th></tr></thead>\n'
          + '      <tbody><tr><td>1</td><td>{{ … }}</td><td><code>{{ … }}</code></td><td>{{ yes · no, and why }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Numbered steps in order, with the exact command or action. Mark each',
          'reversible or not. The irreversible ones are the plan: put them as late',
          'as possible and say what happens if the step after one of them fails.',
          'Anything requiring a human decision mid-sequence says what the decision',
          'is and who makes it.',
          'Say whether this goes out to everyone at once or to a fraction first. A',
          'staged rollout is the cheapest risk reduction available, and where it is',
          'not being used the plan should say why: no traffic split, not worth the',
          'complexity, or a change that cannot be partially applied. Where it is,',
          'give the fractions, how long each step is held, and the numbers that',
          'decide whether it widens.',
        ),
      },
      {
        id: 'rollback', toc: '4 · How we undo it', heading: '4 · How we undo it',
        body: '    <p>{{ The rollback, as commands, in order. }}</p>\n'
          + '    <p class="sub">How long it takes: {{ … }} · What it cannot undo: {{ … }} · When we decide to use it: {{ … }}</p>',
        prompt: P(
          'The rollback as commands, in order, with how long it takes end to end.',
          'Then what it cannot undo: sent emails, migrated data, external state,',
          'anything a customer already saw. Then the trigger, decided in advance, so',
          'the call is not being made for the first time under pressure.',
        ),
      },
      {
        id: 'watch', toc: '5 · What we watch', heading: '5 · What we watch',
        body: '    <table>\n'
          + '      <thead><tr><th>Signal</th><th>Where</th><th>Normal</th><th>Act if</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ … }}</td><td>{{ dashboard, query, log }}</td><td>{{ the number before }}</td><td>{{ the threshold }}</td></tr></tbody>\n'
          + '    </table>\n'
          + '    <p class="sub">For how long: {{ … }} · Who is watching: {{ … }}</p>',
        prompt: P(
          'Signals with where they are read, what normal looks like as a number from',
          'before the launch, and the threshold that triggers action. A signal with',
          'no pre-launch baseline cannot be read as good or bad on the night.',
          'Watch on two timescales. A short window of about an hour catches the',
          'sudden break, and a longer one of six to twenty-four hours catches the',
          'slow leak that a short window reads as noise. Most bad launches that get',
          'through are the second kind.',
          'Include at least one signal that would catch the thing you are not',
          'expecting, and at least one that a user would feel rather than one only',
          'the infrastructure reports: a green server with a broken flow is the',
          'failure mode a dashboard is worst at showing. Say how long the watch',
          'lasts and who is doing it.',
        ),
      },
      {
        id: 'comms', toc: '6 · What we tell people', heading: '6 · What we tell people',
        body: '    <table>\n'
          + '      <thead><tr><th>Who</th><th>What</th><th>When</th><th>Where</th></tr></thead>\n'
          + '      <tbody><tr><td>{{ … }}</td><td>{{ … }}</td><td>{{ before, at, after }}</td><td>{{ … }}</td></tr></tbody>\n'
          + '    </table>',
        prompt: P(
          'Who hears what, when, and through what channel. Include what gets said if',
          'it goes wrong, drafted now rather than during the incident. Where there',
          'is nobody to tell, write that instead of leaving the section to imply an',
          'audience that does not exist.',
        ),
      },
      {
        id: 'after', toc: '7 · After', heading: '7 · After',
        body: '    <table>\n'
          + '      <thead><tr><th>Close out</th><th>Done?</th></tr></thead>\n'
          + '      <tbody>\n'
          + '        <tr><td>Flags removed, old code paths deleted</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>Temporary access revoked</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>Alert silences expired, not left open</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>Rollback window closed, and the decision recorded</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>Signals compared against the pre-launch baseline</td><td>{{ … }}</td></tr>\n'
          + '        <tr><td>Documentation and runbooks updated</td><td>{{ … }}</td></tr>\n'
          + '      </tbody>\n'
          + '    </table>\n'
          + '    <p class="sub">When we call it done: {{ … }}</p>',
        prompt: P(
          'The close-out that otherwise never happens. The two rows that bite are',
          'the silenced alert nobody re-enabled, which hides the next incident, and',
          'the temporary access nobody revoked, which is a finding in the next',
          'security review. Recording the rollback decision matters too: the point',
          'where undoing stopped being an option should be a moment somebody chose,',
          'not one that passed unnoticed.',
          'Compare the signals against the baseline from section 5 rather than',
          'against how it felt. Then say when this is called done, so the watch ends',
          'rather than fading out. Add rows for anything this particular launch',
          'leaves behind.',
        ),
      },
      {
        id: 'open-questions', toc: '8 · Open questions', heading: '8 · Open questions',
        body: '    <ul>\n'
          + '      <li data-sf-q="open"><strong>Q1 <span class="tag warn">open</span></strong> {{ The question, and whether it blocks the launch. }}</li>\n'
          + '    </ul>',
        prompt: P('Each says whether it blocks the launch. Prose.'),
      },
    ],
  },
];
