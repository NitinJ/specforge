// The markdown parser, construct by construct.
//
// Every block and inline form in the house subset has a case here, and so does
// every form outside it: the contract is that unsupported input is REPORTED with
// its line number, never dropped on the floor.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseMarkdown, parseFrontmatter, parseMarker, inlineToHtml } from '../lib/md-parse.mjs';

const blocks = (md) => parseMarkdown(md).blocks;
const first = (md) => blocks(md)[0];

// ---------------------------------------------------------------- frontmatter

test('frontmatter reads flat pairs and strips quotes', () => {
  const { fields, body } = parseFrontmatter('---\ntitle: "A: colon"\ntype: design\n---\n\n# Doc\n');
  assert.deepEqual(fields, { title: 'A: colon', type: 'design' });
  assert.equal(body, '\n# Doc\n');
});

test('a document without frontmatter is all body', () => {
  const { fields, body } = parseFrontmatter('# Doc\n');
  assert.deepEqual(fields, {});
  assert.equal(body, '# Doc\n');
});

test('non-scalar frontmatter is reported, not guessed at', () => {
  const { fields, unsupported } = parseFrontmatter('---\ntitle: Doc\ntags:\n  - a\n  - b\n---\n');
  assert.deepEqual(fields, { title: 'Doc' });
  assert.equal(unsupported.length, 3, 'the key and both sequence items');
  assert.match(unsupported[0].what, /not a scalar/);
});

test('frontmatter line numbers survive into the block report', () => {
  const { unsupported } = parseMarkdown('---\ntitle: Doc\nnope\n---\n\ntext\n');
  assert.equal(unsupported[0].line, 3);
});

// ---------------------------------------------------------------- markers

test('markers parse into a name and attributes', () => {
  assert.deepEqual(parseMarker('<!-- sf:section id="impl-plan" -->'), {
    type: 'marker', name: 'section', attrs: { id: 'impl-plan' },
  });
  assert.deepEqual(parseMarker('  <!--sf:task id="1.2" status="blocked"-->  ').attrs, {
    id: '1.2', status: 'blocked',
  });
  assert.equal(parseMarker('<!-- an ordinary comment -->'), null);
});

test('an ordinary HTML comment is skipped, not rendered', () => {
  assert.deepEqual(blocks('<!-- just a note -->\n\ntext\n'), [{ type: 'paragraph', text: 'text' }]);
});

test('a multi-line HTML comment is skipped whole', () => {
  assert.deepEqual(blocks('<!--\nline one\nline two\n-->\n\ntext\n'), [{ type: 'paragraph', text: 'text' }]);
});

// ---------------------------------------------------------------- blocks

test('ATX headings, levels one to four', () => {
  assert.deepEqual(first('# One'), { type: 'heading', level: 1, text: 'One' });
  assert.deepEqual(first('#### Four'), { type: 'heading', level: 4, text: 'Four' });
});

test('a paragraph runs to the next blank line', () => {
  assert.deepEqual(first('one\ntwo\n\nthree'), { type: 'paragraph', text: 'one\ntwo' });
});

test('fenced code keeps its language and its indentation', () => {
  const b = first('```js\nif (a) {\n  b();\n}\n```');
  assert.deepEqual(b, { type: 'code', lang: 'js', body: 'if (a) {\n  b();\n}' });
});

test('a fence with no language, and a tilde fence', () => {
  assert.equal(first('```\nplain\n```').lang, '');
  assert.deepEqual(first('~~~python\nx = 1\n~~~'), { type: 'code', lang: 'python', body: 'x = 1' });
});

test('a fence containing a shorter fence is not closed early', () => {
  const b = first('````md\n```js\ncode\n```\n````');
  assert.equal(b.body, '```js\ncode\n```');
});

test('GFM tables, with escaped pipes in a cell', () => {
  const b = first('| a | b |\n| --- | --- |\n| 1 | x \\| y |\n');
  assert.deepEqual(b, { type: 'table', header: ['a', 'b'], rows: [['1', 'x | y']] });
});

test('a pipe row without a rule under it is a paragraph, not a table', () => {
  assert.equal(first('| not | a table |\nmore text').type, 'paragraph');
});

test('thematic breaks', () => {
  assert.deepEqual(first('---\n'), { type: 'hr' });
  assert.deepEqual(first('***\n'), { type: 'hr' });
});

test('blockquotes nest their own blocks', () => {
  const b = first('> **Warning.** Do not.\n>\n> - one\n> - two\n');
  assert.equal(b.type, 'quote');
  assert.equal(b.blocks[0].type, 'paragraph');
  assert.equal(b.blocks[1].type, 'list');
  assert.equal(b.blocks[1].items.length, 2);
});

test('an image on its own line is a block', () => {
  assert.deepEqual(first('![A diagram](spec.assets/x-1.svg)'), {
    type: 'image', alt: 'A diagram', src: 'spec.assets/x-1.svg',
  });
});

test('a raw HTML block is kept whole', () => {
  const b = first('<div class="panel">\n  <p>hi</p>\n</div>\n');
  assert.equal(b.type, 'html');
  assert.match(b.raw, /<div class="panel">[\s\S]*<\/div>/);
});

