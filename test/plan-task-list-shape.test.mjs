// The plan's task list, in both list shapes.
//
// The impl template now writes tasks as a numbered `<ol class="sf-tasks">` with
// each verify note as a nested list item. Every plan authored before that is a
// `<ul>` with a trailing `<span class="verify">`. The markdown exporter read only
// the second shape, so a spec from the new template exported with its plan
// silently reduced to prose. Both shapes are read; one is written.
//
// Asked for on template-impl, thread th_1d6cf1d9c1.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

import { specToMarkdown } from '../lib/html-to-md.mjs';
import { markdownToSpecHtml } from '../lib/md-to-html.mjs';
import { parsePlan, sectionBody } from '../lib/spec.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = readFileSync(join(ROOT, 'templates', 'spec-base-general.html'), 'utf8');

/** A one-stage spec whose task list is written in the given shape. */
function spec(tasks) {
  return `<!DOCTYPE html><html><head><title>P — Spec</title></head><body><main>
  <h1>P</h1>
  <p class="sub">status: <span class="tag accent">draft</span></p>
  <section id="impl-plan" data-sf-section>
    <h2>1 · Implementation plan</h2>
    <ol class="sf-stages">
      <li data-sf-stage="1" data-sf-pr="311">
        <div class="sh"><h3>Stage 1 — Build</h3></div>
        ${tasks}
      </li>
    </ol>
  </section>
  </main></body></html>`;
}

const OLD_SHAPE = `<ul class="sf-tasks">
  <li data-sf-task="1.1" data-sf-status="done">Write it.<span class="verify">verify: it runs</span></li>
  <li data-sf-task="1.2" data-sf-status="in_progress">Ship it.<span class="verify">verify: it is live</span></li>
</ul>`;

const NEW_SHAPE = `<ol class="sf-tasks">
  <li data-sf-task="1.1" data-sf-status="done">Write it.
    <ul><li class="verify">verify: it runs</li></ul>
  </li>
  <li data-sf-task="1.2" data-sf-status="in_progress">Ship it.
    <ul><li class="verify">verify: it is live</li></ul>
  </li>
</ol>`;

const md = (html) => specToMarkdown(html, { id: 'abc1234567', type: 'impl', exportedAt: '2026-08-14' }).markdown;

// --- export -----------------------------------------------------------------

test('both shapes export the same task lines', () => {
  // The whole point: the list tag and where the note sits are presentation, and
  // the markdown carries neither.
  const fromOld = md(spec(OLD_SHAPE));
  const fromNew = md(spec(NEW_SHAPE));
  assert.equal(fromNew, fromOld);
});

test('a numbered list exports its tasks, not a paragraph of prose', () => {
  const out = md(spec(NEW_SHAPE));
  assert.match(out, /- \[x\] 1\.1 Write it\./);
  assert.match(out, /- \[ \] 1\.2 Ship it\./);
  assert.match(out, /<!-- sf:task id="1\.2" status="in_progress" -->/);
});

test('a nested verify note exports as the task\'s verify line', () => {
  const out = md(spec(NEW_SHAPE));
  assert.match(out, /verify: it runs/);
  assert.match(out, /verify: it is live/);
});

test('the verify note is not left inside the task text', () => {
  // The failure this guards: the note is a child element, so an exporter that
  // strips only a `span.verify` folds it into the task line and the task reads
  // "Write it. verify: it runs".
  const out = md(spec(NEW_SHAPE));
  assert.match(out, /- \[x\] 1\.1 Write it\.\n/);
});

// --- import -----------------------------------------------------------------

test('import writes the numbered shape with the note as a sub-item', () => {
  const source = ['# P', '', '## Implementation plan', '<!-- sf:section id="impl-plan" -->', '',
    '### Stage 1 · Build (PR 311)', '', '- [x] 1.1 Write it', '      verify: it runs', ''].join('\n');
  const { html } = markdownToSpecHtml(source, { shell: SHELL, date: '2026-08-14', owner: 'nitin' });
  const plan = sectionBody(html, 'impl-plan');
  assert.match(plan, /<ol class="sf-tasks">/);
  assert.match(plan, /<ul><li class="verify">verify: it runs<\/li><\/ul>/);
  assert.doesNotMatch(plan, /<span class="verify">/);
});

test('what import writes is what the plan parser reads', () => {
  const source = ['# P', '', '## Implementation plan', '<!-- sf:section id="impl-plan" -->', '',
    '### Stage 1 · Build', '', '- [x] 1.1 Write it', '      verify: it runs',
    '- [ ] 1.2 Ship it', ''].join('\n');
  const { html } = markdownToSpecHtml(source, { shell: SHELL, date: '2026-08-14', owner: 'nitin' });
  const [stage] = parsePlan(html);
  assert.deepEqual(stage.tasks.map((t) => `${t.id}:${t.status}`), ['1.1:done', '1.2:todo']);
});

test('a task with no verify note gets no empty sub-list', () => {
  const source = ['# P', '', '## Implementation plan', '<!-- sf:section id="impl-plan" -->', '',
    '### Stage 1 · Build', '', '- [ ] 1.1 Write it', ''].join('\n');
  const { html } = markdownToSpecHtml(source, { shell: SHELL, date: '2026-08-14', owner: 'nitin' });
  assert.doesNotMatch(sectionBody(html, 'impl-plan'), /<ul><\/ul>/);
});

// --- the shipped template ---------------------------------------------------

test('the impl template\'s own plan exports intact', () => {
  // The template is the shape every new impl spec starts from, so it is the one
  // fixture that has to survive whatever the template does next.
  const shell = readFileSync(join(ROOT, 'templates', 'spec-base.html'), 'utf8');
  const out = specToMarkdown(shell, { id: 'abc1234567', type: 'impl', exportedAt: '2026-08-14' }).markdown;
  assert.match(out, /- \[ \] 1\.1 /);
  assert.match(out, /- \[ \] 1\.2 /);
});
