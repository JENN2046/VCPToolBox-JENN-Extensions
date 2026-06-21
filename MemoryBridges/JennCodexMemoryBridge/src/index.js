'use strict';

const BRIDGE_ID = 'jenn.codex-memory.bridge';

function validateNoLiveWriteDryRun(request = {}) {
  const liveWriteRequested = request.allowLiveWrite === true || request.mode === 'live-write';

  return {
    ok: !liveWriteRequested,
    mode: 'no-live-write',
    bridgeId: BRIDGE_ID,
    decision: liveWriteRequested ? 'blocked-live-write' : 'dry-run-only',
    bridgeWrites: 0,
    privateMemoryReads: 0,
    localStateReads: 0,
    externalWrites: 0,
    providerCalls: 0,
    reason: liveWriteRequested
      ? 'Live memory writes are outside this package gate.'
      : 'Dry-run fixture accepted without side effects.'
  };
}

module.exports = {
  validateNoLiveWriteDryRun
};
