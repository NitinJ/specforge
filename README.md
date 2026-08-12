# SpecForge

A **Claude Code plugin for spec authoring, browser review, and agent
collaboration.** SpecForge turns a vague request into a well-presented,
house-style spec, lets a human review it in the browser with Google-Docs-style
comments, and feeds those comments back to the Claude session that owns the spec —
which replies inline and amends the document.

**Zero runtime dependencies.** The bundled CLI and review server use only Node
built-ins — no `npm install`, no services to run.

![SpecForge review UI — a spec open in the browser with the block-comment sidebar, threads, and the inline composer](docs/review-ui.png)

## Highlights

- **Typed specs** — design · research · design+implementation · implementation-only; each scaffolds the right sections and depth.
- **Browser review** — Google-Docs-style **block** comments; submit a batch and the owning Claude session replies inline **and** amends the spec.
- **Token-efficient** — a per-spec section index (hand-rolled BM25, no embeddings) lets the agent open only the sections a comment touches instead of re-reading the whole document.
- **Live task tracker** — impl specs render their Stages → Tasks status live from the plan.
- **Contextual lifecycle CTA** — one button drives submit → LGTM → implement → done.
- **Polished review UI** — light/dark, responsive, floating TOC, auto-growing composer (`⌘↵` to send), and **Export → PDF**.
- **Zero runtime deps · fail-safe hooks** — pure Node built-ins; hooks no-op unless a spec is in play.

---

## What it does

1. **Author** — `/specforge:create` generates a light/dark, strongly-presented
   `.html` spec from a house template, picking the right **spec type** (design /
   research / design+implementation / implementation-only) and scaffolding that
   type's sections. Impl types also get a Stages → Tasks plan, a live task
   tracker, and impl-time sections (decisions / deviations / tradeoffs).
2. **Review** — a bundled, zero-dep daemon renders any spec in the browser with a
   comment layer: hover a block, click to comment, leave a batch. Submitting is
   picked up by the spec's owning Claude session **automatically** — an in-session
   background watcher (`wait-batch`) wakes it even while idle — and the agent
   replies inline **and** edits the spec. A floating **SpecForge** menu adds
   theme, width, contents, **Export → PDF**, and a contextual lifecycle button.
3. **Implement** — the spec and the work stay in lockstep: the task tracker
   renders live from the plan, and hooks nudge when the implementation drifts from
   the spec. Hooks are fail-safe and no-op unless a spec is in play.

---

## Requirements

