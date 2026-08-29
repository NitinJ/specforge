// Links from one spec to another, when the spec is served through a share.
//
// A spec written on the owner's machine links to its neighbours as `/spec/<id>`,
// which is an address on the daemon. The gateway does not serve that path: it
// serves `/p/<token>/spec/<id>` and `/s/<token>`, and everything else falls to
// the default deny. So every cross-spec link in a shared spec was a 404, and a
// project of linked specs was readable one page at a time.
//
// Inside a shared project the link can work, and should: membership in the
// project is already the capability, checked per request on that route.
//
// Outside it the link cannot work, and the page says so rather than sending the
// reader to a 404. That includes a single-spec share, which has no project to be
// inside: sharing one spec grants one spec, and a token is deliberately not
// derived from anything another token could reach.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'sf-gw-links-'));
process.env.SPECFORGE_HOME = home;

const { createGatewayServer } = await import('../lib/gateway.mjs');
const { specDir, specHtmlPath } = await import('../lib/store-paths.mjs');
const { newToken } = await import('../lib/tokens.mjs');

/** A spec whose body carries every shape of cross-spec link found in the store. */
function seed(id, { project = null, body = '' } = {}) {
  mkdirSync(specDir(id), { recursive: true });
  writeFileSync(specHtmlPath(id), `<!DOCTYPE html><html><head><title>${id}</title></head>`
    + `<body>${body}</body></html>`);
  writeFileSync(join(specDir(id), 'meta.json'), JSON.stringify({
    id, title: id, status: 'draft', project, updated: Date.now(),
  }));
}

const LINKS = [
  '<a href="/spec/mate">root relative</a>',
  '<a href="/spec/mate#design">with an anchor</a>',
  '<a href="http://127.0.0.1:4180/spec/mate">absolute</a>',
  '<a href="http://127.0.0.1:4180/spec/mate#design">absolute with an anchor</a>',
  '<a href="/spec/stranger">to another project</a>',
  '<a href="https://example.com/spec/mate">an unrelated site that looks like one</a>',
  '<a href="#local">an anchor on this page</a>',
].join('\n');

// The same links written the other two ways HTML allows. `specforge import`
// takes an HTML file as it finds it, so a spec in the store can carry any of
// them, and a rewrite that only reads double quotes leaves those broken exactly
// as before while reporting itself done.
const QUOTING = [
  "<a href='/spec/mate'>single quoted</a>",
  '<a href=/spec/mate>unquoted</a>',
  "<a href='/spec/stranger'>single quoted, out of project</a>",
  '<a href=/spec/stranger>unquoted, out of project</a>',
  "<a href='https://example.com/spec/mate'>single quoted, someone else's</a>",
].join('\n');

const specTokens = new Map();
const projectTokens = new Map();

let server;
let base;

before(async () => {
  seed('linker', { project: 'atelier', body: LINKS });
  seed('quoted', { project: 'atelier', body: QUOTING });
  seed('query', {
    project: 'atelier',
    body: '<a href="/spec/mate?from=1&amp;to=2">carries a query</a>',
  });
  seed('custom', {
    project: 'atelier',
    body: '<a-card href="/spec/mate">a custom element, not an anchor</a-card>',
  });
  seed('decoy', {
    project: 'atelier',
    body: '<a title="see href=/spec/mate for the shape" href="/spec/stranger">decoy first</a>',
  });
  seed('gtattr', {
    project: 'atelier',
    body: '<a title="draft > review > done" href="/spec/mate">after a raw gt</a>\n'
      + '<a title="a > b" href="/spec/stranger">out of project, same shape</a>',
  });
  seed('mate', { project: 'atelier', body: '<p>the neighbour</p>' });
  seed('stranger', { project: 'other', body: '<p>elsewhere</p>' });

  server = createGatewayServer(
    (t) => specTokens.get(t) || null,
    (t) => projectTokens.get(t) || null,
  );
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((r) => server.close(r));
  rmSync(home, { recursive: true, force: true });
});

