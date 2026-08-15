// Task 3.4: a template's rules block is visible and commentable while editing
// the template.
//
// The block ships `hidden`, so if a spec ever carries one by accident it stays
// out of a reader's way. A template is edited through the review UI, so the
// review layer has to undo that — a block you can only edit by knowing it is
// there is not editable.
//
// Two things have to hold and neither is provable from the template HTML alone:
// the review stylesheet must un-hide the section, and the comment layer must
// treat the block's elements as anchorable. Both are asserted against the real
// review-layer files rather than a copy of what they are supposed to say. A
// browser pass confirms it looks right; this is what stops it silently
// regressing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(REPO, 'server', 'public', 'review.css'), 'utf8');
const js = readFileSync(join(REPO, 'server', 'public', 'review.js'), 'utf8');

test('the review layer un-hides a template rules block', () => {
  assert.match(
    css,
    /section\[data-sf-rules\]\[hidden\][^{]*\{[^}]*display:\s*block/,
    'without this the block is editable only by someone who knows it is there',
  );
});

test('the rules block is styled as scaffolding, not as content', () => {
  // It never reaches a spec, so it should not read as part of the document.
  assert.match(css, /section\[data-sf-rules\]\[hidden\][^{]*\{[^}]*border:\s*1px dashed/);
});

test('the block set the comment layer anchors to covers a rules block', () => {
  const sel = (js.match(/BLOCK_SEL\s*=\s*'([^']+)'/) || [, ''])[1];
  assert.ok(sel, 'BLOCK_SEL not found in review.js');
  const parts = sel.split(',').map((s) => s.trim());
  // A rules block is an <h2> and a list of <li>s. Both must be anchorable or the
  // rules cannot be commented on, which is how they get changed.
  assert.ok(parts.includes('h2'), `h2 missing from ${sel}`);
  assert.ok(parts.includes('li'), `li missing from ${sel}`);
});

test('the prompts need no special handling, being ordinary blocks', () => {
  // A prompt is <p>s inside a real section, so it is commentable by construction.
  // Asserted so that a future change to prompt markup has to face this.
  const sel = (js.match(/BLOCK_SEL\s*=\s*'([^']+)'/) || [, ''])[1];
  assert.ok(sel.split(',').map((s) => s.trim()).includes('p'));
});
