'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..', 'PhotoStudioPackages', 'PurePlanningAdapters');
const packageManifestPath = path.join(packageRoot, 'package-manifest.json');
const profileManifestPath = path.join(packageRoot, 'adapter-profile-manifest.json');
const indexPath = path.join(packageRoot, 'index.cjs');
const casePath = path.join(packageRoot, 'caseContentDraftProjection.cjs');
const replyPath = path.join(packageRoot, 'replyDraftProjection.cjs');
const priorityPath = path.join(packageRoot, 'deliveryPriorityProjection.cjs');
const entrypointPath = path.join(packageRoot, 'stdio-entrypoint.cjs');

const caseCreationId = 'jenn.photo-studio.plugin-case-content-draft';
const replyCreationId = 'jenn.photo-studio.plugin-reply-draft';
const priorityCreationId = 'jenn.photo-studio.plugin-delivery-priority';
const caseAction = 'build_case_content_draft_from_snapshot';
const replyAction = 'build_client_reply_draft_from_snapshot';
const priorityAction = 'prioritize_delivery_actions_from_snapshot';
const allActions = [caseAction, replyAction, priorityAction];
const contexts = ['quotation', 'schedule', 'delivery', 'general'];
const tones = ['formal', 'friendly', 'warm'];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sourceText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function casePayload(overrides = {}) {
  return {
    generatedAt: '2026-06-24T01:02:03.000Z',
    tone: 'warm',
    contentItemSnapshot: {
      content_item_id: 'CONTENT-SYN-001',
      project_id: 'PRJ-SYN-001',
      customer_id: 'CUST-SYN-001',
      customer_name: 'Studio Client',
      project_name: 'Campaign Still Set',
      project_type: 'commercial',
      theme: 'bright editorial layout',
      deliverables_summary: 'Eight selected images are ready for publication.',
      usage_status: 'portfolio_review'
    },
    ...overrides
  };
}

function replyPayload(overrides = {}) {
  return {
    generatedAt: '2026-06-24T01:02:03.000Z',
    tone: 'friendly',
    contextType: 'delivery',
    keyPoints: ['交付包已经完成核对', '你可以先查看预览清单'],
    customerSnapshot: {
      customer_id: 'CUST-SYN-001',
      customer_name: 'Studio Client'
    },
    projectSnapshot: {
      project_id: 'PRJ-SYN-001',
      customer_id: 'CUST-SYN-001',
      project_name: 'Campaign Still Set',
      project_type: 'commercial',
      status: 'reviewing',
      start_date: '2026-06-26',
      due_date: '2026-06-30'
    },
    ...overrides
  };
}

function priorityPayload(overrides = {}) {
  return {
    referenceDate: '2026-06-24',
    externalExportSnapshots: [
      {
        project_id: 'PRJ-SYN-003',
        export_key: 'EXP-FAILED',
        target_type: 'client_gallery',
        delivery_state: 'failed',
        schedule_date: '2026-06-25',
        updated_at: '2026-06-23T10:00:00.000Z'
      },
      {
        project_id: 'PRJ-SYN-002',
        export_key: 'EXP-RETRY-DUE',
        target_type: 'client_gallery',
        delivery_state: 'retry_scheduled',
        retry_after_date: '2026-06-23',
        schedule_date: '2026-06-23',
        updated_at: '2026-06-24T10:00:00.000Z'
      },
      {
        project_id: 'PRJ-SYN-001',
        export_key: 'EXP-READY',
        target_type: 'client_gallery',
        delivery_state: 'ready_to_publish',
        schedule_date: '2026-06-24',
        updated_at: '2026-06-24T08:00:00.000Z'
      },
      {
        project_id: 'PRJ-SYN-004',
        export_key: 'EXP-QUEUED',
        target_type: 'archive',
        delivery_state: 'queued',
        schedule_date: '2026-06-26'
      },
      {
        project_id: 'PRJ-SYN-005',
        export_key: 'EXP-WAIT',
        target_type: 'archive',
        delivery_state: 'retry_scheduled',
        retry_after_date: '2026-06-30',
        schedule_date: '2026-06-30'
      },
      {
        project_id: 'PRJ-SYN-006',
        export_key: 'EXP-DONE',
        target_type: 'archive',
        delivery_state: 'delivered'
      }
    ],
    ...overrides
  };
}

function request(action, creationId, payload, overrides = {}) {
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
  assert.equal(response.action, undefined);
  assert.deepEqual(sortedKeys(response.error), ['code', 'message']);
}

function expectedCase(tone) {
  const projectName = 'Campaign Still Set';
  const customerName = 'Studio Client';
  const projectTypeLabel = 'commercial photography';
  const theme = 'bright editorial layout';
  const deliverablesSummary = 'Eight selected images are ready for publication.';
  if (tone === 'formal') {
    return {
      case_title: 'Studio Client × Campaign Still Set',
      short_case_summary: `${projectName} is a ${projectTypeLabel} project created for ${customerName}. The visual direction focused on ${theme}. ${deliverablesSummary}`,
      social_caption: `Portfolio update — ${projectName}, created for ${customerName}. Visual direction: ${theme}. ${deliverablesSummary}`,
      portfolio_description: `${projectName} is a ${projectTypeLabel} commission for ${customerName}, developed around ${theme}. ${deliverablesSummary}`
    };
  }
  if (tone === 'friendly') {
    return {
      case_title: 'Studio Client × Campaign Still Set',
      short_case_summary: `A closer look at ${projectName}, a ${projectTypeLabel} collaboration with ${customerName}. We shaped the visual direction around ${theme}. ${deliverablesSummary}`,
      social_caption: `Behind the scenes of ${projectName} with ${customerName}: ${theme}. ${deliverablesSummary}`,
      portfolio_description: `${projectName} documents a collaborative ${projectTypeLabel} process with ${customerName}, bringing ${theme} into the final delivery. ${deliverablesSummary}`
    };
  }
  return {
    case_title: 'Studio Client × Campaign Still Set',
    short_case_summary: `${projectName} brings together ${customerName} and a ${projectTypeLabel} story shaped by ${theme}. ${deliverablesSummary}`,
    social_caption: `A warm look at ${projectName}, created with ${customerName} around ${theme}. ${deliverablesSummary}`,
    portfolio_description: `${projectName} is a ${projectTypeLabel} story created with ${customerName}, guided by ${theme}. ${deliverablesSummary}`
  };
}

