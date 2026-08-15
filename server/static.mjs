// Static serving for the review-layer client assets under server/public/.

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** Content hash, so the validator changes exactly when the bytes do. */
function etagFor(body) {
  return `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
}

/**
 * Serve a whitelisted asset from server/public (basename only, no traversal).
 *
 * `no-cache` with an ETag rather than `no-store`. The two are equally safe here,
 * because both make the browser check with us before using a copy, but no-store
 * also forbids keeping the copy at all: every load re-transfers the whole file.
 * That was invisible at prism's 34 KB and is not at mermaid's 3.4 MB, since a
 * spec being edited live-reloads on every save. Revalidating costs a 304.
 *
 * @param {string} name basename of the asset
 * @param {object} res node response
 * @param {object} [req] node request; without it the response is never a 304
 */
export function serveStatic(name, res, req) {
  const file = basename(name);
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }
  let body;
  try {
    body = readFileSync(join(PUBLIC_DIR, file));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }
  const etag = etagFor(body);
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-cache', ETag: etag };
  if (req && req.headers && req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    return res.end();
  }
  res.writeHead(200, headers);
  res.end(body);
}
