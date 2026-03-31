---
description: Check Copilot CLI installation, authentication, and plugin settings
argument-hint: '[--json]'
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

Check whether the GitHub Copilot CLI is installed and authenticated.

Run:
```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/copilot-companion.mjs" setup $ARGUMENTS
```

Return the output verbatim. If Copilot is not ready, tell the user what to do next.
