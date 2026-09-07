// Spec trees to test against.
//
// `useTempStore` owns the store's location (the SPECFORGE_HOME env var and its
// teardown). This module owns what goes in it: specs carrying a `parent`, and a
// handful of named shapes the child-spec stages assert against. Keeping them
// apart is why there is no second store builder here — call useTempStore first,
// then seed into the store it made.
//
// The shapes exist because the interesting cases are structural, not textual.
// `dangling` and `cyclic` in particular cannot be produced through the API (the
// reparent route refuses a cycle, and a delete removes the whole subtree), so a
// fixture is the only way to reach the states a hand-edited meta.json can reach.

import { mkdirSync, writeFileSync } from 'node:fs';

import { defaultMeta } from '../../lib/meta.mjs';
import { specDir, metaPath, specHtmlPath, newSpecId } from '../../lib/store-paths.mjs';

/** A minimal but real spec document. */
function docFor(title, extraCss = '') {
  return `<!DOCTYPE html><html><head><title>${title}</title>${
    extraCss ? `<style>${extraCss}</style>` : ''
  }</head><body><h1>${title}</h1><p>Body of ${title}.</p></body></html>`;
}

/**
 * Write one spec straight to disk, bypassing createSpec.
 *
 * Deliberately not createSpec: a fixture has to be able to write states the
 * production path refuses, and `legacy` is the clearest case. It writes a meta
 * with no `parent` key at all, which is the shape every spec written before this
 * feature has, and the shape the no-migration claim is asserted against.
 *
 * @param {object} opts
 * @param {string} [opts.id] defaults to a fresh store id
 * @param {string} [opts.title]
 * @param {string} [opts.type]
 * @param {string} [opts.status]
 * @param {string|null} [opts.parent]
 * @param {string|null} [opts.project]
 * @param {string|null} [opts.collection]
 * @param {string} [opts.html] the document; defaults to a minimal one
 * @param {string} [opts.css] extra CSS folded into the default document
 * @param {boolean} [opts.legacy] omit the `parent` key entirely
 * @param {number} [opts.created] creation timestamp. Worth setting whenever a
 *   test asserts on order: two specs seeded in the same millisecond tie, and the
 *   tie is broken by id, which is effectively random.
 * @returns {string} the spec id
 */
export function seedSpec({
  id = newSpecId(), title = 'Spec', type = 'general', status = 'draft',
  parent = null, project = null, collection = null, html, css = '', legacy = false,
  created,
} = {}) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), html ?? docFor(title, css));

  const meta = { ...defaultMeta({ id, title, type }), status, project, collection };
  if (created !== undefined) meta.created = created;
  if (legacy) delete meta.parent;
  else meta.parent = parent;

  writeFileSync(metaPath(id), JSON.stringify(meta, null, 2));
  return id;
}

/** CSS that is fine in its own document and destructive in somebody else's. */
const HOSTILE_CSS = [
  'body { background: #ff00ff !important; margin: 99px !important; }',
  'p { color: #00ff00 !important; font-size: 41px !important; }',
  'h1 { display: none !important; }',
].join('\n');

export const SHAPES = {
  /** No relations at all: the store as it looks today. */
  flat() {
    const ids = [0, 1, 2].map((n) => seedSpec({ title: `Flat ${n}` }));
    return { ids };
  },

  /** Five deep. Proves nothing in the walk assumes a maximum depth. */
  chain5() {
    const ids = [];
    let parent = null;
    for (let i = 0; i < 5; i++) {
      parent = seedSpec({ title: `Level ${i}`, parent });
      ids.push(parent);
    }
    return { ids, root: ids[0], leaf: ids[4] };
  },

  /** One parent, four children. The ordinary case, and the one the UI shows. */
  fan() {
    const root = seedSpec({ title: 'Fan root' });
    const children = [0, 1, 2, 3].map((n) => seedSpec({ title: `Fan child ${n}`, parent: root }));
    return { ids: [root, ...children], root, children };
  },

  /** A child pointing at a spec that is not there: an interrupted delete. */
  dangling() {
    const missing = newSpecId();
    const child = seedSpec({ title: 'Orphan', parent: missing });
    return { ids: [child], child, missing };
  },

  /** A cycle, reachable only by editing meta.json by hand. */
  cyclic() {
    const ids = [0, 1, 2].map((n) => seedSpec({ title: `Ring ${n}` }));
    for (let i = 0; i < ids.length; i++) {
      const parent = ids[(i - 1 + ids.length) % ids.length];
      seedSpec({ id: ids[i], title: `Ring ${i}`, parent });
    }
    return { ids };
  },

  /** A child whose stylesheet would wreck a host document if injected into it. */
  'hostile-css'() {
    const root = seedSpec({ title: 'Host parent' });
    const child = seedSpec({ title: 'Hostile child', parent: root, css: HOSTILE_CSS });
    return { ids: [root, child], root, child };
  },
};

/**
 * Build one named shape into the current store.
 * @param {keyof SHAPES} name
 */
export function buildShape(name) {
  const build = SHAPES[name];
  if (!build) throw new Error(`unknown shape: ${name}`);
  return build();
}
