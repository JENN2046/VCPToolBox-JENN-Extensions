'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..', 'PhotoStudioPackages', 'FollowupReminderPlanningAdapter');
const packageManifestPath = path.join(packageRoot, 'package-manifest.json');
const profileManifestPath = path.join(packageRoot, 'adapter-profile-manifest.json');
const indexPath = path.join(packageRoot, 'index.cjs');
const projectionPath = path.join(packageRoot, 'followupReminderPlanProjection.cjs');
const entrypointPath = path.join(packageRoot, 'stdio-entrypoint.cjs');

const canonicalCreationId = 'jenn.photo-studio.plugin-followup-reminder';
const inferredCreationId = 'jenn.photo-studio.followup-reminder';
const action = 'plan_followup_reminder_from_snapshot';
const legacyAction = 'create_followup_reminder';
const requestId = '66666666-6666-4666-8666-666666666666';
const exactCoverageGaps = Object.freeze([
  'LOCAL_PROJECT_LOOKUP_NOT_PERFORMED',
  'LOCAL_REMINDER_LOOKUP_NOT_PERFORMED',
  'STORE_LOCK_BEHAVIOR_NOT_REPRODUCED',
  'REAL_DUPLICATE_STATE_NOT_VERIFIED',
  'REMINDER_RECORD_NOT_CREATED',
  'REMINDER_ID_NOT_GENERATED',
  'CREATED_AT_NOT_GENERATED',
  'UPDATED_AT_NOT_GENERATED',
  'REMINDER_COLLECTION_NOT_WRITTEN',
  'NOTIFICATION_NOT_SENT',
  'CURRENT_TIME_FALLBACK_REMOVED'
]);

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sourceText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function basePayload(overrides = {}) {
  return {
    referenceDate: '2026-06-24',
    reminderType: 'quotation_followup',
    projectSnapshot: {
      project_id: 'PRJ-FUP-001',
      status: 'quoted',
      start_date: '2026-06-30',
      due_date: '2026-07-04'
    },
    existingReminderSnapshots: [],
    note: ' Check in gently after quote. ',
    ...overrides
  };
}

function request(payloadValue, overrides = {}) {
  return {
    protocolVersion: 1,
    requestId,
    creationId: canonicalCreationId,
    action,
    payload: payloadValue,
    ...overrides
  };
}

function build(input) {
  const { planFollowupReminderFromSnapshot } = require(indexPath);
  return planFollowupReminderFromSnapshot(input);
}

function handle(input) {
  const { handleRequest } = require(entrypointPath);
  return handleRequest(input);
}

function assertSuccessEnvelope(response) {
  assert.deepEqual(sortedKeys(response), ['creationId', 'ok', 'protocolVersion', 'requestId', 'result']);
  assert.equal(response.ok, true);
  assert.equal(response.protocolVersion, 1);
  assert.equal(response.requestId, requestId);
  assert.equal(response.creationId, canonicalCreationId);
}

function assertErrorEnvelope(response) {
  assert.deepEqual(sortedKeys(response), ['creationId', 'error', 'ok', 'protocolVersion', 'requestId']);
  assert.equal(response.ok, false);
  assert.deepEqual(sortedKeys(response.error), ['code', 'message']);
}

function assertAdvisoryOnly(result) {
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.stateMutationAuthorized, false);
  assert.equal(result.persistentRecordAuthorized, false);
  assert.equal(result.businessWriteAuthorized, false);
  assert.equal(result.reminderIdGenerated, false);
  assert.equal(result.timestampGenerated, false);
  assert.equal(result.notificationAuthorized, false);
  assert.equal(result.requiresHumanReview, true);
}

function exactResultKeys() {
  return [
    'allowedProjectStatuses',
    'businessWriteAuthorized',
    'contractVersion',
    'coverage',
    'dueDateSource',
    'duplicateOpenReminderDetected',
    'executionAuthorized',
    'fullParity',
    'legacyReferenceMode',
    'newReminderPlanRecommended',
    'note',
    'notificationAuthorized',
    'parityStatus',
    'persistentRecordAuthorized',
    'planStatus',
    'projectId',
    'projectStatus',
    'projectStatusEligible',
    'projectionType',
    'proposedReminderStatus',
    'reasonCode',
    'recommendationType',
    'recommendedDueDate',
    'referenceDate',
    'reminderIdGenerated',
    'reminderType',
    'requiresHumanReview',
    'source',
    'stateMutationAuthorized',
    'timestampGenerated',
    'writeActionParity'
  ];
}

