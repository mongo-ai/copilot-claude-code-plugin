import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  readSettings,
  getCouncilModels,
  getDefaultModel,
  getDefaultEffort,
  getConfiguredBinary,
} from "../scripts/lib/settings.mjs";

/** Create a fresh temp directory for each test. */
function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "settings-test-"));
}

/** Write a .claude/copilot.local.md file inside the given workspace root. */
function writeSettingsFile(root, content) {
  const dir = path.join(root, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "copilot.local.md"), content, "utf8");
}

// ---------------------------------------------------------------------------
// readSettings
// ---------------------------------------------------------------------------

describe("readSettings", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns defaults when no settings file exists", () => {
    const settings = readSettings(tmpDir);
    assert.deepStrictEqual(settings, {
      "council-models": "gpt-5.4, claude-opus-4.6, gpt-5.3-codex",
      "council-effort": "high",
      "default-model": "gpt-5.4",
      "default-effort": "high",
      "copilot-binary": "auto",
      "review-gate": "off",
      "review-gate-model": "gpt-5.4-mini",
    });
  });

  it("parses a single setting and merges with defaults", () => {
    writeSettingsFile(tmpDir, "- default-model: o3-pro\n");
    const settings = readSettings(tmpDir);

    assert.equal(settings["default-model"], "o3-pro");
    // other defaults unchanged
    assert.equal(settings["council-effort"], "high");
    assert.equal(settings["copilot-binary"], "auto");
  });

  it("parses multiple settings", () => {
    writeSettingsFile(
      tmpDir,
      [
        "- default-model: o3-pro",
        "- default-effort: low",
        "- copilot-binary: /usr/local/bin/copilot",
      ].join("\n")
    );
    const settings = readSettings(tmpDir);

    assert.equal(settings["default-model"], "o3-pro");
    assert.equal(settings["default-effort"], "low");
    assert.equal(settings["copilot-binary"], "/usr/local/bin/copilot");
  });

  it("ignores lines that do not match the expected pattern", () => {
    writeSettingsFile(
      tmpDir,
      [
        "# Settings",
        "",
        "Some random text",
        "- default-model: o3-pro",
        "not-a-setting: value",
        "  - indented: wrong",
      ].join("\n")
    );
    const settings = readSettings(tmpDir);

    assert.equal(settings["default-model"], "o3-pro");
    // everything else stays default
    assert.equal(settings["default-effort"], "high");
  });

  it("ignores keys not present in DEFAULTS", () => {
    writeSettingsFile(tmpDir, "- unknown-key: secret\n");
    const settings = readSettings(tmpDir);

    assert.equal(settings["unknown-key"], undefined);
    // defaults intact
    assert.equal(settings["default-model"], "gpt-5.4");
  });

  it("trims whitespace from values", () => {
    writeSettingsFile(tmpDir, "- default-model:   o3-pro   \n");
    const settings = readSettings(tmpDir);
    assert.equal(settings["default-model"], "o3-pro");
  });

  it("handles Windows-style line endings (CRLF)", () => {
    writeSettingsFile(
      tmpDir,
      "- default-model: o3-pro\r\n- default-effort: low\r\n"
    );
    const settings = readSettings(tmpDir);

    assert.equal(settings["default-model"], "o3-pro");
    assert.equal(settings["default-effort"], "low");
  });

  it("handles an empty file gracefully", () => {
    writeSettingsFile(tmpDir, "");
    const settings = readSettings(tmpDir);

    // all defaults
    assert.equal(settings["default-model"], "gpt-5.4");
    assert.equal(settings["copilot-binary"], "auto");
  });

  it("last value wins when a key is specified multiple times", () => {
    writeSettingsFile(
      tmpDir,
      ["- default-model: first", "- default-model: second"].join("\n")
    );
    const settings = readSettings(tmpDir);
    assert.equal(settings["default-model"], "second");
  });
});

// ---------------------------------------------------------------------------
// getCouncilModels
// ---------------------------------------------------------------------------

describe("getCouncilModels", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns default council models when no file exists", () => {
    const models = getCouncilModels(tmpDir);
    assert.deepStrictEqual(models, [
      "gpt-5.4",
      "claude-opus-4.6",
      "gpt-5.3-codex",
    ]);
  });

  it("returns custom council models from settings", () => {
    writeSettingsFile(tmpDir, "- council-models: alpha, beta\n");
    const models = getCouncilModels(tmpDir);
    assert.deepStrictEqual(models, ["alpha", "beta"]);
  });

  it("trims whitespace from each model name", () => {
    writeSettingsFile(tmpDir, "- council-models:  a ,  b , c \n");
    const models = getCouncilModels(tmpDir);
    assert.deepStrictEqual(models, ["a", "b", "c"]);
  });

  it("returns a single model when only one is specified", () => {
    writeSettingsFile(tmpDir, "- council-models: solo-model\n");
    const models = getCouncilModels(tmpDir);
    assert.deepStrictEqual(models, ["solo-model"]);
  });
});

// ---------------------------------------------------------------------------
// getDefaultModel
// ---------------------------------------------------------------------------

describe("getDefaultModel", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the default model when no file exists", () => {
    assert.equal(getDefaultModel(tmpDir), "gpt-5.4");
  });

  it("returns custom model from settings", () => {
    writeSettingsFile(tmpDir, "- default-model: o3-pro\n");
    assert.equal(getDefaultModel(tmpDir), "o3-pro");
  });
});

// ---------------------------------------------------------------------------
// getDefaultEffort
// ---------------------------------------------------------------------------

describe("getDefaultEffort", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns the default effort when no file exists", () => {
    assert.equal(getDefaultEffort(tmpDir), "high");
  });

  it("returns custom effort from settings", () => {
    writeSettingsFile(tmpDir, "- default-effort: low\n");
    assert.equal(getDefaultEffort(tmpDir), "low");
  });
});

// ---------------------------------------------------------------------------
// getConfiguredBinary
// ---------------------------------------------------------------------------

describe("getConfiguredBinary", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns 'auto' when no file exists", () => {
    assert.equal(getConfiguredBinary(tmpDir), "auto");
  });

  it("returns custom binary path from settings", () => {
    writeSettingsFile(tmpDir, "- copilot-binary: /opt/bin/copilot\n");
    assert.equal(getConfiguredBinary(tmpDir), "/opt/bin/copilot");
  });
});
