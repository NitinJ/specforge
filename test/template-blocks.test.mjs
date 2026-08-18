// Template rules and prompts: parsed out of a template, and taken back out of
// the spec made from it.
//
// The invariant that matters most is the negative one. A spec must never carry
// a rules block or a prompt, and "the rest of the document matches the template"
// must be literally true — a strip that also reformats is a strip that makes
// every scaffolded spec differ from its template for reasons nobody chose.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseTemplateRules,
  parseTemplatePrompts,
  parseTemplateOutline,
  stripTemplateBlocks,
  hasTemplateBlocks,
  renderTemplateBlocks,
} from '../lib/rules/template-blocks.mjs';
import { mergeRules } from '../lib/rules/index.mjs';
import { ALL_GLOBAL_RULES } from '../lib/rules/global.mjs';
import { TEMPLATE_RULES, TEMPLATE_PROMPTS } from '../lib/rules/template-defaults.mjs';

const WITH_RULES = `<body>
<section id="tldr"><h2>TL;DR</h2><p>Body.</p></section>
<section data-sf-rules hidden>
  <h2>Rules for a design spec</h2>
  <ul>
    <li data-sf-rule="no-build-plan">There is no implementation plan.</li>
    <li data-sf-rule="no-aphorisms" data-sf-severity="off"></li>
    <li data-sf-rule="soft-one" data-sf-severity="advisory">Something mild must hold.</li>
  </ul>
</section>
</body>`;

const WITH_PROMPTS = `<body>
<section id="open-questions"><h2>Open questions</h2>
  <div data-sf-prompt><p>Every question here is a decision only the reader can make.</p><p>Offer options.</p></div>
</section>
<section id="decisions"><h2>Decisions</h2>
  <div data-sf-prompt><p>Give the choice and what it costs.</p></div>
</section>
</body>`;

// The outline is what the configuration pane's Sections tree lists. It has to
// name every section a prompt could attach to, not only the ones that already
// carry one: a tab that lists what exists cannot be used to add anything.
const OUTLINE = `<body>
<section id="tldr"><h4>TL;DR</h4><p>Body.</p></section>
<section id="design"><h2>4 · Design</h2>
  <div data-sf-prompt><p>Guidance.</p></div>
  <h4>Summary</h4><p>x</p><h4>Architecture</h4><p>y</p>
</section>
<section><h2>No id here</h2></section>
<section data-sf-rules hidden><h2>Rules</h2><ul><li data-sf-rule="r">R.</li></ul></section>
</body>`;

test('the outline names every section, not only the ones carrying a prompt', () => {
  const out = parseTemplateOutline(OUTLINE);
  assert.deepEqual(out.map((s) => s.id), ['tldr', 'design', null]);
});

test('a section reports its own heading and level', () => {
  const [tldr, design] = parseTemplateOutline(OUTLINE);
  assert.deepEqual({ heading: tldr.heading, level: tldr.level }, { heading: 'TL;DR', level: 4 });
  assert.deepEqual({ heading: design.heading, level: design.level },
    { heading: '4 · Design', level: 2 });
});

test('the headings under a section travel with it, which is the nesting the tree draws', () => {
  const design = parseTemplateOutline(OUTLINE).find((s) => s.id === 'design');
  assert.deepEqual(design.subheadings, [
    { text: 'Summary', level: 4 },
    { text: 'Architecture', level: 4 },
  ]);
});

test('the rules block is scaffolding and is not part of the outline', () => {
  // It is a section and it has a heading, so nothing but an explicit exclusion
  // keeps it out of a list of places to attach guidance.
  assert.equal(parseTemplateOutline(OUTLINE).some((s) => /Rules/.test(s.heading)), false);
});

test('a section with no id is listed but cannot carry guidance', () => {
  // renderTemplateBlocks targets a section by id, so a prompt for an unnamed one
  // has nowhere to go. Listing it and saying so beats hiding it.
  const anon = parseTemplateOutline(OUTLINE).find((s) => s.id === null);
  assert.equal(anon.heading, 'No id here');
});

