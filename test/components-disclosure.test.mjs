// The disclosure: the whole native layer, and the only interactive component
// that needs no script at all.
//
// Three document products converged on this block and gave it three names
// (Notion's toggle list, Confluence's Expand macro, Google Docs' collapsible
// heading). HTML has had it since 2011. Building a custom accordion would buy
// styling freedom and pay for it in keyboard behaviour, screen-reader
// behaviour, find-in-page expansion, and markdown export — all four of which
// <details> gives for nothing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  component, componentsIn, layerOf, needsOf, componentClasses, blockComponents,
} from '../components/index.mjs';
import { buildBody } from '../lib/components-build.mjs';
import { buildDoc } from '../lib/components-doc.mjs';
import { specToMarkdown } from '../lib/html-to-md.mjs';
import { parseMarkdown } from '../lib/md-parse.mjs';
import { toSections } from '../lib/md-to-html.mjs';

const spec = (body) => `<!DOCTYPE html>
<html lang="en" data-sf-spec-status="draft"><head><title>T</title></head>
<body><main><h1>T</h1><section id="s" data-sf-section><h2>1 · S</h2>
${body}
</section></main></body></html>`;

const roundTrip = (html) => {
  const out = specToMarkdown(html, { title: 'T' });
  const text = typeof out === 'string' ? out : (out.md || out.markdown || out.text);
  const sections = toSections(parseMarkdown(text).blocks || parseMarkdown(text), { title: 'T' });
  const back = (Array.isArray(sections) ? sections : [sections])
    .map((s) => (typeof s === 'string' ? s : s.html || '')).join('\n');
  return { md: text, html: back };
};

const DISCLOSURE = `<details class="disclosure">
  <summary>How the 61% was measured</summary>
  <p>Every spec in the store, parsed for headings the rail can reach.</p>
</details>`;

// ---- the registry ----

test('disclosure is an interactive component that needs no script', () => {
  const c = component('disclosure');
  assert.ok(c, 'it is registered');
  assert.equal(layerOf(c), 'interactive');
  assert.equal(needsOf(c), 'none', 'the element is already interactive');
  assert.equal(c.block, true, 'it is a block');
  assert.equal(c.selector, '<details class="disclosure">', 'and the doc shows what to type');
});

test('it is a class component, which is what makes it lintable and commentable', () => {
  // `kind` drives two lists, and registering this as an element would leave it
  // out of both: the lint would reject the class it tells authors to write, and
  // a reviewer could not comment on the block (I4). It carries `selector` so the
  // library page still shows the tag rather than a bare `.disclosure`.
  assert.equal(component('disclosure').kind, 'class');
  assert.ok(componentClasses().includes('disclosure'), 'the lint accepts the class');
  assert.ok(blockComponents().includes('disclosure'), 'and a comment can anchor to it');
});

test('disclosure is documented in the interactive collection only', () => {
  assert.ok(componentsIn('interactive').some((c) => c.name === 'disclosure'));
  assert.ok(buildDoc({ layer: 'interactive' }).includes('data-component="disclosure"'));
  assert.ok(!buildDoc({ layer: 'static' }).includes('data-component="disclosure"'));
});

test('its rule names the failure, not just the use', () => {
  // A disclosure holding something the argument depends on is the way this
  // component goes wrong, and the rule is the only place an agent reads before
  // using it.
  const c = component('disclosure');
  assert.match(c.rule, /second pass|first pass/i, 'says when it applies');
  assert.ok(c.requires.length, 'and what the block must carry');
});

// ---- what it ships ----

test('the stamped stylesheet styles it and hides nothing', () => {
  // I1, at the only scale it can be checked on a component that has no script:
  // nothing in a disclosure's rules may remove content from the page, because
  // there is no script to put it back.
  const css = buildBody();
  assert.ok(css.includes('details.disclosure'), 'it is stamped');
  const own = css.split('\n').filter((l) => l.includes('.disclosure'));
  assert.ok(own.length, 'and has rules of its own');
  const hiding = own.filter((l) => /display:\s*none/.test(l)
    && !/summary::(-webkit-details-)?marker|::before|::after/.test(l));
  assert.deepEqual(hiding, [], 'no rule hides content');
});

test('printing is asked to expand it', () => {
  // I6. The CSS half works on engines that expose the content box; review.js
  // carries the half that works everywhere else.
  const css = buildBody();
  assert.match(css, /@media print/, 'a print rule exists');
  assert.match(css, /details-content|details\.disclosure\[open\]|break-inside/,
    'and it concerns the disclosure');
});

// ---- markdown ----

test('a disclosure exports with its summary and its body intact', () => {
  const { md } = roundTrip(spec(DISCLOSURE));
  assert.match(md, /<details/, 'it stays collapsible: GitHub renders this');
  assert.match(md, /<summary>/);
  assert.ok(md.includes('How the 61% was measured'), 'the summary text survives');
  assert.ok(md.includes('Every spec in the store'), 'and so does the body');
});

test('the exported form leaves blank lines around the body', () => {
  // Without them GitHub treats the whole block as raw HTML and renders the
  // markdown inside it literally, so a table in a disclosure exports as pipes.
  const { md } = roundTrip(spec(DISCLOSURE));
  const block = md.slice(md.indexOf('<details'), md.indexOf('</details>'));
  assert.match(block, /<\/summary>\n\n/, 'a blank line after the summary');
});

test('a disclosure survives the round trip back to html', () => {
  const { html } = roundTrip(spec(DISCLOSURE));
  assert.match(html, /<details/i, 'still a disclosure');
  assert.match(html, /<summary/i, 'still has its summary');
  assert.ok(html.includes('Every spec in the store'), 'and loses no body text');
});

test('a table inside a disclosure survives export', () => {
  // The case the blank lines exist for.
  const body = `<details class="disclosure"><summary>Raw numbers</summary>
  <table><thead><tr><th>Level</th><th>Uses</th></tr></thead>
  <tbody><tr><td>h4</td><td>1601</td></tr></tbody></table>
</details>`;
  const { md } = roundTrip(spec(body));
  assert.ok(md.includes('1601'), 'the measurement is still there');
  assert.match(md, /\|\s*Level\s*\|/, 'and still a table, not escaped pipes');
});

test('export warns about nothing: details is a handled element', () => {
  // It reached the exporter's default branch before this, which pushed
  // "unhandled element" and flattened the block to prose.
  const out = specToMarkdown(spec(DISCLOSURE), { title: 'T' });
  const warnings = out.warnings || [];
  assert.deepEqual(warnings.filter((w) => /details|summary/.test(w)), []);
});