function expectedReply({ contextType, tone, customerName = 'Studio Client', keyPoints = ['交付包已经完成核对', '你可以先查看预览清单'] }) {
  const projectName = 'Campaign Still Set';
  const typeLabel = '商业摄影';
  const statusLabel = '确认与审阅中';
  const greeting = tone === 'formal' ? `${customerName}，您好。` : tone === 'friendly' ? `${customerName}，你好。` : `${customerName}，你好呀。`;
  const body = {
    quotation: {
      formal: [
        `关于项目“${projectName}”，我先将当前的报价方向和项目安排整理如下。`,
        `项目类型为${typeLabel}，后续方案会按这个方向继续细化。`
      ],
      friendly: [
        `关于项目“${projectName}”，我先把报价方向和项目安排整理给你。`,
        `这是一个${typeLabel}项目，我们可以继续按这个方向细化。`
      ],
      warm: [
        `关于项目“${projectName}”，我先把报价方向和整体安排整理给你。`,
        `这是一个${typeLabel}项目，我们可以一起把细节慢慢确认好。`
      ]
    },
    schedule: {
      formal: [`关于项目“${projectName}”，我想与您确认当前的排期安排。`, '目前计划的开始日期是 2026-06-26。'],
      friendly: [`关于项目“${projectName}”，我想和你确认一下当前排期。`, '目前计划的开始日期是 2026-06-26。'],
      warm: [`关于项目“${projectName}”，我们一起确认一下接下来的时间安排。`, '目前计划的开始日期是 2026-06-26。']
    },
    delivery: {
      formal: [`项目“${projectName}”正在进行交付准备。`, '目前计划的交付日期是 2026-06-30。'],
      friendly: [`项目“${projectName}”已经进入交付准备阶段。`, '目前计划的交付日期是 2026-06-30。'],
      warm: [`项目“${projectName}”正在认真准备交付。`, '目前计划的交付日期是 2026-06-30。']
    },
    general: {
      formal: [`现向您同步项目“${projectName}”的当前进展。`, `项目目前处于“${statusLabel}”。`],
      friendly: [`我来和你同步一下项目“${projectName}”的当前进展。`, `项目目前处于“${statusLabel}”。`],
      warm: [`我来和你分享一下项目“${projectName}”的最新进展。`, `项目目前处于“${statusLabel}”。`]
    }
  };
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
  const signature = tone === 'formal' ? '谢谢。' : tone === 'friendly' ? '谢谢配合。' : '感谢你的信任。';
  const lines = [greeting, '', ...body[contextType][tone]];
  if (keyPoints.length > 0) {
    lines.push('', '补充说明：');
    for (const point of keyPoints) lines.push(`- ${point}`);
  }
  lines.push('', closings[contextType][tone], signature);
  return lines.join('\n');
}

function safeFormalKeyPoints() {
  return ['请您确认报价方向', '项目安排保持不变'];
}

function safeInformalKeyPoints() {
  return ['你可以先查看预览清单', '项目安排保持不变'];
}

function replyMatrixPayload(contextType, tone, keyPoints) {
  return replyPayload({
    contextType,
    tone,
    keyPoints: keyPoints || (tone === 'formal' ? safeFormalKeyPoints() : safeInformalKeyPoints())
  });
}

const scenarios = [];
function add(name, fn) {
  scenarios.push({ name, fn });
}

add('package manifest is default off and still exposes only the three known actions', () => {
  const manifest = readJson(packageManifestPath);
  assert.equal(manifest.contractVersion, 2);
  assert.equal(manifest.packageId, 'jenn.photostudio.pure-snapshot-planning-adapters');
  assert.equal(manifest.defaultEnabled, false);
  assert.equal(manifest.runtimeEnabled, false);
  assert.equal(manifest.runtimeEligible, true);
  assert.equal(manifest.trustClass, 'ISOLATED_PROCESS');
  assert.equal(manifest.protocol, 'CANONICAL_JSONL_V1');
  assert.deepEqual(manifest.allowedActions, allActions);
});

add('package manifest denies all real backend data and write authorities', () => {
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
    'notificationSendAuthorized',
    'calendarWriteAuthorized',
    'externalSyncAuthorized',
    'persistentEnablementAuthorized'
  ]) assert.equal(manifest[key], false, key);
  assert.equal(manifest.syntheticShadowOnly, true);
  assert.equal(manifest.fullParityClaimed, false);
});

add('package manifest records reviewed version superseded and pending user acceptance', () => {
  const manifest = readJson(packageManifestPath);
  assert.equal(manifest.reviewedVersionSuperseded, true);
  assert.equal(manifest.userDirectedRevision, true);
  assert.equal(manifest.userAcceptanceStatus, 'PENDING');
  assert.deepEqual(manifest.creationIds.sort(), [caseCreationId, replyCreationId, priorityCreationId].sort());
});

add('profile manifest records V2 user-directed revision status', () => {
  const manifest = readJson(profileManifestPath);
  assert.equal(manifest.contractVersion, 2);
  assert.equal(manifest.reviewedVersionSuperseded, true);
  assert.equal(manifest.userDirectedRevision, true);
  assert.equal(manifest.userAcceptanceStatus, 'PENDING');
  assert.equal(manifest.profiles.length, 3);
});

add('profile manifest marks case and reply as intentional template divergence', () => {
  const profiles = new Map(readJson(profileManifestPath).profiles.map((profile) => [profile.creationId, profile]));
  for (const creationId of [caseCreationId, replyCreationId]) {
    assert.equal(profiles.get(creationId).legacyTemplateParityStatus, 'INTENTIONALLY_DIVERGED_BY_USER_REVISION');
    assert.equal(profiles.get(creationId).legacyTemplateEvidencePreserved, true);
    assert.equal(profiles.get(creationId).legacyTemplateParityRequired, false);
    assert.equal(profiles.get(creationId).userAcceptanceStatus, 'PENDING');
  }
});

