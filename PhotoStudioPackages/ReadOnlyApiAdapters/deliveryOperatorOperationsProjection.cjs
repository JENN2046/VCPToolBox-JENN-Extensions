'use strict';

const SOURCE_ENDPOINTS = Object.freeze(['/operations/deliveries']);

const MISSING_LEGACY_FIELDS = Object.freeze([
  'retry_after_date',
  'delivery_error',
  'delivery_attempts',
  'delivery_acknowledged',
  'external_export_id/export_key semantics',
  'complete external export queue semantics'
]);

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function unwrapSnapshot(snapshot) {
  const cloned = cloneJson(snapshot || {});
  return cloned && cloned.data && typeof cloned.data === 'object' && !Array.isArray(cloned.data)
    ? cloned.data
    : cloned;
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function sortedObject(value) {
  const input = objectOrEmpty(value);
  return Object.fromEntries(Object.keys(input).sort().map((key) => [key, input[key]]));
}

function coverageFrom(snapshot) {
  const coverage = objectOrEmpty(snapshot.coverage);
  const unsupported = arrayOrEmpty(coverage.unsupportedLegacyFields);
  return {
    status: coverage.status === 'partial' ? 'partial' : 'partial',
    unsupportedLegacyFields: unsupported.length > 0
      ? unsupported.slice()
      : MISSING_LEGACY_FIELDS.slice()
  };
}

function summarizeRows(items) {
  return {
    attentionRequiredCount: items.filter((item) => !['normal', 'ready', 'delivered'].includes(item.attentionState)).length,
    blockedCount: items.filter((item) => item.attentionState === 'blocked').length,
    incompleteCount: items.filter((item) => item.attentionState === 'incomplete').length,
    readyCount: items.filter((item) => item.status === 'ready').length,
    deliveredCount: items.filter((item) => item.status === 'delivered').length
  };
}

function buildDeliveryOperatorOperationsProjection(input = {}) {
  const snapshot = unwrapSnapshot(input.operationsDeliveriesSnapshot || input.snapshot || {});
  const items = arrayOrEmpty(snapshot.items).map((item) => ({
    deliveryId: item.deliveryId || null,
    projectId: item.projectId || null,
    projectName: item.projectName || null,
    projectStatus: item.projectStatus || null,
    deliveryDueDate: item.deliveryDueDate || null,
    status: item.status || null,
    itemCount: Number.isFinite(item.itemCount) ? item.itemCount : 0,
    hasPackageKey: item.hasPackageKey === true,
    hasManifestKey: item.hasManifestKey === true,
    deliveredAt: item.deliveredAt || null,
    expiresAt: item.expiresAt || null,
    createdAt: item.createdAt || null,
    updatedAt: item.updatedAt || null,
    attentionState: item.attentionState || 'unknown',
    blockerCodes: arrayOrEmpty(item.blockerCodes).slice()
  }));
  const summary = {
    ...summarizeRows(items),
    ...objectOrEmpty(snapshot.summary),
    countsByStatus: sortedObject(objectOrEmpty(snapshot.summary).countsByStatus)
  };

  return {
    projectionType: 'delivery_operator_operations_report',
    parityStatus: 'partial',
    fullParity: false,
    source: 'canonical_operations_snapshot',
    sourceEndpoints: SOURCE_ENDPOINTS.slice(),
    contractVersion: snapshot.contractVersion || null,
    mode: snapshot.mode || 'read_only',
    page: Number.isFinite(snapshot.page) ? snapshot.page : null,
    limit: Number.isFinite(snapshot.limit) ? snapshot.limit : null,
    total: Number.isFinite(snapshot.total) ? snapshot.total : items.length,
    coverage: coverageFrom(snapshot),
    missingLegacyFields: MISSING_LEGACY_FIELDS.slice(),
    summary,
    rows: items,
    reportSections: [
      {
        sectionId: 'operator_overview',
        metrics: {
          total: Number.isFinite(snapshot.total) ? snapshot.total : items.length,
          attentionRequiredCount: summary.attentionRequiredCount,
          readyCount: summary.readyCount,
          deliveredCount: summary.deliveredCount
        }
      },
      {
        sectionId: 'blocked_or_incomplete',
        deliveryIds: items
          .filter((item) => item.blockerCodes.length > 0 || ['blocked', 'incomplete', 'overdue', 'expired'].includes(item.attentionState))
          .map((item) => item.deliveryId)
      }
    ]
  };
}

module.exports = {
  SOURCE_ENDPOINTS,
  MISSING_LEGACY_FIELDS,
  buildDeliveryOperatorOperationsProjection
};
