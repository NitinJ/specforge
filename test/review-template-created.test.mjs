// The dialog that greets you on a template you just created.
//
// The configuration page holds you until the template is written and then sends
// you here, so this is the first thing you see of it. What it has to say is what
// the wait promised: it exists, commenting on a section changes it, and specs of
// this kind can be created from now on.
//
// Shown on a marker in the URL rather than on anything stored, because it is a
// fact about this navigation and not about the spec: arriving at the same
// template tomorrow is not an arrival.
//
// Spec 45395008a2, task 5.1.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { bootReviewLayer } from './helpers/review-dom.mjs';

/**
 * Boot, then let the meta land.
 *
 * The dialog names the kind, which is on the meta, so it opens on the first
 * render that has one rather than at boot. Two extra flushes: boot's meta fetch
 * runs behind the block sync, which itself runs behind the mermaid pass.
 */
async function created(t, opts = {}) {
  const booted = await bootReviewLayer(t, {
    url: 'http://localhost/spec/template-postmortem?created=template',
    meta: { status: 'draft', type: 'postmortem', template: true },
    ...opts,
  });
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => setTimeout(r, 0));
  return booted;
}

const dlg = (window) => window.document.getElementById('sf-created');

test('arriving with the marker opens the dialog', async (t) => {
  const { window } = await created(t);
  assert.ok(dlg(window), 'the dialog is there');
});

test('the kind the dialog names is a field /meta actually sends', async (t) => {
  // The stub above answers with whatever meta a test passes, so every assertion
  // in this file would pass against an endpoint that never sent `type`. It did
  // not: the dialog rendered "--type your-kind" on the real daemon while these
  // tests were green. Checked against the handler itself, which is the only
  // thing that settles it.
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const home = mkdtempSync(join(tmpdir(), 'sf-metatype-'));
  const prev = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
  t.after(() => {
    if (prev === undefined) delete process.env.SPECFORGE_HOME;
    else process.env.SPECFORGE_HOME = prev;
    rmSync(home, { recursive: true, force: true });
  });

  const { createSpec } = await import('../lib/store.mjs');
  const { handleMeta } = await import('../lib/store-api.mjs');
  const id = createSpec({ title: 'A postmortem', html: '<h1>A</h1>', type: 'research' });

  const sent = await new Promise((resolve) => {
    handleMeta(id, {
      writeHead() {},
      end(body) { resolve(JSON.parse(body)); },
      setHeader() {},
    });
  });
  assert.equal(sent.type, 'research', '/meta carries the kind');
});

test('it says what was made, and what to do with it', async (t) => {
  const { window } = await created(t);
  const text = dlg(window).textContent;
  assert.match(text, /postmortem/i, 'the kind it just made');
  assert.match(text, /comment/i, 'that commenting refines it');
  assert.match(text, /create/i, 'and that specs of this kind can now be created');
});

test('it names the command that uses the new kind', async (t) => {
  // The third promise the wait made. A kind you cannot work out how to use is a
  // template you will not use.
  const { window } = await created(t);
  assert.match(dlg(window).textContent, /--type postmortem/);
});

test('dismissing it leaves the spec page as it always is', async (t) => {
  const { window } = await created(t);
  dlg(window).querySelector('.sf-created-go').click();
  assert.equal(dlg(window), null, 'the dialog is gone');
  assert.ok(window.document.getElementById('sf-launcher'), 'and the review chrome is untouched');
});

test('the marker is stripped, so a reload is not a second arrival', async (t) => {
  const { window } = await created(t);
  assert.equal(/created=template/.test(window.location.search), false,
    'the address bar no longer carries it');
});

test('a spec opened without the marker gets no dialog', async (t) => {
  const { window } = await bootReviewLayer(t);
  assert.equal(dlg(window), null);
});

test('an unknown marker value is ignored rather than guessed at', async (t) => {
  const { window } = await bootReviewLayer(t, {
    url: 'http://localhost/spec/template-postmortem?created=something-else',
  });
  assert.equal(dlg(window), null);
});

test('a published copy never shows it', async (t) => {
  // A reviewer arriving at someone else's template did not create anything, and
  // the create command it names is not theirs to run.
  const { window } = await created(t, { transport: 'poll' });
  assert.equal(dlg(window), null);
});

test('it falls back to naming the spec when the kind is not on the meta', async (t) => {
  // A template spec whose meta predates the type field, or a marker on an
  // ordinary spec: the dialog still has to read as a sentence.
  const { window } = await created(t, { meta: { status: 'draft' } });
  assert.ok(dlg(window), 'still shown');
  assert.match(dlg(window).textContent, /template/i);
  assert.equal(/--type your-kind/.test(dlg(window).textContent), true,
    'and the command has a placeholder rather than a blank');
});
