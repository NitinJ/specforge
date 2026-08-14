// The exporter, against the fixture corpus.
//
// Two layers. Golden files pin the exact bytes, so an unintended formatting
// change shows up as a diff rather than as a surprise in someone's repository.
// The assertions above them state the contract the goldens are only an instance
// of: valid GFM, sparse markers, sidecar diagrams.
//
// Regenerate goldens deliberately, never reflexively:
//   UPDATE_GOLDENS=1 node --test test/md-export.test.mjs

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { FIXTURES, fixture } from './fixtures/md/index.mjs';
import { useTempStore } from './helpers/temp-store.mjs';
import { specToMarkdown, slug, headingSlug, plainText } from '../lib/html-to-md.mjs';
import { renderMd, exportMd, resolveOut } from '../lib/store-md.mjs';
import { createSpec } from '../lib/store.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const GOLDEN_DIR = join(HERE, 'fixtures', 'md', 'golden');
const EXPORTED_AT = '2026-08-14';

function exportFixture(f) {
  return specToMarkdown(f.html(), { id: `id-${f.name}`, type: f.type, exportedAt: EXPORTED_AT });
}

// ---------------------------------------------------------------- goldens

test('every fixture matches its golden markdown', () => {
  if (!existsSync(GOLDEN_DIR)) mkdirSync(GOLDEN_DIR, { recursive: true });
  for (const f of FIXTURES) {
    const { markdown } = exportFixture(f);
    const goldenPath = join(GOLDEN_DIR, `${f.name}.md`);
    if (process.env.UPDATE_GOLDENS === '1' || !existsSync(goldenPath)) {
      writeFileSync(goldenPath, markdown);
      continue;
    }
    assert.equal(markdown, readFileSync(goldenPath, 'utf8'), `${f.name}.md differs from its golden`);
  }
});

test('the goldens on disk are the corpus, with nothing stale left behind', () => {
  const onDisk = readdirSync(GOLDEN_DIR).filter((n) => n.endsWith('.md')).sort();
  assert.deepEqual(onDisk, FIXTURES.map((f) => `${f.name}.md`).sort());
});

// ---------------------------------------------------------------- contract

test('frontmatter carries title, type, status and provenance', () => {
  const { markdown } = exportFixture(fixture('research'));
  const fm = markdown.match(/^---\n([\s\S]*?)\n---/);
  assert.ok(fm, 'starts with a frontmatter block');
  const fields = Object.fromEntries(
    fm[1].split('\n').map((l) => {
      const i = l.indexOf(':');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')];
    })
  );
  assert.equal(fields.title, 'On-device vs server inference for pose estimation');
  assert.equal(fields.type, 'research');
  assert.equal(fields.status, 'approved', 'the lifecycle status travels with the document');
  assert.equal(fields.specforge_id, 'id-research');
  assert.equal(fields.exported_at, EXPORTED_AT);
});

