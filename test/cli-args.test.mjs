// CLI argument parsing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, BOOLEAN_FLAGS, COMMANDS } from '../lib/specforge-cli.mjs';

test('positional arguments come back in order', () => {
  assert.deepEqual(parseArgs(['abc123', 'th_1']).positional, ['abc123', 'th_1']);
});

test('a value flag takes the next argument', () => {
  const { positional, flags } = parseArgs(['--title', 'A spec', 'extra']);
  assert.equal(flags.title, 'A spec');
  assert.deepEqual(positional, ['extra']);
});

// A boolean flag is the last word of its command as often as not, and demanding
// a value made the documented `origin --clear` throw before it ran.
test('a boolean flag stands alone, including at the end', () => {
  assert.equal(parseArgs(['--clear']).flags.clear, true);
  assert.equal(parseArgs(['abc', '--rotate']).flags.rotate, true);
  assert.deepEqual(parseArgs(['abc', '--rotate']).positional, ['abc']);
});

test('a boolean flag does not swallow the argument after it', () => {
  const { positional, flags } = parseArgs(['--clear', 'notavalue']);
  assert.equal(flags.clear, true);
  assert.deepEqual(positional, ['notavalue'], 'the next argument is still positional');
});

test('a value flag with nothing after it is still an error', () => {
  assert.throws(() => parseArgs(['--title']), /requires a value/);
});

test('every flag the commands treat as boolean is declared as one', () => {
  for (const name of ['clear', 'rotate']) {
    assert.ok(BOOLEAN_FLAGS.has(name), `--${name} is read as a boolean but not declared`);
  }
});

// A project name carries spaces and reaches argv unquoted as often as not, so
// the token is taken from the end and everything before it is the name. Read
// the other way round, `prune Figur design studio <token>` would prune a
// project called "Figur" and leave the real entry where it was.
//
// Driven through the real dispatcher: cmdPrune reports the project it looked
// in, so the error message is the assertion.
test('prune reads a multiword project name, quoted or not', async () => {
  const run = (argv) => {
    const { positional, flags } = parseArgs(argv);
    return COMMANDS.prune(positional, flags);
  };
  const nameFrom = async (argv) => {
    try {
      await run(argv);
      return null;
    } catch (e) {
      const m = e.message.match(/ in (.+)$/);
      return m ? m[1] : e.message;
    }
  };

  assert.equal(await nameFrom(['Figur', 'design', 'studio', 'abc123']), 'Figur design studio');
  assert.equal(await nameFrom(['Figur design studio', 'abc123']), 'Figur design studio');
  assert.equal(await nameFrom(['Figur', 'design', 'studio', '--token', 'abc123']), 'Figur design studio');
  assert.equal(await nameFrom(['specforge', 'abc123']), 'specforge');
});
