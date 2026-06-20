# Jenn External Agent Root

Status: SKELETON_ONLY_NO_AGENT_CONTENT

This directory is reserved for reviewed additive Jenn Agent source files.

Rules:

- Do not place LocalState, `.agent_board/**`, secrets, env files, cache, logs, outputs, image data, DB files, vector stores, or operator-private data here.
- Do not place override files here. Exact-id overrides belong in `AgentOverrides/`.
- Do not treat this skeleton as runtime activation. `VCP_AGENT_DIRS` must remain unset unless a separate runtime implementation and validation gate approves it.
- Copy-first requires source path scan, target path scan, checksum, receipt, and rollback evidence before any Agent file is added.

Current state:

```text
Agent files copied: no
Runtime loader changed: no
VCP_AGENT_DIRS activated: no
```
