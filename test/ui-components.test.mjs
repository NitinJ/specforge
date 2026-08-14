// The shared UI primitives (server/public/ui.js): one snackbar and two dialogs,
// loaded by the home page and by the review layer injected onto every spec.
//
// They exist because there used to be two of each and they disagreed on
// everything visible — where a message appears, whether it dismisses itself,
// whether it can be dismissed at all — and because the review layer's
// destructive actions asked nothing before running. These tests pin the
// contract both surfaces now depend on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { JSDOM } from 'jsdom';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const UI_JS = readFileSync(join(ROOT, 'server', 'public', 'ui.js'), 'utf8');
const UI_CSS = readFileSync(join(ROOT, 'server', 'public', 'ui.css'), 'utf8');

function boot(t) {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    runScripts: 'dangerously', url: 'http://localhost/', pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  dom.window.eval(UI_JS);
  return dom.window;
}
const tick = (window, ms = 0) => new Promise((r) => window.setTimeout(r, ms));

test('a snackbar appears at the bottom, announces itself, and goes away on its own', async (t) => {
  const window = boot(t);
  const { document } = window;
  window.SFUI.snack('Saved', { timeout: 20 });
  const host = document.querySelector('.sfui-snacks');
  assert.ok(host, 'one host for all of them');
  assert.equal(host.getAttribute('aria-live'), 'polite', 'a message nobody looks at is still read out');
  const box = host.querySelector('.sfui-snack');
  assert.match(box.textContent, /Saved/);
  assert.ok(!box.classList.contains('err'), 'a plain message is not an error');
  await tick(window, 40);
  assert.equal(document.querySelector('.sfui-snack'), null, 'it dismisses itself');
});

// It dismisses itself AND carries an ×: one that only fades can be missed, one
// that only waits has to be cleared. The home page had the second, the review
// layer had the first.
test('a snackbar can also be dismissed by hand, and by its caller', (t) => {
  const window = boot(t);
  const { document } = window;
  window.SFUI.snack('One', { timeout: 0 });
  document.querySelector('.sfui-snack-x').click();
  assert.equal(document.querySelector('.sfui-snack'), null, 'the × closes it');

  const handle = window.SFUI.snack('Two', { timeout: 0 });
  assert.ok(document.querySelector('.sfui-snack'));
  handle.dismiss();
  assert.equal(document.querySelector('.sfui-snack'), null, 'so does the handle');
});

test('an error stays up longer than a note, and is marked as one', async (t) => {
  const window = boot(t);
  const { document } = window;
  window.SFUI.snack('Could not save.', { tone: 'err' });
  const box = document.querySelector('.sfui-snack');
  assert.ok(box.classList.contains('err'));
  await tick(window, 4500); // past the default dismissal for a plain message
  assert.ok(document.querySelector('.sfui-snack'), 'a failure is read, not glimpsed');
});

test('snackbars stack rather than replacing each other', (t) => {
  const window = boot(t);
  const { document } = window;
  window.SFUI.snack('One', { timeout: 0 });
  window.SFUI.snack('Two', { timeout: 0 });
  assert.deepEqual(
    [].slice.call(document.querySelectorAll('.sfui-snack-msg')).map((n) => n.textContent),
    ['One', 'Two'],
  );
});

test('a snackbar can carry one action', (t) => {
  const window = boot(t);
  const { document } = window;
  let ran = 0;
  window.SFUI.snack('Moved', { timeout: 0, action: { label: 'Undo', run: () => { ran += 1; } } });
  const act = document.querySelector('.sfui-snack-act');
  assert.equal(act.textContent, 'Undo');
  act.click();
  assert.equal(ran, 1);
  assert.equal(document.querySelector('.sfui-snack'), null, 'and takes the message with it');
});

test('confirm names what it will do and only acts when confirmed', (t) => {
  const window = boot(t);
  const { document } = window;
  let ran = 0;
  window.SFUI.confirm({ title: 'Stop sharing', body: 'The link stops working.', ok: 'Stop', onOk: () => { ran += 1; } });
  const d = document.getElementById('sf-dc');
  assert.ok(d.hasAttribute('open'));
  assert.equal(document.getElementById('sf-dc-title').textContent, 'Stop sharing');
  assert.equal(document.getElementById('sf-dc-body').textContent, 'The link stops working.');
  assert.equal(document.getElementById('sf-dc-ok').textContent, 'Stop');
  assert.ok(document.getElementById('sf-dc-ok').classList.contains('danger'), 'destructive by default');

  document.getElementById('sf-dc-cancel').click();
  assert.equal(ran, 0, 'Cancel does nothing');
  assert.ok(!d.hasAttribute('open'));

  window.SFUI.confirm({ title: 'x', body: 'y', onOk: () => { ran += 1; } });
  document.getElementById('sf-dc-ok').click();
  assert.equal(ran, 1);
  assert.ok(!d.hasAttribute('open'), 'and closes behind itself');
});

