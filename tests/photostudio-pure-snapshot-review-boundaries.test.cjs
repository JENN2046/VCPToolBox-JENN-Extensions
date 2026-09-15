'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ENTRY = path.resolve(__dirname, '../PhotoStudioPackages/PurePlanningAdapters/stdio-entrypoint.cjs');
const LIMIT = 262144;
const encode = value => Buffer.from(JSON.stringify(value) + '\n', 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const { buildDeliveryPriorityFromSnapshot: priority, buildClientReplyDraftFromSnapshot: reply } = require('../PhotoStudioPackages/PurePlanningAdapters/index.cjs');
// Actual local main, raw bytes, empty environment, no addon. No provider/runner is invoked.
async function run(chunks, { gap = 0, holdBeforeEOF = false } = {}) {
  const child = spawn(process.execPath, ['--no-addons', ENTRY], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
  const output = []; const errors = []; let outputBytes = 0; let errorBytes = 0;
  let ioError; let timedOut = false; let noEarlyOutput = true;
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, 5000);
  child.stdout.on('data', data => { outputBytes += data.length; output.push(data); if (outputBytes > LIMIT + 4096) child.kill('SIGKILL'); });
  child.stderr.on('data', data => { errorBytes += data.length; errors.push(data); if (errorBytes > 65536) child.kill('SIGKILL'); });
  child.stdin.on('error', error => { ioError = error; });
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  try {
    for (let i = 0; i < chunks.length; i++) {
      assert.ok(Buffer.isBuffer(chunks[i]));
      child.stdin.write(chunks[i]);
      if (gap && i < chunks.length - 1) await new Promise(resolve => setTimeout(resolve, gap));
    }
    if (holdBeforeEOF) { await new Promise(resolve => setTimeout(resolve, 100)); noEarlyOutput = outputBytes === 0; }
    child.stdin.end();
    const exit = await done;
    assert.equal(timedOut, false, 'bounded child completed');
    assert.equal(ioError, undefined, 'stdin accepted all bytes');
    assert.equal(exit.signal, null);
    assert.equal(exit.code, 0, 'main returns a protocol frame instead of crashing');
    assert.equal(errorBytes, 0, 'no stderr');
    assert.equal(noEarlyOutput, true, 'nothing emitted before EOF');
    const bytes = Buffer.concat(output);
    assert.ok(bytes.length <= LIMIT);
    assert.equal(bytes.at(-1), 10);
    assert.equal(bytes.toString('utf8').split('\n').length, 2, 'exactly one JSONL frame');
    return JSON.parse(bytes.toString('utf8'));
  } finally { clearTimeout(timer); if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); }
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

function retryPayload(date) {
  return { referenceDate: '2026-06-24', externalExportSnapshots: [{ project_id: 'P-SYN', export_key: 'E-SYN', target_type: 'archive', delivery_state: 'retry_scheduled', retry_after_date: date }] };
}
function invokePure(fn, input) {
  const before = JSON.stringify(input);
  try { return fn(input); } finally { assert.equal(JSON.stringify(input), before, 'snapshot input is not mutated'); }
}
function request(action, creationId, payload) {
  return { protocolVersion: 1, requestId: 'synthetic-pr12-boundary', action, creationId, payload };
}
function priorityRequest(payload) { return request('prioritize_delivery_actions_from_snapshot', 'jenn.photo-studio.plugin-delivery-priority', payload); }
function replyRequest(payload) { return request('build_client_reply_draft_from_snapshot', 'jenn.photo-studio.plugin-reply-draft', payload); }
for (const date of ['not-a-date', '2026-02-31', '2025-02-29', '1900-02-29', '2100-02-29', '2026-00-10', '2026-13-10', '2026-01-00', '2026-04-31', '2026-01-32', '10000-01-01', '2026-1-01', '2026-01-1', '2026-01-01T00:00:00Z']) {
  test(`retry date rejects malformed Gregorian value ${date}`, () => {
    assert.throws(() => invokePure(priority, retryPayload(date)), error => error instanceof TypeError && /retry_after_date/.test(error.message));
  });
}
for (const date of ['0000-02-29', '0099-02-28', '1900-02-28', '2000-02-29', '2024-02-29', '9999-12-31', '2026-04-30', '2026-06-24', '2026-06-25']) {
  test(`retry date accepts valid Gregorian boundary ${date}`, () => {
    const item = invokePure(priority, retryPayload(date)).prioritizedActions[0];
    assert.equal(item.retryAfterDate, date); assert.equal(item.rank, date <= '2026-06-24' ? 1 : 4);
    assert.equal(item.executionAuthorized, false); assert.equal(item.stateMutationAuthorized, false);
  });
}
for (const [label, date] of [['missing', undefined], ['null', null], ['empty', ''], ['blank', '  ']]) {
  test(`retry ${label} preserves original excluded-record behavior`, () => {
    const result = invokePure(priority, retryPayload(date)); assert.equal(result.summary.actionableRecords, 0); assert.equal(result.summary.excludedRecords, 1); assert.deepEqual(result.prioritizedActions, []);
  });
}
for (const [label, date] of [['number', 20260101], ['object', {}], ['boolean', false]]) {
  test(`retry rejects supplied non-string ${label}`, () => {
    assert.throws(() => invokePure(priority, retryPayload(date)), error => error instanceof TypeError && /retry_after_date/.test(error.message));
  });
}
test('retry retains existing surrounding-whitespace normalization', () => {
  assert.equal(invokePure(priority, retryPayload(' 2026-06-23 ')).prioritizedActions[0].retryAfterDate, '2026-06-23');
});
for (const date of ['2026-02-31', '1900-02-29', '2026-13-01']) {
  test(`reference date rejects invalid Gregorian bound ${date}`, () => {
    const input = retryPayload('2026-06-24'); input.referenceDate = date;
    assert.throws(() => invokePure(priority, input), error => error instanceof TypeError && /referenceDate/.test(error.message));
  });
}
for (const date of ['not-a-date', '2026-02-31']) {
  test(`actual main rejects invalid retry ${date} through existing envelope`, async () => {
    const req = priorityRequest(retryPayload(date)); const result = await run([encode(req)]);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'PROJECTION_REJECTED'); assert.equal(result.requestId, req.requestId); assert.equal(result.creationId, req.creationId); assert.equal(Object.hasOwn(result, 'result'), false);
  });
}
test('actual main preserves valid leap-date priority result', async () => {
  const payload = retryPayload('2000-02-29'); const result = await run([encode(priorityRequest(payload))]);
  assert.equal(result.ok, true); assert.deepEqual(result.result, priority(payload));
});
function rowsPayload(rows, scope = { projectId: 'P-TARGET' }) {
  return { referenceDate: '2026-06-24', scope, externalExportSnapshots: [{ export_key: 'E-ROWS', target_type: 'archive', delivery_state: 'queued', export_rows: rows }] };
}
for (const [label, rows] of [
  ['second', [{project_id:'P-OTHER'}, {project_id:'P-TARGET'}]],
  ['third with blanks', [{project_id:'P-OTHER'}, {project_id:' '}, {project_id:' P-TARGET '}]],
  ['duplicate target', [{project_id:'P-OTHER'}, {project_id:'P-TARGET'}, {project_id:'P-TARGET'}]],
  ['ignorable non-records', [null, [], 'not-a-row', {project_id:'P-OTHER'}, {project_id:'P-TARGET'}]]
]) {
  test(`project scope matches ${label} row and returns only scoped identity`, () => {
    const result = invokePure(priority, rowsPayload(rows)); assert.equal(result.summary.totalMatchedRecords, 1); assert.equal(result.prioritizedActions.length, 1); assert.equal(result.prioritizedActions[0].projectId, 'P-TARGET'); assert.equal(result.prioritizedActions[0].sourceIndex, 0); assert.equal(result.prioritizedActions[0].exportKey, 'E-ROWS');
  });
}
test('scoped output is unchanged when unrelated row appears before or after target', () => {
  assert.deepEqual(invokePure(priority, rowsPayload([{project_id:'P-OTHER'}, {project_id:'P-TARGET'}])), invokePure(priority, rowsPayload([{project_id:'P-TARGET'}, {project_id:'P-OTHER'}])));
});
test('project scope absent from every row remains excluded', () => {
  const result = invokePure(priority, rowsPayload([{project_id:'P-OTHER'}])); assert.equal(result.summary.totalMatchedRecords, 0); assert.deepEqual(result.prioritizedActions, []);
});
test('row project matching retains case sensitivity', () => {
  const result = invokePure(priority, rowsPayload([{project_id:'p-target'}])); assert.equal(result.summary.totalMatchedRecords, 0);
});
test('project row match retains AND semantics with other scope fields', () => {
  const result = invokePure(priority, rowsPayload([{project_id:'P-TARGET'}], {projectId:'P-TARGET', targetType:'different-target'})); assert.equal(result.summary.totalMatchedRecords, 0);
});
test('unscoped mixed rows retain existing first-project projection', () => {
  const payload = rowsPayload([{project_id:'P-OTHER'}, {project_id:'P-TARGET'}]); delete payload.scope;
  assert.equal(invokePure(priority, payload).prioritizedActions[0].projectId, 'P-OTHER');
});
test('direct project id retains existing precedence over fallback rows', () => {
  const payload = rowsPayload([{project_id:'P-TARGET'}]); payload.externalExportSnapshots[0].project_id = 'P-DIRECT';
  assert.equal(invokePure(priority, payload).summary.totalMatchedRecords, 0);
  payload.scope.projectId = 'P-DIRECT'; assert.equal(invokePure(priority, payload).prioritizedActions[0].projectId, 'P-DIRECT');
});
test('actual main includes a later scoped row without returning outside identity', async () => {
  const payload = rowsPayload([{project_id:'P-OTHER'}, {project_id:'P-TARGET'}]); const response = await run([encode(priorityRequest(payload))]);
  assert.equal(response.ok, true); assert.equal(response.result.prioritizedActions.length, 1); assert.equal(response.result.prioritizedActions[0].projectId, 'P-TARGET');
});
for (const [projectId, customerId] of [['C-ONE', 'C-TWO'], [' C-ONE ', ' C-TWO '], ['C-ONE', 'c-one']]) {
  test(`reply rejects mismatched customer pair ${JSON.stringify([projectId, customerId])}`, () => {
    const payload = replyPayload(); payload.projectSnapshot.customer_id = projectId; payload.customerSnapshot.customer_id = customerId;
    assert.throws(() => invokePure(reply, payload), error => error instanceof TypeError && /customer_id/.test(error.message));
  });
}
test('reply mismatch is rejected before absent customer name fallback', () => {
  const payload = replyPayload(); payload.customerSnapshot = {customer_id:'C-OTHER'};
  assert.throws(() => invokePure(reply, payload), error => error instanceof TypeError && /customer_id/.test(error.message));
});
test('reply accepts matching normalized customer identities', () => {
  const payload = replyPayload(); payload.projectSnapshot.customer_id = ' C-SAME '; payload.customerSnapshot.customer_id = 'C-SAME';
  const result = invokePure(reply, payload); assert.equal(result.snapshotScope.customerId, 'C-SAME'); assert.ok(result.draftContent.includes('Studio Client'));
});
test('reply keeps optional missing customer snapshot and name fallback', () => {
  const payload = replyPayload(); delete payload.customerSnapshot;
  const result = invokePure(reply, payload); assert.ok(result.draftContent.includes('[客户姓名]')); assert.equal(result.degraded, true); assert.ok(result.warnings.includes('CUSTOMER_NAME_FALLBACK_USED'));
});
for (const side of ['project', 'customer']) {
  test(`reply keeps optional missing ${side} customer id`, () => {
    const payload = replyPayload(); delete payload[side + 'Snapshot'].customer_id;
    const result = invokePure(reply, payload); assert.equal(result.snapshotScope.customerId, 'CUST-SYN-001'); assert.ok(result.draftContent.includes('Studio Client'));
  });
}
test('actual main rejects customer mismatch without emitting a draft', async () => {
  const payload = replyPayload(); payload.customerSnapshot.customer_id = 'C-OTHER';
  const response = await run([encode(replyRequest(payload))]); assert.equal(response.ok, false); assert.equal(response.error.code, 'PROJECTION_REJECTED'); assert.equal(Object.hasOwn(response,'result'), false);
});
