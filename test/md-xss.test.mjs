// Security regression suite for the importer.
//
// Vectors are pushed through the FULL import path — markdown in, stored spec
// HTML out — rather than at sanitizeHtml in isolation, because the composed
// pipeline is what the daemon serves. Two holes reached review by being just
// outside a unit test's reach: markdown link syntax never went through the
// sanitizer at all, and entity-encoded schemes survived one decoding pass.
//
// A spec is stored and then served in a browser with no second sanitization
// pass and no content-security policy behind it. Whatever survives here runs.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { JSDOM } from 'jsdom';

import { markdownToSpecHtml } from '../lib/md-to-html.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHELL = readFileSync(join(ROOT, 'templates', 'spec-base-general.html'), 'utf8');

const VECTORS = [
  ['raw script', '<script>alert(1)</script>'],
  ['raw script, mixed case', '<ScRiPt>alert(1)</ScRiPt>'],
  ['script with attributes', '<script type="text/javascript">alert(1)</script>'],
  ['img onerror', '<img src=x onerror=alert(1)>'],
  ['img onerror, single quotes', "<img src='x' onerror='alert(1)'>"],
  ['svg onload', '<svg onload=alert(1)></svg>'],
  ['body onload', '<body onload=alert(1)>'],
  ['iframe javascript src', '<iframe src="javascript:alert(1)"></iframe>'],
  ['iframe srcdoc', '<iframe srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;"></iframe>'],
  ['anchor javascript', '<a href="javascript:alert(1)">x</a>'],
  ['anchor javascript, unquoted', '<a href=javascript:alert(1)>x</a>'],
  ['anchor javascript, hex entity', '<a href="java&#x73;cript:alert(1)">x</a>'],
  ['anchor javascript, decimal entity', '<a href="&#106;avascript:alert(1)">x</a>'],
  ['anchor javascript, colon entity', '<a href="javascript&colon;alert(1)">x</a>'],
  ['anchor javascript, embedded tab', '<a href="java\tscript:alert(1)">x</a>'],
  ['anchor javascript, embedded newline', '<a href="java\nscript:alert(1)">x</a>'],
  ['anchor vbscript', '<a href="vbscript:msgbox(1)">x</a>'],
  ['anchor data html', '<a href="data:text/html,<script>alert(1)</script>">x</a>'],
  ['form action', '<form action="javascript:alert(1)"><input></form>'],
  ['button formaction', '<button formaction="javascript:alert(1)">x</button>'],
  ['base tag', '<base href="https://evil.test/">'],
  ['meta refresh', '<meta http-equiv="refresh" content="0;url=javascript:alert(1)">'],
  ['object data', '<object data="javascript:alert(1)"></object>'],
  ['embed src', '<embed src="javascript:alert(1)">'],
  ['link stylesheet', '<link rel="stylesheet" href="https://evil.test/x.css">'],
  ['markdown link', '[click](javascript:alert(1))'],
  ['markdown link, entity', '[click](java&#x73;cript:alert(1))'],
  ['markdown image', '![x](javascript:alert(1))'],
  ['markdown image, data html', '![x](data:text/html;base64,PHNjcmlwdD4=)'],
  ['markdown image, svg data uri', '![x](data:image/svg+xml;base64,PHN2Zz4=)'],
  ['xlink:href in svg', '<svg><use xlink:href="javascript:alert(1)"/></svg>'],
  ['video poster', '<video poster="javascript:alert(1)"></video>'],
  // HTML accepts a solidus where whitespace would go between attributes, so
  // these are ordinary elements with handlers, and a pattern anchored on
  // whitespace walks straight past them.
  ['solidus before handler', '<img/onerror=alert(1) src=x>'],
  ['solidus between attributes', '<img/src=x/onerror=alert(1)>'],
  ['solidus on svg', '<svg/onload=alert(1)>'],
  ['solidus before href', '<a/href="javascript:alert(1)">x</a>'],
  ['solidus before unquoted href', '<a/href=javascript:alert(1)>x</a>'],
  ['double solidus', '<div//onclick=alert(1)>x</div>'],
  ['handler after a newline', '<img\n onerror=alert(1)>'],
  ['handler after a tab', '<img\tonerror=alert(1)>'],
  // foreignObject switches the parser back into HTML inside SVG, which is the
  // classic mutation-XSS seam.
  ['svg foreignObject', '<svg><foreignObject><img src=x onerror=alert(1)></foreignObject></svg>'],
  ['style with a url', '<style>body{background:url(https://evil.test/t.png)}</style>'],
  ['style attribute with a url', '<div style="background:url(https://evil.test/t.png)">x</div>'],
  ['srcset', '<img srcset="https://evil.test/t.png 1x" src="a.png">'],
  ['anchor ping', '<a href="https://example.com" ping="https://evil.test/p">x</a>'],
  ['background attribute', '<table background="https://evil.test/t.png"><tr><td>x</td></tr></table>'],
];

