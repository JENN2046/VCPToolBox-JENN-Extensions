'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..', 'PhotoStudioPackages', 'ProjectTasksPlanningAdapter');
const packageManifestPath = path.join(packageRoot, 'package-manifest.json');
const profileManifestPath = path.join(packageRoot, 'adapter-profile-manifest.json');
const indexPath = path.join(packageRoot, 'index.cjs');
const projectionPath = path.join(packageRoot, 'projectTaskPlanProjection.cjs');
const entrypointPath = path.join(packageRoot, 'stdio-entrypoint.cjs');

const canonicalCreationId = 'jenn.photo-studio.plugin-project-tasks';
const inferredCreationId = 'jenn.photo-studio.project-tasks';
const action = 'plan_project_tasks_from_snapshot';
const legacyAction = 'create_project_tasks';
const packageId = 'jenn.photostudio.project-tasks-planning-adapter';
const requestId = '88888888-8888-4888-8888-888888888888';
const exactCoverageGaps = Object.freeze([
  'LOCAL_PROJECT_LOOKUP_NOT_PERFORMED',
  'LOCAL_TASK_LOOKUP_NOT_PERFORMED',
  'STORE_LOCK_BEHAVIOR_NOT_REPRODUCED',
  'REAL_EXISTING_TASK_STATE_NOT_VERIFIED',
  'TASK_RECORDS_NOT_CREATED',
  'TASK_IDS_NOT_GENERATED',
  'CREATED_AT_NOT_GENERATED',
  'UPDATED_AT_NOT_GENERATED',
  'EXISTING_TASKS_NOT_DELETED',
  'EXISTING_TASKS_NOT_REPLACED',
  'TASK_COLLECTION_NOT_WRITTEN',
  'CUSTOM_TASK_ASSIGNEE_NOT_VERIFIED',
  'CUSTOM_TASK_REMARK_REQUIRES_HUMAN_REVIEW'
]);
const expectedTemplates = Object.freeze({
  wedding_standard: Object.freeze([
    ['Confirm wedding timeline', 'communication', 1],
    ['Prepare shot list', 'shooting', 2],
    ['Execute wedding shoot', 'shooting', 3],
    ['Select hero frames', 'review', 4],
    ['Edit final gallery', 'editing', 5],
    ['Deliver wedding package', 'delivery', 6]
  ]),
  portrait_basic: Object.freeze([
    ['Confirm portrait brief', 'communication', 1],
    ['Prepare styling notes', 'other', 2],
    ['Run portrait session', 'shooting', 3],
    ['Edit selects', 'editing', 4],
    ['Deliver portrait set', 'delivery', 5]
  ]),
  commercial_standard: Object.freeze([
    ['Confirm commercial scope', 'communication', 1],
    ['Build production checklist', 'other', 2],
    ['Execute production shoot', 'shooting', 3],
    ['Review internal selects', 'review', 4],
    ['Edit approved assets', 'editing', 5],
    ['Deliver commercial assets', 'delivery', 6]
  ]),
  event_basic: Object.freeze([
    ['Confirm event rundown', 'communication', 1],
    ['Capture event coverage', 'shooting', 2],
    ['Edit highlight set', 'editing', 3],
    ['Deliver event gallery', 'delivery', 4]
  ])
});
const defaultMapping = Object.freeze({
  wedding: 'wedding_standard',
  portrait: 'portrait_basic',
  commercial: 'commercial_standard',
  event: 'event_basic',
  other: 'portrait_basic'
});

let declaredTestCount = 0;
function add(name, fn) {
  declaredTestCount += 1;
  test(name, fn);
}

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
      project_id: ' PRJ-TASK-001 ',
      project_type: 'wedding',
      due_date: '2026-07-08'
    },
    existingTaskSnapshots: [],
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
  const { planProjectTasksFromSnapshot } = require(indexPath);
  return planProjectTasksFromSnapshot(input);
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
  assert.equal(result.recommendationType, 'ADVISORY_ONLY');
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
}