add('profile manifest records reply pronoun-register policy', () => {
  const reply = readJson(profileManifestPath).profiles.find((profile) => profile.creationId === replyCreationId);
  assert.equal(reply.keyPointsPronounRegisterValidation, 'REQUIRED');
  assert.equal(reply.addressRegisters.formal, 'HONORIFIC_NIN');
  assert.equal(reply.addressRegisters.friendly, 'INFORMAL_NI');
  assert.equal(reply.addressRegisters.warm, 'INFORMAL_NI');
  assert.equal(reply.silentPronounRewriteAllowed, false);
  assert.equal(reply.fullContextToneTextReviewRequired, 12);
});

add('profile manifest records delivery advisory parity semantics', () => {
  const delivery = readJson(profileManifestPath).profiles.find((profile) => profile.creationId === priorityCreationId);
  assert.equal(delivery.priorityOrderParity, 'PRESERVED_WITH_EXPLICIT_TIE_BREAK_RULE');
  assert.equal(delivery.writeActionParity, 'INTENTIONALLY_NOT_PRESERVED');
  assert.equal(delivery.recommendationSemantics, 'ADVISORY_ONLY');
  assert.equal(delivery.realQueueParity, false);
});

add('index import remains pure and exports the three existing actions', () => {
  const before = Object.keys(globalThis).sort();
  const adapter = require(indexPath);
  const after = Object.keys(globalThis).sort();
  assert.deepEqual(after, before);
  assert.deepEqual(Object.values(adapter.ACTIONS), allActions);
  assert.deepEqual(Object.values(adapter.CREATION_IDS).sort(), [caseCreationId, replyCreationId, priorityCreationId].sort());
});

for (const tone of tones) {
  add(`case ${tone} draft matches user-directed V2 copy`, () => {
    const { buildCaseContentDraftFromSnapshot } = require(indexPath);
    const result = buildCaseContentDraftFromSnapshot(casePayload({ tone }));
    assert.deepEqual(result.draftVariants, expectedCase(tone));
    assert.equal(result.contractVersion, 2);
    assert.equal(result.legacyTemplateParityStatus, 'INTENTIONALLY_DIVERGED_BY_USER_REVISION');
    assert.equal(result.legacyTemplateEvidencePreserved, true);
    assert.equal(result.userDirectedRevision, true);
    assert.equal(result.fullParity, false);
  });
}

add('case title uses the directed multiplication separator', () => {
  const { buildCaseContentDraftFromSnapshot } = require(indexPath);
  assert.equal(buildCaseContentDraftFromSnapshot(casePayload()).draftVariants.case_title, 'Studio Client × Campaign Still Set');
});

add('case project type labels are mapped without raw enum leakage', () => {
  const { buildCaseContentDraftFromSnapshot } = require(indexPath);
  const result = buildCaseContentDraftFromSnapshot(casePayload({ contentItemSnapshot: { ...casePayload().contentItemSnapshot, project_type: 'wedding' } }));
  assert.match(result.draftVariants.short_case_summary, /wedding photography/);
  assert.doesNotMatch(result.draftVariants.short_case_summary, /\bwedding\b project created/);
});

add('case trims supplied strings but does not rewrite theme or deliverables', () => {
  const { buildCaseContentDraftFromSnapshot } = require(indexPath);
  const result = buildCaseContentDraftFromSnapshot(casePayload({
    contentItemSnapshot: {
      ...casePayload().contentItemSnapshot,
      theme: '  soft window light  ',
      deliverables_summary: '  Three selected images.  '
    }
  }));
  assert.match(result.draftVariants.short_case_summary, /soft window light\. Three selected images\.$/);
});

add('case fallback metadata blocks publication readiness', () => {
  const { buildCaseContentDraftFromSnapshot } = require(indexPath);
  const input = casePayload({
    contentItemSnapshot: {
      content_item_id: 'CONTENT-SYN-002',
      project_name: 'Minimal Project',
      project_type: 'other'
    }
  });
  const result = buildCaseContentDraftFromSnapshot(input);
  assert.equal(result.degraded, true);
  assert.equal(result.publishReady, false);
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.automaticPublicationAuthorized, false);
  assert.deepEqual(result.fallbackFields, ['customer_name', 'theme', 'deliverables_summary']);
  assert.deepEqual(result.warnings, ['CUSTOMER_NAME_FALLBACK_USED', 'THEME_FALLBACK_USED', 'DELIVERABLES_SUMMARY_FALLBACK_USED']);
  assert.match(result.draftVariants.case_title, /^\[Client Name\] × Minimal Project$/);
});

add('case non-fallback output still requires human review', () => {
  const { buildCaseContentDraftFromSnapshot } = require(indexPath);
  const result = buildCaseContentDraftFromSnapshot(casePayload());
  assert.deepEqual(result.fallbackFields, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.publishReady, false);
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.automaticPublicationAuthorized, false);
});

add('case rejects old projectSnapshot alias', () => {
  const { buildCaseContentDraftFromSnapshot } = require(indexPath);
  assert.throws(() => buildCaseContentDraftFromSnapshot({
    generatedAt: '2026-06-24T01:02:03.000Z',
    tone: 'formal',
    projectSnapshot: {}
  }), /input\.projectSnapshot/);
});

add('case rejects customerSnapshot alias', () => {
  const { buildCaseContentDraftFromSnapshot } = require(indexPath);
  assert.throws(() => buildCaseContentDraftFromSnapshot({ ...casePayload(), customerSnapshot: {} }), /input\.customerSnapshot/);
});

add('case rejects unknown content item snapshot fields', () => {
  const { buildCaseContentDraftFromSnapshot } = require(indexPath);
  assert.throws(() => buildCaseContentDraftFromSnapshot(casePayload({
    contentItemSnapshot: { ...casePayload().contentItemSnapshot, extra: 'no' }
  })), /contentItemSnapshot\.extra/);
});

add('case requires content_item_id or project_id', () => {
  const { buildCaseContentDraftFromSnapshot } = require(indexPath);
  const snapshot = { ...casePayload().contentItemSnapshot };
  delete snapshot.content_item_id;
  delete snapshot.project_id;
  assert.throws(() => buildCaseContentDraftFromSnapshot(casePayload({ contentItemSnapshot: snapshot })), /content_item_id or project_id/);
});

