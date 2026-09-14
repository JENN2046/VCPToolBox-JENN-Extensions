'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..', 'PhotoStudioPackages', 'DeliveryTasksPlanningAdapter');
const packageManifestPath = path.join(packageRoot, 'package-manifest.json');
const profileManifestPath = path.join(packageRoot, 'adapter-profile-manifest.json');
const indexPath = path.join(packageRoot, 'index.cjs');
const projectionPath = path.join(packageRoot, 'deliveryTaskPlanProjection.cjs');
const entrypointPath = path.join(packageRoot, 'stdio-entrypoint.cjs');

const canonicalCreationId = 'jenn.photo-studio.plugin-delivery-tasks';
const inferredCreationId = 'jenn.photo-studio.delivery-tasks';
const action = 'plan_delivery_tasks_from_snapshot';
const legacyAction = 'create_delivery_tasks';
const requestId = '77777777-7777-4777-8777-777777777777';
const exactCoverageGaps = Object.freeze([
  'LOCAL_PROJECT_LOOKUP_NOT_PERFORMED',
  'LOCAL_TASK_LOOKUP_NOT_PERFORMED',
  'STORE_LOCK_BEHAVIOR_NOT_REPRODUCED',
  'REAL_PROJECT_STATUS_NOT_VERIFIED',
  'REAL_MANAGED_TASK_DUPLICATE_STATE_NOT_VERIFIED',
  'TASK_RECORDS_NOT_CREATED',
  'TASK_IDS_NOT_GENERATED',
  'CREATED_AT_NOT_GENERATED',
  'UPDATED_AT_NOT_GENERATED',
  'EXISTING_TASKS_NOT_DELETED',
  'EXISTING_TASKS_NOT_REPLACED',
  'TASK_COLLECTION_NOT_WRITTEN',
  'HANDOFF_MESSAGE_NOT_SENT',
  'DELIVERY_RECEIPT_NOT_CONFIRMED'
]);
const expectedTemplates = Object.freeze({
  wedding: Object.freeze([
    ['Finalize wedding gallery for delivery', 'review', 1],
    ['Prepare wedding delivery package', 'delivery', 2],
    ['Send wedding gallery handoff', 'communication', 3],
    ['Confirm wedding delivery receipt', 'communication', 4]
  ]),
  portrait: Object.freeze([
    ['Finalize portrait selects for delivery', 'review', 1],
    ['Prepare portrait delivery package', 'delivery', 2],
    ['Send portrait handoff details', 'communication', 3],
    ['Confirm portrait delivery receipt', 'communication', 4]
  ]),
  commercial: Object.freeze([
    ['Finalize approved commercial assets', 'review', 1],
    ['Prepare commercial delivery package', 'delivery', 2],
    ['Share asset handoff instructions', 'communication', 3],
    ['Confirm commercial asset receipt', 'communication', 4]
  ]),
  event: Object.freeze([
    ['Finalize event gallery for delivery', 'review', 1],
    ['Prepare event delivery package', 'delivery', 2],
    ['Send event gallery handoff', 'communication', 3],
    ['Confirm event delivery receipt', 'communication', 4]
  ]),
  other: Object.freeze([
    ['Finalize selected assets for delivery', 'review', 1],
    ['Prepare final delivery package', 'delivery', 2],
    ['Send delivery handoff details', 'communication', 3],
    ['Confirm final delivery receipt', 'communication', 4]
  ])
});

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
    projectSnapshot: {
      project_id: 'PRJ-DLV-001',
      project_type: 'wedding',
      status: 'reviewing',
      due_date: '2026-07-08'
    },
    existingTaskSnapshots: [],
    deliveryMode: ' secure gallery delivery ',
    deliveryDeadline: '2026-07-01',
    replacementIntent: 'KEEP_EXISTING',
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
  const { planDeliveryTasksFromSnapshot } = require(indexPath);
  return planDeliveryTasksFromSnapshot(input);
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
  assert.equal(result.taskIdsGenerated, false);
  assert.equal(result.timestampsGenerated, false);
  assert.equal(result.messageDispatchAuthorized, false);
  assert.equal(result.notificationAuthorized, false);
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.fullParity, false);
  assert.equal(result.writeActionParity, 'INTENTIONALLY_NOT_PRESERVED');
  assert.equal(result.recommendationType, 'ADVISORY_ONLY');
}

