# Local JSO agent adapter

Candidate stdio entry: `Plugin/JennShootingOperations/JsoAgentLocal.js`; candidate manifest: `plugin-manifest.local-agent.json`. Existing live manifest is unchanged.

The isolated runtime supplies `JSO_LOCAL_AGENT_ENDPOINT` (loopback `/api/v2/agent/tools`) and independent `JSO_LOCAL_AGENT_TOKEN`. No Owner credential is read or forwarded by this adapter. ToolBox's native manifest discovery/parser/plugin process was exercised with installed Node 22; JSO's existing SQLite fixture uses Node 24. The transport adapter never retries writes. Use `read_receipt` with the original operationId when the result is uncertain.

The internal JSO API/transport envelope remains exactly `{command,payload_json}`.
At the configured VCP entry only, `read_state` may omit `payload_json`; it defaults
to the JSON string `"{}"`. The existing configured resource allowlist supplies
`resourceScope`. An explicit JSON string with `resourceScope` may narrow that
scope, never expand it. Explicit invalid payloads (including an object instead
of a string, null, undefined or an empty string) still fail closed. Other commands
retain their required `payload_json`; this default does not apply to previews,
receipts, writes or native conversation actions.

Optional VCP `maid` / `valet` signatures are nonempty strings of at most 160
characters, without control characters or line separators. If both are supplied,
their trimmed values must agree. They are discarded at the configured adapter
boundary, not forwarded into the JSO API payload or authorization header. They
are untrusted trace metadata, not an Owner, principal, human confirmation or grant.
Unknown outer fields remain invalid; `role`, `approved`, `token`, `nativeAction`
and other authority fields cannot become accepted parameters through this rule.

Minimal VCP call:

```text
<<<[TOOL_REQUEST]>>>
tool_name:「始」JennShootingOperations「末」,
command:「始」read_state「末」
<<<[END_TOOL_REQUEST]>>>
```

Explicit payload and optional signature:

```text
<<<[TOOL_REQUEST]>>>
maid:「始」示例助手「末」,
tool_name:「始」JennShootingOperations「末」,
command:「始」read_state「末」,
payload_json:「始」{}「末」
<<<[END_TOOL_REQUEST]>>>
```

The VCP parser removes `tool_name` and supplies string argument values; do not
include `tool_name` in the plugin's JSON stdin envelope. `read_state` has no date
argument. Filter the authorized returned state for display instead of inventing
unsupported request fields. The candidate manifest documents the full calls.

`preview_shift` is readonly; model/stdin writes remain denied even under the
native policy or with a forged signature. `reschedule` still requires the separate
trusted conversation path and exact host-issued delegation at JSO. Credentials,
resource scope, write guards and that path are unchanged. This package does not
install, enable or register itself in a live runtime.


Configured entry: `config.cjs` applies resource scope, minute limit and fail-closed model/stdin policy. See `../JsoConversation/README.md` for the moved conversation code and the explicitly inactive generic host interface. Owner credentials are not part of this adapter configuration.

Regression command (Node 24, isolated source checkout only):

```sh
JSO_TOOLBOX_SOURCE=/path/to/checked-out/VCPToolBox node --test ShootingOperationsPackages/JsoAgentAdapter/config.test.cjs ShootingOperationsPackages/JsoAgentAdapter/test.cjs ShootingOperationsPackages/JsoConversation/*.test.cjs
```

The host source supplies the real VCP parser and authority module for synthetic
examples and cross-process safety tests; without it those host-dependent tests
are skipped, not evidence of full validation. For the existing chart integration
test, also set `JSO_VCHART_AUTHOR_SOURCE` to an isolated public-source fixture
directory containing `chartService.js` and `ChartControllerService.js`. No live
settings, credentials, provider, service or business database is needed.
