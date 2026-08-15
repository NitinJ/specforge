// Render the index page into a jsdom window with its inline script running.
//
// Lifted out of index-page.test.mjs so more than one suite can drive the home
// page's behavior. The plumbing is not incidental: the shared UI script has to
// be inlined in the same position the page asks for it, reloads have to be
// counted through jsdom's error channel because location.reload cannot be
// stubbed, and fetch has to echo the request body back so the client's optimistic
// DOM updates land. Getting any of those wrong makes a passing test meaningless,
// which is why they live in one place.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

import { renderIndex } from '../../server/daemon.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UI_JS = readFileSync(join(ROOT, 'server', 'public', 'ui.js'), 'utf8');

/**
 * @param {{after:Function}} t the node:test context, for window cleanup
 * @param {object} [opts] passed straight to renderIndex
 * @param {object} [hostOpts]
 * @param {string} [hostOpts.url] the page's own URL, for query-parameter cases
 * @param {(req:{method:string,url:string,body:any}) => any} [hostOpts.respond]
 *   override the JSON a stubbed fetch resolves with; defaults to echoing the
 *   request body back, which is what the page's optimistic updates expect
 * @returns {{window: Window, calls: Array, reloads: {n:number}}}
 */
export function loadIndex(t, opts, hostOpts = {}) {
  // location.reload is unforgeable in jsdom — it cannot be stubbed — but calling
  // it raises a jsdomError, so that is how a reload is counted. Anything else on
  // that channel is a real page error and is re-raised rather than swallowed.
  const reloads = { n: 0 };
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => {
    if (/navigation to another Document/i.test(e.message)) reloads.n += 1;
    else throw e;
  });
  // jsdom does not fetch external scripts, so the shared UI is inlined where the
  // page asks for it. Same file, same order relative to the page's own script.
  const html = renderIndex(opts).replace(
    '<script src="/public/ui.js" defer></script>',
    `<script>${UI_JS}</script>`,
  );
  // Installed in beforeParse, not after construction: the page's own script runs
  // during parsing and can fetch there (it persists a selection that arrived in
  // the URL), so a stub attached afterwards would miss the call and the test
  // would read as a missing feature.
  const calls = [];
  const stub = (window) => {
    window.fetch = (url, init) => {
      const method = (init && init.method) || 'GET';
      const body = init && init.body ? JSON.parse(init.body) : undefined;
      const call = { method, url, body };
      calls.push(call);
      const json = hostOpts.respond ? hostOpts.respond(call) : Object.assign({ ok: true }, body || {});
      return Promise.resolve({ ok: true, json: () => Promise.resolve(json) });
    };
  };
  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    url: hostOpts.url || 'http://localhost/',
    virtualConsole,
    beforeParse: stub,
  });
  const { window } = dom;
  t.after(() => window.close());
  return { window, calls, reloads };
}

/** Let the page's promise callbacks run. */
export const tick = (window) => new Promise((r) => window.setTimeout(r, 0));
