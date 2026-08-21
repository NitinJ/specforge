// "Add a template" on the configuration page: the form, and the wait.
//
// The wait is the part with a person in front of it. The user asked to be held
// on the configuration page rather than land on a half-written spec (D5), which
// makes the dialog's honesty the feature: an elapsed counter rather than a
// percentage the daemon cannot know (D6), a stated duration, what becomes
// possible when it lands, and a way out at 180 seconds (E4).
//
// jsdom does no layout, so this covers behaviour. The look is checked by
// screenshot, in both themes, as task 4.4.
//
// Spec 45395008a2, tasks 4.1, 4.2, 4.3.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { loadSettings, tick } from './helpers/settings-dom.mjs';

const TEMPLATES = { tab: 'templates' };

/** A create that succeeds, then reports whatever states are queued. */
function scripted(states, { createStatus = 201 } = {}) {
  const queue = [...states];
  return ({ method, url }) => {
    if (method === 'POST' && url.includes('/api/types')) {
      if (createStatus !== 201) return { __status: createStatus, error: 'No Claude Code session is listening. Start one and arm wait-batch.' };
      return {
        slug: 'postmortem', label: 'Postmortem', shell: 'doc',
        templateId: 'template-postmortem', specUrl: '/spec/template-postmortem',
        generate: { state: 'requested' },
      };
    }
    const next = queue.length > 1 ? queue.shift() : queue[0];
    return {
      slug: 'postmortem', label: 'Postmortem', specUrl: '/spec/template-postmortem',
      generate: next,
    };
  };
}

const el = (window, id) => window.document.getElementById(id);
const open = (window) => el(window, 'sf-add-type').click();

/** Fill the form and submit it. */
function submit(window, { name = 'Postmortem', prompt = 'what happened, impact', shell } = {}) {
  open(window);
  el(window, 'sf-add-name').value = name;
  el(window, 'sf-add-prompt').value = prompt;
  if (shell) {
    [...window.document.querySelectorAll('input[name="sf-add-shell"]')]
      .forEach((r) => { r.checked = r.value === shell; });
  }
  el(window, 'sf-add-go').click();
}

// --- the card and the form (4.1) --------------------------------------------

test('the Templates tab offers an Add card beside the templates', async (t) => {
  const { window } = loadSettings(t, TEMPLATES);
  const add = el(window, 'sf-add-type');
  assert.ok(add, 'the card is there');
  assert.match(add.textContent, /add/i);
  assert.ok(window.document.querySelectorAll('.tcard').length > 1, 'and the templates still are');
});

test('no other tab offers it', async (t) => {
  const { window } = loadSettings(t, { tab: 'language' });
  assert.equal(el(window, 'sf-add-type'), null);
});

test('clicking Add opens a form asking for a name and a prompt', async (t) => {
  const { window } = loadSettings(t, TEMPLATES);
  assert.ok(el(window, 'sf-add-form').hidden, 'closed until asked for');
  open(window);
  assert.equal(el(window, 'sf-add-form').hidden, false);
  assert.ok(el(window, 'sf-add-name'), 'a name');
  assert.ok(el(window, 'sf-add-prompt'), 'and a prompt');
  assert.equal(window.document.querySelectorAll('input[name="sf-add-shell"]').length, 2,
    'plus the two shell families (Q2)');
});

test('an empty name or prompt is refused here, without a request', async (t) => {
  const { window, calls } = loadSettings(t, TEMPLATES);
  submit(window, { name: '', prompt: 'something' });
  await tick(window);
  assert.match(el(window, 'sf-add-err').textContent, /name/i);
  assert.equal(calls.some((c) => c.method === 'POST'), false, 'nothing was sent');

  submit(window, { name: 'Postmortem', prompt: '  ' });
  await tick(window);
  // Named in the user's words rather than the field's: "prompt" is what the
  // route calls it, and the person is looking at a box asking what the kind is
  // for.
  assert.match(el(window, 'sf-add-err').textContent, /describe|sections/i);
  assert.equal(calls.some((c) => c.method === 'POST'), false);
});

test('a filled form posts the name, the prompt and the shell', async (t) => {
  const { window, calls } = loadSettings(t, TEMPLATES, {
    respond: scripted([{ state: 'requested' }]),
  });
  submit(window, { name: 'Postmortem', prompt: 'what happened, impact', shell: 'impl' });
  await tick(window);
  const post = calls.find((c) => c.method === 'POST');
  assert.equal(post.url, '/api/types');
  assert.deepEqual(post.body, { name: 'Postmortem', prompt: 'what happened, impact', shell: 'impl' });
});

// --- the wait (4.2) ---------------------------------------------------------

test('the wait says how long, and what becomes possible', async (t) => {
  const { window } = loadSettings(t, TEMPLATES, { respond: scripted([{ state: 'requested' }]) });
  submit(window);
  await tick(window);

  const wait = el(window, 'sf-wait');
  assert.equal(wait.hidden, false, 'the dialog is up');
  assert.match(el(window, 'sf-wait-eta').textContent, /minute/i, 'a stated duration');
  assert.match(el(window, 'sf-wait-elapsed').textContent, /0:0\d/, 'and an elapsed counter');
  // Three things, because the point of waiting is knowing what you get.
  assert.equal(el(window, 'sf-wait-next').querySelectorAll('li').length, 3);
  assert.match(el(window, 'sf-wait-next').textContent, /comment/i, 'one of them is refining it');
});