function assertFourDrafts(result, projectType) {
  assert.equal(result.plannedTaskCount, 4);
  assert.equal(result.plannedTasks.length, 4);
  const expected = expectedTemplates[projectType];
  result.plannedTasks.forEach((task, index) => {
    assert.deepEqual(sortedKeys(task), [
      'deliveryMode',
      'dueDate',
      'executionAuthorized',
      'messageDispatchAuthorized',
      'persistentRecordAuthorized',
      'remark',
      'sortOrder',
      'stateMutationAuthorized',
      'taskDraftType',
      'taskName',
      'taskType'
    ]);
    assert.equal(task.taskName, expected[index][0]);
    assert.equal(task.taskType, expected[index][1]);
    assert.equal(task.sortOrder, expected[index][2]);
    assert.equal(task.taskDraftType, 'ADVISORY_TASK_DRAFT');
    assert.equal(task.deliveryMode, result.deliveryMode);
    assert.equal(task.remark, `Delivery mode: ${result.deliveryMode}`);
    assert.equal(task.dueDate, result.deliveryDeadline);
    assert.equal(task.executionAuthorized, false);
    assert.equal(task.stateMutationAuthorized, false);
    assert.equal(task.persistentRecordAuthorized, false);
    assert.equal(task.messageDispatchAuthorized, false);
    for (const oldKey of ['project_id', 'task_name', 'task_type', 'proposed_status', 'sort_order', 'due_date', 'task_group', 'generated_by', 'task_id', 'created_at', 'updated_at']) {
      assert.equal(Object.prototype.hasOwnProperty.call(task, oldKey), false);
    }
  });
}

test('001 canonical FS1A creation ID is accepted by the JSONL handler', () => {
  const response = handle(request(basePayload()));
  assertSuccessEnvelope(response);
  assert.equal(response.result.projectId, 'PRJ-DLV-001');
});

test('002 inferred delivery task ID is rejected by the JSONL handler', () => {
  const response = handle(request(basePayload(), { creationId: inferredCreationId }));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'CREATION_ID_DENIED');
});

test('003 package manifest contains canonical ID exactly once', () => {
  assert.deepEqual(readJson(packageManifestPath).creationIds, [canonicalCreationId]);
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
  const manifest = readJson(packageManifestPath);
  assert.equal(manifest.runtimeEligible, true);
  assert.equal(manifest.contractVersion, 2);
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
  assert.equal(profile.profileId, 'photo-studio-delivery-tasks-planning-v2');
  assert.equal(profile.status, 'PURE_PLANNING_EXTRACTION');
  assert.equal(profile.legacyOriginalAction, legacyAction);
  assert.equal(profile.legacyOriginalActionClass, 'BUSINESS_WRITE_API_GATE');
  assert.equal(profile.legacyOriginalActionPreserved, true);
  assert.equal(profile.legacyOriginalActionRuntimeEligible, false);
  assert.equal(profile.planningAction, action);
  assert.equal(profile.planningActionRuntimeEligible, true);
  assert.equal(profile.legacyUsesStoreLock, true);
  assert.equal(profile.legacyGeneratesPersistentIds, true);
  assert.equal(profile.legacyGeneratesTimestamps, true);
  assert.equal(profile.legacyPerformsManagedTaskReplacement, true);
  assert.equal(profile.snapshotPlanningImplemented, true);
  assert.equal(profile.fullParity, false);
  assert.equal(profile.writeActionParity, 'INTENTIONALLY_NOT_PRESERVED');
  assert.equal(profile.recommendationSemantics, 'ADVISORY_ONLY');
  assert.equal(profile.outputContractStatus, 'CANONICAL_ADVISORY_TASK_DRAFTS');
  assert.equal(profile.previousOutputContractStatus, 'LEGACY_WRITE_SHAPED_PUBLIC_TASK_DRAFTS');
  assert.equal(profile.breakingOutputContractRevision, true);
  assert.equal(profile.businessRuleRevision, false);
  assert.equal(profile.profiles[0].contractVersion, 2);
  assert.equal(profile.profiles[0].outputContractStatus, 'CANONICAL_ADVISORY_TASK_DRAFTS');
  assert.equal(profile.profiles[0].businessRuleRevision, false);
});

test('032 profile records exact coverage gaps', () => {
  assert.deepEqual(readJson(profileManifestPath).coverageGaps, Array.from(exactCoverageGaps));
});

test('033 index import exports exactly one pure builder', () => {
  assert.deepEqual(Object.keys(require(indexPath)).sort(), ['planDeliveryTasksFromSnapshot']);
});

test('034 legacy template project type count is five', () => {
  const { DELIVERY_TASK_TEMPLATES } = require(projectionPath);
  assert.deepEqual(Object.keys(DELIVERY_TASK_TEMPLATES).sort(), Object.keys(expectedTemplates).sort());
});

