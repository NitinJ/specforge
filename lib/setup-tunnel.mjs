// One command from a fresh machine to a permanent share URL.
//
// Doing this by hand is seven steps across a browser, a CLI, a config file and a
// system service, and getting any of them subtly wrong produces a link that
// either does not resolve or resolves to nothing. It is also the exact thing a
// new teammate has to do before they can share anything, so it is the first
// impression of the tool.
//
// Every external effect is injected. The whole flow is therefore testable
// without cloudflared, a browser, sudo or a network, which matters because the
// failure modes worth pinning (a config for someone else's tunnel, a DNS record
// pointing elsewhere, a rerun creating a second tunnel) are all ones you would
// otherwise have to cause for real to see.

import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { GATEWAY_PORT } from './publications.mjs';
import { setPublicOrigin } from './store-config.mjs';

const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

/** @returns {string} the trimmed hostname; throws with the reason if it is not one */
export function checkHostname(value) {
  const host = String(value == null ? '' : value).trim();
  if (!host) throw new Error('a hostname is required, for example spec.example.com');
  if (/^[a-z]+:\/\//i.test(host)) {
    throw new Error(`give a hostname, not a URL: ${host.replace(/^[a-z]+:\/\//i, '')}`);
  }
  if (host.includes('/')) throw new Error(`a hostname carries no path: ${host}`);
  if (!HOSTNAME_RE.test(host)) throw new Error(`not a hostname: ${host}`);
  return host;
}

/**
 * The tunnel name for a hostname.
 *
 * Derived rather than asked for, because it is bookkeeping the person running
 * this has no reason to care about, and one name per hostname keeps a rerun from
 * creating a second tunnel.
 */
export function tunnelNameFor(hostname) {
  return `specforge-${checkHostname(hostname).split('.')[0]}`;
}

/** The ingress config cloudflared reads. */
export function renderTunnelConfig({ tunnelName, credentialsFile, hostname, port }) {
  return `# Written by \`specforge setup-tunnel\`.
#
# Ingress lives here rather than in the Cloudflare dashboard, which is what
# "locally managed" means: nothing in the dashboard overrides this file.
#
# One hostname is enough for every published spec. The gateway serves them all
# on ${port} and routes /s/<token> internally, so publishing another spec needs
# no change here.
#
# ${port} is the gateway's fixed port. If it changes, this file has to change
# with it, or the tunnel points at nothing.

tunnel: ${tunnelName}
credentials-file: ${credentialsFile}

ingress:
  - hostname: ${hostname}
    service: http://localhost:${port}
  # Required: cloudflared refuses to start without a catch-all.
  - service: http_status:404
`;
}

/** Whether an existing config is already this one, near enough to leave alone. */
function configMatches(existing, hostname, tunnelName) {
  return existing.includes(`hostname: ${hostname}`) && existing.includes(`tunnel: ${tunnelName}`);
}

/**
 * Streams are kept apart deliberately.
 *
 * cloudflared writes an upgrade warning to stderr, as a line of JSON, on every
 * command. Merged into stdout it made `tunnel list --output json` unparseable,
 * and the flow then created a duplicate tunnel it could not find again.
 */
