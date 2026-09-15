'use strict';

const ACTION = 'build_client_reply_draft_from_snapshot';
const CREATION_ID = 'jenn.photo-studio.plugin-reply-draft';
const CONTRACT_VERSION = 2;
const SOURCE = 'synthetic_snapshot';
const LEGACY_TEMPLATE_PARITY_STATUS = 'INTENTIONALLY_DIVERGED_BY_USER_REVISION';

const PROJECT_TYPE_LABELS = Object.freeze({
  wedding: '婚礼摄影',
  portrait: '人像摄影',
  commercial: '商业摄影',
  event: '活动摄影',
  other: '其他摄影项目'
});

const STATUS_LABELS = Object.freeze({
  inquiry: '需求沟通中',
  quoted: '报价已发送',
  confirmed: '项目已确认',
  preparing: '拍摄准备中',
  shooting: '拍摄进行中',
  editing: '后期制作中',
  reviewing: '确认与审阅中',
  delivered: '已完成交付',
  completed: '项目已完成',
  archived: '项目已归档',
  cancelled: '项目已取消'
});

const CONTEXT_TYPES = Object.freeze(['quotation', 'schedule', 'delivery', 'general']);
const TONES = Object.freeze(['formal', 'friendly', 'warm']);
const ROOT_KEYS = Object.freeze(['projectSnapshot', 'customerSnapshot', 'contextType', 'tone', 'keyPoints', 'generatedAt']);
const PROJECT_KEYS = Object.freeze(['project_id', 'customer_id', 'project_name', 'project_type', 'status', 'start_date', 'due_date']);
const CUSTOMER_KEYS = Object.freeze(['customer_id', 'customer_name']);
const REGISTER_BY_TONE = Object.freeze({
  formal: 'HONORIFIC_NIN',
  friendly: 'INFORMAL_NI',
  warm: 'INFORMAL_NI'
});

class ProjectionValidationError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'ProjectionValidationError';
    this.code = code;
  }
}

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

function isDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= monthDays[month - 1];
}

function isExplicitIso(value) {
  const match = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.exec(value);
  if (!match || match[0] !== value) return false;
  const [hour, minute, second] = value.slice(11, 19).split(':').map(Number);
  return isDateOnly(value.slice(0, 10)) && hour <= 23 && minute <= 59 && second <= 59;
}

function validateGeneratedAt(value) {
  if (!isExplicitIso(value)) {
    throw new TypeError('generatedAt must be an explicit UTC ISO timestamp.');
  }
  return value;
}

function validateEnum(value, allowed, label) {
  if (!allowed.includes(value)) throw new TypeError(`${label} is not supported.`);
  return value;
}

function validateMapKey(value, map, label) {
  if (!Object.prototype.hasOwnProperty.call(map, value)) {
    throw new TypeError(`${label} is not supported.`);
  }
  return value;
}

function classifyPronounRegister(text) {
  const value = String(text || '');
  const hasHonorific = value.includes('您');
  const informalCandidate = value.replace(/迷你/g, '');
  const hasInformal = informalCandidate.includes('你');
  if (hasHonorific && hasInformal) return 'MIXED';
  if (hasHonorific) return 'HONORIFIC_NIN';
  if (hasInformal) return 'INFORMAL_NI';
  return 'NEUTRAL';
}

function assertKeyPointRegister(point, expectedRegister) {
  const observed = classifyPronounRegister(point);
  const valid = expectedRegister === 'HONORIFIC_NIN'
    ? observed === 'HONORIFIC_NIN' || observed === 'NEUTRAL'
    : observed === 'INFORMAL_NI' || observed === 'NEUTRAL';
  if (!valid) {
    throw new ProjectionValidationError(
      'PRONOUN_REGISTER_CONFLICT',
      'key_points contains a second-person address form that conflicts with the selected tone.'
    );
  }
}

function normalizeKeyPoints(value, expectedRegister) {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('keyPoints must be an array when supplied.');
  return value.map((item) => {
    if (typeof item !== 'string') throw new TypeError('keyPoints entries must be non-empty strings.');
    const trimmed = item.trim();
    if (!trimmed) throw new TypeError('keyPoints entries must be non-empty strings.');
    assertKeyPointRegister(trimmed, expectedRegister);
    return trimmed;
  });
}