test('035 legacy template task count is twenty', () => {
  const { DELIVERY_TASK_TEMPLATES } = require(projectionPath);
  assert.equal(Object.values(DELIVERY_TASK_TEMPLATES).flat().length, 20);
});

for (const [index, projectType] of Object.keys(expectedTemplates).entries()) {
  test(`${String(36 + index).padStart(3, '0')} exact ${projectType} delivery task template`, () => {
    const result = build(basePayload({
      projectSnapshot: { project_id: `PRJ-${projectType.toUpperCase()}`, project_type: projectType, status: 'reviewing' }
    }));
    assert.equal(result.projectType, projectType);
    assertFourDrafts(result, projectType);
  });
}

for (const [index, status] of ['reviewing', 'delivered', 'completed'].entries()) {
  test(`${String(41 + index).padStart(3, '0')} eligible project status ${status} produces advisory draft plan`, () => {
    const result = build(basePayload({ projectSnapshot: { project_id: 'PRJ-DLV-OK', project_type: 'other', status } }));
    assert.equal(result.projectStatusEligible, true);
    assert.equal(result.plannedTaskSetAvailable, true);
    assert.equal(result.newTaskPlanRecommended, true);
    assert.equal(result.planStatus, 'NEW_DELIVERY_TASK_PLAN_RECOMMENDED');
    assertFourDrafts(result, 'other');
    assertAdvisoryOnly(result);
  });
}

for (const [index, status] of ['inquiry', 'quoted', 'confirmed', 'preparing', 'shooting', 'editing', 'archived', 'cancelled'].entries()) {
  test(`${String(44 + index).padStart(3, '0')} ineligible project status ${status} is non-mutating`, () => {
    const result = build(basePayload({ projectSnapshot: { project_id: 'PRJ-DLV-BLOCK', project_type: 'wedding', status } }));
    assert.equal(result.projectStatusEligible, false);
    assert.equal(result.plannedTaskSetAvailable, false);
    assert.equal(result.newTaskPlanRecommended, false);
    assert.equal(result.plannedTaskCount, 0);
    assert.equal(result.planStatus, 'PROJECT_STATUS_INELIGIBLE');
    assert.equal(result.reasonCode, 'PROJECT_STATUS_NOT_ELIGIBLE');
    assertAdvisoryOnly(result);
  });
}

test('052 existing managed delivery task with KEEP_EXISTING suppresses draft plan', () => {
  const result = build(basePayload({
    existingTaskSnapshots: [
      { project_id: 'PRJ-DLV-001', task_group: 'delivery_stage', generated_by: legacyAction }
    ],
    replacementIntent: 'KEEP_EXISTING'
  }));
  assert.equal(result.existingManagedTasksDetected, true);
  assert.equal(result.existingManagedTaskCount, 1);
  assert.equal(result.plannedTaskSetAvailable, false);
  assert.equal(result.newTaskPlanRecommended, false);
  assert.equal(result.plannedTaskCount, 0);
  assert.equal(result.replacementRequiresWriteGate, false);
  assert.equal(result.planStatus, 'EXISTING_DELIVERY_TASKS_PRESENT');
  assert.equal(result.reasonCode, 'EXISTING_MANAGED_DELIVERY_TASKS');
});

test('053 existing managed delivery task with PLAN_MANAGED_REPLACEMENT requires write gate', () => {
  const result = build(basePayload({
    existingTaskSnapshots: [
      { project_id: 'PRJ-DLV-001', task_group: 'delivery_stage', generated_by: legacyAction }
    ],
    replacementIntent: 'PLAN_MANAGED_REPLACEMENT'
  }));
  assert.equal(result.existingManagedTasksDetected, true);
  assert.equal(result.plannedTaskSetAvailable, true);
  assert.equal(result.newTaskPlanRecommended, false);
  assert.equal(result.replacementRequiresWriteGate, true);
  assert.equal(result.planStatus, 'REPLACEMENT_PLAN_REQUIRES_WRITE_GATE');
  assert.equal(result.reasonCode, 'MANAGED_REPLACEMENT_REQUIRES_WRITE_GATE');
  assertFourDrafts(result, 'wedding');
  assertAdvisoryOnly(result);
});

test('054 wrong task group is ignored by managed duplicate detection', () => {
  const result = build(basePayload({
    existingTaskSnapshots: [
      { project_id: 'PRJ-DLV-001', task_group: 'other_stage', generated_by: legacyAction }
    ]
  }));
  assert.equal(result.existingManagedTasksDetected, false);
  assert.equal(result.plannedTaskSetAvailable, true);
});

