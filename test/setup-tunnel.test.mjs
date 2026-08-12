// One command from a fresh machine to a permanent share URL.
//
// Every external step is injected, so the whole flow is exercised without
// cloudflared, a browser, sudo or a network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  renderTunnelConfig, tunnelNameFor, checkHostname, setupTunnel,
  readCertToken, hostnameSlug,
} from '../lib/setup-tunnel.mjs';

// ---- deriving the hostname, so nobody has to be told one ----

test('a username becomes a usable label', () => {
  assert.equal(hostnameSlug('lavee'), 'lavee');
  assert.equal(hostnameSlug('Nitin.Jaglan'), 'nitin-jaglan');
  assert.equal(hostnameSlug('  ADMIN_user  '), 'admin-user');
  assert.equal(hostnameSlug('a'.repeat(80)).length, 30, 'truncated to a legal label');
  assert.equal(hostnameSlug('---'), 'specs', 'something unusable falls back');
  assert.equal(hostnameSlug(''), 'specs');
});

// cert.pem carries a zoneID but not the zone name, so the name has to be looked
// up with the token already in that file. Without this the person would have to
// be told their own domain.
test('the cert token is read out of the PEM armour', () => {
  const token = Buffer.from(JSON.stringify({ zoneID: 'z1', accountID: 'a1', apiToken: 't1' })).toString('base64');
  const pem = `-----BEGIN ARGO TUNNEL TOKEN-----\n${token}\n-----END ARGO TUNNEL TOKEN-----\n`;
  assert.deepEqual(readCertToken(pem), { zoneID: 'z1', accountID: 'a1', apiToken: 't1' });
});

test('a cert with no token reads as none rather than throwing', () => {
  assert.equal(readCertToken('-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----'), null);
  assert.equal(readCertToken(''), null);
  assert.equal(readCertToken('-----BEGIN ARGO TUNNEL TOKEN-----\nnot base64 json\n-----END ARGO TUNNEL TOKEN-----'), null);
});

// ---- pure helpers ----

test('a hostname is a hostname, not a URL and not empty', () => {
  assert.equal(checkHostname('spec.specforger.cc'), 'spec.specforger.cc');
  assert.equal(checkHostname('  spec.specforger.cc  '), 'spec.specforger.cc');
  for (const bad of ['', '   ', 'https://spec.specforger.cc', 'spec.specforger.cc/path', 'spec', 'a b.cc', null]) {
    assert.throws(() => checkHostname(bad), /hostname/i, `accepted ${JSON.stringify(bad)}`);
  }
});

test('the tunnel name is derived from the hostname', () => {
  assert.equal(tunnelNameFor('lavee.specforger.cc'), 'specforge-lavee');
  assert.equal(tunnelNameFor('spec.specforger.cc'), 'specforge-spec');
});

test('the rendered config names the tunnel, the hostname and the gateway port', () => {
  const yaml = renderTunnelConfig({
    tunnelName: 'specforge-lavee',
    credentialsFile: '/home/lavee/.cloudflared/abc.json',
    hostname: 'lavee.specforger.cc',
    port: 14180,
  });
  assert.match(yaml, /^tunnel: specforge-lavee$/m);
  assert.match(yaml, /credentials-file: \/home\/lavee\/\.cloudflared\/abc\.json/);
  assert.match(yaml, /hostname: lavee\.specforger\.cc/);
  assert.match(yaml, /service: http:\/\/localhost:14180/);
  // cloudflared refuses to start without a catch-all, and a missing one is the
  // kind of thing that only shows up at run time.
  assert.match(yaml, /service: http_status:404/);
});

// ---- the flow ----

const CERT = `-----BEGIN ARGO TUNNEL TOKEN-----\n${
  Buffer.from(JSON.stringify({ zoneID: 'z1', accountID: 'a1', apiToken: 't1' })).toString('base64')
}\n-----END ARGO TUNNEL TOKEN-----\n`;

/** A machine with nothing set up, and a record of everything asked of it. */
function fakeMachine(overrides = {}) {
  const files = new Map(overrides.files || []);
  const ran = [];
  const state = {
    tunnels: overrides.tunnels || [],
    ...overrides,
  };
  return {
    ran,
    files,
    deps: {
      log: () => {},
      exists: (p) => files.has(p),
      readFile: (p) => files.get(p),
      writeFile: (p, c) => { files.set(p, c); },
      home: '/home/lavee',
      username: overrides.username || 'lavee',
      setOrigin: (url) => { state.origin = url; },
      lookupZone: overrides.lookupZone || (async () => 'specforger.cc'),
      state,
      run: async (cmd, args) => {
        ran.push([cmd, ...args].join(' '));
        if (args[0] === 'tunnel' && args[1] === 'list') {
          return { code: 0, stdout: JSON.stringify(state.tunnels) };
        }
        if (args[0] === 'tunnel' && args[1] === 'login') {
          files.set('/home/lavee/.cloudflared/cert.pem', CERT);
          return { code: 0, stdout: '' };
        }
        if (args[0] === 'tunnel' && args[1] === 'create') {
          const name = args[2];
          state.tunnels.push({ id: 'new-id', name });
          files.set('/home/lavee/.cloudflared/new-id.json', 'creds');
          return { code: 0, stdout: '' };
        }
        if (state.fail && state.fail[args.slice(0, 2).join(' ')]) {
          return { code: 1, stdout: state.fail[args.slice(0, 2).join(' ')] };
        }
        return { code: 0, stdout: '' };
      },
    },
  };
}

