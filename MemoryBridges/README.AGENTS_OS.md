# MemoryBridges External Package Root

This directory contains reviewed Codex/Memory bridge package content only.

Allowed content:

- manifest metadata
- schemas
- redacted no-live-write fixtures
- dry-run adapter source
- package documentation

Disallowed content:

- real dailynote Codex memory content
- process or knowledge memory records
- memory logs, vector stores, DB sidecars, cache, outputs, or `rag_params.json`
- LocalState/private/operator data
- `.agent_board/**`
- secrets, tokens, OAuth material, cookies, or auth headers

Runtime bridge registration and live memory writes remain disabled unless a later reviewed gate explicitly authorizes them.
