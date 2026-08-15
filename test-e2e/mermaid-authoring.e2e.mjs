// The journey an authoring agent actually takes.
//
// Everything else tests a mechanism. This tests the claim the guidance makes: a
// diagram written the way references/spec-components.md says to write it lints
// clean, renders, and is one comment target. If that were ever untrue, every
// other test here could still pass and the feature would be unusable.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { withSpec, needsChrome } from './harness.mjs';
import { lintSpec } from '../lib/lint-spec.mjs';
import { COMPONENTS } from '../components/index.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A spec written from the shell, with the diagram taken VERBATIM from the
 * component library's own example. If the example is wrong, this fails.
 */
function authoredSpec() {
  const example = COMPONENTS.find((c) => c.name === 'mermaid').example;
  const shell = readFileSync(join(ROOT, 'templates', 'spec-base-doc.html'), 'utf8')
    .replaceAll('{{TITLE}}', 'Ingest topology')
    .replaceAll('{{DATE}}', '2026-08-15')
    .replaceAll('{{STATUS}}', 'draft')
    .replaceAll('{{OWNER}}', 'agent');
  return {
    example,
    html: shell.replace(
      '<section id="overview" data-sf-section>',
      `<section id="overview" data-sf-section>\n${example}`,
    ),
  };
}

test('the library example is what an author is told to write, and it lints clean', () => {
  const { example, html } = authoredSpec();
  assert.match(example, /<pre data-lang="mermaid">/, 'the example is the documented shape');

  const report = lintSpec(html, { project: ROOT });
  const failed = report.checks.filter((c) => c.status === 'fail');
  assert.deepEqual(failed.map((c) => `${c.name}: ${c.detail}`), [],
    'a spec carrying the documented diagram passes the lint');
});

test('the components lint does not report a diagram as an unknown class', () => {
  // The entry is element-kind with a selector, so it adds no class. If it had
  // been a class-kind entry, every spec carrying a diagram would have needed the
  // library version bumped to stop the lint complaining.
  const { html } = authoredSpec();
  const opted = html.replace('<html ', '<html data-sf-components="1" ');
  const report = lintSpec(opted, { project: ROOT });
  const components = report.checks.find((c) => c.name === 'spec-components');
  assert.ok(components, 'the components check ran');
  assert.doesNotMatch(String(components.detail || ''), /mermaid/,
    'a diagram is never reported as drift');
});

test('the authored spec renders, and is one comment target', needsChrome, async () => {
  const { html } = authoredSpec();
  await withSpec({ html, title: 'Ingest topology' }, async ({ page }) => {
    await page.waitForSelector('pre[data-sf-mermaid="rendered"]', { timeout: 30000 });

    const facts = await page.evaluate(() => {
      const pre = document.querySelector('pre[data-sf-mermaid]');
      return {
        nodes: pre.querySelectorAll('g.node').length,
        // Every <p> mermaid renders inside the picture would otherwise be its
        // own commentable block.
        parasInside: pre.querySelectorAll('p').length,
      };
    });
    assert.equal(facts.nodes, 4, 'the documented example draws what it says it draws');
    assert.ok(facts.parasInside > 0, 'and it really does contain <p> elements');

    // Clicking a label opens a composer quoting the diagram, not the paragraph.
    await page.locator('pre[data-sf-mermaid] .nodeLabel').first().click();
    await page.waitForSelector('.sf-bub-compose', { timeout: 10000 });
    const quoted = await page.locator('.sf-bub-compose .q').innerText();
    assert.match(quoted, /collector/, 'the composer quotes the diagram');
    assert.doesNotMatch(quoted, /font-family/, 'and not the stylesheet mermaid injected');
  });
});
