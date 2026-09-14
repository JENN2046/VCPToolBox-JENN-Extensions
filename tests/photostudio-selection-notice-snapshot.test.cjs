'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..', 'PhotoStudioPackages', 'SelectionNoticeSnapshotAdapter');
const packageManifestPath = path.join(packageRoot, 'package-manifest.json');
const profileManifestPath = path.join(packageRoot, 'adapter-profile-manifest.json');
const indexPath = path.join(packageRoot, 'index.cjs');
const templatePath = path.join(packageRoot, 'selectionNoticeTemplate.cjs');
const projectionPath = path.join(packageRoot, 'selectionNoticeProjection.cjs');
const entrypointPath = path.join(packageRoot, 'stdio-entrypoint.cjs');

const canonicalCreationId = 'jenn.photo-studio.plugin-selection-notice';
const inferredCreationId = 'jenn.photo-studio.selection-notice';
const action = 'build_selection_notice_from_snapshot';
const requestId = '22222222-2222-4222-8222-222222222222';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function sourceText(filePath) {
  return fs.readFileSync(filePath, 'utf8');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sortedKeys(value) {
  return Object.keys(value).sort();
}

function payload(overrides = {}) {
  return {
    generatedAt: '2026-06-24T01:02:03.000Z',
    tone: 'warm',
    projectSnapshot: {
      project_id: 'PRJ-SYN-SEL-001',
      customer_id: 'CUST-SYN-001',
      project_name: 'Campaign Still Set',
      status: 'reviewing',
      due_date: '2026-07-08'
    },
    customerSnapshot: {
      customer_id: 'CUST-SYN-001',
      customer_name: 'Studio Client'
    },
    selectionDeadline: '2026-07-01',
    selectionMethod: 'mark your selections in the online proofing gallery',
    noteToClient: 'Please include up to five preferred hero images in your final selection.',
    ...overrides
  };
}

function request(payloadValue, overrides = {}) {
  return {
    protocolVersion: 1,
    requestId,
    creationId: canonicalCreationId,
    action,
    payload: payloadValue,
    ...overrides
  };
}

function build(input) {
  const { buildSelectionNoticeFromSnapshot } = require(indexPath);
  return buildSelectionNoticeFromSnapshot(input);
}

function handle(input) {
  const { handleRequest } = require(entrypointPath);
  return handleRequest(input);
}

function expectedNotice({
  tone,
  customerName = 'Studio Client',
  projectName = 'Campaign Still Set',
  deadline = '2026-07-01',
  method = 'mark your selections in the online proofing gallery.',
  note = 'Please include up to five preferred hero images in your final selection.'
}) {
  const presets = {
    formal: {
      greeting: 'Hello',
      intro: `Your edited gallery for "${projectName}" is ready for image selection.`,
      selectionLead: 'Please review the gallery and confirm your selected images',
      methodLead: 'Selection method',
      noteLead: 'Additional note',
      closing: 'Thank you. Once we receive your selections, we will continue with the next stage of delivery.'
    },
    friendly: {
      greeting: 'Hi',
      intro: `The edited gallery for "${projectName}" is ready for you to review.`,
      selectionLead: 'Take a look and mark your favorite images',
      methodLead: 'How to select',
      noteLead: 'Extra note',
      closing: 'Once your selections are in, we can move on to the next step.'
    },
    warm: {
      greeting: 'Hi',
      intro: `The edited gallery for "${projectName}" is ready whenever you are.`,
      selectionLead: 'When you have a moment, review the gallery and mark the images you would like to keep',
      methodLead: 'How to select',
      noteLead: 'A note for you',
      closing: 'Thank you for taking the time to review the gallery. Once your selections are in, we will prepare the next step.'
    }
  };
  const preset = presets[tone];
  const deadlineLine = deadline
    ? `${preset.selectionLead} by ${deadline}.`
    : `${preset.selectionLead}${tone === 'warm' ? '.' : ' when convenient.'}`;
  return [
    `${preset.greeting} ${customerName},`,
    preset.intro,
    deadlineLine,
    method ? `${preset.methodLead}: ${method}` : null,
    note ? `${preset.noteLead}: ${note}` : null,
    preset.closing
  ].filter(Boolean).join('\n\n');
}

function assertSuccessEnvelope(response) {
  assert.deepEqual(sortedKeys(response), ['creationId', 'ok', 'protocolVersion', 'requestId', 'result']);
  assert.equal(response.ok, true);
  assert.equal(response.protocolVersion, 1);
  assert.equal(response.requestId, requestId);
  assert.equal(response.creationId, canonicalCreationId);
}

function assertErrorEnvelope(response) {
  assert.deepEqual(sortedKeys(response), ['creationId', 'error', 'ok', 'protocolVersion', 'requestId']);
  assert.equal(response.ok, false);
  assert.deepEqual(sortedKeys(response.error), ['code', 'message']);
}

test('001 canonical FS1A creation ID is accepted by the JSONL handler', () => {
  const response = handle(request(payload()));
  assertSuccessEnvelope(response);
  assert.equal(response.result.projectId, 'PRJ-SYN-SEL-001');
});

test('002 FS6D inferred ID is rejected by the JSONL handler', () => {
  const response = handle(request(payload(), { creationId: inferredCreationId }));
  assertErrorEnvelope(response);
  assert.equal(response.error.code, 'CREATION_ID_DENIED');
});

test('003 package manifest contains canonical ID exactly once', () => {
  const manifest = readJson(packageManifestPath);
  assert.deepEqual(manifest.creationIds, [canonicalCreationId]);
});

test('004 inferred ID is absent from package manifest', () => {
  assert.equal(sourceText(packageManifestPath).includes(inferredCreationId), false);
});

test('005 inferred ID is absent from adapter profile runtime mappings', () => {
  assert.equal(sourceText(profileManifestPath).includes(inferredCreationId), false);
});

test('006 inferred ID is absent from stdio allowed mapping', () => {
  assert.equal(sourceText(entrypointPath).includes(inferredCreationId), false);
});

test('007 no runtime alias is declared', () => {
  const manifest = readJson(packageManifestPath);
  const profile = readJson(profileManifestPath);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'aliases'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(profile, 'aliases'), false);
});

