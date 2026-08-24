// The importer: markdown in, a lint-passing spec out, deterministically.
//
// The contract this suite defends is that a foreign document arrives whole. Its
// headings become sections, its content is not silently dropped, and anything
// the parser could not read is named in the report rather than lost.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { useTempStore } from './helpers/temp-store.mjs';
import { markdownToSpecHtml, slugify, sanitizeHtml } from '../lib/md-to-html.mjs';
import { inlineToHtml, isSafeUrl } from '../lib/md-parse.mjs';
import { importMd, assetResolver } from '../lib/store-md.mjs';
import { ensureTemplates } from '../lib/store-templates.mjs';
import { lintSpec } from '../lib/lint-spec.mjs';
import { readMeta, DEFAULT_TYPE } from '../lib/meta.mjs';
import { getSectionIds, sectionBody, parsePlan, getTitle, getStatus } from '../lib/spec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = readFileSync(join(ROOT, 'templates', 'spec-base-general.html'), 'utf8');

const convert = (md, opts = {}) => markdownToSpecHtml(md, { shell: SHELL, date: '2026-08-14', owner: 'nitin', ...opts });

const store = useTempStore({ beforeEach, afterEach }, 'sf-mdimport-');

function writeMd(name, body) {
  const path = join(store.dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body);
  return path;
}

// ---------------------------------------------------------------- sections

test('every ## becomes a section, in document order', () => {
  const { html } = convert('# Doc\n\n## First\n\ntext\n\n## Second\n\nmore\n');
  assert.deepEqual(getSectionIds(html), ['first', 'second']);
});

test('an id marker under a heading names that section, not the next one', () => {
  const md = '# Doc\n\n## 1 · Overview\n\na\n\n## 11 · Implementation plan\n<!-- sf:section id="impl-plan" -->\n\nb\n';
  // task-tracker is appended by the importer, not read from the markdown: a
  // section named impl-plan is what asks for it.
  assert.deepEqual(getSectionIds(convert(md).html), ['overview', 'impl-plan', 'task-tracker']);
});

test('the display ordinal is not part of the slug', () => {
  assert.equal(slugify('3 · Design'), 'design');
  assert.equal(slugify('12. Task tracker'), 'task-tracker');
  assert.equal(slugify('Goals & non-goals'), 'goals-non-goals');
});

test('a marker cannot set an id that is not a valid anchor', () => {
  // An id is what the TOC links to and what comments hang off. One with slashes
  // or spaces breaks its own link, and nothing downstream should have to wonder
  // whether an id is also a path.
  const md = '# Doc\n\n## One\n<!-- sf:section id="../../escape" -->\n\na\n\n## Two\n<!-- sf:section id="has spaces" -->\n\nb\n';
  assert.deepEqual(getSectionIds(convert(md).html), ['escape', 'has-spaces']);
});

test('duplicate headings get suffixed ids so the lint stays green', () => {
  const { html } = convert('# Doc\n\n## Notes\n\na\n\n## Notes\n\nb\n\n## Notes\n\nc\n');
  assert.deepEqual(getSectionIds(html), ['notes', 'notes-2', 'notes-3']);
  assert.ok(lintSpec(html).ok);
});

test('content before the first ## is kept as the tldr section', () => {
  const { html } = convert('# Doc\n\nA lead paragraph nobody wrote a heading for.\n\n## First\n\ntext\n');
  assert.deepEqual(getSectionIds(html), ['tldr', 'first']);
  assert.match(sectionBody(html, 'tldr'), /A lead paragraph nobody wrote a heading for\./);
});

test('every section carries data-sf-section, which comments anchor to', () => {
  const { html } = convert('# Doc\n\n## One\n\na\n\n## Two\n\nb\n');
  const sections = html.match(/<section\b[^>]*>/g) || [];
  assert.equal(sections.length, 2);
  for (const s of sections) assert.match(s, /data-sf-section/);
});

test('the TOC is rebuilt from the sections that were imported', () => {
  const { html } = convert('# Doc\n\n## Alpha\n\na\n\n## Beta\n\nb\n');
  const toc = html.match(/<nav class="toc">[\s\S]*?<\/nav>/)[0];
  assert.deepEqual([...toc.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]), ['alpha', 'beta']);
  assert.match(toc, />Alpha</);
  assert.doesNotMatch(toc, /TL;DR/, 'no link left over from the shell');
});

// ---------------------------------------------------------------- content