function greetingFor(tone, customerName) {
  if (tone === 'formal') return `${customerName}，您好。`;
  if (tone === 'friendly') return `${customerName}，你好。`;
  return `${customerName}，你好呀。`;
}

function contextLinesFor(contextType, tone, project) {
  const projectName = project.projectName;
  if (contextType === 'quotation') {
    if (tone === 'formal') {
      return [
        `关于项目“${projectName}”，我先将当前的报价方向和项目安排整理如下。`,
        `项目类型为${project.projectTypeLabel}，后续方案会按这个方向继续细化。`
      ];
    }
    if (tone === 'friendly') {
      return [
        `关于项目“${projectName}”，我先把报价方向和项目安排整理给你。`,
        `这是一个${project.projectTypeLabel}项目，我们可以继续按这个方向细化。`
      ];
    }
    return [
      `关于项目“${projectName}”，我先把报价方向和整体安排整理给你。`,
      `这是一个${project.projectTypeLabel}项目，我们可以一起把细节慢慢确认好。`
    ];
  }
  if (contextType === 'schedule') {
    const intro = tone === 'formal'
      ? `关于项目“${projectName}”，我想与您确认当前的排期安排。`
      : tone === 'friendly'
        ? `关于项目“${projectName}”，我想和你确认一下当前排期。`
        : `关于项目“${projectName}”，我们一起确认一下接下来的时间安排。`;
    return [intro, project.startDate ? `目前计划的开始日期是 ${project.startDate}。` : '开始日期仍待确认。'];
  }
  if (contextType === 'delivery') {
    const intro = tone === 'formal'
      ? `项目“${projectName}”正在进行交付准备。`
      : tone === 'friendly'
        ? `项目“${projectName}”已经进入交付准备阶段。`
        : `项目“${projectName}”正在认真准备交付。`;
    return [intro, project.dueDate ? `目前计划的交付日期是 ${project.dueDate}。` : '交付日期仍待确认。'];
  }
  const intro = tone === 'formal'
    ? `现向您同步项目“${projectName}”的当前进展。`
    : tone === 'friendly'
      ? `我来和你同步一下项目“${projectName}”的当前进展。`
      : `我来和你分享一下项目“${projectName}”的最新进展。`;
  return [intro, `项目目前处于“${project.statusLabel}”。`];
}

function closingFor(contextType, tone) {
  const closings = {
    quotation: {
      formal: '如报价与方向符合您的预期，请您回复确认；我会继续细化后续安排。',
      friendly: '你看过报价后，把想调整的地方告诉我，我们再一起确认。',
      warm: '你可以慢慢看，有任何想法都告诉我，我们把方案调整到合适为止。'
    },
    schedule: {
      formal: '如排期无误，请您回复确认；若需调整，也请一并告知。',
      friendly: '你确认一下这个时间，若需要调整直接告诉我就好。',
      warm: '看看这个时间是否合适，有变化随时告诉我，我们一起协调。'
    },
    delivery: {
      formal: '如交付时间与内容无误，请您回复确认；如需调整，请及时告知。',
      friendly: '你看一下交付安排，有需要调整的地方直接告诉我。',
      warm: '感谢这次合作；交付前还有任何想调整的地方，都可以随时告诉我。'
    },
    general: {
      formal: '如当前安排无误，请您回复确认；我会继续按计划推进。',
      friendly: '你确认一下当前安排，有变化直接告诉我就好。',
      warm: '有任何新的想法或调整，随时告诉我，我们继续把项目推进好。'
    }
  };
  return closings[contextType][tone];
}

function signatureFor(tone) {
  if (tone === 'formal') return '谢谢。';
  if (tone === 'friendly') return '谢谢配合。';
  return '感谢你的信任。';
}

