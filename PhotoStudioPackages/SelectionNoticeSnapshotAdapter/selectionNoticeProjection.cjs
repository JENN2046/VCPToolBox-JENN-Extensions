'use strict';

const { buildSelectionNotice } = require('./selectionNoticeTemplate.cjs');

const ACTION = 'build_selection_notice_from_snapshot';
const CREATION_ID = 'jenn.photo-studio.plugin-selection-notice';
const CONTRACT_VERSION = 3;
const COPY_VERSION = 2;
const SOURCE = 'caller_supplied_snapshot';
const PROJECTION_TYPE = 'selection_notice_draft';
const LEGACY_TEMPLATE_PARITY_STATUS = 'INTENTIONALLY_DIVERGED_BY_JENN_COPY_REVISION';
const CUSTOMER_NAME_FALLBACK = '[Client Name]';
const ALLOWED_STATUSES = Object.freeze(['editing', 'reviewing']);
const TONES = Object.freeze(['formal', 'friendly', 'warm']);
const ROOT_KEYS = Object.freeze([
  'projectSnapshot',
  'customerSnapshot',
  'tone',
  'selectionDeadline',
  'selectionMethod',
  'noteToClient',
  'generatedAt'
]);
const PROJECT_KEYS = Object.freeze(['project_id', 'customer_id', 'project_name', 'status', 'due_date']);
const CUSTOMER_KEYS = Object.freeze(['customer_id', 'customer_name']);
const GAP_CODES = Object.freeze([
  'LOCAL_PROJECT_LOOKUP_NOT_PERFORMED',
  'LOCAL_CUSTOMER_LOOKUP_NOT_PERFORMED',
  'STORE_LOCK_BEHAVIOR_NOT_REPRODUCED',
  'REAL_PROJECT_STATUS_NOT_VERIFIED',
  'REAL_SELECTION_GALLERY_NOT_VERIFIED',
  'REAL_SELECTION_LINK_NOT_VERIFIED',
  'NOTIFICATION_NOT_SENT',
  'MESSAGE_NOT_DISPATCHED',
  'CURRENT_TIME_FALLBACK_REMOVED',
  'LEGACY_TEMPLATE_COPY_INTENTIONALLY_REVISED'
]);
const TERMINAL_PUNCTUATION = /[.!?。！？]$/u;

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

function optionalId(value, label) {
  return cleanString(value, label, 120, { required: false });
}

function requiredString(value, label, maxBytes) {
  return cleanString(value, label, maxBytes, { required: true });
}

function terminateSentence(value) {
  if (value == null) return null;
  return TERMINAL_PUNCTUATION.test(value) ? value : `${value}.`;
}

function hasValidCalendarDate(value) {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  // Keep the existing four-digit year range, including ISO year 0000.
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1];
}

function validateGeneratedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    || !hasValidCalendarDate(value) || Number(value.slice(11, 13)) > 23
    || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) {
    throw new TypeError('generatedAt must be an explicit UTC ISO timestamp.');
  }
  return value;
}

function validateDate(value, label) {
  if (value == null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !hasValidCalendarDate(value)) {
    throw new TypeError(`${label} must use YYYY-MM-DD.`);
  }
  return value;
}

function validateTone(value) {
  if (!TONES.includes(value)) throw new TypeError('tone must be one of formal, friendly, or warm.');
  return value;
}

function validateStatus(value) {
  if (!ALLOWED_STATUSES.includes(value)) throw new TypeError('projectSnapshot.status must be editing or reviewing.');
  return value;
}

function selectDeadline({ explicit, dueDate, warnings }) {
  const selectionDeadline = explicit || dueDate || null;
  if (explicit) return { value: selectionDeadline, source: 'EXPLICIT_INPUT' };
  if (dueDate) return { value: selectionDeadline, source: 'PROJECT_DUE_DATE' };
  warnings.push('SELECTION_DEADLINE_NOT_PROVIDED');
  return { value: null, source: 'NOT_PROVIDED' };
}

function selectMethod({ explicit, warnings }) {
  if (explicit) return { value: terminateSentence(explicit), source: 'EXPLICIT_INPUT' };
  warnings.push('SELECTION_METHOD_NOT_PROVIDED');
  return { value: null, source: 'NOT_PROVIDED' };
}