add('case rejects unsupported project type', () => {
  const { buildCaseContentDraftFromSnapshot } = require(indexPath);
  assert.throws(() => buildCaseContentDraftFromSnapshot(casePayload({
    contentItemSnapshot: { ...casePayload().contentItemSnapshot, project_type: 'catalog' }
  })), /project_type/);
});

add('case rejects missing generatedAt and implicit current time', () => {
  const { buildCaseContentDraftFromSnapshot } = require(indexPath);
  assert.throws(() => buildCaseContentDraftFromSnapshot(casePayload({ generatedAt: undefined })), /generatedAt/);
  assert.throws(() => buildCaseContentDraftFromSnapshot(casePayload({ generatedAt: 'today' })), /generatedAt/);
});

add('case is deterministic and does not mutate input', () => {
  const { buildCaseContentDraftFromSnapshot } = require(indexPath);
  const input = casePayload();
  const before = clone(input);
  assert.deepEqual(buildCaseContentDraftFromSnapshot(input), buildCaseContentDraftFromSnapshot(input));
  assert.deepEqual(input, before);
});

for (const contextType of contexts) {
  for (const tone of tones) {
    add(`reply golden V2 text ${contextType} ${tone}`, () => {
      const { buildClientReplyDraftFromSnapshot } = require(indexPath);
      const payload = replyMatrixPayload(contextType, tone);
      const result = buildClientReplyDraftFromSnapshot(payload);
      assert.equal(result.draftContent, expectedReply({ contextType, tone, keyPoints: payload.keyPoints }));
      assert.equal(result.contractVersion, 2);
      assert.equal(result.legacyTemplateParityStatus, 'INTENTIONALLY_DIVERGED_BY_USER_REVISION');
      assert.equal(result.requiresHumanReview, true);
      assert.equal(result.sendReady, false);
      assert.equal(result.dispatchAuthorized, false);
    });
  }
}

for (const contextType of contexts) {
  add(`reply formal register ${contextType} uses honorific 您 and excludes informal 你`, () => {
    const { buildClientReplyDraftFromSnapshot } = require(indexPath);
    const result = buildClientReplyDraftFromSnapshot(replyMatrixPayload(contextType, 'formal'));
    assert.equal(result.addressRegister, 'HONORIFIC_NIN');
    assert.equal(result.pronounConsistencyChecked, true);
    assert.equal(result.keyPointsPronounConsistencyChecked, true);
    assert.match(result.draftContent, /您/);
    assert.doesNotMatch(result.draftContent, /你/);
  });
}

for (const contextType of contexts) {
  for (const tone of ['friendly', 'warm']) {
    add(`reply ${tone} register ${contextType} uses informal 你 and excludes honorific 您`, () => {
      const { buildClientReplyDraftFromSnapshot } = require(indexPath);
      const result = buildClientReplyDraftFromSnapshot(replyMatrixPayload(contextType, tone));
      assert.equal(result.addressRegister, 'INFORMAL_NI');
      assert.match(result.draftContent, /你/);
      assert.doesNotMatch(result.draftContent, /您/);
    });
  }
}

add('reply matrix has exactly four formal and eight informal cases', () => {
  const matrix = contexts.flatMap((contextType) => tones.map((tone) => ({ contextType, tone })));
  assert.equal(matrix.filter((item) => item.tone === 'formal').length, 4);
  assert.equal(matrix.filter((item) => item.tone !== 'formal').length, 8);
});

add('reply customer fallback uses Chinese placeholder and keeps dispatch disabled', () => {
  const { buildClientReplyDraftFromSnapshot } = require(indexPath);
  const result = buildClientReplyDraftFromSnapshot(replyPayload({
    tone: 'formal',
    keyPoints: safeFormalKeyPoints(),
    customerSnapshot: {}
  }));
  assert.match(result.draftContent, /^\[客户姓名\]，您好。/);
  assert.deepEqual(result.fallbackFields, ['customer_name']);
  assert.deepEqual(result.warnings, ['CUSTOMER_NAME_FALLBACK_USED']);
  assert.equal(result.sendReady, false);
  assert.equal(result.dispatchAuthorized, false);
});

add('reply null and undefined keyPoints are treated as empty arrays', () => {
  const { buildClientReplyDraftFromSnapshot } = require(indexPath);
  assert.equal(buildClientReplyDraftFromSnapshot(replyPayload({ keyPoints: null })).draftContent.includes('补充说明：'), false);
  assert.equal(buildClientReplyDraftFromSnapshot(replyPayload({ keyPoints: undefined })).draftContent.includes('补充说明：'), false);
});

add('reply trims keyPoints and preserves supplied order without punctuation rewrite', () => {
  const { buildClientReplyDraftFromSnapshot } = require(indexPath);
  const result = buildClientReplyDraftFromSnapshot(replyPayload({ keyPoints: ['  你先看第一项  ', '第二项'] }));
  assert.match(result.draftContent, /- 你先看第一项\n- 第二项/);
});

add('reply keeps lexicalized 迷你 neutral for formal tone', () => {
  const { buildClientReplyDraftFromSnapshot } = require(indexPath);
  const result = buildClientReplyDraftFromSnapshot(replyPayload({ tone: 'formal', keyPoints: ['迷你相册已经整理好'] }));
  assert.match(result.draftContent, /迷你相册已经整理好/);
});

add('reply classifier distinguishes honorific informal neutral and mixed', () => {
  const { classifyPronounRegister } = require(replyPath);
  assert.equal(classifyPronounRegister('请您确认'), 'HONORIFIC_NIN');
  assert.equal(classifyPronounRegister('你可以确认'), 'INFORMAL_NI');
  assert.equal(classifyPronounRegister('项目安排保持不变'), 'NEUTRAL');
  assert.equal(classifyPronounRegister('请您和你一起确认'), 'MIXED');
});