test('block content converts to house markup', () => {
  const md = [
    '# Doc', '', '## Body', '',
    'A paragraph with **bold**, *em*, `code` and a [link](https://x.y).', '',
    '- one', '  - nested', '- two', '',
    '1. first', '2. second', '',
    '| a | b |', '| --- | --- |', '| 1 | 2 |', '',
    '```js', 'const x = 1;', '```', '',
  ].join('\n');
  const body = sectionBody(convert(md).html, 'body');
  assert.match(body, /<strong>bold<\/strong>/);
  assert.match(body, /<em>em<\/em>/);
  assert.match(body, /<code>code<\/code>/);
  assert.match(body, /<a href="https:\/\/x\.y">link<\/a>/);
  assert.match(body, /<ul><li>one<ul><li>nested<\/li><\/ul><\/li><li>two<\/li><\/ul>/);
  assert.match(body, /<ol><li>first<\/li><li>second<\/li><\/ol>/);
  assert.match(body, /<table><thead><tr><th>a<\/th><th>b<\/th><\/tr><\/thead>/);
  assert.match(body, /<pre><code class="lang-js">const x = 1;<\/code><\/pre>/);
});

test('a blockquote with a callout marker becomes a house callout', () => {
  const md = '# Doc\n\n## Body\n\n<!-- sf:callout variant="warn" -->\n\n> Careful.\n';
  assert.match(sectionBody(convert(md).html, 'body'), /<div class="callout warn"><p>Careful\.<\/p><\/div>/);
});

test('a box marker wraps the block that follows it', () => {
  const md = '# Doc\n\n## Body\n\n<!-- sf:box class="panel" -->\n\nInside the panel.\n';
  assert.match(sectionBody(convert(md).html, 'body'), /<div class="panel"><p>Inside the panel\.<\/p><\/div>/);
});

test('open-question checkboxes come back as data-sf-q states', () => {
  const md = [
    '# Doc', '', '## Open questions', '',
    '- [ ] Q1 still open', '- [x] Q2 settled',
    '- [ ] Q3 abandoned <!-- sf:q state="dropped" -->', '',
  ].join('\n');
  const body = sectionBody(convert(md).html, 'open-questions');
  assert.match(body, /<li data-sf-q="open">Q1 still open<\/li>/);
  assert.match(body, /<li data-sf-q="resolved">Q2 settled<\/li>/);
  assert.match(body, /<li data-sf-q="dropped">Q3 abandoned<\/li>/);
  assert.doesNotMatch(body, /sf:q/, 'the marker does not survive as visible text');
});

// ---------------------------------------------------------------- the plan

const PLAN_MD = [
  '# Doc', '', '## Implementation plan', '<!-- sf:section id="impl-plan" -->', '',
  '### Stage 0 · Setup (PR 311)', '',
  '- [x] 0.1 Do the first thing',
  '      verify: it is done', '',
  '### Stage 1 · Build', '',
  '- [x] 1.1 Finished',
  '- [ ] 1.2 Running',
  '      <!-- sf:task id="1.2" status="in_progress" -->',
  '      verify: bytes match',
  '- [ ] 1.3 Waiting',
  '      <!-- sf:task id="1.3" status="blocked" -->', '',
  '**Verifiable output:** a thing an agent can check', '',
].join('\n');

test('stages and tasks rebuild into the data-sf markup the tracker reads', () => {
  const { html } = convert(PLAN_MD);
  const plan = parsePlan(html);
  assert.equal(plan.length, 2);
  assert.equal(plan[0].stage, '0');
  assert.equal(plan[0].pr, '311');
  assert.equal(plan[1].pr, '', 'no PR number where the heading carried none');
  // Markdown carries no progress-step count, so every imported task starts the
  // bar empty rather than undefined.
  assert.deepEqual(plan[1].tasks, [
    { id: '1.1', status: 'done', steps: 0 },
    { id: '1.2', status: 'in_progress', steps: 0 },
    { id: '1.3', status: 'blocked', steps: 0 },
  ]);
});

test('a checkbox is the status, and a marker overrides it', () => {
  const plan = parsePlan(convert(PLAN_MD).html);
  assert.equal(plan[0].tasks[0].status, 'done', 'checked with no marker');
  assert.equal(plan[1].tasks[1].status, 'in_progress', 'unchecked, marker wins');
});

test('a verify note becomes the verify span', () => {
  const body = sectionBody(convert(PLAN_MD).html, 'impl-plan');
  assert.match(body, /<span class="verify">verify: it is done<\/span>/);
  assert.doesNotMatch(body, /<p[^>]*>verify:/, 'not left as a stray paragraph');
});

