#!/usr/bin/env node
// Does an SSE stream survive a cloudflared quick tunnel, and with what latency?
//
// Reads the stream with `curl -N` rather than fetch: undici's reader gave no
// signal distinguishing "buffered" from "hung", and curl reports bytes the
// moment they arrive, which is the whole measurement.
//
// The origin emits a timestamped event every 2 s. Arrival time minus emit time
// is the added latency. Compares the tunnel against a direct loopback read, so
// the number is the tunnel's contribution and not the harness overhead.
//
// Result on 2026-08-11 (cloudflared 2026.5.0): loopback delivered 15 of 15
// events over 30 s at 0 ms to 1 ms; the same origin through a quick tunnel
// delivered 0, including with 2 KB of leading padding and no-transform. The
// edge returns the response headers and then holds every body byte. Publication
// listeners therefore poll rather than stream.
//
// usage: node tools/probe-sse-through-tunnel.mjs [--pad=BYTES] [--no-transform] [--seconds=N]
// Requires cloudflared on PATH and outbound network. Not part of the test suite.

import http from 'node:http';
import { spawn } from 'node:child_process';

const argv = process.argv.slice(2);
const pad = Number((argv.find((a) => a.startsWith('--pad=')) || '--pad=0').split('=')[1]);
const noTransform = argv.includes('--no-transform');
const secs = Number((argv.find((a) => a.startsWith('--seconds=')) || '--seconds=9').split('=')[1]);

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const streams = new Set();
const origin = http.createServer((req, res) => {
  if (!req.url.startsWith('/events')) { res.writeHead(200).end('ok'); return; }
  const headers = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': noTransform ? 'no-cache, no-transform' : 'no-cache',
  };
  res.writeHead(200, headers);
  if (pad) res.write(`:${'p'.repeat(pad)}\n\n`);
  res.write(': open\n\n');
  streams.add(res);
  req.on('close', () => streams.delete(res));
});

await new Promise((r) => origin.listen(0, '127.0.0.1', r));
const port = origin.address().port;
const metricsPort = port + 1;
log(`origin 127.0.0.1:${port}  (pad=${pad}, no-transform=${noTransform})`);

// Emit a timestamped event every 2 s for the life of the probe.
const ticker = setInterval(() => {
  const now = Date.now();
  for (const s of streams) s.write(`data: ${now}\n\n`);
}, 2000);

const cf = spawn('cloudflared', [
  'tunnel', '--url', `http://127.0.0.1:${port}`,
  '--metrics', `127.0.0.1:${metricsPort}`, '--no-autoupdate',
], { stdio: ['ignore', 'ignore', 'ignore'] });

let hostname = null;
for (let i = 0; i < 60 && !hostname; i++) {
  await sleep(500);
  try {
    const r = await fetch(`http://127.0.0.1:${metricsPort}/quicktunnel`);
    if (r.ok) hostname = (await r.json()).hostname;
  } catch { /* not up */ }
}
if (!hostname) { log('no hostname'); process.exit(1); }
log(`tunnel https://${hostname}`);
await sleep(3000); // let the edge finish routing

/** Read an SSE stream with curl and report when each data line lands. */
function readWithCurl(url, seconds) {
  return new Promise((resolve) => {
    const arrivals = [];
    const c = spawn('curl', [
      '-N', '-s', '--max-time', String(seconds),
      '-H', 'Accept: text/event-stream',
      '-H', 'Accept-Encoding: identity',
      url,
    ]);
    let buf = '';
    c.stdout.on('data', (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        const m = /^data: (\d+)$/.exec(line.trim());
        if (m) arrivals.push(Date.now() - Number(m[1]));
      }
    });
    c.on('close', () => resolve(arrivals));
  });
}

log(`\nreading direct (loopback) for ${secs} s...`);
const direct = await readWithCurl(`http://127.0.0.1:${port}/events`, secs);
log(`direct: ${direct.length} events, latencies ms = [${direct.join(', ')}]`);

log(`reading through the tunnel for ${secs} s...`);
const tunnel = await readWithCurl(`https://${hostname}/events`, secs);
log(`tunnel: ${tunnel.length} events, latencies ms = [${tunnel.join(', ')}]`);

clearInterval(ticker);
cf.kill('SIGTERM');
for (const s of streams) s.end();
origin.close();

log('\n--- verdict ---');
if (!tunnel.length) {
  log('NO events arrived through the tunnel. SSE does not survive it as configured.');
  process.exit(1);
}
const worst = Math.max(...tunnel);
log(`${tunnel.length} events through the tunnel, worst added latency ${worst} ms`);
log(worst < 5000 ? 'A3 HOLDS (budget 5000 ms)' : 'A3 FAILS (budget 5000 ms)');
process.exit(worst < 5000 ? 0 : 1);
