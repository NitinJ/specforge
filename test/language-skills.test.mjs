// The skills tell the agent what to do with the language field.
//
// The payload is worth nothing if nothing instructs the agent to obey it, and
// the skills are the only place that instruction can live: they are what the
// agent reads before it writes. This suite is a guard against the field being
// delivered and silently ignored, which is indistinguishable from the feature
// not existing.
//
// Task 2.2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

const CREATE = read('skills/create-spec/SKILL.md');
const REVIEW = read('skills/review-spec/SKILL.md');
const CONVERT = read('skills/convert-spec/SKILL.md');
// Not a skill, but the skills tell the agent to read it, so a pointer to the
// shipped file in here reaches the agent exactly as one in a skill would.
const HOUSE = read('templates/house-rules.md');

// These files are prose wrapped at 80 columns, so a sentence long enough to be
// worth pinning is a sentence that spans a line break. Matched against a
// flattened copy, or the guard passes the day someone reflows a paragraph.
const flat = (t) => t.replace(/\s+/g, ' ');
const SKILLS = [['create-spec', CREATE], ['review-spec', REVIEW], ['convert-spec', CONVERT]];

test('create-spec names the language field in the payload it documents', () => {
  assert.match(CREATE, /\blanguage\b[^`]*prompts\s*\}/,
    'the printed shape lists it, so an agent reading the skill expects it');
});

test('create-spec instructs the agent to follow the contract it is handed', () => {
  assert.match(flat(CREATE), /writing contract in force/i);
  assert.match(flat(CREATE), /Follow what it says and nothing it does not/i);
});

test('review-spec names the language field in the payload it documents', () => {
  assert.match(REVIEW, /\{ specId, htmlPath, language, threads, pending \}/);
});

test('review-spec extends the direction to replies and asides', () => {
  // The reach is the decision worth pinning: create-only would leave a spec
  // written in one register and its asides in another.
  assert.match(REVIEW, /replies, amendments, and asides/i);
});

test('convert-spec names the field and applies it while improving the result', () => {
  // Converting runs a deterministic pass and then the agent improves the
  // document, which is authoring. Raised in review of PR #203.
  assert.match(CONVERT, /language, report \}/, 'the printed shape lists it');
  assert.match(flat(CONVERT), /writing contract in force/i);
  assert.match(flat(CONVERT), /while improving the converted document/i);
});

test('every convert branch tells the agent to apply the direction', () => {
  // Three branches author: 2A ingests an HTML spec, 2B converts markdown, 2C
  // authors freeform HTML. A branch that documented its payload without the
  // field would leave that path in the house register. Raised in review of #203.
  const branches = CONVERT.split(/^## /m);
  for (const name of ['2A.', '2B.', '2C.']) {
    const branch = branches.find((b) => b.startsWith(name));
    assert.ok(branch, `${name} exists`);
    assert.match(branch, /language/i, `${name} names the field`);
  }
});

test('every authoring skill treats the delivered contract as the whole of it', () => {
  // Precedence used to be the thing to state, because the skill read the shipped
  // file and the user's words were laid over it. That stopped being safe when
  // the pane could delete a rule: an absence has nothing to outrank, so the
  // deleted rule came back from the file. The instruction is now that there is
  // one source and it is the payload.
  for (const [name, text] of SKILLS) {
    assert.match(flat(text), /writing contract in force, and it is the whole of it/i,
      `${name} says the payload is the contract`);
    assert.match(flat(text), /a rule the owner deleted is deleted/i,
      `${name} says a deletion is honoured`);
  }
});

test('no authoring skill still sends the agent to the shipped contract file', () => {
  // The guard on the defect itself. A skill that reads the file reinstates every
  // rule the owner removed, silently, and the Language tab becomes a lie.
  for (const [name, text] of SKILLS) {
    // Checked on the flattened copy, so a mention that happens to wrap onto its
    // own line is still read with the words in front of it.
    const one = flat(text);
    const total = (one.match(/references\/spec-language\.md/g) || []).length;
    const forbidden = (one.match(/Do not go looking for `references\/spec-language\.md`/gi) || []).length;
    assert.equal(total, forbidden,
      `${name} mentions the shipped contract file ${total - forbidden} time(s) `
      + 'outside the sentence forbidding it');
    assert.equal(forbidden, 1, `${name} says it once`);
  }
});

test('the house rules do not send the agent to the file either', () => {
  // Both create-spec and convert-spec require house-rules.md, so a pointer here
  // reinstates every deleted rule just as surely as one in a skill. Found in
  // review of PR #255 after the skills themselves had been fixed.
  const one = flat(HOUSE);
  assert.match(one, /The contract is the `language` field/,
    'the house rules name the payload as the contract');
  const mentions = (one.match(/references\/spec-language\.md/g) || []).length;
  assert.equal(mentions, 0, 'and the file is not named as somewhere to read the rules from');
});

test('the house rules do not restate the contract’s own rules', () => {
  // A precedence line does not save a restatement. Deleting "no em dashes" from
  // the contract leaves the contract silent on em dashes, so a copy of the rule
  // sitting in a required document has nothing to lose an argument to and goes
  // on being followed. Found in the second review pass of PR #255.
  const one = flat(HOUSE);
  for (const rule of [/no em dashes/i, /aphorism/i, /precision theatre/i,
    /attention-curating/i, /hedged decision/i]) {
    assert.equal(rule.test(one), false,
      `the house rules still carry a copy of ${rule} from the language contract`);
  }
});

test('every authoring skill points at the pane rather than at itself', () => {
  for (const [name, text] of [['create-spec', CREATE], ['review-spec', REVIEW], ['convert-spec', CONVERT]]) {
    assert.match(text, /Configuration pane/i, `${name} says where the setting lives`);
  }
});