test('a rules block parses to raw overrides', () => {
  assert.deepEqual(parseTemplateRules(WITH_RULES), [
    { id: 'no-build-plan', ask: 'There is no implementation plan.' },
    { id: 'no-aphorisms', severity: 'off' },
    { id: 'soft-one', severity: 'advisory', ask: 'Something mild must hold.' },
  ]);
});

test('an empty li is an override, not a rule with no sentence', () => {
  const [, off] = parseTemplateRules(WITH_RULES);
  assert.equal('ask' in off, false, 'an override must not invent an empty sentence');
});

test('a template with no rules block yields an empty list', () => {
  assert.deepEqual(parseTemplateRules('<body><section id="a"><p>x</p></section></body>'), []);
  assert.deepEqual(parseTemplateRules(''), []);
});

test('an unknown severity in a template names itself rather than being ignored', () => {
  const bad = WITH_RULES.replace('data-sf-severity="advisory"', 'data-sf-severity="loud"');
  assert.throws(() => parseTemplateRules(bad), /unknown severity "loud"/);
});

test('prompts parse keyed by the section they sit in', () => {
  const prompts = parseTemplatePrompts(WITH_PROMPTS);
  assert.deepEqual(prompts.map((p) => p.section), ['open-questions', 'decisions']);
  assert.match(prompts[0].text, /decision only the reader can make/);
  assert.match(prompts[0].text, /Offer options/);
});

test('a template with no prompts yields an empty list', () => {
  assert.deepEqual(parseTemplatePrompts(WITH_RULES), []);
});

test('strip removes the rules block and leaves everything else byte-identical', () => {
  const stripped = stripTemplateBlocks(WITH_RULES);
  assert.equal(hasTemplateBlocks(stripped), false);
  assert.equal(stripped, '<body>\n<section id="tldr"><h2>TL;DR</h2><p>Body.</p></section>\n</body>');
});

test('strip removes prompts and leaves their sections intact', () => {
  const stripped = stripTemplateBlocks(WITH_PROMPTS);
  assert.equal(hasTemplateBlocks(stripped), false);
  assert.match(stripped, /<section id="open-questions"><h2>Open questions<\/h2>/);
  assert.match(stripped, /<section id="decisions"><h2>Decisions<\/h2>/);
});

test('strip is idempotent', () => {
  const once = stripTemplateBlocks(WITH_RULES);
  assert.equal(stripTemplateBlocks(once), once);
  const p = stripTemplateBlocks(WITH_PROMPTS);
  assert.equal(stripTemplateBlocks(p), p);
});

test('strip on a document with neither block changes nothing', () => {
  const plain = '<body><section id="a"><h2>A</h2><p>x</p></section></body>';
  assert.equal(stripTemplateBlocks(plain), plain);
});

test('a prompt holding nested markup is removed whole', () => {
  // A prompt is prose you edit in SpecForge, so it can perfectly well end up
  // holding a <div>. A non-greedy `</div>` cuts at the first one, which removes
  // half the prompt and leaves a stray closing tag in the finished spec.
  // Malformed HTML in a shipped document is worse than the scaffolding it was
  // trying to remove. Greptile on #171.
  const nested = `<body>
<section id="open-questions"><h2>Q</h2>
  <div data-sf-prompt><p>Guidance.</p><div class="card"><p>An example.</p></div><p>More.</p></div>
</section>
</body>`;
  const stripped = stripTemplateBlocks(nested);
  assert.equal(hasTemplateBlocks(stripped), false);
  assert.doesNotMatch(stripped, /An example/, 'the nested content went with it');
  assert.doesNotMatch(stripped, /<\/div>/, 'no orphaned closing tag left behind');
  assert.equal(stripped, '<body>\n<section id="open-questions"><h2>Q</h2>\n</section>\n</body>');
});

test('a nested prompt parses as one prompt, not a truncated one', () => {
  const nested = '<section id="q"><div data-sf-prompt><p>One.</p><div><p>Two.</p></div></div></section>';
  const [p] = parseTemplatePrompts(nested);
  assert.equal(parseTemplatePrompts(nested).length, 1);
  assert.match(p.text, /One\./);
  assert.match(p.text, /Two\./, 'the nested half is part of the same prompt');
});

