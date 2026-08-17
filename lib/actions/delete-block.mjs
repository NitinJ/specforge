// Remove one block from a spec.
//
// The other half of Delete. An aside is identified by its id, because SpecForge
// wrote it; a block is the reader's own writing and has no id in the document at
// all — its identity lives in the browser's block registry, keyed to a DOM the
// server cannot see.
//
// So the client names it the way a reader would: this tag, in this section, with
// this text. The server finds exactly one match or refuses. Refusing is the
// important half. A near-miss means the document moved between the page loading
// and the click, and cutting whatever is nearest would remove a paragraph the
// reader never looked at, with nothing in the store to get it back from.
//
// What is NOT sent is markup. That is the line the section editor crossed in
// v0.2.47 and this does not: everything here is a description of something the
// document already contains.
//
// Spec: docs/2026-08-16-context-menu-actions-spec.md §10.

import { getAttr } from '../spec.mjs';
import { sectionRange, endOfElement } from './section-span.mjs';

/**
 * Tags that are never a block, whatever the client says.
 *
 * A denylist rather than a whitelist of block tags. Half the commentable
 * surfaces are components — `.panel`, `.callout`, `.card` and the injected
 * component classes — and every one of them is a `div`, so a whitelist of the
 * plain block tags refused a delete on the entries most likely to be deleted.
 * What makes this safe is the exact-text match inside one section and the
 * refusal to act on more than one hit, not the tag.
 *
 * These are refused because they hold the document rather than sit in it: a
 * request naming one is either confused or trying to take a section out through
 * a route meant for its contents.
 */
const NOT_BLOCKS = ['html', 'body', 'head', 'main', 'section', 'article', 'nav', 'script', 'style'];

/**
 * The HTML4 named entities, as `name:codepoint`.
 *
 * The browser hands back `textContent`, which is decoded; the file holds the
 * source, which is not. Without this a paragraph containing `&amp;` or an
 * `&#8212;` never matches what the reader is looking at, and Delete answers 409
 * on a block nobody has touched. Numeric forms matter most in practice, since
 * SpecForge's own templates write `&#8212;` and `&#9776;` rather than the
 * characters.
 *
 * Written out in full rather than trimmed to what SpecForge happens to emit
 * today. A short table was the first attempt and it was the wrong shape: a name
 * missing from it makes a block undeletable, and the reader has no way to tell
 * why. The second attempt matched an unknown entity as a single-character
 * wildcard, which is complete but not exact — a request made before someone
 * changed `&copy;` to `&reg;` still matched, and deleted a block the reader had
 * never seen. Exactness is the property worth keeping here, because the failure
 * it protects against is unrecoverable and the one it causes is not.
 */
const NAMED_SRC =
  'quot:34 amp:38 apos:39 lt:60 gt:62 nbsp:160 iexcl:161 cent:162 pound:163 curren:164 yen:165 '
  + 'brvbar:166 sect:167 uml:168 copy:169 ordf:170 laquo:171 not:172 shy:173 reg:174 macr:175 '
  + 'deg:176 plusmn:177 sup2:178 sup3:179 acute:180 micro:181 para:182 middot:183 cedil:184 '
  + 'sup1:185 ordm:186 raquo:187 frac14:188 frac12:189 frac34:190 iquest:191 Agrave:192 '
  + 'Aacute:193 Acirc:194 Atilde:195 Auml:196 Aring:197 AElig:198 Ccedil:199 Egrave:200 '
  + 'Eacute:201 Ecirc:202 Euml:203 Igrave:204 Iacute:205 Icirc:206 Iuml:207 ETH:208 Ntilde:209 '
  + 'Ograve:210 Oacute:211 Ocirc:212 Otilde:213 Ouml:214 times:215 Oslash:216 Ugrave:217 '
  + 'Uacute:218 Ucirc:219 Uuml:220 Yacute:221 THORN:222 szlig:223 agrave:224 aacute:225 '
  + 'acirc:226 atilde:227 auml:228 aring:229 aelig:230 ccedil:231 egrave:232 eacute:233 '
  + 'ecirc:234 euml:235 igrave:236 iacute:237 icirc:238 iuml:239 eth:240 ntilde:241 ograve:242 '
  + 'oacute:243 ocirc:244 otilde:245 ouml:246 divide:247 oslash:248 ugrave:249 uacute:250 '
  + 'ucirc:251 uuml:252 yacute:253 thorn:254 yuml:255 OElig:338 oelig:339 Scaron:352 scaron:353 '
  + 'Yuml:376 fnof:402 circ:710 tilde:732 Alpha:913 Beta:914 Gamma:915 Delta:916 Epsilon:917 '
  + 'Zeta:918 Eta:919 Theta:920 Iota:921 Kappa:922 Lambda:923 Mu:924 Nu:925 Xi:926 Omicron:927 '
  + 'Pi:928 Rho:929 Sigma:931 Tau:932 Upsilon:933 Phi:934 Chi:935 Psi:936 Omega:937 alpha:945 '
  + 'beta:946 gamma:947 delta:948 epsilon:949 zeta:950 eta:951 theta:952 iota:953 kappa:954 '
  + 'lambda:955 mu:956 nu:957 xi:958 omicron:959 pi:960 rho:961 sigmaf:962 sigma:963 tau:964 '
  + 'upsilon:965 phi:966 chi:967 psi:968 omega:969 thetasym:977 upsih:978 piv:982 ensp:8194 '
  + 'emsp:8195 thinsp:8201 zwnj:8204 zwj:8205 lrm:8206 rlm:8207 ndash:8211 mdash:8212 '
  + 'lsquo:8216 rsquo:8217 sbquo:8218 ldquo:8220 rdquo:8221 bdquo:8222 dagger:8224 Dagger:8225 '
  + 'bull:8226 hellip:8230 permil:8240 prime:8242 Prime:8243 lsaquo:8249 rsaquo:8250 oline:8254 '
  + 'frasl:8260 euro:8364 image:8465 weierp:8472 real:8476 trade:8482 alefsym:8501 larr:8592 '
  + 'uarr:8593 rarr:8594 darr:8595 harr:8596 crarr:8629 lArr:8656 uArr:8657 rArr:8658 dArr:8659 '
  + 'hArr:8660 forall:8704 part:8706 exist:8707 empty:8709 nabla:8711 isin:8712 notin:8713 '
  + 'ni:8715 prod:8719 sum:8721 minus:8722 lowast:8727 radic:8730 prop:8733 infin:8734 ang:8736 '
  + 'and:8743 or:8744 cap:8745 cup:8746 int:8747 there4:8756 sim:8764 cong:8773 asymp:8776 '
  + 'ne:8800 equiv:8801 le:8804 ge:8805 sub:8834 sup:8835 nsub:8836 sube:8838 supe:8839 '
  + 'oplus:8853 otimes:8855 perp:8869 sdot:8901 lceil:8968 rceil:8969 lfloor:8970 rfloor:8971 '
  + 'lang:9001 rang:9002 loz:9674 spades:9824 clubs:9827 hearts:9829 diams:9830';

