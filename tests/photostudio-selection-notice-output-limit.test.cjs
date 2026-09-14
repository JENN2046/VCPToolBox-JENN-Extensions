"use strict";

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '../PhotoStudioPackages/SelectionNoticeSnapshotAdapter');
const entrypoint = path.join(packageRoot, 'stdio-entrypoint.cjs');
const LIMIT = 262144;
const FALLBACK = {
  protocolVersion: 1, requestId: '', creationId: '', ok: false,
  error: { code: 'OUTPUT_LIMIT_EXCEEDED', message: 'Response exceeds byte limit.' }
};
const encode = (request) => `${JSON.stringify(request)}\n`;

// Only a fresh copy of this exact local Node and entrypoint is invoked.
// Every request is synthetic; no API, provider, filesystem data or service is used.
function runLine(line) {
  const result = spawnSync(process.execPath, ['--no-addons', entrypoint], {
    input: line, encoding: 'utf8', env: {}, timeout: 5000, maxBuffer: 1048576
  });
  assert.equal(result.error, undefined, 'local stdio process completed');
  assert.equal(result.signal, null, 'local stdio process was not terminated');
  assert.equal(result.status, 0, 'local stdio process exited successfully');
  assert.equal(result.stderr.length, 0, 'no stderr output');
  assert.ok(result.stdout.endsWith('\n'), 'one JSONL frame terminates with LF');
  assert.equal(result.stdout.split('\n').length, 2, 'exactly one output frame');
  assert.ok(Buffer.byteLength(result.stdout) <= LIMIT, 'output remains within byte limit');
  return { response: JSON.parse(result.stdout), bytes: Buffer.byteLength(result.stdout) };
}

function largestInput(field, unit) {
  const request = { protocolVersion: 1, requestId: 'synthetic-request', creationId: 'synthetic-creation' };
  request[field] = '';
  const encodedUnitBytes = Buffer.byteLength(JSON.stringify(unit)) - 2;
  const count = Math.floor((LIMIT - Buffer.byteLength(encode(request))) / encodedUnitBytes);
  request[field] = unit.repeat(count);
  const line = encode(request);
  assert.ok(Buffer.byteLength(line) <= LIMIT);
  assert.ok(Buffer.byteLength(line) > LIMIT - encodedUnitBytes);
  return line;
}

for (const field of ['requestId', 'creationId']) {
  for (const [label, unit] of [['ASCII', 'x'], ['UTF8', '界'], ['JSON escape', '"']]) {
    test(`actual main bounds ${field} with ${label} bytes`, () => {
      const actual = runLine(largestInput(field, unit));
      assert.deepEqual(actual.response, FALLBACK);
      assert.equal(actual.bytes, Buffer.byteLength(encode(FALLBACK)));
    });
  }
}

for (const extra of [0, 1]) {
  test(`actual main preserves fallback IDs only at cap${extra ? '+1' : ''}`, () => {
    // This existing protocol error is longer than OUTPUT_LIMIT_EXCEEDED;
    // its fallback is exactly LIMIT or LIMIT+1 bytes including the trailing LF.
    const request = { protocolVersion: 0, requestId: '', creationId: '' };
    request.requestId = 'x'.repeat(LIMIT + extra - Buffer.byteLength(encode(FALLBACK)));
    const expected = { ...FALLBACK, requestId: request.requestId };
    assert.equal(Buffer.byteLength(encode(expected)), LIMIT + extra);
    assert.ok(Buffer.byteLength(encode(request)) <= LIMIT);
    const actual = runLine(encode(request));
    assert.equal(actual.response.error.code, 'OUTPUT_LIMIT_EXCEEDED');
    assert.ok(actual.response.requestId === (extra ? '' : request.requestId), 'identifier ownership is preserved iff the fallback fits');
    assert.equal(actual.response.creationId, '');
    assert.equal(actual.bytes, extra ? Buffer.byteLength(encode(FALLBACK)) : LIMIT);
  });
}

test('ordinary error retains request and creation identifiers', () => {
  const request = { protocolVersion: 0, requestId: 'synthetic-request', creationId: 'synthetic-creation' };
  const { response } = runLine(encode(request));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PROTOCOL_VERSION_UNSUPPORTED');
  assert.equal(response.requestId, request.requestId);
  assert.equal(response.creationId, request.creationId);
});

test('the original input byte limit still rejects before routing', () => {
  const { response } = runLine('x'.repeat(LIMIT + 1));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'INPUT_LIMIT_EXCEEDED');
  assert.equal(response.requestId, '');
  assert.equal(response.creationId, '');
});

const { ACTION, CREATION_ID } = require(path.join(packageRoot, 'stdio-entrypoint.cjs'));

test('ordinary selection notice success retains identifiers and advisory boundaries', () => {
  const request = {
    protocolVersion: 1, requestId: 'synthetic-request', creationId: CREATION_ID, action: ACTION,
    payload: {
      generatedAt: '2026-06-23T00:00:00Z', tone: 'formal',
      projectSnapshot: { project_id: 'synthetic-project', project_name: 'Synthetic Project', status: 'editing' }
    }
  };
  const { response } = runLine(encode(request));
  assert.equal(response.ok, true);
  assert.equal(response.requestId, request.requestId);
  assert.equal(response.creationId, request.creationId);
  assert.equal(response.result.contractVersion, 3);
  assert.equal(response.result.copyVersion, 2);
  assert.equal(response.result.requiresHumanReview, true);
  assert.equal(response.result.sendReady, false);
  assert.equal(response.result.dispatchAuthorized, false);
  assert.equal(response.result.automaticNotificationAuthorized, false);
});
