---
title: "Spec verification: rules that run after a spec is written"
type: design-impl
status: approved
specforge_id: 543ebb7b12
---

# Spec verification: rules that run after a spec is written

## TL;DR

<!-- sf:box class="panel" -->

Specs are checked today by `lib/lint-spec.mjs`, which is already a rule engine: eight named checks returning `{name, ok, detail, advisory}`. Every one is a regex or a DOM count, so it catches a missing `<h1>` and cannot catch a decision with no rationale, a number with no source, or a TL;DR that contradicts the decisions below it.

This adds a second kind of rule to the same runner. A rule is either check (a function, deterministic, free) or ask (a sentence the agent judges against the spec). One registry, one report, one verdict.

`specforge verify <id>` is a **gate**: PASS or FAIL, exit 0 or 1, and a spec is not finished until it passes. FAIL names every rule the spec breaks and says which kind of work each needs. The agent fixes the mechanical ones, reads the spec against the judged ones, and runs it again with `--judged` naming what it settled. A rule nobody has judged counts against the spec exactly like a broken one, because otherwise nobody judges it.

Rules come from two places: a global list in the repo, and a per-template list living in a `<section data-sf-rules>` inside each template spec, which the scaffolder strips when creating from it. You edit a template's rules the way you edit anything else in SpecForge, and new specs never carry the block.

A template carries one more thing, which is not a rule. The two sections that drew the heaviest correction in the corpus, open-questions at 44 comments and decisions at 9, were being asked to be *written* a particular way rather than to hold a property a finished spec has, and a check cannot enforce that without either passing on everything or firing on everything. Those become **section prompts**: a `data-sf-prompt` block inside a template's section, handed to the agent before that section is written and stripped like the rules block. Open questions and Decisions ship with one.

