# Jenn External Agent Overrides Root

Status: SKELETON_ONLY_NO_OVERRIDE_CONTENT

This directory is reserved for reviewed exact-id Jenn Agent override files.

Rules:

- Override files must name the exact source Agent id, target Agent id, source commit, target commit, checksum, and rollback receipt.
- Broad overrides, wildcard ids, implicit duplicate replacement, LocalState roots, `.agent_board/**`, secrets, env files, cache, logs, outputs, image data, DB files, vector stores, and operator-private data are blocked.
- Do not treat this skeleton as runtime activation. `VCP_AGENT_OVERRIDE_DIRS` must remain unset unless a separate runtime implementation and validation gate approves it.

Current state:

```text
Override files copied: no
Runtime loader changed: no
VCP_AGENT_OVERRIDE_DIRS activated: no
```
