// Shared helper for the review-loop hooks (Stop / SessionStart / UserPromptSubmit):
// find pending review batches for a project and build the instruction text that
// routes Claude to the review-spec skill.

import { loadConfig } from './config.mjs';
import { listPendingBatches } from './inbox.mjs';

/**
 * Pending batches for a project working directory. Fail-safe: any error yields
 * an empty result so a hook never breaks a session.
 * @param {string} cwd
 * @returns {{specsDir:string|null, pending:object[]}}
 */
export function pendingForCwd(cwd) {
  try {
    const specsDir = loadConfig(cwd).specsDir;
    return { specsDir, pending: listPendingBatches(specsDir) };
  } catch {
    return { specsDir: null, pending: [] };
  }
}

/** Instruction text telling Claude to process the pending batches. */
export function reviewReason(specsDir, pending) {
  const lines = pending.map(
    (b) => `  - batch ${b.batchId} on "${b.specPath}" (${b.threadIds.length} thread(s)) — inbox: ${b.file}`
  );
  return [
    `SpecForge: ${pending.length} review batch(es) were submitted in the browser and are awaiting your reply:`,
    ...lines,
    '',
    'Run the specforge:review-spec skill now: for each batch, read the inbox file and the spec\'s',
    `comment store under ${specsDir}/.specforge/<specId>/comments.json, reply inline to each thread,`,
    'amend the spec file per the comments, then mark the batch done. Do not resolve threads (humans do that).',
  ].join('\n');
}
