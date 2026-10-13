# Local JSO agent adapter

Candidate stdio entry: `Plugin/JennShootingOperations/JsoAgentLocal.js`; candidate manifest: `plugin-manifest.local-agent.json`. Existing live manifest is unchanged.

The isolated runtime supplies `JSO_LOCAL_AGENT_ENDPOINT` (loopback `/api/v2/agent/tools`) and independent `JSO_LOCAL_AGENT_TOKEN`. No Owner credential is read or forwarded by this adapter. ToolBox's native manifest discovery/parser/plugin process was exercised with installed Node 22; JSO's existing SQLite fixture uses Node 24. The transport adapter never retries writes. Use `read_receipt` with the original operationId when the result is uncertain.

Supported envelope is exactly `{command,payload_json}`. `preview_shift` is readonly; `reschedule` requires an exact host-issued delegation at JSO. This package does not install, enable or register itself in a live runtime.
