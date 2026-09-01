// SpecForge — Pi extension.
//
// Pi port of hooks/hooks.json (SessionStart / UserPromptSubmit / Stop). Rather
// than shelling out to the hook scripts, it imports their exported run()
// functions directly — same logic, same store, same gating — and adapts their
// outputs to Pi's event model:
//
//   SessionStart      → session_start       (stash nudge, inject on next turn)
//   UserPromptSubmit  → before_agent_start  (inject additionalContext as a message)
//   Stop (block)      → agent_settled + pi.sendUserMessage(followUp)
//
// Session identity: Claude Code exports $CLAUDE_CODE_SESSION_ID into every Bash
// subprocess; Pi does not. So specforge-cli and the hooks also honor
// $SPECFORGE_SESSION_ID, and this extension injects it (plus CLAUDE_PLUGIN_ROOT,
// which the skills' commands expand at shell time) into any Bash call that
// touches SpecForge. Skill docs, command bodies and the store are otherwise
// byte-identical between harnesses.

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { run as sessionStartRun } from "../hooks/session-start.mjs";
import { run as promptSubmitRun } from "../hooks/user-prompt-submit.mjs";
import { run as stopRun } from "../hooks/stop.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** True for Bash commands that reach SpecForge (skills, commands, the CLI). */
function touchesSpecforge(command: string): boolean {
  return command.includes("CLAUDE_PLUGIN_ROOT") || command.includes("specforge");
}

export default function (pi: ExtensionAPI) {
  let sessionId = "";
  // Nudge produced at session_start, injected as context at the first turn.
  let pendingStartContext = "";
  // Mirrors `stop_hook_active`: true for the settle immediately following the
  // continuation we injected, so the stop logic caps its own loop.
  let afterInjection = false;

  function sid(): string {
    return sessionId;
  }

  pi.on("session_start", async (_event, ctx) => {
    pendingStartContext = "";
    afterInjection = false;
    sessionId = ctx.sessionManager.getSessionId();
    try {
      const out = sessionStartRun({ session_id: sid() });
      pendingStartContext = out?.hookSpecificOutput?.additionalContext ?? "";
    } catch {
      // fail-safe: mirrors the hooks' exit-0 contract
    }
  });

  pi.on("tool_call", async (event) => {
    if (event.toolName !== "bash") return;
    const input = event.input as { command?: string };
    if (!input.command || !touchesSpecforge(input.command)) return;
    input.command =
      `export SPECFORGE_SESSION_ID=${JSON.stringify(sid())}\n` +
      `export CLAUDE_PLUGIN_ROOT=${JSON.stringify(ROOT)}\n` +
      input.command;
  });

  pi.on("before_agent_start", async (event) => {
    const chunks: string[] = [];
    if (pendingStartContext) {
      chunks.push(pendingStartContext);
      pendingStartContext = "";
    }
    try {
      const out = promptSubmitRun({ session_id: sid() });
      const ctxText = out?.hookSpecificOutput?.additionalContext ?? "";
      if (ctxText) chunks.push(ctxText);
    } catch {
      // fail-safe
    }
    if (!chunks.length) return;
    // Per-turn system-prompt addition, like the hook's additionalContext — an
    // injected message would persist into the session and re-nag forever.
    return { systemPrompt: event.systemPrompt + "\n\n" + chunks.join("\n\n") };
  });

  pi.on("agent_settled", async () => {
    try {
      const hooked = afterInjection;
      afterInjection = false;
      const out = stopRun({ session_id: sid(), stop_hook_active: hooked });
      if (out?.decision === "block" && out.reason) {
        afterInjection = true;
        pi.sendUserMessage(out.reason, { deliverAs: "followUp" });
      }
    } catch {
      // fail-safe
    }
  });

  pi.on("resources_discover", async () => ({
    skillPaths: [join(ROOT, "skills")],
    promptPaths: [join(ROOT, "pi", "prompts")],
  }));
}
