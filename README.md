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

Not for you if you want a hosted wiki, real-time co-editing, or specs that live in your repo as markdown.

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
| `design-impl` *(default)* | design **and** build it | the design sections, plus a Stages/Tasks plan and a live tracker |
| `impl` | build an existing design | light scope, plus a Stages/Tasks plan and a live tracker |

Already have a doc? `/specforge:convert <file>` brings a `.md` or `.html` into
the store, either as-is or re-authored into house style.

### Review it in the browser

Hover any block, click, and type. Threads stick to the block they were left on
and survive edits to the document.

The floating **SF** button opens contents, theme, width and **Export → PDF**.
The pill beside it is the single action worth taking next, which changes as the
spec moves: *Submit comments → Awaiting response → Review replies → LGTM ✓ →
Implement → → Done ✓*.

### Send comments to the agent

A comment is a conversation between people unless it says `@agent`:

- `why is this bounded at 40 bits?` never reaches an agent
- `@agent widen this to 64` joins the next batch you submit

Submit, and the Claude session that owns the spec wakes up even while idle. It
replies to every thread and amends the document. Your open page reloads itself.

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

### Keep the spec and the work in step

Implementation specs render their Stages and Tasks as a live tracker, and hooks
nudge when the code drifts from the plan. Hooks are fail-safe: any error exits
0, and they do nothing unless a spec is in play.

## Everyday commands

| Command | Does |
|---|---|
| `/specforge:create` | Author a new spec and open it for review |
| `/specforge:convert <file>` | Bring an existing doc into the store |
| `/specforge:list` | Specs attached to this session |
| `/specforge:listall` | Every spec, with the index URL |
| `/specforge:start` | Start or reuse the review server, print the index URL |

Reviewing needs no command. Submitted comments reach the session that owns the
spec on their own.

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
