// Render the settings page into a jsdom window with its inline script running.
//
// Same shape and the same reasons as index-dom.mjs: runScripts is the whole
// point, because every control on this page does its work in the browser, and a
// test built without it asserts on markup the page never finished. fetch is
// stubbed in beforeParse rather than after construction, since the page can
// fetch during parsing.
//
// Spec 094abd0b9d, task 0.2.

import { JSDOM, VirtualConsole } from 'jsdom';

import { renderSettings } from '../../server/settings-page.mjs';

/**
 * @param {{after:Function}} t the node:test context, for window cleanup
 * @param {object} [opts] passed straight to renderSettings
 * @param {object} [hostOpts]
 * @param {string} [hostOpts.url] the page's own URL, for ?tab= cases
 * @param {'light'|'dark'} [hostOpts.scheme] what the OS preference resolves to
 * @param {(req:{method:string,url:string,body:any}) => any} [hostOpts.respond]
 *   override the JSON a stubbed fetch resolves with; defaults to echoing the
 *   request body back with ok:true
 * @returns {{window: Window, calls: Array}}
 */
export function loadSettings(t, opts, hostOpts = {}) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => { throw e; });

  const calls = [];
  const beforeParse = (window) => {
    window.fetch = (url, init) => {
      const method = (init && init.method) || 'GET';
      const body = init && init.body ? JSON.parse(init.body) : undefined;
      const call = { method, url, body };
      calls.push(call);
      const json = hostOpts.respond ? hostOpts.respond(call) : Object.assign({ ok: true }, body || {});
      return Promise.resolve({ ok: true, json: () => Promise.resolve(json) });
    };
    // jsdom never evaluates media queries, so the page's theme code would read
    // an undefined preference. A fake keeps the OS answer explicit per test.
    if (hostOpts.scheme) {
      window.matchMedia = (media) => ({
        media,
        matches: hostOpts.scheme === 'light',
        addEventListener: () => {},
        removeEventListener: () => {},
      });
    }
  };

  const dom = new JSDOM(renderSettings(opts), {
    runScripts: 'dangerously',
    url: hostOpts.url || 'http://localhost/settings',
    virtualConsole,
    beforeParse,
  });
  const { window } = dom;
  t.after(() => window.close());
  return { window, calls };
}

/** Let the page's promise callbacks run. */
export const tick = (window) => new Promise((r) => window.setTimeout(r, 0));