for (const [name, tone, keyPoints] of [
  ['formal rejects informal 你', 'formal', ['你可以确认']],
  ['formal rejects mixed 您 and 你', 'formal', ['请您和你一起确认']],
  ['formal rejects informal second point', 'formal', ['项目安排保持不变', '你的选择已记录']],
  ['friendly rejects honorific 您', 'friendly', ['请您确认']],
  ['friendly rejects mixed register', 'friendly', ['请您和你一起确认']],
  ['warm rejects honorific 您', 'warm', ['请您确认']],
  ['warm rejects mixed register', 'warm', ['您可以和你一起看']],
  ['friendly rejects honorific second point', 'friendly', ['项目安排保持不变', '您的选择已记录']],
  ['warm rejects honorific after trim', 'warm', ['  您可以确认  ']]
]) {
  add(`reply pronoun conflict ${name}`, () => {
    const { buildClientReplyDraftFromSnapshot } = require(indexPath);
    assert.throws(() => buildClientReplyDraftFromSnapshot(replyPayload({ tone, keyPoints })), (error) => {
      assert.equal(error.code, 'PRONOUN_REGISTER_CONFLICT');
      assert.equal(error.message, 'key_points contains a second-person address form that conflicts with the selected tone.');
      return true;
    });
  });
}

for (const [name, tone, keyPoints] of [
  ['formal accepts honorific', 'formal', ['请您确认']],
  ['formal accepts neutral', 'formal', ['项目安排保持不变']],
  ['formal accepts lexicalized mini', 'formal', ['迷你相册已整理']],
  ['friendly accepts informal', 'friendly', ['你可以确认']],
  ['friendly accepts neutral', 'friendly', ['项目安排保持不变']],
  ['warm accepts informal', 'warm', ['你可以慢慢看']],
  ['warm accepts neutral', 'warm', ['项目安排保持不变']],
  ['friendly accepts lexicalized mini', 'friendly', ['迷你相册已整理']],
  ['warm accepts lexicalized mini', 'warm', ['迷你相册已整理']]
]) {
  add(`reply pronoun acceptance ${name}`, () => {
    const { buildClientReplyDraftFromSnapshot } = require(indexPath);
    const result = buildClientReplyDraftFromSnapshot(replyPayload({ tone, keyPoints }));
    assert.equal(result.keyPointsPronounConsistencyChecked, true);
  });
}

for (const [field, value] of [
  ['project_type', 'catalog'],
  ['status', 'ready']
]) {
  add(`reply rejects unsupported ${field}`, () => {
    const { buildClientReplyDraftFromSnapshot } = require(indexPath);
    assert.throws(() => buildClientReplyDraftFromSnapshot(replyPayload({
      projectSnapshot: { ...replyPayload().projectSnapshot, [field]: value }
    })), new RegExp(field));
  });
}

add('reply rejects missing project_id', () => {
  const { buildClientReplyDraftFromSnapshot } = require(indexPath);
  const projectSnapshot = { ...replyPayload().projectSnapshot };
  delete projectSnapshot.project_id;
  assert.throws(() => buildClientReplyDraftFromSnapshot(replyPayload({ projectSnapshot })), /project_id/);
});

add('reply rejects unknown root and snapshot fields', () => {
  const { buildClientReplyDraftFromSnapshot } = require(indexPath);
  assert.throws(() => buildClientReplyDraftFromSnapshot({ ...replyPayload(), extra: true }), /input\.extra/);
  assert.throws(() => buildClientReplyDraftFromSnapshot(replyPayload({
    projectSnapshot: { ...replyPayload().projectSnapshot, projectName: 'old alias' }
  })), /projectSnapshot\.projectName/);
});

add('reply rejects invalid keyPoint shapes', () => {
  const { buildClientReplyDraftFromSnapshot } = require(indexPath);
  assert.throws(() => buildClientReplyDraftFromSnapshot(replyPayload({ keyPoints: 'bad' })), /keyPoints must be an array/);
  assert.throws(() => buildClientReplyDraftFromSnapshot(replyPayload({ keyPoints: [''] })), /keyPoints entries/);
  assert.throws(() => buildClientReplyDraftFromSnapshot(replyPayload({ keyPoints: [1] })), /keyPoints entries/);
});

add('reply output avoids old fixed phrases and raw enum values', () => {
  const { buildClientReplyDraftFromSnapshot } = require(indexPath);
  const result = buildClientReplyDraftFromSnapshot(replyPayload({ tone: 'warm', keyPoints: safeInformalKeyPoints() }));
  assert.doesNotMatch(result.draftContent, /沟通口径|辛苦啦|期待这次合作/);
  assert.doesNotMatch(result.draftContent, /commercial|reviewing/);
});

add('reply is deterministic and does not mutate input', () => {
  const { buildClientReplyDraftFromSnapshot } = require(indexPath);
  const input = replyPayload();
  const before = clone(input);
  assert.deepEqual(buildClientReplyDraftFromSnapshot(input), buildClientReplyDraftFromSnapshot(input));
  assert.deepEqual(input, before);
});

add('delivery output ranks failed retry ready queued future retry', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const result = buildDeliveryPriorityFromSnapshot(priorityPayload());
  assert.deepEqual(result.prioritizedActions.map((item) => item.recommendationCode), [
    'REVIEW_FAILED_DELIVERY',
    'REVIEW_RETRY_DUE',
    'REVIEW_PUBLISH_READINESS',
    'MONITOR_QUEUED_DELIVERY',
    'WAIT_FOR_RETRY_WINDOW'
  ]);
});

add('delivery output is advisory only and never authorizes mutation', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const result = buildDeliveryPriorityFromSnapshot(priorityPayload());
  for (const item of result.prioritizedActions) {
    assert.equal(item.recommendationType, 'ADVISORY_ONLY');
    assert.equal(item.executionAuthorized, false);
    assert.equal(item.stateMutationAuthorized, false);
  }
});

add('delivery top-level parity semantics are explicit', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const result = buildDeliveryPriorityFromSnapshot(priorityPayload());
  assert.equal(result.contractVersion, 2);
  assert.equal(result.priorityOrderParity, 'preserved');
  assert.equal(result.writeActionParity, 'intentionally_not_preserved');
  assert.equal(result.recommendationSemantics, 'ADVISORY_ONLY');
  assert.equal(result.realQueueParity, false);
  assert.equal(result.fullParity, false);
});

