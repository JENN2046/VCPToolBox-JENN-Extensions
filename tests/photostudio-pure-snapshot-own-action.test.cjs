'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ENTRY = path.resolve(__dirname, '../PhotoStudioPackages/PurePlanningAdapters/stdio-entrypoint.cjs');
const LIMIT = 262144;
const encode = value => Buffer.from(JSON.stringify(value) + '\n', 'utf8');
const { ACTION_TABLE, handleRequest } = require(ENTRY);
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

const inheritedActions = ['toString', 'valueOf', '__defineGetter__', '__defineSetter__', 'constructor', '__proto__', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString', '__lookupGetter__', '__lookupSetter__'];
for (const action of inheritedActions) {
  test(`actual main denies inherited action ${action} before creation or projection`, async () => {
    assert.equal(Object.prototype.hasOwnProperty.call(ACTION_TABLE, action), false);
    const request = { protocolVersion: 1, requestId: 'own-action-check', action, payload: {} };
    const response = await run([encode(request)]);
    assert.deepEqual(response, { protocolVersion: 1, requestId: request.requestId, creationId: '', ok: false,
      error: { code: 'ACTION_DENIED', message: 'Action is not authorized for this entrypoint.' } });
  });
}
test('actual main keeps ordinary unknown action denial', async () => {
  const response = await run([encode({ protocolVersion: 1, requestId: 'unknown-action-check', action: 'unknown_synthetic_action', payload: {} })]);
  assert.equal(response.ok, false); assert.equal(response.error.code, 'ACTION_DENIED');
});
const valid = [
  ['build_case_content_draft_from_snapshot', 'jenn.photo-studio.plugin-case-content-draft', casePayload()],
  ['build_client_reply_draft_from_snapshot', 'jenn.photo-studio.plugin-reply-draft', replyPayload()],
  ['prioritize_delivery_actions_from_snapshot', 'jenn.photo-studio.plugin-delivery-priority', priorityPayload()]
];
for (const [action, creationId, payload] of valid) {
  test(`actual main retains the owned action ${action} and full result`, async () => {
    const request = { protocolVersion: 1, requestId: 'valid-own-action', action, creationId, payload };
    assert.equal(Object.prototype.hasOwnProperty.call(ACTION_TABLE, action), true);
    const expected = handleRequest(request); assert.equal(expected.ok, true);
    const response = await run([encode(request)]); assert.deepEqual(response, expected);
  });
}
