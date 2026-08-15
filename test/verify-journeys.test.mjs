// The journeys the verification system exists for, end to end through the store.
//
// Each one is a story a user or an agent actually lives, asserted from the
// outside: create → verify → fix → verify. Unit tests can all pass while the
// pieces fail to add up, which is what these are for.

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

test('journey: an agent scaffolds a spec, leaves a placeholder, and verify catches it', async () => {
  // The scaffold is placeholders by definition, so a spec that has not been
  // authored yet fails loudly rather than looking finished.
  const { id } = await cmdCreate({ title: 'Half-written', type: 'design' }, deps);
  const before = await cmdVerify({ id });
  assert.equal(before.ok, false);
  assert.ok(before.failed.some((v) => v.id === 'no-placeholders'), 'an unauthored scaffold is caught');

  // The agent authors it. One placeholder is missed.
  const authored = cleanSpec().replace('<h1>A Real Spec</h1>', '<h1>Half-written</h1>')
    .replace('<p>The store writes', '<p>{{ TODO: write the summary }}</p><p>The store writes');
  writeFileSync(specHtmlPath(id), authored);

  const after = await cmdVerify({ id });
  const placeholders = after.failed.find((v) => v.id === 'no-placeholders');
  assert.ok(placeholders, 'the one that was missed is still caught');
  assert.match(placeholders.detail, /1 left/);
  assert.ok(placeholders.fix, 'and the report says what to do about it');
});

test('journey: fixing what verify reported clears exactly that rule', async () => {
  const { id } = await cmdCreate({ title: 'Fixable', type: 'design' }, deps);
  writeFileSync(specHtmlPath(id), cleanSpec().replace('<h1>A Real Spec</h1>', '<h1>{{TITLE}}</h1>'));

  const before = await cmdVerify({ id });
  const failedBefore = before.failed.map((v) => v.id).sort();
  assert.deepEqual(failedBefore, ['front-matter-filled', 'no-placeholders']);

  writeFileSync(specHtmlPath(id), cleanSpec().replace('<h1>A Real Spec</h1>', '<h1>Fixable</h1>'));
  const after = await cmdVerify({ id });
  assert.deepEqual(after.failed, [], 'both cleared, and nothing else broke');
});

test('journey: mechanically clean is still not done, and the report says why', async () => {
  const { id } = await cmdCreate({ title: 'Clean but unjudged', type: 'design' }, deps);
  writeFileSync(specHtmlPath(id), cleanSpec());
  const r = await cmdVerify({ id });
  assert.deepEqual(r.failed, [], 'every function is satisfied');
  assert.equal(r.ok, false, 'and the spec is still not verified');
  const blocking = r.pending.filter((p) => p.severity === 'blocking');
  assert.ok(blocking.length > 0);
  for (const p of blocking) assert.ok(p.ask, 'each one hands over a sentence to judge');
});

test('journey: the user edits a rule in the template and the next spec is judged by it', async () => {
  ensureTemplates();
  const edited = templateHtmlFor('design').replace(
    '\n  </ul>\n</section>',
    '\n    <li data-sf-rule="names-the-owner">The spec names who owns the decision.</li>\n  </ul>\n</section>',
  );
  writeFileSync(specHtmlPath(templateId('design')), edited);

  const { id } = await cmdCreate({ title: 'Judged by a new rule', type: 'design' }, deps);
  writeFileSync(specHtmlPath(id), cleanSpec());
  const r = await cmdVerify({ id });
  const added = r.pending.find((p) => p.id === 'names-the-owner');
  assert.ok(added, 'a sentence written into the template is a rule');
  assert.equal(added.ask, 'The spec names who owns the decision.');
  assert.equal(added.severity, 'blocking', 'and it blocks by default');
});

test('journey: the user softens a rule and it stops holding up the handover', async () => {
  ensureTemplates();
  const edited = templateHtmlFor('design').replace(
    '\n  </ul>\n</section>',
    '\n    <li data-sf-rule="unknowns-are-written-down" data-sf-severity="advisory"></li>\n  </ul>\n</section>',
  );
  writeFileSync(specHtmlPath(templateId('design')), edited);

  const { id } = await cmdCreate({ title: 'Softened', type: 'design' }, deps);
  writeFileSync(specHtmlPath(id), cleanSpec());
  const r = await cmdVerify({ id });
  const rule = r.pending.find((p) => p.id === 'unknowns-are-written-down');
  assert.equal(rule.severity, 'advisory');
  assert.ok(rule.ask.length, 'softening kept the sentence rather than blanking it');
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

test('journey: an impl spec is judged by the rules its type adds', async () => {
  const { id } = await cmdCreate({ title: 'A build plan', type: 'design-impl' }, deps);
  writeFileSync(specHtmlPath(id), cleanSpec());
  const ids = (await cmdVerify({ id })).pending.map((p) => p.id);
  assert.ok(ids.includes('stages-are-pr-sized'));
  assert.ok(ids.includes('stages-are-explained-plainly'), 'including the ones the corpus produced');
  assert.equal(ids.includes('findings-cite-sources'), false, "and not another type's");
});
