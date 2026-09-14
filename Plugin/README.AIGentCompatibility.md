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

Quality `InspectImage` selects the first non-empty string from `image_path`
and the legacy `path` alias, without coercing other values, and requires
`AIGENT_QUALITY_ALLOWED_IMAGE_ROOT`. Style `PrepareDataset` requires an
explicit `dataset_path` and `AIGENT_STYLE_ALLOWED_DATASET_ROOT`; it cannot
fall back to the legacy configured dataset root. Allowed roots must be
directories. Resolved image/dataset paths must stay inside the corresponding
root, including when a path uses a symlink. The validated canonical path is
passed to the core, so replacing the original alias after validation does not
redirect the inspection. Quality rejects canonical paths that its core would
change by trimming; Style preserves its existing untrimmed path semantics.
This removes original-alias re-resolution, but does not prevent a same-UID
actor from replacing a canonical file, directory or ancestor after validation.
These are caller-supplied scope checks, not authorization to inspect arbitrary
data. Use isolated, approved synthetic inputs and enforce operating-system
permissions that prevent concurrent mutation of canonical targets and ancestors.

Workflow `ExecuteWorkflow` requires a non-empty string `user_input`, or the
existing `description` alias. It selects the first non-empty string in that
order and trims it. Missing, blank or non-string-only inputs return
`REQUEST_REJECTED` before execution; the wrapper does not invent a prompt.

`HealthCheck` reports module/adapter capability information; it does not
prove service readiness or authorize external effects. The wrappers import
legacy modules whose environment-based settings remain unchanged. The
Workflow module drops an unused `uuid` import and accepts an instance logger
(default: `console`). Its optional wrapper supplies a fixed silent logger
without replacing the host process console methods. No workflow-template filesystem
scan, real generation, provider call or training is performed by these
optional actions.

Run the exact regressions with Node.js 22:

```sh
node --test tests/aigent-quality-compat.test.cjs tests/aigent-style-compat.test.cjs tests/aigent-workflow-compat.test.cjs tests/aigent-wrapper-boundary.test.cjs tests/aigent-result-consistency.test.cjs tests/aigent-input-path-boundary.test.cjs tests/aigent-root-grant-boundary.test.cjs
```

The command runs 144 tests. The original 28 tests remain unchanged. The additional 37 cases cover actual
stdin entrypoints, byte/chunk/EOF boundaries, explicit path grants, canonical path handoff, symlink
escapes and granted synthetic positive paths. They create temporary fixtures
and Node child processes. Eight further regressions cover concurrent logging,
default and injected instance loggers, failure propagation and stdio output.
The concurrent rejection fixture now supplies two explicit prompts so it still
reaches the mocked execution layer; its assertions and test count are unchanged.
Sixteen result-consistency tests cover retry verdicts and execution failures.
Twenty-seven further cases cover required prompts, string aliases, actual
canonical-path handoff, original-alias replacement and core path normalization.
Twenty-eight further cases cover filesystem-root grants: 12 real POSIX fixture
cases and 16 synthetic drive/UNC cases using the actual function with injected
win32 dependencies. The latter do not establish native Windows acceptance.
They do not validate real assets, registration,
provider integration, production deployment or the entire repository suite.