test('the tracker is regenerated from the plan, never read from the markdown', () => {
  const { html } = convert(PLAN_MD);
  assert.ok(getSectionIds(html).includes('task-tracker'));
  const tracker = sectionBody(html, 'task-tracker');
  assert.match(tracker, /<table/);
  assert.match(tracker, /<th>Task<\/th>/);
  // Four tasks across the two stages, so four rows in its projection.
  assert.equal((tracker.match(/<tr>/g) || []).length, 5, 'a header row and one per task');
});

test('a plan section with no stage headings still imports', () => {
  const md = '# Doc\n\n## Implementation plan\n<!-- sf:section id="impl-plan" -->\n\nNothing planned yet.\n';
  const { html } = convert(md);
  assert.match(sectionBody(html, 'impl-plan'), /Nothing planned yet\./);
  assert.deepEqual(parsePlan(html), []);
});

// ---------------------------------------------------------------- assets

test('an SVG reference is inlined back into the spec', () => {
  const svg = '<svg viewBox="0 0 10 10" aria-label="A box"><rect width="10" height="10"/></svg>';
  const { html } = convert('# Doc\n\n## Arch\n\n![A box](d.svg)\n', {
    resolveAsset: () => ({ kind: 'svg', text: svg }),
  });
  assert.match(sectionBody(html, 'arch'), /<svg viewBox="0 0 10 10" aria-label="A box">/);
  assert.doesNotMatch(html, /<img/, 'a spec is self-contained: no external reference is left');
});

test('a raster becomes a data URI, and an oversized one is dropped with a reason', () => {
  const small = convert('# D\n\n## S\n\n![pic](a.png)\n', {
    resolveAsset: () => ({ kind: 'raster', dataUri: 'data:image/png;base64,AAA' }),
  });
  assert.match(sectionBody(small.html, 's'), /<img src="data:image\/png;base64,AAA" alt="pic">/);
  assert.deepEqual(small.report.assetsDropped, []);

  const big = convert('# D\n\n## S\n\n![pic](a.png)\n', {
    resolveAsset: () => ({ kind: 'too-large', bytes: 900000 }),
  });
  assert.equal(big.report.assetsDropped.length, 1);
  assert.match(big.report.assetsDropped[0].why, /900000 bytes exceeds/);
  assert.match(sectionBody(big.html, 's'), /\[image not inlined: a\.png\]/);
});

test('a missing asset is reported, not silently skipped', () => {
  const { report, html } = convert('# D\n\n## S\n\n![pic](nope.svg)\n', {
    resolveAsset: () => ({ kind: 'missing' }),
  });
  assert.equal(report.assetsDropped.length, 1);
  assert.match(report.assetsDropped[0].why, /not found/);
  assert.match(sectionBody(html, 's'), /\[missing image: nope\.svg\]/);
});

test('assetResolver reads next to the markdown and caps rasters', () => {
  const svgPath = join(store.dir, 'd.svg');
  writeFileSync(svgPath, '<svg/>');
  const resolve_ = assetResolver(store.dir);
  assert.deepEqual(resolve_('d.svg'), { kind: 'svg', text: '<svg/>' });
  assert.deepEqual(resolve_('gone.svg'), { kind: 'missing' });
  assert.equal(resolve_('https://x.y/a.png').kind, 'remote');

  writeFileSync(join(store.dir, 'big.png'), Buffer.alloc(600 * 1024));
  assert.equal(resolve_('big.png').kind, 'too-large');
  writeFileSync(join(store.dir, 'ok.png'), Buffer.alloc(16));
  assert.match(resolve_('ok.png').dataUri, /^data:image\/png;base64,/);
});

// ---------------------------------------------------------------- safety

test('script and event handlers are stripped from raw HTML', () => {
  const dirty = '<div onclick="steal()"><script>alert(1)</script><p>ok</p></div>';
  const clean = sanitizeHtml(dirty);
  assert.doesNotMatch(clean, /<script/);
  assert.doesNotMatch(clean, /onclick/);
  assert.match(clean, /<p>ok<\/p>/);
  assert.doesNotMatch(sanitizeHtml('<iframe src="x"></iframe>'), /iframe/);
  assert.doesNotMatch(sanitizeHtml('<a href="javascript:alert(1)">x</a>'), /javascript:/);
});

test('a script in imported markdown never reaches the served spec', () => {
  const { html } = convert('# Doc\n\n## Body\n\n<div><script>alert(1)</script></div>\n');
  assert.doesNotMatch(sectionBody(html, 'body') || '', /<script/);
});