function buildUserDirectedReplyDraft({ customerName, project, contextType, tone, keyPoints }) {
  const lines = [greetingFor(tone, customerName), '', ...contextLinesFor(contextType, tone, project)];
  if (keyPoints.length > 0) {
    lines.push('', '补充说明：');
    for (const point of keyPoints) lines.push(`- ${point}`);
  }
  lines.push('', closingFor(contextType, tone), signatureFor(tone));
  return lines.join('\n');
}

function buildClientReplyDraftFromSnapshot(input) {
  const payload = requirePlain(input, 'input');
  assertAllowedKeys(payload, ROOT_KEYS, 'input');
  const generatedAt = validateGeneratedAt(payload.generatedAt);
  const projectSnapshot = requirePlain(payload.projectSnapshot, 'projectSnapshot');
  assertAllowedKeys(projectSnapshot, PROJECT_KEYS, 'projectSnapshot');
  const customerSnapshot = payload.customerSnapshot === undefined ? {} : requirePlain(payload.customerSnapshot, 'customerSnapshot');
  assertAllowedKeys(customerSnapshot, CUSTOMER_KEYS, 'customerSnapshot');

  const contextType = validateEnum(payload.contextType, CONTEXT_TYPES, 'contextType');
  const tone = validateEnum(payload.tone, TONES, 'tone');
  const addressRegister = REGISTER_BY_TONE[tone];
  const keyPoints = normalizeKeyPoints(payload.keyPoints, addressRegister);
  const projectType = validateMapKey(requiredString(projectSnapshot.project_type, 'projectSnapshot.project_type'), PROJECT_TYPE_LABELS, 'projectSnapshot.project_type');
  const status = validateMapKey(requiredString(projectSnapshot.status, 'projectSnapshot.status'), STATUS_LABELS, 'projectSnapshot.status');
  const projectId = requiredString(projectSnapshot.project_id, 'projectSnapshot.project_id');
  const projectName = requiredString(projectSnapshot.project_name, 'projectSnapshot.project_name');
  const projectCustomerId = optionalString(projectSnapshot.customer_id);
  const customerId = optionalString(customerSnapshot.customer_id);
  if (projectCustomerId && customerId && projectCustomerId !== customerId) {
    throw new TypeError('customerSnapshot.customer_id must match projectSnapshot.customer_id.');
  }
  const fallbackFields = [];
  const warnings = [];
  let customerName = optionalString(customerSnapshot.customer_name);
  if (!customerName) {
    customerName = '[客户姓名]';
    fallbackFields.push('customer_name');
    warnings.push('CUSTOMER_NAME_FALLBACK_USED');
  }

  const project = {
    projectName,
    projectTypeLabel: PROJECT_TYPE_LABELS[projectType],
    statusLabel: STATUS_LABELS[status],
    startDate: optionalString(projectSnapshot.start_date),
    dueDate: optionalString(projectSnapshot.due_date)
  };

  return {
    creationId: CREATION_ID,
    action: ACTION,
    contractVersion: CONTRACT_VERSION,
    projectionType: 'client_reply_draft',
    source: SOURCE,
    generatedAt,
    legacyTemplateParityStatus: LEGACY_TEMPLATE_PARITY_STATUS,
    legacyTemplateEvidencePreserved: true,
    userDirectedRevision: true,
    parityStatus: 'user_directed_revision_partial',
    fullParity: false,
    syntheticOnly: true,
    draftContent: buildUserDirectedReplyDraft({
      customerName,
      project,
      contextType,
      tone,
      keyPoints
    }),
    snapshotScope: {
      projectId,
      customerId: customerId || projectCustomerId,
      contextType,
      tone
    },
    addressRegister,
    pronounConsistencyChecked: true,
    keyPointsPronounConsistencyChecked: true,
    fallbackFields,
    degraded: fallbackFields.length > 0,
    warnings,
    requiresHumanReview: true,
    sendReady: false,
    dispatchAuthorized: false
  };
}

module.exports = {
  ACTION,
  CREATION_ID,
  CONTRACT_VERSION,
  PROJECT_TYPE_LABELS,
  STATUS_LABELS,
  REGISTER_BY_TONE,
  ProjectionValidationError,
  classifyPronounRegister,
  buildUserDirectedReplyDraft,
  buildClientReplyDraftFromSnapshot
};
