#!/usr/bin/env node

/**
 * Git helpers — collect diff context for reviews.
 */

import { execFileSync } from "node:child_process";

/**
 * Check if cwd is inside a git repository.
 * @param {string} cwd
 * @returns {boolean}
 */
export function isGitRepo(cwd) {
  try {
    execFileSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the repository root.
 * @param {string} cwd
 * @returns {string}
 */
export function getRepoRoot(cwd) {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd, encoding: "utf8", timeout: 5000 }).trim();
}

/**
 * Get the current branch name.
 * @param {string} cwd
 * @returns {string}
 */
export function getCurrentBranch(cwd) {
  try {
    return execFileSync("git", ["branch", "--show-current"], { cwd, encoding: "utf8", timeout: 5000 }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Get a short status summary.
 * @param {string} cwd
 * @returns {string}
 */
export function getStatus(cwd) {
  return execFileSync("git", ["status", "--short", "--untracked-files=all"], { cwd, encoding: "utf8", timeout: 5000 }).trim();
}

/**
 * Get diff stats.
 * @param {string} cwd
 * @param {string} [base] - Base ref for branch comparison.
 * @returns {{ stat: string, diff: string }}
 */
export function getDiffContext(cwd, base) {
  if (base) {
    const stat = execFileSync("git", ["diff", "--shortstat", `${base}...HEAD`], { cwd, encoding: "utf8", timeout: 10_000 }).trim();
    const diff = execFileSync("git", ["diff", `${base}...HEAD`], { cwd, encoding: "utf8", timeout: 30_000 }).trim();
    return { stat, diff };
  }

  // Working tree: staged + unstaged
  const stagedStat = execFileSync("git", ["diff", "--shortstat", "--cached"], { cwd, encoding: "utf8", timeout: 10_000 }).trim();
  const unstagedStat = execFileSync("git", ["diff", "--shortstat"], { cwd, encoding: "utf8", timeout: 10_000 }).trim();
  const stat = [stagedStat, unstagedStat].filter(Boolean).join("\n");

  const staged = execFileSync("git", ["diff", "--cached"], { cwd, encoding: "utf8", timeout: 30_000 }).trim();
  const unstaged = execFileSync("git", ["diff"], { cwd, encoding: "utf8", timeout: 30_000 }).trim();
  const diff = [staged, unstaged].filter(Boolean).join("\n");

  return { stat, diff };
}

/**
 * Estimate review size from diff stats.
 * @param {string} cwd
 * @param {string} [base]
 * @returns {"tiny" | "small" | "medium" | "large"}
 */
export function estimateReviewSize(cwd, base) {
  const { stat } = getDiffContext(cwd, base);
  if (!stat) return "tiny";

  const filesMatch = stat.match(/(\d+)\s+files?\s+changed/);
  const insertMatch = stat.match(/(\d+)\s+insertions?/);
  const deleteMatch = stat.match(/(\d+)\s+deletions?/);

  const files = filesMatch ? parseInt(filesMatch[1], 10) : 0;
  const lines = (insertMatch ? parseInt(insertMatch[1], 10) : 0) + (deleteMatch ? parseInt(deleteMatch[1], 10) : 0);

  if (files <= 2 && lines <= 50) return "tiny";
  if (files <= 5 && lines <= 200) return "small";
  if (files <= 15 && lines <= 1000) return "medium";
  return "large";
}
