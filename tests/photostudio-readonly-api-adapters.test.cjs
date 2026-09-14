'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..', 'PhotoStudioPackages', 'ReadOnlyApiAdapters');
const packageManifestPath = path.join(packageRoot, 'package-manifest.json');
const profileManifestPath = path.join(packageRoot, 'adapter-profile-manifest.json');
const operationsBindingPath = path.join(packageRoot, 'operations-contract-binding.json');
const indexPath = path.join(packageRoot, 'index.cjs');
const legacyProjectionPath = path.join(packageRoot, 'deliveryOperatorReportProjection.cjs');
const deliveryOperationsPath = path.join(packageRoot, 'deliveryOperatorOperationsProjection.cjs');
const weeklyPath = path.join(packageRoot, 'weeklyProjectDigestProjection.cjs');
const fieldPath = path.join(packageRoot, 'projectFieldQualityProjection.cjs');
const entrypointPath = path.join(packageRoot, 'stdio-entrypoint.cjs');

const deliveryCreationId = 'jenn.photo-studio.plugin-delivery-operator-report';
const weeklyCreationId = 'jenn.photo-studio.plugin-weekly-project-digest';
const fieldAuditCreationId = 'jenn.photo-studio.plugin-field-audit';
const legacyAction = 'build_delivery_operator_report_from_snapshots';
const deliveryOperationsAction = 'build_delivery_operator_report_from_operations_snapshot';
const weeklyAction = 'build_weekly_project_digest_from_operations_snapshot';
const fieldAction = 'build_project_field_audit_from_operations_snapshot';
const allActions = [legacyAction, deliveryOperationsAction, weeklyAction, fieldAction];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sourceText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function legacySnapshotPayload() {
  return {
    referenceDate: '2026-06-23',
    commandCenterSnapshot: {
      generatedAt: '2026-06-23T00:00:00.000Z',
      studio: { mode: 'read_only' },
      previews: {
        deliveries: [
          { id: 'DEL-220', status: 'ready', itemCount: 3 }
        ]
      }
    },
    deliveryReadinessSnapshot: {
      deliveryId: 'DEL-220',
      status: 'ready',
      itemCount: 3,
      checklist: [{ code: 'items_present', ok: true }],
      blockers: [],
      externalAccess: { enabled: false }
    }
  };
}

function deliveryOperationsSnapshot() {
  return {
    data: {
      contractVersion: 1,
      mode: 'read_only',
      coverage: {
        status: 'partial',
        unsupportedLegacyFields: [
          'retry_after_date',
          'delivery_error',
          'delivery_attempts',
          'delivery_acknowledged',
          'external_export_id/export_key semantics',
          'complete external export queue semantics'
        ]
      },
      page: 1,
      limit: 25,
      total: 2,
      summary: {
        total: 2,
        countsByStatus: { ready: 1, preparing: 1 },
        attentionRequiredCount: 1,
        readyCount: 1,
        deliveredCount: 0
      },
      items: [
        {
          deliveryId: 'DEL-220',
          projectId: 'PRJ-128',
          projectName: 'Neutral catalog set',
          projectStatus: 'qc',
          deliveryDueDate: '2026-06-28T00:00:00.000Z',
          status: 'ready',
          itemCount: 3,
          hasPackageKey: true,
          hasManifestKey: true,
          deliveredAt: null,
          expiresAt: '2026-06-30T00:00:00.000Z',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-20T00:00:00.000Z',
          attentionState: 'ready',
          blockerCodes: []
        },
        {
          deliveryId: 'DEL-221',
          projectId: 'PRJ-129',
          projectName: 'Neutral still-life set',
          projectStatus: 'shooting',
          deliveryDueDate: '2026-06-10T00:00:00.000Z',
          status: 'preparing',
          itemCount: 0,
          hasPackageKey: false,
          hasManifestKey: false,
          deliveredAt: null,
          expiresAt: null,
          createdAt: '2026-06-02T00:00:00.000Z',
          updatedAt: '2026-06-21T00:00:00.000Z',
          attentionState: 'incomplete',
          blockerCodes: ['no_items', 'missing_package_marker', 'missing_manifest_marker']
        }
      ]
    },
    meta: { requestId: 'REQ-SYN-001' }
  };
}