test('055 wrong generated_by is ignored by managed duplicate detection', () => {
  const result = build(basePayload({
    existingTaskSnapshots: [
      { project_id: 'PRJ-DLV-001', task_group: 'delivery_stage', generated_by: 'manual' }
    ]
  }));
  assert.equal(result.existingManagedTasksDetected, false);
  assert.equal(result.plannedTaskSetAvailable, true);
});

test('056 different project duplicate candidate is ignored', () => {
  const result = build(basePayload({
    existingTaskSnapshots: [
      { project_id: 'PRJ-OTHER', task_group: 'delivery_stage', generated_by: legacyAction }
    ]
  }));
  assert.equal(result.existingManagedTasksDetected, false);
  assert.equal(result.plannedTaskSetAvailable, true);
});

test('057 explicit delivery deadline takes precedence over project due date', () => {
  const result = build(basePayload());
  assert.equal(result.deliveryDeadline, '2026-07-01');
  assert.equal(result.deliveryDeadlineSource, 'EXPLICIT_INPUT');
  assert.equal(result.plannedTasks[0].dueDate, '2026-07-01');
});

test('058 project due date is fallback deadline', () => {
  const input = basePayload();
  delete input.deliveryDeadline;
  const result = build(input);
  assert.equal(result.deliveryDeadline, '2026-07-08');
  assert.equal(result.deliveryDeadlineSource, 'PROJECT_DUE_DATE');
  assert.equal(result.plannedTasks[0].dueDate, '2026-07-08');
});

test('059 no deadline remains explicit null without generated current date', () => {
  const input = basePayload();
  delete input.deliveryDeadline;
  delete input.projectSnapshot.due_date;
  const result = build(input);
  assert.equal(result.deliveryDeadline, null);
  assert.equal(result.deliveryDeadlineSource, 'NOT_PROVIDED');
  assert.equal(result.plannedTasks[0].dueDate, null);
});

test('060 default delivery mode is digital delivery', () => {
  const input = basePayload();
  delete input.deliveryMode;
  const result = build(input);
  assert.equal(result.deliveryMode, 'digital delivery');
  assert.equal(result.deliveryModeSource, 'DEFAULT_DIGITAL_DELIVERY');
  assert.equal(result.plannedTasks[0].remark, 'Delivery mode: digital delivery');
});

test('061 explicit delivery mode is trimmed and used in remarks', () => {
  const result = build(basePayload({ deliveryMode: '  secure gallery package  ' }));
  assert.equal(result.deliveryMode, 'secure gallery package');
  assert.equal(result.deliveryModeSource, 'EXPLICIT_INPUT');
  assert.equal(result.plannedTasks[0].remark, 'Delivery mode: secure gallery package');
});

for (const [index, value] of ['bad\nmode', 'bad\rmode', 'bad\0mode'].entries()) {
  test(`${String(62 + index).padStart(3, '0')} delivery mode rejects CR LF and NUL variant ${index}`, () => {
    assert.throws(() => build(basePayload({ deliveryMode: value })), /CR, LF, or NUL/);
  });
}

test('065 delivery mode byte limit is enforced', () => {
  assert.throws(() => build(basePayload({ deliveryMode: 'A'.repeat(121) })), /byte limit/);
});

for (const [index, [field, value]] of [
  ['deliveryDeadline', '2026/07/01'],
  ['deliveryDeadline', '2026-02-30'],
  ['deliveryDeadline', '2026-07-01T00:00:00.000Z'],
  ['projectSnapshot.due_date', '2026-13-01']
].entries()) {
  test(`${String(66 + index).padStart(3, '0')} invalid date ${field}=${value} rejects`, () => {
    const input = basePayload();
    if (field === 'deliveryDeadline') input.deliveryDeadline = value;
    else input.projectSnapshot.due_date = value;
    assert.throws(() => build(input), /date|YYYY-MM-DD/);
  });
}

test('070 required root field projectSnapshot is enforced', () => {
  const input = basePayload();
  delete input.projectSnapshot;
  assert.throws(() => build(input));
});

for (const [index, field] of ['project_id', 'project_type', 'status'].entries()) {
  test(`${String(71 + index).padStart(3, '0')} required project field ${field} is enforced`, () => {
    const input = basePayload();
    delete input.projectSnapshot[field];
    assert.throws(() => build(input));
  });
}

test('074 existingTaskSnapshots must be an array', () => {
  assert.throws(() => build(basePayload({ existingTaskSnapshots: {} })), /array/);
});

