// `specforge doctor`: five readings, and no sixth.
//
// It exists for one failure that is silent when it happens: the session-key
// migration (I2). If ownership were lost on upgrade, every spec page would read
// Disconnected and nothing would say why. This is how a person sees which
// harness answered, which key it produced, and what that key owns (E9).
//
// Spec e9ddcddef6, task 1.4.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { useTempStore } from './helpers/temp-store.mjs';
import { seedSession } from './helpers/live-session.mjs';
import { cmdDoctor } from '../lib/specforge-cli.mjs';
import { attach } from '../lib/attach.mjs';
import { connect } from '../lib/connections.mjs';
import { createSpec } from '../lib/store.mjs';

useTempStore({ beforeEach, afterEach }, 'sf-doctor-');

const env = (over = {}) => ({ CLAUDE_CODE_SESSION_ID: 'sess-doc', PATH: '', ...over });

test('it reports exactly five things', () => {
  // Q5 fixed the scope. A sixth reading is a new decision, not a small addition.
  const out = cmdDoctor({ env: env() });
  assert.deepEqual(Object.keys(out).sort(), ['harness', 'onPath', 'session', 'specs', 'watcher']);
});

test('it names the resolved harness first, and whether it was detected', () => {
  assert.deepEqual(cmdDoctor({ env: env() }).harness, {
    id: 'claude', agent: 'claude', detected: true,
  });
  assert.equal(cmdDoctor({ env: env({ SPECFORGE_HARNESS: 'claude' }) }).harness.detected, false);
});

test('it reports the session key and the raw id behind it', () => {
  const { session } = cmdDoctor({ env: env() });
  assert.equal(session.key, 'claude:sess-doc');
  assert.equal(session.raw, 'sess-doc');
});

test('a session it cannot name says so rather than reporting a blank', () => {
  const { session, specs } = cmdDoctor({ env: { PATH: '' } });
  assert.equal(session.key, null);
  assert.match(session.why, /could not name/);
  assert.deepEqual(specs, [], 'and owns nothing');
});

test('it lists the specs this session is connected to, and who is working each', () => {
  const { key } = seedSession({ id: 'sess-doc' });
  const specId = createSpec({ title: 'Owned thing', html: '<h1>x</h1>' });
  attach(specId, key);

  const { specs } = cmdDoctor({ env: env() });
  assert.deepEqual(specs, [{
    id: specId,
    title: 'Owned thing',
    active: 'claude',
    mine: true,
    connected: ['claude'],
  }]);
});

test('a spec another harness is working still appears, marked as not mine', () => {
  // Connected rather than active is the case a person is diagnosing when they
  // ask why their comments are not reaching them.
  const { key } = seedSession({ id: 'sess-doc' });
  const specId = createSpec({ title: 'Theirs', html: '<h1>x</h1>' });
  attach(specId, 'pi:their-session');
  connect(specId, key);

  const [row] = cmdDoctor({ env: env() }).specs;
  assert.equal(row.active, 'pi');
  assert.equal(row.mine, false);
  assert.deepEqual(row.connected.sort(), ['claude', 'pi']);
});

test('it reports the watcher and the command that arms one', () => {
  seedSession({ id: 'sess-doc', alive: true });
  const { watcher } = cmdDoctor({ env: env() });
  assert.equal(watcher.alive, true);
  assert.match(watcher.command, /wait-batch/);

  seedSession({ id: 'sess-doc', alive: false });
  assert.equal(cmdDoctor({ env: env() }).watcher.alive, false);
});

test('it says whether the specforge binary is on PATH', () => {
  // A skill that says `specforge <verb>` fails obscurely when the bin is not
  // linked, so the answer belongs here rather than in a stack trace (task 4.4).
  assert.equal(cmdDoctor({ env: env({ PATH: '/nowhere-at-all' }) }).onPath, null);
});

test('it takes an explicit session, so a person can ask about another one', () => {
  const specId = createSpec({ title: 'Theirs', html: '<h1>x</h1>' });
  attach(specId, 'claude:someone-else');
  const out = cmdDoctor({ env: env(), session: 'claude:someone-else' });
  assert.equal(out.session.key, 'claude:someone-else');
  assert.deepEqual(out.specs.map((s) => s.id), [specId]);
});
