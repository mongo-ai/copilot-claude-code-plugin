---
description: Show the output of a completed Copilot job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Show the result of a completed Copilot job.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" result $ARGUMENTS
```

Return the output verbatim.