// Enter is the reflex that dismisses a dialog you did not read; it must not be
// the reflex that deletes something.
test('confirm opens with Cancel focused, not the destructive button', (t) => {
  const window = boot(t);
  const { document } = window;
  window.SFUI.confirm({ title: 'x', body: 'y', onOk: () => {} });
  assert.equal(document.activeElement, document.getElementById('sf-dc-cancel'));
});

test('a confirm that is not destructive says so in its button', (t) => {
  const window = boot(t);
  const { document } = window;
  window.SFUI.confirm({ title: 'x', body: 'y', danger: false, ok: 'Continue', onOk: () => {} });
  assert.ok(document.getElementById('sf-dc-ok').classList.contains('primary'));
});

test('prompt prefills, selects, and reports only a real change', (t) => {
  const window = boot(t);
  const { document } = window;
  const seen = [];
  const ask = () => window.SFUI.prompt({ title: 'Rename', label: 'Name', value: 'Before', onOk: (v) => seen.push(v) });

  ask();
  const input = document.getElementById('sf-dp-input');
  assert.equal(input.value, 'Before', 'a rename is an edit, not a retype');
  assert.equal(document.activeElement, input);
  document.getElementById('sf-dp-ok').click();
  assert.deepEqual(seen, [], 'unchanged is not a rename');

  ask();
  input.value = '   ';
  document.getElementById('sf-dp-ok').click();
  assert.deepEqual(seen, [], 'nor is blank');

  ask();
  input.value = '  After  ';
  document.getElementById('sf-dp-ok').click();
  assert.deepEqual(seen, ['After'], 'trimmed');
});

test('Enter in the prompt is Save; Cancel discards', (t) => {
  const window = boot(t);
  const { document } = window;
  const seen = [];
  window.SFUI.prompt({ title: 'Rename', label: 'Name', value: 'a', onOk: (v) => seen.push(v) });
  const input = document.getElementById('sf-dp-input');
  input.value = 'b';
  input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.deepEqual(seen, ['b']);

  window.SFUI.prompt({ title: 'Rename', label: 'Name', value: 'a', onOk: (v) => seen.push(v) });
  document.getElementById('sf-dp-input').value = 'c';
  document.getElementById('sf-dp-cancel').click();
  assert.deepEqual(seen, ['b'], 'Cancel sends nothing');
});

// A page's own Escape handling has to stand down while a dialog is up, or it
// acts on a keypress the dialog already answered.
test('dialogOpen reports whether anything is showing', (t) => {
  const window = boot(t);
  const { document } = window;
  assert.equal(window.SFUI.dialogOpen(), false);
  window.SFUI.confirm({ title: 'x', body: 'y', onOk: () => {} });
  assert.equal(window.SFUI.dialogOpen(), true);
  document.getElementById('sf-dc-cancel').click();
  assert.equal(window.SFUI.dialogOpen(), false);
});

// The layer is injected into a page it does not own — a live-reload or a rebuild
// can take its elements out from under it.
test('the components rebuild if something removes them from the page', (t) => {
  const window = boot(t);
  const { document } = window;
  window.SFUI.confirm({ title: 'x', body: 'y', onOk: () => {} });
  document.getElementById('sf-dc').remove();
  window.SFUI.confirm({ title: 'again', body: 'y', onOk: () => {} });
  assert.equal(document.getElementById('sf-dc-title').textContent, 'again');

  window.SFUI.snack('one', { timeout: 0 });
  document.querySelector('.sfui-snacks').remove();
  window.SFUI.snack('two', { timeout: 0 });
  assert.equal(document.querySelector('.sfui-snack-msg').textContent, 'two');
});

test('loading ui.js twice does not replace the components in use', (t) => {
  const window = boot(t);
  const first = window.SFUI;
  window.eval(UI_JS);
  assert.equal(window.SFUI, first);
});

// Both surfaces declare the generic palette names; the sheet reads them with
// fallbacks so it is never unstyled, on a spec whose theme is anything.
test('the stylesheet takes its colors from the host page, with fallbacks', () => {
  assert.match(UI_CSS, /--sfui-panel:\s*var\(--panel,\s*#/);
  assert.match(UI_CSS, /--sfui-red:\s*var\(--red,\s*#/);
  assert.match(UI_CSS, /\.sfui-dlg::backdrop/, 'the dialog dims what is behind it');
  // A spec that declares no palette is a plain white document; without this the
  // fallbacks would paste a dark card onto it.
  assert.match(UI_CSS, /@media \(prefers-color-scheme: light\)[\s\S]*--sfui-panel: var\(--panel, #ffffff\)/);
});