32 global rules are proposed in [§5](#testing), 14 answered by code and 18 by the agent, with each type's template adding its own on top. Families A to D (27) are reasoned from the language contract and the shape of the shell. Family E (5 global, plus 3 that live in templates because they are scoped to one type) is derived from 274 review comments across 20 of your specs, and each of its rules cites the comments that produced it. The rest of what that corpus asked for became prompts, or is recorded in [§5.E](#testing) as evidence that produced no check.

The gate runs at the end of `create-spec`, which does not hand over until it passes, capped at three rounds. Nothing is stored: this is not a user-visible feature, it exists so specs stop repeating the same mistakes. Running the judging in a separate agent turns out to be one sentence in the skill rather than a mechanism, because the harness owns subagents and the skill only has to ask.

## 1 · What exists

<!-- sf:section id="overview" -->

`lib/lint-spec.mjs` exports `lintSpec(html)`, which returns `{ok, checks}` where each check is `{name, ok, detail, advisory?}`. The verdict is `checks.filter(c => !c.advisory).every(c => c.ok)`. Five skills call it and eight test files import it.

| Check | Blocking | What it can see |
| --- | --- | --- |
| `has-title` | yes | a regex for a non-empty h1 or title |
| `has-status` | yes | `data-sf-spec-status` is present |
| `unique-section-ids` | yes | duplicate id attributes |
| `theme-contract` | yes | the light/dark blocks are declared |
| `palette-tokens` | yes | the canonical tokens are defined |
| `commentability` | advisory | a count of divs holding text directly |
| `spec-components` | advisory | classes not in the component library |
| `spec-language` | advisory | five regexes over stripped prose |

Every one is mechanical, and that is the ceiling. The lint passes on a spec whose Decisions table has a Choice column full of dashes, whose TL;DR promises something the Design section rejects, or whose every section is a heading followed by one sentence of throat-clearing. Those are the failures worth catching, and none of them is a pattern.

<!-- sf:callout variant="note" -->

> The eight checks are not being replaced. They become entries in the new registry with their current names, severities and messages, so a caller reading `lintSpec`'s output sees what it sees today.

#### Two facts about the store that shape the design

- **Templates are specs.** `lib/store-templates.mjs` keeps one protected spec per type at `template-<type>`, and its `spec.html` IS the template that `create` scaffolds from. Editing it through the normal browser-and-agent flow edits what every future spec starts from. A per-template rule list can therefore live inside the template and be edited with no new surface at all.
- **`create` copies the template wholesale.** `cmdCreate` calls `templateHtmlFor(type)` and writes the result as the new spec. Anything in the template appears in the spec, so a rules block has to be removed on the way through.

## 2 · Requirements

What must be true for this design to succeed — the product and engineering requirements that underlie it, and the problem it solves. Requirements are the "what" and "why"; the Design section is the "how".

#### Problem

A spec can pass every mechanical check and still be unfinished, unsupported or self-contradicting. The author agent is the only thing standing between that and the reader, and it is the party least able to see it, having just written the spec.

#### Product requirements

- A rule list that applies to every spec, whatever its type.
- A per-template rule list, edited in SpecForge like any other part of a template.
- Rules are verified one at a time, each with its own verdict, so a failure names what failed rather than that something did.
- A failing rule is fixed by the agent and re-verified, not merely reported.
- A rule can be a sentence of English. Adding one must not require writing code.
- Verification runs at the end of spec creation without being asked for.
- Guidance that shapes how a section is written, rather than testing what it became, is carried by the template as a prompt and reaches the agent before authoring. It is not modelled as a rule, because a rule that cannot produce a verdict is a rule that always passes.

#### Engineering requirements

- Harness-agnostic. SpecForge runs under Claude Code today and is written to run anywhere; nothing may depend on a specific agent runtime, and nothing may call a model from Node.
- Zero new runtime dependencies, per the plugin's standing constraint.
- `lintSpec(html)` keeps its signature and its current output. Five skills and eight test files depend on it.
- The mechanical half stays free and offline: a rule that is a function must not need an agent to answer it.
- A template with no rules block, or an emptied one, still produces working specs. The global list is the floor.

## 3 · Goals & non-goals

<!-- sf:section id="goals" -->

#### Goals

- One registry holding both kinds of rule, and one report.
- A global list good enough to be worth running on the 115 specs already in the store.
- A per-template list you can edit without leaving SpecForge and without asking an agent.
- A verification pass that ends in a spec the author agent has already fixed, or a short list of what it could not.

#### Non-goals

- Verifying on every edit. Creation only, per the decision in D6. Review rounds already put the output in front of you.
- Storing verification history. Nothing writes a `verify.json`; the run is a report, not a record. See Q3.
- A UI for rules. The template spec is the UI.
- Blocking approval on a failing rule. The lifecycle stays the author's; verification informs it.
- Rules that reach outside the spec. No rule opens the repo, the store's other specs, or the network in v1.
- Making the existing advisory checks blocking. Their severities are unchanged; retuning them is a separate argument.

<!-- sf:callout variant="constraint" -->

> KISS. Solve the problem in front of you, not a speculative future one. Cut anything not needed now.

## 4 · Design

#### Summary

A rule is a record in a registry. It carries an id, a scope, a severity, and exactly one of two ways to be answered: `check(html, ctx)` returning a verdict, or `ask`, a sentence of English the agent judges against the spec. `lintSpec` becomes a thin wrapper that runs the check-rules and reports them in its current shape, so every existing caller is unaffected. `specforge verify <id>` runs the check-rules and prints the ask-rules that remain, which is the agent's work list.

Node never calls a model. It cannot: SpecForge ships with zero runtime dependencies and has to run under any harness. The split falls out of that constraint rather than being chosen for elegance. The mechanical half is free, offline and testable; the judged half is a payload the agent answers, and the skill is what makes the agent answer it.

#### Concepts

| Concept | What it is | Answered by | Lives in |
| --- | --- | --- | --- |
| **check-rule** | A deterministic function over the spec HTML. The eight current lint checks are all of this kind. | Node, free | `lib/rules/*.mjs` |
| **ask-rule** | A sentence stating what must be true, judged by reading the spec. "Every row of the Decisions table gives a reason, not a restatement of the choice." | the agent | the registry, or a template's rules block |
| **global list** | Rules that apply to every spec whatever its type. The floor; a template cannot remove one. | both kinds | `lib/rules/global.mjs` |
| **template list** | Rules for one spec type, added to the global list. Prose, edited by you. | ask-rules only | `<section data-sf-rules>` in `template-<type>` |
| **section prompt** | Authoring guidance for one section of one type, read before that section is written. Never checked and never reported: it shapes the draft instead of judging it. | nobody, it is instruction | `data-sf-prompt` inside a section of `template-<type>` |
| **verdict** | `{id, ok, severity, detail}`. A failing blocking rule means the spec is not finished; a failing advisory rule is reported and not fixed automatically. | either | the report |

#### Architecture

Three files are added and four are changed. No component is removed, and the daemon, the review layer and the store are untouched.

![Architecture: the rule registry, the runner, and who answers which kind of rule](2026-08-15-spec-verification-spec.assets/design-1.svg)

<!-- sf:svg id="design-1" -->

*Legend: added (green) · changed (blue) . Nothing is removed.*

#### The rule record

lib/rules/global.mjs — the shape

```
{
  id: 'no-placeholders',        // stable; what a report and a template override name
  scope: 'all',                 // 'all' | a spec type
  severity: 'blocking',         // 'blocking' | 'advisory'
  title: 'No scaffolding placeholders remain',
  // EITHER a function...
  check: (html) => {
    const left = html.match(/\{\{[^}]*\}\}/g) || [];
    return { ok: left.length === 0, detail: left.length ? `${left.length} left` : 'none' };
  },
  // ...OR a sentence the agent judges. Never both.
  ask: null,
  fix: 'Replace each one, or delete the block if the section does not apply.',
}
```

A rule with `check` is answered by Node. A rule with `ask` is answered by whoever is reading, and until they say so it counts as failing. Reporting an unanswered judgement as a pass is the one failure mode that would make the whole system worse than nothing; treating it as a resting place is the other, because then nobody judges it. The reader reports what they judged with `--judged`, per run, and the gate goes green (D13).

#### Current state, grounded in code

| Component | Today | Change required |
| --- | --- | --- |
| `lib/lint-spec.mjs` | 203 lines. Eight checks inline in `lintSpec`; exports `lintSpec`, `checkLanguage`; has a CLI entrypoint. | The eight move into `lib/rules/` as check-rules with the same names and severities. `lintSpec` becomes a wrapper that runs the check-rules and returns the same `{ok, checks}`. Its CLI keeps working. |
| `lib/rules/` | does not exist | new `index.mjs` (registry, merge, strip), `global.mjs` ([§5](#testing)), `structural.mjs` (the eight moved checks). |
| `lib/verify-spec.mjs` | does not exist | new Runs every rule for a spec's type; returns `{pass, failing, advisories, passed}`. |
| `lib/specforge-cli.mjs` | `cmdCreate` scaffolds from `templateHtmlFor(type)`; 27 commands. | Add `verify <id> [--json]`. `cmdCreate` strips the rules block and the prompts from the scaffolded HTML, and returns the prompts in its JSON. |
| `lib/store-templates.mjs` | Seeds and reads `template-<type>`; `templateHtmlFor` returns the HTML. | Export `templateRules(type)` and `templatePrompts(type)`, which parse the rules block and the prompt blocks out of the template spec. |
| `skills/create-spec/SKILL.md` | Step 4 runs the lint and says not to finish on a failing one. | Step 3 gains the prompts: author each section against its prompt where one exists. Step 4 becomes verify: run it, answer the ask-rules, fix, re-run, at most three rounds. |
| `templates/spec-base-*.html` | Five bundled shells, the seed and fallback for the store templates. | Each gains a `data-sf-rules` block carrying its type's starting rules, and `data-sf-prompt` blocks in `open-questions` and `decisions` ([§6](#observability)). |
| daemon, review layer, store paths | as they are | none |

#### Where a template's rules and prompts live

Both live inside the template spec and neither reaches a spec made from it. They sit in different places because they are read at different times: a rule is about the whole document, so it lives in one block; a prompt is about one section, so it lives in that section.

template-design/spec.html

```
<section data-sf-rules hidden>
  <h2>Rules for a design spec</h2>
  <ul>
    <li data-sf-rule="no-build-plan">
      There is no implementation plan. A design spec that grew stages is a design-impl spec.
    </li>
    <li data-sf-rule="no-aphorisms" data-sf-severity="advisory"></li>
  </ul>
</section>

<section id="open-questions" data-sf-section>
  <h2>Open questions</h2>
  <div data-sf-prompt>
    Every question here is a decision only the reader can make. A question with a
    sensible default is not a question: decide it, record it in Decisions, and leave
    it out. For the rest, give the call in plain words first and technical terms
    second, and offer options with their consequences so a one-word answer settles it.
  </div>
</section>
```

Each `<li data-sf-rule>` is one ask-rule: the id is the attribute, the sentence is the text, the severity defaults to blocking. An empty `<li>` carrying only an id and a severity is an override of a global rule rather than a new rule. Each `<div data-sf-prompt>` is guidance for the section it sits in, with no id and no severity, because nothing reports on it. You add either one by writing prose in the template, which was the requirement.

| Question | Answer |
| --- | --- |
| Does it reach the new spec? | No. `stripTemplateBlocks(html)` removes the rules section and every prompt during `create`, `import` and `import-md`. |
| Then how does a prompt reach the agent? | `cmdCreate` parses the prompts before stripping and returns them in its JSON as `prompts: [{section, text}]`. The guidance arrives with the scaffold and the file arrives clean. |
| Is it visible while editing the template? | Yes, for both. The rules block's `hidden` attribute is dropped by the review layer's own stylesheet, and a prompt is an ordinary block inside an ordinary section. You see and comment on either one like any other block. Without that they would be blocks you can only edit by knowing they are there. |
| What if a template has no block? | The global list applies alone. That is the state every template is in today, so the feature degrades to exactly the current behaviour. |
| Can a template turn a global rule off? | Yes, by id: `<li data-sf-rule="no-aphorisms" data-sf-severity="off">`. Needed because a deck spec is allowed lines a design spec is not. |
| What if two rules share an id? | The template's wins, which is what makes the override work. Two rules with the same id inside one list is a rule-authoring error and `verify` reports it. |

#### Interfaces

Which interfaces between which components change. Capture every touched boundary — component APIs, service / HTTP APIs, frontend↔backend contracts, events / queues — so each component's changes can be scoped to its interface changes. Present it two ways: the table below (for agents to consume) and the interface diagram (for humans to review).

| Interface | Between | New or changed | Change |
| --- | --- | --- | --- |
| `lintSpec(html)` | 5 skills, 8 test files → lint | unchanged | Same signature, same `{ok, checks}`, same eight names and severities. Implemented over the registry instead of inline. This is the compatibility promise the whole refactor hangs on. |
| `verifySpec(html, type, {judged})` | CLI, tests → verifier | new | Returns `{pass, failing, advisories, passed}`. `failing` is every blocking rule the spec does not satisfy, each marked `kind: 'check'` (a function found a defect, fix it) or `kind: 'judge'` (read the spec against it). `judged` names the ids the caller has judged and found satisfied, for this run only. |
| `specforge verify <id> [--json] [--judged a,b]` | agent → CLI | new | Human output for reading, `--json` for an agent to consume. Exit 0 when the gate passes and 1 when it does not, so a harness can gate on it without parsing. |
| `templateRules(type)` | registry → store-templates | new | Parses `data-sf-rules` out of the template spec, returns rule records. Returns `[]` for a template with no block, which is every template today. |
| `templatePrompts(type)` | create → store-templates | new | Parses every `data-sf-prompt` out of the template spec, returns `[{section, text}]` keyed by the enclosing section's id. Returns `[]` for a template with no prompts. |
| `stripTemplateBlocks(html)` | create / import → registry | new | Removes the rules section and every prompt block on the way from template to spec. Idempotent, so importing an HTML file that happens to contain either is also safe. |
| `create` JSON output | CLI → agent | changed | Gains `prompts` beside the existing `id`, `htmlPath`, `url`, `status`, `type`. Additive, so existing callers that read only the old fields are unaffected. |

#### Who runs the verification

You asked for a separate agent if it is easily feasible. It is, and it is not a mechanism: the harness owns subagents, so the skill only has to ask for one and degrade when there is none.

skills/create-spec/SKILL.md — step 4, the portable sentence

```
The spec is not finished until `specforge verify <id>` exits 0. Run it, fix
what it names, run it again, repeat.

A `kind: "judge"` entry is one no function can answer. **If your harness can run
a subagent, judge it in one**, handing it only the spec path and the rules — a
fresh reader judges a document more honestly than its author, and the author is
you. If it cannot, judge them yourself, reading the spec from the top as though
you had not written it. Name the satisfied ones in `--judged` on the next run.
```

That works under Claude Code (the Agent tool), under Codex (its own subagent), and under a harness with neither, where it reads as "do this carefully". No SpecForge code knows which is happening, which is the only way this stays harness-agnostic.

<!-- sf:callout variant="note" -->

> The value is bias, not parallelism. An agent that has just written a spec is the party least able to notice that its TL;DR overclaims. That is worth stating in the skill, because an agent told merely to "verify" will tend to confirm.

#### Data model

Nothing is stored. No file is added to the store, no field to `meta.json`, no migration. The rules are code and template HTML; a run is a report on stdout. The one thing a reader might expect to be persisted, a record of the last verification, is deliberately absent (Q3).

#### The loop

Verify returns PASS or FAIL. FAIL names the rules the spec breaks; the agent fixes them, judges the ones no function can answer, and runs it again. The spec is not finished until it exits 0 (D13). Three rounds, then stop: an agent that cannot satisfy a rule in three attempts is usually failing to understand the rule rather than the spec, and a fourth attempt turns a bad rule into a long silence.

![The verification loop: verify, judge, fix, re-verify, capped at three rounds](2026-08-15-spec-verification-spec.assets/design-2.svg)

<!-- sf:svg id="design-2" -->

*The gate is the exit condition: create-spec hands over on 0, and on nothing else. The three-round cap is an escape hatch, not the normal path, and taking it means saying which rules still fail rather than judging one you do not believe.*

#### Design options considered

| Option | Pros | Cons | Verdict |
| --- | --- | --- | --- |
| **One registry, two kinds of rule** | One place to look, one report, one thing to tune per template. A rule can move from prose to code without moving house when someone works out how to check it mechanically. | Touches `lint-spec.mjs`, which five skills and eight test files depend on. | chosen The compatibility risk is bounded by keeping `lintSpec`'s signature and output, and the tests are what prove it. |
| Two systems: lint stays, verifier is agentic-only | No churn in a widely imported file. Clean separation of free from expensive. | Two reports to read, two places a rule can live, and the question "why did this not fire" has two answers. | rejected The split is an implementation detail of how a rule is answered, and exposing it as two products makes the author hold it. |
| Rules as a JSON schema, validated by a generic engine | Declarative, serialisable, no code in the rule list. | Every mechanical check here is a small program (count divs, diff two lists, parse a style block). A schema expressive enough for them is a language, and a worse one than JavaScript. | rejected The eight checks that exist are the evidence. |
| A model call from Node, so verification is fully automatic | No skill involvement; `verify` would answer everything itself. | Requires an API key and a network dependency in a plugin that has zero runtime dependencies, and it would bind SpecForge to one model vendor. | rejected Directly against the harness-agnostic requirement. |
| Rules in a repo file only, no per-template list | Simplest. One file, versioned, reviewed. | You cannot tune a type's bar without a PR, which was the requirement that started this. | rejected The template block exists precisely so the rules are yours to edit. |

## 5 · The rule list

<!-- sf:section id="testing" -->

32 global rules, applying to every spec whatever its type. Each type's template adds its own on top ([§6.1](#observability)). Every rule carries a **Kind**: fn is answered by Node from the HTML alone, costs nothing and runs offline; ask is a sentence the agent judges by reading the spec. 14 are fn and 18 are ask. Eight of the 14 are the existing lint checks, carried over unchanged and marked so.

The split is a property of the rule, not a preference. A rule is fn when the answer is in the markup: a token that should not be there, a link with no target, a list that should mirror another list. It is ask when the answer is in the meaning: whether a reason is a reason, whether a number has a source, whether two sentences agree. Writing a regex for the second kind produces a check that passes on prose engineered to pass it, which is worse than no check.

Families A to D were reasoned from the language contract and the shape of the shell. Family E was derived from the review corpus and is the stronger evidence: a rule there has been asked for in your own words, and the comments are cited. Read A to D as the floor and E as what practice has actually demanded.

<!-- sf:callout variant="note" -->

> Not every correction in the corpus is a check. Several of the strongest ones ask the author to *write a section a particular way* rather than state a property a finished spec has. Those are **section prompts** and live in the template beside the rules, described in [§6](#observability). A rule fails after the fact; a prompt shapes the draft before there is anything to fail.

#### A. Scaffolding not finished

Mechanical, high hit rate, and the failures a reader notices first.

| Rule | What must be true | Kind | Severity |
| --- | --- | --- | --- |
| `no-placeholders` | No `{{ … }}` remains anywhere in the document. | fn | blocking |
| `no-empty-sections` | Every `<section>` holds something beyond its heading. An empty section is a promise the spec does not keep. | fn | blocking |
| `toc-in-sync` | Every TOC link resolves to a section that exists, and every section is linked. Both directions: a stale link and an unlisted section are the same defect. | fn | blocking |
| `front-matter-filled` | Title, date, owner and status are real values, not the shell's defaults. | fn | blocking |
| `has-title` | A non-empty `<h1>` or `<title>`. existing | fn | blocking |
| `has-status` | `data-sf-spec-status` is present. existing | fn | blocking |
| `unique-section-ids` | No duplicate ids; comments anchor to them. existing | fn | blocking |
| `theme-contract` | Light and dark are both declared. existing | fn | blocking |
| `palette-tokens` | The canonical tokens are defined. existing | fn | blocking |
| `commentability` | Text sits in blocks the review layer can anchor to. existing | fn | advisory |
| `spec-components` | Classes come from the component library. existing | fn | advisory |
| `section-is-more-than-a-stub` | No section is a heading plus a single sentence that restates the heading. Length alone does not decide it, which is why this is judged. | ask | advisory |

#### B. Claims without support

Where an agentic rule earns its cost. None of these is a pattern.

| Rule | What must be true | Kind | Severity |
| --- | --- | --- | --- |
| `decisions-have-reasons` | Every decision row gives a reason, not a restatement of the choice. "Chose X because X is the right approach" is a restatement. | ask | blocking |
| `options-have-verdicts` | Every option in a comparison is marked chosen or rejected and says why. An option table where nothing is chosen is a list, not a decision. | ask | blocking |
| `rejections-are-real` | Rejected options are ones somebody could have picked. A straw man makes the chosen option look inevitable and teaches the reader nothing. | ask | advisory |
| `file-refs-are-real` | Every cited path, function or line reference exists as written. A spec becomes untrustworthy fastest by citing code that has since moved. | ask | blocking |
| `costs-are-stated` | Where the spec claims a benefit, it also states what the choice costs. A design with only upsides has not been thought through in public. | ask | advisory |

Numbers are covered by `prescriptions-name-their-source` in E, which absorbed the narrower `numbers-have-provenance` when the two were merged (D11).

#### C. Internal contradiction

A spec that disagrees with itself is worse than one that is merely thin: the reader cannot tell which half to trust.

| Rule | What must be true | Kind | Severity |
| --- | --- | --- | --- |
| `tldr-matches-body` | Every claim in the TL;DR is supported by the body and contradicted by none of it. The TL;DR is read first, skimmed by everyone, and written earliest. | ask | blocking |
| `resolved-stays-resolved` | A question marked resolved is not described as open elsewhere, and vice versa. | ask | blocking |
| `internal-links-resolve` | Every `#anchor` points at a section that exists. | fn | blocking |
| `terms-are-stable` | One name per concept throughout. A spec that calls the same thing three names makes the reader do the joining. | ask | advisory |
| `diagrams-match-text` | Every node and edge in a diagram appears in the prose, and the prose names nothing the diagram contradicts. | ask | advisory |

The Decisions table drifting from the Design section is covered by `no-repeated-claims` in E, which absorbed the narrower `decisions-match-prose` when the two were merged (D11).

#### D. Language contract

The mechanical slice already exists. The rest is the part `references/spec-language.md` says a regex cannot see, and it says so explicitly.

| Rule | What must be true | Kind | Severity |
| --- | --- | --- | --- |
| `spec-language` | Em dashes, attention-curating phrases, precision theatre, hedged decisions, unfalsifiable superlatives. existing | fn | advisory |
| `every-sentence-carries` | Each sentence carries a decision, a measurement, a source, an assumption or a specification. One that carries none gets cut. This is the contract's first rule and the one it says cannot be checked mechanically. | ask | advisory |
| `no-aphorisms` | No line that works as a standalone tweet. The contract's own example: "A limit discovered through an upload failure is a support ticket" is not a spec. | ask | advisory |
| `resolution-not-persuasion` | The spec assumes the reader has agreed to the direction, and spends its words on resolution rather than selling. | ask | advisory |
| `unknowns-are-written-down` | A threshold that has not been decided says so. An omitted threshold reads as "no threshold". | ask | blocking |

<!-- sf:callout variant="warning" -->

> Nine rules across the whole list are blocking ask\-rules that apply to every spec, which means a normal creation ends with the agent making nine judgements plus whatever its type adds. The per-template lists in [§6](#observability) are where you tune that down; setting a rule to `data-sf-severity="advisory"` keeps it reported without holding up the handover.

#### E. From the comment corpus

Families A to D were reasoned from the language contract and the shape of the shell. This family was derived the other way: from 274 review comments you have written across 20 specs, mined with `scripts/mine-spec-comments.mjs`. A rule here is one you have already asked for, repeatedly, in your own words. Where the corpus and A to D agree, the rule below says so and does not duplicate it.

Comment volume by section: open-questions 44, findings 38, design 21, requirements 13, impl-plan 11, decisions 9, goals 7. Open questions drew 44 corrections against design's 21. None of the 44 became a rule: they became the open-questions prompt in [§6](#observability), because what they ask for is how to write the section, not a property to test once it is written.

| Rule | What must be true | Drawn from | Kind | Severity |
| --- | --- | --- | --- | --- |
| `entities-are-explained` | Every named thing the spec introduces says what it is, why it exists, and what it is for. A list of names is not a description. | "whats this? need more detail" · "Need more details on this. Who added this, when, what for" · "I want to understand these better. Why do these exist, what are they used for" · "whats source?, first_party?, checked_on? I want documentation inline for each field." | ask | blocking |
| `references-are-links` | Every reference to another spec, doc or file is a link, not a bare name or id. Checked over the patterns a reference actually takes: a 10-hex spec id, a path carrying a file extension, a `§n`. One of those outside an `<a>` is a hit. | "No references without links. Through out the spec." | fn | blocking |
| `no-repeated-claims` | No claim or decision appears twice, and none contradicts another. Includes the case the Decisions table and the Design section disagree about what was decided, which is the usual way this fails: a decision changes late and one of the two is updated. | "No claim or decision should be repeated or should contradict each other." · "Take one final pass and check for consistency, contradictions within the spec itself" · "The sidebar contents seem to be duplicated for section 4" | ask | blocking |
| `fields-are-documented` | Every field or column in a data table carries a one-line definition, before the field rather than after it. | "I want documentation inline for each field." · "why are comments following the attribute? shouldn't it be reverse" · "Please add a column for each one with a list of fields" | ask | advisory |
| `prescriptions-name-their-source` | Where the spec states a number as fact or prescribes a practice, it names where that came from: a measurement, a standard, a best practice, or an explicit label as an assumption. A number with none is a guess wearing a uniform. | "Whats the source of each rule. where is it coming from. Do we have best practices rules in here as well?" · "Ensure that these are best practices wrt docker and infra files." · "double check these values against real numbers" | ask | blocking |

<!-- sf:callout variant="decision" -->

> Five rules, of which three are blocking. Three more came out of this corpus and are scoped to a spec type rather than global, so they are defined in their template's block rather than here (D12): `stages-are-explained-plainly` and `fixes-carry-a-guard` under design-impl and impl, `findings-name-what-they-break` under research. Their evidence travelled with them and is quoted in [§6.1](#observability).

#### What the corpus asked for that is not a rule

The mining pass produced more than the eight rules above. The rest is recorded here rather than dropped, because it is the strongest evidence in the corpus and none of it is a property a finished document either has or lacks:

| Corpus signal | Why it is not a check | Where it goes instead |
| --- | --- | --- |
| Plain language first, then depth | Concentrated in open-questions and decisions: 44 and 9 comments. "Simple" has no threshold a verdict can be drawn against, and a rule that fires on every spec teaches nothing. | Section prompt, [§6](#observability) |
| Questions carry options and a default | Whether a fork was genuine is knowable while writing and unknowable after: a question already framed badly reads as a real question. | Section prompt, [§6](#observability) |
| Cut material is gone | Verification runs at creation. Nothing has been cut yet, so the check would pass on every spec it ever sees. It belongs to review, which is a later system. | Not built |
| Claims about code were verified | The claim and the code are both readable, but "was this checked" is a fact about the author's process, not about the spec. | Authoring behaviour |
| Finish the sweep | "Never ever ask me to say the word again. I asked you to fetch for all. Why did you stop in between?" Agent behaviour during authoring. | Authoring behaviour |
| Comment on it | "Can the work map be drawn without using an SVG? i cant comment on the spec blocks this way and i need to." The mechanical half is already the `commentability` check in A; the rest is a reason to prefer HTML structure over one large image. | `commentability`, A |

## 6 · Per-template rules and prompts

<!-- sf:section id="observability" -->

A template carries two things, and they run at opposite ends of authoring. **Rules** (`data-sf-rules`) are checked after the spec is written. **Prompts** (`data-sf-prompt`) are read before a section is written, and shape it. Both are a starting position, not a settlement: they land in the bundled shells, seed into the store templates, and are then yours to edit in SpecForge.

### 6\.1 · Rules

What each type's `data-sf-rules` block ships with, on top of the global list in [§5](#testing). Rules marked corpus came out of the review mining in [§5.E](#testing) and carry the comment that produced them. They are defined here rather than in the global list because their scope is one type, and a rule you can edit without a PR is the point of this block (D12).

#### design

- `no-build-plan` — there is no stage or task list. A design spec that grew one is a design-impl spec, and should be rescaffolded rather than stretched.

#### research

- `findings-cite-sources` — every finding names where it came from. A research spec's whole value is its provenance.
- `method-states-scope` — what was searched, over what period, and what was not looked at.
- `recommendations-follow-findings` — each recommendation traces to a finding above it, and no finding is invented in the recommendations.
- `gaps-are-declared` — the Open questions section names what the research could not answer. Research that claims completeness is the least trustworthy kind.
- `findings-name-what-they-break` corpus — each finding says what rule or principle it violates and, on one line, how it gets fixed. "If these are 'Findings', then I assume that these are intended to be fixed? Can we mention whats wrong with the finding? what rule/best-principle does it break? and how will this be fixed"

#### design-impl

- `stages-are-pr-sized` — one stage is one PR. A stage that touches nine files across four subsystems is a plan, not a stage.
- `tasks-have-verify` — every task carries a `verify:` note stating how you would know it is done.
- `tracker-mirrors-plan` — the task tracker has a row per task in the plan, with matching statuses.
- `stage-zero-is-test-setup` — the first stage stands up whatever later stages need to be tested without human input.
- `runtime-stubs-present` — the Runtime section exists and is empty at creation. It is filled during implementation, and a spec that ships it pre-filled is describing work it has not done.
- `stages-are-explained-plainly` corpus — each stage carries a two-line plain-language summary of what it does, readable by someone who has not read the design. "For each stage write a simple, human readable, Explain like i am a junior engineer (ELIJE) style 2 liner on what the stage is doing"
- `fixes-carry-a-guard` corpus — a stage that fixes a defect says what test stops it coming back. Advisory. "After this, we will have a test that prevents this from happening in future? and enforces this rule" · "do we need a CI for this? cant we add local tests"

#### impl

- `design-lives-elsewhere` — the design prose is light and points at the design spec it implements, rather than restating it.
- `tasks-have-verify`, `tracker-mirrors-plan`, `stage-zero-is-test-setup`, `stages-are-explained-plainly`, `fixes-carry-a-guard` — as design-impl.
- `plan-is-the-bulk` — the implementation plan is the longest section. If it is not, the spec is a design spec wearing the wrong type.

#### general

- `sections-fit-the-document` — the sections are the ones this kind of document needs, chosen deliberately. A postmortem wants timeline and root cause; a runbook wants preconditions and rollback.

#### deck

- `no-aphorisms: off` — a deck is allowed the line a spec is not. This is the override that justifies the mechanism: a global rule turned off for one type, by id.

<!-- sf:callout variant="note" -->

> The deck override is the case worth checking during implementation. If `data-sf-severity="off"` does not work end to end, per-template rules are additive only, which is a weaker feature than the one described here.

### 6\.2 · Prompts

A prompt is authoring guidance attached to one section of one template. It is never checked and never reported: the verifier does not read it. It is handed to the agent at scaffold time, before the section has any content, and removed from the spec on the way out so a reader never sees it.

Two sections get one in the bundled shells. Both come from the corpus: open-questions drew 44 corrections and decisions drew 9, and what those corrections ask for is a way of writing, not a property to test.

<!-- sf:box class="panel" -->

#### Prompt for `open-questions`, every type

Every question here is a decision only the reader can make. Before writing one, check it is a genuine fork. A question with a sensible default is not a question: decide it, record it in Decisions, and leave it out of this section.

For each question that survives that test, give the reader everything the call needs, twice over. First in plain words, assuming no knowledge of this codebase and no reading of the sections above. Then in the technical terms the choice actually turns on, because the plain version alone cannot be acted on. Say what is being asked of them and what happens either way.

Never leave a question open ended. Offer options they can pick from, each with its consequence stated, so that a one-word answer settles it. If you cannot construct the options, you do not yet understand the question well enough to ask it.

<!-- sf:box class="panel" -->

#### Prompt for `decisions`, every type

A decision row is read by someone deciding whether to overturn it. Give the choice, the reason in plain words, and what the choice costs. Where it was close, name the option not taken and why it lost.

Write the reason so it holds up without the Design section beside it. A row that reads "chose X because it is the right approach" records nothing and will be re-litigated.

| Question | Answer |
| --- | --- |
| Why not make these rules? | A rule produces a verdict on a finished document. "Explained in plain words" has no threshold that yields one, so the check would either pass on everything or fire on everything. The correction is cheap before the section is written and expensive after, which is what makes it a prompt. |
| Does the agent have to obey it? | The same way it obeys the rest of the shell. A prompt is instruction, not enforcement. Where a prompt restates something a rule also covers, the rule is what fails the run. |
| Can a prompt go on any section? | Yes. Add a `data-sf-prompt` block inside any section of any template. The two above are the ones the corpus justifies; the rest are yours. |
| Does it reach the new spec? | No. `stripTemplateBlocks(html)` removes prompts and the rules block together, so a reader of the finished spec never sees either. |
| How does the agent see it, then? | `specforge create` returns `prompts` in its JSON alongside `id` and `htmlPath`, so the guidance is in hand before authoring starts and gone from the file. |

## 7 · Decisions

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| D1 | One rule system or two? | One registry holding check-rules and ask-rules; `lintSpec` becomes a wrapper over it. | Whether a rule is answered by a function or by reading is an implementation detail of that rule. Exposing it as two products makes every author hold the distinction. |
| D2 | Where does a template's rule list live? | A `<section data-sf-rules>` in the template spec, stripped by the scaffolder. | Templates are already specs edited through SpecForge, so this needs no new surface. Stripping keeps the block out of every document made from it. |
| D3 | What is the rule format in a template? | `<li data-sf-rule="id">` holding a sentence. | Adding a rule is writing a sentence in a list, which was the requirement. Anything richer needs a format to learn. |
| D4 | Can a template override a global rule? | Yes, by id, including `data-sf-severity="off"`. | A deck is allowed lines a design spec is not. Without an off switch the global list has to be written for the loosest type, which makes it useless for the strictest. |
| D5 | What happens to an unanswered ask-rule? | It fails the gate, exactly like a rule a function found broken, until the agent judges it and says so with `--judged`. | Reporting an unjudged rule as a pass manufactures assurance, which would make this worse than nothing. Giving it a state of its own that no run can clear is the other half of the same mistake: then nobody judges it, and the gate never closes. See D13. |
| D6 | When does verification run? | At the end of `create-spec` only, with a three-round fix loop. | Your call. Review rounds already put the agent's output in front of you, so the marginal value there is low and the marginal noise is not. |
| D7 | Does a separate agent do the judging? | The skill asks for one and degrades to inline when the harness has none. | The harness owns subagents, so this is a sentence rather than a mechanism, and it keeps SpecForge agnostic. The gain is bias, not speed: an agent judging its own spec tends to confirm. |
| D8 | Is a verification result stored? | No. Nothing on disk, nothing on the index, nothing user-visible. | Your call in review: verification exists so specs stop repeating the same mistakes, not so a spec can display a badge. Its output is a work list the agent acts on before handing over, and it has no reader after that. |
| D10 | Where does the rule list come from? | The comment corpus first, reasoning second. [§5.E](#testing) is mined from 274 comments across 20 specs. | Your call in review. A rule derived from four real corrections is worth more than one reasoned from the shell, and citing the comments makes each rule arguable against its own evidence. |
| D9 | Do the existing advisory checks become blocking? | No. Severities are carried over exactly. | This spec changes where rules live, not how strict the tool is. Bundling a strictness change into a refactor would make both hard to argue with. D11's promotion is the one exception and is a merge artefact, not a strictness change. |
| D11 | What happens where a corpus rule and a reasoned rule say the same thing? | Merge into the corpus rule, which states the narrow case explicitly. `no-repeated-claims` absorbs `decisions-match-prose`; `prescriptions-name-their-source` absorbs `numbers-have-provenance` and takes its blocking severity. | Your call in review. Two rules that fire on the same defect report it twice and drift apart as one is edited. The corpus rule survives because it carries the evidence, and the merged wording keeps the narrower case so nothing stops being checked. |
| D12 | Where do corpus rules scoped to one spec type live? | In that type's template block, not the global list. `stages-are-explained-plainly` and `fixes-carry-a-guard` under design-impl and impl, `findings-name-what-they-break` under research. | Your call in review. A rule in the global file needs a PR to tune; a rule in a template is prose you edit in SpecForge, which is what [§6](#observability) exists for. The evidence moves with the rule, so a template rule is as grounded as a global one, and [§5.E](#testing) keeps a pointer so the list is still navigable from one place. |
| D13 | Is verification enforced, or reported? | Enforced. `verify` returns PASS or FAIL and exits 0 or 1; create-spec is not finished until it exits 0. A rule no function can answer is judged by the agent, which reports that with `--judged`, per run and stored nowhere. | Your call, and it corrects the first cut. That version had a third state, `pending`, that no run could clear, so a real spec could never reach PASS and the skill said to hand over anyway. A check whose result nobody has to act on is a report. An unjudged rule now counts against the spec exactly like a broken one, because otherwise nobody judges it. D2 is unaffected: `--judged` writes nothing down. Two things keep it from being a rubber stamp: an id the type does not have fails the gate rather than being ignored, and a judgement never applies to a rule a function already failed. |

## 8 · Open questions

- [x] **Q1 — resolved** Where does the rule list come from? The comment corpus, not reasoning in the abstract. [§5.E](#testing) is derived from 274 review comments across 20 specs, and each rule there cites the comments that produced it. The number of judgements per creation is not a concern: a rule that has been asked for four times is worth answering every time.
- [x] **Q2 — resolved** Nothing is stored. No `verify.json`, no field on `meta.json`, nothing on the index. Verification is not a user-visible feature: it exists so specs stop repeating the same mistakes, and its whole output is a work list the agent acts on before handing over.
- [x] **Q3 — resolved** Should verification block approval? No. The lifecycle stays yours; the tool reports and the author decides. A rule that could stop you approving your own spec would be a rule you route around within a week.
- [x] **Q4 — resolved** Merged, your call in review. `no-repeated-claims` absorbs `decisions-match-prose`, and `prescriptions-name-their-source` absorbs `numbers-have-provenance`. Both survivors stay in [§5.E](#testing), where their corpus citation is, and each names the narrow case explicitly so the merged wording loses nothing. The B and C tables carry a line saying where the check went, so a reader of those families is not left looking for it. `prescriptions-name-their-source` goes from advisory to blocking: merging a blocking rule into an advisory one would have quietly weakened the number check. See D11.
- [x] **Q5 — resolved** Moved to the templates, your call in review. Nothing prevented it. The only cost was that [§5](#testing) stops being the single complete list, and that is answered by leaving a pointer in [§5.E](#testing) rather than by keeping the rules there. `stages-are-explained-plainly` and `fixes-carry-a-guard` now sit in the design-impl and impl blocks, `findings-name-what-they-break` in research, each carrying the comment that produced it and marked corpus. A template rule is now as grounded in evidence as a global one, and all three became yours to edit without a PR, which is what [§6](#observability) exists for. See D12.
- [x] **Q6 — resolved** Verification is a gate: it returns PASS or FAIL, FAIL names the rules the spec breaks, the agent fixes them and runs it again until it passes. Your call: a check whose result nobody has to act on is a report. The first cut had a third state that no run could clear, so it could never reach PASS; that is gone. See D13.

## 9 · Design alignment

How this proposal aligns with — or deviates from — the design guidance already in the codebase: docs, for_agents / agent docs, memory docs, gotchas, RFCs, and past specs. Detect straying early, avoid repeating past mistakes, and call out any deviation or new tribal knowledge this design introduces. For each item, quote the guidance, say how we align or diverge, and link the source.

| Guidance (quoted) | Aligned / misaligned | How & why | Reference |
| --- | --- | --- | --- |
| "Zero runtime dependencies" and the plugin runs under any harness. | aligned | Node never calls a model. The split between check-rules and ask-rules is forced by this constraint, and the subagent question is answered in the skill rather than in code. | `README.md` badge, `package.json` |
| "Every sentence carries a decision, measurement, source, assumption, or specification. It cannot see aphorism, so a clean report is a floor, not a pass." | aligned | That sentence is the argument for this whole spec, and [§5.D](#testing) turns the two things the lint says it cannot see into rules that something can. | `references/spec-language.md` |
| "Minimum code that solves the problem. No abstractions for single-use code. No flexibility that wasn't requested." | tension, stated | A registry is an abstraction over eight checks that work fine inline today. It earns its place only because the per-template list requires rules to be data, and because [§5](#testing) adds 20 more. If the per-template requirement were dropped, the honest design would be to add ask-rules to `lintSpec` and stop. | `CLAUDE.md` § Simplicity First |
| "Consistency over local optimality: one way, even if imperfect." | aligned | One registry, one report, one verdict shape. The alternative considered and rejected was two systems with two reports. | memory `feedback_consistency_over_local_optimality` |
| "Templates are specs; editing the template spec edits what every future spec starts from." | aligned | The design puts the per-template rules inside that same object rather than beside it, so there is no second thing to keep in sync. | `lib/store-templates.mjs` header comment |
| "Don't refactor things that aren't broken." | deviates | `lint-spec.mjs` is not broken and is being restructured anyway, because the alternative is two rule systems. The deviation is bounded by keeping `lintSpec`'s signature and output identical, which the existing eight test files enforce. | `CLAUDE.md` § Surgical Changes |

## 10 · Invariants

Invariants that held before but are broken or changed by this design. State the old invariant and the new reality so downstream assumptions get revisited.

| Was true before | Now (after this design) | Who / what relied on it |
| --- | --- | --- |
| Checking a spec is free and offline. | The mechanical half still is. The judged half costs agent time, and a creation now ends with ten blocking judgements. | Anything that called the lint expecting it to be instant. `lintSpec` keeps that property; only `verifySpec` gains the cost. |
| A spec's HTML contains only the document. | A template spec's HTML also contains its rule list and its section prompts, which are process rather than content. | The markdown exporter, the components lint, and anything that assumes every section is prose. Template specs are the only ones affected, and only until the blocks are stripped. |
| The lint's eight checks are defined in one file, inline. | They are records in a registry, and a template can change the severity of one. | Anyone reading `lintSpec` to learn what is checked. The registry becomes that place. |
| What a spec is checked against is the same for every spec. | It depends on the spec's type, and on what you have written into that type's template. | Any future reader of a verification report, who now has to know the type to know the bar. The report names the type for that reason. |

## 11 · Implementation plan

<!-- sf:section id="impl-plan" -->

Stages & Tasks. One stage = one PR. Tests-first. Stage 0 is always test setup, so every later stage can be tested end-to-end by agents without human input. Every stage carries its testing steps and ends in an output an agent can verify. The final stage also carries a documentation-updates task ([§14](#doc-updates)) and a testing-journeys task ([§15](#test-journeys)).

<!-- sf:callout variant="constraint" -->

> Test locally. Default to the local or emulator harness; no prod or staging deploy unless a stage genuinely needs it. Move \[human\]-gated setup steps into Stage 0. For UI stages, list new / modified / reused components and reuse before building.

### Stage 0 — Corpus fixture and the sweep (PR 165)

- [x] 0.1 Add `test/helpers/spec-corpus.mjs`: build spec HTML with named defects (a placeholder left in, an empty section, a TOC link to nothing, a decision with no reason) so a rule can be tested against a document that fails it for one stated reason.
      verify: a unit test asserts each builder produces HTML the intended rule fails and the others pass
- [x] 0.2 Mine the review corpus and derive [§5.E](#testing) from it. `scripts/mine-spec-comments.mjs` exists and produced the 274 comments the family is built from.
      verify: [§5.E](#testing) cites the comments behind each rule, and the script re-runs to produce the same corpus

**Testing:** the fixture builders themselves · unit tests

**Verifiable output:** a fixture per defect, and [§5.E](#testing) grounded in the corpus rather than in reasoning

### Stage 1 — The registry, with today's checks inside it (PR 168)

- [x] 1.1 Add `lib/rules/index.mjs`: the rule record shape, `allRules(type)`, and merge-by-id with template overrides.
      verify: unit tests cover merge order, override by id, severity off, and a duplicate id being reported rather than silently winning
- [x] 1.2 Move the eight existing checks into `lib/rules/structural.mjs` as check-rules, keeping their names, severities and detail strings.
      verify: the eight existing lint test files pass untouched
- [x] 1.3 Rewrite `lintSpec` as a wrapper over the registry's check-rules, returning the identical `{ok, checks}`.
      verify: a test asserts the check names, order and advisory flags are exactly what they are on main, so a caller cannot tell the difference

**Testing:** the registry, and the promise that nothing observable changed · unit tests plus the existing lint suites

**Verifiable output:** the full suite green with no existing test edited

### Stage 2 — The global rule list (PR 170)

- [x] 2.1 Add the check-rules from [§5](#testing) that are functions: `no-placeholders`, `no-empty-sections`, `toc-in-sync`, `front-matter-filled`, `internal-links-resolve`.
      verify: each has a test that fails on the corpus fixture built for it and passes on a clean spec
- [x] 2.2 Add the ask-rules from [§5](#testing) as records with prose and no function.
      verify: `allRules('design')` returns the 32 global rules with the severities in [§5](#testing), and every ask-rule has a non-empty sentence and a fix hint
- [x] 2.3 Add [§5.E](#testing)'s five global rules with the merges from D11 already applied, so `numbers-have-provenance` and `decisions-match-prose` are never written as separate rules. The three type-scoped ones are Stage 3's work, not this one (D12).
      verify: no two rules state the same requirement, `allRules('design')` holds 32 entries, and none of them is type-scoped

**Testing:** every mechanical rule against a fixture that isolates it · unit tests

**Verifiable output:** `allRules('design')` returns the agreed list with no duplicate requirement

### Stage 3 — Template rules and prompts, parsed and stripped (PR 171)

- [x] 3.1 Add `templateRules(type)`, `templatePrompts(type)` and `stripTemplateBlocks(html)`.
      verify: a template with a rules block yields its rules and a template with prompts yields `[{section, text}]`; one with neither yields empty lists; strip is idempotent and leaves every other section byte-identical
- [x] 3.2 Strip on the way out of `cmdCreate`, `cmdImport` and `cmdImportMd`, and return `prompts` from `cmdCreate`'s JSON.
      verify: a spec created from a template carrying rules and prompts has no `data-sf-rules` and no `data-sf-prompt` anywhere, the rest of the document matches the template, and `create --json` carries the prompts that were stripped
- [x] 3.3 Add the [§6.1](#observability) rules blocks to the six bundled shells including the deck's `off` override, and the [§6.2](#observability) prompts to `open-questions` and `decisions`, including the three corpus rules moved here by D12.
      verify: `allRules('deck')` omits `no-aphorisms`, `allRules('design')` includes `no-build-plan`, `allRules('research')` includes `findings-name-what-they-break`, `allRules('impl')` includes `stages-are-explained-plainly`, and `templatePrompts` returns two entries for every type
- [x] 3.4 Make the rules block visible while editing a template, so it can be read and commented on like any other section. Prompts need no work here: they are ordinary blocks inside ordinary sections.
      verify: opening `template-design` in a browser shows the rules section and the two prompts, and a comment anchors to each

Plain-language summary: templates get to carry their own rules and their own writing guidance, and this stage teaches the code to read both out of a template and delete both on the way into a new spec, so no reader of a finished spec ever sees them.

**Testing:** parse, strip, merge and the override path for rules · parse, strip and round-trip for prompts · unit tests plus one browser check for 3.4

**Verifiable output:** editing `template-design`'s rules in the browser changes what a new design spec is judged against, and editing its open-questions prompt changes what the next design spec's open questions are told to look like

### Stage 4 — verify, the CLI and the skill (PR 173)

- [x] 4.1 Add `lib/verify-spec.mjs`: `verifySpec(html, type, {judged})` returning `{pass, failing, advisories, passed}`, where an unjudged blocking rule fails the gate.
      verify: a spec passing every mechanical check still fails until its judged rules are named, and passes once they are (D5, D13)
- [x] 4.2 Add `specforge verify <id> [--json] [--judged a,b]`, exiting 1 when the gate does not pass.
      verify: CLI tests cover human and JSON output, both exit codes, the full loop to exit 0, a judged id that cannot paper over a defect, a mistyped one, and an unknown spec
- [x] 4.3 Rewrite step 4 of `create-spec` as the verify loop, with the subagent sentence and the three-round cap.
      verify: the skill names the cap, says what to do when the rounds run out, and assumes no particular harness
- [x] 4.4 Apply [§14](#doc-updates) and [§15](#test-journeys).
      verify: the docs mention verify and the rules block; the journeys run green

**Testing:** the runner, the CLI surface and the end-to-end journeys · unit and CLI tests

**Verifiable output:** creating a spec with a placeholder deliberately left in ends with the agent having removed it, and the report names the rule that caught it

## 13 · Runtime

Filled during implementation. The runtime record `CLAUDE.md` asks for, in one place.

#### Design decisions (implementation time)

Choices made where the spec was ambiguous.

- **R1 · A fourth module, `lib/rules/run.mjs`.** The design named three new files and put running a rule inside the verifier. The lint runs check-rules too, and if each one calls the rule its own way they can disagree about what an answer means. One runner, imported by both.
- **R2 · `checkLanguage` moved to `lib/spec-language.mjs`.** The registry needs it and the lint now imports the registry, so leaving it in `lib/lint-spec.mjs` is a cycle. `lint-spec.mjs` re-exports it, so the five skills and eight test files that import it from there are untouched.
- **R3 · A rule that throws is reported as failing, not propagated.** The design did not say. A broken rule should name itself and let the other 31 finish; taking the process down means one bad regex hides every other verdict.
- **R4 · An override supplies only what it changes.** The design showed `data-sf-severity="off"` but not what a bare override inherits. It inherits everything it does not restate, because the useful case carries an id and a severity and nothing else. A template that writes prose over a check-rule drops the inherited function: running the old check while reporting the new sentence would lie about what was verified.
- **R5 · Turning off a rule that does not exist is a no-op.** A template carrying an `off` for an id that has since been renamed is stale. Being strict about it would stop every spec of that type verifying at all, which is a worse outcome than ignoring a line that asks for nothing.
- **R6 · A rule's fix hint travels in the template block.** The design's block format carried an id, a severity and a sentence. The hint is what makes a failure actionable, and a template rule that lost it reported a failure with no next step, so it rides in a `<span data-sf-fix>`. A data attribute rather than a class, because a template spec is a spec and a class outside the component library makes every template fail its own lint. The corpus citation stays inline in the sentence instead: an agent judging the rule is helped by the example that produced it, and a second parsed field would be one nothing else reads.
- **R7 · `allRules` lives in `lib/rules/all.mjs`, not `index.mjs`.** It is the one part of the rules layer that reads the store. Keeping it out of `index.mjs` lets the merge logic be tested without a store, and lets `template-blocks.mjs` import the registry without dragging the filesystem in behind it.

#### Deviations

Intentional departures from the spec, and why.

- **V1 · Stage 0's verify moved to Stage 2.** Task 0.1 asks a unit test to assert each fixture fails its own rule and passes the others. No rule existed at Stage 0. Stage 0 ships the fixture contract that matrix depends on, and the matrix runs in `test/rules-global.test.mjs` with the rules.
- **V2 · "The intended rule fails and the others pass" was not true, and the test says so.** Some rules genuinely overlap: a spec with no title fails `has-title` and also `front-matter-filled`, because a title is one of the four fields it checks. Rather than weaken the assertion, each defect declares which other rules it trips and the test asserts equality, so an undeclared co-fire fails and so does a declared one that stops happening. Six overlaps are declared.
- **V3 · Advisory rules are exempt from the shell grounding test.** Every bundled shell is run against every rule, which is what caught two real defects (see Tradeoffs). The shells trip `spec-language` on their own guidance prose, which is written for the author rather than held to the contract it is teaching, so the assertion covers blocking rules only.
- **V4 · The template blocks are rendered from data at seed time, not written into the shell files.** The design said each of the bundled shells gains a `data-sf-rules` block. `design-impl` and `impl` scaffold from the *same* shell (`templates/spec-base.html`) and their rule lists differ: impl wants `plan-is-the-bulk`, design-impl wants `runtime-stubs-present`. One file cannot carry two blocks. The alternative is duplicating a 500-line shell per type, which makes every future shell edit happen twice. The blocks and prompts live in `lib/rules/template-defaults.mjs` and are rendered into the template spec when it is seeded, so the store template still carries them as real, editable HTML and the requirement is met.
- **V5 · A prompt only lands where its section exists.** The design attaches prompts to `open-questions` and `decisions` on every type. `general` is a bare scaffold and `deck` is slides; neither has those sections, and `research` has open questions but no decisions table. A prompt for a section that does not exist is skipped rather than placed somewhere arbitrary.
- **V6 · Three store-template assertions changed.** They asserted `templateHtmlFor(type)` is byte-identical to the file on disk, which this design deliberately makes false. Their real claim is which shell was fallen back to, and they now assert that through the strip.

#### Tradeoffs

Alternatives considered and why the chosen path won.

- **Running the rules against the five bundled shells, not just fixtures.** A rule invented against a fixture and never run on a real document is a rule that fails every real document. This found two defects a fixture never would have. `internal-links-resolve` read every `href="#…"` in the file, including the deck shell's SVG `<use href="#wN">` and an href written inside an HTML comment; a `<use>` points at a symbol rather than a place in the document, so every deck ever created would have failed. And `no-placeholders` and `front-matter-filled` shared one `/g` regex, which carries `lastIndex` between calls, so every other `.test()` returned false.
- **Ordering the global list scaffolding-first.** The alternative is definition order, which would put the eight existing lint checks ahead of the four new mechanical ones. A reader fixes a placeholder left in the title before weighing whether the TL;DR overclaims, so the report is ordered the way the work gets done. Pinned by a test, because the constant that splices the two lists is the kind that drifts.
- **Running verify against this spec, and believing what it said.** Two of the mechanical rules were wrong in ways only a real document exposes. `no-placeholders` fired on `<code>{{ … }}</code>`, so a spec that documents the shell's own syntax failed its own rule; code samples are exempt now, or the rule could not be described in a spec. And `references-are-links` fired on architecture-diagram labels and on a code block's filename caption, neither of which can be a link, so the advice could not be taken. The alternative was to accept the noise and let the author learn to ignore the report, which is how a rule list dies.
- **Declaring rule overlaps rather than weakening the matrix.** The plan asked that each defect fail its own rule and pass the others. That is false for six pairs, all correctly. The choice was to relax the assertion to "at least its own rule fails", which stops catching a rule that fires everywhere, or to declare each overlap and assert equality. Equality won: an undeclared co-fire fails, a declared one that stops happening also fails, and the list doubles as documentation of where the rules touch.

## 14 · Documentation updates

<!-- sf:section id="doc-updates" -->

What this spec changes that the docs must reflect — the surfaces, not the new prose. Landed as a task in the final stage, where an agent applies the doc-update skills to the areas below.

| What changed | To reflect in the docs |
| --- | --- |
| New handlers / APIs | `specforge verify <id> [--json]` in the CLI usage header; `verifySpec`, `allRules`, `templateRules`, `templatePrompts`, `stripTemplateBlocks`. `create`'s JSON gains `prompts`. |
| New patterns | A rule is a record with either `check` or `ask`, never both. Anyone adding a check to the lint now adds a rule instead, and `lib/rules/` is where they look. Guidance that shapes a section rather than testing it is a prompt in the template, not a rule. |
| New features | `README.md`: what verification is, that rules come in two kinds, that a type's rules are edited in its template spec, and that a template section can carry a writing prompt. This is the user-facing half. |
| New invariants | A spec never contains a `data-sf-rules` block or a `data-sf-prompt` block. An unjudged blocking rule is not a pass, and create-spec does not hand over until the gate exits 0. |
| Skills | `create-spec` step 4 becomes the verify loop. `tune-templates` gains the rules block as something you can tune, which is the natural home for it. `convert-spec` and `migrate-spec` keep calling the lint and are unaffected. |
| Reference docs | `references/spec-language.md` says the lint cannot see aphorism or unlabelled sentences. That is now half true: it still cannot, but a rule can. The line needs updating rather than deleting. |
| Removed / renamed | Nothing removed. `lintSpec` keeps its name, signature and output. |

## 15 · Testing journeys

<!-- sf:section id="test-journeys" -->

End-to-end journeys this spec adds or changes. Landed as a task in the final stage, where an agent uses the journey skills to add / modify them.

| Change | Journey | What it exercises |
| --- | --- | --- |
| add | A defect is caught and fixed | Create a spec from a template, leave a placeholder in it, run verify, confirm the report names `no-placeholders` and exits 1. Fix it, re-run, confirm exit 0. The whole loop in one test. |
| add | An unjudged rule is not a pass, and a judged one cannot hide a defect | A spec that satisfies every check-rule still fails while its blocking ask-rules are unjudged, and passes once they are named. Naming a check-rule in `--judged` does not clear it. This is D5 and D13, and the two failures it prevents are certifying a document nobody judged, and a gate that can be talked past. |
| add | Editing a template changes the bar | Add a rule to `template-design`'s block, create a design spec, confirm the new rule is in its verify output and that the spec itself contains no rules block. The feature you asked for, end to end. |
| add | A template turns a global rule off | The deck template's `no-aphorisms: off` keeps that rule out of a deck's verify output while a design spec still carries it. The override path, which is the likeliest part to end up half-built. |
| modify | Existing lint journeys | Every current lint assertion keeps passing against the wrapper. Add one that pins the check names, order and advisory flags, so a future rule cannot quietly change what `lintSpec` reports. |

## Appendix

#### Code referenced

| Reference | What is there |
| --- | --- |
| `lib/lint-spec.mjs:125` | `lintSpec`, the eight checks inline |
| `lib/lint-spec.mjs:191` | the verdict: non-advisory checks must all pass |
| `lib/lint-spec.mjs:47-78` | `LANGUAGE_RULES`, the five regexes |
| `lib/store-templates.mjs` | templates are specs; `templateHtmlFor` |
| `lib/specforge-cli.mjs` `cmdCreate` | scaffolds from the template wholesale, which is why stripping is needed |
| `references/spec-language.md:76` | "reports the mechanically detectable subset" |
| `skills/create-spec/SKILL.md:158` | step 4, the lint call this replaces |
| `skills/tune-templates/SKILL.md` | the existing flow for changing a template |

#### Glossary

| Term | Means |
| --- | --- |
| **check-rule** | A rule answered by running a function over the spec HTML. Deterministic and free. |
| **ask-rule** | A rule answered by reading the spec and judging it. Stated as one sentence. |
| **the gate** | `verify`. Returns PASS or FAIL and exits 0 or 1; a spec is not finished until it passes. |
| **judged** | An ask-rule the agent has read the spec against and found satisfied, reported with `--judged`. Lasts one run, stored nowhere. Until then the rule fails the gate. |
| **override** | A template rule sharing an id with a global rule, replacing its severity or its text. |
| **section prompt** | Authoring guidance a template attaches to one section. Never checked, stripped from the spec. |

#### Where the numbers come from

Eight existing checks and their severities: read from `lib/lint-spec.mjs` on `7dfe6d0`. Five skills and eight test files importing it: counted by grep across the repo. 115 specs in the store: the home page's own count on 2026-08-15. 32 global rules, 14 mechanical and 18 judged, of which 9 block: counted from [§5](#testing) by `scripts/count-spec-rules.mjs`, which reads the tables rather than the prose so the two cannot drift. 274 review comments across 20 specs: `scripts/mine-spec-comments.mjs`.
