<div align="center">

# SpecForge

**Write specs with Claude. Review them in your browser. Comment, and the agent that owns the spec replies inline and edits the document.**

[![tests](https://github.com/NitinJ/specforge/actions/workflows/test.yml/badge.svg)](https://github.com/NitinJ/specforge/actions/workflows/test.yml)
![node](https://img.shields.io/badge/node-%E2%89%A518-informational)
![runtime deps](https://img.shields.io/badge/runtime%20deps-0-success)
![license](https://img.shields.io/badge/license-MIT-blue)

</div>

![The review UI: a spec open in the browser with the block-comment sidebar, threads, and the inline composer](docs/review-ui.png)

## Who it is for

- **You work with Claude Code and write design docs.** Specs end up in chat scrollback or a markdown file nobody opens twice. This gives them a home and a review loop.
- **You want a colleague to review, without giving them your repo.** Send a link. They comment in a browser, with no account and no install.
- **You want review comments to become edits.** Not a summary of what should change: the actual document, changed.

Not for you if you want a hosted wiki or real-time co-editing. Specs are authored and reviewed here rather than as markdown in your repo, but they export to markdown and import from it, so neither direction is a dead end.

## Getting started

```sh
git clone https://github.com/NitinJ/specforge && cd specforge
./install.sh
```

That checks prerequisites, installs the plugin, and sets up a permanent web
address for your specs. It asks you nothing: a browser opens once so you can
pick a domain, and your address becomes `<your-username>.<that domain>`.

```sh
./install.sh --plugin-only   # skip the sharing setup
./install.sh -n              # show what it would do, change nothing
```

You need [Claude Code](https://claude.com/claude-code), Node 18+, and, only for
sharing, [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
The installer reports anything missing and installs none of it, because a script
that takes root on a new machine is a poor first impression.

Then restart Claude Code, or run `/reload-plugins`.

## What you can do

### Write a spec

```
/specforge:create research on on-device vs server inference
```

SpecForge picks the right kind of document from your wording, confirms it,
scaffolds it, and prints a URL. Specs are single self-contained HTML files with
light and dark themes, a floating table of contents, and stable anchors.

| Kind | For | You get |
|---|---|---|
| `design` | a decision or architecture doc | problem, goals, design, alternatives, decisions, open questions |
| `research` | a findings report | question, method, findings, analysis, recommendations, sources |
| `design-impl` | design **and** build it | the design sections, plus a Stages/Tasks plan and a live tracker |
| `impl` | build an existing design | light scope, plus a Stages/Tasks plan and a live tracker |
| `general` *(fallback)* | anything the others do not cover | the scaffold and a TL;DR: theme, TOC, anchors, review layer. Sections are yours |

Already have a doc? `/specforge:convert <file>` brings a `.md` or `.html` into
the store, either as-is or re-authored into house style.

### Review it in the browser

Hover any block, click, and type. Threads stick to the block they were left on
and survive edits to the document.

The floating **SF** button opens contents, theme, width and **Export → PDF**.
The pill beside it is the single action worth taking next, which changes as the
spec moves: `Submit comments` → `Awaiting response` → `Review replies` →
`LGTM ✓` → `Approved ✓`.

A spec is a draft until you approve it, and that is the whole lifecycle. Leave a
comment on an approved spec and it goes back to draft until the thread is
resolved, because approval means nothing is left to argue about.

### Send comments to the agent

A comment is a conversation between people unless it says `@agent`:

- `why is this bounded at 40 bits?` never reaches an agent
- `@agent widen this to 64` joins the next batch you submit

Submit, and the Claude session that owns the spec wakes up even while idle. It
replies to every thread and amends the document. Your open page reloads itself,
once, when the round is finished rather than on every save.

The header says whether anyone is actually listening. **Connected** means a
session is watching this spec right now, so comments you submit reach it on their
own; **Disconnected** means they would sit unread. Reconnect copies a short
prompt — paste it into whichever Claude window you want to own the spec, and it
takes over from the session that went away.

Adding `@agent` to a thread later hands over the **whole thread**, so the agent
reads the discussion that led to the request. The footer counts both
(`2 for agent · 3 discussions`), so a forgotten `@agent` is visible before you
submit rather than after.

### Share a spec with anyone

```sh
specforge share <id>            # → https://you.example.com/s/<token>
specforge share <id> --rotate   # new token; every link already sent goes dead
specforge unshare <id>          # stop serving it
specforge shares                # what is public right now
```

They need no account and no install. Anyone holding the link can read, comment,
resolve, and submit work to your agent, so share it the way you would share a
document link.

**A link is stable.** The token is written once and never changes on its own:

| Action | The token |
|---|---|
| `share` again | unchanged |
| `unshare` then `share` | unchanged; unpublishing stops serving a link, it does not kill it |
| `share --rotate` | **replaced**, so rotating is how you revoke |

The web address is stable too, if you used `./install.sh` to set one up. Without
that, sharing falls back to a throwaway address that changes whenever the tunnel
restarts.

Nothing is public until you share it, and everything else answers 404, including
revoked links.

### Work as a team

Add each person to the same Cloudflare account. Everyone runs `./install.sh`,
authenticates as themselves, and gets `<their-username>.<the shared domain>`. No
credentials are passed around and nobody needs their own domain.

Each person's specs live on their own machine and are reviewed by their own
agent, so a spec is readable while its author's machine is on.

### Organise a store you can find things in

Specs are grouped two levels deep. A **project** is the body of work a spec
belongs to; a **collection** is what kind of artefact it is within that work. So
a research spec about the Shopify app is project `shopify`, collection
`Research`, and it is reachable from either reading.

Collections are scoped to their project: `UI` in one project and `UI` in another
are two different collections, with their own members. Renaming one leaves the
other alone.

On the home page the left rail lists your projects. **All projects** is where you
land and where you search the whole store; picking a project narrows the page,
the collections rail and search to it. Specs whose project is not set gather
under **No project**, exactly as ones with no collection gather under
**Uncollected** — there is nothing to set up, and nothing to migrate.

Make a project with **+ New project**, and move specs into one from a row's
actions menu, or by ticking several and using the bulk bar. Deleting a project
never deletes a spec: its specs move to **No project**, keeping the collections
they were in. Templates sit outside projects and stay reachable from every view.

A spec's page names its project in the header; clicking it opens the home page on
that project. `specforge create` files a new spec into whichever project the home
page is showing, so a spec an agent writes while you are working inside one lands
there. Pass `--project <name>` to say otherwise, or `--project ""` for none.

### Rules a spec is checked against

Every spec is verified when it is written, one rule at a time, so a failure names
what failed rather than that something did.

Rules come in two kinds. A **check** is a function over the spec: a placeholder
left in, a TOC entry pointing at nothing, an anchor with no target. It runs in
Node, costs nothing and is offline. An **ask** is a sentence of English that a
function cannot answer — whether a decision gives a reason rather than restating
the choice, whether the TL;DR is still true of the body — and the agent judges it
by reading. Nothing here calls a model: SpecForge has no runtime dependencies and
runs under any harness, so the judged half is a work list the agent answers, not
an API call.

```sh
specforge verify <id>          # the report, for reading
specforge verify <id> --json   # the same thing, for an agent
```

An unjudged rule reports as **pending**, never as a pass. That third state is the
point: a spec whose blocking rules nobody has judged is not verified, and saying
otherwise would manufacture assurance. Nothing is stored, so re-running reports
the same pending list — it is a work list to read the spec against, not a
checklist that empties. The exit code says which kind of attention is needed:
`1` a rule failed, `2` the judgements are yours, `0` neither.

A **type's own rules** live in its template, as a list of sentences you edit in
SpecForge like anything else. Adding a rule is writing a sentence; a type can
also soften an inherited rule or turn it off by id, which is how a deck keeps the
line a design spec may not. A template can also carry a **prompt**: guidance
attached to one section, handed to the agent before that section is written and
stripped out of the spec, for the things that shape how a section is written
rather than testing what it became.

### Keep the spec and the work in step

Implementation specs render their Stages and Tasks as a live tracker, and hooks
nudge when the code drifts from the plan. Hooks are fail-safe: any error exits
0, and they do nothing unless a spec is in play.

## Everyday commands

| Command | Does |
|---|---|
| `/specforge:create` | Author a new spec and open it for review |
| `/specforge:convert <file>` | Bring an existing doc into the store |
| `/specforge:export-md` | Write a spec out as markdown, diagrams included |
| `/specforge:list` | Specs attached to this session |
| `/specforge:listall` | Every spec, with the index URL |
| `/specforge:start` | Start or reuse the review server, print the index URL |

Reviewing needs no command. Submitted comments reach the session that owns the
spec on their own.

### Markdown, both ways

A spec goes **out** as GitHub-flavoured markdown, from the action menu in the
review UI or with `/specforge:export-md`. It renders correctly on GitHub with no
plugins: headings, tables, fenced code, and the implementation plan as task
lists you can tick. Hand-drawn SVG diagrams travel beside it as files, because
every markdown renderer strips inline SVG, so a spec carrying them downloads as
a zip. A **mermaid** diagram needs none of that: it goes out as a plain
` ```mermaid ` fence, comes back as the same text, and renders natively on
GitHub.

Any `.md` comes **in** with `/specforge:convert <file>`. The conversion is
mechanical first, so the same file always produces the same spec, and the agent
then improves the result rather than authoring one from a blank scaffold. It
always creates a **new** spec: a file you edited last week can never overwrite a
review round that happened since.

Specs live in `~/.specforge`, not in your project repo, so they follow you across
projects and never show up in a diff.

## Contributing

```sh
npm test    # node --test, ~700 tests, zero runtime deps
```

Node built-ins only at runtime. `jsdom` and `playwright` are dev-only, for the
review-layer and browser test tiers.

| Path | Holds |
|---|---|
| `lib/` | store, CLI, publications, lint, lifecycle |
| `server/` | the review server and the injected review layer |
| `skills/` · `commands/` · `hooks/` | authoring and review skills, slash commands, session hooks |
| `templates/` | spec shells and house rules |
| `tools/` | end-to-end probes and screenshot helpers |

**How work lands:** feature branch → PR → review → squash merge. Every PR runs
the full suite on Node 20 and 22. Tests come with the change that needs them,
and a bug fix starts with a test that reproduces it.

Two house rules worth knowing before your first PR:

- **Comments explain why, not what.** If a line is surprising, say what it
  prevents.
- **Prose follows the language rules** in `references/spec-language.md`: no em
  dashes, no filler, claims separable from confidence.

Issues and PRs welcome at
[github.com/NitinJ/specforge](https://github.com/NitinJ/specforge).

## License

MIT © Nitin Jaglan
