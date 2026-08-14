// Markdown interop preserves a notice's type.
//
// Measured before this stage: all 12 library notice types exported as a bare
// `<!-- sf:callout -->` and came back untyped, because lib/html-to-md.mjs held
// its own list of variants: ['warn', 'good', 'bad']. A deviation and a note
// exported identically, which is the failure the library exists to remove, one
// format removed.
//
// The list derives from the definitions now. This is the second of the three
// hard-coded component lists to go.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { specToMarkdown } from '../lib/html-to-md.mjs';
import { parseMarkdown } from '../lib/md-parse.mjs';
import { toSections } from '../lib/md-to-html.mjs';
import { noticeTypes } from '../components/index.mjs';

/** Legacy tone modifiers, kept readable on import so old markdown still opens. */
const LEGACY = ['warn', 'good', 'bad'];

const spec = (body) => `<!DOCTYPE html>
<html lang="en" data-sf-spec-status="draft"><head><title>T</title></head>
<body><main><h1>T</h1><section id="s" data-sf-section><h2>1 · S</h2>
${body}
</section></main></body></html>`;

const roundTrip = (html) => {
  const md = specToMarkdown(html, { title: 'T' });
  const text = typeof md === 'string' ? md : (md.md || md.markdown || md.text);
  const sections = toSections(parseMarkdown(text).blocks || parseMarkdown(text), { title: 'T' });
  const back = (Array.isArray(sections) ? sections : [sections])
    .map((s) => (typeof s === 'string' ? s : s.html || '')).join('\n');
  return { md: text, html: back };
};

test('every notice type survives export', () => {
  const body = noticeTypes().map((t) => `<div class="callout ${t}">Body for ${t}.</div>`).join('\n');
  const { md } = roundTrip(spec(body));
  const lost = noticeTypes().filter((t) => !md.includes(`variant="${t}"`));
  assert.deepEqual(lost, [], 'a notice type that exports untyped');
});

test('every notice type survives the round trip back to html', () => {
  const body = noticeTypes().map((t) => `<div class="callout ${t}">Body for ${t}.</div>`).join('\n');
  const { html } = roundTrip(spec(body));
  const lost = noticeTypes().filter((t) => !html.includes(`class="callout ${t}"`));
  assert.deepEqual(lost, [], 'a notice type lost on import');
});

// Markdown written before the library still has to open. The tone modifiers are
// what 640 callouts in the store carry.
test('the legacy tone modifiers still export and import', () => {
  const body = LEGACY.map((t) => `<div class="callout ${t}">Body for ${t}.</div>`).join('\n');
  const { md, html } = roundTrip(spec(body));
  for (const t of LEGACY) {
    assert.ok(md.includes(`variant="${t}"`), `${t} exports`);
    assert.ok(html.includes(`class="callout ${t}"`), `${t} imports`);
  }
});

// The type is what the block means. A round trip that changes it has changed the
// document, so equivalence has to see it.
test('a notice type is structure, so changing it changes the export', () => {
  const a = roundTrip(spec('<div class="callout decision">X</div>')).md;
  const b = roundTrip(spec('<div class="callout note">X</div>')).md;
  assert.notEqual(a, b, 'decision and note do not export identically');
});

test('a notice with no type still exports as an untyped callout', () => {
  const { md, html } = roundTrip(spec('<div class="callout">X</div>'));
  assert.match(md, /<!-- sf:callout -->/, 'no variant is emitted');
  assert.match(html, /class="callout"/, 'and it comes back untyped rather than guessed at');
});

// The lists must not drift again: this is exactly how the three hard-coded ones
// got out of step with each other.
test('the exporter accepts every library notice type and nothing invented', async () => {
  const { CALLOUT_VARIANTS } = await import('../lib/html-to-md.mjs');
  assert.deepEqual(
    [...CALLOUT_VARIANTS].sort(),
    [...new Set([...noticeTypes(), ...LEGACY])].sort(),
    'the exporter list is the library plus the legacy tones, and nothing else',
  );
});
