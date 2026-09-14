'use strict';

const SOURCE_ENDPOINTS = Object.freeze(['/operations/projects/weekly']);

const MISSING_LEGACY_FIELDS = Object.freeze([
  'legacy status-log exact semantics',
  'legacy normalized project-name semantics',
  'legacy arbitrary local-store transition rows'
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
    status: 'partial',
    unsupportedLegacyFields: unsupported.length > 0
      ? unsupported.slice()
      : MISSING_LEGACY_FIELDS.slice(),
    activityStatusExtraction: coverage.activityStatusExtraction || 'safe_status_string_only'
  };
}

function buildWeeklyProjectDigestProjection(input = {}) {
  const snapshot = unwrapSnapshot(input.operationsWeeklyProjectsSnapshot || input.snapshot || {});
  const projects = arrayOrEmpty(snapshot.projects).map((project) => ({
    projectId: project.projectId || null,
    clientDisplayName: project.clientDisplayName || null,
    brandName: project.brandName || null,
    projectName: project.projectName || null,
    projectType: project.projectType || null,
    status: project.status || null,
    priority: project.priority || null,
    shootStartDate: project.shootStartDate || null,
    shootEndDate: project.shootEndDate || null,
    deliveryDueDate: project.deliveryDueDate || null,
    daysUntilDue: Number.isFinite(project.daysUntilDue) ? project.daysUntilDue : null,
    attentionState: project.attentionState || 'unknown',
    createdAt: project.createdAt || null,
    updatedAt: project.updatedAt || null
  }));
  const recentActivity = arrayOrEmpty(snapshot.recentActivity).map((activity) => ({
    activityId: activity.activityId || null,
    projectId: activity.projectId || null,
    action: activity.action || null,
    entityType: activity.entityType || null,
    createdAt: activity.createdAt || null,
    previousStatus: typeof activity.previousStatus === 'string' ? activity.previousStatus : null,
    newStatus: typeof activity.newStatus === 'string' ? activity.newStatus : null
  }));
  const summary = {
    ...objectOrEmpty(snapshot.summary),
    totalProjects: Number.isFinite(objectOrEmpty(snapshot.summary).totalProjects)
      ? objectOrEmpty(snapshot.summary).totalProjects
      : projects.length,
    recentActivityCount: recentActivity.length
  };

  return {
    projectionType: 'weekly_project_digest',
    parityStatus: 'partial',
    fullParity: false,
    source: 'canonical_operations_snapshot',
    sourceEndpoints: SOURCE_ENDPOINTS.slice(),
    contractVersion: snapshot.contractVersion || null,
    mode: snapshot.mode || 'read_only',
    page: Number.isFinite(snapshot.page) ? snapshot.page : null,
    limit: Number.isFinite(snapshot.limit) ? snapshot.limit : null,
    total: Number.isFinite(snapshot.total) ? snapshot.total : projects.length,
    coverage: coverageFrom(snapshot),
    missingLegacyFields: MISSING_LEGACY_FIELDS.slice(),
    summary,
    countsByStatus: sortedObject(snapshot.countsByStatus),
    countsByProjectType: sortedObject(snapshot.countsByProjectType),
    projects,
    recentActivity,
    digestSections: [
      {
        sectionId: 'weekly_summary',
        metrics: {
          totalProjects: summary.totalProjects,
          activeProjects: summary.activeProjects || 0,
          closedProjects: summary.closedProjects || 0,
          overdueProjects: summary.overdueProjects || 0,
          dueSoonProjects: summary.dueSoonProjects || 0
        }
      },
      {
        sectionId: 'attention_projects',
        projectIds: projects
          .filter((project) => ['overdue', 'due_soon'].includes(project.attentionState))
          .map((project) => project.projectId)
      }
    ]
  };
}

module.exports = {
  SOURCE_ENDPOINTS,
  MISSING_LEGACY_FIELDS,
  buildWeeklyProjectDigestProjection
};
