# Spec language contract

Applies to every spec SpecForge writes or amends: research, product, design,
implementation. Read this before writing prose into a spec.

## Register

Write as a staff-level practitioner specifying for another who has already agreed
to the direction. Not as an essayist arguing a thesis. Assume buy-in; spend words
on resolution, not persuasion. Interest comes from technical content and named
tradeoffs, never from prose style.

## The filter

Every sentence must carry one of:

| Label | Must include |
|---|---|
| DECISION | its criterion |
| MEASUREMENT | value, unit, method, date |
| SOURCE | retrieval date and confidence |
| ASSUMPTION | what would falsify it |
| SPECIFICATION | type, threshold, constraint, behaviour |

A sentence that carries none gets cut. An aphorism cannot pick a label.

## Banned

1. Aphorism. If a line works as a standalone tweet, cut it.
   - BAD: "A limit discovered through an upload failure is a support ticket."
   - GOOD: "Limits (25 MB, 8000 px, 3 files) render as chips on the dropzone."
2. Rhythm devices: chiasmus, triads, antithesis. "creating is authoring,
   importing is selecting" says nothing actionable.
3. Unfalsifiable superlatives ("the cheapest", "the most leveraged", "the
   hardest"). Attach criterion and number, or cut.
4. Competitive commentary outside a research doc. Elsewhere a competitor is
   evidence for a threshold, nothing else.
5. Metaphor and anthropomorphism about the system. Name the mechanism.
6. Trailing justification (", which is why...", ", because..."). State the spec;
   reason separately or cite by id.
7. Attention-curating language: "the finding that matters", "worth noting",
   "known risk". Rank by severity field, not adjective.
8. Precision theatre: "typically 1 to 3", "10 to 20", "most", "a bounded number
   of days". Either a parameter with default, range and unit, or a marked unknown.
9. Restating a rule already stated.
10. "What it is not" as a pattern. Allowed only for terms confused in review,
    one clause, never uniformly across a glossary.
11. Hedged decisions ("probably the same feature"). Either DECIDED or an open
    question with an id. No middle voice.
12. Meta-narration about the document or the authoring process.

## Unknowns

Written, never omitted or smoothed into vague prose. An omitted threshold reads
as "no threshold". A described enum reads as "the list is open".

## Tone

Not boring means: no throat-clearing, no ceremony, no restatement, no hedging
where a call was made, short declaratives, tables past two dimensions. It does
not mean personality in the prose.

## Formatting

- No em dashes. Use colons, semicolons, parentheses, or split the sentence.
- One claim per table row.
- Prose only where a table would lose an ordering or a dependency.
- Cite sibling docs by id, never by summarising them.

## Self-check

Report failures, do not silently fix. Count: sentences carrying no label; lines
that work as tweets; superlatives without numbers; enums described not
enumerated; thresholds missing rather than marked unknown.

`lint-spec.mjs` reports the mechanically detectable subset (em dashes,
attention-curating phrases, precision theatre) as an advisory `spec-language`
check. It cannot see aphorism, register, or an unlabelled sentence: those are
yours to catch.
