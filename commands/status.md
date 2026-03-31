---
description: Show running and recent Copilot jobs
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Show Copilot job status.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" status $ARGUMENTS
```

Return the output verbatim.