add('delivery summary counts are computed before maxItems truncation', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const result = buildDeliveryPriorityFromSnapshot(priorityPayload({ maxItems: 2 }));
  assert.equal(result.summary.totalMatchedRecords, 6);
  assert.equal(result.summary.actionableRecords, 5);
  assert.equal(result.summary.returnedItems, 2);
  assert.equal(result.summary.excludedRecords, 1);
  assert.equal(result.summary.failedCount, 1);
  assert.equal(result.summary.retryDueCount, 1);
  assert.equal(result.summary.readyToPublishCount, 1);
  assert.equal(result.summary.queuedCount, 1);
  assert.equal(result.summary.futureRetryCount, 1);
  assert.equal(result.summary.maxItemsApplied, true);
  assert.equal(result.summary.maxItemsValue, 2);
});

add('delivery maxItems omitted returns all actionable items', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const result = buildDeliveryPriorityFromSnapshot(priorityPayload());
  assert.equal(result.summary.returnedItems, 5);
  assert.equal(result.summary.maxItemsApplied, false);
  assert.equal(result.summary.maxItemsValue, null);
});

add('delivery exact scope filters by export key', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const result = buildDeliveryPriorityFromSnapshot(priorityPayload({ scope: { exportKey: 'EXP-READY' } }));
  assert.equal(result.summary.totalMatchedRecords, 1);
  assert.equal(result.prioritizedActions[0].exportKey, 'EXP-READY');
});

add('delivery exact scope filters by target type and delivery state with AND semantics', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const result = buildDeliveryPriorityFromSnapshot(priorityPayload({ scope: { targetType: 'archive', deliveryState: 'queued' } }));
  assert.equal(result.summary.totalMatchedRecords, 1);
  assert.equal(result.prioritizedActions[0].exportKey, 'EXP-QUEUED');
});

add('delivery project scope can match export row project_id', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const result = buildDeliveryPriorityFromSnapshot(priorityPayload({
    externalExportSnapshots: [
      {
        export_key: 'EXP-ROW',
        target_type: 'archive',
        delivery_state: 'queued',
        export_rows: [{ project_id: 'PRJ-ROW-001' }]
      }
    ],
    scope: { projectId: 'PRJ-ROW-001' }
  }));
  assert.equal(result.summary.totalMatchedRecords, 1);
  assert.equal(result.prioritizedActions[0].projectId, 'PRJ-ROW-001');
});

add('delivery scope is case-sensitive', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const result = buildDeliveryPriorityFromSnapshot(priorityPayload({ scope: { exportKey: 'exp-ready' } }));
  assert.equal(result.summary.totalMatchedRecords, 0);
  assert.equal(result.prioritizedActions.length, 0);
});

add('delivery rejects unknown scope key and empty scope value', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  assert.throws(() => buildDeliveryPriorityFromSnapshot(priorityPayload({ scope: { unknown: 'x' } })), /scope\.unknown/);
  assert.throws(() => buildDeliveryPriorityFromSnapshot(priorityPayload({ scope: { projectId: '  ' } })), /scope\.projectId/);
});

add('delivery rejects invalid maxItems boundaries', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  assert.throws(() => buildDeliveryPriorityFromSnapshot(priorityPayload({ maxItems: 0 })), /maxItems/);
  assert.throws(() => buildDeliveryPriorityFromSnapshot(priorityPayload({ maxItems: 101 })), /maxItems/);
  assert.throws(() => buildDeliveryPriorityFromSnapshot(priorityPayload({ maxItems: 1.5 })), /maxItems/);
});

add('delivery tie-break uses schedule date ascending then updated_at descending then input index', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const result = buildDeliveryPriorityFromSnapshot(priorityPayload({
    externalExportSnapshots: [
      { project_id: 'P1', export_key: 'C', target_type: 'x', delivery_state: 'failed', schedule_date: '2026-06-25', updated_at: '2026-06-20T01:00:00.000Z' },
      { project_id: 'P2', export_key: 'A', target_type: 'x', delivery_state: 'failed', schedule_date: '2026-06-24', updated_at: '2026-06-20T01:00:00.000Z' },
      { project_id: 'P3', export_key: 'B', target_type: 'x', delivery_state: 'failed', schedule_date: '2026-06-24', updated_at: '2026-06-21T01:00:00.000Z' }
    ]
  }));
  assert.deepEqual(result.prioritizedActions.map((item) => item.exportKey), ['B', 'A', 'C']);
});

add('delivery missing updated_at sorts after populated value for same rank and schedule', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const result = buildDeliveryPriorityFromSnapshot(priorityPayload({
    externalExportSnapshots: [
      { project_id: 'P1', export_key: 'NO-UPD', target_type: 'x', delivery_state: 'failed', schedule_date: '2026-06-24' },
      { project_id: 'P2', export_key: 'WITH-UPD', target_type: 'x', delivery_state: 'failed', schedule_date: '2026-06-24', updated_at: '2026-06-21T01:00:00.000Z' }
    ]
  }));
  assert.deepEqual(result.prioritizedActions.map((item) => item.exportKey), ['WITH-UPD', 'NO-UPD']);
});

add('delivery excludes retry_scheduled without retry date', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const result = buildDeliveryPriorityFromSnapshot(priorityPayload({
    externalExportSnapshots: [
      { project_id: 'P1', export_key: 'NO-DATE', target_type: 'x', delivery_state: 'retry_scheduled' }
    ]
  }));
  assert.equal(result.summary.actionableRecords, 0);
  assert.equal(result.summary.excludedRecords, 1);
});

add('delivery rejects missing referenceDate and invalid generatedAt when supplied', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  assert.throws(() => buildDeliveryPriorityFromSnapshot(priorityPayload({ referenceDate: undefined })), /referenceDate/);
  assert.throws(() => buildDeliveryPriorityFromSnapshot(priorityPayload({ generatedAt: 'today' })), /generatedAt/);
});

add('delivery does not fabricate generatedAt when omitted', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  assert.equal(Object.prototype.hasOwnProperty.call(buildDeliveryPriorityFromSnapshot(priorityPayload()), 'generatedAt'), false);
});