// ---------------------------------------------------------------- lists

test('bullet and ordered lists', () => {
  assert.deepEqual(first('- a\n- b').items.map((i) => i.text), ['a', 'b']);
  const ol = first('1. a\n2. b');
  assert.equal(ol.ordered, true);
  assert.deepEqual(ol.items.map((i) => i.text), ['a', 'b']);
});

test('nesting by two spaces, to three levels', () => {
  const list = first('- one\n  - two\n    - three\n- four');
  assert.equal(list.items.length, 2);
  const second = list.items[0].blocks.find((b) => b.type === 'list');
  assert.equal(second.items[0].text, 'two');
  const third = second.items[0].blocks.find((b) => b.type === 'list');
  assert.equal(third.items[0].text, 'three');
  assert.equal(list.items[1].text, 'four');
});

test('task list checkboxes become the item status', () => {
  const list = first('- [x] done thing\n- [ ] todo thing\n- plain thing');
  assert.deepEqual(list.items.map((i) => i.checked), [true, false, null]);
  assert.deepEqual(list.items.map((i) => i.text), ['done thing', 'todo thing', 'plain thing']);
});

test('a marker at the end of an item line belongs to the item, not its text', () => {
  const list = first('- [ ] Q3 dropped one <!-- sf:q state="dropped" -->');
  assert.equal(list.items[0].text, 'Q3 dropped one', 'the marker is not left in the prose');
  assert.deepEqual(list.items[0].blocks[0], { type: 'marker', name: 'q', attrs: { state: 'dropped' } });
});

test('an indented continuation line belongs to its item', () => {
  const list = first('- [x] 1.1 Do the thing\n      verify: it is done\n- [ ] 1.2 Next');
  assert.equal(list.items.length, 2);
  assert.deepEqual(list.items[0].blocks[0], { type: 'paragraph', text: 'verify: it is done' });
});

test('a marker on a continuation line is parsed as a marker', () => {
  const list = first('- [ ] 1.2 Stream it\n      <!-- sf:task id="1.2" status="in_progress" -->\n      verify: bytes match');
  const marker = list.items[0].blocks.find((b) => b.type === 'marker');
  assert.deepEqual(marker.attrs, { id: '1.2', status: 'in_progress' });
  assert.ok(list.items[0].blocks.some((b) => b.type === 'paragraph' && /verify/.test(b.text)));
});

// ---------------------------------------------------------------- unsupported

test('setext headings are reported', () => {
  const { unsupported } = parseMarkdown('Title\n=====\n');
  assert.match(unsupported[0].what, /setext heading/);
});

test('footnote and reference-link definitions are reported and kept as text', () => {
  const md = '[^1]: a footnote\n\n[ref]: https://example.com\n';
  const { unsupported, blocks: b } = parseMarkdown(md);
  assert.equal(unsupported.length, 2);
  assert.match(unsupported[0].what, /footnote/);
  assert.match(unsupported[1].what, /reference-style link/);
  assert.equal(b.filter((x) => x.type === 'paragraph').length, 2, 'nothing was dropped');
});

test('an unsupported construct reports the line it was on', () => {
  const { unsupported } = parseMarkdown('# Doc\n\ntext\n\n[^1]: note\n');
  assert.equal(unsupported[0].line, 5);
});

// ---------------------------------------------------------------- inline

test('inline: bold, emphasis, code, links, images', () => {
  assert.equal(inlineToHtml('**a**'), '<strong>a</strong>');
  assert.equal(inlineToHtml('*a*'), '<em>a</em>');
  assert.equal(inlineToHtml('`a`'), '<code>a</code>');
  assert.equal(inlineToHtml('[t](https://x.y)'), '<a href="https://x.y">t</a>');
  assert.equal(inlineToHtml('![alt](a.svg)'), '<img src="a.svg" alt="alt">');
});

test('a code span is never re-parsed as emphasis or a link', () => {
  assert.equal(inlineToHtml('`a *b* c`'), '<code>a *b* c</code>');
  assert.equal(inlineToHtml('`[x](y)`'), '<code>[x](y)</code>');
});

test('a bare number in prose survives the code-span placeholder', () => {
  assert.equal(
    inlineToHtml('attempt 3 waits `900s` then 4 more'),
    'attempt 3 waits <code>900s</code> then 4 more'
  );
  assert.equal(inlineToHtml('plain 1 2 3 with no code'), 'plain 1 2 3 with no code');
});

test('angle brackets in text are escaped, not treated as markup', () => {
  assert.equal(inlineToHtml('a < b & c > d'), 'a &lt; b &amp; c &gt; d');
  assert.equal(inlineToHtml('`<section>`'), '<code>&lt;section&gt;</code>');
});

test('the exporter backslash escapes come back off', () => {
  assert.equal(inlineToHtml('a \\* b'), 'a * b');
  assert.equal(inlineToHtml('\\# not a heading'), '# not a heading');
});

test('intra-word underscores are left alone', () => {
  assert.equal(inlineToHtml('data_sf_status and event_id'), 'data_sf_status and event_id');
});
