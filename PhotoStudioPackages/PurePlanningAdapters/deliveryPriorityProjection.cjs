'use strict';

const ACTION = 'prioritize_delivery_actions_from_snapshot';
const CREATION_ID = 'jenn.photo-studio.plugin-delivery-priority';
const CONTRACT_VERSION = 2;
const SOURCE = 'synthetic_snapshot';

const COVERAGE_GAPS = Object.freeze([
  'no persistent queue lock',
  'no external export mutation',
  'no acknowledgement write',
  'no notification send',
  'no retry scheduling write'
]);

const ROOT_KEYS = Object.freeze(['externalExportSnapshots', 'referenceDate', 'scope', 'maxItems', 'generatedAt']);
const SCOPE_KEYS = Object.freeze(['projectId', 'exportKey', 'targetType', 'deliveryState']);

const ADVISORY_BY_RANK = Object.freeze({
  0: Object.freeze({
    recommendationCode: 'REVIEW_FAILED_DELIVERY',
    recommendationZh: '交付失败，需优先检查',
    reasonCode: 'FAILED_REQUIRES_INSPECTION',
    reasonZh: '请先检查失败原因与交付条件'
  }),
  1: Object.freeze({
    recommendationCode: 'REVIEW_RETRY_DUE',
    recommendationZh: '重试窗口已到，请检查重试条件',
    reasonCode: 'RETRY_WINDOW_OPEN',
    reasonZh: '重试日期已到或早于参考日期'
  }),
  2: Object.freeze({
    recommendationCode: 'REVIEW_PUBLISH_READINESS',
    recommendationZh: '已准备发布，请检查发布条件',
    reasonCode: 'PUBLISH_READINESS_REVIEW',
    reasonZh: '当前状态为准备发布，需在失败和到期重试之后检查'
  }),
  3: Object.freeze({
    recommendationCode: 'MONITOR_QUEUED_DELIVERY',
    recommendationZh: '任务已入队，请持续观察',
    reasonCode: 'QUEUED_MONITORING',
    reasonZh: '当前任务已进入队列，仅需观察状态'
  }),
  4: Object.freeze({
    recommendationCode: 'WAIT_FOR_RETRY_WINDOW',
    recommendationZh: '尚未到重试时间，请等待',
    reasonCode: 'RETRY_WINDOW_NOT_OPEN',
    reasonZh: '重试日期晚于参考日期'
  })
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function requirePlain(value, label) {
  if (!isPlainObject(value)) {
    throw new TypeError(`${label} must be a plain snapshot object.`);
  }
  return value;
}

function assertAllowedKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) {
      throw new TypeError(`${label}.${key} is not part of the contract.`);
    }
  }
}

function cleanString(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function isExplicitIso(value) {
  const match = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.exec(value);
  if (!match || match[0] !== value) return false;
  const [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
  return isDateOnly(value.slice(0, 10)) && hour <= 23 && minute <= 59 && second <= 59;
}

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1];
}

function validateOptionalGeneratedAt(value) {
  if (value === undefined) return null;
  if (!isExplicitIso(value)) throw new TypeError('generatedAt must be an explicit UTC ISO timestamp when supplied.');
  return value;
}

function validateReferenceDate(value) {
  if (!isDateOnly(value)) throw new TypeError('referenceDate must use YYYY-MM-DD.');
  return value;
}

function validateMaxItems(value) {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 1 || value > 100) {
    throw new TypeError('maxItems must be an integer between 1 and 100.');
  }
  return value;
}

function validateScope(value) {
  if (value === undefined) return null;
  const scope = requirePlain(value, 'scope');
  assertAllowedKeys(scope, SCOPE_KEYS, 'scope');
  const normalized = {};
  for (const key of Object.keys(scope)) {
    const cleaned = cleanString(scope[key]);
    if (!cleaned) throw new TypeError(`scope.${key} must be a non-empty string.`);
    normalized[key] = cleaned;
  }
  return normalized;
}

function retryDate(snapshot) {
  const value = snapshot.retry_after_date;
  if (value === undefined || value === null) return null;
  const date = cleanString(value);
  if (typeof value !== 'string' || (date && !isDateOnly(date))) {
    throw new TypeError('retry_after_date must be a valid YYYY-MM-DD date when supplied.');
  }
  return date;
}

