// Markdown interop at the store layer: the one module the CLI, the daemon and
// the skills call. Everything above it deals in spec ids and file paths;
// everything below it (html-to-md) deals in strings.
//
// Nothing is written into the spec's own directory. The markdown is a projection
// of spec.html, and a stored copy would go stale on the next edit with no
// invalidation hook to notice.

import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync, realpathSync } from 'node:fs';
import { dirname, join, basename, resolve, relative, extname, isAbsolute } from 'node:path';
import { readMeta, writeMeta, DEFAULT_TYPE } from './meta.mjs';
import { specTypes, isSpecType } from './spec-types.mjs';
import { readSpecHtml, createSpec, specHtmlPath } from './store.mjs';
import { templateHtmlFor } from './store-templates.mjs';
import { stripTemplateBlocks } from './rules/template-blocks.mjs';
import { lintSpec } from './lint-spec.mjs';
import { specToMarkdown, slug } from './html-to-md.mjs';
import { zip } from './zip.mjs';
import { markdownToSpecHtml, MAX_RASTER_BYTES } from './md-to-html.mjs';
import { parseFrontmatter } from './md-parse.mjs';

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

  // One file instead of a file and a folder. Worth having on the CLI and not
  // only behind the download button: a spec with diagrams is several files, and
  // attaching or copying a directory is the step people skip.
  if (opts.zip) {
    const markdown = base === rendered.slug
      ? rendered.markdown
      : rendered.markdown.replaceAll(`${rendered.slug}.assets/`, `${base}.assets/`);
    const zipPath = join(dirname(mdPath), `${base}.zip`);
    mkdirSync(dirname(zipPath), { recursive: true });
    writeFileSync(zipPath, zip([
      { name: `${base}.md`, data: markdown },
      ...rendered.assets.map((a) => ({ name: `${base}.assets/${a.name}`, data: a.svg })),
    ]));
    return {
      id,
      zipPath,
      mdPath: null,
      assetsDir: null,
      assets: rendered.assets.length,
      warnings: rendered.warnings,
    };
  }

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

const RASTER = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif']);
const MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
};

/**
 * Resolve an image reference against the directory the markdown came from.
 *
 * A spec is a single self-contained file, so an SVG goes back inline and a
 * raster becomes a data URI. Past the cap it is dropped and reported: a spec
 * carrying a multi-megabyte base64 blob is worse than one missing a picture.
 */
/** The path with symlinks resolved, or the path itself when it does not exist. */
function realOrSelf(path) {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

export function assetResolver(baseDir) {
  const root = realOrSelf(resolve(baseDir));
  return (src) => {
    if (/^(?:https?:)?\/\//i.test(src)) return { kind: 'remote', src };
    // Already inline. A raster that was imported once leaves as a data: URI and
    // has to come back as one, or a second import loses the picture.
    if (/^data:image\//i.test(src)) return { kind: 'raster', dataUri: src };
    const path = resolve(root, src);
    // Containment, checked on the REAL path. The reference comes from the
    // markdown, so `../../.ssh/id_rsa`, an absolute path, or a symlink sitting
    // in the directory and pointing anywhere would otherwise read an unrelated
    // file and embed it in a spec that then gets served, and published. Import
    // reads what actually sits beside the document, and nothing else.
    const real = realOrSelf(path);
    const rel = relative(root, real);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { kind: 'outside', src };
    if (!existsSync(real) || !statSync(real).isFile()) return { kind: 'missing' };
    // Read through `real`, the path containment was checked against. Reading
    // `path` instead would re-follow the symlink and defeat the check above.
    const ext = extname(real).toLowerCase();
    if (ext === '.svg') return { kind: 'svg', text: readFileSync(real, 'utf8') };
    if (!RASTER.has(ext)) return { kind: 'missing' };
    const bytes = statSync(real).size;
    if (bytes > MAX_RASTER_BYTES) return { kind: 'too-large', bytes };
    return { kind: 'raster', dataUri: `data:${MIME[ext]};base64,${readFileSync(real).toString('base64')}` };
  };
}

/**
 * Convert a markdown file into a NEW spec in the store.
 *
 * Import never writes over an existing spec, whatever the frontmatter says. A
 * `specforge_id` there is recorded as provenance and nothing more, so a stale
 * file can never destroy a review round that happened while it sat on disk.
 *
 * @param {string} file
 * @param {{title?:string, type?:string, date?:string, owner?:string}} [opts]
 * @returns {{id:string, htmlPath:string, title:string, type:string, status:string, report:object}}
 */
export function importMd(file, opts = {}) {
  if (!file) throw new Error('import-md: <file> required');
  const abs = resolve(file);
  const md = readFileSync(abs, 'utf8'); // fail before touching the store

  // Frontmatter first, on its own: the type decides which shell to convert into,
  // so reading it by running a whole conversion would mean converting twice.
  const { fields: frontmatter } = parseFrontmatter(md);
  const type = opts.type || frontmatter.type || DEFAULT_TYPE;
  if (!isSpecType(type)) {
    throw new Error(`import-md: invalid type "${type}" — one of: ${specTypes().join(', ')}`);
  }

  const converted = markdownToSpecHtml(md, {
    // Stripped before conversion, not after: the rules block and the prompts are
    // scaffolding for authoring a spec, and a document converted from markdown
    // has already been authored elsewhere.
    shell: stripTemplateBlocks(templateHtmlFor(type)),
    title: opts.title,
    date: opts.date || '',
    owner: opts.owner || '',
    resolveAsset: assetResolver(dirname(abs)),
  });

  const id = createSpec({ title: converted.title, origin: abs, html: converted.html, type });

  // Provenance, not a write target: it records where this document came from.
  if (frontmatter.specforge_id) {
    writeMeta(id, { ...readMeta(id), derivedFrom: frontmatter.specforge_id });
  }

  const lint = lintSpec(converted.html);
  return {
    id,
    htmlPath: specHtmlPath(id),
    title: converted.title,
    type,
    status: converted.status,
    report: {
      ...converted.report,
      derivedFrom: frontmatter.specforge_id || null,
      lint: lint.ok ? 'PASS' : 'FAIL',
      lintFailures: lint.checks.filter((c) => !c.ok && !c.advisory).map((c) => c.name),
    },
  };
}