function weeklySnapshot() {
  return {
    data: {
      contractVersion: 1,
      mode: 'read_only',
      coverage: {
        status: 'partial',
        unsupportedLegacyFields: [
          'legacy status-log exact semantics',
          'legacy normalized project-name semantics',
          'legacy arbitrary local-store transition rows'
        ],
        activityStatusExtraction: 'safe_status_string_only'
      },
      page: 1,
      limit: 25,
      total: 2,
      summary: {
        totalProjects: 2,
        activeProjects: 1,
        closedProjects: 1,
        overdueProjects: 1,
        dueSoonProjects: 0,
        recentActivityCount: 1
      },
      countsByStatus: { qc: 1, archived: 1 },
      countsByProjectType: { ecommerce_listing: 1, campaign: 1 },
      projects: [
        {
          projectId: 'PRJ-128',
          clientDisplayName: 'Studio Client A',
          brandName: 'Studio Brand A',
          projectName: 'Neutral catalog set',
          projectType: 'ecommerce_listing',
          status: 'qc',
          priority: 'high',
          shootStartDate: '2026-06-12T00:00:00.000Z',
          shootEndDate: '2026-06-14T00:00:00.000Z',
          deliveryDueDate: '2026-06-20T00:00:00.000Z',
          daysUntilDue: -4,
          attentionState: 'overdue',
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-22T00:00:00.000Z'
        },
        {
          projectId: 'PRJ-130',
          clientDisplayName: 'Studio Client B',
          brandName: null,
          projectName: 'Neutral archive set',
          projectType: 'campaign',
          status: 'archived',
          priority: 'normal',
          shootStartDate: null,
          shootEndDate: null,
          deliveryDueDate: '2026-07-01T00:00:00.000Z',
          daysUntilDue: 7,
          attentionState: 'closed',
          createdAt: '2026-05-01T00:00:00.000Z',
          updatedAt: '2026-06-10T00:00:00.000Z'
        }
      ],
      recentActivity: [
        {
          activityId: 'ACT-AAAAAAAA',
          projectId: 'PRJ-128',
          action: 'project.status_changed',
          entityType: 'project',
          createdAt: '2026-06-22T00:00:00.000Z',
          previousStatus: 'shooting',
          newStatus: 'qc'
        }
      ]
    },
    meta: { requestId: 'REQ-SYN-002' }
  };
}

function fieldSnapshot() {
  return {
    data: {
      contractVersion: 1,
      mode: 'read_only',
      coverage: {
        status: 'partial',
        unsupportedLegacyFields: ['normalized_project_name', 'budget'],
        requiredFields: ['id', 'organizationId', 'clientId', 'name', 'projectType', 'status', 'priority', 'createdAt', 'updatedAt'],
        recommendedFields: ['brandId', 'shootStartDate', 'shootEndDate', 'deliveryDueDate', 'producerId']
      },
      page: 1,
      limit: 25,
      total: 2,
      summary: {
        totalProjectsChecked: 2,
        completeProjects: 1,
        incompleteProjects: 1,
        requiredFieldGapCount: 1,
        recommendedFieldGapCount: 4,
        invalidClientReferenceCount: 1,
        invalidBrandReferenceCount: 1
      },
      items: [
        {
          projectId: 'PRJ-128',
          projectName: 'Neutral catalog set',
          missingRequiredFields: [],
          missingRecommendedFields: [],
          invalidReferenceFields: [],
          issueCount: 0
        },
        {
          projectId: 'PRJ-131',
          projectName: null,
          missingRequiredFields: ['name'],
          missingRecommendedFields: ['shootStartDate', 'shootEndDate', 'deliveryDueDate', 'producerId'],
          invalidReferenceFields: ['clientId', 'brandId'],
          issueCount: 7
        }
      ]
    },
    meta: { requestId: 'REQ-SYN-003' }
  };
}

