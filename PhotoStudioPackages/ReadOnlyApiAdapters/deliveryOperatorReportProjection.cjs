'use strict';

const SOURCE_ENDPOINTS = Object.freeze([
  '/command-center/v2',
  '/deliveries/:deliveryId/readiness'
]);

const MISSING_LEGACY_FIELDS = Object.freeze([
  'retry_after_date',
  'delivery_error',
  'delivery_attempts',
  'delivery_acknowledged',
  'external_export_id / export_key semantics',
  'complete export queue listing'
]);

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function findDeliveryPreview(commandCenter, deliveryId) {
  const deliveries = commandCenter
    && commandCenter.previews
    && Array.isArray(commandCenter.previews.deliveries)
    ? commandCenter.previews.deliveries
    : [];
  return deliveries.find((item) => item && item.id === deliveryId) || null;
}

function buildDeliveryOperatorProjection(input = {}) {
  const commandCenter = cloneJson(input.commandCenter || {});
  const readiness = cloneJson(input.readiness || {});
  const deliveryId = readiness.deliveryId || input.deliveryId || null;
  const preview = findDeliveryPreview(commandCenter, deliveryId);
  const checklist = Array.isArray(readiness.checklist) ? readiness.checklist : [];
  const blockers = Array.isArray(readiness.blockers) ? readiness.blockers : [];

  return {
    parityStatus: 'partial',
    fullParity: false,
    source: 'synthetic_read_api_snapshot',
    sourceEndpoints: SOURCE_ENDPOINTS.slice(),
    missingLegacyFields: MISSING_LEGACY_FIELDS.slice(),
    delivery: {
      deliveryId,
      previewStatus: preview ? preview.status || null : null,
      readinessStatus: readiness.status || null,
      itemCount: Number.isFinite(readiness.itemCount)
        ? readiness.itemCount
        : preview && Number.isFinite(preview.itemCount)
          ? preview.itemCount
          : null,
      checklist,
      blockers,
      externalAccessEnabled: Boolean(readiness.externalAccess && readiness.externalAccess.enabled === true)
    },
    summary: {
      commandCenterMode: commandCenter.mode || commandCenter.studio && commandCenter.studio.mode || null,
      deliveryPreviewAvailable: Boolean(preview),
      readinessAvailable: Boolean(readiness && readiness.deliveryId),
      blockerCount: blockers.length,
      checklistCount: checklist.length
    }
  };
}

module.exports = {
  SOURCE_ENDPOINTS,
  MISSING_LEGACY_FIELDS,
  buildDeliveryOperatorProjection
};