test('the bar is indeterminate, never a percentage', async (t) => {
  // The daemon cannot see how far along the skill is (D6). A bar claiming 70%
  // and then sitting there is worse than one that claims nothing.
  const { window } = loadSettings(t, TEMPLATES, { respond: scripted([{ state: 'requested' }]) });
  submit(window);
  await tick(window);
  const bar = el(window, 'sf-wait-bar');
  assert.equal(bar.hasAttribute('value'), false, 'no value attribute');
  assert.equal(/%/.test(bar.textContent), false);
});

test('the counter climbs as the clock does', async (t) => {
  const { window, advance } = loadSettings(t, TEMPLATES, {
    clock: true, respond: scripted([{ state: 'requested' }]),
  });
  submit(window);
  await tick(window);
  await advance(65_000);
  assert.match(el(window, 'sf-wait-elapsed').textContent, /1:0\d/);
});

// --- polling, and the three ways it ends (4.3) ------------------------------

test('it polls the kind until it is written, then goes there', async (t) => {
  const { window, calls, advance } = loadSettings(t, TEMPLATES, {
    clock: true,
    respond: scripted([{ state: 'requested' }, { state: 'working' }, { state: 'done' }]),
  });
  submit(window);
  await tick(window);
  await advance(10_000);

  const polls = calls.filter((c) => c.method === 'GET' && c.url.includes('/api/types/postmortem'));
  assert.ok(polls.length >= 2, `polled repeatedly (${polls.length})`);
  assert.equal(window.__sfWent, '/spec/template-postmortem?created=template',
    'and navigated with the marker that opens the arrival dialog');
});

test('an error is shown, with the template still openable', async (t) => {
  // The registry row and the template spec both survive a failed generation, so
  // the way out is the working shell it started as.
  const { window, advance } = loadSettings(t, TEMPLATES, {
    clock: true,
    respond: scripted([{ state: 'error', error: 'could not lint the result' }]),
  });
  submit(window);
  await tick(window);
  await advance(4_000);

  assert.match(el(window, 'sf-wait-err').textContent, /could not lint/);
  assert.equal(el(window, 'sf-wait-kept').hidden, false,
    'and it says the kind exists, because the error alone reads as "nothing happened"');
  assert.equal(el(window, 'sf-wait-open').hidden, false, 'with a way in');
  assert.equal(window.__sfWent, undefined, 'nothing navigated on its own');
});

test('past the deadline it stops claiming and offers a way out', async (t) => {
  const { window, advance } = loadSettings(t, TEMPLATES, {
    clock: true, respond: scripted([{ state: 'working' }]),
  });
  submit(window);
  await tick(window);
  await advance(181_000);

  assert.equal(el(window, 'sf-wait-slow').hidden, false, 'it says so');
  assert.ok(el(window, 'sf-wait-open'), 'open it anyway');
  assert.ok(el(window, 'sf-wait-keep'), 'or keep waiting');
});

test('keep waiting resumes the poll rather than restarting the job', async (t) => {
  const { window, calls, advance } = loadSettings(t, TEMPLATES, {
    clock: true, respond: scripted([{ state: 'working' }]),
  });
  submit(window);
  await tick(window);
  await advance(181_000);
  const before = calls.filter((c) => c.method === 'GET').length;

  el(window, 'sf-wait-keep').click();
  await advance(6_000);
  assert.ok(calls.filter((c) => c.method === 'GET').length > before, 'polling again');
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1, 'and only ever created once');
});

test('cancel stops the polling and leaves the template alone', async (t) => {
  // It cannot cancel the agent, because nothing can. It stops this page waiting.
  const { window, calls, advance } = loadSettings(t, TEMPLATES, {
    clock: true, respond: scripted([{ state: 'working' }]),
  });
  submit(window);
  await tick(window);
  el(window, 'sf-wait-cancel').click();
  const after = calls.filter((c) => c.method === 'GET').length;
  await advance(20_000);
  assert.equal(calls.filter((c) => c.method === 'GET').length, after, 'no further polls');
  assert.equal(el(window, 'sf-wait').hidden, true, 'and the dialog is gone');
});

test('with nothing listening it says so, and never opens the wait', async (t) => {
  const { window } = loadSettings(t, TEMPLATES, {
    respond: scripted([], { createStatus: 503 }),
  });
  submit(window);
  await tick(window);
  assert.match(el(window, 'sf-add-err').textContent, /listening|session/i);
  assert.equal(el(window, 'sf-wait').hidden, true, 'no dialog to wait on');
  assert.equal(el(window, 'sf-add-form').hidden, false, 'the form stays, with what was typed');
  assert.equal(el(window, 'sf-add-name').value, 'Postmortem');
});
