#!/usr/bin/env node

/**
 * copilot-companion.mjs — Main entry point for the copilot plugin.
 *
 * Usage:
 *   node scripts/copilot-companion.mjs setup [--json]
 *   node scripts/copilot-companion.mjs review [--base <ref>] [--model <model>] [--effort <level>]
 *   node scripts/copilot-companion.mjs council [--models <m1,m2,m3>] [--effort <level>]
 *   node scripts/copilot-companion.mjs delegate [--model <model>] [--effort <level>] [prompt]
 *   node scripts/copilot-companion.mjs status [job-id]
 *   node scripts/copilot-companion.mjs result [job-id]
 *   node scripts/copilot-companion.mjs cancel [job-id]
 */

import process from "node:process";
import { findCopilotBinary, getLoginStatus, runCopilotPrompt, runCouncilPrompts } from "./lib/copilot.mjs";
import { isGitRepo, getRepoRoot, getCurrentBranch, getStatus, getDiffContext, estimateReviewSize } from "./lib/git.mjs";
import { generateJobId, createJob, updateJob, readJob, listJobs, findJob, cleanStaleJobs } from "./lib/state.mjs";
import { readSettings, getCouncilModels, getDefaultModel, getDefaultEffort, getConfiguredBinary } from "./lib/settings.mjs";

function parseArgs(argv) {
  const options = {};
  const positionals = [];
  let i = 0;

  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        options[key] = next;
        i += 2;
      } else {
        options[key] = true;
        i += 1;
      }
    } else {
      positionals.push(arg);
      i += 1;
    }
  }

  return { options, positionals };
}

function handleSetup(argv, cwd) {
  const { options } = parseArgs(argv);
  const workspaceRoot = isGitRepo(cwd) ? getRepoRoot(cwd) : cwd;
  const settings = readSettings(workspaceRoot);
  const binary = findCopilotBinary(getConfiguredBinary(workspaceRoot));
  const login = binary ? getLoginStatus(binary.path) : { loggedIn: false, detail: "Binary not found" };

  const report = {
    ready: Boolean(binary && login.loggedIn),
    binary: binary ? { path: binary.path, source: binary.source } : null,
    auth: login,
    settings,
    branch: isGitRepo(cwd) ? getCurrentBranch(cwd) : null,
  };

  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const lines = [];
  lines.push("# Copilot CLI Setup");
  lines.push("");

  if (report.ready) {
    lines.push("**Status: Ready**");
  } else {
    lines.push("**Status: Not Ready**");
  }
  lines.push("");

  // Binary
  if (binary) {
    lines.push(`- Binary: \`${binary.path}\` (found via ${binary.source})`);
  } else {
    lines.push("- Binary: **Not found**");
    lines.push("  - Install: `npm install -g @anthropic-ai/claude-code` or install GitHub Copilot in VS Code");
    lines.push("  - Or set `copilot-binary` in `.claude/copilot.local.md`");
  }

  // Auth
  if (login.loggedIn) {
    lines.push(`- Auth: Logged in (${login.detail})`);
  } else {
    lines.push("- Auth: **Not logged in**");
    lines.push("  - Run `!copilot login` to authenticate");
  }

  // Settings
  lines.push("");
  lines.push("## Settings");
  lines.push(`- Default model: ${settings["default-model"]}`);
  lines.push(`- Default effort: ${settings["default-effort"]}`);
  lines.push(`- Council models: ${settings["council-models"]}`);
  lines.push(`- Council effort: ${settings["council-effort"]}`);

  // Next steps
  if (!report.ready) {
    lines.push("");
    lines.push("## Next Steps");
    if (!binary) lines.push("1. Install the Copilot CLI or configure the binary path");
    if (!login.loggedIn) lines.push(`${binary ? "1" : "2"}. Run \`!copilot login\``);
  }

  console.log(lines.join("\n"));
}

async function handleReview(argv, cwd) {
  const { options, positionals } = parseArgs(argv);
  const workspaceRoot = isGitRepo(cwd) ? getRepoRoot(cwd) : cwd;
  const settings = readSettings(workspaceRoot);
  const binary = findCopilotBinary(getConfiguredBinary(workspaceRoot));

  if (!binary) {
    console.error("Copilot CLI not found. Run /copilot:setup first.");
    process.exitCode = 1;
    return;
  }

  if (!isGitRepo(cwd)) {
    console.error("Not inside a git repository.");
    process.exitCode = 1;
    return;
  }

  const model = options.model ?? getDefaultModel(workspaceRoot);
  const effort = options.effort ?? getDefaultEffort(workspaceRoot);
  const base = options.base;

  const { diff, stat } = getDiffContext(cwd, base);

  if (!diff && !getStatus(cwd)) {
    console.log("Nothing to review — no changes detected.");
    return;
  }

  const reviewPrompt = `You are a senior code reviewer. Review the following git diff carefully.

Focus on:
- Bugs, logic errors, and edge cases
- Security vulnerabilities
- Performance issues
- Code quality and maintainability
- Missing error handling

Be specific. Reference file names and line numbers. Be direct about issues.

${base ? `Changes from ${base} to HEAD:` : "Working tree changes:"}

${stat ? `Summary: ${stat}\n` : ""}
\`\`\`diff
${diff || getStatus(cwd)}
\`\`\`

Provide a structured review with severity levels (critical/warning/info) for each finding.`;

  process.stderr.write(`Running review with ${model} (effort: ${effort})...\n`);

  const result = await runCopilotPrompt(cwd, {
    prompt: reviewPrompt,
    model,
    effort,
    binaryPath: binary.path,
  });

  if (result.timedOut) {
    console.error(`Review timed out after ${(120_000 / 1000)}s.`);
    process.exitCode = 1;
    return;
  }

  if (result.code !== 0 && result.stderr) {
    if (result.stderr.includes("login") || result.stderr.includes("auth") || result.stderr.includes("unauthorized")) {
      console.error("Copilot authentication failed. Run `!copilot login` to authenticate.");
    } else {
      console.error(`Review failed: ${result.stderr}`);
    }
    process.exitCode = result.code;
    return;
  }

  console.log(result.stdout);
}

