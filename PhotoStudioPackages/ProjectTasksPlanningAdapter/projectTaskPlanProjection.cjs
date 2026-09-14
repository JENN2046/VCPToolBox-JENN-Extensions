'use strict';

const ACTION = 'plan_project_tasks_from_snapshot';
const CREATION_ID = 'jenn.photo-studio.plugin-project-tasks';
const CONTRACT_VERSION = 1;
const PROJECTION_TYPE = 'project_task_plan';
const SOURCE = 'caller_supplied_snapshot';
const LEGACY_REFERENCE_MODE = 'STATIC_ALGORITHM_MAPPING';
const WRITE_ACTION_PARITY = 'INTENTIONALLY_NOT_PRESERVED';
const RECOMMENDATION_TYPE = 'ADVISORY_ONLY';
const TASK_DRAFT_TYPE = 'ADVISORY_TASK_DRAFT';
const PLAN_NEW = 'NEW_PROJECT_TASK_PLAN_RECOMMENDED';
const PLAN_KEEP = 'EXISTING_PROJECT_TASKS_PRESENT';
const PLAN_REPLACEMENT_GATE = 'REPLACEMENT_PLAN_REQUIRES_WRITE_GATE';
const REASON_NEW = 'NEW_PROJECT_TASK_PLAN_AVAILABLE';
const REASON_KEEP = 'EXISTING_PROJECT_TASKS';
const REASON_REPLACEMENT = 'PROJECT_TASK_REPLACEMENT_REQUIRES_WRITE_GATE';
const SOURCE_DEFAULT = 'DEFAULT_PROJECT_TYPE_TEMPLATE';
const SOURCE_EXPLICIT = 'EXPLICIT_TEMPLATE';
const SOURCE_CUSTOM = 'CUSTOM_TASK_DRAFTS';

