// Markdown interop at the store layer: the one module the CLI, the daemon and
// the skills call. Everything above it deals in spec ids and file paths;
// everything below it (html-to-md) deals in strings.
//
// Nothing is written into the spec's own directory. The markdown is a projection
// of spec.html, and a stored copy would go stale on the next edit with no
// invalidation hook to notice.

import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, basename, resolve } from 'node:path';
import { readMeta } from './meta.mjs';
import { readSpecHtml } from './store.mjs';
import { specToMarkdown, slug } from './html-to-md.mjs';

/** Types whose shape markdown cannot carry. */
const UNSUPPORTED_TYPES = new Set(['deck']);

/**
 * Render a spec as markdown without touching disk.
 * @param {string} id
 * @param {{exportedAt?:string, slug?:string}} [opts]
 * @returns {{id:string, slug:string, markdown:string, assets:{name:string,svg:string}[], warnings:string[]}}
 */
export function renderMd(id, opts = {}) {
  const meta = readMeta(id);
  if (!meta) throw new Error(`export-md: unknown spec ${id}`);
  if (UNSUPPORTED_TYPES.has(meta.type)) {
    throw new Error(
      `export-md: ${meta.type} specs are slide-shaped and have no markdown form (spec ${id})`
    );
  }
  const html = readSpecHtml(id);
  const out = specToMarkdown(html, {
    id,
    type: meta.type || '',
    exportedAt: opts.exportedAt || '',
    slug: opts.slug || slug(meta.title || '') || id,
  });
  return { id, ...out };
}

/**
 * Resolve `--out` into the markdown path to write.
 * A path ending in .md is used as given; anything else is a directory that takes
 * `<slug>.md` inside it.
 */
export function resolveOut(dest, name) {
  if (!dest) return resolve(process.cwd(), `${name}.md`);
  const p = resolve(dest);
  if (p.toLowerCase().endsWith('.md')) return p;
  if (existsSync(p) && statSync(p).isDirectory()) return join(p, `${name}.md`);
  return join(p, `${name}.md`);
}

/**
 * Export a spec to a markdown file, plus a sidecar assets directory when it has
 * diagrams. Inline SVG is stripped by every markdown renderer, so a diagram
 * leaves as a file and is referenced as an ordinary image.
 *
 * @param {string} id
 * @param {{out?:string, exportedAt?:string}} [opts]
 * @returns {{id:string, mdPath:string, assetsDir:string|null, assets:number, warnings:string[]}}
 */
export function exportMd(id, opts = {}) {
  const rendered = renderMd(id, opts);
  const mdPath = resolveOut(opts.out, rendered.slug);
  const base = basename(mdPath).replace(/\.md$/i, '');

  // The assets directory is named after the FILE, not the spec title: writing to
  // notes.md must reference notes.assets/, or every image link breaks on arrival.
  const assetsDir = rendered.assets.length ? join(dirname(mdPath), `${base}.assets`) : null;
  const markdown = base === rendered.slug
    ? rendered.markdown
    : rendered.markdown.replaceAll(`${rendered.slug}.assets/`, `${base}.assets/`);

  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, markdown);
  if (assetsDir) {
    mkdirSync(assetsDir, { recursive: true });
    for (const a of rendered.assets) writeFileSync(join(assetsDir, a.name), a.svg);
  }

  return {
    id,
    mdPath,
    assetsDir,
    assets: rendered.assets.length,
    warnings: rendered.warnings,
  };
}