const EXECUTABLE_URL = /^\s*(?:javascript|vbscript|livescript|data:text\/html|data:image\/svg\+xml)/i;

function importBody(vector) {
  const { html } = markdownToSpecHtml(`# Probe\n\n## Body\n\n${vector}\n`, {
    shell: SHELL,
    date: '2026-08-14',
    owner: 'x',
  });
  return (html.match(/<section id="body"[\s\S]*?<\/section>/) || [''])[0];
}

/**
 * What actually survived, judged by parsing rather than by pattern.
 *
 * A regex over the output cannot tell markup from text: `alt="&quot; onerror=…"`
 * contains the string `onerror=` and is completely inert, while `<img onerror=x>`
 * contains the same string and is not. Parsing answers the question that matters
 * — does any ELEMENT carry a handler — and does not raise a false alarm on
 * escaped text, which is exactly what correct output looks like.
 */
function findings(bodyHtml) {
  const { document } = new JSDOM(`<div id="root">${bodyHtml}</div>`).window;
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    const tag = el.tagName.toLowerCase();
    if (['script', 'iframe', 'object', 'embed', 'base', 'link', 'meta', 'form'].includes(tag)) {
      out.push(`element <${tag}> survived`);
    }
    for (const attr of el.attributes) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) out.push(`<${tag}> kept the handler ${name}`);
      if (name === 'srcdoc') out.push(`<${tag}> kept srcdoc`);
      if (['href', 'src', 'action', 'formaction', 'poster', 'xlink:href'].includes(name)
        && EXECUTABLE_URL.test(attr.value)) {
        out.push(`<${tag}> kept an executable ${name}: ${attr.value.slice(0, 40)}`);
      }
      if (['src', 'poster', 'xlink:href', 'srcset', 'ping', 'background'].includes(name)
        && /^(?:https?:)?\/\//i.test(attr.value)) {
        out.push(`<${tag}> kept a remote ${name}: ${attr.value.slice(0, 40)}`);
      }
      // href is a load on anything but an anchor (SVG2 <image href>, <use href>).
      if (name === 'href' && !['a', 'area'].includes(tag) && /^(?:https?:)?\/\//i.test(attr.value)) {
        out.push(`<${tag}> kept a remote href: ${attr.value.slice(0, 40)}`);
      }
      // Any attribute whose value would make the browser fetch a remote URL.
      if (name === 'style' && /url\s*\(/i.test(attr.value)) {
        out.push(`<${tag}> kept a style that fetches: ${attr.value.slice(0, 40)}`);
      }
    }
  }
  return out;
}

test('no XSS vector survives the import path', () => {
  const survived = [];
  for (const [name, vector] of VECTORS) {
    for (const finding of findings(importBody(vector))) survived.push(`${name}: ${finding}`);
  }
  assert.deepEqual(survived, [], `vectors that survived:\n${survived.join('\n')}`);
});