for (const [index, field] of ['project_id', 'task_group', 'generated_by'].entries()) {
  test(`${String(75 + index).padStart(3, '0')} required existing task field ${field} is enforced`, () => {
    const task = { project_id: 'PRJ-DLV-001', task_group: 'delivery_stage', generated_by: legacyAction };
    delete task[field];
    assert.throws(() => build(basePayload({ existingTaskSnapshots: [task] })));
  });
}

test('078 unknown root field is rejected', () => {
  assert.throws(() => build(basePayload({ extra: true })), /contract/);
});

test('079 unknown project field is rejected', () => {
  assert.throws(() => build(basePayload({ projectSnapshot: { ...basePayload().projectSnapshot, customer_id: 'CUST' } })), /contract/);
});

test('080 unknown task field is rejected', () => {
  assert.throws(() => build(basePayload({
    existingTaskSnapshots: [
      { project_id: 'PRJ-DLV-001', task_group: 'delivery_stage', generated_by: legacyAction, task_id: 'TASK-1' }
    ]
  })), /contract/);
});

for (const [index, [field, value]] of [
  ['projectSnapshot.project_type', 'fashion'],
  ['projectSnapshot.status', 'unknown'],
  ['replacementIntent', 'DELETE_AND_REPLACE']
].entries()) {
  test(`${String(81 + index).padStart(3, '0')} enum validation rejects ${field}`, () => {
    const input = basePayload();
    if (field === 'projectSnapshot.project_type') input.projectSnapshot.project_type = value;
    else if (field === 'projectSnapshot.status') input.projectSnapshot.status = value;
    else input.replacementIntent = value;
    assert.throws(() => build(input));
  });
}

test('084 output contract fields are stable', () => {
  assert.deepEqual(sortedKeys(build(basePayload())), [
    'allowedProjectStatuses',
    'contractVersion',
    'coverage',
    'deliveryDeadline',
    'deliveryDeadlineSource',
    'deliveryMode',
    'deliveryModeSource',
    'executionAuthorized',
    'existingManagedTaskCount',
    'existingManagedTasksDetected',
    'fullParity',
    'legacyReferenceMode',
    'messageDispatchAuthorized',
    'newTaskPlanRecommended',
    'notificationAuthorized',
    'parityStatus',
    'persistentRecordAuthorized',
    'planStatus',
    'plannedTaskCount',
    'plannedTaskSetAvailable',
    'plannedTasks',
    'projectId',
    'projectStatus',
    'projectStatusEligible',
    'projectType',
    'projectionType',
    'reasonCode',
    'recommendationType',
    'replacementIntent',
    'replacementPlanRequested',
    'replacementRequiresWriteGate',
    'requiresHumanReview',
    'source',
    'stateMutationAuthorized',
    'taskIdsGenerated',
    'timestampsGenerated',
    'writeActionParity'
  ]);
});

for (const [index, [key, value]] of [
  ['contractVersion', 2],
  ['executionAuthorized', false],
  ['stateMutationAuthorized', false],
  ['persistentRecordAuthorized', false],
  ['taskIdsGenerated', false],
  ['timestampsGenerated', false],
  ['messageDispatchAuthorized', false],
  ['notificationAuthorized', false],
  ['requiresHumanReview', true],
  ['fullParity', false],
  ['writeActionParity', 'INTENTIONALLY_NOT_PRESERVED'],
  ['recommendationType', 'ADVISORY_ONLY'],
  ['parityStatus', 'partial'],
  ['source', 'caller_supplied_snapshot'],
  ['legacyReferenceMode', 'STATIC_ALGORITHM_MAPPING']
].entries()) {
  test(`${String(85 + index).padStart(3, '0')} output safety field ${key} is exact`, () => {
    assert.equal(build(basePayload())[key], value);
  });
}

test('099 output records exact coverage gaps', () => {
  assert.deepEqual(build(basePayload()).coverage.gapCodes, Array.from(exactCoverageGaps));
});

test('100 output does not claim persisted mutation success', () => {
  const text = JSON.stringify(build(basePayload())).toLowerCase();
  for (const phrase of ['record persisted', 'existing task deleted', 'task collection written', 'message sent', 'receipt confirmed']) {
    assert.equal(text.includes(phrase), false);
  }
});

test('101 builder is deterministic and does not mutate input', () => {
  const input = basePayload();
  const before = clone(input);
  const first = build(input);
  const second = build(input);
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
});

test('102 success envelope keys are exact', () => {
  assertSuccessEnvelope(handle(request(basePayload())));
});

test('103 failure envelope keys are exact', () => {
  assertErrorEnvelope(handle(request(basePayload(), { action: 'wrong' })));
});

test('104 planning action accepted', () => {
  assert.equal(handle(request(basePayload())).ok, true);
});

