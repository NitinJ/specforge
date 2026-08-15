// A diagram through markdown, in both directions.
//
// This is the one place mermaid beats inline SVG outright, and it is a fidelity
// argument rather than a taste one. An SVG diagram leaves a spec as
// `<name>.assets/<section>-k.svg` plus an image reference and comes back by
// inlining; a mermaid diagram is the same text at both ends, is readable in the
// markdown itself, and renders natively on GitHub.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { specToMarkdown } from '../lib/html-to-md.mjs';
import { markdownToSpecHtml } from '../lib/md-to-html.mjs';
import { fixture } from './fixtures/md/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = readFileSync(join(ROOT, 'templates', 'spec-base-general.html'), 'utf8');

const exported = () => specToMarkdown(fixture('mermaid').html(), { exportedAt: '2026-08-15' });
const reimport = (markdown) => markdownToSpecHtml(markdown, {
  shell: SHELL, date: '2026-08-15', owner: 'nitin',
});

test('a diagram exports as a plain mermaid fence', () => {
  const { markdown } = exported();
  const fences = [...markdown.matchAll(/^```mermaid\n([\s\S]*?)^```$/gm)].map((m) => m[1]);
  assert.equal(fences.length, 3, 'all three diagrams, as fences');
  assert.match(fences[0], /^flowchart LR\n/);
  assert.match(fences[1], /^stateDiagram-v2\n/);
  assert.match(fences[2], /^sequenceDiagram\n/);
});

test('a diagram costs no sidecar file, which is the whole argument over SVG', () => {
  const { assets } = exported();
  assert.deepEqual(assets.map((a) => a.name), [],
    'an inline SVG would have been lifted to <name>.assets/...svg; this travels as text');
});

test('the fence carries no SF-MD marker of its own', () => {
  const { markdown } = exported();
  // GFM already has a fenced block with an info string, so the dialect gains
  // nothing. A diagram that needed a marker would not render on GitHub.
  const near = markdown.slice(Math.max(0, markdown.indexOf('```mermaid') - 200), markdown.indexOf('```mermaid'));
  assert.doesNotMatch(near, /<!-- sf:(svg|diagram|mermaid)/, 'no marker precedes the fence');
});

test('other languages on the same page survive alongside it', () => {
  const { markdown } = exported();
  assert.match(markdown, /^```python$/m, 'a declared python block keeps its language');
  assert.match(markdown, /^```$/m, 'and an undeclared block stays undeclared');
});

test('a mermaid fence imports back as a diagram block the review layer will render', () => {
  const { markdown } = exported();
  const { html } = reimport(markdown);

  const blocks = [...html.matchAll(/<pre[^>]*>\s*<code([^>]*)>([\s\S]*?)<\/code>\s*<\/pre>/g)];
  const diagrams = blocks.filter((m) => /lang(?:uage)?-mermaid/.test(m[1]));
  assert.equal(diagrams.length, 3, 'three diagrams came back');
  assert.match(diagrams[0][2], /flowchart LR/);
  // `lang-mermaid` on the code element is what import-md writes, and
  // declaredLang() in the review layer already reads that spelling.
  assert.match(diagrams[0][1], /class="lang-mermaid"/);
});

test('the source is byte-identical at both ends', () => {
  const original = fixture('mermaid').html();
  const { markdown } = exported();
  const { html } = reimport(markdown);

  const sourcesOf = (doc) => [...doc.matchAll(/<pre[^>]*>\s*<code[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g)]
    .map((m) => m[1])
    .filter((s) => /flowchart|stateDiagram|sequenceDiagram/.test(s))
    .map((s) => s.replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&').trim());

  assert.deepEqual(sourcesOf(html), sourcesOf(original),
    'a diagram is the same text going out and coming back');
});