function scheduleDate(snapshot) {
  const value = snapshot.schedule_date;
  if (value === undefined || value === null) return retryDate(snapshot);
  const date = cleanString(value);
  if (typeof value !== 'string' || (date && !isDateOnly(date))) {
    throw new TypeError('schedule_date must be a valid YYYY-MM-DD date when supplied.');
  }
  return date || retryDate(snapshot);
}

function daysFromCivil(year, month, day) {
  let adjustedYear = year;
  if (month <= 2) adjustedYear -= 1;
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const shiftedMonth = month + (month > 2 ? -3 : 9);
  const dayOfYear = Math.floor((153 * shiftedMonth + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
}

function parseUpdatedAtSortKey(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (!isDateOnly(`${match[1]}-${match[2]}-${match[3]}`) || hour > 23 || minute > 59 || second > 59) return null;

  const zone = match[8];
  let offsetMinutes = 0;
  if (zone.toUpperCase() !== 'Z') {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return null;
    if (zone === '-00:00') return null;
    const direction = zone[0] === '+' ? 1 : -1;
    offsetMinutes = direction * (offsetHour * 60 + offsetMinute);
  }

  const fraction = match[7] ? Number(match[7].padEnd(6, '0')) : 0;
  const localSeconds = BigInt(daysFromCivil(year, month, day)) * 86400n
    + BigInt(hour * 3600 + minute * 60 + second);
  const utcSeconds = localSeconds - BigInt(offsetMinutes * 60);
  return utcSeconds * 1000000n + BigInt(fraction);
}

function updatedAt(snapshot) {
  const value = snapshot.updated_at;
  if (value === undefined || value === null) return { value: null, sortKey: null };
  if (typeof value !== 'string') {
    throw new TypeError('updated_at must be a valid explicit-offset date-time when supplied.');
  }
  const normalized = value.trim();
  if (!normalized) return { value: null, sortKey: null };
  const sortKey = parseUpdatedAtSortKey(normalized);
  if (sortKey === null) {
    throw new TypeError('updated_at must be a valid explicit-offset date-time when supplied.');
  }
  return { value: normalized, sortKey };
}

function projectIdFor(snapshot, scopedProjectId = null) {
  const direct = cleanString(snapshot.project_id);
  if (direct) return direct;
  if (!Array.isArray(snapshot.export_rows)) return null;
  for (const row of snapshot.export_rows) {
    if (isPlainObject(row)) {
      const value = cleanString(row.project_id);
      if (value && (scopedProjectId === null || value === scopedProjectId)) return value;
    }
  }
  return null;
}

function rankFor(snapshot, referenceDate) {
  const state = cleanString(snapshot.delivery_state);
  if (state === 'failed') return 0;
  if (state === 'retry_scheduled') {
    const date = retryDate(snapshot);
    if (date && date <= referenceDate) return 1;
    if (date && date > referenceDate) return 4;
    return 9;
  }
  if (state === 'ready_to_publish') return 2;
  if (state === 'queued') return 3;
  return 9;
}

function scopeMatches(snapshot, scope) {
  if (!scope) return true;
  if (scope.projectId !== undefined && projectIdFor(snapshot, scope.projectId) !== scope.projectId) return false;
  if (scope.exportKey !== undefined && cleanString(snapshot.export_key) !== scope.exportKey) return false;
  if (scope.targetType !== undefined && cleanString(snapshot.target_type) !== scope.targetType) return false;
  if (scope.deliveryState !== undefined && cleanString(snapshot.delivery_state) !== scope.deliveryState) return false;
  return true;
}

function compareNullableDateAscending(left, right) {
  if (left && right) return left.localeCompare(right);
  if (left) return -1;
  if (right) return 1;
  return 0;
}

function compareNullableInstantDescending(left, right) {
  if (left !== null && right !== null) {
    if (left > right) return -1;
    if (left < right) return 1;
    return 0;
  }
  if (left !== null) return -1;
  if (right !== null) return 1;
  return 0;
}

function sortActionable(left, right) {
  if (left.rank !== right.rank) return left.rank - right.rank;
  const schedule = compareNullableDateAscending(left.scheduleDateForSort, right.scheduleDateForSort);
  if (schedule !== 0) return schedule;
  const updated = compareNullableInstantDescending(left.updatedAtForSort, right.updatedAtForSort);
  if (updated !== 0) return updated;
  return left.sourceIndex - right.sourceIndex;
}

function buildPriorityItem(snapshot, sourceIndex, referenceDate, scope) {
  const rank = rankFor(snapshot, referenceDate);
  if (!Object.prototype.hasOwnProperty.call(ADVISORY_BY_RANK, rank)) return null;
  const advisory = ADVISORY_BY_RANK[rank];
  const update = updatedAt(snapshot);
  const item = {
    sourceIndex,
    rank,
    projectId: projectIdFor(snapshot, scope && scope.projectId !== undefined ? scope.projectId : null),
    exportKey: cleanString(snapshot.export_key),
    targetType: cleanString(snapshot.target_type),
    deliveryState: cleanString(snapshot.delivery_state),
    retryAfterDate: retryDate(snapshot),
    scheduleDate: scheduleDate(snapshot),
    updatedAt: update.value,
    recommendationType: 'ADVISORY_ONLY',
    executionAuthorized: false,
    stateMutationAuthorized: false,
    ...advisory
  };
  return {
    item,
    rank,
    sourceIndex,
    scheduleDateForSort: item.scheduleDate,
    updatedAtForSort: update.sortKey
  };
}

function summarize(actionable, matchedCount, returnedCount, excludedCount, maxItems) {
  const counts = {
    failedCount: 0,
    retryDueCount: 0,
    readyToPublishCount: 0,
    queuedCount: 0,
    futureRetryCount: 0
  };
  for (const entry of actionable) {
    if (entry.rank === 0) counts.failedCount += 1;
    if (entry.rank === 1) counts.retryDueCount += 1;
    if (entry.rank === 2) counts.readyToPublishCount += 1;
    if (entry.rank === 3) counts.queuedCount += 1;
    if (entry.rank === 4) counts.futureRetryCount += 1;
  }
  return {
    totalMatchedRecords: matchedCount,
    actionableRecords: actionable.length,
    returnedItems: returnedCount,
    excludedRecords: excludedCount,
    ...counts,
    maxItemsApplied: maxItems !== null && maxItems < actionable.length,
    maxItemsValue: maxItems
  };
}

function buildDeliveryPriorityFromSnapshot(input) {
  const payload = requirePlain(input, 'input');
  assertAllowedKeys(payload, ROOT_KEYS, 'input');
  const generatedAt = validateOptionalGeneratedAt(payload.generatedAt);
  const referenceDate = validateReferenceDate(payload.referenceDate);
  const maxItems = validateMaxItems(payload.maxItems);
  const scope = validateScope(payload.scope);
  if (!Array.isArray(payload.externalExportSnapshots)) {
    throw new TypeError('externalExportSnapshots must be an array.');
  }

  const matched = [];
  for (let index = 0; index < payload.externalExportSnapshots.length; index += 1) {
    const snapshot = requirePlain(payload.externalExportSnapshots[index], `externalExportSnapshots[${index}]`);
    if (scopeMatches(snapshot, scope)) matched.push({ snapshot, index });
  }

  const actionable = matched
    .map(({ snapshot, index }) => buildPriorityItem(snapshot, index, referenceDate, scope))
    .filter(Boolean)
    .sort(sortActionable);
  const limit = maxItems === null ? actionable.length : Math.min(maxItems, actionable.length);
  const prioritizedActions = actionable.slice(0, limit).map(({ item }) => item);
  const result = {
    creationId: CREATION_ID,
    action: ACTION,
    contractVersion: CONTRACT_VERSION,
    projectionType: 'delivery_priority_plan',
    source: SOURCE,
    referenceDate,
    priorityOrderParity: 'preserved',
    writeActionParity: 'intentionally_not_preserved',
    recommendationSemantics: 'ADVISORY_ONLY',
    realQueueParity: false,
    fullParity: false,
    syntheticOnly: true,
    coverageGaps: COVERAGE_GAPS.slice(),
    summary: summarize(actionable, matched.length, prioritizedActions.length, matched.length - actionable.length, maxItems),
    prioritizedActions
  };
  if (generatedAt) result.generatedAt = generatedAt;
  return result;
}

module.exports = {
  ACTION,
  CREATION_ID,
  CONTRACT_VERSION,
  COVERAGE_GAPS,
  ADVISORY_BY_RANK,
  buildDeliveryPriorityFromSnapshot,
  rankFor
};
