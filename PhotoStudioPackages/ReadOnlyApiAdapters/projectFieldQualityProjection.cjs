'use strict';

const SOURCE_ENDPOINTS = Object.freeze(['/operations/projects/field-quality']);

const MISSING_LEGACY_FIELDS = Object.freeze([
  'normalized_project_name',
  'budget'
]);

const REQUIRED_FIELDS = Object.freeze([
  'id',
  'organizationId',
  'clientId',
  'name',
  'projectType',
  'status',
  'priority',
  'createdAt',
  'updatedAt'
]);

const RECOMMENDED_FIELDS = Object.freeze([
  'brandId',
  'shootStartDate',
  'shootEndDate',
  'deliveryDueDate',
  'producerId'
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

function coverageFrom(snapshot) {
  const coverage = objectOrEmpty(snapshot.coverage);
  const unsupported = arrayOrEmpty(coverage.unsupportedLegacyFields);
  return {
    status: 'partial',
    unsupportedLegacyFields: unsupported.length > 0
      ? unsupported.slice()
      : MISSING_LEGACY_FIELDS.slice(),
    requiredFields: arrayOrEmpty(coverage.requiredFields).length > 0
      ? coverage.requiredFields.slice()
      : REQUIRED_FIELDS.slice(),
    recommendedFields: arrayOrEmpty(coverage.recommendedFields).length > 0
      ? coverage.recommendedFields.slice()
      : RECOMMENDED_FIELDS.slice()
  };
}

function buildProjectFieldQualityProjection(input = {}) {
  const snapshot = unwrapSnapshot(input.operationsProjectFieldQualitySnapshot || input.snapshot || {});
  const items = arrayOrEmpty(snapshot.items).map((item) => ({
    projectId: item.projectId || null,
    projectName: item.projectName || null,
    missingRequiredFields: arrayOrEmpty(item.missingRequiredFields).slice(),
    missingRecommendedFields: arrayOrEmpty(item.missingRecommendedFields).slice(),
    invalidReferenceFields: arrayOrEmpty(item.invalidReferenceFields).slice(),
    issueCount: Number.isFinite(item.issueCount) ? item.issueCount : 0
  }));
  const summary = {
    totalProjectsChecked: Number.isFinite(objectOrEmpty(snapshot.summary).totalProjectsChecked)
      ? snapshot.summary.totalProjectsChecked
      : items.length,
    completeProjects: Number.isFinite(objectOrEmpty(snapshot.summary).completeProjects)
      ? snapshot.summary.completeProjects
      : items.filter((item) => item.issueCount === 0).length,
    incompleteProjects: Number.isFinite(objectOrEmpty(snapshot.summary).incompleteProjects)
      ? snapshot.summary.incompleteProjects
      : items.filter((item) => item.issueCount > 0).length,
    requiredFieldGapCount: Number.isFinite(objectOrEmpty(snapshot.summary).requiredFieldGapCount)
      ? snapshot.summary.requiredFieldGapCount
      : items.reduce((sum, item) => sum + item.missingRequiredFields.length, 0),
    recommendedFieldGapCount: Number.isFinite(objectOrEmpty(snapshot.summary).recommendedFieldGapCount)
      ? snapshot.summary.recommendedFieldGapCount
      : items.reduce((sum, item) => sum + item.missingRecommendedFields.length, 0),
    invalidClientReferenceCount: Number.isFinite(objectOrEmpty(snapshot.summary).invalidClientReferenceCount)
      ? snapshot.summary.invalidClientReferenceCount
      : items.filter((item) => item.invalidReferenceFields.includes('clientId')).length,
    invalidBrandReferenceCount: Number.isFinite(objectOrEmpty(snapshot.summary).invalidBrandReferenceCount)
      ? snapshot.summary.invalidBrandReferenceCount
      : items.filter((item) => item.invalidReferenceFields.includes('brandId')).length
  };

  return {
    projectionType: 'project_field_quality_audit',
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
    auditSections: [
      {
        sectionId: 'field_quality_summary',
        metrics: summary
      },
      {
        sectionId: 'projects_with_gaps',
        projectIds: items
          .filter((item) => item.issueCount > 0)
          .map((item) => item.projectId)
      }
    ]
  };
}

module.exports = {
  SOURCE_ENDPOINTS,
  MISSING_LEGACY_FIELDS,
  REQUIRED_FIELDS,
  RECOMMENDED_FIELDS,
  buildProjectFieldQualityProjection
};
