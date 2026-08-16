// The journeys the gate exists for, end to end through the store.
//
// Each one is a story a user or an agent actually lives. Unit tests can all pass
// while the pieces fail to add up, which is what these are for. The one that
// matters most is the loop: FAIL, fix, re-run, PASS.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { useTempStore } from './helpers/temp-store.mjs';
import { cmdCreate, cmdVerify } from '../lib/specforge-cli.mjs';
import { ensureTemplates, templateHtmlFor, templateId } from '../lib/store-templates.mjs';
import { specHtmlPath } from '../lib/store-paths.mjs';
import { cleanSpec } from './helpers/spec-corpus.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-journey-');

const deps = { ensureDaemon: async () => ({ url: 'http://localhost:4180' }), session: '' };
const failingIds = (r) => r.failing.map((f) => f.id);

test('journey: the loop — an agent fixes what the gate names until it passes', async () => {
  // This is the whole design. Everything else is detail.
  const { id } = await cmdCreate({ title: 'Half-written', type: 'design' }, deps);

  // Round 1: an unauthored scaffold is placeholders, so it fails loudly.
  const r1 = await cmdVerify({ id });
  assert.equal(r1.pass, false);
  assert.ok(failingIds(r1).includes('no-placeholders'));

  // The agent authors it, and misses one placeholder.
  writeFileSync(specHtmlPath(id), cleanSpec()
    .replace('<h1>A Real Spec</h1>', '<h1>Half-written</h1>')
    .replace('<p>The store writes', '<p>{{ TODO: write the summary }}</p><p>The store writes'));

  // Round 2: still failing, and the report says exactly which rule and why.
  const r2 = await cmdVerify({ id });
  assert.equal(r2.pass, false);
  const missed = r2.failing.find((f) => f.id === 'no-placeholders');
  assert.match(missed.why, /1 left/);
  assert.ok(missed.fix);

  // The agent fixes it and judges what no function can answer.
  writeFileSync(specHtmlPath(id), cleanSpec().replace('<h1>A Real Spec</h1>', '<h1>Half-written</h1>'));
  const r3 = await cmdVerify({ id });
  assert.equal(r3.failing.every((f) => f.kind === 'judge'), true, 'nothing mechanical left');

  // Round 3: the gate passes, and create-spec is allowed to hand over.
  const r4 = await cmdVerify({ id, judged: failingIds(r3).join(',') });
  assert.equal(r4.pass, true);
  assert.equal(r4.exit, 0);
});

test('journey: a spec cannot be judged past a real defect', async () => {
  const { id } = await cmdCreate({ title: 'Broken', type: 'design' }, deps);
  writeFileSync(specHtmlPath(id), cleanSpec().replace('<h1>A Real Spec</h1>', '<h1>{{TITLE}}</h1>'));
  const r = await cmdVerify({ id });
  const claimed = failingIds(r).join(',');
  const after = await cmdVerify({ id, judged: claimed });
  assert.equal(after.pass, false, 'claiming to have judged a broken spec must not pass it');
  assert.ok(failingIds(after).some((x) => x === 'no-placeholders' || x === 'front-matter-filled'));
});

test('journey: the user adds a rule to the template and the next spec must satisfy it', async () => {
  ensureTemplates();
  writeFileSync(specHtmlPath(templateId('design')), templateHtmlFor('design').replace(
    '\n  </ul>\n</section>',
    '\n    <li data-sf-rule="names-the-owner">The spec names who owns the decision.</li>\n  </ul>\n</section>',
  ));

  const { id } = await cmdCreate({ title: 'Judged by a new rule', type: 'design' }, deps);
  writeFileSync(specHtmlPath(id), cleanSpec());
  const r = await cmdVerify({ id });
  const added = r.failing.find((f) => f.id === 'names-the-owner');
  assert.ok(added, 'a sentence written into the template is a rule the gate enforces');
  assert.equal(added.why, 'The spec names who owns the decision.');
  assert.equal(added.kind, 'judge');
});

test('journey: the user turns a rule off and the gate stops asking', async () => {
  ensureTemplates();
  writeFileSync(specHtmlPath(templateId('design')), templateHtmlFor('design').replace(
    '\n  </ul>\n</section>',
    '\n    <li data-sf-rule="unknowns-are-written-down" data-sf-severity="off"></li>\n  </ul>\n</section>',
  ));
  const { id } = await cmdCreate({ title: 'Softened', type: 'design' }, deps);
  writeFileSync(specHtmlPath(id), cleanSpec());
  assert.equal(failingIds(await cmdVerify({ id })).includes('unknowns-are-written-down'), false);
});

test('journey: a spec never carries the scaffolding a reader should not see', async () => {
  for (const type of ['design', 'design-impl', 'research']) {
    const { htmlPath } = await cmdCreate({ title: `A ${type}`, type }, deps);
    const html = readFileSync(htmlPath, 'utf8');
    assert.doesNotMatch(html, /data-sf-rules/, `${type}: rules block leaked into the spec`);
    assert.doesNotMatch(html, /data-sf-prompt/, `${type}: prompt leaked into the spec`);
  }
});

test('journey: the guidance the strip removed still reaches the agent', async () => {
  const { prompts } = await cmdCreate({ title: 'Prompted', type: 'design-impl' }, deps);
  const openQ = prompts.find((p) => p.section === 'open-questions');
  assert.ok(openQ, 'the section that draws the most correction carries its prompt');
  assert.match(openQ.text, /decision only the reader can make/);
  assert.match(openQ.text, /options they can pick from/);
});

test('journey: an impl spec is gated by the rules its type adds', async () => {
  const { id } = await cmdCreate({ title: 'A build plan', type: 'design-impl' }, deps);
  writeFileSync(specHtmlPath(id), cleanSpec());
  const ids = failingIds(await cmdVerify({ id }));
  assert.ok(ids.includes('stages-are-pr-sized'));
  assert.ok(ids.includes('stages-are-explained-plainly'), 'including the ones the corpus produced');
  assert.equal(ids.includes('findings-cite-sources'), false, "and not another type's");
});
