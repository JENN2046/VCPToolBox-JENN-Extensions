'use strict';

const ACTION = 'plan_followup_reminder_from_snapshot';
const CREATION_ID = 'jenn.photo-studio.plugin-followup-reminder';
const CONTRACT_VERSION = 2;
const PROJECTION_TYPE = 'followup_reminder_plan';
const SOURCE = 'caller_supplied_snapshot';
const LEGACY_REFERENCE_MODE = 'STATIC_ALGORITHM_MAPPING';
const WRITE_ACTION_PARITY = 'INTENTIONALLY_NOT_PRESERVED';
const RECOMMENDATION_TYPE = 'ADVISORY_ONLY';
const DEFAULT_REMINDER_STATUS = 'pending';
const PLAN_NEW = 'NEW_REMINDER_PLAN_RECOMMENDED';
const PLAN_DUPLICATE = 'EXISTING_PENDING_REMINDER';
const PLAN_INELIGIBLE = 'PROJECT_STATUS_INELIGIBLE';
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
const REMINDER_STATUSES = Object.freeze(['pending', 'completed', 'cancelled']);
const REMINDER_RULES = Object.freeze({
  quotation_followup: Object.freeze({
    allowedProjectStatuses: Object.freeze(['quoted']),
    projectDateField: 'start_date',
    projectDateSource: 'PROJECT_START_DATE',
    fallbackOffsetDays: 2,
    fallbackSource: 'REFERENCE_DATE_PLUS_2_DAYS'
  }),
  delivery_followup: Object.freeze({
    allowedProjectStatuses: Object.freeze(['delivered', 'completed']),
    projectDateField: 'due_date',
    projectDateSource: 'PROJECT_DUE_DATE',
    fallbackOffsetDays: 3,
    fallbackSource: 'REFERENCE_DATE_PLUS_3_DAYS'
  }),
  revisit: Object.freeze({
    allowedProjectStatuses: Object.freeze(['completed', 'archived']),
    projectDateField: 'due_date',
    projectDateSource: 'PROJECT_DUE_DATE_PLUS_30_DAYS',
    projectDateOffsetDays: 30,
    fallbackOffsetDays: 30,
    fallbackSource: 'REFERENCE_DATE_PLUS_30_DAYS'
  })
});
const ROOT_KEYS = Object.freeze([
  'projectSnapshot',
  'existingReminderSnapshots',
  'reminderType',
  'explicitDueDate',
  'referenceDate',
  'note'
]);
const PROJECT_KEYS = Object.freeze(['project_id', 'status', 'start_date', 'due_date']);
const REMINDER_KEYS = Object.freeze(['project_id', 'reminder_type', 'status']);
const GAP_CODES = Object.freeze([
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
  return { value, year, month, day };
}

function formatDate(parts) {
  const year = String(parts.year).padStart(4, '0');
  const month = String(parts.month).padStart(2, '0');
  const day = String(parts.day).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(dateValue, offsetDays) {
  const parts = { ...parseDate(dateValue, 'date') };
  for (let i = 0; i < offsetDays; i += 1) {
    parts.day += 1;
    if (parts.day > daysInMonth(parts.year, parts.month)) {
      parts.day = 1;
      parts.month += 1;
      if (parts.month > 12) {
        if (parts.year === 9999) {
          throw new RangeError('Date arithmetic exceeds the YYYY-MM-DD range.');
        }
        parts.month = 1;
        parts.year += 1;
      }
    }
  }
  return formatDate(parts);
}

function normalizeProjectSnapshot(projectSnapshot) {
  const project = requirePlain(projectSnapshot, 'projectSnapshot');
  assertAllowedKeys(project, PROJECT_KEYS, 'projectSnapshot');
  return Object.freeze({
    project_id: requiredString(project.project_id, 'projectSnapshot.project_id'),
    status: requireEnum(project.status, 'projectSnapshot.status', PROJECT_STATUSES),
    start_date: parseDate(project.start_date, 'projectSnapshot.start_date')?.value || null,
    due_date: parseDate(project.due_date, 'projectSnapshot.due_date')?.value || null
  });
}

function normalizeReminderSnapshots(value) {
  if (value == null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('existingReminderSnapshots must be an array.');
  return Object.freeze(value.map((item, index) => {
    const reminder = requirePlain(item, `existingReminderSnapshots[${index}]`);
    assertAllowedKeys(reminder, REMINDER_KEYS, `existingReminderSnapshots[${index}]`);
    return Object.freeze({
      project_id: requiredString(reminder.project_id, `existingReminderSnapshots[${index}].project_id`),
      reminder_type: requireEnum(reminder.reminder_type, `existingReminderSnapshots[${index}].reminder_type`, Object.keys(REMINDER_RULES)),
      status: requireEnum(reminder.status, `existingReminderSnapshots[${index}].status`, REMINDER_STATUSES)
    });
  }));
}

function selectDueDate({ explicitDueDate, project, rule, reminderType, referenceDate }) {
  if (explicitDueDate) return { value: explicitDueDate, source: 'EXPLICIT_INPUT' };
  const projectDate = project[rule.projectDateField];
  if (projectDate && reminderType === 'revisit') {
    return { value: addDays(projectDate, rule.projectDateOffsetDays), source: rule.projectDateSource };
  }
  if (projectDate) return { value: projectDate, source: rule.projectDateSource };
  return { value: addDays(referenceDate, rule.fallbackOffsetDays), source: rule.fallbackSource };
}

function baseResult({ project, reminderType, rule, duplicateOpenReminderDetected, referenceDate, note }) {
  return {
    contractVersion: CONTRACT_VERSION,
    projectionType: PROJECTION_TYPE,
    source: SOURCE,
    parityStatus: 'partial',
    fullParity: false,
    legacyReferenceMode: LEGACY_REFERENCE_MODE,
    writeActionParity: WRITE_ACTION_PARITY,
    projectId: project.project_id,
    projectStatus: project.status,
    reminderType,
    projectStatusEligible: rule.allowedProjectStatuses.includes(project.status),
    allowedProjectStatuses: Array.from(rule.allowedProjectStatuses),
    duplicateOpenReminderDetected,
    newReminderPlanRecommended: false,
    recommendedDueDate: null,
    dueDateSource: 'NOT_APPLICABLE',
    referenceDate,
    note,
    proposedReminderStatus: null,
    planStatus: PLAN_INELIGIBLE,
    reasonCode: 'PROJECT_STATUS_NOT_ELIGIBLE',
    recommendationType: RECOMMENDATION_TYPE,
    executionAuthorized: false,
    stateMutationAuthorized: false,
    persistentRecordAuthorized: false,
    businessWriteAuthorized: false,
    reminderIdGenerated: false,
    timestampGenerated: false,
    notificationAuthorized: false,
    requiresHumanReview: true,
    coverage: {
      gapCodes: Array.from(GAP_CODES)
    }
  };
}

function planFollowupReminderFromSnapshot(input) {
  const payload = requirePlain(input, 'input');
  assertAllowedKeys(payload, ROOT_KEYS, 'input');

  const project = normalizeProjectSnapshot(payload.projectSnapshot);
  const reminderType = requireEnum(payload.reminderType, 'reminderType', Object.keys(REMINDER_RULES));
  const rule = REMINDER_RULES[reminderType];
  const referenceDate = parseDate(payload.referenceDate, 'referenceDate');
  if (!referenceDate) throw new TypeError('referenceDate is required.');
  const explicitDueDate = parseDate(payload.explicitDueDate, 'explicitDueDate')?.value || null;
  const note = cleanString(payload.note, 'note', 500);
  const existingReminderSnapshots = normalizeReminderSnapshots(payload.existingReminderSnapshots);
  const duplicateOpenReminderDetected = existingReminderSnapshots.some((reminder) =>
    reminder.project_id === project.project_id
    && reminder.reminder_type === reminderType
    && reminder.status === DEFAULT_REMINDER_STATUS
  );
  const result = baseResult({ project, reminderType, rule, duplicateOpenReminderDetected, referenceDate: referenceDate.value, note });

  if (!result.projectStatusEligible) return result;

  if (duplicateOpenReminderDetected) {
    return {
      ...result,
      planStatus: PLAN_DUPLICATE,
      reasonCode: 'OPEN_PENDING_REMINDER_ALREADY_EXISTS'
    };
  }

  const dueDate = selectDueDate({
    explicitDueDate,
    project,
    rule,
    reminderType,
    referenceDate: referenceDate.value
  });
  return {
    ...result,
    newReminderPlanRecommended: true,
    recommendedDueDate: dueDate.value,
    dueDateSource: dueDate.source,
    proposedReminderStatus: DEFAULT_REMINDER_STATUS,
    planStatus: PLAN_NEW,
    reasonCode: 'NEW_REMINDER_PLAN_AVAILABLE'
  };
}

module.exports = {
  ACTION,
  CREATION_ID,
  GAP_CODES,
  PLAN_DUPLICATE,
  PLAN_INELIGIBLE,
  PLAN_NEW,
  PROJECT_STATUSES,
  REMINDER_RULES,
  planFollowupReminderFromSnapshot
};
