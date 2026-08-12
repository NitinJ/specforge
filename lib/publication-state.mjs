// What a polling page needs to know: has the spec changed, have the comments.
//
// A published page cannot hold an event stream (measured: Cloudflare's edge
// returns the response headers and then buffers every body byte), so it asks for
// these two numbers instead and refetches when either moves.

import { statSync } from 'node:fs';
import { specHtmlPath, commentsPath } from './store-paths.mjs';

/** Modification time in ms, or 0 when the file is absent. */
function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/** @returns {{spec:number, comments:number}} mtimes in ms */
export function readPublicationState(specId) {
  return { spec: mtime(specHtmlPath(specId)), comments: mtime(commentsPath(specId)) };
}
