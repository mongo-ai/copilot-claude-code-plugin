import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  generateJobId,
  createJob,
  updateJob,
  readJob,
  listJobs,
  findJob,
  cleanStaleJobs,
} from "../scripts/lib/state.mjs";

let tmpDir;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "state-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// generateJobId
// ---------------------------------------------------------------------------
describe("generateJobId", () => {
  it("returns prefix-8hex by default", () => {
    const id = generateJobId();
    assert.match(id, /^job-[0-9a-f]{8}$/);
  });

  it("uses a custom prefix", () => {
    const id = generateJobId("build");
    assert.match(id, /^build-[0-9a-f]{8}$/);
  });

  it("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateJobId()));
    assert.equal(ids.size, 50);
  });
});

// ---------------------------------------------------------------------------
// createJob
// ---------------------------------------------------------------------------
describe("createJob", () => {
  it("creates .copilot-jobs dir and writes JSON", () => {
    const job = { id: "test-0001", command: "echo hi" };
    const record = createJob(tmpDir, job);

    assert.equal(record.id, "test-0001");
    assert.equal(record.command, "echo hi");
    assert.equal(record.status, "running");
    assert.equal(record.completedAt, null);
    assert.equal(record.stdout, null);
    assert.equal(record.stderr, null);
    assert.ok(record.startedAt);

    const filePath = path.join(tmpDir, ".copilot-jobs", "test-0001.json");
    assert.ok(fs.existsSync(filePath));

    const onDisk = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.deepStrictEqual(onDisk, record);
  });

  it("overwrites status even if provided in job object", () => {
    const record = createJob(tmpDir, { id: "x", status: "done" });
    assert.equal(record.status, "running");
  });
});

// ---------------------------------------------------------------------------
// readJob
// ---------------------------------------------------------------------------
describe("readJob", () => {
  it("reads an existing job", () => {
    createJob(tmpDir, { id: "r-1", command: "ls" });
    const job = readJob(tmpDir, "r-1");
    assert.equal(job.id, "r-1");
    assert.equal(job.command, "ls");
  });

  it("returns null for non-existent job", () => {
    assert.equal(readJob(tmpDir, "nope"), null);
  });
});

// ---------------------------------------------------------------------------
// updateJob
// ---------------------------------------------------------------------------
describe("updateJob", () => {
  it("merges updates into existing record", () => {
    createJob(tmpDir, { id: "u-1", command: "npm test" });
    const updated = updateJob(tmpDir, "u-1", {
      status: "completed",
      stdout: "all good",
    });

    assert.equal(updated.status, "completed");
    assert.equal(updated.stdout, "all good");
    assert.equal(updated.command, "npm test");

    // verify persistence
    const onDisk = readJob(tmpDir, "u-1");
    assert.deepStrictEqual(onDisk, updated);
  });

  it("returns null when job does not exist", () => {
    assert.equal(updateJob(tmpDir, "ghost", { status: "failed" }), null);
  });
});

// ---------------------------------------------------------------------------
// listJobs
// ---------------------------------------------------------------------------
describe("listJobs", () => {
  it("returns empty array when no jobs dir exists", () => {
    assert.deepStrictEqual(listJobs(tmpDir), []);
  });

  it("returns jobs sorted newest first", () => {
    // create jobs with controlled startedAt ordering
    const dir = path.join(tmpDir, ".copilot-jobs");
    fs.mkdirSync(dir, { recursive: true });

    const older = {
      id: "a",
      status: "completed",
      startedAt: "2024-01-01T00:00:00.000Z",
    };
    const newer = {
      id: "b",
      status: "running",
      startedAt: "2024-06-01T00:00:00.000Z",
    };

    fs.writeFileSync(path.join(dir, "a.json"), JSON.stringify(older));
    fs.writeFileSync(path.join(dir, "b.json"), JSON.stringify(newer));

    const jobs = listJobs(tmpDir);
    assert.equal(jobs.length, 2);
    assert.equal(jobs[0].id, "b");
    assert.equal(jobs[1].id, "a");
  });

  it("skips non-json files", () => {
    const dir = path.join(tmpDir, ".copilot-jobs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "readme.txt"), "ignore me");
    fs.writeFileSync(
      path.join(dir, "j.json"),
      JSON.stringify({ id: "j", startedAt: "2024-01-01T00:00:00.000Z" })
    );

    const jobs = listJobs(tmpDir);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, "j");
  });

  it("skips malformed JSON files", () => {
    const dir = path.join(tmpDir, ".copilot-jobs");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "bad.json"), "{not valid json");
    fs.writeFileSync(
      path.join(dir, "ok.json"),
      JSON.stringify({ id: "ok", startedAt: "2024-01-01T00:00:00.000Z" })
    );

    const jobs = listJobs(tmpDir);
    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].id, "ok");
  });
});

