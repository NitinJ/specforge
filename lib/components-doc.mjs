// The library document: the component library, rendered as a page SpecForge
// serves and a human comments on.
//
// Design Q1, resolved: not a template spec and not a page in the repo. A new
// store primitive. The definitions in components/ are the source of truth and
// live in git; this is generated from them, so a comment on a component is
// answered by editing the definition and rebuilding, never by editing the page.
// That is the loop: comment, edit the definition, `components build`, the
// browser reloads on the file change.
//
// It is deliberately not a spec. No lifecycle status, no required sections, no
// entry in the index's spec list, and the spec lint does not run on it. What it
// shares with a spec is the review layer, because being commentable is the
// entire point of putting it in the store rather than in the repo.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';

import { COMPONENTS, FAMILIES, LAYERS, componentsIn } from '../components/index.mjs';
import { buildCss, VERSION } from './components-build.mjs';
import { specDir, specHtmlPath, metaPath } from './store-paths.mjs';
import { defaultMeta } from './meta.mjs';

/** Reserved store id for the static collection (see RESERVED_ROUTES in store-paths.mjs). */
export const DOC_ID = 'specforge-components';

/** Reserved store id for the interactive collection. */
export const INTERACTIVE_DOC_ID = 'specforge-components-interactive';

/** Per-layer identity: id, page title, and the line that introduces the collection. */
const DOCS = {
  static: {
    id: DOC_ID,
    title: 'SpecForge components',
    lead: 'Pick a component by what the block asserts, never by how it should look.',
    empty: '',
  },
  interactive: {
    id: INTERACTIVE_DOC_ID,
    title: 'SpecForge interactive components',
    lead: 'These blocks respond to a reader, and every one of them is complete without JavaScript: '
      + 'the script reduces a document that is already whole, it never builds one.',
    // Rendered while the collection is empty. A page with a heading and nothing
    // under it reads as broken rather than as unbuilt, and the difference is a
    // fact about the registry that only this builder can state.
    empty: 'No interactive components yet. The collection is defined and served; '
      + 'the first component lands in the next stage.',
  },
};

/** The document id for a layer. */
export function docIdFor(layer) {
  const d = DOCS[layer];
  if (!d) throw new Error(`unknown layer: ${layer}`);
  return d.id;
}

/**
 * A document lives where a spec's HTML lives.
 *
 * Not a detail of layout. The comments API, the review batches and the
 * live-reload watcher all resolve a store id to `specs/<id>/spec.html` and its
 * siblings, and none of them takes a path. Put the document anywhere else and
 * the review layer renders on a page whose comments 404 and whose reload watches
 * a file that never changes.
 *
 * Defaults to the static document, because every caller that predates the second
 * one means that one.
 */
export function docPath(id = DOC_ID) {
  return specHtmlPath(id);
}

/**
 * The meta.json that makes a document addressable.
 *
 * Written once and then left alone: every comments handler starts with
 * `readMeta(id)` and 404s without it, so this is what makes the page commentable
 * rather than merely commented-on. Left alone because it is the one part of the
 * entry a human owns — which session is attached, whether they approved the
 * library — and a rebuild must not reset that.
 */
function ensureMeta(id, title) {
  const path = metaPath(id);
  if (existsSync(path)) return;
  const meta = { ...defaultMeta({ id, title }), reserved: true };
  writeFileSync(path, JSON.stringify(meta, null, 2));
}

const FAMILY_TITLE = {
  notice: 'Notices',
  inline: 'Inline',
  data: 'Data',
  code: 'Code',
  structure: 'Structure',
  spec: 'Spec structure',
};

const FAMILY_LEAD = {
  notice: 'One block, .callout, with a required type. The type carries the meaning and the tone follows from it, so an author never picks a colour.',
  inline: 'Things that sit inside a sentence.',
  data: 'The shapes that carry numbers and comparisons.',
  code: 'Code, and changes to code.',
  structure: 'The blocks a spec is built out of.',
  spec: 'The three that carry machine-read state.',
};

/**
 * A family can open with a specimen: every member rendered in one continuous
 * run, at real size, in the order an author meets them.
 *
 * The per-component cards below answer "what is this one for". They cannot
 * answer "how do these relate", because each sits in its own box and the boxes
 * are the same size — four heading levels rendered that way look like four
 * headings, not like a hierarchy. A specimen is the page showing you the scale.
 *
 * Marked `data-sf-no-toc`: these headings are illustration, and without it the
 * library's own contents rail lists "Subsection" and "A label" as if they were
 * parts of the document.
 */
