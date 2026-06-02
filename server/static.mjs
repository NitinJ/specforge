// Static serving for the review-layer client assets under server/public/.

import { readFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIR = join(fileURLToPath(new URL('.', import.meta.url)), 'public');

const TYPES = {
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
};

/** Serve a whitelisted asset from server/public (basename only — no traversal). */
export function serveStatic(name, res) {
  const file = basename(name);
  const type = TYPES[extname(file).toLowerCase()];
  if (!type) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('not found');
  }
  try {
    const body = readFileSync(join(PUBLIC_DIR, file));
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
}