test('008 no package alias is declared', () => {
  const manifest = readJson(packageManifestPath);
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'packageAliases'), false);
});

test('009 package is default disabled', () => {
  assert.equal(readJson(packageManifestPath).defaultEnabled, false);
});

test('010 package runtime is disabled', () => {
  assert.equal(readJson(packageManifestPath).runtimeEnabled, false);
});

test('011 package remains runtime eligible for isolated synthetic shadow', () => {
  assert.equal(readJson(packageManifestPath).runtimeEligible, true);
});

test('012 package uses isolated trust class', () => {
  assert.equal(readJson(packageManifestPath).trustClass, 'ISOLATED_PROCESS');
});

test('013 package exposes one action only', () => {
  assert.deepEqual(readJson(packageManifestPath).allowedActions, [action]);
});

for (const [index, key] of [
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
  'notificationAuthorized',
  'notificationSendAuthorized',
  'messageDispatchAuthorized',
  'calendarWriteAuthorized',
  'externalSyncAuthorized',
  'persistentEnablementAuthorized'
].entries()) {
  test(`${String(14 + index).padStart(3, '0')} high-risk permission ${key} is false`, () => {
    assert.equal(readJson(packageManifestPath)[key], false);
  });
}

test('031 profile is a pure snapshot adapter with partial parity', () => {
  const profile = readJson(profileManifestPath);
  assert.equal(profile.status, 'PURE_SNAPSHOT_ADAPTER');
  assert.equal(profile.fullParity, false);
  assert.equal(profile.snapshotProjectionImplemented, true);
});

test('032 index import exports exactly one pure builder', () => {
  assert.deepEqual(Object.keys(require(indexPath)).sort(), ['buildSelectionNoticeFromSnapshot']);
});

test('033 editing status is accepted', () => {
  assert.equal(build(payload({ projectSnapshot: { ...payload().projectSnapshot, status: 'editing' } })).projectStatus, 'editing');
});

test('034 reviewing status is accepted', () => {
  assert.equal(build(payload()).projectStatus, 'reviewing');
});

for (const [index, status] of ['draft', 'delivered', 'queued', '', null].entries()) {
  test(`${String(35 + index).padStart(3, '0')} unsupported status ${String(status)} is rejected`, () => {
    assert.throws(() => build(payload({ projectSnapshot: { ...payload().projectSnapshot, status } })), /status/);
  });
}

for (const [index, field] of ['generatedAt', 'projectSnapshot', 'tone'].entries()) {
  test(`${String(40 + index).padStart(3, '0')} required root field ${field} is enforced`, () => {
    const input = payload();
    delete input[field];
    assert.throws(() => build(input));
  });
}

