# Optional AIGent stdio wrappers

The Quality, Style and Workflow `stdio-entrypoint.cjs` files are optional
adapters. They do not replace the existing default entrypoints, change
plugin manifests or advertised actions, register plugins, or enable a service.
The existing module APIs and READMEs keep their separate contracts.

Each wrapper accepts one UTF-8 JSON request on stdin and emits one JSON
line. Valid input is processed at EOF. The input limit is 16 KiB, measured
in bytes; oversized input returns `INPUT_TOO_LARGE` instead of accepting a
prefix. This limit also applies to `runStdinText`.

| Wrapper | Optional actions | Scope |
|---|---|---|
| Quality | `HealthCheck`, `BuildRetryPlan`, `InspectImage` | Retry plans use a supplied synthetic report. Image inspection is the existing rule-based header check, with no external vision call. |
| Style | `HealthCheck`, `RecommendParams`, `PrepareDataset` | Parameter and dataset plans only; write/training requests are denied. |
| Workflow | `HealthCheck`, `ListTemplates`, `ExecuteWorkflow` | In-memory templates and simulated execution without injected dependencies. |

Quality `InspectImage` requires an explicit non-empty image path and
`AIGENT_QUALITY_ALLOWED_IMAGE_ROOT`. Style `PrepareDataset` requires an
explicit `dataset_path` and `AIGENT_STYLE_ALLOWED_DATASET_ROOT`; it cannot
fall back to the legacy configured dataset root. Allowed roots must be
directories. Resolved image/dataset paths must stay inside the corresponding
root, including when a path uses a symlink. These are caller-supplied scope
checks, not authorization to inspect arbitrary data. Use isolated, approved
synthetic inputs and keep operating-system read permissions in place.

`HealthCheck` reports module/adapter capability information; it does not
prove service readiness or authorize external effects. The wrappers import
legacy modules whose environment-based settings remain unchanged. The
Workflow module only drops an unused `uuid` import, so its optional adapter
does not need that unreferenced dependency. No workflow-template filesystem
scan, real generation, provider call or training is performed by these
optional actions.

Run the exact regressions with Node.js 22:

```sh
node --test tests/aigent-quality-compat.test.cjs tests/aigent-style-compat.test.cjs tests/aigent-workflow-compat.test.cjs tests/aigent-wrapper-boundary.test.cjs
```

The original 28 tests remain unchanged. The additional 37 cases cover actual
stdin entrypoints, byte/chunk/EOF boundaries, explicit path grants, canonical path handoff, symlink
escapes and granted synthetic positive paths. They create temporary fixtures
and Node child processes. They do not validate real assets, registration,
provider integration, production deployment or the entire repository suite.