// ---------------------------------------------------------------------------
// findJob
// ---------------------------------------------------------------------------
describe("findJob", () => {
  it("finds most recent job matching status", () => {
    const dir = path.join(tmpDir, ".copilot-jobs");
    fs.mkdirSync(dir, { recursive: true });

    const jobs = [
      { id: "f1", status: "completed", command: "a", startedAt: "2024-01-01T00:00:00.000Z" },
      { id: "f2", status: "running",   command: "b", startedAt: "2024-02-01T00:00:00.000Z" },
      { id: "f3", status: "running",   command: "c", startedAt: "2024-03-01T00:00:00.000Z" },
    ];
    for (const j of jobs) {
      fs.writeFileSync(path.join(dir, `${j.id}.json`), JSON.stringify(j));
    }

    const found = findJob(tmpDir, { status: "running" });
    assert.equal(found.id, "f3");
  });

  it("finds most recent job matching command", () => {
    const dir = path.join(tmpDir, ".copilot-jobs");
    fs.mkdirSync(dir, { recursive: true });

    const jobs = [
      { id: "c1", status: "completed", command: "test", startedAt: "2024-01-01T00:00:00.000Z" },
      { id: "c2", status: "running",   command: "test", startedAt: "2024-06-01T00:00:00.000Z" },
      { id: "c3", status: "running",   command: "lint", startedAt: "2024-09-01T00:00:00.000Z" },
    ];
    for (const j of jobs) {
      fs.writeFileSync(path.join(dir, `${j.id}.json`), JSON.stringify(j));
    }

    const found = findJob(tmpDir, { command: "test" });
    assert.equal(found.id, "c2");
  });

  it("filters by both status and command", () => {
    const dir = path.join(tmpDir, ".copilot-jobs");
    fs.mkdirSync(dir, { recursive: true });

    const jobs = [
      { id: "d1", status: "completed", command: "test", startedAt: "2024-01-01T00:00:00.000Z" },
      { id: "d2", status: "running",   command: "lint", startedAt: "2024-06-01T00:00:00.000Z" },
      { id: "d3", status: "running",   command: "test", startedAt: "2024-03-01T00:00:00.000Z" },
    ];
    for (const j of jobs) {
      fs.writeFileSync(path.join(dir, `${j.id}.json`), JSON.stringify(j));
    }

    const found = findJob(tmpDir, { status: "running", command: "test" });
    assert.equal(found.id, "d3");
  });

  it("returns null when nothing matches", () => {
    createJob(tmpDir, { id: "n1", command: "ls" });
    assert.equal(findJob(tmpDir, { status: "completed" }), null);
  });

  it("returns most recent job when no filter given", () => {
    const dir = path.join(tmpDir, ".copilot-jobs");
    fs.mkdirSync(dir, { recursive: true });

    const jobs = [
      { id: "e1", status: "completed", startedAt: "2024-01-01T00:00:00.000Z" },
      { id: "e2", status: "running",   startedAt: "2024-12-01T00:00:00.000Z" },
    ];
    for (const j of jobs) {
      fs.writeFileSync(path.join(dir, `${j.id}.json`), JSON.stringify(j));
    }

    const found = findJob(tmpDir);
    assert.equal(found.id, "e2");
  });
});

// ---------------------------------------------------------------------------
// cleanStaleJobs
// ---------------------------------------------------------------------------
describe("cleanStaleJobs", () => {
  it("marks running job with dead PID as failed", () => {
    const dir = path.join(tmpDir, ".copilot-jobs");
    fs.mkdirSync(dir, { recursive: true });

    // PID 99999999 should not exist
    const stale = {
      id: "s1",
      status: "running",
      pid: 99999999,
      startedAt: "2024-01-01T00:00:00.000Z",
      stderr: "",
    };
    fs.writeFileSync(path.join(dir, "s1.json"), JSON.stringify(stale));

    cleanStaleJobs(tmpDir);

    const updated = readJob(tmpDir, "s1");
    assert.equal(updated.status, "failed");
    assert.ok(updated.completedAt);
    assert.ok(updated.stderr.includes("exited unexpectedly"));
  });

  it("does not touch running jobs with live PIDs", () => {
    const dir = path.join(tmpDir, ".copilot-jobs");
    fs.mkdirSync(dir, { recursive: true });

    // Use our own PID which is definitely alive
    const alive = {
      id: "s2",
      status: "running",
      pid: process.pid,
      startedAt: "2024-01-01T00:00:00.000Z",
    };
    fs.writeFileSync(path.join(dir, "s2.json"), JSON.stringify(alive));

    cleanStaleJobs(tmpDir);

    const job = readJob(tmpDir, "s2");
    assert.equal(job.status, "running");
  });

  it("does not touch completed jobs", () => {
    const dir = path.join(tmpDir, ".copilot-jobs");
    fs.mkdirSync(dir, { recursive: true });

    const done = {
      id: "s3",
      status: "completed",
      pid: 99999999,
      startedAt: "2024-01-01T00:00:00.000Z",
    };
    fs.writeFileSync(path.join(dir, "s3.json"), JSON.stringify(done));

    cleanStaleJobs(tmpDir);

    const job = readJob(tmpDir, "s3");
    assert.equal(job.status, "completed");
  });

  it("does not touch running jobs without a PID", () => {
    const dir = path.join(tmpDir, ".copilot-jobs");
    fs.mkdirSync(dir, { recursive: true });

    const noPid = {
      id: "s4",
      status: "running",
      startedAt: "2024-01-01T00:00:00.000Z",
    };
    fs.writeFileSync(path.join(dir, "s4.json"), JSON.stringify(noPid));

    cleanStaleJobs(tmpDir);

    const job = readJob(tmpDir, "s4");
    assert.equal(job.status, "running");
  });
});
