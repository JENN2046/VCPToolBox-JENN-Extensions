'use strict';

const {
  SOURCE_ENDPOINTS: LEGACY_DELIVERY_SOURCE_ENDPOINTS,
  MISSING_LEGACY_FIELDS: LEGACY_DELIVERY_MISSING_FIELDS,
  buildDeliveryOperatorProjection
} = require('./deliveryOperatorReportProjection.cjs');
const {
  SOURCE_ENDPOINTS: DELIVERY_OPERATIONS_SOURCE_ENDPOINTS,
  MISSING_LEGACY_FIELDS: DELIVERY_OPERATIONS_MISSING_FIELDS,
  buildDeliveryOperatorOperationsProjection
} = require('./deliveryOperatorOperationsProjection.cjs');
const {
  SOURCE_ENDPOINTS: WEEKLY_SOURCE_ENDPOINTS,
  MISSING_LEGACY_FIELDS: WEEKLY_MISSING_FIELDS,
  buildWeeklyProjectDigestProjection
} = require('./weeklyProjectDigestProjection.cjs');
const {
  SOURCE_ENDPOINTS: FIELD_QUALITY_SOURCE_ENDPOINTS,
  MISSING_LEGACY_FIELDS: FIELD_QUALITY_MISSING_FIELDS,
  buildProjectFieldQualityProjection
} = require('./projectFieldQualityProjection.cjs');

const PROFILE_STATUSES = Object.freeze({
  deliveryOperatorReport: 'PARTIAL_READ_API_ADAPTER_PROFILE',
  weeklyProjectDigest: 'PARTIAL_READ_API_ADAPTER_PROFILE',
  fieldAudit: 'PARTIAL_READ_API_ADAPTER_PROFILE'
});

const ACTIONS = Object.freeze({
  legacyDelivery: 'build_delivery_operator_report_from_snapshots',
  deliveryOperations: 'build_delivery_operator_report_from_operations_snapshot',
  weeklyOperations: 'build_weekly_project_digest_from_operations_snapshot',
  fieldQualityOperations: 'build_project_field_audit_from_operations_snapshot'
});

function listAdapterProfiles() {
  return [
    {
      creationId: 'jenn.photo-studio.plugin-delivery-operator-report',
      status: PROFILE_STATUSES.deliveryOperatorReport,
      projectionImplemented: true,
      syntheticOnly: true,
      runtimeActionEligible: 'synthetic-only',
      fullParity: false,
      sourceEndpoints: DELIVERY_OPERATIONS_SOURCE_ENDPOINTS.slice(),
      legacySyntheticEndpoints: LEGACY_DELIVERY_SOURCE_ENDPOINTS.slice(),
      missingLegacyFields: DELIVERY_OPERATIONS_MISSING_FIELDS.slice(),
      actions: [
        {
          action: ACTIONS.legacyDelivery,
          preserved: true,
          deprecatedSyntheticCompatibility: true,
          missingLegacyFields: LEGACY_DELIVERY_MISSING_FIELDS.slice()
        },
        {
          action: ACTIONS.deliveryOperations,
          preserved: true,
          canonicalOperationsSnapshot: true
        }
      ]
    },
    {
      creationId: 'jenn.photo-studio.plugin-weekly-project-digest',
      status: PROFILE_STATUSES.weeklyProjectDigest,
      projectionImplemented: true,
      syntheticOnly: true,
      runtimeActionEligible: 'synthetic-only',
      fullParity: false,
      sourceEndpoints: WEEKLY_SOURCE_ENDPOINTS.slice(),
      missingLegacyFields: WEEKLY_MISSING_FIELDS.slice(),
      actions: [
        {
          action: ACTIONS.weeklyOperations,
          preserved: true,
          canonicalOperationsSnapshot: true
        }
      ]
    },
    {
      creationId: 'jenn.photo-studio.plugin-field-audit',
      status: PROFILE_STATUSES.fieldAudit,
      projectionImplemented: true,
      syntheticOnly: true,
      runtimeActionEligible: 'synthetic-only',
      fullParity: false,
      sourceEndpoints: FIELD_QUALITY_SOURCE_ENDPOINTS.slice(),
      missingLegacyFields: FIELD_QUALITY_MISSING_FIELDS.slice(),
      actions: [
        {
          action: ACTIONS.fieldQualityOperations,
          preserved: true,
          canonicalOperationsSnapshot: true
        }
      ]
    }
  ];
}

module.exports = {
  ACTIONS,
  PROFILE_STATUSES,
  listAdapterProfiles,
  buildDeliveryOperatorProjection,
  buildDeliveryOperatorOperationsProjection,
  buildWeeklyProjectDigestProjection,
  buildProjectFieldQualityProjection
};
