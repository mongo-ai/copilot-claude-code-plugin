#!/usr/bin/env node

/**
 * Copilot CLI wrapper — spawns `copilot -p` and returns structured results.
 */

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DEFAULT_TIMEOUT_MS = 120_000;

const KNOWN_BINARY_LOCATIONS = [
  // VS Code Insiders (macOS)
  path.join(os.homedir(), "Library/Application Support/Code - Insiders/User/globalStorage/github.copilot-chat/copilotCli/copilot"),
  // VS Code stable (macOS)
  path.join(os.homedir(), "Library/Application Support/Code/User/globalStorage/github.copilot-chat/copilotCli/copilot"),
  // VS Code (Linux)
  path.join(os.homedir(), ".config/Code/User/globalStorage/github.copilot-chat/copilotCli/copilot"),
  // VS Code Insiders (Linux)
  path.join(os.homedir(), ".config/Code - Insiders/User/globalStorage/github.copilot-chat/copilotCli/copilot"),
];

/**
 * Locate the copilot binary. Checks PATH first, then known VS Code locations.
 * @param {string} [configuredPath] - Explicit path from settings.
 * @returns {{ path: string, source: string } | null}
 */
export function findCopilotBinary(configuredPath) {
  if (configuredPath && configuredPath !== "auto") {
    if (fs.existsSync(configuredPath)) {
      return { path: configuredPath, source: "settings" };
    }
    return null;
  }

  // Check PATH
  try {
    const result = execFileSync("which", ["copilot"], { encoding: "utf8", timeout: 5000 }).trim();
    if (result) return { path: result, source: "PATH" };
  } catch { /* not in PATH */ }

  // Check known locations
  for (const loc of KNOWN_BINARY_LOCATIONS) {
    if (fs.existsSync(loc)) {
      return { path: loc, source: "vscode" };
    }
  }

  return null;
}

/**
 * Check if the user is logged in to the Copilot CLI.
 * @param {string} binaryPath
 * @returns {{ loggedIn: boolean, detail: string }}
 */
export function getLoginStatus(binaryPath) {
  try {
    const output = execFileSync(binaryPath, ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim();
    // If version returns successfully, CLI is installed. Auth is checked on first prompt.
    return { loggedIn: true, detail: output };
  } catch (err) {
    return { loggedIn: false, detail: err.message };
  }
}

/**
 * Run a prompt through the Copilot CLI in non-interactive mode.
 *
 * @param {string} cwd - Working directory.
 * @param {object} options
 * @param {string} options.prompt - The prompt text.
 * @param {string} [options.model] - Model to use (e.g. "gpt-5.4").
 * @param {string} [options.effort] - Reasoning effort ("low"|"medium"|"high"|"xhigh").
 * @param {string} [options.binaryPath] - Explicit binary path.
 * @param {number} [options.timeout] - Timeout in ms (default 120s).
 * @param {boolean} [options.allowAllTools] - Pass --allow-all-tools (for delegate).
 * @returns {Promise<{ code: number, stdout: string, stderr: string, timedOut: boolean }>}
 */
export function runCopilotPrompt(cwd, options) {
  const binary = options.binaryPath || "copilot";
  const timeout = options.timeout ?? DEFAULT_TIMEOUT_MS;

  const args = ["-p", options.prompt, "-s"];
  if (options.model) args.push("--model", options.model);
  if (options.effort) args.push("--effort", options.effort);
  if (options.allowAllTools) args.push("--allow-all-tools");

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    const proc = spawn(binary, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill("SIGTERM");
      setTimeout(() => {
        if (!proc.killed) proc.kill("SIGKILL");
      }, 5000);
    }, timeout);

    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (d) => { stdout += d; });
    proc.stderr.on("data", (d) => { stderr += d; });

    proc.on("close", (code) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        resolve({ code: code ?? 1, stdout, stderr, timedOut });
      }
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        // Auth or binary errors surface through stderr
        if (err.code === "ENOENT") {
          resolve({ code: 127, stdout: "", stderr: `Copilot CLI not found at: ${binary}`, timedOut: false });
        } else {
          reject(err);
        }
      }
    });
  });
}

/**
 * Run prompts across multiple models in parallel for council review.
 * Falls back to sequential with delay if rate limiting is detected.
 *
 * @param {string} cwd
 * @param {object} options
 * @param {string} options.prompt
 * @param {string[]} options.models
 * @param {string} [options.effort]
 * @param {string} [options.binaryPath]
 * @param {number} [options.timeout]
 * @returns {Promise<Array<{ model: string, code: number, stdout: string, stderr: string, timedOut: boolean }>>}
 */
export async function runCouncilPrompts(cwd, options) {
  const { prompt, models, effort, binaryPath, timeout } = options;

  // Try parallel first
  const results = await Promise.allSettled(
    models.map((model) =>
      runCopilotPrompt(cwd, { prompt, model, effort, binaryPath, timeout })
        .then((r) => ({ model, ...r }))
    )
  );

  // Check for rate limiting
  const hasRateLimit = results.some(
    (r) => r.status === "fulfilled" && r.value.stderr.includes("rate")
  );

  if (hasRateLimit) {
    // Fall back to sequential with delay
    const sequential = [];
    for (const model of models) {
      if (sequential.length > 0) {
        await new Promise((r) => setTimeout(r, 2000));
      }
      const result = await runCopilotPrompt(cwd, { prompt, model, effort, binaryPath, timeout });
      sequential.push({ model, ...result });
    }
    return sequential;
  }

  return results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { model: "unknown", code: 1, stdout: "", stderr: r.reason?.message ?? "Unknown error", timedOut: false }
  );
}
