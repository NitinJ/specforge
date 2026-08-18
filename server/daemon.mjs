#!/usr/bin/env node
// SpecForge v2 global daemon (design §5): one server per machine, serving the
// global store at ~/.specforge. (The v1 per-project review server — server/app,
// server/start, server/api — has been retired.)
//
// Routes:
//   GET  /healthz                              → 200 {"service":"specforge","pid":N}
//   GET  /                                      → index: a table of all store specs
//   GET  /spec/<id>                             → spec.html with the review layer injected
//   GET  /api/spec/<id>/md                      → the spec as markdown: a .md, or a
//                                                 .zip when it has diagrams to carry
//   GET  /events?spec=<id>                      → SSE live-reload for a spec
//   GET  /public/*                              → review-layer client assets
//   GET/POST /api/spec/<id>/comments            → list / create threads
//   POST /api/spec/<id>/comments/submit         → freeze a review batch
//   POST /api/spec/<id>/comments/<tid>/reply    → reply to a thread
//   PATCH /api/spec/<id>/comments/<tid>/comment/<cid> → edit an unsubmitted comment
//   POST /api/spec/<id>/comments/<tid>/resolve  → resolve a thread (human)
//   GET/PUT  /api/spec/<id>/prefs               → per-spec UI prefs (theme/width/filter)
//   GET/PUT  /api/prefs                         → store-wide UI prefs (index theme,
//                                                  project list, selected project)
//   DELETE /api/spec/<id>/aside/<asideId>       → delete an aside + its threads
//   POST /api/spec/<id>/block/delete            → delete one block (section/tag/text)
//   POST /api/spec/<id>/rename                  → set title (meta + spec <h1>/<title>)
//   PATCH /api/spec/<id>/organize               → set tags / collection / project
//
// ensureServer() (below) is the singleton entrypoint every v2 command calls:
// bind the port, or find out who already has it. Holding the port IS being the
// daemon — see lib/daemon-state.mjs for why that replaced a lockfile.

import http from 'node:http';
import { watch } from 'node:fs';
import { readSpecHtml, specHtmlPath } from '../lib/store.mjs';
import { inboxDir, isReservedId, reservedIdForRoute } from '../lib/store-paths.mjs';
import { agentBusy } from '../lib/store-inbox.mjs';
import { readPublicationState } from '../lib/publication-state.mjs';
import { renderIndex } from './index-page.mjs';
import { renderSettings } from './settings-page.mjs';
import { handlePromptsGet, handlePromptsPut, handlePromptsReset } from '../lib/prompts-api.mjs';
import {
  handleTemplateBlocksGet, handleTemplateBlocksPut, handleTemplateBlocksReset,
} from '../lib/template-blocks-api.mjs';
import { readDoc } from '../lib/components-doc.mjs';
import { injectReviewLayer } from './inject.mjs';
import { serveStatic } from './static.mjs';
import { SERVICE, daemonAt, daemonUrl, defaultPort } from '../lib/daemon-state.mjs';
import {
  sendJson, readJsonBody, handleCommentsGet, handleCommentCreate,
  handleCommentReply, handleCommentResolve, handleCommentEdit, handleAnchorPatch, handleSubmit,
  handleMeta, handleStatus, handleResolveAll, handleDetach,
  handlePrefsGet, handlePrefsPut, handleGlobalPrefsGet, handleGlobalPrefsPut,
  handleBlocksGet, handleBlocksPut,
  handleRename, handleOrganize, handleExport, handleDelete, handleAsideDelete, handleBlockDelete,
} from '../lib/store-api.mjs';
import { ensureTemplates } from '../lib/store-templates.mjs';
import { createPublications } from '../lib/publications.mjs';
import { renderMd } from '../lib/store-md.mjs';
import { readSubscriptions, parseShareUrl } from '../lib/store-subscriptions.mjs';
import { contributeSpec, withdrawSpec } from '../lib/contribute.mjs';
import { readShareToken } from '../lib/store-share.mjs';
import { readMeta } from '../lib/meta.mjs';
import { zip } from '../lib/zip.mjs';

