#!/usr/bin/env node

/**
 * Job state management — tracks background jobs via JSON files.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const JOBS_DIR = ".copilot-jobs";

/**
 * Ensure the jobs directory exists.
 * @param {string} workspaceRoot
 * @returns {string} Path to jobs directory.
 */
function ensureJobsDir(workspaceRoot) {
  const dir = path.join(workspaceRoot, JOBS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Generate a short unique job ID.
 * @param {string} [prefix="job"]
 * @returns {string}
 */
export function generateJobId(prefix = "job") {
  const id = crypto.randomBytes(4).toString("hex");
  return `${prefix}-${id}`;
}

/**
 * Create a new job record.
 * @param {string} workspaceRoot
 * @param {object} job
 * @returns {object} The saved job record.
 */
export function createJob(workspaceRoot, job) {
  const dir = ensureJobsDir(workspaceRoot);
  const record = {
    ...job,
    status: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    stdout: null,
    stderr: null,
  };
  fs.writeFileSync(path.join(dir, `${job.id}.json`), JSON.stringify(record, null, 2));
  return record;
}

/**
 * Update a job record.
 * @param {string} workspaceRoot
 * @param {string} jobId
 * @param {object} updates
 * @returns {object | null} Updated record or null if not found.
 */
export function updateJob(workspaceRoot, jobId, updates) {
  const filePath = path.join(workspaceRoot, JOBS_DIR, `${jobId}.json`);
  if (!fs.existsSync(filePath)) return null;

  const record = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const updated = { ...record, ...updates };
  fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
  return updated;
}

/**
 * Read a job record.
 * @param {string} workspaceRoot
 * @param {string} jobId
 * @returns {object | null}
 */
export function readJob(workspaceRoot, jobId) {
  const filePath = path.join(workspaceRoot, JOBS_DIR, `${jobId}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * List all jobs, newest first.
 * @param {string} workspaceRoot
 * @returns {object[]}
 */
export function listJobs(workspaceRoot) {
  const dir = path.join(workspaceRoot, JOBS_DIR);
  if (!fs.existsSync(dir)) return [];

  return fs.readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b.startedAt ?? "").localeCompare(a.startedAt ?? ""));
}

/**
 * Find the most recent job matching criteria.
 * @param {string} workspaceRoot
 * @param {object} [filter]
 * @param {string} [filter.status]
 * @param {string} [filter.command]
 * @returns {object | null}
 */
export function findJob(workspaceRoot, filter = {}) {
  const jobs = listJobs(workspaceRoot);
  return jobs.find((j) => {
    if (filter.status && j.status !== filter.status) return false;
    if (filter.command && j.command !== filter.command) return false;
    return true;
  }) ?? null;
}

/**
 * Clean up stale jobs (running but PID is dead).
 * @param {string} workspaceRoot
 */
export function cleanStaleJobs(workspaceRoot) {
  const jobs = listJobs(workspaceRoot);
  for (const job of jobs) {
    if (job.status === "running" && job.pid) {
      try {
        process.kill(job.pid, 0); // Check if process exists
      } catch {
        updateJob(workspaceRoot, job.id, {
          status: "failed",
          completedAt: new Date().toISOString(),
          stderr: (job.stderr ?? "") + "\nJob process exited unexpectedly.",
        });
      }
    }
  }
}