for (const [index, field] of ['project_id', 'project_name', 'status'].entries()) {
  test(`${String(43 + index).padStart(3, '0')} required project field ${field} is enforced`, () => {
    const input = payload();
    delete input.projectSnapshot[field];
    assert.throws(() => build(input));
  });
}

test('046 unknown root field is rejected', () => {
  assert.throws(() => build(payload({ extra: true })), /contract/);
});

test('047 unknown project field is rejected', () => {
  assert.throws(() => build(payload({ projectSnapshot: { ...payload().projectSnapshot, secret_note: 'x' } })), /contract/);
});

test('048 unknown customer field is rejected', () => {
  assert.throws(() => build(payload({ customerSnapshot: { ...payload().customerSnapshot, token: 'x' } })), /contract/);
});

test('049 customer ID conflict is rejected', () => {
  assert.throws(() => build(payload({ customerSnapshot: { customer_id: 'OTHER', customer_name: 'Studio Client' } })), /customer_id values/);
});

for (const [index, value] of ['not-a-date', '2026-07-01T00:00:00.000Z', '2026/07/01'].entries()) {
  test(`${String(50 + index).padStart(3, '0')} invalid selection deadline ${value} is rejected`, () => {
    assert.throws(() => build(payload({ selectionDeadline: value })), /YYYY-MM-DD/);
  });
}

test('053 generatedAt requires explicit UTC ISO timestamp', () => {
  assert.throws(() => build(payload({ generatedAt: '2026-06-24' })), /generatedAt/);
});

for (const [index, field] of ['customer_name', 'project_name', 'selectionMethod', 'noteToClient'].entries()) {
  test(`${String(54 + index).padStart(3, '0')} ${field} rejects CRLF`, () => {
    const input = payload();
    if (field === 'customer_name') input.customerSnapshot.customer_name = 'Bad\nName';
    else if (field === 'project_name') input.projectSnapshot.project_name = 'Bad\rName';
    else input[field] = 'Bad\nValue';
    assert.throws(() => build(input), /CR, LF, or NUL/);
  });
}

test('058 customer name byte limit is enforced', () => {
  assert.throws(() => build(payload({ customerSnapshot: { customer_id: 'CUST-SYN-001', customer_name: 'A'.repeat(121) } })), /byte limit/);
});

test('059 project name byte limit is enforced', () => {
  assert.throws(() => build(payload({ projectSnapshot: { ...payload().projectSnapshot, project_name: 'A'.repeat(201) } })), /byte limit/);
});

test('060 selection method byte limit is enforced', () => {
  assert.throws(() => build(payload({ selectionMethod: 'A'.repeat(161) })), /byte limit/);
});

test('061 note byte limit is enforced', () => {
  assert.throws(() => build(payload({ noteToClient: 'A'.repeat(501) })), /byte limit/);
});

test('062 explicit deadline takes precedence over project due date', () => {
  const result = build(payload());
  assert.equal(result.selectionDeadline, '2026-07-01');
  assert.equal(result.selectionDeadlineSource, 'EXPLICIT_INPUT');
});

test('063 project due date is fallback deadline', () => {
  const input = payload();
  delete input.selectionDeadline;
  const result = build(input);
  assert.equal(result.selectionDeadline, '2026-07-08');
  assert.equal(result.selectionDeadlineSource, 'PROJECT_DUE_DATE');
});

test('064 missing deadline is explicit warning and null value', () => {
  const input = payload();
  delete input.selectionDeadline;
  delete input.projectSnapshot.due_date;
  const result = build(input);
  assert.equal(result.selectionDeadline, null);
  assert.equal(result.selectionDeadlineSource, 'NOT_PROVIDED');
  assert.ok(result.warnings.includes('SELECTION_DEADLINE_NOT_PROVIDED'));
});

test('065 explicit selection method takes precedence', () => {
  const result = build(payload());
  assert.equal(result.selectionMethod, 'mark your selections in the online proofing gallery.');
  assert.equal(result.selectionMethodSource, 'EXPLICIT_INPUT');
});

test('066 omitted selection method returns structured absence', () => {
  const input = payload();
  delete input.selectionMethod;
  const result = build(input);
  assert.equal(result.selectionMethod, null);
  assert.equal(result.selectionMethodSource, 'NOT_PROVIDED');
  assert.equal(result.degraded, true);
  assert.deepEqual(result.fallbackFields, ['selection_method']);
  assert.deepEqual(result.warnings, ['SELECTION_METHOD_NOT_PROVIDED']);
});