function assertDraftSafety(task) {
  assert.equal(task.taskDraftType, 'ADVISORY_TASK_DRAFT');
  assert.equal(task.executionAuthorized, false);
  assert.equal(task.stateMutationAuthorized, false);
  assert.equal(task.persistentRecordAuthorized, false);
  assert.equal(task.messageDispatchAuthorized, false);
  for (const field of ['task_id', 'created_at', 'updated_at', 'persisted', 'created', 'deleted', 'replaced', 'completed', 'status']) {
    assert.equal(Object.prototype.hasOwnProperty.call(task, field), false, `${field} must be absent`);
  }
}

function assertTemplateTasks(result, templateName) {
  const expected = expectedTemplates[templateName];
  assert.equal(result.plannedTaskCount, expected.length);
  assert.equal(result.plannedTasks.length, expected.length);
  result.plannedTasks.forEach((task, index) => {
    assert.deepEqual(
      [task.taskName, task.taskType, task.sortOrder],
      expected[index]
    );
    assert.equal(task.assignee, null);
    assert.equal(task.remark, null);
    assertDraftSafety(task);
  });
}

add('001 canonical FS1A creation ID is accepted by the JSONL handler', () => {
  const response = handle(request(basePayload()));
  assertSuccessEnvelope(response);
  assert.equal(response.result.projectId, 'PRJ-TASK-001');
});

add('002 inferred ProjectTasks ID is rejected by the JSONL handler', () => {
  const response = handle(request(basePayload(), { creationId: inferredCreationId }));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'CREATION_ID_DENIED');
});

add('003 package ID exact', () => {
  assert.equal(readJson(packageManifestPath).packageId, packageId);
});

add('004 package manifest contains canonical ID exactly once', () => {
  assert.deepEqual(readJson(packageManifestPath).creationIds, [canonicalCreationId]);
});

add('005 inferred ID is absent from package manifest', () => {
  assert.equal(sourceText(packageManifestPath).includes(inferredCreationId), false);
});

add('006 no runtime alias or package alias is declared', () => {
  const manifest = readJson(packageManifestPath);
  const profile = readJson(profileManifestPath);
  for (const key of ['aliases', 'runtimeAliases', 'packageAliases', 'creationAliases']) {
    assert.equal(Object.prototype.hasOwnProperty.call(manifest, key), false);
    assert.equal(Object.prototype.hasOwnProperty.call(profile, key), false);
  }
});

add('007 defaultEnabled=false', () => assert.equal(readJson(packageManifestPath).defaultEnabled, false));
add('008 runtimeEnabled=false', () => assert.equal(readJson(packageManifestPath).runtimeEnabled, false));
add('009 runtimeEligible=true', () => assert.equal(readJson(packageManifestPath).runtimeEligible, true));
add('010 trustClass=ISOLATED_PROCESS', () => assert.equal(readJson(packageManifestPath).trustClass, 'ISOLATED_PROCESS'));
add('011 protocol=CANONICAL_JSONL_V1', () => assert.equal(readJson(packageManifestPath).protocol, 'CANONICAL_JSONL_V1'));
add('012 syntheticOnly=true', () => assert.equal(readJson(packageManifestPath).syntheticShadowOnly, true));
add('013 productionEnabled=false', () => assert.equal(readJson(packageManifestPath).productionEnabled, false));
add('014 userAcceptanceStatus=PENDING', () => assert.equal(readJson(packageManifestPath).userAcceptanceStatus, 'PENDING'));
add('015 retirement=false', () => assert.equal(readJson(packageManifestPath).retirement, false));
add('016 action count=1', () => assert.deepEqual(readJson(packageManifestPath).allowedActions, [action]));
add('017 legacy create action is absent from allowed actions', () => assert.equal(readJson(packageManifestPath).allowedActions.includes(legacyAction), false));

for (const key of [
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
]) {
  add(`high-risk permission ${key} is false`, () => assert.equal(readJson(packageManifestPath)[key], false));
}

add('profile binds pure planning extraction and legacy write action', () => {
  const profile = readJson(profileManifestPath);
  assert.equal(profile.status, 'PURE_PLANNING_EXTRACTION');
  assert.equal(profile.selectedContract, 'TEMPLATE_AND_CUSTOM_V1');
  assert.equal(profile.legacyOriginalAction, legacyAction);
  assert.equal(profile.legacyOriginalActionClass, 'BUSINESS_WRITE_API_GATE');
  assert.equal(profile.legacyOriginalActionRuntimeEligible, false);
  assert.equal(profile.planningAction, action);
});

