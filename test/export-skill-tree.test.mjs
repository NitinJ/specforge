// The export skill has to reach the Google Doc with the document it chose.
//
// Step 1 tells the agent to fetch the flattened tree for a spec with children,
// instead of reading `htmlPath`. Step 3 then said "read the full htmlPath
// contents" and hand that over — so an agent following the steps in order made
// a Doc of the root alone, which is the document with holes in it that step 1
// exists to prevent. The two steps have to agree, and this is where that is
// checked: the skill is prose, so nothing else would catch them drifting apart.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILL = readFileSync(join(ROOT, 'skills', 'export', 'SKILL.md'), 'utf8');

/** The text under a `## <n>. …` heading, up to the next one. */
function step(n) {
  const m = SKILL.match(new RegExp(`\\n## ${n}\\.[^\\n]*\\n([\\s\\S]*?)(?=\\n## |$)`));
  assert.ok(m, `the skill has no step ${n}`);
  return m[1];
}

test('the skill tells the agent to fetch the flattened tree for a parent', () => {
  assert.match(SKILL, /\?flat=1/);
  assert.match(SKILL, /\/api\/spec\/<id>\/children/,
    'nothing tells the agent how to find out whether the spec has children');
});

test('the create step does not send the agent back to htmlPath regardless', () => {
  const create = step(3);
  // The failure is specifically an unconditional instruction to read htmlPath
  // at the point the Doc is made. Naming htmlPath as the leaf's document is
  // right; naming it as THE document is the bug.
  assert.doesNotMatch(create, /Read the full `htmlPath` contents/,
    'step 3 reads htmlPath unconditionally, so a parent exports without its children');
  assert.match(create, /flatten|step 1|children/i,
    'step 3 does not say which document step 1 settled on');
});
