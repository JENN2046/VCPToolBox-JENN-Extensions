"use strict";

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const entrypoint = path.resolve(__dirname, '../PhotoStudioPackages/SelectionNoticeSnapshotAdapter/stdio-entrypoint.cjs');
const { ACTION, CREATION_ID } = require(entrypoint);

function runAction(action) {
  const request = {
    protocolVersion: 1, requestId: 'synthetic-action', creationId: CREATION_ID, action,
    payload: {
      generatedAt: '2026-06-23T00:00:00Z', tone: 'formal',
      projectSnapshot: { project_id: 'synthetic-project', project_name: 'Synthetic Project', status: 'editing' }
    }
  };
  const result = spawnSync(process.execPath, ['--no-addons', entrypoint], {
    input: `${JSON.stringify(request)}\n`, encoding: 'utf8', env: {},
    timeout: 5000, maxBuffer: 1048576
  });
  assert.equal(result.error, undefined, 'local stdio process completed');
  assert.equal(result.signal, null, 'local stdio process was not terminated');
  assert.equal(result.status, 0, 'invalid routing still returns a protocol frame');
  assert.equal(result.stderr.length, 0, 'no stderr output');
  assert.ok(result.stdout.endsWith('\n'));
  assert.equal(result.stdout.split('\n').length, 2);
  assert.ok(Buffer.byteLength(result.stdout) <= 262144);
  const response = JSON.parse(result.stdout);
  assert.equal(response.requestId, request.requestId);
  assert.equal(response.creationId, CREATION_ID);
  return response;
}

for (const [label, action] of [
  ['missing', undefined], ['null', null], ['boolean', false], ['number', 1],
  ['object', {}], ['empty array', []], ['array coercing to declared action', [ACTION]],
  ['object shadowing toString', { toString: null }],
  ['array containing an object shadowing toString', [{ toString: null }]]
]) {
  test(`non-string action ${label} is rejected by actual main`, () => {
    const response = runAction(action);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'ACTION_DENIED');
  });
}

for (const action of ['toString', 'constructor', '__proto__', 'not_declared', '*']) {
  test(`undeclared string action ${action} is rejected by actual main`, () => {
    const response = runAction(action);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'ACTION_DENIED');
  });
}

test('the sole declared action and advisory response remain unchanged', () => {
  const response = runAction(ACTION);
  assert.equal(response.ok, true);
  assert.equal(response.result.contractVersion, 3);
  assert.equal(response.result.copyVersion, 2);
  assert.equal(response.result.requiresHumanReview, true);
  assert.equal(response.result.sendReady, false);
  assert.equal(response.result.dispatchAuthorized, false);
  assert.equal(response.result.automaticNotificationAuthorized, false);
});
