import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  isGitRepo,
  getRepoRoot,
  getCurrentBranch,
  getStatus,
  getDiffContext,
  estimateReviewSize,
} from "../scripts/lib/git.mjs";

/**
 * Helper: create a temp directory with `git init` and an initial commit.
 * Returns the absolute path to the repo root.
 */
function makeTempRepo() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "git-test-"));
  execFileSync("git", ["init", "--initial-branch=main"], { cwd: tmp });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmp });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: tmp });

  // Create an initial commit so HEAD exists
  fs.writeFileSync(path.join(tmp, "README.md"), "# test\n");
  execFileSync("git", ["add", "."], { cwd: tmp });
  execFileSync("git", ["commit", "-m", "initial"], { cwd: tmp });

  return tmp;
}

/** Helper: remove a temp directory */
function removeTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// isGitRepo
// ---------------------------------------------------------------------------
describe("isGitRepo", () => {
  let repo;
  before(() => { repo = makeTempRepo(); });
  after(() => { removeTempDir(repo); });

  it("returns true for a git repository", () => {
    assert.equal(isGitRepo(repo), true);
  });

  it("returns true for a subdirectory inside a git repository", () => {
    const sub = path.join(repo, "subdir");
    fs.mkdirSync(sub);
    assert.equal(isGitRepo(sub), true);
  });

  it("returns false for a plain directory", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "no-git-"));
    try {
      assert.equal(isGitRepo(plain), false);
    } finally {
      removeTempDir(plain);
    }
  });
});

// ---------------------------------------------------------------------------
// getRepoRoot
// ---------------------------------------------------------------------------
describe("getRepoRoot", () => {
  let repo;
  before(() => { repo = makeTempRepo(); });
  after(() => { removeTempDir(repo); });

  it("returns the repo root path", () => {
    const root = getRepoRoot(repo);
    // Resolve both through realpath to handle /private/tmp symlink on macOS
    assert.equal(fs.realpathSync(root), fs.realpathSync(repo));
  });

  it("returns the repo root when called from a subdirectory", () => {
    const sub = path.join(repo, "deep", "nested");
    fs.mkdirSync(sub, { recursive: true });
    const root = getRepoRoot(sub);
    assert.equal(fs.realpathSync(root), fs.realpathSync(repo));
  });
});

// ---------------------------------------------------------------------------
// getCurrentBranch
// ---------------------------------------------------------------------------
describe("getCurrentBranch", () => {
  let repo;
  before(() => { repo = makeTempRepo(); });
  after(() => { removeTempDir(repo); });

  it("returns the current branch name", () => {
    assert.equal(getCurrentBranch(repo), "main");
  });

  it("returns the new branch after checkout", () => {
    execFileSync("git", ["checkout", "-b", "feature-x"], { cwd: repo });
    assert.equal(getCurrentBranch(repo), "feature-x");
    // Switch back
    execFileSync("git", ["checkout", "main"], { cwd: repo });
  });

  it("returns 'unknown' for a non-git directory", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "no-git-"));
    try {
      assert.equal(getCurrentBranch(plain), "unknown");
    } finally {
      removeTempDir(plain);
    }
  });
});

// ---------------------------------------------------------------------------
// getStatus
// ---------------------------------------------------------------------------
describe("getStatus", () => {
  let repo;
  before(() => { repo = makeTempRepo(); });
  after(() => { removeTempDir(repo); });

  it("returns empty string for a clean working tree", () => {
    assert.equal(getStatus(repo), "");
  });

  it("shows untracked files", () => {
    fs.writeFileSync(path.join(repo, "new.txt"), "hello\n");
    const status = getStatus(repo);
    assert.ok(status.includes("new.txt"), `Expected 'new.txt' in status: ${status}`);
    assert.ok(status.includes("??"), `Expected '??' marker in status: ${status}`);
    // Cleanup
    fs.unlinkSync(path.join(repo, "new.txt"));
  });

  it("shows modified files", () => {
    fs.writeFileSync(path.join(repo, "README.md"), "# changed\n");
    const status = getStatus(repo);
    assert.ok(status.includes("README.md"), `Expected 'README.md' in status: ${status}`);
    assert.ok(status.includes("M"), `Expected 'M' marker in status: ${status}`);
    // Restore
    execFileSync("git", ["checkout", "--", "README.md"], { cwd: repo });
  });
});