add('delivery preserves explicit generatedAt when supplied', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  assert.equal(buildDeliveryPriorityFromSnapshot(priorityPayload({ generatedAt: '2026-06-24T01:02:03.000Z' })).generatedAt, '2026-06-24T01:02:03.000Z');
});

add('delivery output contains no old write action labels', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const text = JSON.stringify(buildDeliveryPriorityFromSnapshot(priorityPayload()));
  assert.doesNotMatch(text, /mark_queued|reschedule_retry|mark_delivered|mark_failed/);
});

add('delivery is deterministic and does not mutate input', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  const input = priorityPayload();
  const before = clone(input);
  assert.deepEqual(buildDeliveryPriorityFromSnapshot(input), buildDeliveryPriorityFromSnapshot(input));
  assert.deepEqual(input, before);
});

for (const [action, creationId, payloadFactory] of [
  [caseAction, caseCreationId, casePayload],
  [replyAction, replyCreationId, () => replyPayload({ tone: 'friendly', keyPoints: safeInformalKeyPoints() })],
  [priorityAction, priorityCreationId, priorityPayload]
]) {
  add(`JSONL handler accepts ${action}`, () => {
    const response = handle(request(action, creationId, payloadFactory()));
    assertSuccessEnvelope(response);
    assert.equal(response.result.contractVersion, 2);
  });
}

add('JSONL handler rejects action and creation mismatches', () => {
  assertErrorEnvelope(handle(request(caseAction, replyCreationId, casePayload())));
  assertErrorEnvelope(handle(request(replyAction, caseCreationId, replyPayload())));
  assertErrorEnvelope(handle(request('*', caseCreationId, casePayload())));
  assertErrorEnvelope(handle(request('unknown', caseCreationId, casePayload())));
});

add('JSONL handler rejects payload routing collisions', () => {
  const response = handle(request(caseAction, caseCreationId, { ...casePayload(), action: caseAction }));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'PAYLOAD_ACTION_COLLISION');
  assertErrorEnvelope(handle(request(caseAction, caseCreationId, { ...casePayload(), tool_name: 'bad' })));
});

add('JSONL handler rejects prototype-pollution-shaped requests', () => {
  const polluted = JSON.parse('{"protocolVersion":1,"requestId":"11111111-1111-4111-8111-111111111111","creationId":"jenn.photo-studio.plugin-case-content-draft","action":"build_case_content_draft_from_snapshot","payload":{"__proto__":{"polluted":true}}}');
  const response = handle(polluted);
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'PROTOTYPE_POLLUTION_KEY');
});

add('JSONL handler rejects protected data-shaped keys', () => {
  const response = handle(request(replyAction, replyCreationId, {
    ...replyPayload(),
    ['access' + 'Token']: 'x'
  }));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'PROTECTED_DATA_KEY_DENIED');
});

add('JSONL handler rejects excessive depth', () => {
  let nested = {};
  for (let i = 0; i < 14; i += 1) nested = { child: nested };
  const response = handle(request(priorityAction, priorityCreationId, nested));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'JSON_DEPTH_EXCEEDED');
});

add('parser requires exactly one newline-terminated JSON line', () => {
  const { parseLine } = require(entrypointPath);
  const line = JSON.stringify(request(caseAction, caseCreationId, casePayload()));
  assert.equal(parseLine(line).ok, false);
  assert.equal(parseLine(`${line}\n{}\n`).ok, false);
  assert.equal(parseLine(`${line}\n`).ok, true);
});

add('JSONL handler preserves safe pronoun conflict code without leaking raw key point', () => {
  const response = handle(request(replyAction, replyCreationId, replyPayload({ tone: 'formal', keyPoints: ['你可以确认'] })));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'PRONOUN_REGISTER_CONFLICT');
  assert.equal(response.error.message, 'key_points contains a second-person address form that conflicts with the selected tone.');
  assert.doesNotMatch(JSON.stringify(response), /你可以确认|keyPoints|stack|details|path/i);
});

add('JSONL handler maps non-pronoun projection failures to generic code', () => {
  const response = handle(request(caseAction, caseCreationId, casePayload({ tone: 'casual' })));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'PROJECTION_REJECTED');
});

add('JSONL handler rejects missing request id', () => {
  const response = handle(request(caseAction, caseCreationId, casePayload(), { requestId: '' }));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'REQUEST_ID_REQUIRED');
});

add('success and failure envelope keys remain minimal', () => {
  const success = handle(request(caseAction, caseCreationId, casePayload()));
  const failure = handle(request('bad-action', caseCreationId, casePayload()));
  assert.deepEqual(sortedKeys(success), ['creationId', 'ok', 'protocolVersion', 'requestId', 'result']);
  assert.deepEqual(sortedKeys(failure), ['creationId', 'error', 'ok', 'protocolVersion', 'requestId']);
  assert.equal(success.action, undefined);
  assert.equal(failure.action, undefined);
});