test('a javascript: URL is neutralised however it is quoted or escaped', () => {
  // The daemon serves what is stored with no second sanitization pass, so each
  // of these executes if it survives. They are the standard evasions, not
  // hypotheticals: single quotes, no quotes, entity-encoded characters, an
  // entity-encoded colon, an embedded tab, and mixed case.
  const vectors = [
    `<a href='javascript:alert(1)'>x</a>`,
    '<a href=javascript:alert(1)>x</a>',
    '<a href="java&#x73;cript:alert(1)">x</a>',
    '<a href="javascript&colon;alert(1)">x</a>',
    '<a href="java\tscript:alert(1)">x</a>',
    '<a href="JaVaScRiPt:alert(1)">x</a>',
    '<a href="vbscript:msgbox(1)">x</a>',
    '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>',
    '<img src="data:image/svg+xml;base64,PHN2Zz4=">',
    '<img src="javascript:alert(1)">',
    '<a formaction="javascript:alert(1)">x</a>',
  ];
  for (const v of vectors) {
    const clean = sanitizeHtml(v);
    assert.doesNotMatch(clean, /javascript|vbscript|data:text\/html|svg\+xml/i, `not neutralised: ${v}`);
    // The URL is either replaced with '#' (the attribute is one specs use) or the
    // attribute is gone entirely (it is not on the allow-list). Both are fine;
    // what matters is that nothing navigable to a script is left.
    assert.doesNotMatch(clean, /=\s*["']?\s*\w+script/i, `a scheme survived: ${v}`);
  }
});

test('safe URLs are left exactly as they were', () => {
  for (const v of [
    '<a href="https://example.com/x?a=1&amp;b=2">x</a>',
    '<a href="/relative/path">x</a>',
    '<a href="#anchor">x</a>',
    '<a href="mailto:a@b.c">x</a>',
    '<img src="data:image/png;base64,AAA" alt="a">',
    '<use xlink:href="#gradient"></use>',
  ]) {
    assert.equal(sanitizeHtml(v), v, `rewritten when it should not be: ${v}`);
  }
});

test('srcdoc and framing elements do not survive', () => {
  assert.doesNotMatch(sanitizeHtml('<iframe srcdoc="<script>alert(1)</script>"></iframe>'), /srcdoc|iframe/i);
  assert.doesNotMatch(sanitizeHtml('<base href="https://evil.test/">'), /<base/i);
  assert.doesNotMatch(sanitizeHtml('<meta http-equiv="refresh" content="0;url=x">'), /<meta/i);
});

test('a markdown link cannot smuggle an executable scheme past the sanitizer', () => {
  // sanitizeHtml only sees raw HTML blocks. `[x](javascript:…)` is ordinary
  // markdown, rendered straight into an <a> by the inline renderer, so the
  // check has to live there too.
  const md = [
    '# Doc', '', '## Body', '',
    '[click](javascript:alert(1))', '',
    '[ok](https://example.com)', '',
    '![shot](javascript:alert(2))', '',
    '[enc](java&#x73;cript:alert(3))', '',
  ].join('\n');
  const { html, report } = convert(md);
  const body = sectionBody(html, 'body');
  assert.doesNotMatch(body, /javascript/i, 'no executable URL survived, not even as echoed text');
  assert.match(body, /<a href="#">click<\/a>/);
  assert.match(body, /\[image refused: unsupported URL scheme\]/, 'and the payload is not repeated back');
  assert.match(body, /<a href="https:\/\/example\.com">ok<\/a>/, 'a real link is untouched');
  assert.ok(
    report.assetsDropped.some((a) => /scheme that is not allowed/.test(a.why)),
    'the refusal is reported rather than silent'
  );
});

test('inlineToHtml is where that guard lives, so it holds for every caller', () => {
  assert.equal(inlineToHtml('[x](javascript:alert(1))'), '<a href="#">x</a>');
  assert.equal(inlineToHtml('[x](javascript:void)'), '<a href="#">x</a>');
  assert.equal(inlineToHtml('[x](/safe/path)'), '<a href="/safe/path">x</a>');
  assert.equal(isSafeUrl('data:image/png;base64,AAA'), true);
  assert.equal(isSafeUrl('data:image/svg+xml;base64,AAA'), false);
  assert.equal(isSafeUrl('vbscript:x'), false);
});

test('a symlink out of the directory is not a way around containment', () => {
  const docs = join(store.dir, 'docs');
  mkdirSync(docs, { recursive: true });
  writeFileSync(join(store.dir, 'secret.svg'), '<svg>private</svg>');
  // A symlink INSIDE the directory pointing outside it: lexically contained,
  // and resolve() alone would have accepted it.
  symlinkSync(join(store.dir, 'secret.svg'), join(docs, 'link.svg'));

  const resolve_ = assetResolver(docs);
  assert.equal(resolve_('link.svg').kind, 'outside', 'the real path is what counts');
});

test('an asset path may not escape the directory the markdown came from', () => {
  const resolve_ = assetResolver(join(store.dir, 'docs'));
  mkdirSync(join(store.dir, 'docs'), { recursive: true });
  writeFileSync(join(store.dir, 'secret.svg'), '<svg>private</svg>');

  assert.equal(resolve_('../secret.svg').kind, 'outside', 'traversal is refused');
  assert.equal(resolve_('/etc/hostname').kind, 'outside', 'an absolute path is refused');
  assert.equal(resolve_('sub/../../secret.svg').kind, 'outside', 'and so is a laundered one');

  writeFileSync(join(store.dir, 'docs', 'ok.svg'), '<svg/>');
  assert.equal(resolve_('ok.svg').kind, 'svg', 'a sibling file is still read');
});

test('an escaping asset path is reported, and its content never lands in the spec', () => {
  const { html, report } = convert('# D\n\n## S\n\n![p](../secret.svg)\n', {
    resolveAsset: () => ({ kind: 'outside', src: '../secret.svg' }),
  });
  assert.equal(report.assetsDropped.length, 1);
  assert.match(report.assetsDropped[0].why, /outside the directory/);
  assert.doesNotMatch(html, /private/);
});

// ---------------------------------------------------------------- the store

test('importMd creates a new spec, attaches nothing over an existing one', () => {
  ensureTemplates();
  const path = writeMd('notes.md', '---\ntitle: Notes\n---\n\n# Notes\n\n## One\n\ntext\n');
  const a = importMd(path);
  const b = importMd(path);
  assert.notEqual(a.id, b.id, 'the same file twice is two specs, never an overwrite');
  assert.equal(readMeta(a.id).title, 'Notes');
  assert.equal(readMeta(a.id).origin, path, 'the source path is recorded');
  assert.equal(a.report.lint, 'PASS');
});

test('the type comes from the flag, then frontmatter, then general', () => {
  ensureTemplates();
  const plain = writeMd('plain.md', '# Doc\n\n## One\n\na\n');
  assert.equal(importMd(plain).type, DEFAULT_TYPE);
  assert.equal(importMd(plain).type, 'general');

  const typed = writeMd('typed.md', '---\ntype: research\n---\n\n# Doc\n\n## One\n\na\n');
  assert.equal(importMd(typed).type, 'research');
  assert.equal(importMd(typed, { type: 'design' }).type, 'design', 'the flag wins');
  assert.throws(() => importMd(typed, { type: 'nope' }), /invalid type "nope"/);
});

test('a specforge_id in frontmatter is provenance, never a write target', () => {
  ensureTemplates();
  const path = writeMd('exported.md', '---\ntitle: Round trip\nspecforge_id: deadbeef00\n---\n\n# Round trip\n\n## One\n\na\n');
  const r = importMd(path);
  assert.notEqual(r.id, 'deadbeef00');
  assert.equal(readMeta(r.id).derivedFrom, 'deadbeef00');
  assert.equal(r.report.derivedFrom, 'deadbeef00');
  assert.equal(readMeta('deadbeef00'), null, 'the spec it came from was not created or touched');
});

test('the report names what the parser could not read', () => {
  ensureTemplates();
  const path = writeMd('odd.md', '# Doc\n\n## One\n\ntext\n\n[^1]: a footnote\n');
  const r = importMd(path);
  assert.equal(r.report.lint, 'PASS', 'an unreadable construct does not stop the import');
  assert.equal(r.report.unsupported.length, 1);
  assert.match(r.report.unsupported[0].what, /footnote/);
  assert.equal(r.report.sections, 1);
});

test('the imported spec carries its title and status through the shell', () => {
  ensureTemplates();
  const path = writeMd('s.md', '---\ntitle: Approved thing\nstatus: approved\n---\n\n# Approved thing\n\n## One\n\na\n');
  const r = importMd(path);
  const html = readFileSync(r.htmlPath, 'utf8');
  assert.equal(getTitle(html), 'Approved thing');
  assert.equal(getStatus(html), 'approved');
  assert.match(html, /<h1>Approved thing<\/h1>/);
  assert.equal(r.status, 'approved');
});

test('a status other than approved is a draft, whatever the file claimed', () => {
  ensureTemplates();
  const path = writeMd('w.md', '---\nstatus: shipped\n---\n\n# W\n\n## One\n\na\n');
  assert.equal(importMd(path).status, 'draft');
});

test('importMd fails before touching the store when the file is missing', () => {
  ensureTemplates();
  assert.throws(() => importMd(join(store.dir, 'nope.md')), /ENOENT/);
});
