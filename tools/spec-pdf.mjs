#!/usr/bin/env node
// Print a spec to PDF.
//
//   node tools/spec-pdf.mjs <specId> <outFile.pdf> [chromiumPath]
//
// Reads spec.html straight from the store rather than going through the daemon,
// so the review layer's toolbar, sidebar and comment rail are absent by
// construction instead of having to be hidden. The spec's own floating TOC is
// dropped for print — a sticky sidebar has no meaning on paper, and its column
// would otherwise steal a fifth of every page.
//
// Light theme is forced: the stored preference is about reading on a screen, and
// a dark page prints as a solid black rectangle.

import { existsSync } from 'node:fs';
import { chromium } from 'playwright';
import { specHtmlPath } from '../lib/store.mjs';

const [, , id, outArg, exeArg] = process.argv;
if (!id || !outArg) {
  console.error('usage: node tools/spec-pdf.mjs <specId> <outFile.pdf> [chromiumPath]');
  process.exit(2);
}
const src = specHtmlPath(id);
if (!existsSync(src)) {
  console.error(`no spec at ${src}`);
  process.exit(1);
}
const exe = exeArg || process.env.SF_CHROMIUM || null;

const PRINT_CSS = `
  :root[data-theme="dark"]{color-scheme:light}
  nav.toc{display:none !important}
  .layout{display:block !important;max-width:none !important}
  main{padding:0 !important}
  h1,h2,h3{break-after:avoid-page}
  section,table,pre,figure{break-inside:avoid-page}
  a{text-decoration:none}
`;

let browser;
try {
  browser = await chromium.launch(exe ? { executablePath: exe } : {});
} catch (err) {
  throw new Error(`${err.message}\n\nEither run "npx playwright install chromium", `
    + 'or pass the path to an existing chromium as the third argument.');
}
const page = await browser.newPage();
await page.goto(`file://${src}`, { waitUntil: 'networkidle' });
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await page.addStyleTag({ content: PRINT_CSS });
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: outArg,
  format: 'A4',
  printBackground: true,
  margin: { top: '14mm', bottom: '16mm', left: '13mm', right: '13mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="width:100%;font:9px -apple-system,sans-serif;color:#888;'
    + 'padding:0 13mm;display:flex;justify-content:space-between">'
    + `<span>${id}</span><span class="pageNumber"></span></div>`,
});
// A PNG of the same print-styled DOM, for checking the layout without a PDF
// viewer. Same page, same CSS, so what it shows is what the PDF paginates.
if (process.env.SF_PDF_PREVIEW) {
  await page.setViewportSize({ width: 900, height: 1200 });
  await page.screenshot({ path: process.env.SF_PDF_PREVIEW, clip: { x: 0, y: 0, width: 900, height: 1200 } });
  console.log(`wrote ${process.env.SF_PDF_PREVIEW}`);
}

await browser.close();
console.log(`wrote ${outArg}`);