const HOST = 'lavee.specforger.cc';

test('a fresh machine goes from nothing to a configured origin', async () => {
  const m = fakeMachine();
  const out = await setupTunnel({ hostname: HOST }, m.deps);

  assert.ok(m.ran.some((c) => c.includes('tunnel login')), 'it authenticates');
  assert.ok(m.ran.some((c) => c.includes('tunnel create specforge-lavee')), 'it creates the tunnel');
  assert.ok(m.ran.some((c) => c.includes(`tunnel route dns specforge-lavee ${HOST}`)), 'it writes DNS');
  assert.match(m.files.get('/home/lavee/.cloudflared/config.yml'), /lavee\.specforger\.cc/);
  assert.equal(m.deps.state.origin, `https://${HOST}`, 'and points SpecForge at it');
  assert.equal(out.hostname, HOST);
  assert.equal(out.publicUrl, `https://${HOST}`);
});

// The point of deriving: a teammate cloning the repo has no way to know what
// hostname to type, and the domain is not something they chose. After the one
// browser click, everything else is knowable.
test('with no hostname given, one is derived from the user and the authorised zone', async () => {
  const m = fakeMachine({ username: 'Lavee.K' });
  const out = await setupTunnel({}, m.deps);
  assert.equal(out.hostname, 'lavee-k.specforger.cc');
  assert.equal(out.derived, true);
  assert.ok(m.ran.some((c) => c.includes('tunnel route dns specforge-lavee-k lavee-k.specforger.cc')));
});

test('a hostname given explicitly wins over the derived one', async () => {
  const m = fakeMachine({ files: [['/home/lavee/.cloudflared/cert.pem', CERT]] });
  const out = await setupTunnel({ hostname: 'docs.example.com' }, m.deps);
  assert.equal(out.hostname, 'docs.example.com');
  assert.equal(out.derived, false);
});

test('a zone that cannot be looked up asks for a hostname instead of guessing', async () => {
  const m = fakeMachine({
    files: [['/home/lavee/.cloudflared/cert.pem', CERT]],
    lookupZone: async () => { throw new Error('offline'); },
  });
  await assert.rejects(() => setupTunnel({}, m.deps), /hostname/i);
});

test('an already-authenticated machine is not sent to the browser again', async () => {
  const m = fakeMachine({ files: [['/home/lavee/.cloudflared/cert.pem', CERT]] });
  await setupTunnel({ hostname: HOST }, m.deps);
  assert.ok(!m.ran.some((c) => c.includes('tunnel login')), 'no second login');
});

// Running it twice is the normal case: a teammate re-runs it after a failure, or
// to change hostname. It must not leave a second tunnel behind.
test('an existing tunnel of the same name is reused, not duplicated', async () => {
  const m = fakeMachine({
    files: [['/home/lavee/.cloudflared/cert.pem', CERT]],
    tunnels: [{ id: 'old-id', name: 'specforge-lavee' }],
  });
  const out = await setupTunnel({ hostname: HOST }, m.deps);
  assert.ok(!m.ran.some((c) => c.includes('tunnel create')), 'nothing created');
  assert.equal(out.tunnelId, 'old-id');
});

test('rerunning the whole thing changes nothing', async () => {
  const m = fakeMachine({ files: [['/home/lavee/.cloudflared/cert.pem', CERT]] });
  const first = await setupTunnel({ hostname: HOST }, m.deps);
  const before = m.files.get('/home/lavee/.cloudflared/config.yml');
  const second = await setupTunnel({ hostname: HOST }, m.deps);
  assert.deepEqual(second, first);
  assert.equal(m.files.get('/home/lavee/.cloudflared/config.yml'), before);
  assert.equal(m.ran.filter((c) => c.includes('tunnel create')).length, 1, 'created once, ever');
});

// The config file is shared with whatever else the machine tunnels. Clobbering
// it would take down something that has nothing to do with SpecForge.
test('a config for a different hostname is refused, not overwritten', async () => {
  const m = fakeMachine({
    files: [
      ['/home/lavee/.cloudflared/cert.pem', CERT],
      ['/home/lavee/.cloudflared/config.yml', 'tunnel: something-else\ningress:\n  - hostname: other.example.com\n'],
    ],
  });
  await assert.rejects(() => setupTunnel({ hostname: HOST }, m.deps), /other\.example\.com|--force/);
  assert.match(m.files.get('/home/lavee/.cloudflared/config.yml'), /something-else/, 'left alone');
});

