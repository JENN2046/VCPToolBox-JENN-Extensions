# PhotoStudioPackages External Package Root

This directory contains reviewed PhotoStudio source/package content only.

Allowed content:

- manifest metadata
- schemas
- sanitized templates
- redacted no-auto-write fixtures
- dry-run adapter source
- package documentation

Disallowed content:

- `plugins/custom/shared/photo_studio_data/*.json`
- project, customer, task, calendar, reminder, content pool, archive, export, delivery, or status records
- media, generated outputs, exports, delivery artifacts, operator notes, cache, logs, DB/vector sidecars
- LocalState/private/operator data
- `.agent_board/**`
- secrets, tokens, auth material, provider config, sheet/API credentials, webhooks, Notion/calendar credentials

Runtime package registration, real data roots, project data reads/writes, external sync, provider calls, and bridge calls remain disabled unless a later reviewed gate explicitly authorizes them.