const FAMILY_SPECIMEN = {
  heading: `      <div class="cmp-spec" data-sf-no-toc>
        <p class="cmp-spec-cap">Specimen &#8212; every level at its real size, in order</p>
        <h2>Section</h2>
        <p>The spine of the document. Numbered, separated by a rule, and always the
        title of a <code>section</code>. This is what the contents rail treats as a
        top-level entry, and what a reader scrolls between.</p>
        <h3>Subsection</h3>
        <p>A division of a section big enough that a reader would navigate to it.
        Nested under its section in the rail. Body text stays the same size at every
        level: the hierarchy is carried by the headings, not by shrinking the prose.</p>
        <h4>Sub-subsection</h4>
        <p>The deepest level the rail lists. Reach for it when a subsection has parts
        worth navigating to. If they are not worth navigating to, they are a label.</p>
        <h5>Label</h5>
        <p>A kicker over a run of prose, not a division of the document. Deliberately
        absent from the rail: a contents list that includes every label stops being an
        outline. If it belongs in the outline, it is a sub-subsection.</p>
      </div>`,
};

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** One component: its name, rule, contract, specimen and markup. */
function entry(c) {
  const head = c.selector || (c.family === 'notice' ? `.callout.${c.name}`
    : c.kind === 'element' ? `<${c.name}>` : `.${c.name}`);
  const requires = c.requires && c.requires.length
    ? `<p class="footnote">Must contain: ${esc(c.requires.join('; '))}.</p>` : '';
  const variants = c.variants && c.variants.length
    ? `<p class="footnote">Variants: ${c.variants.map((v) => `<code>${esc(v)}</code>`).join(', ')}.</p>` : '';
  // Six of the twelve notices have no example of their own, so the specimen
  // renders the rule itself. Printing it above as prose as well says the same
  // sentence twice and doubles the length of a page whose job is to be scanned.
  const rule = c.example.includes(c.rule) ? '' : `<p class="cmp-rule">${esc(c.rule)}</p>`;
  return `      <div class="cmp" data-component="${esc(c.name)}">
        <div class="cmp-meta">
          <code class="cmp-name">${esc(head)}</code>
          ${c.tone ? `<span class="tag accent">${esc(c.tone)}</span>` : ''}
          ${rule}
          ${requires}
          ${variants}
        </div>
        <div class="cmp-demo" data-sf-no-toc>
${c.example}
        </div>
      </div>`;
}

/**
 * One layer's document. Deterministic: definition order in, definition order out.
 *
 * Defaults to `static` so every caller written before the second collection
 * existed still names the one it meant.
 */