const PROJECT_TYPES = Object.freeze(['wedding', 'portrait', 'commercial', 'event', 'other']);
const TASK_TYPES = Object.freeze(['shooting', 'editing', 'delivery', 'review', 'communication', 'other']);
const TASK_TEMPLATE_NAMES = Object.freeze(['wedding_standard', 'portrait_basic', 'commercial_standard', 'event_basic']);
const REPLACEMENT_INTENTS = Object.freeze(['KEEP_EXISTING', 'PLAN_PROJECT_TASK_REPLACEMENT']);
const ROOT_KEYS = Object.freeze(['projectSnapshot', 'existingTaskSnapshots', 'taskTemplate', 'customTaskDrafts', 'replacementIntent']);
const PROJECT_KEYS = Object.freeze(['project_id', 'project_type', 'due_date']);
const EXISTING_TASK_KEYS = Object.freeze(['project_id']);
const CUSTOM_TASK_KEYS = Object.freeze(['taskName', 'taskType', 'sortOrder', 'dueDate', 'assignee', 'remark']);
const GAP_CODES = Object.freeze([
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

const TASK_TEMPLATES = Object.freeze({
  wedding_standard: Object.freeze([
    Object.freeze({ taskName: 'Confirm wedding timeline', taskType: 'communication', sortOrder: 1 }),
    Object.freeze({ taskName: 'Prepare shot list', taskType: 'shooting', sortOrder: 2 }),
    Object.freeze({ taskName: 'Execute wedding shoot', taskType: 'shooting', sortOrder: 3 }),
    Object.freeze({ taskName: 'Select hero frames', taskType: 'review', sortOrder: 4 }),
    Object.freeze({ taskName: 'Edit final gallery', taskType: 'editing', sortOrder: 5 }),
    Object.freeze({ taskName: 'Deliver wedding package', taskType: 'delivery', sortOrder: 6 })
  ]),
  portrait_basic: Object.freeze([
    Object.freeze({ taskName: 'Confirm portrait brief', taskType: 'communication', sortOrder: 1 }),
    Object.freeze({ taskName: 'Prepare styling notes', taskType: 'other', sortOrder: 2 }),
    Object.freeze({ taskName: 'Run portrait session', taskType: 'shooting', sortOrder: 3 }),
    Object.freeze({ taskName: 'Edit selects', taskType: 'editing', sortOrder: 4 }),
    Object.freeze({ taskName: 'Deliver portrait set', taskType: 'delivery', sortOrder: 5 })
  ]),
  commercial_standard: Object.freeze([
    Object.freeze({ taskName: 'Confirm commercial scope', taskType: 'communication', sortOrder: 1 }),
    Object.freeze({ taskName: 'Build production checklist', taskType: 'other', sortOrder: 2 }),
    Object.freeze({ taskName: 'Execute production shoot', taskType: 'shooting', sortOrder: 3 }),
    Object.freeze({ taskName: 'Review internal selects', taskType: 'review', sortOrder: 4 }),
    Object.freeze({ taskName: 'Edit approved assets', taskType: 'editing', sortOrder: 5 }),
    Object.freeze({ taskName: 'Deliver commercial assets', taskType: 'delivery', sortOrder: 6 })
  ]),
  event_basic: Object.freeze([
    Object.freeze({ taskName: 'Confirm event rundown', taskType: 'communication', sortOrder: 1 }),
    Object.freeze({ taskName: 'Capture event coverage', taskType: 'shooting', sortOrder: 2 }),
    Object.freeze({ taskName: 'Edit highlight set', taskType: 'editing', sortOrder: 3 }),
    Object.freeze({ taskName: 'Deliver event gallery', taskType: 'delivery', sortOrder: 4 })
  ])
});
const DEFAULT_TEMPLATE_BY_PROJECT_TYPE = Object.freeze({
  wedding: 'wedding_standard',
  portrait: 'portrait_basic',
  commercial: 'commercial_standard',
  event: 'event_basic',
  other: 'portrait_basic'
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function requirePlain(value, label) {
  if (!isPlainObject(value)) throw new TypeError(`${label} must be a plain object.`);
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

function requiredString(value, label, maxBytes = 200) {
  return cleanString(value, label, maxBytes, { required: true });
}

function requireEnum(value, label, allowedValues) {
  if (!allowedValues.includes(value)) throw new TypeError(`${label} must be one of ${allowedValues.join(', ')}.`);
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

function normalizeProjectSnapshot(value) {
  const project = requirePlain(value, 'projectSnapshot');
  assertAllowedKeys(project, PROJECT_KEYS, 'projectSnapshot');
  return Object.freeze({
    project_id: requiredString(project.project_id, 'projectSnapshot.project_id'),
    project_type: requireEnum(project.project_type, 'projectSnapshot.project_type', PROJECT_TYPES),
    due_date: parseDate(project.due_date, 'projectSnapshot.due_date')
  });
}

function normalizeExistingTasks(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('existingTaskSnapshots must be an array.');
  if (value.length > 500) throw new TypeError('existingTaskSnapshots exceeds the maximum length.');
  return Object.freeze(value.map((item, index) => {
    const task = requirePlain(item, `existingTaskSnapshots[${index}]`);
    assertAllowedKeys(task, EXISTING_TASK_KEYS, `existingTaskSnapshots[${index}]`);
    return Object.freeze({
      project_id: requiredString(task.project_id, `existingTaskSnapshots[${index}].project_id`)
    });
  }));
}

function normalizeTemplate(value) {
  if (value == null) return null;
  const template = cleanString(value, 'taskTemplate', 80, { required: true });
  return requireEnum(template, 'taskTemplate', TASK_TEMPLATE_NAMES);
}

function normalizeReplacementIntent(value) {
  if (value == null) return 'KEEP_EXISTING';
  if (typeof value !== 'string') throw new TypeError('replacementIntent must be a string.');
  return requireEnum(value, 'replacementIntent', REPLACEMENT_INTENTS);
}

function normalizeSortOrder(value, label, fallback) {
  if (value == null) return fallback;
  if (!Number.isInteger(value)) throw new TypeError(`${label} must be an integer.`);
  if (value < 1 || value > 10000) throw new TypeError(`${label} is outside the allowed range.`);
  return value;
}

function normalizeCustomTasks(value, projectDueDate) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('customTaskDrafts must be an array.');
  if (value.length > 50) throw new TypeError('customTaskDrafts exceeds the maximum length.');
  return Object.freeze(value.map((item, index) => {
    const task = requirePlain(item, `customTaskDrafts[${index}]`);
    assertAllowedKeys(task, CUSTOM_TASK_KEYS, `customTaskDrafts[${index}]`);
    const explicitDueDate = parseDate(task.dueDate, `customTaskDrafts[${index}].dueDate`);
    const dueDate = explicitDueDate || projectDueDate || null;
    const dueDateSource = explicitDueDate ? 'CUSTOM_TASK_DUE_DATE' : projectDueDate ? 'PROJECT_DUE_DATE' : 'NOT_PROVIDED';
    return Object.freeze({
      taskName: requiredString(task.taskName, `customTaskDrafts[${index}].taskName`, 200),
      taskType: requireEnum(task.taskType, `customTaskDrafts[${index}].taskType`, TASK_TYPES),
      sortOrder: normalizeSortOrder(task.sortOrder, `customTaskDrafts[${index}].sortOrder`, index + 1),
      dueDate,
      dueDateSource,
      assignee: cleanString(task.assignee, `customTaskDrafts[${index}].assignee`, 120),
      remark: cleanString(task.remark, `customTaskDrafts[${index}].remark`, 500)
    });
  }));
}

function taskSafetyFields() {
  return {
    taskDraftType: TASK_DRAFT_TYPE,
    executionAuthorized: false,
    stateMutationAuthorized: false,
    persistentRecordAuthorized: false,
    messageDispatchAuthorized: false
  };
}

function buildTemplateTasks(templateName, projectDueDate) {
  const dueDate = projectDueDate || null;
  const dueDateSource = projectDueDate ? 'PROJECT_DUE_DATE' : 'NOT_PROVIDED';
  return TASK_TEMPLATES[templateName].map((task) => ({
    taskName: task.taskName,
    taskType: task.taskType,
    sortOrder: task.sortOrder,
    dueDate,
    dueDateSource,
    assignee: null,
    remark: null,
    ...taskSafetyFields()
  }));
}

function buildCustomTasks(customTasks) {
  return customTasks.map((task) => ({
    taskName: task.taskName,
    taskType: task.taskType,
    sortOrder: task.sortOrder,
    dueDate: task.dueDate,
    dueDateSource: task.dueDateSource,
    assignee: task.assignee,
    remark: task.remark,
    ...taskSafetyFields()
  }));
}

function resolveTaskSource({ project, taskTemplate, customTasks }) {
  if (customTasks.length > 0) return { taskSourceType: SOURCE_CUSTOM, selectedTemplateName: null };
  if (taskTemplate) return { taskSourceType: SOURCE_EXPLICIT, selectedTemplateName: taskTemplate };
  return { taskSourceType: SOURCE_DEFAULT, selectedTemplateName: DEFAULT_TEMPLATE_BY_PROJECT_TYPE[project.project_type] };
}

function buildResolvedTasks(taskSourceType, selectedTemplateName, customTasks, projectDueDate) {
  if (taskSourceType === SOURCE_CUSTOM) return buildCustomTasks(customTasks);
  return buildTemplateTasks(selectedTemplateName, projectDueDate);
}

function planProjectTasksFromSnapshot(input) {
  const root = requirePlain(input, 'input');
  assertAllowedKeys(root, ROOT_KEYS, 'input');
  const project = normalizeProjectSnapshot(root.projectSnapshot);
  const existingTasks = normalizeExistingTasks(root.existingTaskSnapshots);
  const taskTemplate = normalizeTemplate(root.taskTemplate);
  const replacementIntent = normalizeReplacementIntent(root.replacementIntent);
  const customTasks = normalizeCustomTasks(root.customTaskDrafts, project.due_date);

  if (taskTemplate && customTasks.length > 0) {
    throw new TypeError('taskTemplate and non-empty customTaskDrafts cannot be used together.');
  }

  const source = resolveTaskSource({ project, taskTemplate, customTasks });
  const resolvedTasks = buildResolvedTasks(source.taskSourceType, source.selectedTemplateName, customTasks, project.due_date);
  const existingProjectTaskCount = existingTasks.filter((task) => task.project_id === project.project_id).length;
  const existingProjectTasksDetected = existingProjectTaskCount > 0;

  let planStatus = PLAN_NEW;
  let reasonCode = REASON_NEW;
  let plannedTasks = resolvedTasks;
  let plannedTaskSetAvailable = true;
  let newTaskPlanRecommended = true;
  let replacementPlanRequested = false;
  let replacementRequiresWriteGate = false;

  if (existingProjectTasksDetected && replacementIntent === 'KEEP_EXISTING') {
    planStatus = PLAN_KEEP;
    reasonCode = REASON_KEEP;
    plannedTasks = [];
    plannedTaskSetAvailable = false;
    newTaskPlanRecommended = false;
  } else if (existingProjectTasksDetected && replacementIntent === 'PLAN_PROJECT_TASK_REPLACEMENT') {
    planStatus = PLAN_REPLACEMENT_GATE;
    reasonCode = REASON_REPLACEMENT;
    replacementPlanRequested = true;
    replacementRequiresWriteGate = true;
    newTaskPlanRecommended = false;
  }

  return {
    contractVersion: CONTRACT_VERSION,
    projectionType: PROJECTION_TYPE,
    source: SOURCE,
    parityStatus: 'partial',
    fullParity: false,
    legacyReferenceMode: LEGACY_REFERENCE_MODE,
    writeActionParity: WRITE_ACTION_PARITY,
    projectId: project.project_id,
    projectType: project.project_type,
    taskSourceType: source.taskSourceType,
    selectedTemplateName: source.selectedTemplateName,
    existingProjectTaskCount,
    existingProjectTasksDetected,
    replacementIntent,
    replacementPlanRequested,
    replacementRequiresWriteGate,
    plannedTaskSetAvailable,
    newTaskPlanRecommended,
    plannedTaskCount: plannedTasks.length,
    plannedTasks,
    planStatus,
    reasonCode,
    recommendationType: RECOMMENDATION_TYPE,
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

module.exports = {
  ACTION,
  CREATION_ID,
  TASK_TEMPLATES,
  DEFAULT_TEMPLATE_BY_PROJECT_TYPE,
  GAP_CODES,
  planProjectTasksFromSnapshot
};
