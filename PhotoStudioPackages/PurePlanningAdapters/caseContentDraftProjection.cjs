'use strict';

const ACTION = 'build_case_content_draft_from_snapshot';
const CREATION_ID = 'jenn.photo-studio.plugin-case-content-draft';
const CONTRACT_VERSION = 2;
const SOURCE = 'synthetic_snapshot';
const LEGACY_TEMPLATE_PARITY_STATUS = 'INTENTIONALLY_DIVERGED_BY_USER_REVISION';

const PROJECT_TYPE_LABELS = Object.freeze({
  wedding: 'wedding photography',
  portrait: 'portrait photography',
  commercial: 'commercial photography',
  event: 'event photography',
  other: 'photography'
});

const TONES = Object.freeze(['formal', 'friendly', 'warm']);
const ROOT_KEYS = Object.freeze(['contentItemSnapshot', 'tone', 'generatedAt']);
const SNAPSHOT_KEYS = Object.freeze([
  'content_item_id',
  'project_id',
  'customer_id',
  'customer_name',
  'project_name',
  'project_type',
  'theme',
  'deliverables_summary',
  'usage_status'
]);

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

function requiredString(value, label) {
  const cleaned = cleanString(value);
  if (!cleaned) throw new TypeError(`${label} is required.`);
  return cleaned;
}

function optionalString(value) {
  return cleanString(value);
}

function isExplicitIso(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value);
}

function validateGeneratedAt(value) {
  if (!isExplicitIso(value)) {
    throw new TypeError('generatedAt must be an explicit UTC ISO timestamp.');
  }
  return value;
}

function validateTone(value) {
  if (!TONES.includes(value)) throw new TypeError('tone must be one of formal, friendly, or warm.');
  return value;
}

function validateProjectType(value) {
  if (!Object.prototype.hasOwnProperty.call(PROJECT_TYPE_LABELS, value)) {
    throw new TypeError('contentItemSnapshot.project_type is not supported.');
  }
  return value;
}

function fallbackField(snapshot, key, fallback, fallbackFields, warnings, warningCode) {
  const cleaned = cleanString(snapshot[key]);
  if (cleaned) return cleaned;
  fallbackFields.push(key);
  warnings.push(warningCode);
  return fallback;
}

function buildUserDirectedCaseDraft({ customerName, projectName, projectTypeLabel, theme, deliverablesSummary, tone }) {
  if (tone === 'formal') {
    return {
      case_title: `${customerName} × ${projectName}`,
      short_case_summary: `${projectName} is a ${projectTypeLabel} project created for ${customerName}. The visual direction focused on ${theme}. ${deliverablesSummary}`,
      social_caption: `Portfolio update — ${projectName}, created for ${customerName}. Visual direction: ${theme}. ${deliverablesSummary}`,
      portfolio_description: `${projectName} is a ${projectTypeLabel} commission for ${customerName}, developed around ${theme}. ${deliverablesSummary}`
    };
  }
  if (tone === 'friendly') {
    return {
      case_title: `${customerName} × ${projectName}`,
      short_case_summary: `A closer look at ${projectName}, a ${projectTypeLabel} collaboration with ${customerName}. We shaped the visual direction around ${theme}. ${deliverablesSummary}`,
      social_caption: `Behind the scenes of ${projectName} with ${customerName}: ${theme}. ${deliverablesSummary}`,
      portfolio_description: `${projectName} documents a collaborative ${projectTypeLabel} process with ${customerName}, bringing ${theme} into the final delivery. ${deliverablesSummary}`
    };
  }
  return {
    case_title: `${customerName} × ${projectName}`,
    short_case_summary: `${projectName} brings together ${customerName} and a ${projectTypeLabel} story shaped by ${theme}. ${deliverablesSummary}`,
    social_caption: `A warm look at ${projectName}, created with ${customerName} around ${theme}. ${deliverablesSummary}`,
    portfolio_description: `${projectName} is a ${projectTypeLabel} story created with ${customerName}, guided by ${theme}. ${deliverablesSummary}`
  };
}

function buildCaseContentDraftFromSnapshot(input) {
  const payload = requirePlain(input, 'input');
  assertAllowedKeys(payload, ROOT_KEYS, 'input');
  const generatedAt = validateGeneratedAt(payload.generatedAt);
  const tone = validateTone(payload.tone);
  const snapshot = requirePlain(payload.contentItemSnapshot, 'contentItemSnapshot');
  assertAllowedKeys(snapshot, SNAPSHOT_KEYS, 'contentItemSnapshot');

  const contentItemId = optionalString(snapshot.content_item_id);
  const projectId = optionalString(snapshot.project_id);
  if (!contentItemId && !projectId) {
    throw new TypeError('contentItemSnapshot requires content_item_id or project_id.');
  }

  const projectName = requiredString(snapshot.project_name, 'contentItemSnapshot.project_name');
  const projectType = validateProjectType(requiredString(snapshot.project_type, 'contentItemSnapshot.project_type'));
  const fallbackFields = [];
  const warnings = [];
  const customerName = fallbackField(
    snapshot,
    'customer_name',
    '[Client Name]',
    fallbackFields,
    warnings,
    'CUSTOMER_NAME_FALLBACK_USED'
  );
  const theme = fallbackField(
    snapshot,
    'theme',
    '[Add visual direction]',
    fallbackFields,
    warnings,
    'THEME_FALLBACK_USED'
  );
  const deliverablesSummary = fallbackField(
    snapshot,
    'deliverables_summary',
    '[Add project outcome and delivery summary]',
    fallbackFields,
    warnings,
    'DELIVERABLES_SUMMARY_FALLBACK_USED'
  );

  return {
    creationId: CREATION_ID,
    action: ACTION,
    contractVersion: CONTRACT_VERSION,
    projectionType: 'case_content_draft',
    source: SOURCE,
    generatedAt,
    legacyTemplateParityStatus: LEGACY_TEMPLATE_PARITY_STATUS,
    legacyTemplateEvidencePreserved: true,
    userDirectedRevision: true,
    parityStatus: 'user_directed_revision_partial',
    fullParity: false,
    syntheticOnly: true,
    draftVariants: buildUserDirectedCaseDraft({
      customerName,
      projectName,
      projectTypeLabel: PROJECT_TYPE_LABELS[projectType],
      theme,
      deliverablesSummary,
      tone
    }),
    snapshotScope: {
      contentItemId,
      projectId,
      customerId: optionalString(snapshot.customer_id),
      projectType,
      tone
    },
    fallbackFields,
    degraded: fallbackFields.length > 0,
    warnings,
    publishReady: false,
    requiresHumanReview: true,
    automaticPublicationAuthorized: false
  };
}

module.exports = {
  ACTION,
  CREATION_ID,
  CONTRACT_VERSION,
  PROJECT_TYPE_LABELS,
  buildUserDirectedCaseDraft,
  buildCaseContentDraftFromSnapshot
};