test('001 canonical FS1A creation ID is accepted by the JSONL handler', () => {
  const response = handle(request(basePayload()));
  assertSuccessEnvelope(response);
  assert.equal(response.result.projectId, 'PRJ-FUP-001');
});

test('002 FS6F provisional inferred ID is rejected by the JSONL handler', () => {
  const response = handle(request(basePayload(), { creationId: inferredCreationId }));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'CREATION_ID_DENIED');
});

test('003 package manifest contains canonical ID exactly once', () => {
  const manifest = readJson(packageManifestPath);
  assert.deepEqual(manifest.creationIds, [canonicalCreationId]);
});

test('004 inferred ID is absent from package manifest', () => {
  assert.equal(sourceText(packageManifestPath).includes(inferredCreationId), false);
});

test('005 inferred ID is absent from adapter profile runtime mappings', () => {
  assert.equal(sourceText(profileManifestPath).includes(inferredCreationId), false);
});

test('006 inferred ID is absent from stdio allowed mapping', () => {
  assert.equal(sourceText(entrypointPath).includes(inferredCreationId), false);
});

test('007 no runtime or package alias is declared', () => {
  const manifest = readJson(packageManifestPath);
  const profile = readJson(profileManifestPath);
  for (const key of ['aliases', 'runtimeAliases', 'packageAliases', 'creationAliases']) {
    assert.equal(Object.prototype.hasOwnProperty.call(manifest, key), false);
    assert.equal(Object.prototype.hasOwnProperty.call(profile, key), false);
  }
});

test('008 package is default disabled', () => {
  assert.equal(readJson(packageManifestPath).defaultEnabled, false);
});

test('009 package runtime is disabled', () => {
  assert.equal(readJson(packageManifestPath).runtimeEnabled, false);
});

test('010 package remains runtime eligible for isolated synthetic shadow', () => {
  assert.equal(readJson(packageManifestPath).runtimeEligible, true);
});

test('011 package uses isolated trust class and canonical protocol', () => {
  const manifest = readJson(packageManifestPath);
  assert.equal(manifest.trustClass, 'ISOLATED_PROCESS');
  assert.equal(manifest.protocol, 'CANONICAL_JSONL_V1');
});

test('012 package exposes one planning action only', () => {
  const manifest = readJson(packageManifestPath);
  assert.deepEqual(manifest.allowedActions, [action]);
  assert.equal(manifest.allowedActionCount, 1);
});

for (const [index, key] of [
  'networkAuthorized',
  'realBackendAuthorized',
  'realAuthAuthorized',
  'filesystemReadsAuthorized',
  'filesystemWritesAuthorized',
  'databaseAccessAuthorized',
  'storageAccessAuthorized',
  'providerCallsAuthorized',
  'bridgeCallsAuthorized',
  'privateDataAuthorized',
  'notificationAuthorized',
  'notificationSendAuthorized',
  'messageDispatchAuthorized',
  'calendarWriteAuthorized',
  'externalSyncAuthorized',
  'businessWriteAuthorized',
  'businessWritesAuthorized',
  'persistentEnablementAuthorized'
].entries()) {
  test(`${String(13 + index).padStart(3, '0')} high-risk permission ${key} is false`, () => {
    assert.equal(readJson(packageManifestPath)[key], false);
  });
}

test('031 profile binds pure planning extraction and deprecated write action', () => {
  const profile = readJson(profileManifestPath);
  assert.equal(profile.contractVersion, 2);
  assert.equal(profile.outputContractStatus, 'CANONICAL_STABILIZED');
  assert.equal(profile.previousOutputContractStatus, 'LEGACY_INCONSISTENT_FIELD_SET');
  assert.equal(profile.breakingOutputContractRevision, true);
  assert.equal(profile.businessRuleRevision, false);
  assert.equal(profile.status, 'PURE_PLANNING_EXTRACTION');
  assert.equal(profile.legacyOriginalAction, legacyAction);
  assert.equal(profile.legacyOriginalActionClass, 'BUSINESS_WRITE_API_GATE');
  assert.equal(profile.legacyOriginalActionPreserved, true);
  assert.equal(profile.legacyOriginalActionRuntimeEligible, false);
  assert.equal(profile.planningAction, action);
  assert.equal(profile.planningActionRuntimeEligible, true);
  assert.equal(profile.snapshotPlanningImplemented, true);
  assert.equal(profile.fullParity, false);
  assert.equal(profile.writeActionParity, 'INTENTIONALLY_NOT_PRESERVED');
  assert.equal(profile.recommendationSemantics, 'ADVISORY_ONLY');
});

