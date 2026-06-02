// Shared I/O helpers for SpecForge hooks.
//
// Hooks are invoked by Claude Code with a JSON payload on stdin and may emit a
// JSON decision object on stdout. These helpers keep every hook fail-safe: any
// error drains to a clean exit so a SpecForge bug can never wedge a user's
// session.

/**
 * Read all of stdin (the hook payload) as a string, with a hard timeout so a
 * hook never hangs waiting on a pipe that does not close.
 * @param {number} timeoutMs
 * @returns {Promise<string>}
 */
export function readStdin(timeoutMs = 2000) {
  return new Promise((resolve) => {
    let data = '';
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(data);
    };
    const timer = setTimeout(finish, timeoutMs);
    timer.unref?.();
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { data += chunk; });
    process.stdin.on('end', () => { clearTimeout(timer); finish(); });
    process.stdin.on('error', () => { clearTimeout(timer); finish(); });
  });
}

/**
 * Parse a hook payload string into an object, never throwing.
 * @param {string} raw
 * @returns {Record<string, any>}
 */
export function parseInput(raw) {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Drain stdin and exit 0 — the universal fail-safe no-op for a hook that has
 * nothing to do.
 */
export async function noop() {
  await readStdin();
  process.exit(0);
}
