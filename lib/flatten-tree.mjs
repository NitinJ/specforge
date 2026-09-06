// A subtree as one document.
//
// Two consumers, one builder: printing a parent, and exporting it to Google
// Docs. Both leave SpecForge, and a Doc has no folder, so both want the whole
// thing flattened rather than a zip. Markdown export goes the other way and
// bundles, because its consumers are a repo and another agent.
//
// The rule that decides the shape here is unique ids. Two specs both carrying a
// `tldr` section would put two elements with the same id in one document, and
// every anchor link in it would then resolve to whichever came first. So a
// descendant's ids are prefixed with its spec id, and the links inside that
// descendant are rewritten to match. The root keeps its own ids, because it is
// still itself: an anchor into the root from outside has to keep working.

import { readSpecHtml } from './store.mjs';
import { readMeta } from './meta.mjs';
import { descendantsOf } from './spec-tree.mjs';

/** Everything between <body> and </body>, or the whole thing if there is no body. */
function bodyOf(html) {
  const m = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i);
  return m ? m[1] : html;
}

/** The <head> of a document, which is where a spec keeps its style block. */
function headOf(html) {
  const m = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  return m ? m[1] : '';
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Prefix every id in a fragment, and repoint the links that named them.
 *
 * Both halves matter. Prefixing alone would leave every in-document anchor in
 * the descendant pointing at whatever now holds the unprefixed id, which after
 * flattening is usually the root's section of the same name: an anchor that
 * silently jumps to the wrong document is worse than one that goes nowhere.
 *
 * Both quote styles, and both cases. Spec HTML is written by hand and by agents
 * and all four forms are valid, so a rule that saw only `id="x"` moved half a
 * document and left the other half sitting on the ids it had just vacated —
 * exactly the collision this exists to prevent, and silently.
 */
function namespaceIds(fragment, prefix) {
  const ids = new Set();
  const withIds = fragment.replace(/\bid\s*=\s*(["'])([^"']*)\1/gi, (whole, q, id) => {
    if (!id) return whole;
    ids.add(id);
    return `id=${q}${prefix}-${id}${q}`;
  });
  return withIds.replace(/\bhref\s*=\s*(["'])#([^"']*)\1/gi, (whole, q, target) => (
    ids.has(target) ? `href=${q}#${prefix}-${target}${q}` : whole
  ));
}

/**
 * One spec's contribution to the flattened document.
 *
 * The root is spliced in as it is. A descendant is wrapped so a reader can tell
 * where one spec ends and the next begins, since after flattening there is
 * nothing else to say so.
 */
function sectionFor(id, meta, depth) {
  let html;
  try {
    html = readSpecHtml(id);
  } catch {
    // A gap, named. One unreadable descendant must not cost the whole print.
    return `<section class="sf-flat-spec sf-flat-missing" id="${esc(id)}">
  <h2 class="sf-flat-title">${esc((meta && meta.title) || id)}</h2>
  <p>This spec could not be read (<code>${esc(id)}</code>), so it is missing from this document.</p>
</section>`;
  }
  if (depth === 0) return bodyOf(html);

  const body = bodyOf(html);
  // A spec's own <h1> is its title, so adding another one above it would print
  // every child's name twice. The wrapper heading is only for a document that
  // has no heading of its own, where without it a section starts with no way to
  // tell whose it is.
  const hasOwnTitle = /<h1\b/i.test(body);
  const title = hasOwnTitle
    ? ''
    : `\n  <h2 class="sf-flat-title">${esc((meta && meta.title) || id)}</h2>`;

  return `<section class="sf-flat-spec" id="${esc(id)}" data-sf-flat-depth="${depth}">${title}
${namespaceIds(body, esc(id))}
</section>`;
}

/**
 * A spec and everything below it, as one self-contained document.
 *
 * @param {string} rootId
 * @returns {string} HTML
 */
export function flattenSubtree(rootId) {
  const rootMeta = readMeta(rootId);
  if (!rootMeta) throw new Error(`flatten: unknown spec ${rootId}`);

  const ids = descendantsOf(rootId);
  const rootHtml = readSpecHtml(rootId);

  // The root's, because the document is the root's: a descendant's stylesheet
  // applying to the whole thing would restyle its parent.
  const head = headOf(rootHtml);

  const parts = ids.map((id, i) => sectionFor(id, id === rootId ? rootMeta : readMeta(id), i === 0 ? 0 : 1));

  return `<!DOCTYPE html><html lang="en"><head>${head}
<style>
  /* Only what the seams need. Everything else is the root's own stylesheet. */
  .sf-flat-spec { margin-top: 48px; padding-top: 24px; border-top: 2px solid currentColor; }
  .sf-flat-title { margin-top: 0; }
  .sf-flat-missing { opacity: .7; }
</style></head>
<body data-sf-flat="${esc(rootId)}">
${parts.join('\n')}
</body></html>`;
}