const hrefs = (html) => [...html.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map((m) => m[1]);

// --- inside a shared project ------------------------------------------------

test('a link to a spec in the same project points into the same share', async () => {
  const token = newToken();
  projectTokens.set(token, 'atelier');
  const html = await (await fetch(`${base}/p/${token}/spec/linker`)).text();

  // Not every href mentioning "mate": example.com's does too, and it is
  // deliberately left alone by the test below.
  const toMate = hrefs(html).filter((h) => /^(\/|http:\/\/127\.0\.0\.1)/.test(h) && h.includes('mate'));
  assert.equal(toMate.length, 4, `expected the four ours-shaped links, got ${toMate.join(' ')}`);
  for (const h of toMate) {
    assert.ok(h.startsWith(`/p/${token}/spec/mate`), `not rewritten: ${h}`);
  }
});

test('the anchor survives the rewrite', async () => {
  const token = newToken();
  projectTokens.set(token, 'atelier');
  const html = await (await fetch(`${base}/p/${token}/spec/linker`)).text();
  assert.ok(hrefs(html).includes(`/p/${token}/spec/mate#design`), hrefs(html).join(' '));
});

test('the rewritten link actually resolves', async () => {
  // The point of the whole change: following it lands on the neighbour rather
  // than on the default deny.
  const token = newToken();
  projectTokens.set(token, 'atelier');
  const html = await (await fetch(`${base}/p/${token}/spec/linker`)).text();
  const href = hrefs(html).find((h) => h.endsWith('/spec/mate'));

  const res = await fetch(`${base}${href}`);
  assert.equal(res.status, 200);
  assert.match(await res.text(), /the neighbour/);
});

test('a link to a spec outside the project does not pretend to work', async () => {
  const token = newToken();
  projectTokens.set(token, 'atelier');
  const html = await (await fetch(`${base}/p/${token}/spec/linker`)).text();

  assert.ok(!hrefs(html).some((h) => h.includes('stranger')),
    'an out-of-project link kept an href, and it goes to a 404');
  assert.match(html, /data-sf-unshared="stranger"/);
});

// --- a single shared spec ---------------------------------------------------

test('a single-spec share does not turn its links into other shares', async () => {
  // The gateway's isolation property: a token is never derived from a spec id,
  // so holding one published spec's link says nothing about any other. Rewriting
  // these would hand out access that was never granted, even between two specs
  // the same person published.
  const token = newToken();
  specTokens.set(token, 'linker');
  const html = await (await fetch(`${base}/s/${token}`)).text();

  // example.com's link survives and is meant to, so the check is that no href
  // of ours points anywhere.
  const ours = hrefs(html).filter((h) => /^(\/|https?:\/\/127\.0\.0\.1)/.test(h) && h.includes('/spec/'));
  assert.deepEqual(ours, [], `a single-spec share offered a way out: ${ours.join(' ')}`);
  assert.match(html, /data-sf-unshared="mate"/);
});

// --- however the href was written -------------------------------------------

test('a single-quoted or unquoted href is rewritten too', async () => {
  // Raised in review of #251. `specforge import` takes an HTML file as it finds
  // it, so a spec can carry any of the three forms HTML allows, and a rewrite
  // that reads only double quotes leaves the others broken exactly as before
  // while reporting itself done.
  const token = newToken();
  projectTokens.set(token, 'atelier');
  const html = await (await fetch(`${base}/p/${token}/spec/quoted`)).text();

  const all = [...html.matchAll(/<a\b[^>]*?href\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/g)]
    .map((m) => m[1].replace(/^['"]|['"]$/g, ''));
  const ours = all.filter((h) => /^(\/|https?:\/\/127\.0\.0\.1)/.test(h));

  assert.ok(ours.length, 'no links of ours survived at all');
  for (const h of ours) {
    assert.ok(h.startsWith(`/p/${token}/spec/mate`), `left pointing at the daemon: ${h}`);
  }
  assert.equal((html.match(/data-sf-unshared="stranger"/g) || []).length, 2,
    'both out-of-project links, in both quotings, were disarmed');
  assert.match(html, /example\.com\/spec\/mate/);
});

test('an attribute holding a raw > does not hide the href behind it', async () => {
  // Also from review of #251. A `>` inside a quoted attribute value is legal,
  // and a scanner that stops at the first `>` never reaches the href after it.
  // Zero anchors in this store are written that way, and the failure is graceful
  // (the tag is returned untouched, which is where every link started), so this
  // is a small hole rather than a live defect. It is one line of regex to close.
  const token = newToken();
  projectTokens.set(token, 'atelier');
  const html = await (await fetch(`${base}/p/${token}/spec/gtattr`)).text();

  assert.match(html, new RegExp(`href="/p/${token}/spec/mate"`), 'the href was hidden behind the >');
  assert.match(html, /data-sf-unshared="stranger"/);
});

test('href-like text inside another attribute is not mistaken for the href', async () => {
  // The one failure in this area that corrupts rather than degrades: scanning
  // the attribute blob with a regex finds the FIRST thing shaped like an href,
  // and an attribute value is allowed to contain that shape. The real href then
  // goes unrewritten while some prose in a title is edited instead.
  const token = newToken();
  projectTokens.set(token, 'atelier');
  const html = await (await fetch(`${base}/p/${token}/spec/decoy`)).text();

  assert.match(html, /title="see href=\/spec\/mate for the shape"/,
    'the title was rewritten, which is not an href at all');
  assert.match(html, /data-sf-unshared="stranger"/,
    'the real href was missed, so an out-of-project link kept working');
});

test('a query string survives the rewrite exactly as written', async () => {
  // The href is read out of raw HTML, so its value is already entity-encoded.
  // Escaping it again turns `&amp;` into `&amp;amp;`, and the reader follows a
  // link with a literal "amp;" in the query.
  const token = newToken();
  projectTokens.set(token, 'atelier');
  const html = await (await fetch(`${base}/p/${token}/spec/query`)).text();

  assert.match(html, new RegExp(`href="/p/${token}/spec/mate\\?from=1&amp;to=2"`),
    `double-escaped: ${(html.match(/href="[^"]*mate[^"]*"/) || [])[0]}`);
  assert.ok(!html.includes('amp;amp;'), 'the ampersand was escaped twice');
});

test('a custom element whose name starts with a- is not an anchor', async () => {
  // `\b` between "a" and "-" made <a-card> match the anchor scanner, so a custom
  // element got its href rewritten and a data-sf-unshared attribute it never
  // asked for. None exist in this store; the scanner should still only claim
  // anchors.
  const token = newToken();
  projectTokens.set(token, 'atelier');
  const html = await (await fetch(`${base}/p/${token}/spec/custom`)).text();

  assert.match(html, /<a-card href="\/spec\/mate">/, 'the custom element was rewritten');
  assert.ok(!/<a-card[^>]*data-sf-unshared/.test(html), 'it was disarmed like an anchor');
});

// --- what must not be touched ------------------------------------------------

test('a link to another site is left alone, however much it looks like ours', async () => {
  const token = newToken();
  projectTokens.set(token, 'atelier');
  const html = await (await fetch(`${base}/p/${token}/spec/linker`)).text();
  assert.ok(hrefs(html).includes('https://example.com/spec/mate'), hrefs(html).join(' '));
});

test('an anchor on the page itself is left alone', async () => {
  const token = newToken();
  projectTokens.set(token, 'atelier');
  const html = await (await fetch(`${base}/p/${token}/spec/linker`)).text();
  assert.ok(hrefs(html).includes('#local'));
});

test('the owner-served page is not what changes here', async () => {
  // The daemon serves /spec/<id> itself, so these links have always worked
  // there. The rewrite belongs to the share, and the file on disk keeps saying
  // what its author wrote.
  const { readSpecHtml } = await import('../lib/store.mjs');
  assert.match(readSpecHtml('linker'), /href="\/spec\/mate"/);
});