add('profile records exact coverage gaps', () => {
  assert.deepEqual(readJson(profileManifestPath).coverageGaps, exactCoverageGaps);
});

add('index import exports exactly one pure builder', () => {
  assert.deepEqual(Object.keys(require(indexPath)).sort(), ['planProjectTasksFromSnapshot']);
});

add('template names exact', () => {
  assert.deepEqual(Object.keys(require(projectionPath).TASK_TEMPLATES).sort(), Object.keys(expectedTemplates).sort());
});

for (const [templateName, rows] of Object.entries(expectedTemplates)) {
  add(`${templateName} count exact`, () => assert.equal(require(projectionPath).TASK_TEMPLATES[templateName].length, rows.length));
  rows.forEach(([taskName, taskType, sortOrder], index) => {
    add(`${templateName} task ${index + 1} exact`, () => {
      const task = require(projectionPath).TASK_TEMPLATES[templateName][index];
      assert.deepEqual([task.taskName, task.taskType, task.sortOrder], [taskName, taskType, sortOrder]);
    });
  });
}

add('unique template task total=21', () => {
  const templates = require(projectionPath).TASK_TEMPLATES;
  assert.equal(Object.values(templates).reduce((sum, rows) => sum + rows.length, 0), 21);
});

for (const [projectType, templateName] of Object.entries(defaultMapping)) {
  add(`${projectType} default mapping`, () => {
    const result = build(basePayload({ projectSnapshot: { project_id: `PRJ-${projectType}`, project_type: projectType, due_date: '2026-07-08' } }));
    assert.equal(result.selectedTemplateName, templateName);
    assert.equal(result.taskSourceType, 'DEFAULT_PROJECT_TYPE_TEMPLATE');
    assertTemplateTasks(result, templateName);
  });
}

add('explicit template override', () => {
  const result = build(basePayload({ taskTemplate: 'event_basic' }));
  assert.equal(result.taskSourceType, 'EXPLICIT_TEMPLATE');
  assert.equal(result.selectedTemplateName, 'event_basic');
  assertTemplateTasks(result, 'event_basic');
});

add('unknown template rejected', () => {
  assert.throws(() => build(basePayload({ taskTemplate: 'unknown_template' })), /taskTemplate/);
});

add('template order preserved', () => {
  assert.deepEqual(build(basePayload()).plannedTasks.map((task) => task.taskName), expectedTemplates.wedding_standard.map((row) => row[0]));
});

add('template sort orders exact', () => {
  assert.deepEqual(build(basePayload()).plannedTasks.map((task) => task.sortOrder), [1, 2, 3, 4, 5, 6]);
});

add('template task types exact', () => {
  assert.deepEqual(build(basePayload()).plannedTasks.map((task) => task.taskType), expectedTemplates.wedding_standard.map((row) => row[1]));
});

add('template assignee and remark are null', () => {
  for (const task of build(basePayload()).plannedTasks) {
    assert.equal(task.assignee, null);
    assert.equal(task.remark, null);
  }
});

add('project due date applied to template tasks', () => {
  for (const task of build(basePayload()).plannedTasks) {
    assert.equal(task.dueDate, '2026-07-08');
    assert.equal(task.dueDateSource, 'PROJECT_DUE_DATE');
  }
});

add('missing project due date yields null', () => {
  const result = build(basePayload({ projectSnapshot: { project_id: 'PRJ-NO-DUE', project_type: 'wedding' } }));
  for (const task of result.plannedTasks) {
    assert.equal(task.dueDate, null);
    assert.equal(task.dueDateSource, 'NOT_PROVIDED');
  }
});

add('single custom task', () => {
  const result = build(basePayload({ customTaskDrafts: [{ taskName: ' Custom planning ', taskType: 'review' }] }));
  assert.equal(result.taskSourceType, 'CUSTOM_TASK_DRAFTS');
  assert.equal(result.selectedTemplateName, null);
  assert.equal(result.plannedTasks[0].taskName, 'Custom planning');
});

add('fifty custom tasks accepted', () => {
  const tasks = Array.from({ length: 50 }, (_, index) => ({ taskName: `Task ${index + 1}`, taskType: 'other' }));
  assert.equal(build(basePayload({ customTaskDrafts: tasks })).plannedTaskCount, 50);
});

