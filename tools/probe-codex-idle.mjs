import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import assert from 'node:assert/strict';
import { withSpec } from '../test-e2e/harness.mjs';
import { attach, workerFor } from '../lib/attach.mjs';

// Opt-in host qualification: real browser, watcher, and installed Codex queue.
// The model endpoint is local and synthetic; no account or API key is used.

const root = mkdtempSync(join(tmpdir(), 'sf-native-queue-'));
const home = join(root, 'codex');
mkdirSync(home);
let requests = 0;
const http = createServer(async (req, res) => {
  for await (const chunk of req) { /* consume request */ }
  const id = `response-${++requests}`;
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  event('response.created', { response: { id } });
  event('response.output_item.done', { output_index: 0, item: {
    id: `msg-${requests}`, type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: 'Probe complete.', annotations: [] }],
  } });
  event('response.completed', { response: { id, status: 'completed', output: [],
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } });
  res.end();
});
await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
writeFileSync(join(home, 'config.toml'), `model = "mock-model"\nmodel_provider = "mock"\napproval_policy = "never"\nsandbox_mode = "read-only"\n[model_providers.mock]\nname = "Mock"\nbase_url = "http://127.0.0.1:${http.address().port}/v1"\nwire_api = "responses"\nrequires_openai_auth = false\n`);
const env = { ...process.env, CODEX_HOME: home };
for (const key of ['CODEX_THREAD_ID', 'CODEX_SESSION_ID', 'SPECFORGE_SESSION_ID', 'SPECFORGE_HARNESS', 'PLUGIN_ROOT', 'CLAUDE_PLUGIN_ROOT']) delete env[key];
const app = spawn('codex', ['app-server'], { env, cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = '';
app.stderr.on('data', chunk => { stderr += chunk; });
const pending = new Map();
const notifications = [];
createInterface({ input: app.stdout }).on('line', line => {
  const message = JSON.parse(line);
  if (message.id !== undefined && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result);
  } else notifications.push(message);
});
let serial = 0;
function call(method, params) {
  const id = ++serial;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    app.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
async function until(fn) {
  const end = Date.now() + 25_000;
  while (Date.now() < end) {
    if (fn()) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`timed out; requests=${requests}; notifications=${JSON.stringify(notifications).slice(-4000)}; stderr=${stderr.slice(-2000)}`);
}
const deadline = setTimeout(() => { console.error('probe deadline'); app.kill(); http.close(); process.exit(1); }, 75_000);
try {
  await call('initialize', { clientInfo: { name: 'specforge_probe', version: '1' }, capabilities: { experimentalApi: true } });
  app.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n');
  const { thread } = await call('thread/start', { cwd: root, model: 'mock-model', modelProvider: 'mock', approvalPolicy: 'never', sandbox: 'read-only' });
  await call('turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Initial idle setup.' }] });
  await until(() => notifications.some(n => n.method === 'turn/completed'));
  console.log('initial turn settled', thread.id);
  const before = notifications.filter(n => n.method === 'turn/completed').length;
  await withSpec({}, async ({ page, id }) => {
    attach(id, thread.id);
    let pid;
    try {
      const started = Date.now();
      const hook = spawnSync(process.execPath, [fileURLToPath(new URL('../hooks/stop.mjs', import.meta.url))], {
        env: { ...env, SPECFORGE_HOME: process.env.SPECFORGE_HOME, SPECFORGE_HARNESS: 'codex' },
        input: JSON.stringify({ session_id: thread.id }), encoding: 'utf8', timeout: 2000,
      });
      assert.equal(hook.error, undefined);
      assert.equal(hook.status, 0, hook.stderr);
      assert.equal(hook.stdout, '');
      console.log(`Stop hook returned in ${Date.now() - started}ms`);
      await until(() => { pid = workerFor(thread.id)?.pid; return !!pid; });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForSelector('#sf-launcher');
      assert.match(await page.locator('.sf-conn-label').innerText(), /Connected/);
      const block = page.locator('#overview p').first();
      await block.hover();
      await block.click();
      await page.locator('.sf-bub-compose textarea').fill('Please review this automatic delivery probe.');
      await page.locator('.sf-bub-compose .sf-primary').click();
      await page.waitForFunction(() => /Submit comments/.test(document.querySelector('.sf-tb-act')?.textContent || ''));
      await page.locator('.sf-tb-act').click();
      await until(() => notifications.filter(n => n.method === 'turn/completed').length > before);
      assert.ok(notifications.some(n => JSON.stringify(n).includes('review batch') && JSON.stringify(n).includes(id)),
        'the native thread received the actual submitted SpecForge review batch');
      console.log('PASS: browser submission → detached SpecForge watcher → native Codex queue → idle owning thread');
      console.log('Model responses are synthetic; this proves automatic delivery, not review quality.');
    } finally {
      if (pid) { try { process.kill(pid, 'SIGTERM'); } catch { /* already stopped */ } }
    }
  });
} finally {
  clearTimeout(deadline);
  app.kill();
  http.closeAllConnections();
  http.close();
  await new Promise(resolve => app.once('exit', resolve));
  rmSync(root, { recursive: true, force: true });
}
