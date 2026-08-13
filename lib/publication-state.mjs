// What a polling page needs to know: has the spec changed, have the comments.
//
// A published page cannot hold an event stream (measured: Cloudflare's edge
// returns the response headers and then buffers every body byte), so it asks for
// these two numbers instead and refetches when either moves.

import { statSync } from 'node:fs';
import { specHtmlPath, commentsPath } from './store-paths.mjs';
import { agentBusy } from './store-inbox.mjs';

/** Modification time in ms, or 0 when the file is absent. */
function mtime(path) {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * `busy` says an agent is mid-round on this spec. The page holds its reload
 * while it is set and takes one when it clears, so a round of review lands as a
 * single update rather than a reload per save.
 * @returns {{spec:number, comments:number, busy:boolean}} mtimes in ms
 */
export function readPublicationState(specId) {
  return {
    spec: mtime(specHtmlPath(specId)),
    comments: mtime(commentsPath(specId)),
    busy: agentBusy(specId),
  };
}
