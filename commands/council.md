---
description: Run a multi-model council review — parallel reviews from GPT-5.4, Claude Opus 4.6, and GPT-5.3-Codex with synthesis
argument-hint: '[--wait|--background] [--base <ref>] [--models <m1,m2,m3>] [--effort <level>]'
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run a council review: the same code review prompt sent to multiple models in parallel, then synthesize.

Raw slash-command arguments:
`$ARGUMENTS`

Core constraint:
- This command is review-only.
- Do not fix issues or apply patches.
- Your job is to run the council review, then synthesize the results.

Default council models (configurable in `.claude/copilot.local.md`):
- gpt-5.4 (OpenAI)
- claude-opus-4.6 (Anthropic)
- gpt-5.3-codex (OpenAI, code-specialized)

Execution mode rules:
- Council reviews typically take 2-5 minutes. **Always recommend background** unless user explicitly passes `--wait`.
- If `--background` is in arguments, run in background immediately.
- If `--wait` is in arguments, run in foreground.
- Otherwise, use `AskUserQuestion` recommending background.

Foreground flow:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" council $ARGUMENTS
```

The companion script returns each model's raw review output plus a synthesis instruction.

**After receiving the output, YOU must perform the synthesis:**

1. **Agreements** — Issues flagged by 2+ models. These are high-confidence findings.
2. **Disagreements** — Where models give conflicting assessments. Flag these for the user's judgment.
3. **Unique catches** — Issues only one model found. These are edge case signals worth considering.
4. **Overall assessment** — Your combined verdict on the code quality, informed by all perspectives.

Present the synthesis in a clear, structured format. Quote specific findings from each model.

Background flow:
```typescript
Bash({
  command: `node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" council $ARGUMENTS`,
  description: "Copilot council review",
  run_in_background: true
})
```
- Tell the user: "Council review started in the background with [models]. Check `/copilot:status` for progress."