add('fifty-one custom tasks rejected', () => {
  const tasks = Array.from({ length: 51 }, (_, index) => ({ taskName: `Task ${index + 1}`, taskType: 'other' }));
  assert.throws(() => build(basePayload({ customTaskDrafts: tasks })), /customTaskDrafts/);
});

add('missing task name rejected', () => assert.throws(() => build(basePayload({ customTaskDrafts: [{ taskType: 'other' }] })), /taskName/));
add('task name trimmed', () => assert.equal(build(basePayload({ customTaskDrafts: [{ taskName: '  Trim  ', taskType: 'other' }] })).plannedTasks[0].taskName, 'Trim'));
add('oversized task name rejected', () => assert.throws(() => build(basePayload({ customTaskDrafts: [{ taskName: 'x'.repeat(201), taskType: 'other' }] })), /byte limit/));

for (const bad of ['bad\rname', 'bad\nname', 'bad\0name']) {
  add(`task name rejects control character ${JSON.stringify(bad)}`, () => {
    assert.throws(() => build(basePayload({ customTaskDrafts: [{ taskName: bad, taskType: 'other' }] })), /CR, LF, or NUL/);
  });
}

for (const taskType of ['shooting', 'editing', 'delivery', 'review', 'communication', 'other']) {
  add(`task type ${taskType} accepted`, () => {
    assert.equal(build(basePayload({ customTaskDrafts: [{ taskName: taskType, taskType }] })).plannedTasks[0].taskType, taskType);
  });
}

add('unknown task type rejected', () => assert.throws(() => build(basePayload({ customTaskDrafts: [{ taskName: 'Bad', taskType: 'bad' }] })), /taskType/));
add('default sort order', () => assert.equal(build(basePayload({ customTaskDrafts: [{ taskName: 'Sort', taskType: 'other' }] })).plannedTasks[0].sortOrder, 1));
add('explicit sort order', () => assert.equal(build(basePayload({ customTaskDrafts: [{ taskName: 'Sort', taskType: 'other', sortOrder: 7 }] })).plannedTasks[0].sortOrder, 7));
add('zero sort order rejected', () => assert.throws(() => build(basePayload({ customTaskDrafts: [{ taskName: 'Sort', taskType: 'other', sortOrder: 0 }] })), /range/));
add('negative sort order rejected', () => assert.throws(() => build(basePayload({ customTaskDrafts: [{ taskName: 'Sort', taskType: 'other', sortOrder: -1 }] })), /range/));
add('non-integer sort order rejected', () => assert.throws(() => build(basePayload({ customTaskDrafts: [{ taskName: 'Sort', taskType: 'other', sortOrder: 1.5 }] })), /integer/));
add('sort order over 10000 rejected', () => assert.throws(() => build(basePayload({ customTaskDrafts: [{ taskName: 'Sort', taskType: 'other', sortOrder: 10001 }] })), /range/));
add('explicit custom due date', () => assert.equal(build(basePayload({ customTaskDrafts: [{ taskName: 'Due', taskType: 'other', dueDate: '2026-08-01' }] })).plannedTasks[0].dueDateSource, 'CUSTOM_TASK_DUE_DATE'));
add('project due-date fallback', () => assert.equal(build(basePayload({ customTaskDrafts: [{ taskName: 'Due', taskType: 'other' }] })).plannedTasks[0].dueDateSource, 'PROJECT_DUE_DATE'));
add('missing all due dates yields null', () => {
  const result = build(basePayload({ projectSnapshot: { project_id: 'PRJ', project_type: 'other' }, customTaskDrafts: [{ taskName: 'Due', taskType: 'other' }] }));
  assert.equal(result.plannedTasks[0].dueDate, null);
  assert.equal(result.plannedTasks[0].dueDateSource, 'NOT_PROVIDED');
});
add('assignee trimmed', () => assert.equal(build(basePayload({ customTaskDrafts: [{ taskName: 'A', taskType: 'other', assignee: ' Jenn ' }] })).plannedTasks[0].assignee, 'Jenn'));
add('oversized assignee rejected', () => assert.throws(() => build(basePayload({ customTaskDrafts: [{ taskName: 'A', taskType: 'other', assignee: 'x'.repeat(121) }] })), /byte limit/));
for (const bad of ['a\rb', 'a\nb', 'a\0b']) add(`assignee rejects ${JSON.stringify(bad)}`, () => assert.throws(() => build(basePayload({ customTaskDrafts: [{ taskName: 'A', taskType: 'other', assignee: bad }] })), /CR, LF, or NUL/));
add('remark trimmed', () => assert.equal(build(basePayload({ customTaskDrafts: [{ taskName: 'R', taskType: 'other', remark: ' Note ' }] })).plannedTasks[0].remark, 'Note'));
add('oversized remark rejected', () => assert.throws(() => build(basePayload({ customTaskDrafts: [{ taskName: 'R', taskType: 'other', remark: 'x'.repeat(501) }] })), /byte limit/));
for (const bad of ['r\rb', 'r\nb', 'r\0b']) add(`remark rejects ${JSON.stringify(bad)}`, () => assert.throws(() => build(basePayload({ customTaskDrafts: [{ taskName: 'R', taskType: 'other', remark: bad }] })), /CR, LF, or NUL/));
add('template plus non-empty custom rejected', () => assert.throws(() => build(basePayload({ taskTemplate: 'portrait_basic', customTaskDrafts: [{ taskName: 'X', taskType: 'other' }] })), /cannot be used together/));
add('template plus empty custom permitted', () => assert.equal(build(basePayload({ taskTemplate: 'portrait_basic', customTaskDrafts: [] })).selectedTemplateName, 'portrait_basic'));
add('empty custom treated as absent', () => assert.equal(build(basePayload({ customTaskDrafts: [] })).taskSourceType, 'DEFAULT_PROJECT_TYPE_TEMPLATE'));
add('custom array order preserved and sortOrder does not reorder', () => {
  const result = build(basePayload({ customTaskDrafts: [{ taskName: 'Second', taskType: 'other', sortOrder: 2 }, { taskName: 'First', taskType: 'other', sortOrder: 1 }] }));
  assert.deepEqual(result.plannedTasks.map((task) => task.taskName), ['Second', 'First']);
});
add('duplicate task names permitted', () => assert.equal(build(basePayload({ customTaskDrafts: [{ taskName: 'Same', taskType: 'other' }, { taskName: 'Same', taskType: 'other' }] })).plannedTaskCount, 2));
add('duplicate sort orders permitted', () => assert.equal(build(basePayload({ customTaskDrafts: [{ taskName: 'A', taskType: 'other', sortOrder: 1 }, { taskName: 'B', taskType: 'other', sortOrder: 1 }] })).plannedTaskCount, 2));
add('custom input not mutated', () => {
  const input = basePayload({ customTaskDrafts: [{ taskName: 'A', taskType: 'other' }] });
  const before = clone(input);
  build(input);
  assert.deepEqual(input, before);
});

