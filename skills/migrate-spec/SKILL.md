---
name: migrate-spec
user-invocable: true
description: |
  Move one existing spec onto the SpecForge component library. Use when the user
  asks to "migrate <spec> to the component library", "put this spec on the new
  components", or "adopt the design system in <spec>". Runs the deterministic
  renames in code, reads the callouts that carry no type and assigns one to each,
  and leaves a migration report in the spec's store directory.
allowed-tools: Read Write Bash Grep
---

# migrate-spec

Migration is never automatic (design D5). It runs on one spec, because a person
asked for that spec.

SpecForge is on PATH as `specforge` and `spec-nav`; `specforge root` prints where it is installed. Specs live at `~/.specforge/specs/<id>/spec.html`; you address them by **id**.

**Never paste what the user typed into a command.** A store id is 10 hex
characters. If what you were given is anything else, look the spec up first and
use the id that reports:

```
specforge listall
```

The CLI refuses an id outside `[A-Za-z0-9_-]`, but that check runs after the
shell has already parsed the line, so it is the second guard and not the first.

Two passes. The codemod is code, because a class rename is mechanical. Choosing
between `warning`, `assumption` and `risk` for a block requires reading it, and
that is your pass.

## 1. See what the codemod would do

```
specforge components migrate <id> --dry
```

Writes nothing. `codemod` lists the deterministic renames with counts;
`assignments` shows what the classifier would fall back to if you did nothing;
`conflicts` names any class the spec's own stylesheet redefines under a library
name, which is the one case where migrating changes how the spec looks.

**Stop and tell the user if `conflicts` is non-empty.** The spec's own rule wins
over the library's, so the block will render in the old style under a new name.
That is theirs to decide, not yours.

## 2. Read the blocks that need a type

```
specforge components migrate <id> --plan
```

Returns `{ id, blocks: [{ index, key, source, text }] }` — every callout the
codemod could not type. `source` is the legacy variant: `warn`, `good`, `bad`, or
`""` for a bare callout. `key` is a hash of the block's source and text, and is
how you name a block in step 3: it follows the block if the spec is edited
between the plan and the apply, and an assignment whose key matches nothing stops
the run rather than landing on the wrong block. If that happens, the spec moved
under you: re-run `--plan` and read the blocks again.

Assign a type to each from its text. Stay within the source's group: the tone is
part of what the original said, and moving a block from `good` to `risk` reverses
a claim its author made.

| Source | What the text says | Assign |
|---|---|---|
| `warn` | names a trigger and a consequence | `risk` |
| `warn` | states a belief that is not verified, or what would falsify it | `assumption` |
| `warn` | states a limit, with a unit or a source | `constraint` |
| `warn` | none of the above | `warning` |
| `""` | names a choice and an alternative | `decision` |
| `""` | gives a concrete instance of a rule stated nearby | `example` |
| `""` | none of the above | `note` |
| `good` | recommends an action the reader may take or skip | `tip` |
| `good` | none of the above | `success` |
| `bad` | departs from a stated rule or principle | `deviation` |
| `bad` | none of the above | `danger` |

The defaults are the weakest claim in each group on purpose. When the text does
not decide it, take the default rather than guessing: an understatement is
recoverable and the report names it for a later pass.

## 3. Apply

Write your decisions as `{ "assignments": { "<key>": "<type>", ... } }`, keyed by
the `key` from the plan, and apply them:

```
specforge components migrate <id> --assign /tmp/<id>-assign.json
```

Anything you leave out takes the classifier's default, so the spec is never left
half on each vocabulary. The run stamps the component block, sets
`data-sf-components`, and writes `migration.json` into the spec's directory
recording every rename and every assignment with `by: "agent"` or
`by: "classifier"`.

## 4. Check it

```
specforge lint ~/.specforge/specs/<id>/spec.html
```

Expect no untyped notices and no tone class used as a type. **Classes outside the
library are expected and are not yours to remove**: a class only this spec uses
is not drift, and deleting it changes how the spec renders. The same goes for the
CSS behind it, which the migration leaves in place.

Open the spec in the browser and look at it. The renames change which stylesheet
paints each block, so a visual check is the only thing that catches a spec whose
own rules were doing more than they appeared to.

## 5. Report

Say what was renamed, how many blocks you typed and on what evidence, and name
anything you took a default on. If `conflicts` was non-empty, say which classes
and what the user should look at.