test('a rules block holding a nested section is removed whole', () => {
  const nested = `<body><section id="a"><p>x</p></section>
<section data-sf-rules hidden><ul><li data-sf-rule="r">A rule.</li></ul><section><p>Odd but legal.</p></section></section>
</body>`;
  const stripped = stripTemplateBlocks(nested);
  assert.equal(hasTemplateBlocks(stripped), false);
  assert.doesNotMatch(stripped, /Odd but legal/);
  assert.equal(stripped, '<body><section id="a"><p>x</p></section>\n</body>');
});

test('an unclosed block is left alone rather than truncating the document', () => {
  // Truncating at an unbalanced tag turns one bad edit into a lost spec.
  const broken = '<body><section id="a"><p>Keep me.</p></section><div data-sf-prompt><p>No close.</p></body>';
  assert.equal(stripTemplateBlocks(broken), broken);
  assert.match(stripTemplateBlocks(broken), /Keep me/);
});

test('parsing twice gives the same answer', () => {
  // The block regexes are module-level and carry /g. Both .match() and
  // .replace() reset lastIndex, but a future edit might not, so this pins it.
  assert.deepEqual(parseTemplateRules(WITH_RULES), parseTemplateRules(WITH_RULES));
  assert.deepEqual(parseTemplatePrompts(WITH_PROMPTS), parseTemplatePrompts(WITH_PROMPTS));
  assert.equal(stripTemplateBlocks(WITH_RULES), stripTemplateBlocks(WITH_RULES));
});

// ── Render, then read back ──────────────────────────────────────────────────

test('rendered rules parse back to what went in', () => {
  const shell = '<body><section id="open-questions"><h2>Q</h2></section></body>';
  const html = renderTemplateBlocks(shell, { rules: TEMPLATE_RULES.design });
  const back = parseTemplateRules(html);
  assert.deepEqual(back.map((r) => r.id), TEMPLATE_RULES.design.map((r) => r.id));
  assert.equal(back[0].ask, TEMPLATE_RULES.design[0].ask);
});

test('rendered prompts parse back into the section they name', () => {
  const shell = '<body><section id="open-questions"><h2>Q</h2></section><section id="decisions"><h2>D</h2></section></body>';
  const html = renderTemplateBlocks(shell, { prompts: TEMPLATE_PROMPTS });
  const back = parseTemplatePrompts(html);
  assert.deepEqual(back.map((p) => p.section).sort(), ['decisions', 'open-questions']);
});

test('a prompt for a section the shell does not have is skipped, not misplaced', () => {
  const shell = '<body><section id="open-questions"><h2>Q</h2></section></body>';
  const html = renderTemplateBlocks(shell, { prompts: TEMPLATE_PROMPTS });
  assert.deepEqual(parseTemplatePrompts(html).map((p) => p.section), ['open-questions']);
});

test('rendering then stripping returns the original shell', () => {
  const shell = '<body>\n<section id="open-questions"><h2>Q</h2></section>\n</body>';
  const rendered = renderTemplateBlocks(shell, { rules: TEMPLATE_RULES.design, prompts: TEMPLATE_PROMPTS });
  assert.notEqual(rendered, shell);
  assert.equal(stripTemplateBlocks(rendered), shell);
});

test('a rule sentence with markup characters survives the round trip', () => {
  const shell = '<body></body>';
  const rules = [{ id: 'angle', ask: 'The spec has an <h1> & a <title>, not "one" of them.' }];
  const html = renderTemplateBlocks(shell, { rules });
  assert.equal(parseTemplateRules(html)[0].ask, 'The spec has an <h1> & a <title>, not "one" of them.');
});

test('a rule keeps its fix hint through the round trip', () => {
  // The hint is what makes a failure actionable. A template rule that lost it
  // reported a failure with no next step.
  const html = renderTemplateBlocks('<body></body>', {
    rules: [{ id: 'r', ask: 'The rule.', fix: 'Do this about it.' }],
  });
  const [back] = parseTemplateRules(html);
  assert.equal(back.ask, 'The rule.', 'the hint does not leak into the sentence');
  assert.equal(back.fix, 'Do this about it.');
});

test('the fix hint is marked with a data attribute, not a class', () => {
  // `fix` is not in the component library, and a template spec is a spec, so a
  // class outside the library makes every template fail its own components lint.
  const html = renderTemplateBlocks('<body></body>', {
    rules: [{ id: 'r', ask: 'The rule.', fix: 'Do this.' }],
  });
  assert.match(html, /<span data-sf-fix>/);
  assert.doesNotMatch(html, /class="fix"/);
});

