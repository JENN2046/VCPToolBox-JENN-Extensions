'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');
const ENTRY = path.resolve(__dirname, '../PhotoStudioPackages/ProjectTasksPlanningAdapter/stdio-entrypoint.cjs');
const LIMIT = 262144;
const BASE = {"protocolVersion":1,"requestId":"synthetic-request","creationId":"jenn.photo-studio.plugin-project-tasks","action":"plan_project_tasks_from_snapshot","payload":{"projectSnapshot":{"project_id":"synthetic-current","project_type":"portrait"},"existingTaskSnapshots":[]}};
const clone = value => JSON.parse(JSON.stringify(value));
const encode = value => Buffer.from(JSON.stringify(value) + '\n', 'utf8');

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

function withRawId(bytes) {
  const req = clone(BASE); req.requestId = '__RAW_ID__';
  const frame = encode(req); const marker = Buffer.from('__RAW_ID__'); const offset = frame.indexOf(marker);
  assert.ok(offset >= 0); return Buffer.concat([frame.subarray(0, offset), bytes, frame.subarray(offset + marker.length)]);
}
function assertDecodeRejected(result) {
  assert.deepEqual(result, { protocolVersion: 1, requestId: '', creationId: '', ok: false,
    error: { code: 'JSON_PARSE_FAILED', message: 'Input JSON could not be parsed.' } });
}

const invalid = [
  ['FF', [0xff]], ['FE', [0xfe]], ['isolated continuation', [0x80]],
  ['overlong two-byte', [0xc0, 0xaf]], ['overlong three-byte', [0xe0, 0x80, 0xaf]],
  ['encoded surrogate', [0xed, 0xa0, 0x80]], ['above Unicode maximum', [0xf4, 0x90, 0x80, 0x80]],
  ['truncated two-byte', [0xc2]], ['truncated three-byte', [0xe2, 0x82]],
  ['truncated four-byte', [0xf0, 0x9f, 0x92]], ['invalid continuation', [0xe2, 0x28, 0xa1]]
];
for (const [name, bytes] of invalid) {
  test(`raw stdin rejects ${name} before ID or action handling`, async () => {
    assertDecodeRejected(await run([withRawId(Buffer.from(bytes))]));
  });
}

test('different illegal byte IDs cannot enter domain comparison', async () => {
  const request = clone(BASE); request.payload.projectSnapshot.project_id = '__CURRENT__'; request.payload.existingTaskSnapshots = [{ project_id: '__EXISTING__' }];
  let frame = encode(request);
  for (const [marker, bytes] of [['__CURRENT__', [0xff]], ['__EXISTING__', [0xfe]]]) {
    const needle = Buffer.from(marker); const offset = frame.indexOf(needle); assert.ok(offset >= 0);
    frame = Buffer.concat([frame.subarray(0, offset), Buffer.from(bytes), frame.subarray(offset + needle.length)]);
  }
  assertDecodeRejected(await run([frame]));
});

for (const [name, value] of [
  ['ASCII', 'synthetic-ascii'], ['two-byte', 'é'], ['three-byte', '界'], ['four-byte', '😀'],
  ['literal replacement character', '\uFFFD'], ['escaped high surrogate', '\uD800'],
  ['escaped low surrogate', '\uDC00'], ['interior BOM character', 'a\uFEFFb']
]) {
  test(`valid ${name} retains request identity and successful result`, async () => {
    const request = clone(BASE); request.requestId = value;
    const response = await run([encode(request)]);
    assert.equal(response.ok, true); assert.equal(response.requestId, value); assert.equal(response.creationId, BASE.creationId);
    assert.equal(response.result.executionAuthorized, false); assert.equal(response.result.messageDispatchAuthorized, false); assert.equal(response.result.requiresHumanReview, true);
  });
}
for (const value of ['é', '界', '😀', '\uFFFD']) {
  test(`valid multibyte ${value.codePointAt(0)} survives separate raw writes`, async () => {
    const frame = withRawId(Buffer.from(value)); const start = frame.indexOf(Buffer.from(value));
    const chunks = [frame.subarray(0, start + 1), frame.subarray(start + 1, start + Buffer.byteLength(value)), frame.subarray(start + Buffer.byteLength(value))];
    const response = await run(chunks, { gap: 50 });
    assert.equal(response.ok, true); assert.equal(response.requestId, value);
  });
}
test('leading UTF-8 BOM retains original JSON parse rejection', async () => {
  assertDecodeRejected(await run([Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), encode(BASE)])]));
});
test('complete input is not emitted before EOF', async () => {
  const response = await run([encode(BASE)], { holdBeforeEOF: true });
  assert.equal(response.ok, true);
});
for (const extra of [0, 1]) {
  test(`original raw-byte limit at cap plus ${extra}`, async () => {
    const frame = encode(BASE); const padded = Buffer.concat([frame.subarray(0, -1), Buffer.alloc(LIMIT + extra - frame.length, 32), Buffer.from('\n')]);
    assert.equal(padded.length, LIMIT + extra);
    const response = await run([padded]);
    if (extra) { assert.equal(response.ok, false); assert.equal(response.error.code, 'INPUT_LIMIT_EXCEEDED'); }
    else assert.equal(response.ok, true);
  });
}
for (const [name, value] of [['missing', undefined], ['null', null], ['boolean', false], ['number', 4], ['array key', [BASE.action]], ['object', {}], ['shadowed toString', {toString: null}], ['nested array shadowed toString', [[{toString: null}]]]]) {
  test(`non-string action ${name} is rejected without coercion`, async () => {
    const request = clone(BASE); request.action = value;
    const response = await run([encode(request)]);
    assert.equal(response.ok, false); assert.equal(response.error.code, 'ACTION_DENIED');
    assert.equal(response.requestId, BASE.requestId); assert.equal(response.creationId, BASE.creationId);
  });
}
