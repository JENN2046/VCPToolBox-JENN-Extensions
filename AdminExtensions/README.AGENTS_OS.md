# Jenn Admin Extensions

This directory stores reviewed AdminPanel extension packages for Jenn local validation.

Rules:

- Packages here are not runtime-registered by default.
- `VCP_ADMIN_EXTENSION_DIRS` must remain unset unless a later local gate explicitly enables it.
- Each package must have `admin-extension-manifest.json`, a receipt, checksum evidence, and rollback notes.
- Do not store secrets, real `.env` files, cache, logs, generated output, LocalState/private data, or `.agent_board/**` here.
- AdminPanel production builds and deployments are not validation for this directory.
