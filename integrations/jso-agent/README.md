# JSO Agent paired compatibility, Batch 1

This directory composes the already-existing tests of the four accepted source
revisions from [JSO #83](https://github.com/JENN2046/jenn-shooting-operations/issues/83).
It does not implement Trusted Action, issue authority, change Agent behavior, or
replace the real daily human/model acceptance. `JSO_AGENT_R1` is an immutable
compatibility baseline, **not production authorization**.

Batch 1 belongs to [#86](https://github.com/JENN2046/jenn-shooting-operations/issues/86).
The normative generic Trusted Action document and the three external callers are
explicitly deferred to later batches. Contract version 1 here names the accepted
existing boundary; it does not claim that Batch 2's public contract is delivered.

## Files and gate

- `compatibility.v1.json`: four exact accepted repository/commit identities,
  informational branches, consumed/provided contract versions and acceptance link.
- `profile.v1.json`: versioned required test roster and invariant-to-component map.
  Its content digest is pinned by the manifest. All selected tests are required.
- `validate.mjs`: strict keys, identities, frozen pins, evidence and profile checks.
  Moving refs, unsupported versions, missing/duplicate components and stale profile
  bytes fail. A different accepted composition requires a new reviewed release,
  not editing a pin while keeping `JSO_AGENT_R1`.
- `run.mjs`: the single provisioning/execution/receipt entrypoint. Candidate mode
  substitutes exactly one component; the other three always come from the manifest.
- `reporter.cjs`: structured Node test events. Gate failure includes nonzero exit,
  missing/malformed summaries, empty required files, failures, cancellations, TODOs
  and **any skip**. Every reported skip keeps its file/name/reason; a boolean skip
  is explicitly recorded as having no upstream reason, never treated as a pass.
- `verify-required-skip.mjs`: actual Extensions tests are run with the required
  ToolBox source reference deliberately omitted. The resulting FAIL receipt names
  skipped tests. It explicitly reuses the other three passing baseline results and
  is labelled a negative control, not a successful new paired execution.

## Runtimes and fixtures

Chat and ToolBox tests run on **Node 22.23.1**, matching their existing native CI
lanes. The Extensions backend adapter/stdio tests also use **22.23.1**, the
ToolBox host runtime; its separate chart-editor workflow is unchanged. JSO uses
**24.21.0**, satisfying its declared `>=24.16.0` requirement and existing current CI.
The Chat profile declares `git-crlf`: its existing renderer-hook test searches
for CRLF text. Provisioning uses normal `git config core.autocrlf true` before
checkout, as a Windows Git checkout would. Git objects/HEAD and normalized working
tree cleanliness remain unchanged; no source/test is patched or excluded.
The other checkouts use LF. Both binaries must be supplied; exact versions are checked and recorded. One
runtime is not silently used for every repository.

Cross-repository fixture references are always supplied:
`JSO_TOOLBOX_SOURCE`, `JSO_TOOLBOX_ROOT`, `JSO_CHAT_SOURCE`, `JSO_EXTENSIONS_ROOT`,
`JSO_VCHART_AUTHOR_SOURCE`. The last is a temporary flat directory containing
byte-identical copies of the selected Chat's `chartService.js` and
`ChartControllerService.js`, the layout required by the existing tests. The
source paths/digests are recorded; neither checkout is edited to make it work.

Synthetic tests use temporary storage and local HTTP/WebSocket servers. The
non-loopback plaintext rejection test needs a local non-loopback interface; if
unavailable, its skip fails the gate. No model provider, daily workstation,
production server, credentials or live business fixture is used. Test children
receive a fresh HOME/TMPDIR and an allowlisted environment, not inherited secrets,
proxy settings, `NODE_OPTIONS` or deployment configuration. The checked-in tests
are trusted test code, not an OS sandbox for adversarial code.

Provisioning fetches exact public GitHub commits, locked npm test dependencies,
and JSO's own locked dependencies with lifecycle scripts disabled. The isolated
CJS dependency lock contains the Express/WS versions from the accepted
ToolBox lockfile and jsdom from the accepted Chat lockfile; no Electron/Rust build is required. Dependency/runtime download
is CI setup, not a live network dependency of the test scenarios. Test logs and
receipts must not be used to store production credentials.

## Run

Commit the harness changes first: the harness and all four test source checkouts
must have exact HEADs and clean tracked/untracked source state. Results must live
outside those checkouts. Dependency directories ignored by Git are allowed.

```sh
node integrations/jso-agent/validate.mjs
node --test integrations/jso-agent/ci.test.mjs

node integrations/jso-agent/run.mjs \
  --mode accepted \
  --workspace /tmp/aic-frozen-sources \
  --out /tmp/aic-frozen-result \
  --node22 /absolute/node-22.23.1/bin/node \
  --node24 /absolute/node-24.21.0/bin/node

node integrations/jso-agent/run.mjs \
  --mode candidate \
  --candidate-component extensions \
  --candidate-repository JENN2046/VCPToolBox-JENN-Extensions \
  --candidate-sha EXACT_40_HEX_HEAD \
  --workspace /tmp/aic-candidate-sources \
  --out /tmp/aic-candidate-result \
  --node22 /absolute/node-22.23.1/bin/node \
  --node24 /absolute/node-24.21.0/bin/node
```

A provision workspace must be new; existing directories are never overwritten.
For already prepared isolated checkouts, replace `--workspace` with
`--roots-file roots.json --deps /absolute/isolated-deps/node_modules`. `roots.json`
must map exactly `extensions`, `vcpchat`, `vcptoolbox`, `jso` to clean checkout roots;
Chat must use the declared Git CRLF checkout mode, and JSO's own
`npm ci --ignore-scripts` must already have run. No live runtime trees. Existing JSO fixture code uses URL.pathname for its
node_modules symlink: use an ASCII source path without spaces (as in the examples
and GitHub runners). This prerequisite is checked; the JSO fixture is not patched.

`paired-result.v1.json` records release/candidate/harness identity, every actual
source SHA, contracts/profile versions, per-component Node version, pass/fail/
skip/TODO/cancel counts and explicit skipped tests. Errors produce FAIL receipts,
including incomplete execution. Raw event streams and stdout/stderr sit beside it.
A provision/setup failure is not a skipped success.

## CI bootstrap and future callers

`jso-agent-candidate.yml` calls the reusable `jso-agent-paired.yml` from the same
workflow commit, for both the frozen baseline and the PR's **head SHA**, not the
synthetic PR merge SHA. The harness is checked out at that exact candidate head;
it is deliberately distinct from the accepted Extensions *test source* in the
frozen run. The candidate receipt records both identities.

Permissions are `contents: read`, checkout credentials are not persisted, and no
repository-dispatch or cross-repository write token is used. Action dependencies
are immutable commit pins.

After an explicitly authorized Extensions merge, Batch 2/3 callers must use
`JENN2046/VCPToolBox-JENN-Extensions/.github/workflows/jso-agent-paired.yml@<exact merge SHA>`
and pass that **same immutable SHA** as `harness_sha`. The workflow rejects a
moving `harness_sha` before checkout. Never use `@main`. Inputs `mode`, candidate
component/repository/SHA are validated by the canonical runner. This bootstrap
contract avoids inventing a self-pin before a merge exists. No external caller,
merge, deployment, runtime change or production action is delivered in Batch 1.