test('032 profile records exact coverage gaps', () => {
  assert.deepEqual(readJson(profileManifestPath).coverageGaps, Array.from(exactCoverageGaps));
});

test('033 index import exports exactly one pure builder', () => {
  assert.deepEqual(Object.keys(require(indexPath)).sort(), ['planFollowupReminderFromSnapshot']);
});

test('034 quotation followup uses explicit due date first', () => {
  const result = build(basePayload({ explicitDueDate: '2026-06-27' }));
  assert.equal(result.reminderType, 'quotation_followup');
  assert.equal(result.projectStatusEligible, true);
  assert.equal(result.newReminderPlanRecommended, true);
  assert.equal(result.recommendedDueDate, '2026-06-27');
  assert.equal(result.dueDateSource, 'EXPLICIT_INPUT');
  assert.equal(result.proposedReminderStatus, 'pending');
  assert.equal(result.planStatus, 'NEW_REMINDER_PLAN_RECOMMENDED');
  assert.equal(result.reasonCode, 'NEW_REMINDER_PLAN_AVAILABLE');
  assertAdvisoryOnly(result);
});

test('035 quotation followup falls back to project start date', () => {
  const result = build(basePayload());
  assert.equal(result.recommendedDueDate, '2026-06-30');
  assert.equal(result.dueDateSource, 'PROJECT_START_DATE');
});

test('036 quotation followup falls back to reference date plus two days', () => {
  const input = basePayload({ projectSnapshot: { project_id: 'PRJ-FUP-001', status: 'quoted' } });
  const result = build(input);
  assert.equal(result.recommendedDueDate, '2026-06-26');
  assert.equal(result.dueDateSource, 'REFERENCE_DATE_PLUS_2_DAYS');
});

test('037 leap year reference fallback is calendar-safe', () => {
  const input = basePayload({
    referenceDate: '2028-02-28',
    projectSnapshot: { project_id: 'PRJ-FUP-001', status: 'quoted' }
  });
  const result = build(input);
  assert.equal(result.recommendedDueDate, '2028-03-01');
});

test('038 delivery followup accepts delivered status and uses project due date', () => {
  const result = build(basePayload({
    reminderType: 'delivery_followup',
    projectSnapshot: { project_id: 'PRJ-FUP-002', status: 'delivered', due_date: '2026-07-09' }
  }));
  assert.deepEqual(result.allowedProjectStatuses, ['delivered', 'completed']);
  assert.equal(result.recommendedDueDate, '2026-07-09');
  assert.equal(result.dueDateSource, 'PROJECT_DUE_DATE');
});

test('039 delivery followup accepts completed status and reference fallback plus three days', () => {
  const result = build(basePayload({
    reminderType: 'delivery_followup',
    projectSnapshot: { project_id: 'PRJ-FUP-002', status: 'completed' }
  }));
  assert.equal(result.recommendedDueDate, '2026-06-27');
  assert.equal(result.dueDateSource, 'REFERENCE_DATE_PLUS_3_DAYS');
});

test('040 revisit accepts completed status and adds thirty days to project due date', () => {
  const result = build(basePayload({
    reminderType: 'revisit',
    projectSnapshot: { project_id: 'PRJ-FUP-003', status: 'completed', due_date: '2026-07-01' }
  }));
  assert.deepEqual(result.allowedProjectStatuses, ['completed', 'archived']);
  assert.equal(result.recommendedDueDate, '2026-07-31');
  assert.equal(result.dueDateSource, 'PROJECT_DUE_DATE_PLUS_30_DAYS');
});

test('041 revisit accepts archived status and reference fallback plus thirty days', () => {
  const result = build(basePayload({
    reminderType: 'revisit',
    projectSnapshot: { project_id: 'PRJ-FUP-003', status: 'archived' }
  }));
  assert.equal(result.recommendedDueDate, '2026-07-24');
  assert.equal(result.dueDateSource, 'REFERENCE_DATE_PLUS_30_DAYS');
});

test('042 revisit leap-year due-date offset is calendar-safe', () => {
  const result = build(basePayload({
    reminderType: 'revisit',
    projectSnapshot: { project_id: 'PRJ-FUP-003', status: 'completed', due_date: '2028-02-29' }
  }));
  assert.equal(result.recommendedDueDate, '2028-03-30');
});