// Publications live for the daemon's lifetime, which is what lets a share
// outlive the terminal that made it. One registry per process.
export const publications = createPublications();


// The index page lives in index-page.mjs; re-exported here because tests and
// callers import it from the daemon (the module that serves it).
export { renderIndex, renderSettings };

/**
 * Whether a URL names a shared project this machine has joined.
 *
 * The membership check behind the contribute route: joining is the deliberate
 * act that makes a destination trusted, so anything not joined is refused
 * before a spec is published or a token leaves.
 */
function isJoinedProject(url) {
  const parsed = parseShareUrl(url);
  if (!parsed) return false;
  return readSubscriptions()
    .some((s) => s.origin === parsed.origin && s.token === parsed.token);
}

function send(res, status, type, body) {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}

/**
 * Hand the spec over as markdown.
 *
 * A plain .md when the spec has no diagrams, a zip when it does: a browser
 * download is one file, and inline SVG does not survive a markdown renderer, so
 * the diagrams have to travel as sidecar files.
 *
 * Rendered per request and never stored. Unlike the Google Docs export this
 * needs no session relay, because nothing outside the process has to run.
 *
 * Daemon-only by construction: the gateway (lib/gateway.mjs) serves nothing but
 * /public/* and /s/<token>/*, so no share link can reach this.
 */
function serveMarkdown(id, res) {
  let rendered;
  try {
    rendered = renderMd(id);
  } catch (err) {
    return sendJson(res, 404, { error: err.message });
  }
  // The slug is already [a-z0-9-]; the guard is for a title that slugged to
  // nothing and fell back to the id, and for anything a future slug lets past.
  // Leading dots go too, so the name can never be `..` or a dotfile.
  const base = (rendered.slug || id).replace(/[^\w.-]/g, '').replace(/^\.+/, '') || 'spec';

  if (!rendered.assets.length) {
    res.writeHead(200, {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${base}.md"`,
      'Cache-Control': 'no-store',
    });
    return res.end(rendered.markdown);
  }

  const archive = zip([
    { name: `${base}.md`, data: rendered.markdown },
    ...rendered.assets.map((a) => ({ name: `${base}.assets/${a.name}`, data: a.svg })),
  ]);
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Disposition': `attachment; filename="${base}.zip"`,
    'Content-Length': archive.length,
    'Cache-Control': 'no-store',
  });
  return res.end(archive);
}

function serveSpec(id, res) {
  let html;
  // A reserved entry has a spec's layout on disk, which is what makes the review
  // APIs work on it. This route is where the difference is enforced: the library
  // document is reached at /components or not at all.
  if (isReservedId(id)) return send(res, 404, 'text/plain; charset=utf-8', 'spec not found');
  try {
    html = readSpecHtml(id);
  } catch {
    return send(res, 404, 'text/plain; charset=utf-8', 'spec not found');
  }
  send(res, 200, 'text/html; charset=utf-8', injectReviewLayer(html, { specId: id }));
}

/**
 * The component library, as a page a human can comment on.
 *
 * It gets the review layer under its reserved id, so comments land in the store
 * beside it and reach the attached session through the batch mechanism specs
 * already use. Built on demand: a fresh install has no store yet, and answering
 * with a 404 for a document that is entirely derived from the plugin's own
 * definitions would be a refusal nobody could act on.
 *
 * The build writes to disk, so it can fail on a read-only or full store. That
 * failure is this request's to report: thrown from here it would reach no
 * handler and take the daemon, and every other spec in the browser, down with it.
 */
function serveComponentsDoc(id, res) {
  let html;
  try {
    html = injectReviewLayer(readDoc(id), { specId: id });
  } catch (e) {
    return send(res, 500, 'text/plain; charset=utf-8',
      `could not build the component library: ${e.message}`);
  }
  send(res, 200, 'text/html; charset=utf-8', html);
}