// ---------------------------------------------------------------------------
// getDiffContext
// ---------------------------------------------------------------------------
describe("getDiffContext", () => {
  let repo;
  before(() => { repo = makeTempRepo(); });
  after(() => { removeTempDir(repo); });

  it("returns empty stat and diff when working tree is clean", () => {
    const { stat, diff } = getDiffContext(repo);
    assert.equal(stat, "");
    assert.equal(diff, "");
  });

  it("detects staged changes (no base)", () => {
    fs.writeFileSync(path.join(repo, "staged.txt"), "staged content\n");
    execFileSync("git", ["add", "staged.txt"], { cwd: repo });

    const { stat, diff } = getDiffContext(repo);
    assert.ok(stat.includes("1 file changed"), `Expected stat to mention file changed: ${stat}`);
    assert.ok(diff.includes("staged content"), `Expected diff to contain file content: ${diff}`);

    // Cleanup
    execFileSync("git", ["reset", "HEAD", "staged.txt"], { cwd: repo });
    fs.unlinkSync(path.join(repo, "staged.txt"));
  });

  it("detects unstaged changes (no base)", () => {
    fs.writeFileSync(path.join(repo, "README.md"), "# modified\n");

    const { stat, diff } = getDiffContext(repo);
    assert.ok(stat.includes("1 file changed"), `Expected stat to mention changes: ${stat}`);
    assert.ok(diff.includes("modified"), `Expected diff to contain modification: ${diff}`);

    // Restore
    execFileSync("git", ["checkout", "--", "README.md"], { cwd: repo });
  });

  it("detects changes with a base ref", () => {
    // Create a feature branch with a new commit
    execFileSync("git", ["checkout", "-b", "feature-diff"], { cwd: repo });
    fs.writeFileSync(path.join(repo, "feature.txt"), "feature work\n");
    execFileSync("git", ["add", "feature.txt"], { cwd: repo });
    execFileSync("git", ["commit", "-m", "add feature"], { cwd: repo });

    const { stat, diff } = getDiffContext(repo, "main");
    assert.ok(stat.includes("1 file changed"), `Expected stat for branch diff: ${stat}`);
    assert.ok(diff.includes("feature work"), `Expected diff to contain branch changes: ${diff}`);

    // Switch back
    execFileSync("git", ["checkout", "main"], { cwd: repo });
  });
});

// ---------------------------------------------------------------------------
// estimateReviewSize
// ---------------------------------------------------------------------------
describe("estimateReviewSize", () => {
  let repo;
  before(() => { repo = makeTempRepo(); });
  after(() => { removeTempDir(repo); });

  it("returns 'tiny' when there are no changes", () => {
    assert.equal(estimateReviewSize(repo), "tiny");
  });

  it("returns 'tiny' for a very small change (<=2 files, <=50 lines)", () => {
    fs.writeFileSync(path.join(repo, "small.txt"), "one line\n");
    execFileSync("git", ["add", "small.txt"], { cwd: repo });

    assert.equal(estimateReviewSize(repo), "tiny");

    execFileSync("git", ["reset", "HEAD", "small.txt"], { cwd: repo });
    fs.unlinkSync(path.join(repo, "small.txt"));
  });

  it("returns 'small' for a moderate change (<=5 files, <=200 lines)", () => {
    // Create a branch so we can use base ref
    execFileSync("git", ["checkout", "-b", "size-small"], { cwd: repo });

    // 3 files, ~60 lines each = ~180 lines total
    for (let f = 0; f < 3; f++) {
      const lines = Array.from({ length: 60 }, (_, i) => `line ${i}`).join("\n") + "\n";
      fs.writeFileSync(path.join(repo, `file${f}.txt`), lines);
    }
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "small change"], { cwd: repo });

    assert.equal(estimateReviewSize(repo, "main"), "small");

    execFileSync("git", ["checkout", "main"], { cwd: repo });
  });

  it("returns 'medium' for a larger change (<=15 files, <=1000 lines)", () => {
    execFileSync("git", ["checkout", "-b", "size-medium"], { cwd: repo });

    // 8 files, ~100 lines each = ~800 lines total
    for (let f = 0; f < 8; f++) {
      const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`).join("\n") + "\n";
      fs.writeFileSync(path.join(repo, `med${f}.txt`), lines);
    }
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "medium change"], { cwd: repo });

    assert.equal(estimateReviewSize(repo, "main"), "medium");

    execFileSync("git", ["checkout", "main"], { cwd: repo });
  });

  it("returns 'large' for a big change (>15 files or >1000 lines)", () => {
    execFileSync("git", ["checkout", "-b", "size-large"], { cwd: repo });

    // 20 files, ~80 lines each = ~1600 lines total
    for (let f = 0; f < 20; f++) {
      const lines = Array.from({ length: 80 }, (_, i) => `line ${i}`).join("\n") + "\n";
      fs.writeFileSync(path.join(repo, `big${f}.txt`), lines);
    }
    execFileSync("git", ["add", "."], { cwd: repo });
    execFileSync("git", ["commit", "-m", "large change"], { cwd: repo });

    assert.equal(estimateReviewSize(repo, "main"), "large");

    execFileSync("git", ["checkout", "main"], { cwd: repo });
  });
});
