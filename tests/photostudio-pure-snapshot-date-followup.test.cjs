'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ENTRY = path.resolve(__dirname, '../PhotoStudioPackages/PurePlanningAdapters/stdio-entrypoint.cjs');
const LIMIT = 262144;
const encode = value => Buffer.from(JSON.stringify(value) + '\n', 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
const { buildCaseContentDraftFromSnapshot: caseDraft, buildDeliveryPriorityFromSnapshot: priority, buildClientReplyDraftFromSnapshot: reply } = require('../PhotoStudioPackages/PurePlanningAdapters/index.cjs');
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
const timestampCases = [
  ['case', caseDraft, casePayload, 'build_case_content_draft_from_snapshot', 'jenn.photo-studio.plugin-case-content-draft'],
  ['reply', reply, replyPayload, 'build_client_reply_draft_from_snapshot', 'jenn.photo-studio.plugin-reply-draft'],
  ['delivery', priority, priorityPayload, 'prioritize_delivery_actions_from_snapshot', 'jenn.photo-studio.plugin-delivery-priority']
];
const invalidGenerated = ['2026-02-31T01:02:03Z', '2025-02-29T01:02:03Z', '1900-02-29T01:02:03Z', '2100-02-29T01:02:03Z', '2026-00-01T01:02:03Z', '2026-13-01T01:02:03Z', '2026-01-00T01:02:03Z', '2026-04-31T01:02:03Z', '2026-06-24T24:00:00Z', '2026-06-24T23:60:00Z', '2026-06-24T23:59:60Z'];
const validGenerated = ['0000-02-29T00:00:00Z', '0099-02-28T01:02:03Z', '1900-02-28T01:02:03Z', '2000-02-29T01:02:03.000Z', '2026-06-24T01:02:03.123Z', '9999-12-31T23:59:59.999Z'];
for (const [label, build, make, action, creationId] of timestampCases) {
  for (const value of invalidGenerated) test(`${label} generatedAt rejects impossible components ${value}`, () => {
    assert.throws(() => invokePure(build, make({generatedAt:value})), error => error instanceof TypeError && /generatedAt/.test(error.message));
  });
  for (const value of validGenerated) test(`${label} generatedAt preserves valid exact precision ${value}`, () => {
    const result = invokePure(build, make({generatedAt:value})); assert.equal(result.generatedAt,value); assert.equal(result.syntheticOnly,true); assert.equal(result.fullParity,false);
  });
  test(`${label} generatedAt retains exact format and non-string rejection`, () => {
    for (const value of ['2026-06-24T01:02:03.1Z','2026-06-24T01:02:03.12Z','2026-06-24T01:02:03.1234Z','2026-06-24T01:02:03+00:00','2026-06-24 01:02:03Z','2026-06-24T01:02:03z','2026-06-24T01:02:03Z\n',' 2026-06-24T01:02:03Z',null,0,{},[]]) {
      assert.throws(() => invokePure(build,make({generatedAt:value})), /generatedAt/);
    }
  });
  test(`${label} generatedAt keeps original omission policy`, () => {
    const payload=make();delete payload.generatedAt;
    if (label==='delivery') assert.equal(Object.hasOwn(invokePure(build,payload),'generatedAt'),false);
    else assert.throws(() => invokePure(build,payload), /generatedAt/);
  });
  test(`${label} actual main rejects invalid timestamp with bounded frame`, async () => {
    const response=await run([encode(request(action,creationId,make({generatedAt:'2026-02-31T25:61:61Z'})))]);
    assert.equal(response.ok,false);assert.equal(response.error.code,'PROJECTION_REJECTED');assert.equal(Object.hasOwn(response,'result'),false);
  });
  test(`${label} actual main preserves valid timestamp and entire projection`, async () => {
    const payload=make({generatedAt:'2000-02-29T23:59:59.123Z'});
    const response=await run([encode(request(action,creationId,payload))]);assert.equal(response.ok,true);assert.deepEqual(response.result,invokePure(build,payload));
  });
}
function schedulePayload(value) { const payload=retryPayload('2026-06-23');payload.externalExportSnapshots[0].schedule_date=value;return payload; }
for (const value of ['not-a-date','2026-02-30','2025-02-29','1900-02-29','2026-00-01','2026-13-01','2026-01-00','2026-04-31','2026-06-24T00:00:00Z']) test(`schedule rejects supplied invalid date ${value}`, () => {
  assert.throws(() => invokePure(priority,schedulePayload(value)), error=>error instanceof TypeError && /schedule_date/.test(error.message));
});
for (const value of ['0000-02-29','2000-02-29','2026-06-24','9999-12-31']) test(`schedule preserves valid date ${value}`, () => {
  const item=invokePure(priority,schedulePayload(value)).prioritizedActions[0];assert.equal(item.scheduleDate,value);assert.equal(item.retryAfterDate,'2026-06-23');assert.equal(item.rank,1);
});
test('schedule keeps missing null and blank fallback to validated retry date', () => {
  for (const value of [undefined,null,'',' \t\n ']) { const item=invokePure(priority,schedulePayload(value)).prioritizedActions[0];assert.equal(item.scheduleDate,'2026-06-23'); }
  assert.equal(invokePure(priority,schedulePayload(' 2026-06-24 ')).prioritizedActions[0].scheduleDate,'2026-06-24');
});
test('schedule rejects non-string supplied values rather than fabricating a fallback', () => {
  for(const value of [1,{},[]]) assert.throws(()=>invokePure(priority,schedulePayload(value)),/schedule_date/);
});
test('schedule validates all actionable states and keeps original rank sorting', () => {
  for(const state of ['failed','ready_to_publish','queued','retry_scheduled']) {const p=schedulePayload('zz-not-a-date');p.externalExportSnapshots[0].delivery_state=state;assert.throws(()=>invokePure(priority,p),/schedule_date/);}
  const p=priorityPayload();assert.deepEqual(invokePure(priority,p).prioritizedActions.map(x=>x.exportKey),['EXP-FAILED','EXP-RETRY-DUE','EXP-READY','EXP-QUEUED','EXP-WAIT']);
});
test('actual main rejects malformed schedule sorting key instead of misordering earlier retry', async () => {
  const payload=schedulePayload('zz-not-a-date');payload.externalExportSnapshots.push({project_id:'P-LATER',export_key:'E-LATER',delivery_state:'retry_scheduled',retry_after_date:'2026-06-24'});
  const response=await run([encode(priorityRequest(payload))]);assert.equal(response.ok,false);assert.equal(response.error.code,'PROJECTION_REJECTED');assert.equal(Object.hasOwn(response,'result'),false);
});
for(const [label,value] of [['spaces','  '],['empty',''],['tabs','\t\n'],['missing',undefined],['null',null],['object',{}],['number',1],['array',[]]]) test(`reply ${label} optional customer id falls back after normalization`,()=>{
  const p=replyPayload();p.customerSnapshot.customer_id=value;p.projectSnapshot.customer_id=' CUST-SYN-001 ';const result=invokePure(reply,p);assert.equal(result.snapshotScope.customerId,'CUST-SYN-001');assert.ok(result.draftContent.includes('Studio Client'));assert.equal(result.sendReady,false);
});
test('reply customer scope preserves matching IDs, both missing, and mismatch rejection',()=>{
  const p=replyPayload();p.customerSnapshot.customer_id=' CUST-SYN-001 ';assert.equal(invokePure(reply,p).snapshotScope.customerId,'CUST-SYN-001');
  delete p.customerSnapshot.customer_id;delete p.projectSnapshot.customer_id;assert.equal(invokePure(reply,p).snapshotScope.customerId,null);
  p.customerSnapshot.customer_id='C-OTHER';p.projectSnapshot.customer_id='C-ONE';assert.throws(()=>invokePure(reply,p),/customer_id/);
});
test('actual main preserves known project customer scope for whitespace customer id',async()=>{
  const payload=replyPayload();payload.customerSnapshot.customer_id='   ';const response=await run([encode(replyRequest(payload))]);assert.equal(response.ok,true);assert.equal(response.result.snapshotScope.customerId,'CUST-SYN-001');assert.deepEqual(response.result,invokePure(reply,payload));
});
