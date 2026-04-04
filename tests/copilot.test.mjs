/**
 * Tests for scripts/lib/copilot.mjs
 *
 * Run: node --test tests/copilot.test.mjs
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const {
  findCopilotBinary,
  getLoginStatus,
  runCopilotPrompt,
  runCouncilPrompts,
} = await import(path.join(__dirname, "..", "scripts", "lib", "copilot.mjs"));

// ---------------------------------------------------------------------------
// Helpers — temp directory & fake binary
// ---------------------------------------------------------------------------

let tmpDir;
let fakeBinary;
let fakeBinaryWithStderr;
let fakeBinaryRateLimit;
let fakeBinarySlow;
let fakeBinaryFail;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "copilot-test-"));

  // A fake binary that echoes all arguments to stdout and exits 0.
  fakeBinary = path.join(tmpDir, "fake-copilot");
  fs.writeFileSync(
    fakeBinary,
    '#!/usr/bin/env bash\necho "ARGS: $@"\n',
    { mode: 0o755 }
  );

  // Fake binary that writes to stderr (simulates warnings).
  fakeBinaryWithStderr = path.join(tmpDir, "fake-copilot-stderr");
  fs.writeFileSync(
    fakeBinaryWithStderr,
    '#!/usr/bin/env bash\necho "ok" >&1\necho "warning: something" >&2\nexit 0\n',
    { mode: 0o755 }
  );

  // Fake binary that outputs "rate" in stderr (triggers rate-limit fallback).
  fakeBinaryRateLimit = path.join(tmpDir, "fake-copilot-rate");
  fs.writeFileSync(
    fakeBinaryRateLimit,
    '#!/usr/bin/env bash\necho "ARGS: $@"\necho "rate limit exceeded" >&2\nexit 0\n',
    { mode: 0o755 }
  );

  // Fake binary that sleeps longer than a short timeout.
  fakeBinarySlow = path.join(tmpDir, "fake-copilot-slow");
  fs.writeFileSync(
    fakeBinarySlow,
    '#!/usr/bin/env bash\nsleep 30\necho "done"\n',
    { mode: 0o755 }
  );

  // Fake binary that exits non-zero.
  fakeBinaryFail = path.join(tmpDir, "fake-copilot-fail");
  fs.writeFileSync(
    fakeBinaryFail,
    '#!/usr/bin/env bash\necho "error output" >&2\nexit 42\n',
    { mode: 0o755 }
  );
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ===========================================================================
// findCopilotBinary
// ===========================================================================

describe("findCopilotBinary", () => {
  it("returns settings source when configuredPath points to an existing file", () => {
    const result = findCopilotBinary(fakeBinary);
    assert.deepStrictEqual(result, { path: fakeBinary, source: "settings" });
  });

  it("returns null when configuredPath points to a non-existing file", () => {
    const result = findCopilotBinary(path.join(tmpDir, "does-not-exist"));
    assert.strictEqual(result, null);
  });

  it('treats "auto" the same as no configured path (falls through to PATH/known locations)', () => {
    // "auto" should NOT be treated as a literal path.
    // It may or may not find copilot on the system — we just verify it does
    // not return source: "settings".
    const result = findCopilotBinary("auto");
    if (result) {
      assert.notStrictEqual(result.source, "settings");
    } else {
      // null is also acceptable — just means copilot is not installed.
      assert.strictEqual(result, null);
    }
  });

  it("falls through to PATH or known locations when configuredPath is undefined", () => {
    const result = findCopilotBinary(undefined);
    // Result depends on the host system. Verify shape if found.
    if (result) {
      assert.ok(result.path);
      assert.ok(["PATH", "vscode"].includes(result.source));
    } else {
      assert.strictEqual(result, null);
    }
  });

  it("falls through to PATH or known locations when configuredPath is empty string", () => {
    // Empty string is falsy, so it should behave like undefined.
    const result = findCopilotBinary("");
    if (result) {
      assert.ok(result.path);
      assert.ok(["PATH", "vscode"].includes(result.source));
    } else {
      assert.strictEqual(result, null);
    }
  });
});

// ===========================================================================
// getLoginStatus
// ===========================================================================

describe("getLoginStatus", () => {
  it("returns loggedIn: true when binary runs successfully", () => {
    const result = getLoginStatus(fakeBinary);
    assert.strictEqual(result.loggedIn, true);
    assert.ok(typeof result.detail === "string");
    // The fake binary echoes "ARGS: --version"
    assert.ok(result.detail.includes("--version"), `detail should contain --version, got: ${result.detail}`);
  });

  it("returns loggedIn: false when binary does not exist", () => {
    const result = getLoginStatus(path.join(tmpDir, "nonexistent-binary"));
    assert.strictEqual(result.loggedIn, false);
    assert.ok(result.detail.length > 0);
  });

  it("returns loggedIn: false when binary exits with error", () => {
    const result = getLoginStatus(fakeBinaryFail);
    assert.strictEqual(result.loggedIn, false);
    assert.ok(result.detail.length > 0);
  });
});

// ===========================================================================
// runCopilotPrompt
// ===========================================================================

describe("runCopilotPrompt", () => {
  it("passes prompt with -p and -s flags", async () => {
    const result = await runCopilotPrompt(tmpDir, {
      prompt: "hello world",
      binaryPath: fakeBinary,
    });
    assert.strictEqual(result.code, 0);
    assert.strictEqual(result.timedOut, false);
    assert.ok(result.stdout.includes("-p"));
    assert.ok(result.stdout.includes("hello world"));
    assert.ok(result.stdout.includes("-s"));
  });

  it("passes --model flag when model is specified", async () => {
    const result = await runCopilotPrompt(tmpDir, {
      prompt: "test",
      model: "gpt-5.4",
      binaryPath: fakeBinary,
    });
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes("--model"));
    assert.ok(result.stdout.includes("gpt-5.4"));
  });

  it("passes --effort flag when effort is specified", async () => {
    const result = await runCopilotPrompt(tmpDir, {
      prompt: "test",
      effort: "high",
      binaryPath: fakeBinary,
    });
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes("--effort"));
    assert.ok(result.stdout.includes("high"));
  });

  it("passes --allow-all-tools flag when allowAllTools is true", async () => {
    const result = await runCopilotPrompt(tmpDir, {
      prompt: "test",
      allowAllTools: true,
      binaryPath: fakeBinary,
    });
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes("--allow-all-tools"));
  });

  it("does NOT pass --allow-all-tools when allowAllTools is falsy", async () => {
    const result = await runCopilotPrompt(tmpDir, {
      prompt: "test",
      binaryPath: fakeBinary,
    });
    assert.ok(!result.stdout.includes("--allow-all-tools"));
  });

  it("passes all optional flags together", async () => {
    const result = await runCopilotPrompt(tmpDir, {
      prompt: "multi-flag test",
      model: "o3",
      effort: "xhigh",
      allowAllTools: true,
      binaryPath: fakeBinary,
    });
    assert.strictEqual(result.code, 0);
    assert.ok(result.stdout.includes("--model"));
    assert.ok(result.stdout.includes("o3"));
    assert.ok(result.stdout.includes("--effort"));
    assert.ok(result.stdout.includes("xhigh"));
    assert.ok(result.stdout.includes("--allow-all-tools"));
  });

  it("captures stderr output", async () => {
    const result = await runCopilotPrompt(tmpDir, {
      prompt: "test",
      binaryPath: fakeBinaryWithStderr,
    });
    assert.strictEqual(result.code, 0);
    assert.ok(result.stderr.includes("warning"));
  });

  it("returns non-zero exit code from failing binary", async () => {
    const result = await runCopilotPrompt(tmpDir, {
      prompt: "test",
      binaryPath: fakeBinaryFail,
    });
    assert.strictEqual(result.code, 42);
    assert.strictEqual(result.timedOut, false);
    assert.ok(result.stderr.includes("error output"));
  });

  it("returns code 127 and descriptive stderr for ENOENT (binary not found)", async () => {
    const result = await runCopilotPrompt(tmpDir, {
      prompt: "test",
      binaryPath: path.join(tmpDir, "no-such-binary"),
    });
    assert.strictEqual(result.code, 127);
    assert.strictEqual(result.timedOut, false);
    assert.ok(result.stderr.includes("not found"));
  });

  it("times out and sets timedOut flag for a slow binary", async () => {
    const result = await runCopilotPrompt(tmpDir, {
      prompt: "test",
      binaryPath: fakeBinarySlow,
      timeout: 500, // 500ms — the fake binary sleeps 30s
    });
    assert.strictEqual(result.timedOut, true);
  });
});

// ===========================================================================
// runCouncilPrompts
// ===========================================================================

describe("runCouncilPrompts", () => {
  it("runs prompts across multiple models and returns results with model field", async () => {
    const results = await runCouncilPrompts(tmpDir, {
      prompt: "council test",
      models: ["model-a", "model-b", "model-c"],
      binaryPath: fakeBinary,
    });

    assert.strictEqual(results.length, 3);

    const models = results.map((r) => r.model);
    assert.ok(models.includes("model-a"));
    assert.ok(models.includes("model-b"));
    assert.ok(models.includes("model-c"));

    for (const r of results) {
      assert.strictEqual(r.code, 0);
      assert.strictEqual(r.timedOut, false);
      assert.ok(r.stdout.includes("council test"));
      assert.ok(r.stdout.includes("--model"));
      assert.ok(r.stdout.includes(r.model));
    }
  });

  it("falls back to sequential execution when rate limiting is detected", async () => {
    const results = await runCouncilPrompts(tmpDir, {
      prompt: "rate test",
      models: ["m1", "m2"],
      binaryPath: fakeBinaryRateLimit,
    });

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].model, "m1");
    assert.strictEqual(results[1].model, "m2");

    for (const r of results) {
      assert.strictEqual(r.code, 0);
      assert.ok(r.stdout.includes("rate test"));
    }
  });

  it("handles ENOENT gracefully for all models", async () => {
    const results = await runCouncilPrompts(tmpDir, {
      prompt: "test",
      models: ["x", "y"],
      binaryPath: path.join(tmpDir, "nonexistent"),
    });

    assert.strictEqual(results.length, 2);
    for (const r of results) {
      assert.strictEqual(r.code, 127);
      assert.ok(r.stderr.includes("not found"));
    }
  });

  it("passes effort option to each model run", async () => {
    const results = await runCouncilPrompts(tmpDir, {
      prompt: "effort test",
      models: ["a"],
      effort: "low",
      binaryPath: fakeBinary,
    });

    assert.strictEqual(results.length, 1);
    assert.ok(results[0].stdout.includes("--effort"));
    assert.ok(results[0].stdout.includes("low"));
  });
});
