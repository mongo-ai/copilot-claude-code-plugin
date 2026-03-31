---
description: Delegate a task to GitHub Copilot (default gpt-5.3-codex)
argument-hint: '[--wait|--background] [--model <model>] [--effort <level>] <task prompt>'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Delegate a task to GitHub Copilot CLI.

Raw slash-command arguments:
`$ARGUMENTS`

Use this when the user wants Copilot to:
- Investigate a bug
- Try a fix approach
- Research a problem
- Get a different model's perspective on a task

Default model: `gpt-5.3-codex` (code-specialized). User can override with `--model gpt-5.4`.

Execution mode rules:
- If `--background` is in arguments, run in background immediately.
- If `--wait` is in arguments, run in foreground.
- Otherwise, recommend background for tasks that sound time-consuming.

Foreground flow:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" delegate $ARGUMENTS
```
- Return the output verbatim.

Background flow:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" delegate $ARGUMENTS`,
  description: "Copilot task delegation",
  run_in_background: true
})
```
- Tell the user: "Task delegated to Copilot. Check `/copilot:status` for progress."
