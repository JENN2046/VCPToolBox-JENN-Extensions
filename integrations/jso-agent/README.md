# JSO Agent paired compatibility, Batch 1

## R2A release-candidate validation

[Extensions #28](https://github.com/JENN2046/VCPToolBox-JENN-Extensions/issues/28)
adds an independent `JSO_AGENT_R2` **candidate**, not an accepted release.
`compatibility.v1.json` remains byte-identical accepted `JSO_AGENT_R1`.
The four existing thin callers and reusable `jso-agent-paired.yml` are unchanged.
No release/tag, merge, deployment, business write, runtime upgrade or #83 fixture
operation is part of R2A. R2B promotion and R2C repinning are separate work.

`compatibility.r2.candidate.json` resolves exactly this proposed composition:

| Component | Proposed SHA | Informational branch |
|---|---|---|
| Extensions | `54b0bfb4d94bc9f3a53516cd4082fb7c4c6d351c` | `main` |
| VCPChat | `900fdda5e24347d802b738924d8456a42c01477f` | `NuobaoVCPchat` |
| VCPToolBox | `b0552cd3e109a8cfe38ac5ee292cc026891d7442` | `master` |
| JSO | `bfaf4dfe1c6558beb0ff9113990946aa85a257a3` | `main` |

Its `acceptance.result` is explicitly `JSO_AGENT_R2_CANDIDATE_NOT_ACCEPTED`.
The linked #83 receipt is historical **runtime** evidence, not a claim of R2
compatibility acceptance. The proposal's issue is #28. Contracts remain
Trusted Action v1 / JSO Agent API v1, runtime acceptance R5, profile
`jso-agent-paired` version 1, digest
`d1e6e5e16f83216053b6131ccc2d1dd7996ea019edd734ffde226fa7856e38b6`.

`validateManifest` and the default/canonical filename continue to admit only the
exact R1 release/evidence/pins. `validateReleaseCandidate` admits only the exact
R2 proposal above, with exact repositories, branches, contracts and profile.
`loadManifest` selects that validator only for the explicit
`compatibility.r2.candidate.json` filename. Putting R2 data under the canonical
filename fails. There is no generic “any 40-hex release pin” permission. R2
planning rejects per-component substitution: this gate must run the entire new
composition. Updating a profile and its declared digest together cannot admit
new selection: all three release validators require the reviewed immutable digest.

### Immutable R2 promotion bridge (capability only)

R2A also freezes a distinct `validatePromotion` / `--mode promotion` validator.
It requires the **same exact four R2 pins**, branches, contracts v1, R5 and
unchanged profile digest, plus precisely:

```json
{
  "issue": "https://github.com/JENN2046/VCPToolBox-JENN-Extensions/issues/28",
  "receipt": "https://github.com/JENN2046/VCPToolBox-JENN-Extensions/issues/28#issuecomment-6436790468",
  "result": "JSO_AGENT_R2_COMPATIBILITY_ACCEPTED"
}
```

That fixed anchor is currently **pending**, not accepted. R2A neither changes
it nor publishes an accepted R2 manifest. After authorized R2A merge, the owner
must independently verify its immutable post-merge candidate receipt and update
the reserved anchor before starting R2B. The validator checks the frozen evidence
identity; its structural PASS is not a substitute for that owner acceptance.

Validation modes cannot cross-admit evidence:

| Mode | Release and evidence |
|---|---|
| `r1` (canonical/default) | exact R1 pins and #83 R1 acceptance only |
| `candidate` | exact R2 pins and `JSO_AGENT_R2_CANDIDATE_NOT_ACCEPTED` only |
| `promotion` | exact R2 pins and the fixed #28 `JSO_AGENT_R2_COMPATIBILITY_ACCEPTED` anchor only |

Explicit promotion validation reads the future candidate's canonical filename
without relaxing the default canonical R1 validator:

```sh
node IMMUTABLE_R2A/integrations/jso-agent/validate.mjs --mode promotion \
  --manifest R2B_CANDIDATE/integrations/jso-agent/compatibility.v1.json
```

The new **reusable-only** `jso-agent-promotion.yml` is intended to be called at
the exact future **R2A merge SHA**, with `candidate_sha` set to the exact future
R2B PR head. It does not accept caller-supplied validator code or validator SHA.
Before checkout, inline workflow code reads the public Actions run's
`referenced_workflows`, requires its own `jso-agent-promotion.yml@<40-hex SHA>`
identity and derives the validator checkout SHA from that immutable reference.
Moving refs, missing/ambiguous/mismatched references, foreign callers, a candidate
equal to the validator and API failures all fail closed. No token is sent to
that public read endpoint. The caller must deliberately pin this workflow to
the reviewed R2A merge commit; passing a candidate SHA never selects the validator.

It checks out the immutable validator and the exact R2B candidate separately.
The candidate sparse checkout contains **only canonical manifest/profile data**;
none of its validator, workflow or other code is executed. `prepare-promotion.mjs`
uses the immutable validator to verify the clean repository/HEAD, exact promotion
evidence/pins and unchanged profile bytes, then copies those JSON bytes to a new
external staging directory. Its reserved `compatibility.r2.promotion.json` name
selects promotion validation when the unchanged paired engine loads it. R1 and
candidate evidence still fail on that path. There is no runner modification,
new test selection, substitution or replacement receipt producer.

The workflow compares its engine/profile/deps/skip helper against a separate
stable `77e89fa...` checkout, runs the existing conformance tests, and executes
the **full four-pin** R2 composition. Its standard receipt must independently
verify **512/512, zero failures/skips/TODO/cancellations/gate failures**, exact
contracts/profile/sources and `productionAuthorization=false`. The receipt's
harness SHA is the actual immutable R2A validator SHA. A separate data-context
artifact records the future R2B candidate SHA and raw manifest/profile digests;
the unchanged standard receipt is not relabelled as a substituted candidate.
All permissions are read-only, credentials are not persisted, no secrets are
forwarded and there is no dispatch/write/deployment action.

Adversarial tests exercise all nine manifest/mode combinations, promotion pin
and evidence drift, the real data-staging path with a deliberately unusable
candidate validator, and the workflow's actual pre-checkout authority code
under missing/moving/mismatched/self-certifying references. No R2B branch,
accepted manifest, promotion run or canonical advancement is performed in R2A.

`verify-engine-identity.mjs` checks fixed SHA256 identities from stable harness
`77e89fae03202a3d861d6f3e78c8a06666df304d`. It covers `run.mjs`, `reporter.cjs`,
`profile.v1.json`, both dependency manifests, the real required-skip negative-control
helper, the original reusable workflow and canonical R1 manifest. CI also checks
the bytes against a **separate checkout of that exact stable commit** before
testing. The execution/receipt producer and skip semantics are not forked.

The dedicated `jso-agent-release-candidate.yml` workflow:

1. Calls the immutable R1 reusable workflow at `77e89fa...` in accepted mode,
   including its real required-skip negative control.
2. Checks out the release validator at the actual PR head (or push/manual SHA)
   and independently compares protected files to the stable checkout.
3. Runs both manifest validators, existing CI tests and new release-candidate
   adversarial tests.
4. Runs the **unchanged engine** with `--manifest compatibility.r2.candidate.json`
   and `--mode accepted`, so **all four sources** come from the candidate manifest.
   Here accepted mode is the engine's existing *no-substitution* mechanism; it
   does not promote this file, grant production authority or assert that R2 is
   the canonical accepted release. The unmodified receipt accordingly retains
   `candidate:null` and component `source:accepted` labels. `releaseId` and the
   explicit manifest/workflow context identify this R2 candidate.
5. Downloads the R1 control's artifact within GitHub Actions and verifies both
   actual standard `paired-result.v1.json` outputs. R1 must be 490/490, R2 must
   be **512/512** (38 Extensions + 209 Chat + 191 ToolBox + 74 JSO), with no
   failure, skip, TODO, cancellation, substitution or gate failure. Contract,
   profile, component identities, actual runtimes and required file selections
   must match. `productionAuthorization` must be false.
6. Prints the parsed receipts and their raw-file SHA256 digests for independent
   review, and uploads the unchanged R2 standard receipt plus synthetic evidence.

The R1 receipt's harness SHA is the immutable stable `77e89fa...`. The R2 receipt's
harness SHA identifies the **release-validator commit**, distinct from its
Extensions test-source pin `54b0bfb...`; its protected engine bytes are identical
to `77e89fa...`. Do not relabel these different identities as interchangeable.
Both Node versions remain exactly 22.23.1/24.21.0. Permissions are read-only,
checkout credentials are not persisted, no secrets are forwarded and no
repository-dispatch token is introduced.

Local release-validation checks (no production access):

```sh
node integrations/jso-agent/verify-engine-identity.mjs
node integrations/jso-agent/validate.mjs
node integrations/jso-agent/validate.mjs integrations/jso-agent/compatibility.r2.candidate.json
node --test integrations/jso-agent/ci.test.mjs integrations/jso-agent/release-candidate.test.mjs
```

The new tests reject drift of every R1/R2 source, branch, contract, evidence and
profile; candidate-only R2 data in the canonical filename; changed/symlinked
engine files; and mutated/incomplete receipt counts/sources/runtimes/selections.
A real Node required-skip event is passed through the unchanged producer and
must yield a FAIL R2 receipt. The original tests/negative-control semantics remain.

Before R2A handoff, verify exact-head R1 control PASS, R2 512 PASS / 0 required
skips / empty gateFailures, byte guard PASS and clean review. Stop at
`AIC_R1_R2A_RELEASE_CANDIDATE_READY_FOR_REVIEW`, without merging. Any post-merge
candidate receipt and later promotion require the separately authorized next
steps in #28; this proposal alone does not advance canonical acceptance.

## Original R1 baseline

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
