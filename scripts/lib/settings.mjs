#!/usr/bin/env node

/**
 * Settings reader — parses .claude/copilot.local.md for user configuration.
 */

import fs from "node:fs";
import path from "node:path";

const SETTINGS_FILE = ".claude/copilot.local.md";

const DEFAULTS = {
  "council-models": "gpt-5.4, claude-opus-4.6, gpt-5.3-codex",
  "council-effort": "high",
  "default-model": "gpt-5.4",
  "default-effort": "high",
  "copilot-binary": "auto",
};

/**
 * Parse settings from the .local.md file.
 * @param {string} workspaceRoot
 * @returns {Record<string, string>}
 */
export function readSettings(workspaceRoot) {
  const filePath = path.join(workspaceRoot, SETTINGS_FILE);
  const settings = { ...DEFAULTS };

  if (!fs.existsSync(filePath)) return settings;

  const content = fs.readFileSync(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  for (const line of lines) {
    const match = line.match(/^-\s+(\S+):\s+(.+)$/);
    if (match) {
      const [, key, value] = match;
      if (key in DEFAULTS) {
        settings[key] = value.trim();
      }
    }
  }

  return settings;
}

/**
 * Get the council models list from settings.
 * @param {string} workspaceRoot
 * @returns {string[]}
 */
export function getCouncilModels(workspaceRoot) {
  const settings = readSettings(workspaceRoot);
  return settings["council-models"].split(",").map((m) => m.trim()).filter(Boolean);
}

/**
 * Get default model from settings.
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function getDefaultModel(workspaceRoot) {
  return readSettings(workspaceRoot)["default-model"];
}

/**
 * Get default effort from settings.
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function getDefaultEffort(workspaceRoot) {
  return readSettings(workspaceRoot)["default-effort"];
}

/**
 * Get configured binary path from settings.
 * @param {string} workspaceRoot
 * @returns {string}
 */
export function getConfiguredBinary(workspaceRoot) {
  return readSettings(workspaceRoot)["copilot-binary"];
}