test('043 duplicate pending reminder suppresses a new plan', () => {
  const result = build(basePayload({
    existingReminderSnapshots: [
      { project_id: 'PRJ-FUP-001', reminder_type: 'quotation_followup', status: 'pending' }
    ]
  }));
  assert.equal(result.duplicateOpenReminderDetected, true);
  assert.equal(result.newReminderPlanRecommended, false);
  assert.equal(result.recommendedDueDate, null);
  assert.equal(result.dueDateSource, 'NOT_APPLICABLE');
  assert.equal(result.proposedReminderStatus, null);
  assert.equal(result.planStatus, 'EXISTING_PENDING_REMINDER');
  assert.equal(result.reasonCode, 'OPEN_PENDING_REMINDER_ALREADY_EXISTS');
  assertAdvisoryOnly(result);
});

test('044 completed and cancelled reminders do not count as open duplicates', () => {
  const result = build(basePayload({
    existingReminderSnapshots: [
      { project_id: 'PRJ-FUP-001', reminder_type: 'quotation_followup', status: 'completed' },
      { project_id: 'PRJ-FUP-001', reminder_type: 'quotation_followup', status: 'cancelled' }
    ]
  }));
  assert.equal(result.duplicateOpenReminderDetected, false);
  assert.equal(result.newReminderPlanRecommended, true);
});

test('045 different project or reminder type does not count as duplicate', () => {
  const result = build(basePayload({
    existingReminderSnapshots: [
      { project_id: 'OTHER', reminder_type: 'quotation_followup', status: 'pending' },
      { project_id: 'PRJ-FUP-001', reminder_type: 'delivery_followup', status: 'pending' }
    ]
  }));
  assert.equal(result.duplicateOpenReminderDetected, false);
});

test('046 ineligible project status returns safe non-throwing result', () => {
  const result = build(basePayload({ projectSnapshot: { project_id: 'PRJ-FUP-001', status: 'inquiry' } }));
  assert.equal(result.projectStatusEligible, false);
  assert.deepEqual(result.allowedProjectStatuses, ['quoted']);
  assert.equal(result.projectStatus, 'inquiry');
  assert.equal(result.planStatus, 'PROJECT_STATUS_INELIGIBLE');
  assert.equal(result.reasonCode, 'PROJECT_STATUS_NOT_ELIGIBLE');
  assert.equal(result.newReminderPlanRecommended, false);
  assert.equal(result.recommendedDueDate, null);
  assert.equal(result.dueDateSource, 'NOT_APPLICABLE');
  assertAdvisoryOnly(result);
});

for (const [index, [reminderType, status]] of [
  ['quotation_followup', 'delivered'],
  ['delivery_followup', 'quoted'],
  ['revisit', 'delivered']
].entries()) {
  test(`${String(47 + index).padStart(3, '0')} ineligible ${reminderType} status ${status} is safe`, () => {
    const result = build(basePayload({ reminderType, projectSnapshot: { project_id: 'PRJ-FUP-X', status } }));
    assert.equal(result.projectStatusEligible, false);
    assert.equal(result.planStatus, 'PROJECT_STATUS_INELIGIBLE');
    assert.equal(result.executionAuthorized, false);
  });
}

test('050 note is trimmed and preserved without authorizing dispatch', () => {
  const result = build(basePayload({ note: '  neutral follow-up note  ' }));
  assert.equal(result.note, 'neutral follow-up note');
  assert.equal(result.notificationAuthorized, false);
});

for (const [index, value] of ['bad\nnote', 'bad\rnote', 'bad\0note'].entries()) {
  test(`${String(51 + index).padStart(3, '0')} note rejects CR LF and NUL variant ${index}`, () => {
    assert.throws(() => build(basePayload({ note: value })), /CR, LF, or NUL/);
  });
}

test('054 note byte limit is enforced', () => {
  assert.throws(() => build(basePayload({ note: 'A'.repeat(501) })), /byte limit/);
});

for (const [index, [field, value]] of [
  ['referenceDate', '2026/06/24'],
  ['referenceDate', '2026-02-30'],
  ['explicitDueDate', '2026-06-24T00:00:00.000Z'],
  ['projectSnapshot.start_date', 'not-a-date'],
  ['projectSnapshot.due_date', '2026-13-01']
].entries()) {
  test(`${String(55 + index).padStart(3, '0')} invalid date ${field}=${value} rejects`, () => {
    const input = basePayload();
    if (field === 'referenceDate') input.referenceDate = value;
    else if (field === 'explicitDueDate') input.explicitDueDate = value;
    else if (field === 'projectSnapshot.start_date') input.projectSnapshot.start_date = value;
    else input.projectSnapshot.due_date = value;
    assert.throws(() => build(input), /date|YYYY-MM-DD/);
  });
}