function canonicalRequest(action, creationId, payload, overrides = {}) {
  return {
    protocolVersion: 1,
    requestId: '11111111-1111-4111-8111-111111111111',
    creationId,
    action,
    payload,
    ...overrides
  };
}

function handle(input) {
  const { handleRequest } = require(entrypointPath);
  return handleRequest(input);
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function assertSuccessEnvelope(response) {
  assert.deepEqual(sortedKeys(response), ['creationId', 'ok', 'protocolVersion', 'requestId', 'result']);
  assert.equal(response.ok, true);
  assert.equal(response.protocolVersion, 1);
  assert.equal(response.requestId, '11111111-1111-4111-8111-111111111111');
  assert.equal(response.action, undefined);
}

function assertErrorEnvelope(response) {
  assert.deepEqual(sortedKeys(response), ['creationId', 'error', 'ok', 'protocolVersion', 'requestId']);
  assert.equal(response.ok, false);
  assert.equal(response.protocolVersion, 1);
  assert.equal(response.requestId, '11111111-1111-4111-8111-111111111111');
  assert.equal(response.action, undefined);
  assert.deepEqual(sortedKeys(response.error), ['code', 'message']);
}

test('1 package manifest remains default-off and isolated', () => {
  const manifest = readJson(packageManifestPath);
  assert.equal(manifest.defaultEnabled, false);
  assert.equal(manifest.runtimeEnabled, false);
  assert.equal(manifest.runtimeEligible, true);
  assert.equal(manifest.trustClass, 'ISOLATED_PROCESS');
  assert.equal(manifest.entrypoint, 'stdio-entrypoint.cjs');
  assert.equal(manifest.protocol, 'CANONICAL_JSONL_V1');
  assert.deepEqual(manifest.allowedActions, allActions);
});

test('2 package manifest denies every real backend and data authority', () => {
  const manifest = readJson(packageManifestPath);
  for (const key of [
    'networkAuthorized',
    'realBackendAuthorized',
    'realAuthAuthorized',
    'businessWritesAuthorized',
    'filesystemReadsAuthorized',
    'filesystemWritesAuthorized',
    'providerCallsAuthorized',
    'bridgeCallsAuthorized',
    'privateDataAuthorized',
    'databaseAccessAuthorized',
    'storageAccessAuthorized',
    'persistentEnablementAuthorized'
  ]) {
    assert.equal(manifest[key], false, key);
  }
  assert.equal(manifest.syntheticShadowOnly, true);
  assert.equal(manifest.fullParityClaimed, false);
});

test('3 package manifest maps exactly three Photo Studio creations', () => {
  const manifest = readJson(packageManifestPath);
  assert.deepEqual(manifest.creationIds.sort(), [
    deliveryCreationId,
    weeklyCreationId,
    fieldAuditCreationId
  ].sort());
});

test('4 old Delivery action is preserved as deprecated synthetic compatibility', () => {
  const manifest = readJson(packageManifestPath);
  const command = manifest.capabilities.invocationCommands.find((item) => item.commandIdentifier === legacyAction);
  assert.equal(command.preserved, true);
  assert.equal(command.deprecatedSyntheticCompatibility, true);
});

test('5 profile manifest upgrades all three candidates to partial profiles', () => {
  const manifest = readJson(profileManifestPath);
  assert.equal(manifest.defaultEnabled, false);
  assert.equal(manifest.runtimeEnabled, false);
  assert.deepEqual(manifest.allowedActions, allActions);
  assert.equal(manifest.profiles.length, 3);
  for (const profile of manifest.profiles) {
    assert.equal(profile.status, 'PARTIAL_READ_API_ADAPTER_PROFILE');
    assert.equal(profile.projectionImplemented, true);
    assert.equal(profile.syntheticOnly, true);
    assert.equal(profile.fullParity, false);
    assert.equal(profile.realBackendAuthorized, false);
  }
});

test('6 profile manifest binds exact operations endpoints', () => {
  const byId = new Map(readJson(profileManifestPath).profiles.map((profile) => [profile.creationId, profile]));
  assert.deepEqual(byId.get(deliveryCreationId).sourceEndpoints, ['/operations/deliveries']);
  assert.deepEqual(byId.get(weeklyCreationId).sourceEndpoints, ['/operations/projects/weekly']);
  assert.deepEqual(byId.get(fieldAuditCreationId).sourceEndpoints, ['/operations/projects/field-quality']);
});

test('7 operations binding records backend commit and relative contract evidence', () => {
  const binding = readJson(operationsBindingPath);
  assert.equal(binding.backendCommit, '19a6060482ace0a86e72adaecb4a04b1ea2daee5');
  assert.equal(binding.backendParentCommit, '9327d009a8f1fac0b6e7560f03998bdfe3830bf4');
  for (const item of Object.values(binding.contractEvidence)) {
    assert.match(item.gitBlob, /^[a-f0-9]{40}$/);
    assert.match(item.sha256, /^[a-f0-9]{64}$/);
    assert.equal(path.isAbsolute(item.path), false);
    assert.equal(item.path.includes('\\'), false);
  }
});

test('8 operations binding has three GET operations with exact permissions', () => {
  const operations = readJson(operationsBindingPath).operations;
  assert.deepEqual(operations.map((item) => [item.method, item.path, item.requiredPermission]), [
    ['GET', '/api/v2/read/operations/deliveries', 'deliveries:read'],
    ['GET', '/api/v2/read/operations/projects/weekly', 'projects:read'],
    ['GET', '/api/v2/read/operations/projects/field-quality', 'projects:read']
  ]);
});

test('9 pure index import exposes four action constants and three profiles', () => {
  const beforeKeys = Object.keys(globalThis).sort();
  const adapter = require(indexPath);
  const afterKeys = Object.keys(globalThis).sort();
  assert.deepEqual(afterKeys, beforeKeys);
  assert.deepEqual(Object.values(adapter.ACTIONS), allActions);
  assert.equal(adapter.listAdapterProfiles().length, 3);
});

test('10 legacy Delivery projection remains deterministic and partial', () => {
  const adapter = require(indexPath);
  const input = {
    commandCenter: legacySnapshotPayload().commandCenterSnapshot,
    readiness: legacySnapshotPayload().deliveryReadinessSnapshot
  };
  const before = deepClone(input);
  const first = adapter.buildDeliveryOperatorProjection(input);
  const second = adapter.buildDeliveryOperatorProjection(input);
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.equal(first.parityStatus, 'partial');
  assert.equal(first.fullParity, false);
});

test('11 Delivery operations projection is deterministic and does not mutate input', () => {
  const { buildDeliveryOperatorOperationsProjection } = require(indexPath);
  const input = { operationsDeliveriesSnapshot: deliveryOperationsSnapshot() };
  const before = deepClone(input);
  const first = buildDeliveryOperatorOperationsProjection(input);
  const second = buildDeliveryOperatorOperationsProjection(input);
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.equal(first.parityStatus, 'partial');
  assert.equal(first.fullParity, false);
  assert.equal(first.rows.length, 2);
});

test('12 Delivery operations projection preserves missing legacy field list', () => {
  const { buildDeliveryOperatorOperationsProjection } = require(indexPath);
  const result = buildDeliveryOperatorOperationsProjection({ operationsDeliveriesSnapshot: deliveryOperationsSnapshot() });
  assert.deepEqual(result.coverage.unsupportedLegacyFields, [
    'retry_after_date',
    'delivery_error',
    'delivery_attempts',
    'delivery_acknowledged',
    'external_export_id/export_key semantics',
    'complete external export queue semantics'
  ]);
});

test('13 Delivery operations projection does not fabricate retry, acknowledgement, or export queue fields', () => {
  const { buildDeliveryOperatorOperationsProjection } = require(indexPath);
  const result = buildDeliveryOperatorOperationsProjection({ operationsDeliveriesSnapshot: deliveryOperationsSnapshot() });
  const rowsText = JSON.stringify(result.rows);
  assert.doesNotMatch(rowsText, /retry_after_date|delivery_attempts|delivery_acknowledged|external_export_id|export_key/i);
});

test('14 Weekly projection is deterministic and partial', () => {
  const { buildWeeklyProjectDigestProjection } = require(indexPath);
  const input = { operationsWeeklyProjectsSnapshot: weeklySnapshot() };
  const before = deepClone(input);
  const first = buildWeeklyProjectDigestProjection(input);
  const second = buildWeeklyProjectDigestProjection(input);
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.equal(first.parityStatus, 'partial');
  assert.equal(first.fullParity, false);
});

test('15 Weekly projection keeps safe status extraction only', () => {
  const { buildWeeklyProjectDigestProjection } = require(indexPath);
  const result = buildWeeklyProjectDigestProjection({ operationsWeeklyProjectsSnapshot: weeklySnapshot() });
  assert.equal(result.coverage.activityStatusExtraction, 'safe_status_string_only');
  assert.equal(result.recentActivity[0].previousStatus, 'shooting');
  assert.equal(result.recentActivity[0].newStatus, 'qc');
});

test('16 Weekly projection does not emit raw activity payloads or private metadata', () => {
  const { buildWeeklyProjectDigestProjection } = require(indexPath);
  const result = buildWeeklyProjectDigestProjection({ operationsWeeklyProjectsSnapshot: weeklySnapshot() });
  const text = JSON.stringify(result);
  assert.doesNotMatch(text, /beforeData|afterData|actorId|metadata|email/i);
});

test('17 Field quality projection is deterministic and partial', () => {
  const { buildProjectFieldQualityProjection } = require(indexPath);
  const input = { operationsProjectFieldQualitySnapshot: fieldSnapshot() };
  const before = deepClone(input);
  const first = buildProjectFieldQualityProjection(input);
  const second = buildProjectFieldQualityProjection(input);
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
  assert.equal(first.parityStatus, 'partial');
  assert.equal(first.fullParity, false);
});

test('18 Field quality projection preserves required and recommended field contracts', () => {
  const { buildProjectFieldQualityProjection } = require(indexPath);
  const result = buildProjectFieldQualityProjection({ operationsProjectFieldQualitySnapshot: fieldSnapshot() });
  assert.ok(result.coverage.requiredFields.includes('organizationId'));
  assert.ok(result.coverage.recommendedFields.includes('deliveryDueDate'));
  assert.equal(result.summary.incompleteProjects, 1);
});

test('19 Field quality projection does not invent normalized project name or budget fields', () => {
  const { buildProjectFieldQualityProjection } = require(indexPath);
  const result = buildProjectFieldQualityProjection({ operationsProjectFieldQualitySnapshot: fieldSnapshot() });
  const rowsText = JSON.stringify(result.rows);
  assert.doesNotMatch(rowsText, /normalized_project_name|budget/i);
  assert.deepEqual(result.missingLegacyFields, ['normalized_project_name', 'budget']);
});

test('20 JSONL handler accepts old Delivery snapshot action', () => {
  const response = handle(canonicalRequest(legacyAction, deliveryCreationId, legacySnapshotPayload()));
  assertSuccessEnvelope(response);
  assert.equal(response.result.source, 'synthetic_read_api_snapshot');
});

test('21 JSONL handler accepts Delivery operations action', () => {
  const response = handle(canonicalRequest(deliveryOperationsAction, deliveryCreationId, {
    operationsDeliveriesSnapshot: deliveryOperationsSnapshot()
  }));
  assertSuccessEnvelope(response);
  assert.equal(response.result.projectionType, 'delivery_operator_operations_report');
});

test('22 JSONL handler accepts Weekly operations action', () => {
  const response = handle(canonicalRequest(weeklyAction, weeklyCreationId, {
    operationsWeeklyProjectsSnapshot: weeklySnapshot()
  }));
  assertSuccessEnvelope(response);
  assert.equal(response.result.projectionType, 'weekly_project_digest');
});

test('23 JSONL handler accepts Field quality operations action', () => {
  const response = handle(canonicalRequest(fieldAction, fieldAuditCreationId, {
    operationsProjectFieldQualitySnapshot: fieldSnapshot()
  }));
  assertSuccessEnvelope(response);
  assert.equal(response.result.projectionType, 'project_field_quality_audit');
});

test('24 JSONL handler rejects action and creation mismatches', () => {
  assertErrorEnvelope(handle(canonicalRequest(weeklyAction, deliveryCreationId, { operationsWeeklyProjectsSnapshot: weeklySnapshot() })));
  assertErrorEnvelope(handle(canonicalRequest(deliveryOperationsAction, weeklyCreationId, { operationsDeliveriesSnapshot: deliveryOperationsSnapshot() })));
  assertErrorEnvelope(handle(canonicalRequest('*', deliveryCreationId, {})));
  assertErrorEnvelope(handle(canonicalRequest('unknown', deliveryCreationId, {})));
});

test('25 JSONL handler rejects payload action collisions', () => {
  const response = handle(canonicalRequest(deliveryOperationsAction, deliveryCreationId, {
    action: deliveryOperationsAction,
    operationsDeliveriesSnapshot: deliveryOperationsSnapshot()
  }));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'PAYLOAD_ACTION_COLLISION');
});