function realRun(cmd, args, { interactive = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: interactive ? 'inherit' : ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => { stdout += d; });
    child.stderr?.on('data', (d) => { stderr += d; });
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** The tunnel an existing config already routes this hostname through. */
function tunnelNameInConfig(config, hostname) {
  if (!config.includes(`hostname: ${hostname}`)) return null;
  const m = /^tunnel:\s*(\S+)/m.exec(config);
  return m ? m[1] : null;
}

/**
 * Take a machine from nothing to a permanent share URL.
 *
 * @param {object} opts
 * @param {string} opts.hostname e.g. spec.example.com
 * @param {boolean} [opts.force] overwrite a cloudflared config for another tunnel
 * @param {boolean} [opts.installService] run the privileged service install
 * @param {number} [opts.port] gateway port; must match what the daemon binds
 */
export async function setupTunnel(opts = {}, deps = {}) {
  const {
    run = realRun,
    exists = existsSync,
    readFile = (p) => readFileSync(p, 'utf8'),
    writeFile = (p, c) => { mkdirSync(join(p, '..'), { recursive: true }); writeFileSync(p, c); },
    home = homedir(),
    setOrigin = setPublicOrigin,
    log = (m) => process.stderr.write(`${m}\n`),
  } = deps;

  const hostname = checkHostname(opts.hostname);
  const port = opts.port || GATEWAY_PORT;
  const dir = join(home, '.cloudflared');
  const certPath = join(dir, 'cert.pem');
  const configPath = join(dir, 'config.yml');

  // A machine set up by hand has a config naming a tunnel this would not derive.
  // Deriving anyway would create a second tunnel for one hostname, and two
  // tunnels for one hostname is a routing coin-flip.
  const existingConfig = exists(configPath) ? readFile(configPath) : null;
  const tunnelName = opts.tunnelName
    || (existingConfig && tunnelNameInConfig(existingConfig, hostname))
    || tunnelNameFor(hostname);

  const cf = async (args, o) => {
    let result;
    try {
      result = await run('cloudflared', args, o);
    } catch (e) {
      if (e && e.code === 'ENOENT') {
        throw new Error('cloudflared is not installed or not on PATH. Install it from '
          + 'https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
      }
      throw e;
    }
    // Diagnostics may land on either stream; the parseable output only ever on
    // stdout.
    return { ...result, message: `${result.stderr || ''}${result.stdout || ''}`.trim() };
  };
  const parseTunnels = (r) => {
    try {
      const parsed = JSON.parse(r.stdout || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };

  // 1. Authenticate. This opens a browser and is the one step nobody can do for
  //    you, so it is skipped the moment there is a certificate.
  if (!exists(certPath)) {
    log('Authorising with Cloudflare. A browser will open; pick the domain you want to use.');
    const r = await cf(['tunnel', 'login'], { interactive: true });
    if (r.code !== 0 || !exists(certPath)) {
      throw new Error('cloudflare login did not complete, so nothing else was changed');
    }
  } else {
    log('Already authorised with Cloudflare.');
  }

  // 2. Reuse the tunnel of this name if it exists. A rerun is the normal case,
  //    and a second tunnel for one hostname is a routing coin-flip.
  let tunnel = parseTunnels(await cf(['tunnel', 'list', '--output', 'json']))
    .find((t) => t.name === tunnelName);
  if (tunnel) {
    log(`Reusing tunnel ${tunnelName}.`);
  } else {
    log(`Creating tunnel ${tunnelName}.`);
    const created = await cf(['tunnel', 'create', tunnelName]);
    if (created.code !== 0) throw new Error(`could not create the tunnel: ${created.message}`);
    tunnel = parseTunnels(await cf(['tunnel', 'list', '--output', 'json']))
      .find((t) => t.name === tunnelName);
    if (!tunnel) throw new Error('the tunnel was created but could not be found again');
  }

  // 3. DNS. Idempotent when the record already points here; an error when it
  //    points at something else, which is a decision for a human.
  log(`Pointing ${hostname} at it.`);
  const routed = await cf(['tunnel', 'route', 'dns', tunnelName, hostname]);
  if (routed.code !== 0) {
    throw new Error(`could not route ${hostname}: ${routed.message}`);
  }

  // 4. Config. Never clobbered without being asked: this file may carry tunnels
  //    that have nothing to do with SpecForge.
  const credentialsFile = join(dir, `${tunnel.id}.json`);
  const wanted = renderTunnelConfig({ tunnelName, credentialsFile, hostname, port });
  if (existingConfig != null) {
    if (!configMatches(existingConfig, hostname, tunnelName) && !opts.force) {
      const named = /hostname:\s*(\S+)/.exec(existingConfig);
      throw new Error(`${configPath} already configures ${named ? named[1] : 'another tunnel'}. `
        + 'Re-run with --force to replace it, or edit it by hand to add this hostname.');
    }
    // A hand-written config that already routes this hostname through this
    // tunnel is left exactly as it is: it may carry settings this does not know
    // about, and rewriting it would silently drop them.
    if (!configMatches(existingConfig, hostname, tunnelName)) writeFile(configPath, wanted);
  } else {
    writeFile(configPath, wanted);
  }

  // 5. Tell SpecForge to stop running tunnels of its own and use this origin.
  const publicUrl = `https://${hostname}`;
  setOrigin(publicUrl);

  // 6. The service. Privileged, so opt-in.
  const serviceCommand = `sudo cloudflared --config ${configPath} service install`;
  let serviceInstalled = false;
  if (opts.installService) {
    log('Installing the system service (sudo will ask for your password).');
    const r = await run('sudo', ['cloudflared', '--config', configPath, 'service', 'install'], { interactive: true });
    serviceInstalled = r.code === 0;
    if (!serviceInstalled) log('The service install did not succeed; run it by hand.');
  }

  const nextSteps = [];
  if (!serviceInstalled) {
    nextSteps.push(`Run \`${serviceCommand}\` so the tunnel survives a reboot.`);
  }
  nextSteps.push('Restart the SpecForge daemon so it picks up the new origin.');
  nextSteps.push(`Then \`specforge share <id>\` prints ${publicUrl}/s/<code>.`);

  return {
    ok: true,
    hostname,
    publicUrl,
    tunnelName,
    tunnelId: tunnel.id,
    configPath,
    gatewayPort: port,
    serviceInstalled,
    serviceCommand,
    nextSteps,
  };
}
