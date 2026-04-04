#!/usr/bin/env node

/**
 * review-gate-hook.mjs — PreToolUse hook that gates git commits on a Copilot review.
 *
 * When enabled via settings, this hook intercepts `git commit` commands and runs
 * a quick Copilot review first. If the review finds critical issues, it blocks
 * the commit and reports the findings.
 *
 * Enable in .claude/copilot.local.md:
 *   - review-gate: on
 *
 * Input: JSON on stdin with { tool_name, tool_input }
 * Output: JSON on stdout with { decision: "allow"|"block", reason? }
 */

import process from "node:process";
import { findCopilotBinary, runCopilotPrompt } from "./lib/copilot.mjs";
import { isGitRepo, getRepoRoot, getDiffContext, getStatus } from "./lib/git.mjs";
import { readSettings, getConfiguredBinary } from "./lib/settings.mjs";

function allow() {
  console.log(JSON.stringify({ decision: "allow" }));
}

function block(reason) {
  console.log(JSON.stringify({ decision: "block", reason }));
}

async function main() {
  let input;
  try {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    input = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    allow();
    return;
  }

  // Only intercept Bash tool calls that look like git commits
  if (input.tool_name !== "Bash") {
    allow();
    return;
  }

  const command = input.tool_input?.command ?? "";
  if (!command.match(/\bgit\s+commit\b/)) {
    allow();
    return;
  }

  const cwd = process.cwd();
  if (!isGitRepo(cwd)) {
    allow();
    return;
  }

  const workspaceRoot = getRepoRoot(cwd);
  const settings = readSettings(workspaceRoot);

  // Check if review gate is enabled
  if (settings["review-gate"] !== "on") {
    allow();
    return;
  }

  const binary = findCopilotBinary(getConfiguredBinary(workspaceRoot));
  if (!binary) {
    // Can't review without Copilot — allow the commit but warn
    allow();
    return;
  }

  const { diff, stat } = getDiffContext(cwd);
  if (!diff && !getStatus(cwd)) {
    allow();
    return;
  }

  const gatePrompt = `You are a commit gate reviewer. Review this diff for CRITICAL issues only.

Only block the commit if you find:
- Security vulnerabilities (hardcoded secrets, injection, auth bypass)
- Data loss risks (destructive operations without safeguards)
- Obvious bugs that would crash in production

Do NOT block for: style issues, missing tests, minor refactoring opportunities, or subjective preferences.

Respond with EXACTLY one of:
- PASS — if no critical issues found
- BLOCK: <one-line reason> — if a critical issue must be fixed first

${stat ? `Summary: ${stat}\n` : ""}
\`\`\`diff
${diff || getStatus(cwd)}
\`\`\``;

  const model = settings["review-gate-model"] ?? "gpt-5.4-mini";

  try {
    const result = await runCopilotPrompt(cwd, {
      prompt: gatePrompt,
      model,
      effort: "low",
      binaryPath: binary.path,
      timeout: 30_000,
    });

    if (result.timedOut || result.code !== 0) {
      // Don't block commits on review failures — fail open
      allow();
      return;
    }

    const output = result.stdout.trim();
    if (output.startsWith("BLOCK:")) {
      block(`Copilot review gate: ${output.slice(6).trim()}\n\nRun /copilot:review for the full review, or disable the gate:\n  - review-gate: off`);
      return;
    }

    allow();
  } catch {
    // Fail open — don't block commits on unexpected errors
    allow();
  }
}

main();
