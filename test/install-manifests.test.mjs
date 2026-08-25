// The two package manifests, and the installer that reads them.
//
// One checkout serves both CLIs, which means both manifests have to keep
// pointing at directories that exist. A renamed directory is a silent install
// failure: the CLI loads nothing and says nothing, and the first symptom is a
// skill that cannot be found in a session an hour later.
//
// Spec e9ddcddef6, tasks 7.1 and 7.2.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const json = (p) => JSON.parse(read(p));

const pkg = json('package.json');
const plugin = json('.claude-plugin/plugin.json');
const install = read('install.sh');

// --- Pi ----------------------------------------------------------------------

test('the pi manifest names extensions, skills and prompts', () => {
  assert.deepEqual(pkg.pi, {
    extensions: ['./extensions'],
    skills: ['./skills'],
    prompts: ['./commands'],
  });
});

test('every path the pi manifest names exists and is not empty', () => {
  for (const paths of Object.values(pkg.pi)) {
    for (const p of paths) {
      const dir = join(ROOT, p);
      assert.ok(existsSync(dir), `${p} is named in the pi manifest and does not exist`);
      assert.ok(readdirSync(dir).length, `${p} is empty, so pi would load nothing from it`);
    }
  }
});

test('the package carries the pi-package keyword', () => {
  assert.ok(pkg.keywords.includes('pi-package'), 'it is how the gallery finds it');
});

test('the pi extension is a .js file, which is what pi discovers', () => {
  // docs/packages.md L162: an extensions directory loads .ts and .js. A .mjs
  // sitting there is not an error, it is simply never loaded.
  const found = readdirSync(join(ROOT, 'extensions'));
  assert.ok(found.some((f) => f.endsWith('.js')), `no .js in extensions/: ${found.join(', ')}`);
});

// --- Claude Code --------------------------------------------------------------

test('the claude plugin manifest still names its two directories', () => {
  assert.equal(plugin.skills, './skills/');
  assert.equal(plugin.commands, './commands/');
});

test('both manifests carry the same version', () => {
  // They describe one checkout. Two versions is two answers to "what is
  // installed", and the person asking has only one install.
  assert.equal(plugin.version, pkg.version);
});

test('neither manifest describes SpecForge as being for one CLI', () => {
  assert.doesNotMatch(plugin.description, /for Claude Code/i);
  assert.doesNotMatch(pkg.description, /for Claude Code/i);
});

// --- the installer -------------------------------------------------------------

test('the installer requires neither CLI, and refuses when it finds neither', () => {
  assert.match(install, /HAVE_CLAUDE=0/);
  assert.match(install, /HAVE_PI=0/);
  assert.match(install, /no supported agent CLI found/);
});

test('it installs into each CLI it finds', () => {
  assert.match(install, /claude plugin install specforge@specforge/);
  assert.match(install, /run pi install "\$HERE"/);
});

test('it reports one line per CLI, including the ones it skipped', () => {
  // The verify for task 7.2 is that the report matches reality on a machine with
  // one CLI as well as two, which needs the absent one to be named.
  assert.match(install, /claude code\s+not found, skipped/);
  assert.match(install, /pi\s+not found, skipped/);
  assert.match(install, /step "What was installed"/);
});