add('exact project match detected', () => {
  const result = build(basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ-TASK-001' }] }));
  assert.equal(result.existingProjectTasksDetected, true);
  assert.equal(result.existingProjectTaskCount, 1);
});
add('different project ignored', () => assert.equal(build(basePayload({ existingTaskSnapshots: [{ project_id: 'OTHER' }] })).existingProjectTaskCount, 0));
add('case-sensitive match', () => assert.equal(build(basePayload({ existingTaskSnapshots: [{ project_id: 'prj-task-001' }] })).existingProjectTaskCount, 0));
add('multiple matching tasks counted', () => assert.equal(build(basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ-TASK-001' }, { project_id: 'PRJ-TASK-001' }] })).existingProjectTaskCount, 2));
add('empty snapshots default', () => assert.equal(build(basePayload({ existingTaskSnapshots: undefined })).existingProjectTaskCount, 0));
add('non-array snapshots rejected', () => assert.throws(() => build(basePayload({ existingTaskSnapshots: {} })), /array/));
add('non-plain snapshot rejected', () => assert.throws(() => build(basePayload({ existingTaskSnapshots: [[]] })), /plain/));
add('missing existing project ID rejected', () => assert.throws(() => build(basePayload({ existingTaskSnapshots: [{}] })), /project_id/));
add('unknown existing-task field rejected', () => assert.throws(() => build(basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ', task_id: 'T' }] })), /not part/));
add('existing-task input not mutated', () => {
  const input = basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ-TASK-001' }] });
  const before = clone(input);
  build(input);
  assert.deepEqual(input, before);
});

add('default replacement intent KEEP_EXISTING', () => assert.equal(build(basePayload({ replacementIntent: undefined })).replacementIntent, 'KEEP_EXISTING'));
add('explicit KEEP_EXISTING', () => assert.equal(build(basePayload({ replacementIntent: 'KEEP_EXISTING' })).replacementIntent, 'KEEP_EXISTING'));
add('explicit PLAN_PROJECT_TASK_REPLACEMENT', () => assert.equal(build(basePayload({ replacementIntent: 'PLAN_PROJECT_TASK_REPLACEMENT' })).replacementIntent, 'PLAN_PROJECT_TASK_REPLACEMENT'));
add('unknown intent rejected', () => assert.throws(() => build(basePayload({ replacementIntent: 'OVERRIDE' })), /replacementIntent/));
add('overrideExisting root field rejected', () => assert.throws(() => build({ ...basePayload(), overrideExisting: true }), /overrideExisting/));
add('existing plus KEEP returns no plan', () => {
  const result = build(basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ-TASK-001' }] }));
  assert.equal(result.planStatus, 'EXISTING_PROJECT_TASKS_PRESENT');
  assert.equal(result.plannedTaskSetAvailable, false);
  assert.equal(result.plannedTaskCount, 0);
});
add('existing plus replacement returns plan', () => {
  const result = build(basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ-TASK-001' }], replacementIntent: 'PLAN_PROJECT_TASK_REPLACEMENT' }));
  assert.equal(result.planStatus, 'REPLACEMENT_PLAN_REQUIRES_WRITE_GATE');
  assert.equal(result.replacementRequiresWriteGate, true);
  assert.equal(result.plannedTaskCount, 6);
});
add('no existing returns new plan', () => assert.equal(build(basePayload()).planStatus, 'NEW_PROJECT_TASK_PLAN_RECOMMENDED'));
add('replacement plan never claims deletion', () => assert.equal(JSON.stringify(build(basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ-TASK-001' }], replacementIntent: 'PLAN_PROJECT_TASK_REPLACEMENT' }))).includes('"deleted":true'), false));
add('replacement plan never claims persistence', () => assert.equal(JSON.stringify(build(basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ-TASK-001' }], replacementIntent: 'PLAN_PROJECT_TASK_REPLACEMENT' }))).includes('"persisted":true'), false));

add('missing project rejected', () => assert.throws(() => build({}), /projectSnapshot/));
add('missing project ID rejected', () => assert.throws(() => build(basePayload({ projectSnapshot: { project_type: 'wedding' } })), /project_id/));
add('project ID trimmed', () => assert.equal(build(basePayload()).projectId, 'PRJ-TASK-001'));
add('oversized project ID rejected', () => assert.throws(() => build(basePayload({ projectSnapshot: { project_id: 'x'.repeat(201), project_type: 'wedding' } })), /byte limit/));
for (const bad of ['p\rj', 'p\nj', 'p\0j']) add(`project ID rejects ${JSON.stringify(bad)}`, () => assert.throws(() => build(basePayload({ projectSnapshot: { project_id: bad, project_type: 'wedding' } })), /CR, LF, or NUL/));
for (const projectType of ['wedding', 'portrait', 'commercial', 'event', 'other']) add(`project type ${projectType} accepted`, () => assert.equal(build(basePayload({ projectSnapshot: { project_id: 'PRJ', project_type: projectType } })).projectType, projectType));
add('unknown project type rejected', () => assert.throws(() => build(basePayload({ projectSnapshot: { project_id: 'PRJ', project_type: 'bad' } })), /project_type/));
add('invalid project due date rejected', () => assert.throws(() => build(basePayload({ projectSnapshot: { project_id: 'PRJ', project_type: 'wedding', due_date: '2026-02-30' } })), /due_date/));
add('unknown root field rejected', () => assert.throws(() => build({ ...basePayload(), unknown: true }), /not part/));
add('unknown project field rejected', () => assert.throws(() => build(basePayload({ projectSnapshot: { project_id: 'PRJ', project_type: 'wedding', status: 'editing' } })), /not part/));
add('non-plain root rejected', () => assert.throws(() => build([]), /plain/));
add('non-plain project rejected', () => assert.throws(() => build(basePayload({ projectSnapshot: [] })), /plain/));
add('input not mutated', () => {
  const input = basePayload();
  const before = clone(input);
  build(input);
  assert.deepEqual(input, before);
});

for (const [label, payloadValue] of [
  ['new-template plan output exact', basePayload()],
  ['new-custom plan output exact', basePayload({ customTaskDrafts: [{ taskName: 'A', taskType: 'other' }] })],
  ['existing-task output exact', basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ-TASK-001' }] })],
  ['replacement-template output exact', basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ-TASK-001' }], replacementIntent: 'PLAN_PROJECT_TASK_REPLACEMENT' })],
  ['replacement-custom output exact', basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ-TASK-001' }], replacementIntent: 'PLAN_PROJECT_TASK_REPLACEMENT', customTaskDrafts: [{ taskName: 'A', taskType: 'other' }] })]
]) {
  add(label, () => {
    const result = build(payloadValue);
    assert.deepEqual(sortedKeys(result), [
      'contractVersion',
      'coverage',
      'existingProjectTaskCount',
      'existingProjectTasksDetected',
      'executionAuthorized',
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
      'taskSourceType',
      'timestampsGenerated',
      'selectedTemplateName',
      'writeActionParity'
    ].sort());
    assertAdvisoryOnly(result);
  });
}

add('coverage gap codes exact and non-empty', () => assert.deepEqual(build(basePayload()).coverage.gapCodes, exactCoverageGaps));
add('output contains no created persisted deleted replaced or assignee-verified claims', () => {
  const text = JSON.stringify(build(basePayload({ existingTaskSnapshots: [{ project_id: 'PRJ-TASK-001' }], replacementIntent: 'PLAN_PROJECT_TASK_REPLACEMENT' })));
  assert.equal(/\"(created|persisted|deleted|replaced|assigneeVerified)\":true/.test(text), false);
});

add('planning action accepted', () => assertSuccessEnvelope(handle(request(basePayload()))));
add('legacy create action rejected', () => assert.equal(handle(request(basePayload(), { action: legacyAction })).error.code, 'ACTION_DENIED'));
add('wrong creation ID rejected', () => assert.equal(handle(request(basePayload(), { creationId: inferredCreationId })).error.code, 'CREATION_ID_DENIED'));
add('unknown action rejected', () => assert.equal(handle(request(basePayload(), { action: 'unknown' })).error.code, 'ACTION_DENIED'));
add('wildcard rejected', () => assert.equal(handle(request(basePayload(), { action: '*' })).error.code, 'ACTION_DENIED'));
add('cross-creation rejected', () => assert.equal(handle(request(basePayload(), { creationId: 'jenn.photo-studio.plugin-delivery-tasks' })).error.code, 'CREATION_ID_DENIED'));
add('payload action collision rejected', () => assert.equal(handle(request({ ...basePayload(), action: action })).error.code, 'PAYLOAD_ACTION_COLLISION'));
add('payload tool_name collision rejected', () => assert.equal(handle(request({ ...basePayload(), tool_name: action })).error.code, 'PAYLOAD_ACTION_COLLISION'));
add('prototype pollution rejected', () => assert.equal(handle(request(JSON.parse('{"projectSnapshot":{"project_id":"PRJ","project_type":"wedding"},"__proto__":{}}'))).error.code, 'PROTOTYPE_POLLUTION_KEY'));
add('excessive depth rejected', () => {
  let deep = {};
  let cursor = deep;
  for (let index = 0; index < 20; index += 1) cursor = cursor.next = {};
  assert.equal(handle(request(deep)).error.code, 'JSON_DEPTH_EXCEEDED');
});
add('exact success key set', () => assertSuccessEnvelope(handle(request(basePayload()))));
add('exact error key set', () => assertErrorEnvelope(handle(request(basePayload(), { action: 'bad' }))));
add('requestId preserved', () => assert.equal(handle(request(basePayload())).requestId, requestId));
add('creationId preserved', () => assert.equal(handle(request(basePayload())).creationId, canonicalCreationId));
add('parseLine requires newline', () => assert.equal(require(entrypointPath).parseLine(JSON.stringify(request(basePayload()))).response.error.code, 'INPUT_LINE_REQUIRED'));
add('parseLine rejects multiple lines', () => assert.equal(require(entrypointPath).parseLine('{}\n{}\n').response.error.code, 'INPUT_LINE_REQUIRED'));
add('parseLine accepts one JSON line', () => assert.equal(require(entrypointPath).parseLine(`${JSON.stringify(request(basePayload()))}\n`).ok, true));
add('no stack path details or raw input in error', () => {
  const response = handle(request({ projectSnapshot: { project_id: 'A:\\secret\\path', project_type: 'bad' } }));
  const text = JSON.stringify(response);
  assert.equal(/stack|details|rawInput|A:\\\\/.test(text), false);
});

add('runtime source contains no filesystem API', () => assert.equal(/require\(['"]fs|fs\.|readFile|writeFile|rm\(|rename\(/.test(sourceText(projectionPath) + sourceText(indexPath)), false));
add('runtime source contains no network API', () => assert.equal(/fetch\(|http\.|https\.|WebSocket|XMLHttpRequest/.test(sourceText(projectionPath) + sourceText(indexPath)), false));
add('runtime source contains no child process API', () => assert.equal(/child_process|spawn\(|execFile|exec\(/.test(sourceText(projectionPath) + sourceText(indexPath)), false));
add('runtime source contains no worker API', () => assert.equal(/worker_threads|new Worker/.test(sourceText(projectionPath) + sourceText(indexPath)), false));
add('runtime source contains no process.env', () => assert.equal(/process\.env/.test(sourceText(projectionPath) + sourceText(indexPath) + sourceText(entrypointPath)), false));
add('runtime source contains no current-time call', () => assert.equal(/Date\.now|new Date|nowIso|performance\.now/.test(sourceText(projectionPath) + sourceText(indexPath)), false));
add('runtime source contains no console logging', () => assert.equal(/console\./.test(sourceText(projectionPath) + sourceText(indexPath) + sourceText(entrypointPath)), false));
add('runtime source contains no persistent id generator', () => assert.equal(/generateRecordId|randomUUID|crypto\.randomUUID/.test(sourceText(projectionPath) + sourceText(indexPath)), false));
add('runtime source contains no collection read or write API', () => assert.equal(/readCollection|writeCollection|withStoreLock/.test(sourceText(projectionPath) + sourceText(indexPath)), false));
add('runtime source contains no notification or message dispatch API', () => assert.equal(/sendNotification\(|dispatchMessage\(|notificationSend\(/.test(sourceText(projectionPath) + sourceText(indexPath)), false));
add('metadata and runtime contain no absolute local path or real URL', () => assert.equal(/[A-Z]:\\|https?:\/\//.test(sourceText(projectionPath) + sourceText(indexPath) + sourceText(entrypointPath) + sourceText(packageManifestPath) + sourceText(profileManifestPath)), false));
add('metadata and runtime contain no secret-shaped value', () => assert.equal(/Bearer\s+[A-Za-z0-9]|sk-[A-Za-z0-9]|password\s*[:=]\s*['"][^'"]+/.test(sourceText(projectionPath) + sourceText(indexPath) + sourceText(entrypointPath) + sourceText(packageManifestPath) + sourceText(profileManifestPath)), false));
add('metadata contains no retirement deletion discard or full parity claim', () => {
  const text = sourceText(packageManifestPath) + sourceText(profileManifestPath);
  assert.equal(/USER_APPROVED_RETIREMENT|DISCARDED|"retirement"\s*:\s*true|fullParity"\s*:\s*true/.test(text), false);
});
add('source does not import legacy plugin service store or private data paths', () => assert.equal(/PhotoStudioProjectTasks|taskService|photo_studio_data|LocalState/.test(sourceText(projectionPath) + sourceText(indexPath) + sourceText(entrypointPath)), false));
add('profile does not make legacy write action runtime eligible', () => assert.equal(readJson(profileManifestPath).legacyOriginalActionRuntimeEligible, false));
add('source does not expose original create action as allowed runtime action', () => assert.equal(readJson(packageManifestPath).allowedActions.includes(legacyAction), false));
add('no active package-count assertion is introduced by focused test', () => assert.equal(/packageCount\s*[:=]/.test(sourceText(__filename)), false));
add('declared focused test coverage count is at least 175', () => assert.ok(declaredTestCount >= 175, `declared ${declaredTestCount}`));