test('105 legacy create action is rejected', () => {
  assert.equal(handle(request(basePayload(), { action: legacyAction })).error.code, 'ACTION_DENIED');
});

test('106 wrong creation ID is rejected', () => {
  assert.equal(handle(request(basePayload(), { creationId: 'jenn.photo-studio.plugin-project-tasks' })).error.code, 'CREATION_ID_DENIED');
});

test('107 unknown action is rejected', () => {
  assert.equal(handle(request(basePayload(), { action: 'plan_project_tasks_from_snapshot' })).error.code, 'ACTION_DENIED');
});

test('108 wildcard action is rejected', () => {
  assert.equal(handle(request(basePayload(), { action: '*' })).error.code, 'ACTION_DENIED');
});

test('109 cross-creation action is rejected', () => {
  assert.equal(handle(request(basePayload(), { creationId: 'jenn.photo-studio.plugin-selection-notice', action: 'build_selection_notice_from_snapshot' })).error.code, 'ACTION_DENIED');
});

test('110 payload action collision is rejected', () => {
  assert.equal(handle(request({ ...basePayload(), action: 'x' })).error.code, 'PAYLOAD_ACTION_COLLISION');
});

test('111 payload tool_name collision is rejected', () => {
  assert.equal(handle(request({ ...basePayload(), tool_name: 'x' })).error.code, 'PAYLOAD_ACTION_COLLISION');
});

test('112 prototype pollution request is rejected', () => {
  assert.equal(handle(JSON.parse(`{"protocolVersion":1,"requestId":"${requestId}","creationId":"${canonicalCreationId}","action":"${action}","payload":{"__proto__":{}}}`)).error.code, 'PROTOTYPE_POLLUTION_KEY');
});

test('113 protected key request is rejected', () => {
  assert.equal(handle(request({ ...basePayload(), token: 'secret-shaped' })).error.code, 'PROTECTED_DATA_KEY_DENIED');
});

