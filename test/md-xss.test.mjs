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
];

const EXECUTABLE = /javascript\s*:|vbscript\s*:|data:text\/html|data:image\/svg\+xml|<script|<iframe|<object|<embed|<base\b|<link\b|<meta\b|srcdoc/i;

function importBody(vector) {
  const { html } = markdownToSpecHtml(`# Probe\n\n## Body\n\n${vector}\n`, {
    shell: SHELL,
    date: '2026-08-14',
    owner: 'x',
  });
  return (html.match(/<section id="body"[\s\S]*?<\/section>/) || [''])[0];
}

test('no XSS vector survives the import path', () => {
  const survived = [];
  for (const [name, vector] of VECTORS) {
    const body = importBody(vector);
    if (EXECUTABLE.test(body)) survived.push(`${name}: executable content`);
    if (/\son[a-z]+\s*=/i.test(body)) survived.push(`${name}: inline event handler`);
  }
  assert.deepEqual(survived, [], `vectors that survived:\n${survived.join('\n')}`);
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
  const body = importBody(
    '[docs](https://example.com/a?b=1&c=2) and <a href="/rel">rel</a> and <a href="#frag">frag</a>'
  );
  assert.match(body, /href="https:\/\/example\.com\/a\?b=1&amp;c=2"/);
  assert.match(body, /href="\/rel"/);
  assert.match(body, /href="#frag"/);
});
