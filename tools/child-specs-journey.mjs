#!/usr/bin/env node
// Stand up the child-specs testing journeys against a throwaway store.
//
// Section 15 of the spec describes two journeys a human walks once. This does
// the setup and prints the URLs, so the only thing left is looking at the
// screen.
//
// It starts its OWN daemon on an ephemeral port against a temp store. Not the
// one on 4180: that one serves the real store at ~/.specforge, and a journey
// that seeds fixtures into somebody's actual specs is not a journey, it is a
// mess to clean up afterwards.
//
//   node tools/child-specs-journey.mjs
//
// Ctrl-C when done; the store is removed on the way out.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const store = mkdtempSync(join(tmpdir(), 'sf-journey-'));
process.env.SPECFORGE_HOME = store;

const { createSpec, writeSpecHtml } = await import('../lib/store.mjs');
const { createDaemon } = await import('../server/daemon.mjs');

/** A spec with the things the journey has to see render: a diagram and code. */
function doc(title, extra = '') {
  return `<!DOCTYPE html><html><head><title>${title}</title>
<style>
  :root { --bg:#12141a; --panel:#1a1d25; --ink:#e6e8ee; --muted:#9aa1b1; --line:#2a2f3a; --accent:#6ea8fe; }
  body { background: var(--bg); color: var(--ink); font: 15px/1.6 system-ui, sans-serif; margin: 0 auto; padding: 32px; max-width: 860px; }
  code, pre { background: #0d0f14; border-radius: 6px; }
  pre { padding: 12px; overflow: auto; }
</style></head>
<body><h1>${title}</h1>
<section id="tldr"><h2>TL;DR</h2><p>${title} exists so the journey has something to look at.</p></section>
<section id="design"><h2>Design</h2>
<pre data-lang="mermaid"><code>flowchart LR
  A[parent] --&gt; B[child]
  B --&gt; C[grandchild]</code></pre>
<pre data-lang="javascript"><code>const parent = readMeta(id).parent;
if (parent) console.log('a child spec');</code></pre>
${extra}
</section>
</body></html>`;
}

const root = createSpec({ title: 'Journey parent', type: 'design', html: doc('Journey parent') });
const kid = createSpec({
  title: 'Journey child: code grounding',
  type: 'research',
  parent: root,
  html: doc('Journey child: code grounding'),
});
const kid2 = createSpec({
  title: 'Journey child: testing',
  type: 'test-plan',
  parent: root,
  html: doc('Journey child: testing'),
});
const grand = createSpec({
  title: 'Journey grandchild',
  type: 'general',
  parent: kid2,
  html: doc('Journey grandchild'),
});
void writeSpecHtml;

const server = createDaemon();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

console.log(`
Store:  ${store}
Daemon: ${base}   (its own, not the one on 4180)

  index          ${base}/
  parent         ${base}/spec/${root}
  child          ${base}/spec/${kid}
  child (embed)  ${base}/spec/${kid}?embed=1
  flat (print)   ${base}/spec/${root}?flat=1
  markdown zip   ${base}/api/spec/${root}/md

Journey 1, from the spec:
  open the parent, then Child specs in the menu, then a row. The panel should
  render the diagram and the highlighted code, with no menu, rail or contents
  of its own. Open in new tab should give you the full page.

Journey 2:
  delete the parent from the index. The confirmation should say three child
  specs go with it, and Undo should bring all four rows back, indented.

ids: root=${root} children=${kid},${kid2} grandchild=${grand}

Ctrl-C to stop and remove the store.
`);

const bye = () => {
  server.close();
  rmSync(store, { recursive: true, force: true });
  process.exit(0);
};
process.on('SIGINT', bye);
process.on('SIGTERM', bye);
