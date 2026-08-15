// The markdown-interop fixture corpus: one spec per doc type, plus one that is
// nothing but diagrams. Every conversion test reads its inputs from here so the
// exporter, the importer, and the round-trip suite all see the same documents.
//
// Each fixture is a complete, lint-passing spec: theme block, palette tokens,
// a status attribute, unique section ids. They are deliberately hand-written
// rather than generated from templates/ — a golden file that moves whenever a
// template is tuned tests nothing.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * @typedef {object} Fixture
 * @property {string} name    stable key, also the golden file's basename
 * @property {string} type    the spec type this document is shaped like
 * @property {string} file    absolute path to the spec HTML
 * @property {string} covers  what this fixture exists to exercise
 * @property {() => string} html
 */

/** @type {Fixture[]} */
export const FIXTURES = [
  {
    name: 'design',
    type: 'design',
    file: join(HERE, 'design.spec.html'),
    covers: 'nested lists, a table, a fenced block with a language, both callout variants, open questions in all three states',
  },
  {
    name: 'research',
    type: 'research',
    file: join(HERE, 'research.spec.html'),
    covers: 'renamed sections, ordered lists, two tables, an approved status',
  },
  {
    name: 'design-impl',
    type: 'design-impl',
    file: join(HERE, 'design-impl.spec.html'),
    covers: 'a plan with a PR number and every task status, a tracker, Runtime stubs',
  },
  {
    name: 'impl',
    type: 'impl',
    file: join(HERE, 'impl.spec.html'),
    covers: 'a plan-only spec: two stages, no design prose to speak of',
  },
  {
    name: 'diagrams',
    type: 'design',
    file: join(HERE, 'diagrams.spec.html'),
    covers: 'two inline SVGs, one in a figure with a caption and one bare with an aria-label',
  },
  {
    name: 'notices',
    type: 'design',
    file: join(HERE, 'notices.spec.html'),
    covers: 'one notice of every library type, the three legacy tones, and an untyped one',
  },
  {
    name: 'mermaid',
    type: 'design',
    file: join(HERE, 'mermaid.spec.html'),
    covers: 'three mermaid diagrams, a declared python block, and one undeclared block that is not a language',
  },
].map((f) => ({ ...f, html: () => readFileSync(f.file, 'utf8') }));

/** One fixture by name. Throws rather than returning undefined. */
export function fixture(name) {
  const f = FIXTURES.find((x) => x.name === name);
  if (!f) throw new Error(`no fixture "${name}" (have: ${FIXTURES.map((x) => x.name).join(', ')})`);
  return f;
}
