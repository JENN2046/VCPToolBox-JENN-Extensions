# Jenn external package static no-provider extraction prep

**Status:** Gate 40 static validation contract.
**Scope:** External package documentation and static validation only.

This external package is being prepared as a source package, not activated as
the production runtime.

## JennAIGentOrchestrator

`JennAIGentOrchestrator` is the renamed external parallel candidate for the
planner-only AIGent orchestrator surface.

The declared commands remain:

```text
PlanImagePipeline
PlanRetryPipeline
HealthCheck
```

The current Gate 40 boundary is:

- planner-only
- not provider-backed
- not downstream-backed
- no provider calls
- no downstream plugin calls
- no LocalState writes
- no persistent env/config writes
- no generated outputs/logs/cache/secrets
- static validation only
- no runtime cutover

`PlanImagePipeline` must not call providers or downstream plugins in this prep
gate. `JennAIGentOrchestrator` remains planner-only unless a future explicit
gate changes it.

## Future Candidates

aiImageJennTrialFixtures is a future static data move candidate.

aiImageNativeDelegateBindings is a future static data move candidate.

These static fixture and binding data surfaces are candidates for future
explicit gates, not moved by Gate 40.

## LocalState Boundary

LocalState remains private and is not plugin code.

Gate 40 must not write logs, cache, generated outputs, secrets, receipts, or
operator state. Any future LocalState work requires a separate explicit gate.