async function handleCouncil(argv, cwd) {
  const { options } = parseArgs(argv);
  const workspaceRoot = isGitRepo(cwd) ? getRepoRoot(cwd) : cwd;
  const settings = readSettings(workspaceRoot);
  const binary = findCopilotBinary(getConfiguredBinary(workspaceRoot));

  if (!binary) {
    console.error("Copilot CLI not found. Run /copilot:setup first.");
    process.exitCode = 1;
    return;
  }

  if (!isGitRepo(cwd)) {
    console.error("Not inside a git repository.");
    process.exitCode = 1;
    return;
  }

  const models = options.models
    ? options.models.split(",").map((m) => m.trim())
    : getCouncilModels(workspaceRoot);
  const effort = options.effort ?? settings["council-effort"];
  const base = options.base;

  const { diff, stat } = getDiffContext(cwd, base);

  if (!diff && !getStatus(cwd)) {
    console.log("Nothing to review — no changes detected.");
    return;
  }

  const reviewPrompt = `You are a senior code reviewer. Review the following git diff carefully.

Focus on:
- Bugs, logic errors, and edge cases
- Security vulnerabilities
- Performance issues
- Code quality and maintainability
- Missing error handling

Be specific. Reference file names and line numbers. Be direct about issues.
Format each finding as: [SEVERITY] file:line — description

${base ? `Changes from ${base} to HEAD:` : "Working tree changes:"}

${stat ? `Summary: ${stat}\n` : ""}
\`\`\`diff
${diff || getStatus(cwd)}
\`\`\``;

  process.stderr.write(`Running council review with ${models.join(", ")} (effort: ${effort})...\n`);

  const results = await runCouncilPrompts(cwd, {
    prompt: reviewPrompt,
    models,
    effort,
    binaryPath: binary.path,
  });

  // Output each model's review for Claude to synthesize
  const output = [];
  output.push("# Council Review Results\n");
  output.push(`Models: ${models.join(", ")}`);
  output.push(`Effort: ${effort}\n`);

  for (const result of results) {
    output.push(`## ${result.model}\n`);
    if (result.timedOut) {
      output.push("*Timed out*\n");
    } else if (result.code !== 0) {
      output.push(`*Error (exit ${result.code}):* ${result.stderr}\n`);
    } else {
      output.push(result.stdout);
    }
    output.push("");
  }

  output.push("---");
  output.push("**SYNTHESIS NEEDED:** Claude, please synthesize the above reviews into a single report:");
  output.push("1. **Agreements** — Issues flagged by multiple models (high confidence)");
  output.push("2. **Disagreements** — Conflicting assessments (needs human attention)");
  output.push("3. **Unique catches** — Issues only one model found (edge case signals)");
  output.push("4. **Overall assessment** — Combined verdict on the code quality");

  console.log(output.join("\n"));
}

async function handleDelegate(argv, cwd) {
  const { options, positionals } = parseArgs(argv);
  const workspaceRoot = isGitRepo(cwd) ? getRepoRoot(cwd) : cwd;
  const settings = readSettings(workspaceRoot);
  const binary = findCopilotBinary(getConfiguredBinary(workspaceRoot));

  if (!binary) {
    console.error("Copilot CLI not found. Run /copilot:setup first.");
    process.exitCode = 1;
    return;
  }

  const prompt = positionals.join(" ").trim();
  if (!prompt) {
    console.error("Provide a task prompt. Example: /copilot:delegate investigate why tests are failing");
    process.exitCode = 1;
    return;
  }

  const model = options.model ?? "gpt-5.3-codex";
  const effort = options.effort ?? getDefaultEffort(workspaceRoot);

  process.stderr.write(`Delegating to ${model} (effort: ${effort})...\n`);

  const result = await runCopilotPrompt(cwd, {
    prompt,
    model,
    effort,
    binaryPath: binary.path,
    allowAllTools: true,
  });

  if (result.timedOut) {
    console.error("Task timed out.");
    process.exitCode = 1;
    return;
  }

  if (result.code !== 0 && result.stderr) {
    if (result.stderr.includes("login") || result.stderr.includes("auth")) {
      console.error("Copilot authentication failed. Run `!copilot login` to authenticate.");
    } else {
      console.error(`Task failed: ${result.stderr}`);
    }
    process.exitCode = result.code;
    return;
  }

  console.log(result.stdout);
}