// The guard has to fire before anything is created, or a refusal still leaves a
// tunnel and a DNS record behind for a setup that did not happen.
test('a refused config leaves no tunnel and no DNS record', async () => {
  const m = fakeMachine({
    files: [
      ['/home/lavee/.cloudflared/cert.pem', CERT],
      ['/home/lavee/.cloudflared/config.yml', 'tunnel: something-else\ningress:\n  - hostname: other.example.com\n'],
    ],
  });
  await assert.rejects(() => setupTunnel({ hostname: HOST }, m.deps), /other\.example\.com|--force/);
  assert.ok(!m.ran.some((c) => c.includes('tunnel create')), 'nothing was created');
  assert.ok(!m.ran.some((c) => c.includes('route dns')), 'no DNS record was written');
});

test('--force overwrites it', async () => {
  const m = fakeMachine({
    files: [
      ['/home/lavee/.cloudflared/cert.pem', CERT],
      ['/home/lavee/.cloudflared/config.yml', 'tunnel: something-else\n'],
    ],
  });
  await setupTunnel({ hostname: HOST, force: true }, m.deps);
  assert.match(m.files.get('/home/lavee/.cloudflared/config.yml'), /lavee\.specforger\.cc/);
});

// Installing a system service is privileged and irreversible-ish, so it is not
// something a setup command should do to a machine uninvited.
test('the service is not installed unless asked', async () => {
  const m = fakeMachine({ files: [['/home/lavee/.cloudflared/cert.pem', CERT]] });
  const out = await setupTunnel({ hostname: HOST }, m.deps);
  assert.ok(!m.ran.some((c) => c.includes('service install')), 'no sudo uninvited');
  assert.match(out.nextSteps.join(' '), /service install/, 'but it says how');
});

test('--install-service runs it', async () => {
  const m = fakeMachine({ files: [['/home/lavee/.cloudflared/cert.pem', CERT]] });
  await setupTunnel({ hostname: HOST, installService: true }, m.deps);
  assert.ok(m.ran.some((c) => c.includes('service install')));
});

// cloudflared writes an upgrade warning to stderr, as JSON, on every command.
// Merging the streams made `tunnel list` unparseable and the flow created a
// duplicate tunnel it then could not find.
test('noise on stderr does not corrupt the tunnel list', async () => {
  const m = fakeMachine({
    files: [['/home/lavee/.cloudflared/cert.pem', CERT]],
    tunnels: [{ id: 'old-id', name: 'specforge-lavee' }],
  });
  const inner = m.deps.run;
  m.deps.run = async (cmd, args, o) => {
    const r = await inner(cmd, args, o);
    return { ...r, stderr: '{"level":"warn","message":"Your version is outdated"}' };
  };
  const out = await setupTunnel({ hostname: HOST }, m.deps);
  assert.equal(out.tunnelId, 'old-id', 'the existing tunnel was still found');
  assert.ok(!m.ran.some((c) => c.includes('tunnel create')), 'so nothing was duplicated');
});

// A machine set up by hand has a config naming a tunnel this would not derive.
// Deriving anyway creates a second tunnel for one hostname, which is a routing
// coin-flip.
test('an existing config for this hostname keeps its own tunnel name', async () => {
  const m = fakeMachine({
    files: [
      ['/home/lavee/.cloudflared/cert.pem', CERT],
      ['/home/lavee/.cloudflared/config.yml',
        `tunnel: hand-made\ncredentials-file: /home/lavee/.cloudflared/hand.json\ningress:\n  - hostname: ${HOST}\n    service: http://localhost:14180\n  - service: http_status:404\n`],
    ],
    tunnels: [{ id: 'hand-id', name: 'hand-made' }],
  });
  const out = await setupTunnel({ hostname: HOST }, m.deps);
  assert.equal(out.tunnelName, 'hand-made');
  assert.equal(out.tunnelId, 'hand-id');
  assert.ok(!m.ran.some((c) => c.includes('tunnel create')), 'nothing created');
});

test('a DNS record pointing at someone else fails loudly', async () => {
  const m = fakeMachine({
    files: [['/home/lavee/.cloudflared/cert.pem', CERT]],
    fail: { 'tunnel route': 'record already exists and points elsewhere' },
  });
  await assert.rejects(() => setupTunnel({ hostname: HOST }, m.deps), /points elsewhere|route/i);
});

test('a missing cloudflared says what to install', async () => {
  const m = fakeMachine();
  m.deps.run = async () => { throw Object.assign(new Error('spawn cloudflared ENOENT'), { code: 'ENOENT' }); };
  await assert.rejects(() => setupTunnel({ hostname: HOST }, m.deps), /cloudflared.*install|install.*cloudflared/i);
});
