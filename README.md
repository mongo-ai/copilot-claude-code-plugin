# Copilot Plugin for Claude Code

Use GitHub Copilot models from inside Claude Code — cross-model code reviews, multi-model council reviews, and task delegation.

This plugin lets Claude Code users tap into Copilot's model lineup (GPT-5.4, GPT-5.3-Codex, Claude Opus 4.6, etc.) without leaving their workflow. The headline feature is **council reviews**: the same diff reviewed by multiple models in parallel, with Claude synthesizing the results.

## What You Get

| Command | What it does |
|---|---|
| `/copilot:review` | Code review using any Copilot model (default GPT-5.4) |
| `/copilot:adversarial-review` | Challenge review — questions design, architecture, and assumptions |
| `/copilot:council` | **Multi-model council review** — parallel reviews from 3 models, synthesized by Claude |
| `/copilot:delegate` | Hand a task to Copilot (bug investigation, fixes, research) |
| `/copilot:status` | Check running and recent jobs |
| `/copilot:result` | Get the output of a completed job |
| `/copilot:cancel` | Cancel an active background job |
| `/copilot:setup` | Check installation, auth, and settings |

## Council Reviews

The unique feature. `/copilot:council` sends your diff to multiple models simultaneously and synthesizes the results:

```
/copilot:council
```

Default models: GPT-5.4, Claude Opus 4.6, GPT-5.3-Codex (configurable).

The synthesis identifies:
- **Agreements** — issues flagged by multiple models (high confidence)
- **Disagreements** — conflicting assessments (needs human judgment)
- **Unique catches** — issues only one model spotted (edge case signals)
- **Overall assessment** — combined verdict on code quality

Custom model selection:
```
/copilot:council --models gpt-5.4,gpt-5.4-mini,gpt-5.3-codex
```

## Adversarial Reviews

`/copilot:adversarial-review` is not a stricter bug hunt — it's a design challenge. Instead of finding implementation defects, it questions whether the approach itself is right:

```
/copilot:adversarial-review
```

Focus on a specific concern:
```
/copilot:adversarial-review is this abstraction worth the complexity?
```

The review covers:
- **Design choices** — right abstraction? right layer?
- **Architecture tradeoffs** — what does this sacrifice? what breaks if requirements change?
- **Assumptions** — what is the code assuming? are those assumptions safe?
- **Missing alternatives** — was a simpler approach considered?
- **Failure modes** — what happens when this fails at 3am?

## Review Gate

Optionally block commits that have critical issues. Enable in `.claude/copilot.local.md`:

```markdown
- review-gate: on
```

When enabled, every `git commit` runs a fast Copilot review first. It only blocks for critical issues:
- Security vulnerabilities (hardcoded secrets, injection, auth bypass)
- Data loss risks (destructive operations without safeguards)
- Obvious production-crashing bugs

Style issues, missing tests, and subjective preferences are always allowed through. The gate uses `gpt-5.4-mini` by default for speed (configurable via `review-gate-model`).

The gate **fails open** — if Copilot is unavailable, times out, or errors, the commit proceeds normally.

## Requirements

- **GitHub Copilot subscription** — usage counts toward your Copilot limits. [Learn more](https://docs.github.com/en/copilot/about-github-copilot/subscription-plans-for-github-copilot).
- **Copilot CLI installed** — via npm, VS Code extension, or manual install.
- **Node.js 18+**

## Install

Add the marketplace and install:

```bash
/plugin marketplace add mongo-ai/copilot-claude-code-plugin
/plugin install copilot
```

Reload plugins:

```bash
/reload-plugins
```

Then check everything is working:

```bash
/copilot:setup
```

If Copilot CLI isn't installed yet:

```bash
npm install -g @github/copilot-cli
```

If Copilot isn't authenticated:

```bash
!copilot login
```

## Usage

### Code Review

Review your working tree changes:
```
/copilot:review
```

Review against a base branch:
```
/copilot:review --base main
```

Use a specific model:
```
/copilot:review --model gpt-5.3-codex
```

Run in the background:
```
/copilot:review --background
/copilot:status
/copilot:result
```

### Task Delegation

Hand off work to Copilot:
```
/copilot:delegate investigate why the auth middleware is returning 403 for valid tokens
```

Use a specific model:
```
/copilot:delegate --model gpt-5.4 refactor the database connection pool to use async initialization
```

### Available Models

Any model available through the Copilot CLI can be used:

| Model | Best for |
|---|---|
| `gpt-5.4` | Complex reasoning, thorough reviews (default for review) |
| `gpt-5.3-codex` | Code-specialized tasks (default for delegate) |
| `claude-opus-4.6` | Nuanced analysis, long context |
| `gpt-5.4-mini` | Quick, low-cost tasks |

## Configuration

Create `.claude/copilot.local.md` in your repo to customize defaults:

```markdown
- default-model: gpt-5.4
- default-effort: high
- council-models: gpt-5.4, claude-opus-4.6, gpt-5.3-codex
- council-effort: high
- copilot-binary: auto
- review-gate: off
- review-gate-model: gpt-5.4-mini
```

| Setting | Default | Description |
|---|---|---|
| `default-model` | `gpt-5.4` | Model for `/copilot:review` |
| `default-effort` | `high` | Reasoning effort level |
| `council-models` | `gpt-5.4, claude-opus-4.6, gpt-5.3-codex` | Models for council review |
| `council-effort` | `high` | Effort level for council reviews |
| `copilot-binary` | `auto` | Path to Copilot CLI binary, or `auto` to detect |
| `review-gate` | `off` | Set to `on` to gate commits on Copilot review |
| `review-gate-model` | `gpt-5.4-mini` | Model for review gate (fast + cheap) |

## How It Works

The plugin spawns the Copilot CLI directly — no SDK dependency, no extra `npm install`. It finds the binary automatically (PATH, VS Code extension paths, or manual config).

For council reviews, all models run in parallel via `Promise.allSettled`. If rate limiting is detected, it falls back to sequential execution with delays.

Background jobs are tracked as JSON files in `.copilot-jobs/` (gitignored) with PID-based lifecycle management.

## Architecture

```
commands/                Slash command definitions (8 commands)
  council.md             Multi-model council review (unique feature)
  adversarial-review.md  Challenge review — design & architecture
  review.md              Single-model code review
  delegate.md            Task delegation
  setup.md               Installation check
  status.md              Job status
  result.md              Job output
  cancel.md              Job cancellation
agents/
  copilot-delegate.md    Subagent for task delegation
hooks/
  hooks.json             SessionStart + review gate hooks
scripts/
  copilot-companion.mjs  Main entry point
  review-gate-hook.mjs   PreToolUse hook for commit gating
  lib/
    copilot.mjs          CLI binary discovery + process spawning
    git.mjs              Diff collection + review size estimation
    state.mjs            Background job tracking (JSON file-based)
    settings.mjs         Configuration reader (.claude/copilot.local.md)
tests/                   83 tests across 4 modules
```

## License

Apache 2.0 — see [LICENSE](LICENSE).

Architecture inspired by [openai/codex-plugin-cc](https://github.com/openai/codex-plugin-cc).