/**
 * SSE live-reload: push a `reload` event when the spec's spec.html changes.
 *
 * Held while an agent is mid-round. Answering a batch of comments is many writes
 * — a reply, a section rewritten, a table amended — and reloading on each one
 * threw the reader back to the top of a document that was still being edited.
 * The round is the unit worth seeing, so the writes coalesce into one reload
 * when the agent marks the batch done, which is the same moment the action
 * button turns into "Review replies".
 */
function serveEvents(id, req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
  res.write(': connected\n\n');

  let closed = false;
  const safeWrite = (chunk) => {
    if (closed) return;
    try { res.write(chunk); } catch { closed = true; }
  };

  let debounce = null;
  let watcher = null;
  let inbox = null;
  let held = false; // the spec moved while an agent had it

  // The release edge is a batch file being removed, so watch for it rather than
  // polling: without this the held reload would wait for the next spec write,
  // which on a finished round never comes. Armed at the moment of the first hold
  // rather than up front — that is when a batch is known to exist, so the inbox
  // directory does too, and merely opening a page never creates one.
  const armInbox = () => {
    if (inbox || closed) return;
    try {
      inbox = watch(inboxDir(id), () => { if (!closed && held) flush(); });
    } catch {
      inbox = null;
    }
  };
  const flush = () => {
    if (closed) return;
    // Drop any spec-write timer still pending. Both watchers call this, so a
    // final save landing within the debounce of the batch being marked done
    // would otherwise release the held reload here and fire a second one when
    // that timer caught up — two reloads for one round.
    if (debounce) { clearTimeout(debounce); debounce = null; }
    if (agentBusy(id)) { held = true; armInbox(); return; }
    held = false;
    safeWrite('event: reload\ndata: {}\n\n');
  };
  try {
    watcher = watch(specHtmlPath(id), () => {
      if (closed) return;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(flush, 100);
      debounce.unref?.();
    });
  } catch {
    watcher = null; // spec may not exist yet / be unreadable — heartbeat-only stream
  }
  const heartbeat = setInterval(() => safeWrite(': ping\n\n'), 25000);
  heartbeat.unref?.();

  const cleanup = () => {
    closed = true;
    clearInterval(heartbeat);
    if (debounce) clearTimeout(debounce);
    if (watcher) { try { watcher.close(); } catch { /* already closed */ } }
    if (inbox) { try { inbox.close(); } catch { /* already closed */ } }
  };
  req.on('close', cleanup);
  req.on('error', cleanup);
}

/** Methods that change nothing, so an Origin they came from does not matter. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * True when a request either carries no Origin or carries this daemon's own.
 *
 * Compared against the request's Host rather than a fixed origin, because the
 * same daemon answers on 127.0.0.1 and on localhost and a page served from
 * either is its own page.
 */
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

/**
 * Create the v2 daemon HTTP server (no listen — caller binds).
 * @returns {import('node:http').Server}
 */
