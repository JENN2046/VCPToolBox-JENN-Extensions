"use strict";

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '../PhotoStudioPackages/ReadOnlyApiAdapters');
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

const adapter = require(path.join(packageRoot, 'index.cjs'));
const profileManifest = require(path.join(packageRoot, 'adapter-profile-manifest.json'));
const { ACTIONS, CREATION_IDS } = require(path.join(packageRoot, 'stdio-entrypoint.cjs'));
const payloadFor = (action) => {
  if (action === ACTIONS.legacyDelivery) return { referenceDate: '2026-06-23', commandCenterSnapshot: {}, deliveryReadinessSnapshot: {} };
  if (action === ACTIONS.deliveryOperations) return { operationsDeliveriesSnapshot: {} };
  if (action === ACTIONS.weeklyOperations) return { operationsWeeklyProjectsSnapshot: {} };
  if (action === ACTIONS.fieldQualityOperations) return { operationsProjectFieldQualitySnapshot: {} };
  throw new Error('Test action is not declared');
};

test('the four canonical actions still succeed with ordinary identifiers', () => {
  for (const [action, creationId] of [
    [ACTIONS.legacyDelivery, CREATION_IDS.delivery],
    [ACTIONS.deliveryOperations, CREATION_IDS.delivery],
    [ACTIONS.weeklyOperations, CREATION_IDS.weekly],
    [ACTIONS.fieldQualityOperations, CREATION_IDS.fieldAudit]
  ]) {
    const request = { protocolVersion: 1, requestId: 'synthetic-request', creationId, action, payload: payloadFor(action) };
    const { response } = runLine(encode(request));
    assert.equal(response.ok, true);
    assert.equal(response.requestId, request.requestId);
    assert.equal(response.creationId, request.creationId);
  }
});

for (const [index, profile] of adapter.listAdapterProfiles().entries()) {
  test(`listed profile ${index + 1} roundtrips through its actual canonical action`, () => {
    const canonical = profileManifest.profiles[index];
    const action = canonical.canonicalOperationsAction;
    assert.ok(profile.actions.some((item) => item.action === action));
    const { response } = runLine(encode({ protocolVersion: 1, requestId: 'synthetic-profile', creationId: profile.creationId, action, payload: payloadFor(action) }));
    assert.equal(response.ok, true, 'the listed creationId is accepted by its declared route');
    assert.equal(profile.creationId, canonical.creationId);
    assert.equal(response.creationId, canonical.creationId);
  });
}

for (const action of ['toString', 'constructor', 'hasOwnProperty', 'valueOf', '__defineGetter__', '__proto__']) {
  test(`inherited action name ${action} is denied with an error frame`, () => {
    const { response } = runLine(encode({ protocolVersion: 1, requestId: 'synthetic-denial', action, payload: payloadFor(ACTIONS.legacyDelivery) }));
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'ACTION_DENIED');
    assert.equal(response.requestId, 'synthetic-denial');
  });
}

for (const [label, action] of [
  ['missing', undefined], ['null', null], ['number', 17], ['array', []],
  ['array coercing to a valid key', [ACTIONS.legacyDelivery]], ['object shadowing toString', { toString: null }]
]) {
  test(`non-string action ${label} is denied without coercion`, () => {
    const { response } = runLine(encode({ protocolVersion: 1, requestId: 'synthetic-denial', creationId: CREATION_IDS.delivery, action, payload: payloadFor(ACTIONS.legacyDelivery) }));
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'ACTION_DENIED');
  });
}

for (const action of ['not_declared', '*']) {
  test(`unregistered action ${action} remains denied`, () => {
    const { response } = runLine(encode({ protocolVersion: 1, requestId: 'synthetic-denial', creationId: CREATION_IDS.delivery, action, payload: payloadFor(ACTIONS.legacyDelivery) }));
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'ACTION_DENIED');
  });
}
