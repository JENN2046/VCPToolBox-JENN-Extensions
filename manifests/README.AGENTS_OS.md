# Jenn External Runtime Manifests

This directory stores reviewed checksum manifests for copied source packages.

Rules:

- Generate `MANIFEST.sha256` only after the S7 denylist and S9 paths-only secret-risk scan pass.
- Keep LocalState, `.agent_board/**`, secrets, env files, cache, logs, outputs, DB/vector stores, and receipts out of plugin source manifests.
- Treat checksum evidence as package integrity evidence only. It is not runtime registration proof.
- Runtime registration still requires an exact `VCP_EXTERNAL_PLUGIN_ALLOWLIST` entry.
