// A template spec is a spec, and it is opened and edited through the same review
// UI as any other. So it has to lint.
//
// This is the check that caught `class="fix"`: the fix hint was marked with a
// class that is not in the component library, which made every seeded template
// fail its own components lint. A template nobody can edit without a warning is
// a template nobody edits.

import test, { beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { useTempStore } from './helpers/temp-store.mjs';
import { ensureTemplates, templateId, templateHtmlFor } from '../lib/store-templates.mjs';
import { specHtmlPath } from '../lib/store-paths.mjs';
import { lintSpec } from '../lib/lint-spec.mjs';
import { SPEC_TYPES } from '../lib/meta.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-template-lint-');

test('every seeded template lints as cleanly as it did before it carried rules', () => {
  ensureTemplates();
  for (const type of SPEC_TYPES) {
    const html = readFileSync(specHtmlPath(templateId(type)), 'utf8');
    const { checks } = lintSpec(html);
    const failed = checks.filter((c) => !c.ok && !c.advisory).map((c) => c.name);
    assert.deepEqual(failed, [], `${type}: template does not lint`);
  }
});

test('the blocks introduce no class outside the component library', () => {
  ensureTemplates();
  for (const type of SPEC_TYPES) {
    const withBlocks = templateHtmlFor(type);
    const comp = lintSpec(withBlocks).checks.find((c) => c.name === 'spec-components');
    if (!comp) continue; // this type never opted into the library
    assert.equal(comp.ok, true, `${type}: ${comp.detail}`);
  }
});

test('the blocks keep text in places the review layer can anchor a comment to', () => {
  ensureTemplates();
  for (const type of SPEC_TYPES) {
    const comm = lintSpec(templateHtmlFor(type)).checks.find((c) => c.name === 'commentability');
    assert.equal(comm.ok, true, `${type}: ${comm.detail}`);
  }
});
