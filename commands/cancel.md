---
description: Cancel an active Copilot background job
argument-hint: '[job-id]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Cancel a running Copilot job.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" cancel $ARGUMENTS
```

Return the output verbatim.