function handleStatus(argv, cwd) {
  const { positionals } = parseArgs(argv);
  const workspaceRoot = isGitRepo(cwd) ? getRepoRoot(cwd) : cwd;

  cleanStaleJobs(workspaceRoot);

  const jobId = positionals[0];
  if (jobId) {
    const job = readJob(workspaceRoot, jobId);
    if (!job) {
      console.error(`Job ${jobId} not found.`);
      process.exitCode = 1;
      return;
    }
    console.log(JSON.stringify(job, null, 2));
    return;
  }

  const jobs = listJobs(workspaceRoot);
  if (jobs.length === 0) {
    console.log("No jobs found.");
    return;
  }

  const lines = ["# Copilot Jobs\n"];
  for (const job of jobs.slice(0, 10)) {
    const status = job.status === "running" ? "Running" : job.status === "completed" ? "Done" : job.status;
    lines.push(`- **${job.id}** [${status}] ${job.command} — ${job.model ?? "default"} (${job.startedAt})`);
  }
  console.log(lines.join("\n"));
}

function handleResult(argv, cwd) {
  const { positionals } = parseArgs(argv);
  const workspaceRoot = isGitRepo(cwd) ? getRepoRoot(cwd) : cwd;

  const jobId = positionals[0];
  const job = jobId
    ? readJob(workspaceRoot, jobId)
    : findJob(workspaceRoot, { status: "completed" });

  if (!job) {
    console.error(jobId ? `Job ${jobId} not found.` : "No completed jobs found.");
    process.exitCode = 1;
    return;
  }

  if (job.status === "running") {
    console.log(`Job ${job.id} is still running. Use /copilot:status to check progress.`);
    return;
  }

  const lines = [];
  lines.push(`# Result: ${job.id}\n`);
  lines.push(`- Command: ${job.command}`);
  lines.push(`- Model: ${job.model ?? "default"}`);
  lines.push(`- Status: ${job.status}`);
  lines.push(`- Started: ${job.startedAt}`);
  lines.push(`- Completed: ${job.completedAt ?? "—"}`);
  lines.push("");

  if (job.stdout) {
    lines.push("## Output\n");
    lines.push(job.stdout);
  }

  if (job.stderr) {
    lines.push("\n## Errors\n");
    lines.push(job.stderr);
  }

  console.log(lines.join("\n"));
}

function handleCancel(argv, cwd) {
  const { positionals } = parseArgs(argv);
  const workspaceRoot = isGitRepo(cwd) ? getRepoRoot(cwd) : cwd;

  const jobId = positionals[0];
  const job = jobId
    ? readJob(workspaceRoot, jobId)
    : findJob(workspaceRoot, { status: "running" });

  if (!job) {
    console.error(jobId ? `Job ${jobId} not found.` : "No running jobs found.");
    process.exitCode = 1;
    return;
  }

  if (job.status !== "running") {
    console.log(`Job ${job.id} is not running (status: ${job.status}).`);
    return;
  }

  // Kill the process
  if (job.pid) {
    try {
      process.kill(job.pid, "SIGTERM");
      setTimeout(() => {
        try { process.kill(job.pid, "SIGKILL"); } catch { /* already dead */ }
      }, 5000);
    } catch { /* already dead */ }
  }

  updateJob(workspaceRoot, job.id, {
    status: "cancelled",
    completedAt: new Date().toISOString(),
    stderr: (job.stderr ?? "") + "\nCancelled by user.",
  });

  console.log(`Job ${job.id} cancelled.`);
}

async function main() {
  const [subcommand, ...argv] = process.argv.slice(2);
  const cwd = process.cwd();

  if (!subcommand || subcommand === "help" || subcommand === "--help") {
    console.log([
      "Usage:",
      "  node copilot-companion.mjs setup [--json]",
      "  node copilot-companion.mjs review [--base <ref>] [--model <m>] [--effort <e>]",
      "  node copilot-companion.mjs council [--models <m1,m2>] [--effort <e>] [--base <ref>]",
      "  node copilot-companion.mjs delegate [--model <m>] [--effort <e>] <prompt>",
      "  node copilot-companion.mjs status [job-id]",
      "  node copilot-companion.mjs result [job-id]",
      "  node copilot-companion.mjs cancel [job-id]",
    ].join("\n"));
    return;
  }

  switch (subcommand) {
    case "setup": handleSetup(argv, cwd); break;
    case "review": await handleReview(argv, cwd); break;
    case "council": await handleCouncil(argv, cwd); break;
    case "delegate": await handleDelegate(argv, cwd); break;
    case "status": handleStatus(argv, cwd); break;
    case "result": handleResult(argv, cwd); break;
    case "cancel": handleCancel(argv, cwd); break;
    default:
      console.error(`Unknown command: ${subcommand}`);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
