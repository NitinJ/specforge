// The public project index, served at /p/<token>.
//
// A directory, not a store: rows are computed per request from spec meta, which
// is what makes the page always show the project as it is now (a spec filed
// tomorrow appears; one moved out is gone). Every status is listed — a draft is
// as visible as an approved spec (spec 82f5dabccf, Q3).
//
// Read-only by construction: the page carries links and nothing else, because a
// reviewer's write surface is a spec page's comments, never the listing.

import { listSpecs } from '../lib/meta.mjs';
import { listContributions } from '../lib/store-project-shares.mjs';

function esc(s) {
  return String(s ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Compact "x ago" for the updated stamp (empty when unknown). */
function relativeTime(ts) {
  if (!ts) return '';
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** The specs currently in this project, newest first. */
export function projectSpecs(name) {
  return listSpecs()
    .filter((m) => (m.project || null) === name)
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}

/**
 * Render the project index for a share token.
 *
 * @param {string} name the project (already resolved from the token)
 * @param {string} token rides into each spec link, which is scoped to it
 */
export function renderProjectPage(name, token) {
  const local = projectSpecs(name).map((m) => `
    <li class="row">
      <a class="title" href="/p/${token}/spec/${m.id}">${esc(m.title || 'Untitled')}</a>
      <span class="type">${esc(m.type || '')}</span>
      <span class="status s-${esc(m.status || 'draft')}">${esc(m.status || 'draft')}</span>
      <span class="upd">${esc(relativeTime(m.updated))}</span>
    </li>`);

  // Contributed rows link OFF this origin, to the machine that owns the spec.
  // Nothing about them is served from here: the title and owner are the
  // metadata their contributor registered, and the link is theirs to answer.
  const contributed = listContributions(name).map((e) => `
    <li class="row">
      <a class="title" href="${esc(`${e.origin}/s/${e.token}`)}" target="_blank" rel="noopener">${esc(e.title)}</a>
      <span class="by">${esc(e.owner)}</span>
      <span class="elsewhere" title="Served from ${esc(e.origin)}">elsewhere</span>
      <span class="upd">${esc(relativeTime(Date.parse(e.addedAt) || 0))}</span>
    </li>`);

  const rows = [...local, ...contributed].join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(name)} — SpecForge</title>
<style>
  :root{--bg:#0f1115;--panel:#171a21;--ink:#e6e8ee;--muted:#9aa3b2;--line:#2a2f3a;--accent:#6ea8fe;
    --green:#3fb950;--amber:#d29922}
  @media (prefers-color-scheme: light){
    :root{--bg:#fbfaf7;--panel:#ffffff;--ink:#222629;--muted:#5f6873;--line:#e4e0d7;--accent:#2563eb;
      --green:#15803d;--amber:#b45309}
  }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
    font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
  main{max-width:860px;margin:0 auto;padding:40px 24px 80px}
  h1{font-size:22px;margin:0 0 4px}
  .sub{color:var(--muted);font-size:13px;margin:0 0 24px}
  ul{list-style:none;margin:0;padding:0}
  .row{display:flex;align-items:center;gap:12px;padding:11px 14px;border:1px solid var(--line);
    border-radius:10px;background:var(--panel);margin:8px 0}
  .title{color:var(--ink);text-decoration:none;font-weight:550;flex:1 1 auto;min-width:0;
    overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .title:hover{color:var(--accent)}
  .type{color:var(--muted);font-size:12px;white-space:nowrap}
  .status{font-size:11.5px;font-weight:600;padding:1px 8px;border-radius:999px;
    border:1px solid var(--line);white-space:nowrap}
  .s-approved{color:var(--green)} .s-review{color:var(--amber)} .s-draft{color:var(--muted)}
  .by{color:var(--muted);font-size:12px;white-space:nowrap}
  .elsewhere{font-size:11.5px;color:var(--muted);border:1px dashed var(--line);
    border-radius:999px;padding:1px 8px;white-space:nowrap}
  .upd{color:var(--muted);font-size:12px;white-space:nowrap}
  .empty{color:var(--muted);padding:24px 0}
</style>
</head>
<body>
<main>
  <h1>${esc(name)}</h1>
  <p class="sub">A shared SpecForge project. Open a spec to read and comment.</p>
  ${rows ? `<ul>${rows}</ul>` : '<p class="empty">No specs in this project right now.</p>'}
</main>
</body>
</html>`;
}
