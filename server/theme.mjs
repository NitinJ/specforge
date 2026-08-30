// The palette, once, for every page SpecForge serves.
//
// The home page and the shared project page each carried their own copy, and
// every token had drifted: --bg was #faf9f6 on one and #fbfaf7 on the other,
// --accent #4f46e5 and #2563eb, and the shared page had never been given
// --surface, --surface2, --faint, --line2 or --live at all, so anything asking
// for one got nothing. A reviewer opening a shared link met something that
// looked like a different tool.
//
// Inlined rather than served from /public: a stylesheet fetched over a link
// paints after the first frame, and a page whose background arrives late shows a
// white flash before a dark theme. Both pages already inline their CSS for that
// reason; this only makes it the same CSS.
//
// Three states, in the order the cascade needs them. Light is the base, so a
// page that stamps nothing still has a full palette. The media query supplies
// dark to a reader who chose nothing and whose system asks for it. An explicit
// choice wins over both, which is what the toggle writes.
//
// The home page stamps data-theme server-side because the daemon knows what the
// owner picked, so for that page the explicit rules always apply and the media
// query never decides anything. The shared page has no stored preference to read
// and depends on the middle block.

const LIGHT = `--bg:#faf9f6;--surface:#ffffff;--surface2:#f3f1ec;--ink:#1c2024;--muted:#6b7280;
    --faint:#9aa1ab;--line:#e7e4dd;--line2:#d5d1c8;--accent:#4f46e5;--accent-soft:#eef0fd;
    --live:#16a34a;--s-draft:#6b7280;--s-approved:#16a34a;--s-discussion:#0d9488;
    --shadow:0 1px 2px rgba(28,32,36,.05),0 4px 12px rgba(28,32,36,.04);
    --panel:var(--surface);--green:var(--live);--amber:#b45309;--red:#cf222e`;

const DARK = `--bg:#101114;--surface:#17181c;--surface2:#1f2126;--ink:#e8eaed;--muted:#9aa1ab;
    --faint:#6b7280;--line:#26282e;--line2:#34373f;--accent:#818cf8;--accent-soft:#232441;
    --live:#4ade80;--s-draft:#9aa1ab;--s-approved:#4ade80;--s-discussion:#2dd4bf;
    --shadow:none;
    --panel:var(--surface);--green:var(--live);--amber:#e5a54b;--red:#f85149`;

/**
 * The palette, as a `<style>` body. Inline it; do not link it.
 *
 * `--panel`, `--green`, `--amber` and `--red` are aliases the review layer reads
 * by those generic names, kept so a spec page and an index page tint the same.
 */
export const THEME_CSS = `  :root,:root[data-theme="light"]{
    ${LIGHT}
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
    ${DARK}
    }
  }
  :root[data-theme="dark"]{
    ${DARK}
  }`;

/** The type scale both pages set on `body`, so one page is not a size larger. */
export const BODY_FONT = '14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,'
  + '"Helvetica Neue",sans-serif';

/** The reading column. Both pages hold their content to this. */
export const CONTENT_WIDTH = '1180px';

/**
 * The list: a collection heading, a card, and the rows in it.
 *
 * Shared for the same reason the palette is. The two pages list the same specs
 * and had drawn them differently enough to read as different products: the home
 * page has hairline-separated rows in one card with the signals in fixed columns,
 * and the shared page had every row floating in its own rounded box with a
 * ragged right edge. Matching them by hand is what produced the drift.
 *
 * The subset is deliberate. Only what both pages need is here; the home page's
 * hover-revealed controls (the checkbox, the tag chips, the actions button) and
 * its sticky heading stay with it, because a reviewer has none of them.
 */
export const LIST_CSS = `  .grp{margin:24px 0 0}
  .grp h2,.collab h2{display:flex;align-items:center;gap:5px;font-size:11px;text-transform:uppercase;
    letter-spacing:.07em;color:var(--muted);font-weight:650;margin:0 0 7px 2px}
  .gcount{display:inline-block;background:var(--surface2);border-radius:999px;padding:0 7px;
    color:var(--faint);font-weight:500;font-variant-numeric:tabular-nums}
  .card{background:var(--surface);border:1px solid var(--line);border-radius:11px;
    box-shadow:var(--shadow);overflow:hidden}
  .rows{list-style:none;margin:0;padding:0}
  .row{position:relative;display:flex;align-items:center;gap:10px;padding:0 14px;min-height:38px;
    border-bottom:1px solid var(--line);border-left:2px solid transparent;transition:background .12s}
  .row:last-child{border-bottom:none}
  .row:hover{background:color-mix(in srgb,var(--ink) 3%,transparent)}
  .main{display:flex;align-items:center;gap:8px;min-width:0;flex:1}
  .title{font-weight:540;font-size:13.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;
    flex:0 1 auto;min-width:0}
  .title:hover{color:var(--accent)}
  /* Fixed-width slots, so the signals read as columns down the list rather than
     as a ragged right edge. Empty slots still hold their place. */
  .badge{display:inline-flex;align-items:center;gap:5px;font-size:12px;color:var(--muted);white-space:nowrap}
  .badge.t{font-size:10.5px;font-weight:550;text-transform:uppercase;letter-spacing:.05em;
    background:var(--surface2);padding:1px 6px;border-radius:5px;color:var(--faint);width:84px;
    justify-content:center}
  .badge.s{font-size:11.5px;width:92px}
  .badge.s .sdot{width:6px;height:6px;border-radius:50%;background:var(--muted);flex:none}
  .s-draft .sdot{background:var(--s-draft)}
  .s-approved .sdot{background:var(--s-approved)} .s-approved{color:var(--s-approved)}
  .upd{font:11px ui-monospace,Menlo,monospace;color:var(--faint);white-space:nowrap;width:58px;
    text-align:right}
  /* The signals never wrap, so on a narrow viewport the title is the only item
     left to give and it collapses toward an ellipsis. They go in order of least
     use: the type first, then the stamp. Title and status survive to the
     narrowest width, because those are what a row is scanned for.
     Part of the shared block rather than each page's own, which is how the
     shared page ended up with a rule for a class its rows no longer had: at
     420px every column stayed and the title was squeezed to 73px. */
  @media(max-width:1180px){.badge.t{display:none}}
  @media(max-width:900px){.upd{display:none}}`;
