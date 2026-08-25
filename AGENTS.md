# Working on SpecForge

House rules for any agent changing this repository. They are the same rules on
every CLI: SpecForge runs inside Claude Code and Pi, and a rule that held on only
one of them would be a rule the other quietly breaks.

## Before you change anything

```sh
npm test          # node --test, zero runtime deps, ~25s
```

Tests come with the change that needs them. A bug fix starts with a test that
reproduces the bug.

`npm test` runs with `--test-force-exit`, which truncates the TAP report. **The
printed total is a floor, not a count.** The exit code and the absence of
`not ok` are the trustworthy signals.

## Where things live

| Path | Holds |
|---|---|
| `lib/` | store, CLI, publications, lint, lifecycle |
| `lib/harness/` | what each agent CLI is: the registry, one adapter per CLI, and the policy that names none of them |
| `server/` | the review server and the injected review layer |
| `skills/` · `commands/` | authoring and review skills, and the slash commands that call them |
| `hooks/` · `extensions/` | the two bindings: Claude Code's session hooks, Pi's extension |
| `templates/` | spec shells and house rules |
| `test/` | the suite; `test/helpers/` holds the fakes |

Specs live in `~/.specforge`, never in this repo.

## Rules that are not negotiable

**No runtime dependencies.** Node built-ins only. `jsdom`, `mermaid`,
`playwright` and `prismjs` are dev-only, for the review-layer and browser test
tiers. A runtime dependency changes what SpecForge costs to install everywhere.

**No CLI's private vocabulary outside `lib/harness/`, `hooks/` and
`extensions/`.** Its environment variables, its address for a skill, its hook
protocol. `npm run check:harness` is the gate and CI runs it on every PR. Reach
for `currentHarness()` and the five resolvers instead. See
[docs/adding-a-harness.md](docs/adding-a-harness.md).

**Nothing SpecForge does may wedge a session.** Every binding handler catches and
says nothing. Every resolver that cannot answer returns an empty string or false.
A session must be able to run with SpecForge broken.

**Comments explain why, not what.** If a line is surprising, say what it
prevents. A comment restating the code is worse than none.

**Prose follows `references/spec-language.md`**: no em dashes, no filler, claims
separable from confidence. This applies to comments, commit messages and
documentation, not only to specs.

## Verifying a change

A green suite is not evidence that a page renders or that a route answers. Two
defects got past a full suite in one week: a daemon route calling a body reader
that does not exist, and a review layer that reads a Response as if it were the
parsed body. Both were caught by opening the page.

- Changed the review layer? Open a spec and look at it.
- Changed a daemon route? Drive it over HTTP, not only its handler.
- Changed a skill? Invoke it.

## How work lands

Feature branch, PR, review, squash merge. Every PR runs the full suite on Node 20
and 22.
