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
 * A correctly shaped, entirely uncustomized answer.
 *
 * What the page gets when a test does not care about the data: enough for it to
 * render without throwing, and empty enough that nothing asserts against it by
 * accident.
 */
const EMPTY_STATE = {
  language: { value: '', customized: false, contract: '', max: 4000 },
  actions: { shipped: [], custom: [], groups: [] },
  type: 'design-impl',
  types: ['design-impl'],
  rules: [],
  sections: [],
  prompts: [],
  shipped: { rules: [], prompts: [] },
};

/**
 * @param {{after:Function}} t the node:test context, for window cleanup
 * @param {object} [opts] passed straight to renderSettings
 * @param {object} [hostOpts]
 * @param {string} [hostOpts.url] the page's own URL, for ?tab= cases
 * @param {'light'|'dark'} [hostOpts.scheme] what the OS preference resolves to
 * @param {(req:{method:string,url:string,body:any}) => any} [hostOpts.respond]
 *   override the JSON a stubbed fetch resolves with. The default answers with
 *   an empty but correctly shaped settings state, because the page fetches as
 *   it loads and renders from the answer: a stub that echoed the request would
 *   make the page throw after the test ended, where node reports it as an
 *   unhandled rejection rather than a failure.
 * @param {boolean} [hostOpts.clock] replace the window's timers with a clock the
 *   test drives. Anything the page schedules queues instead of firing, and
 *   `advance(ms)` runs what is due and moves Date.now with it. Without this a
 *   test for a three-minute deadline would take three minutes, and a test for a
 *   two-second poll would be a race.
 * @returns {{window: Window, calls: Array, setScheme: Function, advance: Function}}
 *   `setScheme` flips the OS preference and fires the change event, which is the
 *   only way to exercise the page's live-theme listener: jsdom never evaluates
 *   media queries, so a real scheme change cannot happen in it.
 */
export function loadSettings(t, opts, hostOpts = {}) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => { throw e; });

  const calls = [];
  // Live, not fixed: `matches` reads this on every call and the listeners are
  // kept, so setScheme below can flip the preference and fire the event the
  // page subscribes to. A fake that froze its answer would make the page's
  // live-theme path untestable while still looking stubbed.
  let scheme = hostOpts.scheme || 'dark';
  const mqListeners = [];

  // A clock the test drives, installed before the page's script runs so nothing
  // it schedules escapes. `now` is what the page reads through Date.now, and it
  // only moves when advance() moves it.
  let now = 1_600_000_000_000;
  let nextTimer = 1;
  const timers = new Map(); // id -> {due, fn, every}

  const beforeParse = (window) => {
    if (hostOpts.clock) {
      window.Date.now = () => now;
      window.setTimeout = (fn, ms) => {
        timers.set(nextTimer, { due: now + (ms || 0), fn, every: 0 });
        return nextTimer++;
      };
      window.setInterval = (fn, ms) => {
        timers.set(nextTimer, { due: now + (ms || 0), fn, every: ms || 1 });
        return nextTimer++;
      };
      window.clearTimeout = (id) => timers.delete(id);
      window.clearInterval = (id) => timers.delete(id);
    }
    window.fetch = (url, init) => {
      const method = (init && init.method) || 'GET';
      const body = init && init.body ? JSON.parse(init.body) : undefined;
      const call = { method, url, body };
      calls.push(call);
      const json = hostOpts.respond ? hostOpts.respond(call) : EMPTY_STATE;
      // A `__status` on the answer means the route refused. The page branches on
      // ok/status for its own routes, and a stub that only ever said 200 could
      // not exercise a single refusal path.
      const status = (json && json.__status) || 200;
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(json),
      });
    };
    // Navigation, intercepted at the link.
    //
    // jsdom cannot navigate, and it closes every seam a test might use to watch
    // it try: location.assign is non-configurable on Location, window.location
    // is non-configurable on window, and setting href only raises a jsdomError
    // that does not carry the URL (measured, not assumed —
    // scripts/probe-jsdom-location.mjs). So the pages here navigate by clicking
    // a real anchor, and this catches the click on the way out and records where
    // it was going, the way a client-side router would.
    window.addEventListener('click', (e) => {
      const a = e.target && e.target.closest && e.target.closest('a[href]');
      if (!a) return;
      e.preventDefault();
      window.__sfWent = a.getAttribute('href');
    }, true);
    // jsdom never evaluates media queries, so the page's theme code would read
    // an undefined preference. A fake keeps the OS answer explicit per test.
    window.matchMedia = (media) => ({
      media,
      get matches() { return scheme === 'light'; },
      addEventListener: (_, fn) => mqListeners.push(fn),
      removeEventListener: (_, fn) => {
        const at = mqListeners.indexOf(fn);
        if (at >= 0) mqListeners.splice(at, 1);
      },
      addListener: (fn) => mqListeners.push(fn),
      removeListener: (fn) => {
        const at = mqListeners.indexOf(fn);
        if (at >= 0) mqListeners.splice(at, 1);
      },
    });
  };

  const dom = new JSDOM(renderSettings(opts), {
    runScripts: 'dangerously',
    url: hostOpts.url || 'http://localhost/settings',
    virtualConsole,
    beforeParse,
  });
  const { window } = dom;
  t.after(() => window.close());
  /**
   * Move the clock and run everything that comes due, in order.
   *
   * Awaited between firings so a callback that resolves a promise has its `then`
   * run before the next one fires; without that, a poll that schedules the next
   * poll from inside a `.then` never gets scheduled.
   */
  async function advance(ms) {
    const until = now + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, t]) => t.due <= until)
        .sort((a, b) => a[1].due - b[1].due)[0];
      if (!due) break;
      const [id, timer] = due;
      now = timer.due;
      if (timer.every) timer.due = now + timer.every;
      else timers.delete(id);
      timer.fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    now = until;
  }

  return {
    window,
    calls,
    advance,
    setScheme(next) {
      scheme = next;
      for (const fn of mqListeners) fn({ matches: next === 'light' });
    },
  };
}

/**
 * Let the page's promise callbacks run.
 *
 * Node's timer, not the window's. With `clock: true` the window's setTimeout is
 * a queue that only fires when the test advances it, so scheduling the test's
 * own continuation there would wait for a clock the test has not moved yet.
 */
export const tick = () => new Promise((r) => setTimeout(r, 0));