export function buildDoc({ layer = 'static' } = {}) {
  const doc = DOCS[layer];
  if (!doc) throw new Error(`unknown layer: ${layer}`);
  const inLayer = componentsIn(layer);

  const families = FAMILIES.map((f) => {
    const items = inLayer.filter((c) => c.family === f);
    if (!items.length) return '';
    const specimen = FAMILY_SPECIMEN[f] ? `\n${FAMILY_SPECIMEN[f]}\n` : '';
    return `  <section id="${f}" data-sf-section data-family="${f}">
    <h2>${esc(FAMILY_TITLE[f] || f)} <span class="tag todo">${items.length}</span></h2>
    <p class="sub">${esc(FAMILY_LEAD[f] || '')}</p>
${specimen}    <div class="cmp-list">
${items.map(entry).join('\n')}
    </div>
  </section>`;
  }).filter(Boolean).join('\n\n');

  return `<!DOCTYPE html>
<html lang="en" data-theme="light" data-sf-components="${VERSION}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.title)}</title>
<style>
${buildCss().trim()}

  :root{
    --bg:#0f1115; --panel:#171a21; --panel2:#1d212b; --ink:#e6e8ee; --muted:#9aa3b2;
    --line:#2a2f3a; --accent:#6ea8fe; --green:#3fb950; --amber:#d29922; --red:#f85149;
    --code:#11151c; --shadow:0 1px 0 rgba(255,255,255,.02), 0 8px 24px rgba(0,0,0,.28);
    --mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  }
  :root[data-theme="light"]{
    --bg:#fbfaf7; --panel:#ffffff; --panel2:#f5f3ee; --ink:#222629; --muted:#5f6873;
    --line:#e4e0d7; --accent:#2563eb; --green:#15803d; --amber:#b45309; --red:#b91c1c;
    --code:#f1efe9; --shadow:0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06);
  }
  @media (prefers-color-scheme: light){
    :root:not([data-theme="dark"]){
      --bg:#fbfaf7; --panel:#ffffff; --panel2:#f5f3ee; --ink:#222629; --muted:#5f6873;
      --line:#e4e0d7; --accent:#2563eb; --green:#15803d; --amber:#b45309; --red:#b91c1c;
      --code:#f1efe9; --shadow:0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06);
    }
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:16px/1.7 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  a{color:var(--accent);text-decoration:none}
  code,kbd{font-family:var(--mono);font-size:.88em;background:var(--code);
    border:1px solid var(--line);border-radius:5px;padding:.08em .38em}
  pre{background:var(--code);border:1px solid var(--line);border-radius:10px;
    padding:14px 16px;overflow:auto;font-family:var(--mono);font-size:13px;line-height:1.55}
  pre code{background:none;border:none;padding:0}
  /* No table rules here. The table is a component and this page carries the
     component stylesheet, so the only tables on it — the examples — must render
     exactly as a spec renders them. A chrome copy would shadow the thing the
     page exists to demonstrate. */
  /* The width contract every served page shares: the review layer owns --maxw,
     centers .layout in the viewport, and pins its Contents rail over the left
     240px. A page that sets its own width instead renders under that rail. */
  .layout{max-width:var(--maxw,1280px);margin:0 auto}
  main{padding:40px 32px 120px}
  h1{font-size:30px;margin:0 0 6px}
  /* Scoped to the family titles on purpose. A bare h2 rule here would also land
     on the specimen below — same specificity as the heading family's own h2 and
     later in the sheet, so it wins — and the specimen would show this page's
     chrome scale instead of the scale it is documenting. That is exactly the bug
     a specimen exists to catch, so it must not be able to introduce it. */
  section[data-family] > h2{font-size:19px;margin:44px 0 6px;
    padding-top:14px;border-top:1px solid var(--line)}
  .sub{color:var(--muted);font-size:14px;margin:0 0 14px}
  /* One column, rule above specimen. A two-column gallery reads better at 1100px
     and breaks at the 820px the width contract defaults to, and a component
     library that only works at one width is the wrong thing to ship. */
  .cmp{padding:18px 0;border-top:1px solid var(--line)}
  .cmp-name{font-size:13px}
  .cmp-rule{margin:8px 0 0;font-size:13.5px;max-width:70ch}
  .cmp-meta{margin-bottom:12px}
  .cmp-meta .footnote{margin:4px 0 0}
  /* The specimen: one continuous run at real size, so the levels can be compared
     against each other rather than each read on its own. Framed and tinted so it
     is obviously a sample of the document and not part of it — a specimen that
     looks like the page is a specimen a reader mistakes for content. */
  .cmp-spec{background:var(--panel2);border:1px solid var(--line);border-radius:12px;
    padding:6px 26px 24px;margin:18px 0 26px}
  .cmp-spec-cap{margin:16px 0 0;color:var(--muted);font-size:11.5px;font-weight:700;
    letter-spacing:.09em;text-transform:uppercase}
  /* The first heading in the frame keeps its own scale but drops the section rule
     and the leading air, which exist to separate sections of a real document. */
  .cmp-spec > h2:first-of-type{margin-top:14px;padding-top:0;border-top:none}
  .cmp-spec p{max-width:68ch}
</style>
</head>
<body>
<div class="layout">
<main>
  <h1>${esc(doc.title)}</h1>
  <p class="sub">Library v${VERSION} · ${inLayer.length} components · generated from <code>components/</code> by <code>components build</code>.</p>

  <section id="how" data-sf-section>
    <div class="callout note">Every spec carries this stylesheet as a stamped block, so these classes work in any spec with nothing to import. ${esc(doc.lead)}</div>
    <div class="callout constraint">This page is generated. Comment on a component and an agent edits its definition in <code>components/</code>, then rebuilds. <strong>Source:</strong> the definitions live in git and ship with the plugin. Editing this page loses the edit at the next build.</div>
    <div class="callout warning">A submitted batch reaches whichever session owns this document, and nothing attaches it on its own. While the header reads <strong>No agent</strong>, comments are stored and delivered to nobody. Use <strong>Connect</strong> in the header, or run <code>specforge open ${doc.id}</code> in the session that should answer them.</div>
${inLayer.length ? '' : `    <div class="callout note">${esc(doc.empty)}</div>\n`}  </section>

${families}
</main>
</div>
</body>
</html>
`;
}

/** Write one layer's document into the store. Always overwrites: it is generated. */
export function writeDocFor(layer) {
  const doc = DOCS[layer];
  if (!doc) throw new Error(`unknown layer: ${layer}`);
  const path = docPath(doc.id);
  const html = buildDoc({ layer });
  mkdirSync(specDir(doc.id), { recursive: true });
  ensureMeta(doc.id, doc.title);
  const before = existsSync(path) ? readFileSync(path, 'utf8') : null;
  if (before === html) return { id: doc.id, layer, path, changed: false };
  writeFileSync(path, html);
  return { id: doc.id, layer, path, changed: true };
}

/**
 * Write every layer's document.
 *
 * Returns an array rather than one result: the build reports what changed, and a
 * caller that only heard about the static document would report a clean build on
 * a run that rewrote the interactive one.
 */
export function writeDoc() {
  return LAYERS.map(writeDocFor);
}

/**
 * A document's HTML by store id, building it on demand when the store has none.
 *
 * Built on demand because a fresh install has no store, and a 404 for a page
 * derived entirely from the plugin's own definitions is a refusal nobody could
 * act on.
 */
export function readDoc(id = DOC_ID) {
  const layer = LAYERS.find((l) => DOCS[l].id === id);
  if (!layer) throw new Error(`not a library document: ${id}`);
  const path = docPath(id);
  if (!existsSync(path)) writeDocFor(layer);
  return readFileSync(path, 'utf8');
}
