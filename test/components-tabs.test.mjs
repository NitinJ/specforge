// Tabs: the component with the most reader value and the most reader risk.
//
// No document product surveyed ships them natively. Notion has none, Confluence
// sends you to the Marketplace, and Google Docs' tabs are document-level
// navigation rather than a block inside the prose. GOV.UK ships them and says
// plainly that the component "has not yet been tried in research with users".
//
// The demand is real (the Marketplace app exists because of it) and so is the
// failure mode: content a reader never finds because it was behind a label they
// did not click. Which is why the rule is narrow, why the markdown form is flat,
// and why the un-enhanced document shows every panel.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { component, needsOf, layerOf, LIVE_ATTR } from '../components/index.mjs';
import { buildBody, hidingRules } from '../lib/components-build.mjs';
import { specToMarkdown } from '../lib/html-to-md.mjs';
import { parseMarkdown } from '../lib/md-parse.mjs';
import { toSections } from '../lib/md-to-html.mjs';

const spec = (body) => `<!DOCTYPE html>
<html lang="en" data-sf-spec-status="draft"><head><title>T</title></head>
<body><main><h1>T</h1><section id="s" data-sf-section><h2>1 · S</h2>
${body}
</section></main></body></html>`;

const TABS = `<div class="tabs">
  <div class="tab" data-label="macOS"><p>brew install specforge</p></div>
  <div class="tab" data-label="Linux"><p>npm i -g specforge</p></div>
  <div class="tab" data-label="Windows"><p>winget install specforge</p></div>
</div>`;

const roundTrip = (html) => {
  const out = specToMarkdown(html, { title: 'T' });
  const text = typeof out === 'string' ? out : (out.md || out.markdown || out.text);
  const sections = toSections(parseMarkdown(text).blocks || parseMarkdown(text), { title: 'T' });
  const back = (Array.isArray(sections) ? sections : [sections])
    .map((s) => (typeof s === 'string' ? s : s.html || '')).join('\n');
  return { md: text, html: back };
};

// ---- the registry ----

test('tabs is interactive and needs the script', () => {
  const c = component('tabs');
  assert.ok(c);
  assert.equal(layerOf(c), 'interactive');
  assert.equal(needsOf(c), 'script');
  assert.equal(c.detect, '.tabs');
  assert.equal(c.block, true, 'a reviewer can comment on the group');
});

test('the rule says what tabs are NOT for', () => {
  // The failure mode is content nobody finds. A rule that only says when to use
  // it leaves the author to discover the rest.
  const { rule } = component('tabs');
  assert.match(rule, /never/i);
  assert.match(rule, /sequential/i, 'steps are not alternatives');
  assert.match(rule, /compare/i, 'and two things read side by side are not either');
});

// ---- I1, the reason the component can exist at all ----

test('nothing about tabs hides content outside the live attribute', () => {
  assert.deepEqual(hidingRules(buildBody()), []);
});

test('the panels are visible in the stamped stylesheet, and only hidden under it', () => {
  const css = buildBody();
  const tabRules = css.split('\n').filter((l) => l.includes('.tabs >') || l.includes('.tabs{'));
  const unguarded = tabRules.filter((l) => /display:\s*none/.test(l) && !l.includes(`[${LIVE_ATTR}]`));
  assert.deepEqual(unguarded, [],
    'a spec opened from disk would lose every panel but one');
  assert.ok(css.includes(`[${LIVE_ATTR}] .tabs > .tab[hidden]{display:none}`),
    'and the hiding that does happen is keyed on the script having run');
});

test('an un-enhanced panel still says which alternative it is', () => {
  // The label lives in an attribute, so with no script it would be invisible
  // and the reader would get three unexplained blocks.
  const css = buildBody();
  assert.match(css, /\.tabs > \.tab::before\{content:attr\(data-label\)/,
    'the label is drawn from the attribute by CSS alone');
  assert.match(css, new RegExp(`\\[${LIVE_ATTR}\\] \\.tabs > \\.tab::before\\{display:none\\}`),
    'and stands down once the strip carries it');
});

// ---- markdown ----

test('tabs export as bold labels, never as headings', () => {
  // D8. Four panels exported as four headings would add four entries to the
  // outline of the exported markdown that are not sections of the document.
  const { md } = roundTrip(spec(TABS));
  assert.match(md, /\*\*macOS\*\*/);
  assert.match(md, /\*\*Linux\*\*/);
  assert.match(md, /\*\*Windows\*\*/);
  const headings = md.split('\n').filter((l) => /^#{1,6}\s/.test(l));
  assert.deepEqual(headings.filter((h) => /macOS|Linux|Windows/.test(h)), [],
    'no panel became a heading');
});

test('every panel body survives export, not just the first', () => {
  const { md } = roundTrip(spec(TABS));
  for (const line of ['brew install specforge', 'npm i -g specforge', 'winget install specforge']) {
    assert.ok(md.includes(line), `${line} survives`);
  }
});

test('the panels keep their authored order', () => {
  const { md } = roundTrip(spec(TABS));
  assert.ok(md.indexOf('macOS') < md.indexOf('Linux'), 'macOS first');
  assert.ok(md.indexOf('Linux') < md.indexOf('Windows'), 'then Linux');
});

test('a round trip back to html loses no panel', () => {
  const { html } = roundTrip(spec(TABS));
  for (const line of ['brew install specforge', 'npm i -g specforge', 'winget install specforge']) {
    assert.ok(html.includes(line), `${line} came back`);
  }
});