test('26 JSONL handler rejects prototype-pollution-shaped input', () => {
  const payload = {
    operationsDeliveriesSnapshot: JSON.parse('{"__proto__":{"polluted":true}}')
  };
  const response = handle(canonicalRequest(deliveryOperationsAction, deliveryCreationId, payload));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'PROTOTYPE_POLLUTION_KEY');
});

test('27 JSONL handler rejects protected data-shaped keys', () => {
  const snapshot = deliveryOperationsSnapshot();
  snapshot.data.items[0].downloadToken = 'redacted-test-value';
  const response = handle(canonicalRequest(deliveryOperationsAction, deliveryCreationId, {
    operationsDeliveriesSnapshot: snapshot
  }));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'PROTECTED_DATA_KEY_DENIED');
});

test('28 JSONL handler rejects excessive depth', () => {
  let nested = {};
  for (let i = 0; i < 14; i += 1) nested = { child: nested };
  const response = handle(canonicalRequest(fieldAction, fieldAuditCreationId, {
    operationsProjectFieldQualitySnapshot: nested
  }));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'JSON_DEPTH_EXCEEDED');
});

test('29 parser requires exactly one newline-terminated JSON line', () => {
  const { parseLine } = require(entrypointPath);
  assert.equal(parseLine(JSON.stringify(canonicalRequest(legacyAction, deliveryCreationId, legacySnapshotPayload()))).ok, false);
  assert.equal(parseLine(`${JSON.stringify(canonicalRequest(legacyAction, deliveryCreationId, legacySnapshotPayload()))}\n{}\n`).ok, false);
  assert.equal(parseLine(`${JSON.stringify(canonicalRequest(legacyAction, deliveryCreationId, legacySnapshotPayload()))}\n`).ok, true);
});