test('every default template rule survives the round trip with its hint', () => {
  for (const [type, rules] of Object.entries(TEMPLATE_RULES)) {
    const back = parseTemplateRules(renderTemplateBlocks('<body></body>', { rules }));
    for (const [i, r] of rules.entries()) {
      assert.equal(back[i].id, r.id, type);
      if (r.fix) assert.equal(back[i].fix, r.fix, `${type}/${r.id}: lost its fix hint`);
    }
  }
});

test('the corpus citation rides along without becoming part of the rule', () => {
  const shell = '<body></body>';
  const rules = [{ id: 'r', ask: 'The rule.', corpus: 'The comment that produced it.' }];
  const html = renderTemplateBlocks(shell, { rules });
  assert.match(html, /class="evidence"/);
  // The citation is inside the <li>, so it is read as part of the sentence. That
  // is deliberate: an agent judging the rule benefits from the example, and the
  // alternative is a second parse for a field nothing else uses.
  assert.match(parseTemplateRules(html)[0].ask, /^The rule\./);
});

test('the rules block renders hidden, so a stray one never shows to a reader', () => {
  const html = renderTemplateBlocks('<body></body>', { rules: TEMPLATE_RULES.design });
  assert.match(html, /<section data-sf-rules hidden>/);
});

// ── The defaults, merged against the global list ────────────────────────────

test('every default template rule merges cleanly onto the global list', () => {
  for (const [type, rules] of Object.entries(TEMPLATE_RULES)) {
    const merged = mergeRules(ALL_GLOBAL_RULES, rules);
    assert.ok(merged.length > 0, `${type} produced no rules`);
    for (const r of merged) {
      assert.ok(r.ask || r.check, `${type}/${r.id}: answered no way`);
      assert.ok(r.fix, `${type}/${r.id}: no fix hint`);
    }
  }
});

test('the deck override removes no-aphorisms and nothing else', () => {
  const base = ALL_GLOBAL_RULES.map((r) => r.id);
  const deck = mergeRules(ALL_GLOBAL_RULES, TEMPLATE_RULES.deck).map((r) => r.id);
  assert.equal(deck.includes('no-aphorisms'), false);
  assert.deepEqual(deck, base.filter((id) => id !== 'no-aphorisms'));
});

test('the corpus rules moved by D12 live in templates, not the global list', () => {
  const global = ALL_GLOBAL_RULES.map((r) => r.id);
  for (const id of ['stages-are-explained-plainly', 'fixes-carry-a-guard', 'findings-name-what-they-break']) {
    assert.equal(global.includes(id), false, `${id} should not be global`);
  }
  assert.ok(TEMPLATE_RULES.research.some((r) => r.id === 'findings-name-what-they-break'));
  for (const type of ['design-impl', 'impl']) {
    assert.ok(TEMPLATE_RULES[type].some((r) => r.id === 'stages-are-explained-plainly'), type);
    assert.ok(TEMPLATE_RULES[type].some((r) => r.id === 'fixes-carry-a-guard'), type);
  }
});

test('every corpus-derived template rule carries the comment that produced it', () => {
  const corpusRules = Object.values(TEMPLATE_RULES).flat().filter((r) => r.corpus);
  assert.ok(corpusRules.length >= 3);
  for (const r of corpusRules) {
    assert.ok(r.corpus.length > 30, `${r.id}: citation is too thin to be evidence`);
  }
});

test('design-impl and impl carry different rules despite sharing a shell', () => {
  // This is the whole reason the blocks are rendered per type rather than
  // written into the shell files: templates/spec-base.html serves both.
  const di = TEMPLATE_RULES['design-impl'].map((r) => r.id);
  const impl = TEMPLATE_RULES.impl.map((r) => r.id);
  assert.ok(di.includes('runtime-stubs-present'));
  assert.equal(impl.includes('runtime-stubs-present'), false);
  assert.ok(impl.includes('plan-is-the-bulk'));
  assert.equal(di.includes('plan-is-the-bulk'), false);
});
