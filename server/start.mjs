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
import { writeServerState, readServerState, clearServerState } from '../lib/server-state.mjs';
import { createWatcher } from '../lib/watch.mjs';
import { createApp } from './app.mjs';

function parseArgs(argv) {
  const out = {};
  const a = argv.slice(2);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--specs-dir') out.specsDir = a[++i];
    else if (a[i] === '--port') out.port = Number(a[++i]);
    else if (a[i] === '--project') out.project = a[++i];
    else if (a[i] === '--resolve') out.resolve = a[++i];
    else if (a[i] === '--watch') out.watch = true;
    else if (a[i] === '--watch-interval') out.watchInterval = Number(a[++i]);
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
// Prefer the actual bound port from the running server's state file so the URL is
// correct even after collision fallback; fall back to the configured port.
if (args.resolve) {
  const rel = relative(specsDir, resolvePath(args.resolve));
  const running = readServerState(specsDir);
  const usePort = running?.port ?? port;
  console.log(`http://127.0.0.1:${usePort}/spec/${specId(rel)}`);
  process.exit(0);
}

const projectDir = args.project || process.cwd();
let watcher = null;

const server = createApp({ specsDir });
listenWithFallback(server, port, '127.0.0.1', 20, (p) => {
  writeServerState(specsDir, { port: p, pid: process.pid, url: `http://127.0.0.1:${p}/` });
  console.log(`SpecForge review server: http://127.0.0.1:${p}/`);
  console.log(`serving specs from: ${specsDir}`);

  if (args.watch) {
    const requested = args.watchInterval * 1000;
    // floor at 1s so `--watch-interval 0` can't become a tight filesystem-poll loop
    const intervalMs = Number.isFinite(requested) && requested >= 1000 ? requested : 90000;
    watcher = createWatcher({ specsDir, projectDir, intervalMs, log: (m) => console.log(m) });
    watcher.start();
    console.log(`watch mode ON — submitted batches will be drained unattended via a headless \`claude -p\` every ${intervalMs / 1000}s`);
  }
});

// Best-effort cleanup of the advertised state on shutdown.
let cleaned = false;
const cleanupState = () => {
  if (cleaned) return;
  cleaned = true;
  if (watcher) watcher.stop();
  clearServerState(specsDir);
};
process.on('exit', cleanupState);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { cleanupState(); process.exit(0); });
}