test('30 handler rejects missing required snapshot fields', () => {
  assert.equal(handle(canonicalRequest(deliveryOperationsAction, deliveryCreationId, {})).ok, false);
  assert.equal(handle(canonicalRequest(weeklyAction, weeklyCreationId, {})).ok, false);
  assert.equal(handle(canonicalRequest(fieldAction, fieldAuditCreationId, {})).ok, false);
});

test('31 response error messages redact path and bearer-shaped values', () => {
  const response = handle(canonicalRequest('bad-action', deliveryCreationId, {
    note: 'C:\\secret\\path Bearer abc.def.ghi'
  }));
  assert.equal(response.ok, false);
  assert.doesNotMatch(response.error.message, /C:\\secret|abc\.def/);
});

test('32 operation projection modules have no import-time side effects', () => {
  const beforeKeys = Object.keys(globalThis).sort();
  require(legacyProjectionPath);
  require(deliveryOperationsPath);
  require(weeklyPath);
  require(fieldPath);
  require(entrypointPath);
  const afterKeys = Object.keys(globalThis).sort();
  assert.deepEqual(afterKeys, beforeKeys);
});

test('33 runtime payload modules contain no filesystem, network, child-process, env, console, or absolute path behavior', () => {
  for (const filePath of [indexPath, legacyProjectionPath, deliveryOperationsPath, weeklyPath, fieldPath, entrypointPath]) {
    const text = sourceText(filePath);
    assert.doesNotMatch(text, /require\(['"]fs['"]\)/);
    assert.doesNotMatch(text, /require\(['"]https?['"]\)/);
    assert.doesNotMatch(text, /require\(['"]child_process['"]\)/);
    assert.doesNotMatch(text, /worker_threads/);
    assert.doesNotMatch(text, /process\.env/);
    assert.doesNotMatch(text, /console\./);
    assert.doesNotMatch(text, /[A-Za-z]:\\/);
  }
});

test('34 runtime metadata contains no retirement or full-parity claim', () => {
  const combined = [
    sourceText(packageManifestPath),
    sourceText(profileManifestPath),
    sourceText(operationsBindingPath)
  ].join('\n');
  for (const status of [
    ['USER', 'APPROVED', 'RETIREMENT'].join('_'),
    'RET' + 'IRED',
    'DIS' + 'CARDED',
    'DEL' + 'ETED'
  ]) {
    assert.equal(combined.includes(status), false);
  }
  assert.equal(combined.includes('"fullParity": true'), false);
  assert.equal(combined.includes('"fullParityClaimed": true'), false);
});

test('35 operations binding contains no absolute local path or real backend URL', () => {
  const text = sourceText(operationsBindingPath);
  assert.doesNotMatch(text, /[A-Za-z]:\\/);
  assert.doesNotMatch(text, /https?:\/\//);
  assert.doesNotMatch(text, /localhost/);
});

test('36 Delivery operations summary uses canonical counts without full parity', () => {
  const result = handle(canonicalRequest(deliveryOperationsAction, deliveryCreationId, {
    operationsDeliveriesSnapshot: deliveryOperationsSnapshot()
  })).result;
  assert.equal(result.summary.countsByStatus.ready, 1);
  assert.equal(result.summary.attentionRequiredCount, 1);
  assert.equal(result.fullParity, false);
});

test('37 Weekly digest action records non-empty legacy gaps', () => {
  const result = handle(canonicalRequest(weeklyAction, weeklyCreationId, {
    operationsWeeklyProjectsSnapshot: weeklySnapshot()
  })).result;
  assert.ok(result.missingLegacyFields.length > 0);
  assert.ok(result.digestSections[1].projectIds.includes('PRJ-128'));
});

test('38 Field quality action records non-empty project quality gaps', () => {
  const result = handle(canonicalRequest(fieldAction, fieldAuditCreationId, {
    operationsProjectFieldQualitySnapshot: fieldSnapshot()
  })).result;
  assert.ok(result.missingLegacyFields.includes('budget'));
  assert.ok(result.auditSections[1].projectIds.includes('PRJ-131'));
});

test('39 no legacy Photo Studio plugin entrypoint is imported by the adapter package', () => {
  for (const filePath of [indexPath, deliveryOperationsPath, weeklyPath, fieldPath, entrypointPath]) {
    const text = sourceText(filePath);
    assert.doesNotMatch(text, /JennPhotoStudioPackage|PhotoStudioAssetArchive|plugins\/custom\/shared\/photo_studio_data/);
  }
});