function cleanSelectionMethod(value) {
  if (value == null) return null;
  if (typeof value !== 'string') throw new TypeError('selectionMethod must be a string.');
  if (/[\r\n\0]/.test(value)) throw new TypeError('selectionMethod cannot contain CR, LF, or NUL.');
  const trimmed = value.trim();
  if (!trimmed) throw new TypeError('selectionMethod cannot be empty when supplied.');
  if (byteLength(trimmed) > 160) throw new TypeError('selectionMethod exceeds the byte limit.');
  return trimmed;
}

function buildSelectionNoticeFromSnapshot(input) {
  const payload = requirePlain(input, 'input');
  assertAllowedKeys(payload, ROOT_KEYS, 'input');

  const generatedAt = validateGeneratedAt(payload.generatedAt);
  const tone = validateTone(payload.tone);
  const projectSnapshot = requirePlain(payload.projectSnapshot, 'projectSnapshot');
  assertAllowedKeys(projectSnapshot, PROJECT_KEYS, 'projectSnapshot');

  const customerSnapshot = payload.customerSnapshot == null ? null : requirePlain(payload.customerSnapshot, 'customerSnapshot');
  if (customerSnapshot) assertAllowedKeys(customerSnapshot, CUSTOMER_KEYS, 'customerSnapshot');

  const projectId = requiredString(projectSnapshot.project_id, 'projectSnapshot.project_id', 200);
  const projectName = requiredString(projectSnapshot.project_name, 'projectSnapshot.project_name', 200);
  const projectStatus = validateStatus(projectSnapshot.status);
  const projectCustomerId = optionalId(projectSnapshot.customer_id, 'projectSnapshot.customer_id');
  const customerId = customerSnapshot ? optionalId(customerSnapshot.customer_id, 'customerSnapshot.customer_id') : null;
  if (projectCustomerId && customerId && projectCustomerId !== customerId) {
    throw new TypeError('customer_id values must match when both snapshots supply them.');
  }

  const fallbackFields = [];
  const warnings = [];
  let customerName = null;
  if (customerSnapshot && Object.prototype.hasOwnProperty.call(customerSnapshot, 'customer_name')) {
    customerName = cleanString(customerSnapshot.customer_name, 'customerSnapshot.customer_name', 120);
  }
  if (!customerName) {
    customerName = CUSTOMER_NAME_FALLBACK;
    fallbackFields.push('customer_name');
    warnings.push('CUSTOMER_NAME_FALLBACK_USED');
  }

  const dueDate = validateDate(projectSnapshot.due_date, 'projectSnapshot.due_date');
  const explicitDeadline = validateDate(payload.selectionDeadline, 'selectionDeadline');
  const selectionDeadline = selectDeadline({ explicit: explicitDeadline, dueDate, warnings });
  const selectionMethodExplicit = cleanSelectionMethod(payload.selectionMethod);
  const selectionMethod = selectMethod({ explicit: selectionMethodExplicit, warnings });
  if (selectionMethod.source === 'NOT_PROVIDED') fallbackFields.push('selection_method');
  const noteToClient = terminateSentence(cleanString(payload.noteToClient, 'noteToClient', 500));
  const project = Object.freeze({
    project_id: projectId,
    customer_id: projectCustomerId,
    project_name: projectName,
    status: projectStatus,
    due_date: dueDate
  });
  const noticeContent = buildSelectionNotice({
    customerName,
    project,
    tone,
    selectionDeadline: selectionDeadline.value,
    selectionMethod: selectionMethod.value,
    noteToClient
  });

  return {
    contractVersion: CONTRACT_VERSION,
    copyVersion: COPY_VERSION,
    projectionType: PROJECTION_TYPE,
    source: SOURCE,
    parityStatus: 'partial',
    fullParity: false,
    legacyTemplateParityStatus: LEGACY_TEMPLATE_PARITY_STATUS,
    legacyTemplateEvidencePreserved: true,
    userDirectedRevision: true,
    generatedAt,
    projectId,
    projectStatus,
    customerName,
    selectionDeadline: selectionDeadline.value,
    selectionDeadlineSource: selectionDeadline.source,
    selectionMethod: selectionMethod.value,
    selectionMethodSource: selectionMethod.source,
    noticeContent,
    degraded: fallbackFields.length > 0,
    fallbackFields,
    warnings,
    requiresHumanReview: true,
    sendReady: false,
    dispatchAuthorized: false,
    automaticNotificationAuthorized: false,
    coverage: {
      gapCodes: Array.from(GAP_CODES)
    }
  };
}

module.exports = {
  ACTION,
  CREATION_ID,
  COPY_VERSION,
  CONTRACT_VERSION,
  CUSTOMER_NAME_FALLBACK,
  GAP_CODES,
  buildSelectionNoticeFromSnapshot
};
