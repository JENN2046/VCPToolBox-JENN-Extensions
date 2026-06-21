# Jenn AI Image Adapters

This directory stores reviewed AI Image adapter packages for Jenn local validation.

Rules:

- Packages here are not runtime-registered by default.
- `VCP_AI_IMAGE_ADAPTER_DIRS` must remain unset unless a later local gate explicitly enables it.
- Provider calls and real image generation are forbidden unless a separate provider gate authorizes them.
- Bindings must be redacted source/package metadata only; do not store credentials, tokens, `.env`, cookies, auth headers, output images, LocalState/private data, or `.agent_board/**`.
- Each package must have a manifest, no-provider fixtures, checksum evidence, receipt, and rollback notes.