export function createDaemon({ publications: pubs = publications } = {}) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const method = req.method;

    // Loopback is not a boundary a browser respects. A page on any site can
    // aim a form at 127.0.0.1:4180, and the request arrives authenticated by
    // nothing more than the user owning the machine, so every state-changing
    // request has to have come from one of this daemon's own pages. Absent
    // Origin means a non-browser client, the CLI or a test, which is the one
    // thing a page cannot forge.
    if (!SAFE_METHODS.has(method) && !sameOrigin(req)) {
      return sendJson(res, 403, { error: 'cross-origin request refused' });
    }

    // --- Store-wide prefs (the index theme) ---
    if (path === '/api/prefs') {
      if (method === 'GET') return handleGlobalPrefsGet(res);
      if (method === 'PUT') {
        return readJsonBody(req)
          .then((b) => handleGlobalPrefsPut(b, res))
          // Deleting a project edits the prefs registry, which can be the last
          // thing keeping an empty published project in existence. The sweep
          // runs behind the response; nobody waits on it.
          .then(() => { pubs.sweepProjects(); })
          .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    // --- Prompt customizations (the configuration pane) ---
    //
    // Loopback only, like every owner surface: these routes are on the daemon,
    // not the gateway, so no share token reaches them. A reviewer cannot change
    // what the owner's agents are told.
    if (path === '/api/prompts') {
      if (method === 'GET') return sendJson(res, 200, handlePromptsGet());
      if (method === 'PUT') {
        return readJsonBody(req)
          .then((b) => sendJson(res, 200, handlePromptsPut(b)))
          .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    if (path === '/api/prompts/reset') {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => {
          try {
            return sendJson(res, 200, handlePromptsReset(b && b.class));
          } catch (e) {
            return sendJson(res, 400, { error: e.message });
          }
        })
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }

    // Per-type prompts and rules, which live in the template specs rather than
    // in prompts.json: the pane edits the blocks that were already there.
    const tb = path.match(/^\/api\/template\/([\w-]+)\/blocks$/);
    if (tb) {
      const type = tb[1];
      const answer = (fn, ...args) => {
        try {
          return sendJson(res, 200, fn(...args));
        } catch (e) {
          return sendJson(res, 400, { error: e.message });
        }
      };
      if (method === 'GET') return answer(handleTemplateBlocksGet, type);
      if (method === 'PUT') {
        return readJsonBody(req)
          .then((b) => answer(handleTemplateBlocksPut, type, b))
          .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
      }
      if (method === 'POST') {
        // The class travels in the body: the two tabs share this route, and a
        // reset that named neither used to clear both (raised in review).
        return readJsonBody(req)
          .then((b) => answer(handleTemplateBlocksReset, type, b && b.class))
          .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    // --- Comments API (store-keyed) ---
    const list = path.match(/^\/api\/spec\/([\w-]+)\/comments$/);
    if (list) {
      if (method === 'GET') return handleCommentsGet(list[1], res);
      if (method === 'POST') {
        return readJsonBody(req)
          .then((b) => handleCommentCreate(list[1], b, res))
          .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    const submit = path.match(/^\/api\/spec\/([\w-]+)\/comments\/submit$/);
    if (submit) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleSubmit(submit[1], res);
    }
    const reply = path.match(/^\/api\/spec\/([\w-]+)\/comments\/([\w-]+)\/reply$/);
    if (reply) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleCommentReply(reply[1], reply[2], b, res))
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const editC = path.match(/^\/api\/spec\/([\w-]+)\/comments\/([\w-]+)\/comment\/([\w-]+)$/);
    if (editC) {
      if (method !== 'PATCH') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleCommentEdit(editC[1], editC[2], editC[3], b, res))
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const anchorP = path.match(/^\/api\/spec\/([\w-]+)\/comments\/([\w-]+)\/anchor$/);
    if (anchorP) {
      if (method !== 'PATCH') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleAnchorPatch(anchorP[1], anchorP[2], b, res))
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const resolveAll = path.match(/^\/api\/spec\/([\w-]+)\/comments\/resolve-all$/);
    if (resolveAll) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleResolveAll(resolveAll[1], res);
    }
    const resolve = path.match(/^\/api\/spec\/([\w-]+)\/comments\/([\w-]+)\/resolve$/);
    if (resolve) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleCommentResolve(resolve[1], resolve[2], res);
    }
    const meta = path.match(/^\/api\/spec\/([\w-]+)\/meta$/);
    if (meta) {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      // The registry, not the file, composes the public URL and decides whether
      // it actually serves: the record holds only a token.
      return handleMeta(meta[1], res, (id) => pubs.shareInfo(id));
    }
    const status = path.match(/^\/api\/spec\/([\w-]+)\/status$/);
    if (status) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleStatus(status[1], b, res))
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const prefs = path.match(/^\/api\/spec\/([\w-]+)\/prefs$/);
    if (prefs) {
      if (method === 'GET') return handlePrefsGet(prefs[1], res);
      if (method === 'PUT') {
        return readJsonBody(req)
          .then((b) => handlePrefsPut(prefs[1], b, res))
          .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    const blocks = path.match(/^\/api\/spec\/([\w-]+)\/blocks$/);
    if (blocks) {
      if (method === 'GET') return handleBlocksGet(blocks[1], res);
      if (method === 'PUT') {
        return readJsonBody(req)
          .then((b) => handleBlocksPut(blocks[1], b, res))
          .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    // The aside id is a section id, and section ids are author-written: a dot in
    // one is legal, so the pattern is "not a slash" rather than a word class.
    const aside = path.match(/^\/api\/spec\/([\w-]+)\/aside\/([^/]+)$/);
    if (aside) {
      if (method !== 'DELETE') return sendJson(res, 405, { error: 'method not allowed' });
      // decodeURIComponent throws on a malformed escape (`%zz`), and nothing
      // wraps this router: a synchronous throw here leaves the request handler
      // as an uncaughtException and takes the daemon down for every spec open
      // in every tab. A bad URL is a 400.
      let asideId;
      try {
        asideId = decodeURIComponent(aside[2]);
      } catch {
        return sendJson(res, 400, { error: 'malformed aside id' });
      }
      return handleAsideDelete(aside[1], asideId, res);
    }
    const blockDel = path.match(/^\/api\/spec\/([\w-]+)\/block\/delete$/);
    if (blockDel) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleBlockDelete(blockDel[1], b, res))
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const rename = path.match(/^\/api\/spec\/([\w-]+)\/rename$/);
    if (rename) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleRename(rename[1], b, res))
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const organize = path.match(/^\/api\/spec\/([\w-]+)\/organize$/);
    if (organize) {
      if (method !== 'PATCH') return sendJson(res, 405, { error: 'method not allowed' });
      return readJsonBody(req)
        .then((b) => handleOrganize(organize[1], b, res))
        // Moving a spec can empty a published project (a rename is N of these
        // moves). The sweep retires such shares without waiting for a restart.
        .then(() => { pubs.sweepProjects(); })
        .catch(() => sendJson(res, 400, { error: 'invalid JSON body' }));
    }
    const det = path.match(/^\/api\/spec\/([\w-]+)\/detach$/);
    if (det) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleDetach(det[1], res);
    }
    // List this spec in someone else's shared project, or take it back out.
    // The publish step is in-process here (the CLI asks over HTTP instead);
    // everything after it is the shared path in lib/contribute.mjs, so the two
    // callers cannot drift.
    const contrib = path.match(/^\/api\/spec\/([\w-]+)\/contribute$/);
    if (contrib) {
      const specId = contrib[1];
      if (method !== 'POST' && method !== 'DELETE') {
        return sendJson(res, 405, { error: 'method not allowed' });
      }
      if (!readMeta(specId)) return sendJson(res, 404, { error: `unknown spec ${specId}` });
      return readJsonBody(req)
        .then((b) => {
          const url = b && b.url;
          // Only a project this machine has joined. Contributing publishes the
          // spec and hands its token to the destination, so an unrestricted
          // route would let anything that can reach loopback disclose a spec
          // capability to an origin nobody here ever agreed to. Joining is the
          // agreement, and it is a deliberate act on this machine.
          //
          // The CLI stays unrestricted on purpose: there, the URL is one a
          // person pasted, which is the same act as joining.
          if (!isJoinedProject(url)) {
            return sendJson(res, 403, {
              error: 'contribute: not a project this machine has joined; run `specforge join <url>` first',
            });
          }
          if (method === 'DELETE') {
            return withdrawSpec({
              specId,
              projectUrl: url,
              currentToken: () => readShareToken(specId),
            }).then((out) => sendJson(res, 200, out));
          }
          return contributeSpec({
            specId,
            projectUrl: url,
            title: readMeta(specId).title,
            owner: b && b.owner,
            share: () => pubs.share(specId),
          }).then((out) => sendJson(res, 201, out));
        })
        .catch((e) => sendJson(res, 400, { error: e.message }));
    }

    const exp = path.match(/^\/api\/spec\/([\w-]+)\/export$/);
    if (exp) {
      if (method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
      return handleExport(exp[1], res);
    }
    // The projects this machine has joined, for the spec menu's "Add to a
    // shared project" picker. The URL is composed here rather than by the page,
    // because the record holds an origin and a token and the page should not be
    // in the business of knowing how they combine.
    if (path === '/api/subscriptions') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      return sendJson(res, 200, {
        subscriptions: readSubscriptions().map((s) => ({
          name: s.name, origin: s.origin, token: s.token, url: `${s.origin}/p/${s.token}`,
        })),
      });
    }

    // --- Publications (loopback only; a publication never serves these) ---
    if (path === '/api/shares') {
      if (method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
      // The origin and the local port are reported alongside the list because
      // this is the surface for answering why a link is not working.
      return sendJson(res, 200, {
        origin: pubs.origin(),
        localPort: pubs.localPort(),
        shares: pubs.list(),
        projects: pubs.listProjects(),
      });
    }
    // A project name arrives URL-encoded (names carry spaces); decoded before it
    // reaches the registry, which normalizes it the way the store does.
    const pshareR = path.match(/^\/api\/project\/([^/]+)\/share$/);
    if (pshareR) {
      let name;
      try {
        name = decodeURIComponent(pshareR[1]);
      } catch {
        return sendJson(res, 400, { error: 'malformed project name' });
      }
      if (method === 'POST') {
        return readJsonBody(req).catch(() => ({}))
          .then((b) => pubs.shareProject(name, { rotate: !!(b && b.rotate) }))
          .then((share) => sendJson(res, 201, { ok: true, share }))
          .catch((e) => sendJson(res, 400, { error: e.message }));
      }
      if (method === 'DELETE') {
        return pubs.unshareProject(name)
          .then((was) => sendJson(res, 200, { ok: true, wasPublished: was }))
          .catch((e) => sendJson(res, 400, { error: e.message }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }
    const shareR = path.match(/^\/api\/spec\/([\w-]+)\/share$/);
    if (shareR) {
      if (method === 'POST') {
        // rotate revokes the token already sent and mints a new one, which is
        // the only way to kill a link without unpublishing the spec.
        return readJsonBody(req).catch(() => ({}))
          .then((b) => pubs.share(shareR[1], { rotate: !!(b && b.rotate) }))
          .then((share) => sendJson(res, 201, { ok: true, share }))
          .catch((e) => sendJson(res, 400, { error: e.message }));
      }
      if (method === 'DELETE') {
        return pubs.unshare(shareR[1])
          .then((was) => sendJson(res, 200, { ok: true, wasPublished: was }))
          .catch((e) => sendJson(res, 400, { error: e.message }));
      }
      return sendJson(res, 405, { error: 'method not allowed' });
    }

    // Bare spec resource — DELETE removes it (the id is anchored, so this never
    // shadows the /meta, /prefs, /comments, … sub-routes above).
    const specRes = path.match(/^\/api\/spec\/([\w-]+)$/);
    if (specRes) {
      if (method !== 'DELETE') return sendJson(res, 405, { error: 'method not allowed' });
      // Revoke first, and keep new shares for this spec refused for the whole
      // delete. The delete removes the directory holding the share record, so a
      // share committing anywhere inside it would leave a public URL serving a
      // spec that no longer exists, with nothing on disk left to find it by.
      return pubs.unshareThen(specRes[1], () => handleDelete(specRes[1], res))
        // Deleting the last spec of a published project empties it, the same
        // way an organize move can. Swept behind the response, like the others.
        .then(() => { pubs.sweepProjects(); })
        .catch((e) => sendJson(res, 500, { error: e.message }));
    }

    if (method === 'GET') {
      // The body is the daemon's identity, not a formality: ensureServer reads
      // "something is on this port" as "the daemon is already up", so it has to
      // be able to tell us from any other server that happens to hold it. The
      // pid is here because the port is now the only handle on the daemon —
      // `curl /healthz` is how you find out what to kill.
      if (path === '/healthz') return sendJson(res, 200, { service: SERVICE, pid: process.pid });
      // The index shows a Shared marker per spec; the registry, not the record
      // on disk, decides whether that link actually answers.
      if (path === '/') {
        // ?project= is how a spec page's header chip opens the home page on the
        // project that spec is in. It overrides the stored selection for this
        // render only; the page persists it the same way a rail click does, so
        // the GET stays free of side effects.
        return send(res, 200, 'text/html; charset=utf-8',
          renderIndex({
            shareInfo: (id) => pubs.shareInfo(id),
            projectShareInfo: (name) => pubs.projectShareInfo(name),
            project: url.searchParams.get('project'),
          }));
      }
      // The configuration page. Loopback only, like every owner surface: it is
      // not on the gateway socket, so no share token can reach it.
      if (path === '/settings') {
        return send(res, 200, 'text/html; charset=utf-8',
          renderSettings({ tab: url.searchParams.get('tab') }));
      }
      if (path === '/events') return serveEvents(url.searchParams.get('spec') || '', req, res);
      // The same mtimes a published copy polls. A spec tab that let go of its
      // event stream while hidden asks this on the way back, to find out whether
      // the document moved while it was not listening.
      const st = path.match(/^\/api\/spec\/([\w-]+)\/state$/);
      if (st) return sendJson(res, 200, readPublicationState(st[1]));
      const md = path.match(/^\/api\/spec\/([\w-]+)\/md$/);
      if (md) return serveMarkdown(md[1], res);
      // The library documents, one per layer. Served with the review layer like a
      // spec, because being commentable is the point of them living in the store,
      // but they are not specs: no lifecycle, no sections contract, generated.
      // Routed from the same map that store-paths uses to refuse them under
      // /spec/, so a route and its refusal cannot disagree.
      const reserved = reservedIdForRoute(path);
      if (reserved) return serveComponentsDoc(reserved, res);
      const sm = path.match(/^\/spec\/([\w-]+)$/);
      if (sm) return serveSpec(sm[1], res);
      const pub = path.match(/^\/public\/([\w.-]+)$/);
      if (pub) return serveStatic(pub[1], res, req);
    }

    return send(res, 404, 'text/plain; charset=utf-8', 'not found');
  });
}

/**
 * Bind exactly this port, or reject.
 *
 * The rejection is the feature. Its predecessor walked to the next free port on
 * EADDRINUSE, which turned "someone else is already the daemon" — the answer the
 * caller was looking for — into a second daemon nobody would ever address.
 */
function listenOn(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (err) => { server.off('listening', onListening); reject(err); };
    const onListening = () => { server.off('error', onError); resolve(); };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Singleton daemon entrypoint. Returns the base url of the daemon, starting one
 * in-process if the port is free.
 *
 * The port is the election. Bind it and you are the daemon; get EADDRINUSE and
 * someone else already is, so hand back their url and start nothing. Two
 * simultaneous callers need no coordination between them — the kernel picks the
 * winner, and the loser finds it by asking.
 *
 * A stranger on the port is the one case that fails, deliberately and loudly.
 * The old code walked to the next free port there, which is how a machine ends
 * up with several daemons: each one serves specs perfectly and answers health
 * checks, but only the first can hold the publication gateway, so the others
 * look fine until someone clicks Share.
 *
 * @returns {Promise<{url:string, server:import('node:http').Server|null, port:number}>}
 *   server is null when an existing daemon was reused.
 */
export async function ensureServer({ port = defaultPort() } = {}) {
  const server = createDaemon();
  try {
    await listenOn(server, port, '127.0.0.1');
  } catch (err) {
    if (err.code !== 'EADDRINUSE') throw err;
    const url = daemonUrl(port);
    // Asked more than once, because the daemon that just beat us to the port
    // binds before it finishes starting: it can be seeding templates or
    // restoring publications when we knock, and one unanswered probe is not
    // proof of a stranger. Getting this wrong would print the most misleading
    // message in the file about the most normal event there is.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0) await sleep(300);
      if (await daemonAt(url)) return { url, server: null, port };
    }
    throw new Error(
      `port ${port} is held by a process that is not SpecForge — free it, or set SPECFORGE_PORT`,
    );
  }
  const boundPort = server.address().port;
  const url = daemonUrl(boundPort);

  // Seeding the per-type template specs belongs to whoever won the port, which
  // is why it happens here and not before the bind (idempotent either way —
  // existing/edited templates are untouched). Best-effort: a failed seed
  // (read-only/full disk) must not abort startup, and create falls back to the
  // bundled shells anyway.
  try {
    ensureTemplates();
  } catch {
    /* templateHtmlFor falls back to the bundled shells */
  }

  // Republish on the tokens the previous daemon minted, which is what makes the
  // links it handed out keep working. Records from the older per-spec-tunnel
  // scheme cannot be honoured and are reaped instead.
  try {
    await publications.restore();
  } catch {
    /* a share record we cannot read must not stop the daemon starting */
  }

  // Mirror the listener onto IPv6 loopback (best-effort). A Windows browser
  // resolves `localhost` to ::1 first — under WSL2 mirrored networking an
  // IPv4-only bind makes localhost links flake while 127.0.0.1 works. Same
  // port, same handler; skipped silently where ::1 is unavailable. EADDRINUSE
  // is retried briefly: on a fast restart the previous daemon's ::1 socket can
  // still be closing after its IPv4 one has gone, and giving up on the first
  // conflict would silently regress to IPv4-only.
  let server6 = null;
  for (let attempt = 0; attempt < 3 && !server6; attempt++) {
    if (attempt > 0) await sleep(150);
    const candidate = createDaemon();
    try {
      await new Promise((resolve, reject) => {
        candidate.once('error', reject);
        candidate.listen(boundPort, '::1', resolve);
      });
      candidate.on('error', () => {}); // a later runtime error must never crash the daemon
      server6 = candidate;
    } catch (err) {
      if (err.code !== 'EADDRINUSE') break; // no IPv6 / other failure → skip for good
    }
  }

  // The two listeners are one daemon, so closing the v4 one closes the v6 one.
  // This is the whole of what shutdown owes the world now: there are no files
  // to clean up, and the OS reclaims both sockets when the process dies, however
  // it dies.
  if (server6) server.on('close', () => server6.close());

  return { url, server, port: boundPort };
}

// Runnable like start.mjs: `node server/daemon.mjs` starts the daemon and keeps
// it alive until SIGINT/SIGTERM.
const isMain = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  ensureServer().then(({ url, server }) => {
    if (!server) {
      console.log(`SpecForge daemon already running: ${url}`);
      process.exit(0);
    }
    console.log(`SpecForge daemon: ${url}`);
    // The listeners need no help — the OS reclaims both sockets whatever kills
    // this process. The tunnel does: a cloudflared child outlives its parent, so
    // exiting without waiting leaves a public endpoint up with nothing tracking
    // it. stopAll() resolves only once each child has actually exited (SIGTERM,
    // escalating to SIGKILL), so this is the one place that can guarantee it;
    // startup reaping is the backstop for a daemon that was killed outright.
    // server.close() then drains in-flight requests before exit.
    let shuttingDown = false;
    const shutdown = () => {
      if (shuttingDown) return;
      shuttingDown = true;
      publications.stopAll()
        .catch(() => { /* reaped by clearStale on the next start */ })
        .then(() => server.close(() => process.exit(0)));
    };
    for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, shutdown);
  }).catch((err) => {
    console.error(`daemon failed to start: ${err.message}`);
    process.exit(1);
  });
}
