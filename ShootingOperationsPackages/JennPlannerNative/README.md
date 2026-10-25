# Native JSO calendar client

This opt-in client packages the native calendar already verified in the development Chat runtime. It creates only `jso-calendar-isolated`; the existing generic `JsoChartEditor` remains a separate entry point. It requires the authenticated JSO bridge and VCPChat's existing ChartService and native conversation input port. The host determines the business identity, obtains previews, binds confirmation to a native window input event, saves once, and recovers uncertain writes by the original operation ID.

`artifact/` contains the exact installed calendar's reviewable template, CSS and JavaScript snapshot. `artifact.json` pins their SHA-256 hashes; `assets.cjs` rejects mismatches. These are versioned source files, not a promise that they are regenerated from the latest JSO webpage. The source snapshot uses 15-minute drag increments and same-date moves; it does not add a five-minute mode.

## Stage a new plugin directory

```sh
node ShootingOperationsPackages/JennPlannerNative/stage-client.cjs /absolute/new/plugin-directory
```

The destination must not already exist. Staging validates the artifact, copies the shared editor and calendar wrapper, and writes no credentials or application configuration. Install the staged directory with the host's normal direct-plugin loader. Configure these values locally:

- `JSO_CHART_BRIDGE_URL`: the existing authenticated `/api/plugins/JsoChartBridge` endpoint; HTTPS or an explicitly approved loopback endpoint.
- `JSO_CHART_TRANSPORT_TOKEN_ENV`: the name of the existing transport credential environment variable.
- `JSO_CHART_APPLICATION_AUTHORIZATION_ENV`: the name of the existing Owner authorization environment variable.

The JSO management snapshot must supply business date, write admission, resource resolution/allocation state and execution-history flags. Owner binding, business date and write admission changes refresh the chart even when business revisions are unchanged, and invalidate old previews. Older revisions under the same Owner cannot replace newer displayed facts. Native successful receipts must match the operation, Owner and preview digest; a subsequent stale read cannot move displayed facts below the acknowledged revision floor.

The journal is private and lives under the actual Electron `app.getPath('userData')` as `JSOCalendarEditor/pending.json`. It is independent of the generic editor journal. Retain uncertain operation IDs; do not clear them to force a new save. The calendar adds no token, Agent grant, external notification, execution event or business-database write path of its own.

## Verification

Run the native tests and generic editor compatibility tests against a pinned Chat checkout:

```sh
JSO_CHART_TEST_CHAT_ROOT=/absolute/verified/VCPChat \
NODE_PATH=/absolute/test-dependencies/node_modules \
node --test ShootingOperationsPackages/JennPlannerNative/*.test.cjs ShootingOperationsPackages/JsoChartEditor/*.test.cjs
```

Development actual-use acceptance covered native drag +15 minutes, preview, confirmation, authoritative receipt/readback, a drag back to the original time and a second confirmed receipt. A historical unclosed test was cancelled through the separately authenticated JSO business cancellation API after explicit Owner authorization; the calendar's unknown-occupancy rule was not relaxed.