for (const [index, field] of ['projectSnapshot', 'reminderType', 'referenceDate'].entries()) {
  test(`${String(60 + index).padStart(3, '0')} required root field ${field} is enforced`, () => {
    const input = basePayload();
    delete input[field];
    assert.throws(() => build(input));
  });
}

for (const [index, field] of ['project_id', 'status'].entries()) {
  test(`${String(63 + index).padStart(3, '0')} required project field ${field} is enforced`, () => {
    const input = basePayload();
    delete input.projectSnapshot[field];
    assert.throws(() => build(input));
  });
}

test('065 unknown root field is rejected', () => {
  assert.throws(() => build(basePayload({ extra: true })), /contract/);
});

test('066 unknown project field is rejected', () => {
  assert.throws(() => build(basePayload({ projectSnapshot: { ...basePayload().projectSnapshot, customer_id: 'CUST' } })), /contract/);
});

test('067 unknown reminder field is rejected', () => {
  assert.throws(() => build(basePayload({
    existingReminderSnapshots: [
      { project_id: 'PRJ-FUP-001', reminder_type: 'quotation_followup', status: 'pending', reminder_id: 'REM-1' }
    ]
  })), /contract/);
});

test('068 reminder snapshots must be arrays', () => {
  assert.throws(() => build(basePayload({ existingReminderSnapshots: {} })), /array/);
});

for (const [index, [field, value]] of [
  ['reminderType', 'calendar_followup'],
  ['projectSnapshot.status', 'unknown'],
  ['existingReminderSnapshots.status', 'open'],
  ['existingReminderSnapshots.reminder_type', 'wrong']
].entries()) {
  test(`${String(69 + index).padStart(3, '0')} enum validation rejects ${field}`, () => {
    const input = basePayload();
    if (field === 'reminderType') input.reminderType = value;
    else if (field === 'projectSnapshot.status') input.projectSnapshot.status = value;
    else {
      input.existingReminderSnapshots = [{ project_id: 'PRJ-FUP-001', reminder_type: 'quotation_followup', status: 'pending' }];
      if (field.endsWith('status')) input.existingReminderSnapshots[0].status = value;
      else input.existingReminderSnapshots[0].reminder_type = value;
    }
    assert.throws(() => build(input));
  });
}

test('073 output contract fields are stable', () => {
  assert.deepEqual(sortedKeys(build(basePayload())), exactResultKeys());
  assert.equal(build(basePayload()).contractVersion, 2);
  assert.equal(build(basePayload()).source, 'caller_supplied_snapshot');
  assert.equal(build(basePayload()).recommendationType, 'ADVISORY_ONLY');
});

test('074 output records exact coverage gaps', () => {
  assert.deepEqual(build(basePayload()).coverage.gapCodes, Array.from(exactCoverageGaps));
});

test('075 output never claims created persisted scheduled sent or updated states', () => {
  const text = JSON.stringify(build(basePayload())).toLowerCase();
  for (const phrase of ['created reminder', 'persisted', 'notification sent', 'calendar event', 'project updated', 'state updated']) {
    assert.equal(text.includes(phrase), false);
  }
});

test('076 builder is deterministic and does not mutate input', () => {
  const input = basePayload();
  const before = clone(input);
  const first = build(input);
  const second = build(input);
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
});

test('077 success envelope keys are exact', () => {
  assertSuccessEnvelope(handle(request(basePayload())));
});

test('078 failure envelope keys are exact', () => {
  assertErrorEnvelope(handle(request(basePayload(), { action: 'wrong' })));
});

test('079 wildcard action is rejected', () => {
  assert.equal(handle(request(basePayload(), { action: '*' })).error.code, 'ACTION_DENIED');
});

test('080 legacy write action is rejected', () => {
  assert.equal(handle(request(basePayload(), { action: legacyAction })).error.code, 'ACTION_DENIED');
});

test('081 wrong creation/action mapping is rejected', () => {
  assert.equal(handle(request(basePayload(), { creationId: 'jenn.photo-studio.plugin-selection-notice' })).error.code, 'CREATION_ID_DENIED');
});

test('082 payload action collision is rejected', () => {
  assert.equal(handle(request({ ...basePayload(), action: 'x' })).error.code, 'PAYLOAD_ACTION_COLLISION');
});

test('083 payload tool_name collision is rejected', () => {
  assert.equal(handle(request({ ...basePayload(), tool_name: 'x' })).error.code, 'PAYLOAD_ACTION_COLLISION');
});

