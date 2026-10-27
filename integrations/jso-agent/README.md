# JSO Agent paired compatibility — canonical R2 promotion

R2B promotes `compatibility.v1.json` to the exact accepted `JSO_AGENT_R2`
composition. Authority is the independently verified immutable R2A receipt at
[the fixed #28 acceptance anchor](https://github.com/JENN2046/VCPToolBox-JENN-Extensions/issues/28#issuecomment-6436790468),
not validation code supplied by this candidate. R2A validator/workflow authority
is `7d071c5eb00822052ee0e11dc64c1b8e440fb715`; its raw post-merge R2 receipt
SHA256 is `e154ead24bb201eadc7a9b2a17cb5098e02eba6b8e2f8f4eda209685d0550896`.

| Component | Accepted source SHA | Informational branch |
|---|---|---|
| Extensions | `54b0bfb4d94bc9f3a53516cd4082fb7c4c6d351c` | `main` |
| VCPChat | `900fdda5e24347d802b738924d8456a42c01477f` | `NuobaoVCPchat` |
| VCPToolBox | `b0552cd3e109a8cfe38ac5ee292cc026891d7442` | `master` |
| JSO | `bfaf4dfe1c6558beb0ff9113990946aa85a257a3` | `main` |

The canonical acceptance fields are exactly:

```json
{
  "issue": "https://github.com/JENN2046/VCPToolBox-JENN-Extensions/issues/28",
  "receipt": "https://github.com/JENN2046/VCPToolBox-JENN-Extensions/issues/28#issuecomment-6436790468",
  "result": "JSO_AGENT_R2_COMPATIBILITY_ACCEPTED"
}
```

Contracts remain trustedAction v1 / jsoAgentApi v1, runtime acceptance R5,
profile `jso-agent-paired` version 1, digest
`d1e6e5e16f83216053b6131ccc2d1dd7996ea019edd734ffde226fa7856e38b6`.
These runtime component pins are distinct from the R2A validator SHA, the R2B PR
head and the eventual R2B merge SHA. CI-only changes do not repin runtime sources.

## Canonical validation and explicit historical modes

| Entry | Admitted data |
|---|---|
| default / `canonical`, `validateManifest` | only exact accepted R2, including the fixed #28 anchor |
| explicit `r1`, `validateLegacyR1` | only frozen legacy R1 pins and #83 R1 acceptance |
| `candidate`, `validateReleaseCandidate` | only the exact R2 proposal with `JSO_AGENT_R2_CANDIDATE_NOT_ACCEPTED` |
| `promotion`, `validatePromotion` | only exact accepted R2 data required by immutable R2A |

Canonical and promotion deliberately require the **same accepted R2 JSON**: it
is the immutable promotion validator's input and the proposed canonical output.
They are different execution/authority contexts, not different evidence claims.
Neither accepts R1 or candidate-not-accepted evidence. The candidate and legacy
validators reject accepted R2. Tests cover every mode/data combination and reject
changed evidence, repositories, pins, branches, contracts, runtime and profile.
No generic arbitrary-release/40-hex-pin acceptance is added.

`compatibility.r1.legacy.json` preserves the old canonical R1 bytes for explicit
historical/control use; it is never selected by default. The separate
`compatibility.r2.candidate.json` remains an unaccepted proposal. The unchanged
engine selects proposal/promotion validation through their reserved staging
filenames; all ordinary/default loads now require accepted R2.

Accepted R2 reuses the existing one-component candidate planning behavior for
future normal paired callers; its other three pins remain exactly canonical.
The unaccepted R2 proposal still requires the full four-pin composition.
This readiness does not repin any of the four repository thin callers in R2B.

## Immutable promotion gate

The former R2A `jso-agent-release-candidate.yml` automatic gate is now a thin
PR/push/manual caller of:

`JENN2046/VCPToolBox-JENN-Extensions/.github/workflows/jso-agent-promotion.yml@7d071c5eb00822052ee0e11dc64c1b8e440fb715`

It passes only `candidate_sha: github.event.pull_request.head.sha || github.sha`.
It executes no candidate-owned release validator as certification. The immutable
workflow derives its own validator SHA from actual GitHub `referenced_workflows`,
checks out immutable R2A and the exact R2B manifest/profile separately, and never
executes the candidate's validator or workflow code. Its unchanged paired engine
runs the complete frozen four-pin composition and requires **512/512 PASS**
(Extensions 38 + Chat 209 + ToolBox 191 + JSO 74), zero required skips, zero gate
failures and `productionAuthorization=false`.

The standard `paired-result.v1.json` records the immutable R2A **harness SHA**
and exact four runtime source pins. Its existing `candidate:null` and source
labels are unchanged. The separately emitted `promotion-context.json` binds the
**R2B exact candidate SHA** to the canonical manifest/profile byte digests.
Both must be inspected together; the runtime Extensions pin is not the R2B head.
The workflow logs actual receipts plus raw-file SHA256 and retains them with
that context in `jso-agent-r2-promotion-validation`.

The original `jso-agent-paired.yml`, reusable promotion implementation and four
repository thin callers are unchanged. The old R1/candidate gates remain
available at their immutable commits for historical verification. Permissions
remain read-only, no secrets are forwarded and no repository dispatch/write
credential is introduced.

## Engine identity and local verification

`run.mjs`, `reporter.cjs`, `profile.v1.json`, both dependency files,
`verify-required-skip.mjs` and the original paired reusable workflow retain
exact stable `77e89fae03202a3d861d6f3e78c8a06666df304d` hashes. Engine/profile/test
selection and required-skip failure semantics do not change. The local byte guard
keeps those hashes and independently pins the intentionally promoted R2 manifest
and unchanged legacy R1 copy. It no longer compares canonical R2 metadata to R1
metadata. The **immutable R2A** workflow still uses its own unchanged R1-era guard
inside its immutable validator checkout, exactly as designed.

```sh
node integrations/jso-agent/validate.mjs
node integrations/jso-agent/validate.mjs --mode r1 --manifest integrations/jso-agent/compatibility.r1.legacy.json
node integrations/jso-agent/verify-engine-identity.mjs
node --test integrations/jso-agent/ci.test.mjs integrations/jso-agent/release-candidate.test.mjs
```

R2B stops at `AIC_R1_R2B_PROMOTION_READY_FOR_REVIEW`: no runtime/business/adapter
changes, deployment, restart, tag/release, merge or R2C caller repinning.
Only after separately authorized R2B merge and post-merge validation may R2C begin.

## Historical R1 / Batch 1 notes

The following records the original R1 design and bootstrap at `77e89fa...`.
Its deferred-batch status and R1 pin references are historical; current canonical
identity and immutable promotion authority are defined above.


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
must have exact HEADs, the expected public GitHub origin, and clean
tracked/untracked source state. Results must live
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