/** Case matters: `&Alpha;` and `&alpha;` are different characters. */
const NAMED = Object.fromEntries(NAMED_SRC.split(' ').filter(Boolean).map((pair) => {
  const [name, code] = pair.split(':');
  return [name, String.fromCodePoint(Number(code))];
}));

export function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g, (whole, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X'
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      // A code point outside the range is left as written rather than turned
      // into a replacement character, which would match nothing either way but
      // silently.
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const named = NAMED[body];
    return named === undefined ? whole : named;
  });
}

/**
 * Text as the reader sees it: tags dropped, entities decoded, runs of whitespace
 * collapsed.
 *
 * The same normalisation the client applies before sending, so "A
 * <strong>bold</strong> claim.", a paragraph wrapped over three indented lines,
 * and one written with `&amp;` all compare equal to what was on screen.
 */
export function plainText(html) {
  return decodeEntities(String(html).replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/** Every `<tag>…</tag>` inside `html`, as {start, end}, depth-counted. */
function elementsOf(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const end = endOfElement(html, m.index + m[0].length, tag);
    if (end === -1) continue; // unclosed: not something to cut to
    out.push({ start: m.index, end });
    // Nested same-tag elements are found by the outer scan continuing past this
    // one's opening tag, so an <li> inside an <li> is still reachable.
  }
  return out;
}

/**
 * Cut one block out of a spec.
 *
 * The comparison is exact. Everything that could make it approximate has been
 * tried and reverted: this is the only check standing between a click and
 * content that cannot be recovered, and a delete that refuses when it should not
 * costs the reader an edit, while one that accepts when it should not costs them
 * writing.
 *
 * @param {string} html the spec
 * @param {{section:string, tag:string, text:string}} what the reader pointed at
 * @returns {{html:string, section:string, tag:string}}
 * @throws when the section is missing, is a draft, or the block does not resolve
 *   to exactly one element
 */
export function deleteBlock(html, { section, tag, text } = {}) {
  const at = sectionRange(html, section);
  if (!at) throw new Error(`delete: no section ${JSON.stringify(section)} in this spec`);
  // A draft has its own delete, which removes the whole thing and its threads.
  // Cutting one block out of one leaves a half-answered draft that still reads
  // as awaiting an answer.
  if (getAttr(at.attrs, 'data-sf-aside')) {
    throw new Error(`delete: ${JSON.stringify(section)} is a draft; delete the draft itself instead`);
  }

  const lower = String(tag || '').toLowerCase();
  if (!/^[a-z][a-z0-9]*$/.test(lower)) {
    throw new Error(`delete: ${JSON.stringify(tag)} is not a tag name`);
  }
  if (NOT_BLOCKS.includes(lower)) {
    throw new Error(`delete: <${lower}> holds the document rather than sitting in it`);
  }
  const want = plainText(text);
  if (!want) throw new Error('delete: the block text is required to identify it');

  const body = html.slice(at.inner, at.end);
  const hits = elementsOf(body, lower)
    .filter((e) => plainText(body.slice(e.start, e.end)) === want);

  if (!hits.length) {
    throw new Error(
      `delete: no block <${lower}> in section ${JSON.stringify(section)} reads as ${JSON.stringify(want.slice(0, 60))}`,
    );
  }
  if (hits.length > 1) {
    // Position would break the tie and the reader cannot see which one it picked.
    throw new Error(
      `delete: that text matches ${hits.length} blocks in ${JSON.stringify(section)}; nothing was removed`,
    );
  }

  // Leading whitespace goes with it, so removing a paragraph leaves the file as
  // it was rather than with a widening gap.
  let start = at.inner + hits[0].start;
  while (start > at.inner && /\s/.test(html[start - 1])) start -= 1;
  return { html: html.slice(0, start) + html.slice(at.inner + hits[0].end), section, tag: lower };
}