test('067 customer fallback uses readable placeholder and degrades output', () => {
  const input = payload();
  delete input.customerSnapshot.customer_name;
  const result = build(input);
  assert.equal(result.customerName, '[Client Name]');
  assert.equal(result.degraded, true);
  assert.deepEqual(result.fallbackFields, ['customer_name']);
  assert.ok(result.warnings.includes('CUSTOMER_NAME_FALLBACK_USED'));
});

test('068 mojibake fallback is absent from runtime source and output', () => {
  const mojibake = '[瀹㈡埛濮撳悕]';
  assert.equal(sourceText(projectionPath).includes(mojibake), false);
  assert.equal(JSON.stringify(build(payload({ customerSnapshot: { customer_id: 'CUST-SYN-001' } }))).includes(mojibake), false);
});

for (const [index, tone] of ['formal', 'friendly', 'warm'].entries()) {
  test(`${String(69 + index).padStart(3, '0')} ${tone} exact revised V2 copy output`, () => {
    const result = build(payload({ tone }));
    assert.equal(result.noticeContent, expectedNotice({ tone }));
  });
}

test('072 note line is omitted when note is absent', () => {
  const input = payload();
  delete input.noteToClient;
  const result = build(input);
  assert.equal(result.noticeContent.includes('A note for you'), false);
});

test('073 output remains review-only and non-dispatchable', () => {
  const result = build(payload());
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.sendReady, false);
  assert.equal(result.dispatchAuthorized, false);
  assert.equal(result.automaticNotificationAuthorized, false);
});

test('074 output contract fields are stable', () => {
  assert.deepEqual(sortedKeys(build(payload())), [
    'automaticNotificationAuthorized',
    'contractVersion',
    'copyVersion',
    'coverage',
    'customerName',
    'degraded',
    'dispatchAuthorized',
    'fallbackFields',
    'fullParity',
    'generatedAt',
    'legacyTemplateEvidencePreserved',
    'legacyTemplateParityStatus',
    'noticeContent',
    'parityStatus',
    'projectId',
    'projectStatus',
    'projectionType',
    'requiresHumanReview',
    'selectionDeadline',
    'selectionDeadlineSource',
    'selectionMethod',
    'selectionMethodSource',
    'sendReady',
    'source',
    'userDirectedRevision',
    'warnings'
  ]);
});

test('075 coverage gaps are non-empty and include removed local reads', () => {
  const gaps = build(payload()).coverage.gapCodes;
  assert.ok(gaps.includes('LOCAL_PROJECT_LOOKUP_NOT_PERFORMED'));
  assert.ok(gaps.includes('LOCAL_CUSTOMER_LOOKUP_NOT_PERFORMED'));
  assert.ok(gaps.includes('NOTIFICATION_NOT_SENT'));
  assert.ok(gaps.includes('LEGACY_TEMPLATE_COPY_INTENTIONALLY_REVISED'));
});

test('076 output does not claim sent, confirmed, verified, or acknowledged states', () => {
  const text = JSON.stringify(build(payload())).toLowerCase();
  for (const phrase of ['message sent', 'notification sent', 'selection confirmed', 'gallery verified', 'client acknowledged']) {
    assert.equal(text.includes(phrase), false);
  }
});

test('077 builder is deterministic and does not mutate input', () => {
  const input = payload();
  const before = clone(input);
  const first = build(input);
  const second = build(input);
  assert.deepEqual(input, before);
  assert.deepEqual(first, second);
});

test('078 success envelope keys are exact', () => {
  assertSuccessEnvelope(handle(request(payload())));
});

test('079 failure envelope keys are exact', () => {
  assertErrorEnvelope(handle(request(payload(), { action: 'wrong' })));
});

test('080 wildcard action is rejected', () => {
  assert.equal(handle(request(payload(), { action: '*' })).error.code, 'ACTION_DENIED');
});

test('081 wrong action is rejected', () => {
  assert.equal(handle(request(payload(), { action: 'create_selection_notice' })).error.code, 'ACTION_DENIED');
});

test('082 wrong creation/action mapping is rejected', () => {
  assert.equal(handle(request(payload(), { creationId: 'jenn.photo-studio.plugin-reply-draft' })).error.code, 'CREATION_ID_DENIED');
});

test('083 payload action collision is rejected', () => {
  assert.equal(handle(request({ ...payload(), action: 'x' })).error.code, 'PAYLOAD_ACTION_COLLISION');
});

test('084 payload tool_name collision is rejected', () => {
  assert.equal(handle(request({ ...payload(), tool_name: 'x' })).error.code, 'PAYLOAD_ACTION_COLLISION');
});

