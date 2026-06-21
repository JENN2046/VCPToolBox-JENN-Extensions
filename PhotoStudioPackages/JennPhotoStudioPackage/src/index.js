'use strict';

const { buildDryRunSummary } = require('../templates/noAutoWriteTemplates');

const PACKAGE_ID = 'jenn.photo-studio.package';

function validateNoAutoWriteDryRun(request = {}) {
  const autoWriteRequested = request.allowProjectDataRead === true
    || request.allowProjectDataWrite === true
    || request.allowExternalWrite === true
    || request.mode === 'live-write';

  return {
    ok: !autoWriteRequested,
    mode: 'no-auto-write',
    packageId: PACKAGE_ID,
    decision: autoWriteRequested ? 'blocked-auto-write' : 'dry-run-only',
    summary: buildDryRunSummary(request),
    projectDataReads: 0,
    projectDataWrites: 0,
    externalWrites: 0,
    providerCalls: 0,
    bridgeCalls: 0,
    localStateReads: 0,
    reason: autoWriteRequested
      ? 'Project data reads/writes and external writes are outside this package gate.'
      : 'Dry-run fixture accepted without side effects.'
  };
}

module.exports = {
  validateNoAutoWriteDryRun
};