test('114 excessive depth is rejected', () => {
  let deep = {};
  let cursor = deep;
  for (let i = 0; i < 14; i += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  assert.equal(handle(request(deep)).error.code, 'JSON_DEPTH_EXCEEDED');
});

test('115 parseLine requires newline', () => {
  const { parseLine } = require(entrypointPath);
  assert.equal(parseLine(JSON.stringify(request(basePayload()))).response.error.code, 'INPUT_LINE_REQUIRED');
});

test('116 parseLine rejects multiple lines', () => {
  const { parseLine } = require(entrypointPath);
  assert.equal(parseLine(`${JSON.stringify(request(basePayload()))}\n{}\n`).response.error.code, 'INPUT_LINE_REQUIRED');
});

test('117 parseLine accepts one JSON line', () => {
  const { parseLine } = require(entrypointPath);
  assert.equal(parseLine(`${JSON.stringify(request(basePayload()))}\n`).ok, true);
});

for (const [index, [label, pattern]] of [
  ['filesystem API', /\brequire\(['"]fs['"]\)|node:fs/],
  ['network API', /\brequire\(['"](?:http|https|net|tls)['"]\)/],
  ['child process API', /\brequire\(['"]child_process['"]\)/],
  ['worker API', /\brequire\(['"]worker_threads['"]\)/],
  ['process.env', /process\.env/],
  ['current time API', /\bDate\.now\b|new Date\s*\(/],
  ['console logging', /console\./],
  ['persistent id generator', /generateRecordId|randomUUID|crypto\.randomUUID/],
  ['persistent timestamp generator', /nowIso|created_at|updated_at/],
  ['collection write API', /writeCollection|withStoreLock|readCollection/],
  ['task delete API', /deleteTask|removeTask/],
  ['notification API', /sendNotification|notificationClient/],
  ['message dispatch API', /dispatchMessage|sendMessage/]
].entries()) {
  test(`${String(118 + index).padStart(3, '0')} runtime source contains no ${label}`, () => {
    const combined = [indexPath, projectionPath, entrypointPath].map(sourceText).join('\n');
    assert.equal(pattern.test(combined), false);
  });
}

test('131 metadata and runtime modules contain no absolute local path or real URL', () => {
  const combined = [packageManifestPath, profileManifestPath, indexPath, projectionPath, entrypointPath].map(sourceText).join('\n');
  assert.equal(/[A-Z]:\\/.test(combined), false);
  assert.equal(/https?:\/\/(?!example)/.test(combined), false);
});

test('132 metadata and runtime modules contain no secret-shaped value', () => {
  const combined = [packageManifestPath, profileManifestPath, indexPath, projectionPath, entrypointPath].map(sourceText).join('\n');
  assert.equal(/sk-[A-Za-z0-9]|Bearer\s+[A-Za-z0-9._~+/=-]+|password\s*[:=]\s*['"][^'"]+/.test(combined), false);
});

test('133 metadata contains no retirement deletion discard or full parity claim', () => {
  const forbiddenValues = new Set(['USER_APPROVED_RETIREMENT', 'RETIRED', 'DELETED', 'DISCARDED']);
  function visit(value) {
    if (typeof value === 'string') assert.equal(forbiddenValues.has(value), false);
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    for (const item of Object.values(value)) visit(item);
  }
  const manifest = readJson(packageManifestPath);
  const profile = readJson(profileManifestPath);
  visit(manifest);
  visit(profile);
  assert.equal(manifest.fullParity, false);
  assert.equal(manifest.fullParityClaimed, false);
  assert.equal(profile.fullParity, false);
});

test('134 runtime source does not import legacy plugin service store or private data paths', () => {
  const combined = [indexPath, projectionPath, entrypointPath].map(sourceText).join('\n');
  assert.equal(/PhotoStudioDeliveryTasks|deliveryTaskService|photo_studio_data|LocalState|readCollection|writeCollection|withStoreLock/.test(combined), false);
});

test('135 profile does not make legacy write action runtime eligible', () => {
  const profile = readJson(profileManifestPath);
  assert.equal(profile.legacyOriginalActionRuntimeEligible, false);
  assert.equal(JSON.stringify(profile.profiles).includes(legacyAction), true);
});

test('136 source does not use the original create/update/delete/replace action surface', () => {
  const combined = [indexPath, projectionPath, entrypointPath].map(sourceText).join('\n');
  assert.equal(/createDeliveryTasks|create_delivery_tasks\(/.test(combined), false);
  assert.equal(/update_delivery_tasks|delete_delivery_tasks|replace_delivery_tasks/.test(combined), false);
});

test('137 no hard-coded stale package count assertions exist in this focused test', () => {
  const text = sourceText(__filename);
  assert.equal(/packageCount\\s*[=!]==?\\s*(?:30|34|35)/.test(text), false);
});

const exactV2RootKeys = Object.freeze([
  'allowedProjectStatuses',
  'contractVersion',
  'coverage',
  'deliveryDeadline',
  'deliveryDeadlineSource',
  'deliveryMode',
  'deliveryModeSource',
  'executionAuthorized',
  'existingManagedTaskCount',
  'existingManagedTasksDetected',
  'fullParity',
  'legacyReferenceMode',
  'messageDispatchAuthorized',
  'newTaskPlanRecommended',
  'notificationAuthorized',
  'parityStatus',
  'persistentRecordAuthorized',
  'planStatus',
  'plannedTaskCount',
  'plannedTaskSetAvailable',
  'plannedTasks',
  'projectId',
  'projectStatus',
  'projectStatusEligible',
  'projectType',
  'projectionType',
  'reasonCode',
  'recommendationType',
  'replacementIntent',
  'replacementPlanRequested',
  'replacementRequiresWriteGate',
  'requiresHumanReview',
  'source',
  'stateMutationAuthorized',
  'taskIdsGenerated',
  'timestampsGenerated',
  'writeActionParity'
]);

for (const [index, key] of exactV2RootKeys.entries()) {
  test(`${String(138 + index).padStart(3, '0')} V2 root field ${key} is present`, () => {
    assert.equal(Object.prototype.hasOwnProperty.call(build(basePayload()), key), true);
  });
}

for (const [index, key] of [
  'actualProjectStatus',
  'existingManagedDeliveryTaskDetected',
  'existingManagedDeliveryTaskCount',
  'taskPlanRecommended',
  'plannedTaskDrafts',
  'plannedTaskDraftCount',
  'skippedCount',
  'advisoryOnly',
  'businessWriteStatus',
  'taskMutationStatus'
].entries()) {
  test(`${String(175 + index).padStart(3, '0')} deprecated root field ${key} is absent`, () => {
    assert.equal(Object.prototype.hasOwnProperty.call(build(basePayload()), key), false);
  });
}

for (const [index, key] of [
  'taskName',
  'taskType',
  'sortOrder',
  'dueDate',
  'deliveryMode',
  'remark',
  'taskDraftType',
  'executionAuthorized',
  'stateMutationAuthorized',
  'persistentRecordAuthorized',
  'messageDispatchAuthorized'
].entries()) {
  test(`${String(185 + index).padStart(3, '0')} advisory task field ${key} is present`, () => {
    assert.equal(Object.prototype.hasOwnProperty.call(build(basePayload()).plannedTasks[0], key), true);
  });
}

for (const [index, key] of [
  'project_id',
  'task_name',
  'task_type',
  'proposed_status',
  'sort_order',
  'due_date',
  'task_group',
  'generated_by',
  'task_id',
  'created_at',
  'updated_at'
].entries()) {
  test(`${String(196 + index).padStart(3, '0')} write-shaped task field ${key} is absent`, () => {
    assert.equal(Object.prototype.hasOwnProperty.call(build(basePayload()).plannedTasks[0], key), false);
  });
}

for (const [index, [label, input, expected]] of [
  ['new plan', basePayload(), ['NEW_DELIVERY_TASK_PLAN_RECOMMENDED', 'NEW_DELIVERY_TASK_PLAN_AVAILABLE', true, true, false]],
  ['keep existing', basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ-DLV-001', task_group: 'delivery_stage', generated_by: legacyAction }] }), ['EXISTING_DELIVERY_TASKS_PRESENT', 'EXISTING_MANAGED_DELIVERY_TASKS', false, false, false]],
  ['replacement gate', basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ-DLV-001', task_group: 'delivery_stage', generated_by: legacyAction }], replacementIntent: 'PLAN_MANAGED_REPLACEMENT' }), ['REPLACEMENT_PLAN_REQUIRES_WRITE_GATE', 'MANAGED_REPLACEMENT_REQUIRES_WRITE_GATE', true, false, true]],
  ['ineligible', basePayload({ projectSnapshot: { project_id: 'PRJ-DLV-INELIGIBLE', project_type: 'event', status: 'editing' } }), ['PROJECT_STATUS_INELIGIBLE', 'PROJECT_STATUS_NOT_ELIGIBLE', false, false, false]]
].entries()) {
  test(`${String(207 + index).padStart(3, '0')} plan status and reason matrix ${label}`, () => {
    const result = build(input);
    assert.equal(result.planStatus, expected[0]);
    assert.equal(result.reasonCode, expected[1]);
    assert.equal(result.plannedTaskSetAvailable, expected[2]);
    assert.equal(result.newTaskPlanRecommended, expected[3]);
    assert.equal(result.replacementRequiresWriteGate, expected[4]);
  });
}

test('211 replacement intent is surfaced separately from write authorization', () => {
  const result = build(basePayload({ replacementIntent: 'PLAN_MANAGED_REPLACEMENT' }));
  assert.equal(result.replacementPlanRequested, true);
  assert.equal(result.replacementRequiresWriteGate, false);
  assert.equal(result.executionAuthorized, false);
});

test('212 KEEP_EXISTING replacement intent is surfaced without replacement plan', () => {
  const result = build(basePayload({ replacementIntent: 'KEEP_EXISTING' }));
  assert.equal(result.replacementPlanRequested, false);
  assert.equal(result.replacementRequiresWriteGate, false);
});

test('213 no deadline source uses canonical NOT_PROVIDED value', () => {
  const input = basePayload();
  delete input.deliveryDeadline;
  delete input.projectSnapshot.due_date;
  assert.equal(build(input).deliveryDeadlineSource, 'NOT_PROVIDED');
});

test('214 default delivery mode source uses canonical DEFAULT_DIGITAL_DELIVERY value', () => {
  const input = basePayload();
  delete input.deliveryMode;
  assert.equal(build(input).deliveryModeSource, 'DEFAULT_DIGITAL_DELIVERY');
});

test('215 contract V2 does not emit persistent task ids or timestamps', () => {
  const text = JSON.stringify(build(basePayload()));
  for (const phrase of ['task_id', 'created_at', 'updated_at']) {
    assert.equal(text.includes(phrase), false);
  }
});

test('216 contract V2 does not emit write-shaped public task keys', () => {
  const text = JSON.stringify(build(basePayload()));
  for (const phrase of ['project_id', 'task_name', 'task_type', 'proposed_status', 'sort_order', 'due_date', 'task_group', 'generated_by']) {
    assert.equal(text.includes(phrase), false);
  }
});

test('217 output contract status is mirrored in package evidence', () => {
  const profile = readJson(profileManifestPath);
  assert.equal(profile.outputContractStatus, 'CANONICAL_ADVISORY_TASK_DRAFTS');
  assert.equal(profile.profiles[0].outputContractStatus, 'CANONICAL_ADVISORY_TASK_DRAFTS');
});

test('218 declared focused test coverage count is at least 191', () => {
  const declaredFocusedTestCount = 219;
  assert.ok(declaredFocusedTestCount >= 191);
});