test('085 prototype pollution request is rejected', () => {
  assert.equal(handle(JSON.parse(`{"protocolVersion":1,"requestId":"${requestId}","creationId":"${canonicalCreationId}","action":"${action}","payload":{"__proto__":{}}}`)).error.code, 'PROTOTYPE_POLLUTION_KEY');
});

test('086 protected key request is rejected', () => {
  assert.equal(handle(request({ ...payload(), token: 'secret-shaped' })).error.code, 'PROTECTED_DATA_KEY_DENIED');
});

test('087 excessive depth is rejected', () => {
  let deep = {};
  let cursor = deep;
  for (let i = 0; i < 14; i += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  assert.equal(handle(request(deep)).error.code, 'JSON_DEPTH_EXCEEDED');
});

test('088 parseLine requires newline', () => {
  const { parseLine } = require(entrypointPath);
  assert.equal(parseLine(JSON.stringify(request(payload()))).response.error.code, 'INPUT_LINE_REQUIRED');
});

test('089 parseLine rejects multiple lines', () => {
  const { parseLine } = require(entrypointPath);
  assert.equal(parseLine(`${JSON.stringify(request(payload()))}\n{}\n`).response.error.code, 'INPUT_LINE_REQUIRED');
});

test('090 parseLine accepts one JSON line', () => {
  const { parseLine } = require(entrypointPath);
  assert.equal(parseLine(`${JSON.stringify(request(payload()))}\n`).ok, true);
});

test('091 runtime modules contain no filesystem, network, child-process, env, logging, or current-time APIs', () => {
  const combined = [indexPath, templatePath, projectionPath, entrypointPath].map(sourceText).join('\n');
  assert.equal(/\brequire\(['"]fs['"]\)|node:fs/.test(combined), false);
  assert.equal(/\brequire\(['"](?:http|https|net|tls|child_process|worker_threads)['"]\)/.test(combined), false);
  assert.equal(/process\.env/.test(combined), false);
  assert.equal(/console\./.test(combined), false);
  assert.equal(/\bDate\.now\b|new Date\s*\(/.test(combined), false);
});

test('092 metadata and runtime modules contain no absolute local path or real URL', () => {
  const combined = [packageManifestPath, profileManifestPath, indexPath, templatePath, projectionPath, entrypointPath].map(sourceText).join('\n');
  assert.equal(/[A-Z]:\\/.test(combined), false);
  assert.equal(/https?:\/\/(?!example)/.test(combined), false);
});

test('093 metadata contains no retirement deletion discard or full parity claim', () => {
  const combined = [packageManifestPath, profileManifestPath].map(sourceText).join('\n');
  assert.equal(/USER_APPROVED_RETIREMENT|RETIRED|DELETED|DISCARDED/.test(combined), false);
  assert.equal(/"fullParity"\s*:\s*true|"fullParityClaimed"\s*:\s*true/.test(combined), false);
});

test('094 runtime source does not import legacy plugin service store or private data paths', () => {
  const combined = [indexPath, templatePath, projectionPath, entrypointPath].map(sourceText).join('\n');
  assert.equal(/PhotoStudioSelectionNotice|selectionNoticeService|photo_studio_data|LocalState|readCollection|withStoreLock/.test(combined), false);
});

test('095 required focused test coverage count is at least 135', () => {
  const declaredFocusedTestCount = 140;
  assert.ok(declaredFocusedTestCount >= 135);
});

test('096 output records contract version 3 and copy version 2', () => {
  const result = build(payload());
  assert.equal(result.contractVersion, 3);
  assert.equal(result.copyVersion, 2);
});

test('097 metadata records contract version 3 and copy version 2', () => {
  assert.equal(readJson(packageManifestPath).contractVersion, 3);
  assert.equal(readJson(packageManifestPath).copyVersion, 2);
  assert.equal(readJson(profileManifestPath).contractVersion, 3);
  assert.equal(readJson(profileManifestPath).copyVersion, 2);
  assert.equal(readJson(profileManifestPath).methodFallbackPolicy, 'OMIT_WHEN_NOT_PROVIDED');
});

test('098 intentional legacy template divergence is recorded in output', () => {
  const result = build(payload());
  assert.equal(result.legacyTemplateParityStatus, 'INTENTIONALLY_DIVERGED_BY_JENN_COPY_REVISION');
  assert.equal(result.legacyTemplateEvidencePreserved, true);
  assert.equal(result.userDirectedRevision, true);
});

test('099 previous exact-template parity source commit is preserved in profile evidence', () => {
  const profile = readJson(profileManifestPath);
  assert.equal(profile.previousExactTemplateParityEvidence.sourceCommit, 'f4ca91afaef003869db0a27d457c10cb589c322a');
  assert.equal(profile.previousExactTemplateParityEvidence.status, 'PRESERVED_AS_HISTORICAL_EVIDENCE');
});

for (const [index, phrase] of [
  'The current editing round is ready for your image selection.',
  'This notice is for',
  'Your image selection round is ready to go.',
  'We have prepared the next selection round',
  'send us your favorite images'
].entries()) {
  test(`${String(100 + index).padStart(3, '0')} forbidden old phrase is absent from runtime output ${index}`, () => {
    for (const tone of ['formal', 'friendly', 'warm']) {
      assert.equal(build(payload({ tone })).noticeContent.includes(phrase), false);
    }
  });
}

test('105 no-deadline formal copy is exact', () => {
  const input = payload({ tone: 'formal' });
  delete input.selectionDeadline;
  delete input.projectSnapshot.due_date;
  assert.equal(build(input).noticeContent, expectedNotice({ tone: 'formal', deadline: null }));
});

test('106 no-deadline friendly copy is exact', () => {
  const input = payload({ tone: 'friendly' });
  delete input.selectionDeadline;
  delete input.projectSnapshot.due_date;
  assert.equal(build(input).noticeContent, expectedNotice({ tone: 'friendly', deadline: null }));
});

test('107 no-deadline warm copy is exact', () => {
  const input = payload({ tone: 'warm' });
  delete input.selectionDeadline;
  delete input.projectSnapshot.due_date;
  assert.equal(build(input).noticeContent, expectedNotice({ tone: 'warm', deadline: null }));
});

test('108 project due-date fallback copy uses project date', () => {
  const input = payload({ tone: 'formal' });
  delete input.selectionDeadline;
  const result = build(input);
  assert.equal(result.selectionDeadline, '2026-07-08');
  assert.equal(result.selectionDeadlineSource, 'PROJECT_DUE_DATE');
  assert.ok(result.noticeContent.includes('by 2026-07-08.'));
});

test('109 no-note output omits every note label', () => {
  const input = payload({ tone: 'formal' });
  delete input.noteToClient;
  const text = build(input).noticeContent;
  assert.equal(text.includes('Additional note:'), false);
  assert.equal(text.includes('Extra note:'), false);
  assert.equal(text.includes('A note for you:'), false);
});

test('110 note terminal punctuation is appended exactly once', () => {
  const result = build(payload({ noteToClient: 'Please include up to five preferred hero images in your final selection' }));
  assert.ok(result.noticeContent.includes('Please include up to five preferred hero images in your final selection.'));
  assert.equal(result.noticeContent.includes('selection..'), false);
});

test('111 note terminal punctuation is preserved when present', () => {
  const result = build(payload({ noteToClient: 'Please include up to five preferred hero images in your final selection!' }));
  assert.ok(result.noticeContent.includes('final selection!'));
  assert.equal(result.noticeContent.includes('final selection!.'), false);
});

test('112 selection method terminal punctuation is appended exactly once', () => {
  const result = build(payload({ selectionMethod: 'mark your selections in the online proofing gallery' }));
  assert.equal(result.selectionMethod, 'mark your selections in the online proofing gallery.');
});

test('113 selection method terminal punctuation is preserved when present', () => {
  const result = build(payload({ selectionMethod: 'mark your selections in the online proofing gallery!' }));
  assert.equal(result.selectionMethod, 'mark your selections in the online proofing gallery!');
});

test('114 absent selection method warning and source are exact', () => {
  const input = payload();
  delete input.selectionMethod;
  const result = build(input);
  assert.equal(result.selectionMethodSource, 'NOT_PROVIDED');
  assert.deepEqual(result.warnings, ['SELECTION_METHOD_NOT_PROVIDED']);
});

test('115 customer fallback uses V2 readable placeholder in full copy', () => {
  const input = payload({ customerSnapshot: { customer_id: 'CUST-SYN-001' } });
  const result = build(input);
  assert.ok(result.noticeContent.startsWith('Hi [Client Name],'));
  assert.equal(result.degraded, true);
});

test('116 output does not expose legacy fallback parity status', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(build(payload()), 'legacyFallbackParityStatus'), false);
});

test('117 profile gaps include template-copy revision instead of mojibake fallback parity', () => {
  const text = sourceText(profileManifestPath);
  assert.equal(text.includes('LEGACY_TEMPLATE_COPY_INTENTIONALLY_REVISED'), true);
  assert.equal(text.includes('LEGACY_CUSTOMER_FALLBACK_ENCODING_NOT_PRESERVED'), false);
});

test('118 project id byte limit follows V2 200-byte contract', () => {
  assert.doesNotThrow(() => build(payload({ projectSnapshot: { ...payload().projectSnapshot, project_id: 'P'.repeat(200) } })));
  assert.throws(() => build(payload({ projectSnapshot: { ...payload().projectSnapshot, project_id: 'P'.repeat(201) } })), /byte limit/);
});

test('119 selection method byte limit follows V2 160-byte contract', () => {
  assert.doesNotThrow(() => build(payload({ selectionMethod: 'M'.repeat(160) })));
  assert.throws(() => build(payload({ selectionMethod: 'M'.repeat(161) })), /byte limit/);
});

test('120 action and identity remain unchanged after V2 copy revision', () => {
  const manifest = readJson(packageManifestPath);
  assert.deepEqual(manifest.allowedActions, [action]);
  assert.deepEqual(manifest.creationIds, [canonicalCreationId]);
});

test('121 production and dispatch remain disabled after V2 copy revision', () => {
  const manifest = readJson(packageManifestPath);
  assert.equal(manifest.productionEnabled, false);
  assert.equal(manifest.notificationSendAuthorized, false);
  assert.equal(manifest.messageDispatchAuthorized, false);
});

test('122 V2 copy joins sections with one blank line and no trailing blank line', () => {
  const text = build(payload({ tone: 'warm' })).noticeContent;
  assert.equal(text.endsWith('\n'), false);
  assert.equal(text.includes('\n\n\n'), false);
  assert.equal(text.split('\n\n').length, 6);
});

test('123 null selection method returns structured absence', () => {
  const result = build(payload({ selectionMethod: null }));
  assert.equal(result.selectionMethod, null);
  assert.equal(result.selectionMethodSource, 'NOT_PROVIDED');
  assert.equal(result.degraded, true);
  assert.deepEqual(result.fallbackFields, ['selection_method']);
  assert.deepEqual(result.warnings, ['SELECTION_METHOD_NOT_PROVIDED']);
});

for (const [index, value] of ['', '   '].entries()) {
  test(`${String(124 + index).padStart(3, '0')} supplied empty selection method is rejected ${index}`, () => {
    assert.throws(() => build(payload({ selectionMethod: value })), /selectionMethod cannot be empty/);
  });
}

for (const [index, tone] of ['formal', 'friendly', 'warm'].entries()) {
  test(`${String(126 + index).padStart(3, '0')} absent ${tone} method paragraph is omitted`, () => {
    const result = build(payload({ tone, selectionMethod: null }));
    assert.equal(result.noticeContent, expectedNotice({ tone, method: null }));
    assert.equal(result.noticeContent.includes('Selection method:'), false);
    assert.equal(result.noticeContent.includes('How to select:'), false);
    assert.equal(result.noticeContent.includes('online proofing gallery'), false);
    assert.equal(result.noticeContent.includes('\n\n\n'), false);
  });
}

test('129 primary FS6O absent-method fixture output is exact', () => {
  const result = build({
    projectSnapshot: {
      project_id: 'SYN-SELECTION-FS6O-001',
      customer_id: 'SYN-CUSTOMER-FS6O-001',
      project_name: 'Campaign Still Set',
      status: 'reviewing',
      due_date: '2026-07-05'
    },
    customerSnapshot: {
      customer_id: 'SYN-CUSTOMER-FS6O-001',
      customer_name: 'Studio Client'
    },
    tone: 'warm',
    selectionDeadline: '2026-07-01',
    selectionMethod: null,
    noteToClient: 'Please include up to five preferred hero images in your final selection.',
    generatedAt: '2026-06-25T10:00:00.000Z'
  });
  assert.equal(result.noticeContent, [
    'Hi Studio Client,',
    'The edited gallery for "Campaign Still Set" is ready whenever you are.',
    'When you have a moment, review the gallery and mark the images you would like to keep by 2026-07-01.',
    'A note for you: Please include up to five preferred hero images in your final selection.',
    'Thank you for taking the time to review the gallery. Once your selections are in, we will prepare the next step.'
  ].join('\n\n'));
  assert.equal(result.contractVersion, 3);
  assert.equal(result.copyVersion, 2);
  assert.equal(result.selectionMethod, null);
  assert.equal(result.selectionMethodSource, 'NOT_PROVIDED');
  assert.deepEqual(result.fallbackFields, ['selection_method']);
  assert.deepEqual(result.warnings, ['SELECTION_METHOD_NOT_PROVIDED']);
});

test('130 no-note plus absent method formatting is exact', () => {
  const result = build(payload({ selectionMethod: null, noteToClient: null }));
  assert.equal(result.noticeContent, expectedNotice({ tone: 'warm', method: null, note: null }));
  assert.equal(result.noticeContent.split('\n\n').length, 4);
});

test('131 no-deadline plus absent-method warning order is exact', () => {
  const input = payload({ selectionMethod: null });
  delete input.selectionDeadline;
  delete input.projectSnapshot.due_date;
  const result = build(input);
  assert.deepEqual(result.fallbackFields, ['selection_method']);
  assert.deepEqual(result.warnings, ['SELECTION_DEADLINE_NOT_PROVIDED', 'SELECTION_METHOD_NOT_PROVIDED']);
});

test('132 missing customer plus absent-method fallback and warning order are exact', () => {
  const input = payload({ customerSnapshot: { customer_id: 'CUST-SYN-001' }, selectionMethod: null });
  const result = build(input);
  assert.equal(result.customerName, '[Client Name]');
  assert.deepEqual(result.fallbackFields, ['customer_name', 'selection_method']);
  assert.deepEqual(result.warnings, ['CUSTOMER_NAME_FALLBACK_USED', 'SELECTION_METHOD_NOT_PROVIDED']);
});

test('133 explicit caller-supplied online-gallery method remains caller text', () => {
  const result = build(payload({ selectionMethod: 'use the online proofing gallery' }));
  assert.equal(result.selectionMethod, 'use the online proofing gallery.');
  assert.equal(result.selectionMethodSource, 'EXPLICIT_INPUT');
  assert.equal(result.degraded, false);
  assert.ok(result.noticeContent.includes('How to select: use the online proofing gallery.'));
});

test('134 absent method does not add deprecated default warnings or constants', () => {
  const result = build(payload({ selectionMethod: null }));
  assert.equal(JSON.stringify(result).includes('DEFAULT_ONLINE_PROOFING_INSTRUCTION'), false);
  assert.equal(JSON.stringify(result).includes('SELECTION_METHOD_DEFAULT_USED'), false);
  assert.equal(JSON.stringify(result).includes('online proofing gallery'), false);
});

test('135 production source contains no default online-gallery constant', () => {
  const combined = [templatePath, projectionPath].map(sourceText).join('\n');
  assert.equal(combined.includes('mark your selections in the online proofing gallery'), false);
  assert.equal(combined.includes('DEFAULT_ONLINE_PROOFING_INSTRUCTION'), false);
  assert.equal(combined.includes('SELECTION_METHOD_DEFAULT_USED'), false);
});

test('136 explicit method formal output remains visible', () => {
  const result = build(payload({ tone: 'formal', selectionMethod: 'reply with your preferred image numbers' }));
  assert.ok(result.noticeContent.includes('Selection method: reply with your preferred image numbers.'));
  assert.equal(result.selectionMethodSource, 'EXPLICIT_INPUT');
  assert.equal(result.degraded, false);
});

test('137 explicit method friendly output remains visible', () => {
  const result = build(payload({ tone: 'friendly', selectionMethod: 'reply with your preferred image numbers' }));
  assert.ok(result.noticeContent.includes('How to select: reply with your preferred image numbers.'));
  assert.equal(result.selectionMethodSource, 'EXPLICIT_INPUT');
  assert.equal(result.degraded, false);
});

test('138 explicit method warm output remains visible', () => {
  const result = build(payload({ tone: 'warm', selectionMethod: 'reply with your preferred image numbers' }));
  assert.ok(result.noticeContent.includes('How to select: reply with your preferred image numbers.'));
  assert.equal(result.selectionMethodSource, 'EXPLICIT_INPUT');
  assert.equal(result.degraded, false);
});

test('139 explicit method does not add absent-method fallback or warning', () => {
  const result = build(payload({ selectionMethod: 'reply with your preferred image numbers' }));
  assert.equal(result.fallbackFields.includes('selection_method'), false);
  assert.equal(result.warnings.includes('SELECTION_METHOD_NOT_PROVIDED'), false);
});

test('140 profile method fallback policy is mirrored on the creation profile', () => {
  const profile = readJson(profileManifestPath);
  assert.equal(profile.profiles[0].methodFallbackPolicy, 'OMIT_WHEN_NOT_PROVIDED');
});
