# Spec language contract

Applies to every spec SpecForge writes or amends: research, product, design,
implementation. Read this before writing prose into a spec.

**Overall rule: write in ASD-STE100 Simplified Technical English.** One idea per
sentence, one meaning per word, the active voice, and the approved sense of a
word rather than a figurative one.

## Register

Write as one staff-level practitioner writing for another who has already agreed
to the direction. Not as an essayist arguing a thesis. Assume buy-in; spend words
on resolution, not persuasion. Explain with Feynman's simplicity and clarity:
the reader should finish a paragraph able to restate it. Interest comes from
technical content and named tradeoffs, never from prose style.

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
   importing is selecting" gives no action to take.
3. Unfalsifiable superlatives ("the cheapest", "the most leveraged", "the
   hardest"). Attach criterion and number, or cut.
4. Trailing reasons (", which is why...", ", because..."). State the
   specification as its own sentence. State the reason separately, or cite by id.
5. Attention-curating language: "the finding that matters", "worth noting",
   "known risk". Show importance through a severity field, not an adjective.
6. Vague precision: "typically 1 to 3", "10 to 20", "most", "a bounded number
   of days". Either a parameter with default, range and unit, or a marked unknown.
7. Restating a rule the document already stated.
8. "What it is not" as a repeated pattern. Allowed only for a term reviewers have
   confused with another, one clause, never uniformly across a glossary.
9. Hedged decisions ("probably the same feature"). Either DECIDED or an open
   question with an id. Nothing in between.

SpecForge adds four, for the same reason as the nine above:

10. Competitive commentary outside a research doc. Elsewhere a competitor is
    evidence for a threshold, nothing else.
11. Metaphor and anthropomorphism about the system. Name the mechanism.
12. Meta-narration about the document or the authoring process.
13. Em dashes. See Formatting.

## Unknowns

Written, never omitted or smoothed into vague prose. An omitted threshold reads
as "no threshold". An enum described in prose reads as "the list is open", so
list it in full.

## Tone

No warm-up sentences, no ceremony, no restating prior lines, no hedging on a
decision already made. Short direct sentences. "Not boring" does not mean
personality in the prose: it means the reader is never made to wait for the
content.

## Formatting

- No em dashes. Use colons, semicolons, parentheses, or split the sentence.
- One claim per table row.
- Prose only where a table would lose an ordering or a dependency.
- Tables past two dimensions.
- Cite sibling docs by id and a link. Never summarise another document.

## Self-check

Report failures, do not silently fix. Count:

- sentences carrying no label from the filter
- lines that work as a standalone tweet
- superlatives with no attached number
- enums described in prose instead of listed in full
- thresholds missing rather than marked unknown

`lint-spec.mjs` reports the mechanically detectable subset (em dashes,
attention-curating phrases, vague precision, unfalsifiable superlatives) as an
advisory `spec-language` check. It cannot see aphorism, register, STE compliance
or an unlabelled sentence: those are yours to catch.