add('runtime modules contain no filesystem network child-process env logging or current-time APIs', () => {
  for (const filePath of [indexPath, casePath, replyPath, priorityPath, entrypointPath]) {
    const text = sourceText(filePath);
    assert.doesNotMatch(text, /require\(['"]fs['"]\)/);
    assert.doesNotMatch(text, /require\(['"]https?['"]\)/);
    assert.doesNotMatch(text, /require\(['"]net['"]\)/);
    assert.doesNotMatch(text, /require\(['"]tls['"]\)/);
    assert.doesNotMatch(text, /require\(['"]child_process['"]\)/);
    assert.doesNotMatch(text, /worker_threads/);
    assert.doesNotMatch(text, /process\.env/);
    assert.doesNotMatch(text, /console\./);
    assert.doesNotMatch(text, /Date\.now|new Date/);
  }
});

add('runtime modules and manifests contain no absolute local paths or backend URLs', () => {
  for (const filePath of [indexPath, casePath, replyPath, priorityPath, entrypointPath, packageManifestPath, profileManifestPath]) {
    const text = sourceText(filePath);
    assert.doesNotMatch(text, /[A-Za-z]:\\/);
    assert.doesNotMatch(text, /https?:\/\//);
    assert.doesNotMatch(text, /localhost/);
  }
});

add('package contains no retirement deletion discard or full parity claim', () => {
  const text = [
    sourceText(packageManifestPath),
    sourceText(profileManifestPath),
    sourceText(indexPath),
    sourceText(casePath),
    sourceText(replyPath),
    sourceText(priorityPath)
  ].join('\n');
  for (const term of [
    ['USER', 'APPROVED', 'RETIREMENT'].join('_'),
    'RET' + 'IRED',
    'DIS' + 'CARDED',
    'DEL' + 'ETED'
  ]) assert.equal(text.includes(term), false);
  assert.equal(text.includes('"fullParity": true'), false);
  assert.equal(text.includes('"fullParityClaimed": true'), false);
});

add('package source does not import legacy plugins services or private data paths', () => {
  for (const filePath of [indexPath, casePath, replyPath, priorityPath, entrypointPath]) {
    const text = sourceText(filePath);
    assert.doesNotMatch(text, /plugins\/custom\/shared\/photo_studio_data/);
    assert.doesNotMatch(text, /modules\/photoStudio/);
    assert.doesNotMatch(text, /\.env|config\.env|LocalState|PostgreSQL|Prisma/);
  }
});

add('manifest action ordering and command mapping remain exact', () => {
  const manifest = readJson(packageManifestPath);
  assert.deepEqual(manifest.allowedActions, allActions);
  assert.deepEqual(manifest.capabilities.invocationCommands.map((item) => item.commandIdentifier), allActions);
  assert.deepEqual(manifest.capabilities.invocationCommands.map((item) => item.creationId), [
    caseCreationId,
    replyCreationId,
    priorityCreationId
  ]);
});

add('projection rejects missing required snapshots', () => {
  const { buildCaseContentDraftFromSnapshot, buildClientReplyDraftFromSnapshot, buildDeliveryPriorityFromSnapshot } = require(indexPath);
  assert.throws(() => buildCaseContentDraftFromSnapshot({ generatedAt: '2026-06-24T01:02:03.000Z', tone: 'formal' }), /contentItemSnapshot/);
  assert.throws(() => buildClientReplyDraftFromSnapshot({ generatedAt: '2026-06-24T01:02:03.000Z' }), /projectSnapshot/);
  assert.throws(() => buildDeliveryPriorityFromSnapshot({ referenceDate: '2026-06-24' }), /externalExportSnapshots/);
});

add('runtime module imports do not mutate global state', () => {
  const before = Object.keys(globalThis).sort();
  require(casePath);
  require(replyPath);
  require(priorityPath);
  require(entrypointPath);
  const after = Object.keys(globalThis).sort();
  assert.deepEqual(after, before);
});

for (const [projectType, label] of [
  ['wedding', 'wedding photography'],
  ['portrait', 'portrait photography'],
  ['commercial', 'commercial photography'],
  ['event', 'event photography'],
  ['other', 'photography']
]) {
  add(`case maps project_type ${projectType} to ${label}`, () => {
    const { buildCaseContentDraftFromSnapshot } = require(indexPath);
    const result = buildCaseContentDraftFromSnapshot(casePayload({
      tone: 'formal',
      contentItemSnapshot: { ...casePayload().contentItemSnapshot, project_type: projectType }
    }));
    assert.match(result.draftVariants.short_case_summary, new RegExp(label));
  });
}

add('reply schedule fallback says start date remains pending', () => {
  const { buildClientReplyDraftFromSnapshot } = require(indexPath);
  const projectSnapshot = { ...replyPayload().projectSnapshot };
  delete projectSnapshot.start_date;
  const result = buildClientReplyDraftFromSnapshot(replyPayload({
    contextType: 'schedule',
    tone: 'friendly',
    keyPoints: safeInformalKeyPoints(),
    projectSnapshot
  }));
  assert.match(result.draftContent, /开始日期仍待确认。/);
});

add('reply delivery fallback says delivery date remains pending', () => {
  const { buildClientReplyDraftFromSnapshot } = require(indexPath);
  const projectSnapshot = { ...replyPayload().projectSnapshot };
  delete projectSnapshot.due_date;
  const result = buildClientReplyDraftFromSnapshot(replyPayload({
    contextType: 'delivery',
    tone: 'warm',
    keyPoints: safeInformalKeyPoints(),
    projectSnapshot
  }));
  assert.match(result.draftContent, /交付日期仍待确认。/);
});

add('delivery maxItems accepts lower and upper boundaries', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  assert.equal(buildDeliveryPriorityFromSnapshot(priorityPayload({ maxItems: 1 })).summary.returnedItems, 1);
  assert.equal(buildDeliveryPriorityFromSnapshot(priorityPayload({ maxItems: 100 })).summary.returnedItems, 5);
});

add('delivery rejects unknown root field', () => {
  const { buildDeliveryPriorityFromSnapshot } = require(indexPath);
  assert.throws(() => buildDeliveryPriorityFromSnapshot({ ...priorityPayload(), unknown: true }), /input\.unknown/);
});

add('parser rejects malformed JSON without stack text', () => {
  const { parseLine } = require(entrypointPath);
  const response = parseLine('{bad}\n').response;
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'JSON_PARSE_FAILED');
  assert.doesNotMatch(JSON.stringify(response), /stack|SyntaxError/i);
});

add('failure response redacts path and bearer-shaped values', () => {
  const syntheticPath = ['C:', 'secret', 'path'].join('\\');
  const syntheticBearer = ['Bearer', 'abc.def.ghi'].join(' ');
  const response = handle(request('bad-action', caseCreationId, {
    note: `${syntheticPath} ${syntheticBearer}`
  }));
  assert.equal(response.ok, false);
  assert.equal(response.error.message.includes(syntheticPath), false);
  assert.equal(response.error.message.includes('abc.def'), false);
});

add('required focused test coverage count is at least 126', () => {
  assert.ok(scenarios.length >= 126);
});

for (let i = 0; i < scenarios.length; i += 1) {
  test(`${String(i + 1).padStart(3, '0')} ${scenarios[i].name}`, scenarios[i].fn);
}
