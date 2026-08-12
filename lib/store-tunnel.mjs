// The record of the one tunnel, at ~/.specforge/tunnel.json.
//
// Absent means nothing is exposed. This is what a starting daemon reads to find
// the tunnel its predecessor left running: a detached cloudflared survives a
// SIGKILLed parent, and without this file there is no route back to it, so it
// would be a public endpoint with nothing tracking it.
//
// Three fields, all load-bearing. `pid` is how the process is reached, whether
// to adopt it or reap it. `localPort` is the port it is pointed at, which the
// gateway has to rebind for the tunnel to keep serving. `url` is the origin
// every published link is built from.

import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { storeRoot, tunnelPath } from './store-paths.mjs';

/** @returns {{url:string, pid:number, localPort:number, createdAt:string}|null} */
export function readTunnel() {
  try {
    const raw = JSON.parse(readFileSync(tunnelPath(), 'utf8'));
    if (!raw || typeof raw.url !== 'string') return null;
    if (!Number.isInteger(raw.pid) || !Number.isInteger(raw.localPort)) return null;
    return raw;
  } catch {
    return null;
  }
}

export function writeTunnel(record) {
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(tunnelPath(), JSON.stringify(record, null, 2));
  return record;
}

/** @returns {boolean} whether a record was there to remove */
export function clearTunnel() {
  try {
    rmSync(tunnelPath());
    return true;
  } catch {
    return false;
  }
}
