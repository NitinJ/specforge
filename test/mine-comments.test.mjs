import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { mineComments } from '../lib/mine-comments.mjs';

let home;
let prevHome;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'sf-mine-'));
  prevHome = process.env.SPECFORGE_HOME;
  process.env.SPECFORGE_HOME = home;
});

afterEach(() => {
  if (prevHome === undefined) delete process.env.SPECFORGE_HOME;
  else process.env.SPECFORGE_HOME = prevHome;
  rmSync(home, { recursive: true, force: true });
});

test('mineComments returns empty on an empty store', () => {
  const { specs, total } = mineComments();
  assert.deepEqual(specs, []);
  assert.equal(total, 0);
});

test('mineComments collects human comments with their section, skipping agent replies', () => {
  const dir = join(home, 'specs', 'abc123');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'meta.json'), JSON.stringify({ id: 'abc123', title: 'Demo', type: 'design' }));
  writeFileSync(
    join(dir, 'comments.json'),
    JSON.stringify({
      threads: [
        {
          anchor: { block: { sectionPath: ['design'], tag: 'P' } },
          comments: [
            { author: 'human', body: 'make this a list' },
            { author: 'claude', body: 'done' },
          ],
        },
      ],
    }),
  );
  const { specs, total } = mineComments();
  assert.equal(total, 1, 'only the human comment counts');
  assert.equal(specs.length, 1);
  assert.equal(specs[0].title, 'Demo');
  assert.equal(specs[0].type, 'design');
  assert.equal(specs[0].threads[0].section, 'design');
  assert.deepEqual(specs[0].threads[0].comments, ['make this a list']);
});
