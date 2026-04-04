---
description: Run a challenge review that questions design choices, architecture tradeoffs, and assumptions
argument-hint: '[--wait|--background] [--base <ref>] [--model <model>] [--effort <level>] [focus area]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run an adversarial Copilot review — this isn't a stricter bug hunt, it's a design challenge.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is review-only.
- Do not fix issues, apply patches, or suggest that you are about to make changes.
- Your only job is to run the adversarial review and return the output verbatim to the user.

Execution mode rules:
- If the raw arguments include `--wait`, run in foreground.
- If the raw arguments include `--background`, run in background immediately.
- Otherwise, recommend background and use `AskUserQuestion` exactly once with two options:
  - `Wait for results` (recommended)
  - `Run in background`

Foreground flow:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" adversarial-review $ARGUMENTS
```
- Return the command stdout verbatim, exactly as-is.
- Do not paraphrase, summarize, or add commentary.
- Do not fix any issues mentioned in the review output.

Background flow:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" adversarial-review $ARGUMENTS`,
  description: "Copilot adversarial review",
  run_in_background: true
})
```
- Tell the user: "Adversarial review started in the background. Check `/copilot:status` for progress."
