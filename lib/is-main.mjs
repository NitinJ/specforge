// Was this module run directly, or imported?
//
// The obvious check compares `import.meta.url` to `file://${process.argv[1]}`,
// and it is wrong the moment a bin is installed. `npm link` and `npm install -g`
// put a SYMLINK on PATH: argv[1] is the symlink, `import.meta.url` is the file it
// resolves to, and the two never match. The CLI then exits 0 having printed
// nothing, which looks exactly like success.
//
// Found by running the installed binary rather than the file (spec e9ddcddef6,
// task 4.4). Every skill now says `specforge <verb>`, so this is the difference
// between a working install and a silent one.

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * @param {string} moduleUrl the caller's `import.meta.url`
 * @returns {boolean} true when node was started on this module, symlinks resolved
 */
export function isMain(moduleUrl) {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(entry);
  } catch {
    // A path that cannot be resolved is not the entry point. Falling back to the
    // string comparison keeps the old behaviour for anything unusual.
    return moduleUrl === `file://${entry}`;
  }
}
