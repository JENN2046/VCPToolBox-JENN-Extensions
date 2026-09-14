'use strict';

const ACTION = 'plan_delivery_tasks_from_snapshot';
const CREATION_ID = 'jenn.photo-studio.plugin-delivery-tasks';
const CONTRACT_VERSION = 2;
const PROJECTION_TYPE = 'delivery_task_plan';
const SOURCE = 'caller_supplied_snapshot';
const LEGACY_REFERENCE_MODE = 'STATIC_ALGORITHM_MAPPING';
const WRITE_ACTION_PARITY = 'INTENTIONALLY_NOT_PRESERVED';
const RECOMMENDATION_TYPE = 'ADVISORY_ONLY';
const DEFAULT_DELIVERY_MODE = 'digital delivery';
const DELIVERY_TASK_GROUP = 'delivery_stage';
const LEGACY_GENERATED_BY = 'create_delivery_tasks';
const PLAN_NEW = 'NEW_DELIVERY_TASK_PLAN_RECOMMENDED';
const PLAN_KEEP = 'EXISTING_DELIVERY_TASKS_PRESENT';
const PLAN_REPLACEMENT_GATE = 'REPLACEMENT_PLAN_REQUIRES_WRITE_GATE';
const PLAN_INELIGIBLE = 'PROJECT_STATUS_INELIGIBLE';
const PROJECT_TYPES = Object.freeze(['wedding', 'portrait', 'commercial', 'event', 'other']);
const PROJECT_STATUSES = Object.freeze([
  'inquiry',
  'quoted',
  'confirmed',
  'preparing',
  'shooting',
  'editing',
  'reviewing',
  'delivered',
  'completed',
  'archived',
  'cancelled'
]);
const ALLOWED_PROJECT_STATUSES = Object.freeze(['reviewing', 'delivered', 'completed']);
const REPLACEMENT_INTENTS = Object.freeze(['KEEP_EXISTING', 'PLAN_MANAGED_REPLACEMENT']);
const ROOT_KEYS = Object.freeze([
  'projectSnapshot',
  'existingTaskSnapshots',
  'deliveryMode',
  'deliveryDeadline',
  'replacementIntent'
]);
const PROJECT_KEYS = Object.freeze(['project_id', 'project_type', 'status', 'due_date']);
const TASK_KEYS = Object.freeze(['project_id', 'task_group', 'generated_by']);
const GAP_CODES = Object.freeze([
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
const DELIVERY_TASK_TEMPLATES = Object.freeze({
  wedding: Object.freeze([
    Object.freeze({ task_name: 'Finalize wedding gallery for delivery', task_type: 'review', sort_order: 1 }),
    Object.freeze({ task_name: 'Prepare wedding delivery package', task_type: 'delivery', sort_order: 2 }),
    Object.freeze({ task_name: 'Send wedding gallery handoff', task_type: 'communication', sort_order: 3 }),
    Object.freeze({ task_name: 'Confirm wedding delivery receipt', task_type: 'communication', sort_order: 4 })
  ]),
  portrait: Object.freeze([
    Object.freeze({ task_name: 'Finalize portrait selects for delivery', task_type: 'review', sort_order: 1 }),
    Object.freeze({ task_name: 'Prepare portrait delivery package', task_type: 'delivery', sort_order: 2 }),
    Object.freeze({ task_name: 'Send portrait handoff details', task_type: 'communication', sort_order: 3 }),
    Object.freeze({ task_name: 'Confirm portrait delivery receipt', task_type: 'communication', sort_order: 4 })
  ]),
  commercial: Object.freeze([
    Object.freeze({ task_name: 'Finalize approved commercial assets', task_type: 'review', sort_order: 1 }),
    Object.freeze({ task_name: 'Prepare commercial delivery package', task_type: 'delivery', sort_order: 2 }),
    Object.freeze({ task_name: 'Share asset handoff instructions', task_type: 'communication', sort_order: 3 }),
    Object.freeze({ task_name: 'Confirm commercial asset receipt', task_type: 'communication', sort_order: 4 })
  ]),
  event: Object.freeze([
    Object.freeze({ task_name: 'Finalize event gallery for delivery', task_type: 'review', sort_order: 1 }),
    Object.freeze({ task_name: 'Prepare event delivery package', task_type: 'delivery', sort_order: 2 }),
    Object.freeze({ task_name: 'Send event gallery handoff', task_type: 'communication', sort_order: 3 }),
    Object.freeze({ task_name: 'Confirm event delivery receipt', task_type: 'communication', sort_order: 4 })
  ]),
  other: Object.freeze([
    Object.freeze({ task_name: 'Finalize selected assets for delivery', task_type: 'review', sort_order: 1 }),
    Object.freeze({ task_name: 'Prepare final delivery package', task_type: 'delivery', sort_order: 2 }),
    Object.freeze({ task_name: 'Send delivery handoff details', task_type: 'communication', sort_order: 3 }),
    Object.freeze({ task_name: 'Confirm final delivery receipt', task_type: 'communication', sort_order: 4 })
  ])
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function requirePlain(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain snapshot object.`);
  return value;
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label}.${key} is not part of the contract.`);
  }
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function cleanString(value, label, maxBytes, { required = false, allowNull = true } = {}) {
  if (value == null && allowNull && !required) return null;
  if (typeof value !== 'string') throw new TypeError(`${label} must be a string.`);
  if (/[\r\n\0]/.test(value)) throw new TypeError(`${label} cannot contain CR, LF, or NUL.`);
  const trimmed = value.trim();
  if (!trimmed) {
    if (required) throw new TypeError(`${label} is required.`);
    return null;
  }
  if (byteLength(trimmed) > maxBytes) throw new TypeError(`${label} exceeds the byte limit.`);
  return trimmed;
}

function requiredString(value, label, maxBytes = 120) {
  return cleanString(value, label, maxBytes, { required: true });
}

function requireEnum(value, label, allowedValues) {
  if (!allowedValues.includes(value)) {
    throw new TypeError(`${label} must be one of ${allowedValues.join(', ')}.`);
  }
  return value;
}

function isLeapYear(year) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function parseDate(value, label) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError(`${label} must use YYYY-MM-DD.`);
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    throw new TypeError(`${label} must be a valid calendar date.`);
  }
  return value;
}

function normalizeProjectSnapshot(projectSnapshot) {
  const project = requirePlain(projectSnapshot, 'projectSnapshot');
  assertAllowedKeys(project, PROJECT_KEYS, 'projectSnapshot');
  return Object.freeze({
    project_id: requiredString(project.project_id, 'projectSnapshot.project_id'),
    project_type: requireEnum(project.project_type, 'projectSnapshot.project_type', PROJECT_TYPES),
    status: requireEnum(project.status, 'projectSnapshot.status', PROJECT_STATUSES),
    due_date: parseDate(project.due_date, 'projectSnapshot.due_date')
  });
}

function normalizeTaskSnapshots(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('existingTaskSnapshots must be an array.');
  return Object.freeze(value.map((item, index) => {
    const task = requirePlain(item, `existingTaskSnapshots[${index}]`);
    assertAllowedKeys(task, TASK_KEYS, `existingTaskSnapshots[${index}]`);
    return Object.freeze({
      project_id: requiredString(task.project_id, `existingTaskSnapshots[${index}].project_id`),
      task_group: requiredString(task.task_group, `existingTaskSnapshots[${index}].task_group`),
      generated_by: requiredString(task.generated_by, `existingTaskSnapshots[${index}].generated_by`)
    });
  }));
}

function managedTaskMatches(task, projectId) {
  return task.project_id === projectId
    && task.task_group === DELIVERY_TASK_GROUP
    && task.generated_by === LEGACY_GENERATED_BY;
}

function selectDeadline({ explicitDeadline, project }) {
  if (explicitDeadline) return { value: explicitDeadline, source: 'EXPLICIT_INPUT' };
  if (project.due_date) return { value: project.due_date, source: 'PROJECT_DUE_DATE' };
  return { value: null, source: 'NOT_PROVIDED' };
}

function buildTaskRemark(deliveryMode) {
  return `Delivery mode: ${deliveryMode}`;
}

function buildPlannedTaskDrafts({ project, deliveryMode, deliveryDeadline }) {
  return DELIVERY_TASK_TEMPLATES[project.project_type].map((draftTask) => ({
    taskName: draftTask.task_name,
    taskType: draftTask.task_type,
    sortOrder: draftTask.sort_order,
    dueDate: deliveryDeadline,
    deliveryMode,
    remark: buildTaskRemark(deliveryMode),
    taskDraftType: 'ADVISORY_TASK_DRAFT',
    executionAuthorized: false,
    stateMutationAuthorized: false,
    persistentRecordAuthorized: false,
    messageDispatchAuthorized: false
  }));
}

function baseResult({ project, deliveryMode, deliveryModeSource, deliveryDeadline, deliveryDeadlineSource, replacementIntent, existingManagedCount }) {
  const projectStatusEligible = ALLOWED_PROJECT_STATUSES.includes(project.status);
  return {
    contractVersion: CONTRACT_VERSION,
    projectionType: PROJECTION_TYPE,
    source: SOURCE,
    parityStatus: 'partial',
    fullParity: false,
    legacyReferenceMode: LEGACY_REFERENCE_MODE,
    writeActionParity: WRITE_ACTION_PARITY,
    recommendationType: RECOMMENDATION_TYPE,
    projectId: project.project_id,
    projectType: project.project_type,
    projectStatus: project.status,
    allowedProjectStatuses: Array.from(ALLOWED_PROJECT_STATUSES),
    projectStatusEligible,
    deliveryMode,
    deliveryModeSource,
    deliveryDeadline,
    deliveryDeadlineSource,
    replacementIntent,
    existingManagedTaskCount: existingManagedCount,
    existingManagedTasksDetected: existingManagedCount > 0,
    replacementPlanRequested: replacementIntent === 'PLAN_MANAGED_REPLACEMENT',
    replacementRequiresWriteGate: false,
    plannedTaskSetAvailable: false,
    newTaskPlanRecommended: false,
    plannedTaskCount: 0,
    plannedTasks: [],
    planStatus: projectStatusEligible ? PLAN_KEEP : PLAN_INELIGIBLE,
    reasonCode: projectStatusEligible ? 'EXISTING_MANAGED_DELIVERY_TASKS' : 'PROJECT_STATUS_NOT_ELIGIBLE',
    executionAuthorized: false,
    stateMutationAuthorized: false,
    persistentRecordAuthorized: false,
    taskIdsGenerated: false,
    timestampsGenerated: false,
    messageDispatchAuthorized: false,
    notificationAuthorized: false,
    requiresHumanReview: true,
    coverage: {
      gapCodes: Array.from(GAP_CODES)
    }
  };
}

function planDeliveryTasksFromSnapshot(input) {
  const payload = requirePlain(input, 'input');
  assertAllowedKeys(payload, ROOT_KEYS, 'input');

  const project = normalizeProjectSnapshot(payload.projectSnapshot);
  const existingTaskSnapshots = normalizeTaskSnapshots(payload.existingTaskSnapshots);
  const deliveryMode = cleanString(payload.deliveryMode, 'deliveryMode', 120) || DEFAULT_DELIVERY_MODE;
  const deliveryModeSource = cleanString(payload.deliveryMode, 'deliveryMode', 120) ? 'EXPLICIT_INPUT' : 'DEFAULT_DIGITAL_DELIVERY';
  const explicitDeadline = parseDate(payload.deliveryDeadline, 'deliveryDeadline');
  const deadline = selectDeadline({ explicitDeadline, project });
  const replacementIntent = payload.replacementIntent == null
    ? 'KEEP_EXISTING'
    : requireEnum(payload.replacementIntent, 'replacementIntent', REPLACEMENT_INTENTS);
  const existingManagedCount = existingTaskSnapshots.filter((task) => managedTaskMatches(task, project.project_id)).length;
  const result = baseResult({
    project,
    deliveryMode,
    deliveryModeSource,
    deliveryDeadline: deadline.value,
    deliveryDeadlineSource: deadline.source,
    replacementIntent,
    existingManagedCount
  });

  if (!result.projectStatusEligible) return result;

  if (existingManagedCount > 0 && replacementIntent === 'KEEP_EXISTING') {
    return {
      ...result,
      planStatus: PLAN_KEEP,
      reasonCode: 'EXISTING_MANAGED_DELIVERY_TASKS'
    };
  }

  const plannedTaskDrafts = buildPlannedTaskDrafts({
    project,
    deliveryMode,
    deliveryDeadline: deadline.value
  });

  return {
    ...result,
    plannedTaskSetAvailable: true,
    newTaskPlanRecommended: existingManagedCount === 0,
    plannedTasks: plannedTaskDrafts,
    plannedTaskCount: plannedTaskDrafts.length,
    replacementRequiresWriteGate: existingManagedCount > 0,
    planStatus: existingManagedCount > 0 ? PLAN_REPLACEMENT_GATE : PLAN_NEW,
    reasonCode: existingManagedCount > 0 ? 'MANAGED_REPLACEMENT_REQUIRES_WRITE_GATE' : 'NEW_DELIVERY_TASK_PLAN_AVAILABLE'
  };
}

module.exports = {
  ACTION,
  ALLOWED_PROJECT_STATUSES,
  CREATION_ID,
  DEFAULT_DELIVERY_MODE,
  DELIVERY_TASK_GROUP,
  DELIVERY_TASK_TEMPLATES,
  GAP_CODES,
  LEGACY_GENERATED_BY,
  PLAN_INELIGIBLE,
  PLAN_KEEP,
  PLAN_NEW,
  PLAN_REPLACEMENT_GATE,
  PROJECT_STATUSES,
  PROJECT_TYPES,
  REPLACEMENT_INTENTS,
  planDeliveryTasksFromSnapshot
};
