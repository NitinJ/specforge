#!/usr/bin/env node
// SpecForge review server entry point.
//
// Usage: node server/start.mjs [--specs-dir <dir>] [--port <n>] [--project <dir>]
//
// Binds to 127.0.0.1 only. If the port is taken, tries the next few ports so the
// skill can start the server idempotently without manual cleanup.

import { relative, resolve as resolvePath } from 'node:path';
import { loadConfig } from '../lib/config.mjs';
import { specId } from '../lib/paths.mjs';
import { createApp } from './app.mjs';

function parseArgs(argv) {
  const out = {};
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--specs-dir') out.specsDir = a[++i];
    else if (a[i] === '--port') out.port = Number(a[++i]);
    else if (a[i] === '--project') out.project = a[++i];
    else if (a[i] === '--resolve') out.resolve = a[++i];
  }
  return out;
}

function listenWithFallback(server, port, host, attempts, onListening) {
  let tries = 0;
  const tryPort = (p) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE' && tries < attempts) {
        tries++;
        tryPort(p + 1);
      } else {
        console.error(`failed to bind: ${err.message}`);
        process.exit(1);
      }
    });
    server.listen(p, host, () => onListening(p));
  };
  tryPort(port);
}

const args = parseArgs(process.argv);
const config = loadConfig(args.project || process.cwd());
const specsDir = args.specsDir || config.specsDir;
const port = Number.isFinite(args.port) ? args.port : config.port;

// --resolve <file>: print the review URL for a spec and exit (no server started).
if (args.resolve) {
  const rel = relative(specsDir, resolvePath(args.resolve));
  console.log(`http://127.0.0.1:${port}/spec/${specId(rel)}`);
  process.exit(0);
}

const server = createApp({ specsDir });
listenWithFallback(server, port, '127.0.0.1', 20, (p) => {
  console.log(`SpecForge review server: http://127.0.0.1:${p}/`);
  console.log(`serving specs from: ${specsDir}`);
});
