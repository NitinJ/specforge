// What a spec's prose looks like once it is markdown.
//
// Both cases here were found by exporting a real spec and reading the result,
// not by a fixture. The dialect's contract is that it "renders on GitHub with no
// plugins", and both of these broke that quietly: one ran two words together,
// the other opened an HTML block that swallowed the rest of the section.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { specToMarkdown } from '../lib/html-to-md.mjs';

/** Export a fragment as the body of one section. */
function md(body) {
  const { markdown } = specToMarkdown(
    `<html><head><title>T</title></head><body><main><h1>T</h1>`
    + `<section id="s"><h2>S</h2>${body}</section></main></body></html>`,
    { exportedAt: '2026-08-15' },
  );
  return markdown;
}

// ---- a stat is a number and what it counts ----

test('a stat separates its number from its label', () => {
  const out = md('<div class="stats"><div class="stat">'
    + '<span class="n">223</span><span class="k">inline SVG elements, in 49 of 120 specs</span>'
    + '</div></div>');
  assert.match(out, /- \*\*223\*\* inline SVG elements, in 49 of 120 specs/);
  assert.doesNotMatch(out, /223inline/, 'the number must not run into its label');
});

test('a row of stats becomes a list, because markdown has no row', () => {
  const out = md('<div class="stats">'
    + '<div class="stat"><span class="n">223</span><span class="k">SVGs</span></div>'
    + '<div class="stat"><span class="n">29</span><span class="k">sketches</span></div>'
    + '<div class="stat"><span class="n">136</span><span class="k">code blocks</span></div>'
    + '</div>');
  const list = out.match(/^- \*\*\d+\*\* .+$/gm);
  assert.equal(list.length, 3, 'one line per stat, in order');
  assert.match(list[0], /223/);
  assert.match(list[2], /136/);
});

test('a stat with only a number still exports', () => {
  const out = md('<div class="stat"><span class="n">1208</span></div>');
  assert.match(out, /\*\*1208\*\*/);
});

// ---- a tag written in prose stays visible ----
//
// A spec that writes `&lt;pre&gt;` means the four characters. Decoding leaves a
// literal `<pre>` in the markdown, and GFM reads that as raw HTML: on GitHub the
// tag vanishes, and `<pre>` opens a preformatted block that eats the rest.

test('a tag name written in prose is escaped, not emitted as HTML', () => {
  const out = md('<p>136 &lt;pre&gt; blocks in the store.</p>');
  assert.match(out, /136 \\<pre> blocks in the store\./);
  assert.doesNotMatch(out, /[^\\]<pre>/, 'no unescaped tag reaches the markdown');
});

test('the escape covers closing tags and comments too', () => {
  const out = md('<p>Write &lt;/section&gt; and &lt;!-- note --&gt; carefully.</p>');
  assert.match(out, /\\<\/section>/);
  assert.match(out, /\\<!-- note -->/);
});

test('a less-than that is not a tag is left alone', () => {
  // Escaping every `<` would put backslashes through arithmetic and arrows,
  // which is a different kind of wrong.
  const out = md('<p>Keep a &lt; b, and 3 &lt;- 4, readable.</p>');
  assert.match(out, /a < b/);
  assert.match(out, /3 <- 4/);
});

test('a tag inside code is untouched, because backticks already protect it', () => {
  const out = md('<p>The <code>&lt;pre&gt;</code> is the block.</p>');
  assert.match(out, /`<pre>`/, 'inside a code span it needs no backslash');
});

test('a code block full of markup is not escaped either', () => {
  const out = md('<pre data-lang="html"><code>&lt;section id="s"&gt;\n  &lt;p&gt;x&lt;/p&gt;\n&lt;/section&gt;</code></pre>');
  assert.match(out, /^<section id="s">$/m, 'a fence is verbatim');
  assert.doesNotMatch(out, /\\</, 'and carries no escapes');
});
