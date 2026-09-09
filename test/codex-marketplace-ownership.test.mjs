import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('..', import.meta.url));
for (const [command, suffixes] of [
  ['build', ['', '.next', '.previous']],
  ['remove', ['', '.previous']],
  ['restore', ['', '.previous', '.rejected']],
]) {
  for (const suffix of suffixes) {
    test(`${command} refuses unowned ${suffix || 'destination'} before changing any data`, () => {
      const temp = mkdtempSync(join(tmpdir(), 'sf-ownership-'));
      const root = join(temp, 'market');
      try {
        for (const part of ['', '.next', '.previous', '.rejected']) {
          mkdirSync(root + part);
          writeFileSync(join(root + part, 'sentinel'), part || 'root');
          if (part !== suffix) writeFileSync(join(root + part, '.specforge-owned'), 'SpecForge Codex marketplace\n');
        }
        const result = spawnSync(process.execPath, [
          join(source, 'scripts', `${command}-codex-marketplace.mjs`),
          ...(command === 'build' ? [source, root] : [root]),
        ], { encoding: 'utf8' });
        assert.notEqual(result.status, 0, result.stdout);
        assert.match(result.stderr, /unowned/);
        for (const part of ['', '.next', '.previous', '.rejected']) {
          assert.equal(readFileSync(join(root + part, 'sentinel'), 'utf8'), part || 'root');
        }
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
    });
  }
}