test('an attribute value cannot break out of its own quotes', () => {
  // The renderer interpolates alt text and hrefs into attributes. esc() handles
  // &<> but not quotes, so a quote in the source closed the attribute early and
  // whatever followed became markup.
  const breakouts = [
    ['image alt', '![" onerror="alert(1)](x.png)'],
    ['image alt, single quotes', "![' onerror='alert(1)](x.png)"],
    ['link href', '[x](http://a"onmouseover="alert(1))'],
    ['link text', '[<img src=x onerror=alert(1)>](http://a)'],
    ['image alt with a tag', '![<img src=x onerror=alert(1)>](x.png)'],
  ];
  const survived = [];
  for (const [name, vector] of breakouts) {
    for (const finding of findings(importBody(vector))) survived.push(`${name}: ${finding}`);
  }
  assert.deepEqual(survived, [], `breakouts that survived:\n${survived.join('\n')}`);
});

test('an inline markdown image cannot fetch from a remote host', () => {
  // An inline image is not a link the reader chooses: the browser fetches it the
  // moment the spec opens. Block-level image lines go through the asset resolver,
  // which reports what it refused; an inline one has nowhere to report from, so
  // the alt text is kept as text and no element is emitted.
  const body = importBody('text with ![a tracker](https://evil.test/t.png?u=1) inline');
  assert.deepEqual(findings(body), []);
  assert.doesNotMatch(body, /evil\.test/, 'not even as a dead attribute');
  assert.match(body, /a tracker/, 'the alt text survives as the text it described');

  // A local reference is still an image.
  assert.match(importBody('text ![d](d.svg) inline'), /<img src="d\.svg" alt="d">/);
});

test('SVG2 href on <image> is a load, not a link', () => {
  // <image href="…"> is the SVG2 spelling of xlink:href, and it fetches. Treating
  // href as navigational everywhere let it through.
  for (const vector of [
    '<svg><image href="https://evil.test/t.png"/></svg>',
    '<svg><use href="https://evil.test/x.svg#g"/></svg>',
    '<svg><image href="javascript:alert(1)"/></svg>',
  ]) {
    assert.deepEqual(findings(importBody(vector)), [], vector);
  }

  // An anchor's href is still a link the reader may follow.
  assert.match(importBody('<p><a href="https://example.com">x</a></p>'), /href="https:\/\/example\.com"/);
});

test('a remote image in raw HTML does not become a request', () => {
  // A spec is self-contained and can be published: a remote src is a beacon that
  // fires for every reviewer who opens the page and hands the author their IP.
  for (const vector of [
    '<img src="https://evil.test/track.png?u=1">',
    '<video poster="https://evil.test/t.png"></video>',
    '<svg><image xlink:href="https://evil.test/t.png"/></svg>',
    '<img src="//evil.test/protocol-relative.png">',
  ]) {
    assert.deepEqual(findings(importBody(vector)), [], vector);
  }
});

test('the guard does not swallow the document around it', () => {
  // A sanitizer that eats the rest of the file would pass the test above while
  // making import useless, so the prose on either side is checked too.
  for (const [name, vector] of VECTORS) {
    const { html } = markdownToSpecHtml(
      `# Probe\n\n## Body\n\nbefore\n\n${vector}\n\nafter\n\n## Later\n\ntail\n`,
      { shell: SHELL, date: '2026-08-14', owner: 'x' }
    );
    assert.match(html, /before/, `${name} ate the text before it`);
    assert.match(html, /after/, `${name} ate the text after it`);
    assert.match(html, /id="later"/, `${name} ate the following section`);
  }
});

test('legitimate content is untouched by the guard', () => {
  // Markdown links: absolute with a query string, relative, and a fragment. The
  // ampersand is escaped exactly once — escaping it twice renders `&amp;` as
  // visible text in the middle of the URL.
  const body = importBody('[docs](https://example.com/a?b=1&c=2) and [rel](/rel) and [frag](#frag)');
  assert.match(body, /href="https:\/\/example\.com\/a\?b=1&amp;c=2"/);
  assert.doesNotMatch(body, /&amp;amp;/, 'double-escaped');
  assert.match(body, /href="\/rel"/);
  assert.match(body, /href="#frag"/);

  // And a raw HTML block, which is the path that goes through the sanitizer.
  const raw = importBody('<div class="panel">\n<a href="https://example.com/x">link</a>\n</div>');
  assert.match(raw, /<div class="panel">/);
  assert.match(raw, /<a href="https:\/\/example\.com\/x">link<\/a>/);
});
