// Store-wide settings, at ~/.specforge/config.json.
//
// One setting so far: `publicOrigin`. Setting it is how you tell SpecForge that
// something else owns the tunnel.
//
// By default SpecForge runs a cloudflared quick tunnel and manages its whole
// lifetime, which is what makes sharing work with no account and no domain, and
// what makes the hostname change on every reboot. Pointing a named tunnel or a
// Tailscale Funnel at the gateway instead gives an address that never changes,
// but only if SpecForge stops starting, adopting and killing tunnels, because
// none of those are its processes any more.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { storeRoot, configPath } from './store-paths.mjs';

/** @returns {{publicOrigin?:string}} the stored settings, or {} */
export function readConfig() {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8'));
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

export function writeConfig(config) {
  mkdirSync(storeRoot(), { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2));
  return config;
}

/**
 * Point publishing at an origin someone else is serving, or hand the tunnel back.
 *
 * Stored as a bare origin. Everything published is `<origin>/s/<token>`, so a
 * trailing slash would produce a double slash and a path would be silently
 * dropped from the middle of every link; both are normalised away here rather
 * than at each use.
 *
 * @param {string|null} value an http(s) URL, or null to clear
 */
export function setPublicOrigin(value) {
  const config = readConfig();
  // Only an explicit null clears. An empty string is a missing argument rather
  // than an intent, and treating it as "hand the tunnel back" would silently
  // change the origin of every link already sent.
  if (value == null) {
    delete config.publicOrigin;
    return writeConfig(config);
  }
  let url;
  try {
    url = new URL(String(value).trim());
  } catch {
    throw new Error(`not a valid origin: ${JSON.stringify(value)}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`not an http origin: ${value}`);
  }
  config.publicOrigin = url.origin;
  return writeConfig(config);
}