test('there is exactly one H1 and one H2 per exported section', () => {
  const { markdown } = exportFixture(fixture('design'));
  const h1 = markdown.match(/^# .+$/gm) || [];
  const h2 = markdown.match(/^## .+$/gm) || [];
  assert.equal(h1.length, 1, 'one document title');
  assert.equal(h2.length, 6, 'tldr, overview, goals, design, decisions, open-questions');
});

test('the tracker is not exported: it is a rendering of the plan', () => {
  const { markdown } = exportFixture(fixture('design-impl'));
  assert.doesNotMatch(markdown, /Task tracker/i);
  assert.match(markdown, /## 5 · Implementation plan/, 'the plan itself is exported');
});

test('a section marker appears only where the heading slug does not reproduce the id', () => {
  const { markdown } = exportFixture(fixture('design'));
  // "3 · Design" → design, so no marker. "TL;DR" → tldr, so no marker either.
  assert.doesNotMatch(markdown, /<!-- sf:section id="design" -->/);
  assert.doesNotMatch(markdown, /<!-- sf:section id="tldr" -->/);
  assert.doesNotMatch(markdown, /<!-- sf:section id="overview" -->/);

  // "2 · Request flow" → request-flow, which is not the id "flow": marker needed.
  const diagrams = exportFixture(fixture('diagrams'));
  assert.match(diagrams.markdown, /<!-- sf:section id="flow" -->/);
});

test('headingSlug drops the display ordinal, slug does not', () => {
  assert.equal(headingSlug('3 · Design'), 'design');
  assert.equal(headingSlug('12. Task tracker'), 'task-tracker');
  assert.equal(headingSlug('Appendix'), 'appendix');
  assert.equal(headingSlug('TL;DR'), 'tldr');
  assert.equal(slug('3 · Design'), '3-design', 'the raw slug keeps the number');
});

test('tables render as GFM with an escaped pipe and no stray escapes', () => {
  const { markdown } = exportFixture(fixture('design'));
  assert.match(markdown, /^\| Attempt \| Nominal delay \| Cumulative \|$/m);
  assert.match(markdown, /^\| --- \| --- \| --- \|$/m);
  // A cell opens no block, so a leading # is not escaped into visible noise.
  assert.match(markdown, /^\| # \| Decision \| Choice \| Rationale \|$/m);
});

test('code fences carry the language and the code verbatim', () => {
  const { markdown } = exportFixture(fixture('design'));
  assert.match(markdown, /```js\nasync function deliver\(event, attempt = 1\) \{/);
  assert.match(markdown, /\n  const res = await post\(event\.url, event\.body\);/, 'indentation survives');
  const sql = exportFixture(fixture('design-impl')).markdown;
  assert.match(sql, /```sql\nALTER TABLE jobs/);
});

test('nested lists indent by two spaces', () => {
  const { markdown } = exportFixture(fixture('design'));
  assert.match(markdown, /^- A connection error, which covers:\n  - DNS failure\n  - TLS handshake failure$/m);
});

test('callouts become blockquotes, keeping their variant in a marker', () => {
  const { markdown } = exportFixture(fixture('design'));
  assert.match(markdown, /<!-- sf:callout variant="warn" -->\n\n> The dead-letter queue/);
  assert.match(markdown, /<!-- sf:callout variant="good" -->\n\n> Replay is idempotent/);
});

test('open questions become checkboxes; only "dropped" needs a marker', () => {
  const { markdown } = exportFixture(fixture('design'));
  assert.match(markdown, /^- \[ \] \*\*Q1 · open\*\* Should the dead-letter queue/m);
  assert.match(markdown, /^- \[x\] \*\*Q2 · resolved\*\*/m);
  assert.match(markdown, /^- \[ \] \*\*Q3 · dropped\*\*.*<!-- sf:q state="dropped" -->$/m);
});

test('the plan becomes stage headings and task lists', () => {
  const { markdown } = exportFixture(fixture('design-impl'));
  assert.match(markdown, /^### Stage 0 · Job scaffolding \(PR 311\)$/m);
  assert.match(markdown, /^### Stage 1 · Worker$/m, 'no PR number when the stage has none');
  assert.match(markdown, /^- \[x\] 0\.1 Add the three `jobs` columns and the migration\.$/m);
  assert.match(markdown, /^ {6}verify: migration applies and rolls back on a scratch database$/m);
});

test('a checkbox covers done and todo; every other status carries a marker', () => {
  const { markdown } = exportFixture(fixture('design-impl'));
  assert.match(markdown, /- \[ \] 1\.2 Stream CSV to object storage\.\n\s+<!-- sf:task id="1\.2" status="in_progress" -->/);
  assert.match(markdown, /<!-- sf:task id="1\.3" status="blocked" -->/);
  assert.match(markdown, /<!-- sf:task id="1\.4" status="deferred" -->/);
  // done and todo are the checkbox itself: a marker there would be redundant.
  assert.doesNotMatch(markdown, /status="done"/);
  assert.doesNotMatch(markdown, /status="todo"/);
});

// ---------------------------------------------------------------- diagrams

test('an inline SVG leaves as a sidecar file and is referenced as an image', () => {
  const { markdown, assets, slug: name } = exportFixture(fixture('diagrams'));
  assert.equal(assets.length, 2);
  assert.deepEqual(assets.map((a) => a.name), ['architecture-1.svg', 'flow-1.svg']);
  assert.match(markdown, /!\[Collector feeds the queue, the queue feeds the writer\]\(ingest-pipeline-topology\.assets\/architecture-1\.svg\)/);
  assert.match(markdown, /<!-- sf:svg id="architecture-1" -->/);
  assert.equal(name, 'ingest-pipeline-topology');
  assert.doesNotMatch(markdown, /<svg/, 'no inline SVG survives: GitHub strips it');
});

test('a lifted SVG is a standalone document with the palette resolved', () => {
  const { assets } = exportFixture(fixture('diagrams'));
  const svg = assets[0].svg;
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<style>:root\{--bg:#fbfaf7/, 'light-theme tokens are inlined');
  assert.match(svg, /--accent:#2563eb/);
  assert.match(svg, /fill="var\(--panel\)"/, 'the markup still references tokens');
  assert.match(svg, /<\/svg>\n$/);
});

test('a figure caption becomes emphasised text under the image', () => {
  const { markdown } = exportFixture(fixture('diagrams'));
  assert.match(markdown, /\*Collector, queue, writer\. The writer is the only component this spec adds\.\*/);
});

test('diagram files are numbered within their section', () => {
  const { assets } = exportFixture(fixture('diagrams'));
  // Not architecture-1 / flow-2: adding a diagram to one section must not
  // renumber the files belonging to another.
  assert.deepEqual(assets.map((a) => a.name), ['architecture-1.svg', 'flow-1.svg']);
});

test('a section id becomes a file name, so it is reduced to a safe token', () => {
  // House ids are kebab-case, but a hand-authored spec can carry anything, and
  // the id ends up as a path inside the assets directory and inside a zip.
  const html = fixture('diagrams').html().replace('id="architecture"', 'id="../../escape"');
  const { assets, markdown } = specToMarkdown(html, { exportedAt: EXPORTED_AT });
  assert.deepEqual(assets.map((a) => a.name), ['escape-1.svg', 'flow-1.svg']);
  assert.doesNotMatch(
    markdown.match(/!\[[^\]]*\]\([^)]*\)/g).join('\n'),
    /\.\.\//,
    'no traversal survives into the image link'
  );
});

test('a spec with no diagrams produces no assets', () => {
  for (const name of ['design', 'research', 'design-impl', 'impl']) {
    assert.equal(exportFixture(fixture(name)).assets.length, 0, `${name} has no diagrams`);
  }
});

test('the corpus exports without warnings', () => {
  for (const f of FIXTURES) {
    assert.deepEqual(exportFixture(f).warnings, [], `${f.name} exports cleanly`);
  }
});

test('a table cell holding block content is flattened, and says so', () => {
  const html = fixture('design').html().replace(
    '<td>2s</td>',
    '<td><ul><li>two</li><li>seconds</li></ul></td>'
  );
  const { warnings, markdown } = specToMarkdown(html, { exportedAt: EXPORTED_AT });
  assert.match(warnings.join(' '), /table cell held block content/);
  // <br> and not a space: the two items were never one phrase (loss ledger L3).
  assert.match(markdown, /\| 1 \| two<br>seconds \| 2s \|/);
});

// ---------------------------------------------------------------- store layer

const store = useTempStore({ beforeEach, afterEach }, 'sf-mdexport-');

function seed(name, type = 'design', title = 'Seeded') {
  return createSpec({ html: fixture(name).html(), title, type });
}

test('renderMd reads the spec from the store and names the file from its title', () => {
  const id = seed('design', 'design', 'Retry Policy!');
  const out = renderMd(id, { exportedAt: EXPORTED_AT });
  assert.equal(out.slug, 'retry-policy');
  assert.match(out.markdown, /specforge_id: /);
  assert.match(out.markdown, new RegExp(`specforge_id: ${id}`));
});

test('renderMd refuses an unknown spec and a deck', () => {
  assert.throws(() => renderMd('deadbeef00'), /unknown spec deadbeef00/);
  const deckId = createSpec({ html: fixture('design').html(), title: 'Deck', type: 'deck' });
  assert.throws(() => renderMd(deckId), /slide-shaped and have no markdown form/);
});

test('exportMd writes the markdown and, only when needed, an assets directory', () => {
  const plain = seed('design');
  const a = exportMd(plain, { out: store.dir, exportedAt: EXPORTED_AT });
  assert.ok(existsSync(a.mdPath));
  assert.equal(a.assetsDir, null, 'no diagrams, no directory');
  assert.equal(a.assets, 0);

  const withSvg = createSpec({ html: fixture('diagrams').html(), title: 'Topology', type: 'design' });
  const b = exportMd(withSvg, { out: store.dir, exportedAt: EXPORTED_AT });
  assert.equal(b.assets, 2);
  assert.deepEqual(readdirSync(b.assetsDir).sort(), ['architecture-1.svg', 'flow-1.svg']);
  assert.match(readFileSync(b.mdPath, 'utf8'), /\(topology\.assets\/architecture-1\.svg\)/);
});

test('image references follow the file name when --out renames the export', () => {
  const id = createSpec({ html: fixture('diagrams').html(), title: 'Topology', type: 'design' });
  const out = join(store.dir, 'notes.md');
  const r = exportMd(id, { out, exportedAt: EXPORTED_AT });
  assert.equal(r.mdPath, out);
  assert.equal(r.assetsDir, join(store.dir, 'notes.assets'));
  const md = readFileSync(out, 'utf8');
  assert.match(md, /\(notes\.assets\/architecture-1\.svg\)/);
  assert.doesNotMatch(md, /topology\.assets/, 'no link left pointing at the old name');
});

test('--zip writes one archive instead of a file and a folder', () => {
  const id = createSpec({ html: fixture('diagrams').html(), title: 'Topology', type: 'design' });
  const r = exportMd(id, { out: store.dir, exportedAt: EXPORTED_AT, zip: true });

  assert.equal(r.mdPath, null, 'nothing loose is written');
  assert.equal(r.assetsDir, null);
  assert.match(r.zipPath, /topology\.zip$/);
  assert.deepEqual(readdirSync(store.dir).filter((f) => f !== 'specs'), ['topology.zip']);

  const buf = readFileSync(r.zipPath);
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  assert.ok(buf.includes(Buffer.from('topology.md')));
  assert.ok(buf.includes(Buffer.from('topology.assets/architecture-1.svg')));
});

test('--zip on a spec with no diagrams is still one archive holding the .md', () => {
  const id = createSpec({ html: fixture('design').html(), title: 'Retry policy', type: 'design' });
  const r = exportMd(id, { out: store.dir, exportedAt: EXPORTED_AT, zip: true });
  assert.match(r.zipPath, /retry-policy\.zip$/);
  assert.equal(r.assets, 0);
  assert.ok(readFileSync(r.zipPath).includes(Buffer.from('retry-policy.md')));
});

test('resolveOut treats a .md path as the file and anything else as a directory', () => {
  assert.equal(resolveOut('/tmp/x/notes.md', 'spec'), '/tmp/x/notes.md');
  assert.equal(resolveOut('/tmp/x', 'spec'), '/tmp/x/spec.md');
  assert.equal(resolveOut('', 'spec'), resolve(process.cwd(), 'spec.md'));
});

test('plainText is exported for callers that need the heading text', () => {
  assert.equal(plainText('<h2>3 · <span>Design</span></h2>'), '3 · Design');
});