- **[Claude Code](https://claude.com/claude-code)** — SpecForge is a plugin.
- **Node ≥ 18** on your `PATH` — runs the bundled CLI + review daemon (both
  zero-dependency).
- A modern browser for the review UI.
- **[cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)**
  on your `PATH`, but only to share a spec. Everything else works without it.
- *(dev only)* `jsdom` + `playwright` are dev-dependencies for the test tiers;
  not needed to use the plugin.

---

## Install

From GitHub:

```sh
claude plugin marketplace add NitinJ/specforge
claude plugin install specforge@specforge
```

Then `/reload-plugins` (or restart Claude Code).

From a local clone (development):

```sh
git clone https://github.com/NitinJ/specforge
claude plugin marketplace add ./specforge
claude plugin install specforge@specforge
```

**Updating** to a newer version (a reinstall is required to pick up skill/command
changes):

```sh
claude plugin marketplace update specforge
claude plugin uninstall specforge@specforge && claude plugin install specforge@specforge
```

Then `/reload-plugins`.

---

## Quickstart

```
/specforge:create research on on-device vs server inference for tryon
```

SpecForge infers the type (here, **research**), confirms it, scaffolds the spec
into the global store, starts the review daemon, and prints a URL. Open it:

- **Comment** — hover any block, click it, type, and **Submit**. The owning
  session picks the batch up automatically, replies inline, and amends the spec.
- **Act** — the floating **SF** button (bottom-right) opens the menu (Comments,
  Contents, Width, Theme, **Export PDF**, Session). The pill beside it is the
  contextual lifecycle action (see below).
- `/specforge:listall` lists every spec (with a picker to open/detach one);
  `/specforge:start` just prints the index URL.

---

## Spec types

`/specforge:create` picks a type from your wording and confirms it. Sections are
**recommended starting points** the authoring skill adapts to the problem — they
are *not* rigidly enforced.

| Type | Best for | Scaffolds |
|------|----------|-----------|
| `design` | a decision/architecture doc | problem · goals · design · alternatives · decisions · open questions |
| `research` | a findings report | question · background · method · findings · analysis · recommendations · sources |
| `design-impl` *(default)* | design **and** build it | the design sections **+** Stages/Tasks plan + live tracker + Runtime stubs |
| `impl` | build an existing design | light scope/prereqs **+** Stages/Tasks plan + live tracker + Runtime stubs |

Pass it explicitly if you like: `/specforge:create --type impl …`. The type is
stored in the spec's metadata and shown in `listall` + the browser index.

---

## Commands

| Command | What it does |
|---------|--------------|
| `/specforge:create` | Author a new spec (infers + confirms the type), open it for review. |
| `/specforge:convert <file>` | Bring an existing `.md`/`.html` design doc into the store (ingest as-is, or re-author into house style). |
| `/specforge:list` | List the specs attached to **this** session; open a free one or detach. |
| `/specforge:listall` | List **every** spec (id · title · type · status · attached) + the index URL; pick one to open/detach. |
| `/specforge:start` | Start (or reuse) the review daemon and print the index URL. |

Reviewing is automatic — the session a spec is attached to picks up submitted
comment batches via hooks; there's no separate serve/review/implement command.

---

## Sharing a spec

A spec normally lives on loopback and only you can see it. `share` puts one spec
on a public URL you can send to anyone:

```
specforge share <id>            # → https://<random>.trycloudflare.com/s/<token>
specforge share <id> --rotate   # new token; every link already sent stops working
specforge shares                # what is public right now
specforge unshare <id>          # the link dies, for everyone holding it
```

One **gateway** serves every published spec on a fixed loopback port (14180), and
one [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)
quick tunnel points at it. Publishing a second spec starts nothing: it adds a
token. No Cloudflare account, no DNS, no hosting.

The tunnel's only downstream is the gateway port, so it has no route to the
daemon, to your spec index, or to any daemon endpoint. On the gateway itself,
a spec is reachable only through its **token**: 16 random bytes, never derived
from a spec id, so a spec id is not a public address and holding one link tells
you nothing about any other spec. Everything not published answers 404, and so
does everything revoked, byte for byte.

**The link is the capability.** Anyone holding it has your rights on that spec:
read, comment, resolve, and submit work to your agent. There are no accounts and
no passwords, and a name is whatever its holder typed. Share it the way you would
share a document link, and `unshare` when the review is done.

A published spec carries a **Shared** badge in its header, because a share has no
expiry and visibility is the only thing between it and a forgotten public URL.

**A link survives a daemon restart.** The tunnel runs detached from the daemon,
and a starting daemon adopts the one its predecessor left if the process is still
alive and the origin still answers, rebinding the gateway to the port that tunnel
points at. Otherwise it reaps that process and starts a fresh tunnel, which does
mean a new origin. The tunnel runs while at least one spec is published and stops
with the last `unshare`, so nothing published and nothing exposed are the same
state. A reboot still changes the hostname: quick tunnels draw a new one on every
run.

A spec's link never changes on its own. The token is written once and kept, so
only one command ever changes it:

| Action | The link |
|---|---|
| `share` again | unchanged |
| `unshare` then `share` | unchanged; unpublishing stops serving it, it does not kill it |
| `share --rotate` | **replaced**; every copy already sent stops working |

Rotating is therefore the only way to revoke a link that has leaked.

### A permanent address of your own

By default the hostname is drawn fresh on every cloudflared run, so a reboot
changes it. One command sets up a named tunnel on a domain you control and points
SpecForge at it:

```
specforge setup-tunnel spec.example.com
```

It authorises with Cloudflare (a browser opens once), creates the tunnel, writes
the DNS record, writes the cloudflared config, and sets the origin. Re-running it
changes nothing: an existing tunnel is reused, and a config you wrote by hand is
left alone rather than rewritten. It never runs `sudo` unless you pass
`--install-service`; otherwise it prints the one command you still need:

```
sudo cloudflared --config ~/.cloudflared/config.yml service install
```

That is what makes the tunnel survive a reboot. After it, restart the daemon.

**For a team**, add each person to the same Cloudflare account and give them a
subdomain of one shared domain. Each machine runs `setup-tunnel` with its own
hostname; nobody shares credentials, and nobody needs their own domain:

```
specforge setup-tunnel spec.example.com     # yours
specforge setup-tunnel lavee.example.com    # theirs
```

One tunnel per machine is not optional: a hostname routes to whichever machine
runs its tunnel, so two machines on one tunnel means requests land on either at
random.

The origin can also be set directly, for a Tailscale Funnel or anything else
already serving:

```
specforge origin https://spec.example.com   # then restart the daemon
specforge origin                            # what is set now
specforge origin --clear                    # hand the tunnel back to SpecForge
```

With an origin set, SpecForge never starts, adopts or kills a tunnel; running
one is yours to do. It also binds **exactly** 14180 and fails loudly rather than
walking to another port, because your tunnel's config names one port and serving
anywhere else would leave it pointed at nothing while every link here still
reported healthy.

### Discussion, and work for the agent

Comments now carry the name of whoever wrote them, asked for once per browser on
a published copy. A comment is **discussion between people** unless it says
`@agent`:

- `why is this bounded at 40 bits?` — a question for a human. Never reaches an agent.
- `@agent widen this to 64` — work. Enters the next batch you submit.

Adding `@agent` to a thread later hands over the **whole thread**, so the agent
reads the discussion that produced the request rather than an instruction stripped
of it. The footer counts both (`2 for agent · 3 discussions`) so a forgotten
`@agent` is visible before you submit rather than after.

---

## The lifecycle action button

The pill next to the SF button is one contextual call-to-action driven by the
spec's comments + status:

```
Submit comments → Awaiting response → Picked up comments → Working on comments → Review replies → LGTM ✓ → Implement → → Implementing… → Done ✓
   open comment     submitted, agent     the owning session    the review-spec       agent replied;   all          approved      (work in the
   (sends a batch)  hasn't engaged       surfaced the batch    skill is amending     read & resolve   resolved                   attached session)
```

The middle three track a submitted batch as the owning session works it: a hook
marks it **picked up** when it surfaces the batch, and the review-spec skill marks
it **working** when it starts amending — both reported via `meta.reviewProgress`.

Status lives in `data-sf-spec-status` on the document root and the header badge:
`draft → in_review → approved → implementing → done → closed`.

---

## Review UI

The review layer is injected into every served spec (no build step) and themed
from the spec's own CSS variables:

- **Block comments** — hover any block, click to comment; threads anchor to the
  block by index + text and survive edits (falling back to the enclosing section).
- **Comments sidebar** — `Open / Resolved / All` segmented filter, **Resolve all**,
  and a footer carrying the lifecycle action + a "to submit" count.
- **Composer** — a clean, auto-growing input (no drag-grip, system font),
  `⌘↵` / `Ctrl+↵` to send, with the commented block quoted for context.
- **SpecForge launcher menu** — Comments, Contents (auto-built TOC when the spec
  has none), Width, Theme (light/dark), Session (shown as `folder · "first prompt"`
  instead of a raw id, + Detach), and **Export PDF** (print → Save as PDF; the
  review chrome is stripped from the page).
- **Reading settings are yours** — theme, font, width, fit, TOC and filter live in
  your own browser, so a reviewer switching to dark changes nothing for anyone
  else. The values stored with the spec seed a browser that has none.
- **Live reload** — editing the spec, or an agent reply, refreshes the open page.
  Loopback holds an event stream; a published page polls every 5s, because
  Cloudflare's edge accepts an SSE response and then buffers every body byte
  (measured: 0 events in 30s through a tunnel against 15 of 15 on loopback, see
  `tools/probe-sse-through-tunnel.mjs`). The listener that answers a request says
  which, so no page waits on a stream that never speaks.

---

## Architecture

- **Global store** — every spec lives at `~/.specforge/specs/<id>/`
  (`spec.html` + `meta.json` + `comments.json` + review inbox + nav index). Specs
  are not kept in your project repo.
- **Singleton daemon** (`server/daemon.mjs`) — one zero-dep Node HTTP server per
  machine, bound to `127.0.0.1`, advertised at `~/.specforge/server.json`
  (lockfile + pid/health check, port fall-forward). Serves the index (a
  searchable, light/dark list of every spec with type/status badges and the
  friendly session label, where you can **rename** specs, add **tags**, and
  organize them into single-depth **collections** grouped under headers), each
  spec with the review layer injected, an SSE live-reload stream, and a
  **human-only** comments API (per-spec prefs + store-wide index theme persisted
  under `~/.specforge`). Every command auto-starts or reuses it.
- **Session attachment** — a spec is attached to one Claude session (via
  `$CLAUDE_CODE_SESSION_ID`); that session receives its review batches. 1 session
  ↔ many specs; a spec is held by at most one live session (stale locks are
  reclaimed on a heartbeat timeout).
- **Publications** (`lib/publications.mjs`, `lib/gateway.mjs`, `lib/tokens.mjs`) —
  one gateway on a fixed loopback port serves every published spec at
  `/s/<token>`, and one detached tunnel points at it. `share.json` per spec holds
  the token; `~/.specforge/tunnel.json` holds the origin, pid and port. The daemon
  owns the registry, so a share outlives the terminal that made it, and a starting
  daemon **adopts** a tunnel its predecessor left rather than reaping it, which is
  what makes a link survive a restart. Isolation is two properties, both tested:
  the tunnel's only downstream is the gateway port, so no daemon route is on that
  socket at all; and a spec is reachable only through a token that was handed out,
  never through a spec id.
- **Review layer** — `server/public/review.{js,css}`, injected at serve time:
  block comments, the SF menu, the lifecycle button, theme/width, Export PDF.
- **Token-efficient navigation** — `spec-nav` (`lib/spec-nav-cli.mjs`) builds a
  per-spec section index (cached `idx.json`, regenerated on change) ranked with a
  hand-rolled Okapi BM25 (`lib/bm25.mjs`, no embeddings). The author/review skills
  fetch a compact `map` (sections · line ranges · token sizes) and open only the
  sections a comment touches (`grep` / `section` / `xrefs`) instead of re-reading
  the whole spec — a large token saving on real specs.
- **Hooks** — fail-safe (any error exits 0) and no-op unless a spec is relevant,
  so installing the plugin never disrupts an unrelated session.

| Hook | Role |
|------|------|
| `Stop` | Surface a pending comment batch for the owning session; nudge on implementation drift. |
| `UserPromptSubmit` / `SessionStart` | Fallback: surface pending batches a live session didn't catch. |
| `PostToolUse` | Record commits / PR ops / test runs / edits to the spec's evidence ledger. |
| `PreToolUse` | Deny edits to a spec marked `closed`. |

### Hands-free drain (opt-in)

A batch for a spec with a live owner is delivered in-context. **Orphaned** specs
(no live owner / stale lock) can be drained headlessly: start the daemon with
`SPECFORGE_DAEMON_DRAIN=1` and it spawns a headless `claude -p` for them.
`SPECFORGE_CLAUDE_BIN` overrides the binary; `SPECFORGE_WATCH_CLAUDE_ARGS` passes
extra flags (e.g. a permission mode).

---

## Configuration

Defaults live in `lib/config.mjs`; override per project at
`<project>/.specforge/config.json`:

| Key | Default | Meaning |
|-----|---------|---------|
| `specsDir` | `<project>/specs` | Legacy/local spec dir (`~` expands). |
| `defaultTheme` | `dark` | Initial theme. |
| `port` | `4178` | Preferred daemon port (collision fall-forward). |
| `requiredSections` | (the design-impl set) | **Advisory** — recommended sections for the skill; the lint no longer enforces sections. |
| `additionalRequiredSections` | `[]` | Appends extra advisory sections to the recommended list. |
| `naming` | `{date}-{slug}-spec.html` | Filename pattern for generated specs. |
| `trackComments` | `false` | Whether to git-track comment stores. |
| `cadence` | `{onePRPerStage, tddRequired}` | Implementation cadence. |

The spec lint (`lib/lint-spec.mjs`) checks only universal basics — a title, a
lifecycle status, unique section ids, and the light/dark theme contract — so any
spec type passes regardless of which sections it carries.

---

## Tech

- **Node built-ins only** at runtime — HTTP daemon, file-backed store, hooks, and
  CLIs. No framework, no `npm install`.
- **Dependency-free review layer** — vanilla `review.js` / `review.css` injected at
  serve time; no bundler.
- **Hand-rolled BM25** for spec navigation — no embeddings or vector DB (the corpus
  is one spec's sections).
- **Self-contained specs** — each spec is a single `.html` with inline light/dark
  theme CSS: portable, diffable, printable.
- **Two CLIs** — `specforge` (store / daemon / review backend) and `spec-nav`
  (token-efficient section index).
- **Tests** — `node --test` unit + integration (jsdom for the review-layer DOM),
  with an optional Playwright tier for browser checks. Both are dev-only deps.

---

## Development

```sh
npm test          # the full suite (node --test; zero runtime deps)
```

- `lib/` — store, daemon client, CLI (`specforge`), lint, spec model, lifecycle.
- `server/` — the daemon + injected review layer (`public/review.{js,css}`).
- `skills/` — the authoring/review skills (invoked by the commands; hidden from
  the slash menu via `user-invocable: false`).
- `commands/` — the thin slash commands.
- `hooks/` — the fail-safe session hooks.
- `templates/` — the spec shells (`spec-base.html` impl, `spec-base-doc.html` doc)
  + house rules.

`jsdom` + `playwright` are dev-only (the review-layer test tiers). Contributions
go through a feature branch → PR → review → squash-merge.

## License

MIT © Nitin Jaglan