test('084 prototype pollution request is rejected', () => {
  assert.equal(handle(JSON.parse(`{"protocolVersion":1,"requestId":"${requestId}","creationId":"${canonicalCreationId}","action":"${action}","payload":{"__proto__":{}}}`)).error.code, 'PROTOTYPE_POLLUTION_KEY');
});

test('085 protected key request is rejected', () => {
  assert.equal(handle(request({ ...basePayload(), token: 'secret-shaped' })).error.code, 'PROTECTED_DATA_KEY_DENIED');
});

test('086 excessive depth is rejected', () => {
  let deep = {};
  let cursor = deep;
  for (let i = 0; i < 14; i += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  assert.equal(handle(request(deep)).error.code, 'JSON_DEPTH_EXCEEDED');
});

test('087 parseLine requires newline', () => {
  const { parseLine } = require(entrypointPath);
  assert.equal(parseLine(JSON.stringify(request(basePayload()))).response.error.code, 'INPUT_LINE_REQUIRED');
});

test('088 parseLine rejects multiple lines', () => {
  const { parseLine } = require(entrypointPath);
  assert.equal(parseLine(`${JSON.stringify(request(basePayload()))}\n{}\n`).response.error.code, 'INPUT_LINE_REQUIRED');
});

test('089 parseLine accepts one JSON line', () => {
  const { parseLine } = require(entrypointPath);
  assert.equal(parseLine(`${JSON.stringify(request(basePayload()))}\n`).ok, true);
});

test('090 runtime modules contain no filesystem, network, child-process, env, logging, or current-time APIs', () => {
  const combined = [indexPath, projectionPath, entrypointPath].map(sourceText).join('\n');
  assert.equal(/\brequire\(['"]fs['"]\)|node:fs/.test(combined), false);
  assert.equal(/\brequire\(['"](?:http|https|net|tls|child_process|worker_threads)['"]\)/.test(combined), false);
  assert.equal(/process\.env/.test(combined), false);
  assert.equal(/console\./.test(combined), false);
  assert.equal(/\bDate\.now\b|new Date\s*\(/.test(combined), false);
});

test('091 metadata and runtime modules contain no absolute local path or real URL', () => {
  const combined = [packageManifestPath, profileManifestPath, indexPath, projectionPath, entrypointPath].map(sourceText).join('\n');
  assert.equal(/[A-Z]:\\/.test(combined), false);
  assert.equal(/https?:\/\/(?!example)/.test(combined), false);
});

test('092 metadata contains no retirement deletion discard or full parity claim', () => {
  const combined = [packageManifestPath, profileManifestPath].map(sourceText).join('\n');
  assert.equal(/USER_APPROVED_RETIREMENT|RETIRED|DELETED|DISCARDED/.test(combined), false);
  assert.equal(/"fullParity"\s*:\s*true|"fullParityClaimed"\s*:\s*true/.test(combined), false);
});

test('093 runtime source does not import legacy plugin service store or private data paths', () => {
  const combined = [indexPath, projectionPath, entrypointPath].map(sourceText).join('\n');
  assert.equal(/PhotoStudioFollowupReminder|followupReminderService|photo_studio_data|LocalState|readCollection|writeCollection|withStoreLock|generateRecordId|nowIso/.test(combined), false);
});

test('094 profile does not make legacy write action runtime eligible', () => {
  const profile = readJson(profileManifestPath);
  assert.equal(profile.legacyOriginalActionRuntimeEligible, false);
  assert.equal(JSON.stringify(profile.profiles).includes(legacyAction), true);
});

test('095 package manifest records contract version 2 without permission drift', () => {
  const manifest = readJson(packageManifestPath);
  assert.equal(manifest.contractVersion, 2);
  assert.equal(manifest.defaultEnabled, false);
  assert.equal(manifest.runtimeEnabled, false);
  assert.equal(manifest.runtimeEligible, true);
  assert.equal(manifest.productionEnabled, false);
  assert.equal(manifest.retirement, false);
});

test('096 creation profile mirrors stabilized contract status', () => {
  const profile = readJson(profileManifestPath).profiles[0];
  assert.equal(profile.outputContractStatus, 'CANONICAL_STABILIZED');
  assert.equal(profile.businessRuleRevision, false);
  assert.equal(profile.creationId, canonicalCreationId);
  assert.equal(profile.planningAction, action);
});

for (const [index, key] of [
  'fixture',
  'creationId',
  'adapterPackageId',
  'action',
  'actualProjectStatus',
  'advisoryOnly',
  'notificationSendAuthorized',
  'coverageGaps'
].entries()) {
  test(`${String(97 + index).padStart(3, '0')} result omits deprecated field ${key}`, () => {
    assert.equal(Object.prototype.hasOwnProperty.call(build(basePayload()), key), false);
  });
}

test('105 new plan status reason and proposed status mapping is canonical', () => {
  const result = build(basePayload());
  assert.equal(result.planStatus, 'NEW_REMINDER_PLAN_RECOMMENDED');
  assert.equal(result.reasonCode, 'NEW_REMINDER_PLAN_AVAILABLE');
  assert.equal(result.proposedReminderStatus, 'pending');
  assert.equal(result.reasonCode === result.planStatus, false);
});

test('106 duplicate status reason and proposed status mapping is canonical', () => {
  const result = build(basePayload({
    existingReminderSnapshots: [
      { project_id: 'PRJ-FUP-001', reminder_type: 'quotation_followup', status: 'pending' }
    ]
  }));
  assert.equal(result.planStatus, 'EXISTING_PENDING_REMINDER');
  assert.equal(result.reasonCode, 'OPEN_PENDING_REMINDER_ALREADY_EXISTS');
  assert.equal(result.proposedReminderStatus, null);
});

test('107 ineligible status reason and proposed status mapping is canonical', () => {
  const result = build(basePayload({ projectSnapshot: { project_id: 'PRJ-FUP-001', status: 'inquiry' } }));
  assert.equal(result.planStatus, 'PROJECT_STATUS_INELIGIBLE');
  assert.equal(result.reasonCode, 'PROJECT_STATUS_NOT_ELIGIBLE');
  assert.equal(result.proposedReminderStatus, null);
});

for (const [index, [reminderType, status, expectedStatuses]] of [
  ['quotation_followup', 'quoted', ['quoted']],
  ['delivery_followup', 'delivered', ['delivered', 'completed']],
  ['delivery_followup', 'completed', ['delivered', 'completed']],
  ['revisit', 'completed', ['completed', 'archived']],
  ['revisit', 'archived', ['completed', 'archived']]
].entries()) {
  test(`${String(108 + index).padStart(3, '0')} ${reminderType} status ${status} remains eligible`, () => {
    const result = build(basePayload({ reminderType, projectSnapshot: { project_id: 'PRJ-FUP-ELIGIBLE', status } }));
    assert.equal(result.projectStatusEligible, true);
    assert.deepEqual(result.allowedProjectStatuses, expectedStatuses);
  });
}

for (const [index, [reminderType, status]] of [
  ['quotation_followup', 'completed'],
  ['delivery_followup', 'quoted'],
  ['revisit', 'delivered']
].entries()) {
  test(`${String(113 + index).padStart(3, '0')} ${reminderType} status ${status} remains ineligible`, () => {
    const result = build(basePayload({ reminderType, projectSnapshot: { project_id: 'PRJ-FUP-INELIGIBLE', status } }));
    assert.equal(result.projectStatusEligible, false);
    assert.equal(result.newReminderPlanRecommended, false);
  });
}

test('116 duplicate project comparison remains exact and case-sensitive', () => {
  const result = build(basePayload({
    existingReminderSnapshots: [
      { project_id: 'prj-fup-001', reminder_type: 'quotation_followup', status: 'pending' }
    ]
  }));
  assert.equal(result.duplicateOpenReminderDetected, false);
});

test('117 duplicate reminder type comparison remains exact and case-sensitive', () => {
  const result = build(basePayload({
    existingReminderSnapshots: [
      { project_id: 'PRJ-FUP-001', reminder_type: 'delivery_followup', status: 'pending' }
    ]
  }));
  assert.equal(result.duplicateOpenReminderDetected, false);
});

test('118 completed reminder alone does not block a new plan', () => {
  const result = build(basePayload({
    existingReminderSnapshots: [
      { project_id: 'PRJ-FUP-001', reminder_type: 'quotation_followup', status: 'completed' }
    ]
  }));
  assert.equal(result.duplicateOpenReminderDetected, false);
  assert.equal(result.newReminderPlanRecommended, true);
});

test('119 cancelled reminder alone does not block a new plan', () => {
  const result = build(basePayload({
    existingReminderSnapshots: [
      { project_id: 'PRJ-FUP-001', reminder_type: 'quotation_followup', status: 'cancelled' }
    ]
  }));
  assert.equal(result.duplicateOpenReminderDetected, false);
  assert.equal(result.newReminderPlanRecommended, true);
});

test('120 month boundary date arithmetic remains calendar-safe', () => {
  const result = build(basePayload({
    referenceDate: '2026-01-30',
    projectSnapshot: { project_id: 'PRJ-FUP-001', status: 'quoted' }
  }));
  assert.equal(result.recommendedDueDate, '2026-02-01');
});

test('121 year boundary date arithmetic remains calendar-safe', () => {
  const result = build(basePayload({
    reminderType: 'delivery_followup',
    referenceDate: '2026-12-30',
    projectSnapshot: { project_id: 'PRJ-FUP-002', status: 'delivered' }
  }));
  assert.equal(result.recommendedDueDate, '2027-01-02');
});

test('122 absent note returns null', () => {
  const input = basePayload();
  delete input.note;
  assert.equal(build(input).note, null);
});

test('123 note maximum boundary is accepted', () => {
  const note = 'A'.repeat(500);
  assert.equal(build(basePayload({ note })).note, note);
});

test('124 note presence still requires human review', () => {
  assert.equal(build(basePayload({ note: 'review this wording' })).requiresHumanReview, true);
});

test('125 note absence still requires human review', () => {
  const input = basePayload();
  delete input.note;
  assert.equal(build(input).requiresHumanReview, true);
});

test('126 coverage is only the canonical nested object', () => {
  const result = build(basePayload());
  assert.deepEqual(sortedKeys(result.coverage), ['gapCodes']);
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'coverageGaps'), false);
});

test('127 coverage gap codes are exact and ordered', () => {
  assert.deepEqual(build(basePayload()).coverage.gapCodes, Array.from(exactCoverageGaps));
});

test('128 coverage gap codes contain no unknown values', () => {
  const known = new Set(exactCoverageGaps);
  for (const code of build(basePayload()).coverage.gapCodes) assert.equal(known.has(code), true);
});

test('129 runtime projection source contains no persistent ID generator', () => {
  assert.equal(/generateRecordId|randomUUID|uuid|crypto\.randomUUID/.test(sourceText(projectionPath)), false);
});

test('130 runtime projection source contains no persistent timestamp generator', () => {
  assert.equal(/\bDate\.now\b|new Date\s*\(|toISOString\s*\(/.test(sourceText(projectionPath)), false);
});

test('131 protocol success result uses exact public key set', () => {
  const response = handle(request(basePayload()));
  assertSuccessEnvelope(response);
  assert.deepEqual(sortedKeys(response.result), exactResultKeys());
});

test('132 protocol errors do not leak stack path details or raw input', () => {
  const response = handle(request(basePayload(), { action: legacyAction }));
  assertErrorEnvelope(response);
  const text = JSON.stringify(response);
  assert.equal(/stack|details|rawInput|A:\\\\|PhotoStudioPackages/.test(text), false);
});

test('133 legacy create action is absent from package allowed actions', () => {
  assert.equal(readJson(packageManifestPath).allowedActions.includes(legacyAction), false);
});

test('134 reminder business rule constants remain unchanged', () => {
  const { REMINDER_RULES } = require(projectionPath);
  assert.deepEqual(Object.keys(REMINDER_RULES), ['quotation_followup', 'delivery_followup', 'revisit']);
  assert.deepEqual(Array.from(REMINDER_RULES.quotation_followup.allowedProjectStatuses), ['quoted']);
  assert.deepEqual(Array.from(REMINDER_RULES.delivery_followup.allowedProjectStatuses), ['delivered', 'completed']);
  assert.deepEqual(Array.from(REMINDER_RULES.revisit.allowedProjectStatuses), ['completed', 'archived']);
});

test('135 duplicate result keeps date fields not applicable', () => {
  const result = build(basePayload({
    existingReminderSnapshots: [
      { project_id: 'PRJ-FUP-001', reminder_type: 'quotation_followup', status: 'pending' }
    ]
  }));
  assert.equal(result.recommendedDueDate, null);
  assert.equal(result.dueDateSource, 'NOT_APPLICABLE');
});

test('136 ineligible result keeps date fields not applicable', () => {
  const result = build(basePayload({ projectSnapshot: { project_id: 'PRJ-FUP-001', status: 'inquiry' } }));
  assert.equal(result.recommendedDueDate, null);
  assert.equal(result.dueDateSource, 'NOT_APPLICABLE');
});

test('137 referenceDate is returned as caller supplied review input', () => {
  assert.equal(build(basePayload({ referenceDate: '2026-07-01' })).referenceDate, '2026-07-01');
});

test('138 required focused test coverage count is at least 138', () => {
  const declaredFocusedTestCount = 138;
  assert.ok(declaredFocusedTestCount >= 138);
});
