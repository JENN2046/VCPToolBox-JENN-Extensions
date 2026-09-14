"use strict";

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');
const entrypoint = path.resolve(__dirname, '../PhotoStudioPackages/SelectionNoticeSnapshotAdapter/stdio-entrypoint.cjs');
const { ACTION, CREATION_ID } = require(entrypoint);

function request(requestId = 'synthetic-request') {
  return {
    protocolVersion: 1, requestId, creationId: CREATION_ID, action: ACTION,
    payload: {
      generatedAt: '2026-06-23T00:00:00Z', tone: 'formal',
      projectSnapshot: { project_id: 'synthetic-project', project_name: 'Synthetic Project', status: 'editing' }
    }
  };
}

function parseResult(result) {
  assert.equal(result.status, 0, 'main exits with a protocol response');
  assert.equal(result.signal, null);
  assert.equal(result.stderr.length, 0);
  assert.ok(result.stdout.length <= 262144);
  const text = result.stdout.toString('utf8');
  assert.ok(text.endsWith('\n'));
  assert.equal(text.split('\n').length, 2);
  return JSON.parse(text);
}

function runBytes(bytes) {
  assert.ok(bytes.length <= 262144);
  const result = spawnSync(process.execPath, ['--no-addons', entrypoint], {
    input: bytes, env: {}, timeout: 5000, maxBuffer: 1048576
  });
  assert.equal(result.error, undefined);
  return parseResult(result);
}

function wireWithBytes(field, bytes) {
  const input = { ...request(), [field]: 'SYNTHETIC_BYTE_MARKER' };
  const text = Buffer.from(`${JSON.stringify(input)}\n`);
  const at = text.indexOf('SYNTHETIC_BYTE_MARKER');
  assert.ok(at >= 0);
  return Buffer.concat([text.subarray(0, at), Buffer.from(bytes), text.subarray(at + 'SYNTHETIC_BYTE_MARKER'.length)]);
}

for (const field of ['requestId', 'creationId']) {
  for (const [label, bytes] of [
    ['ff', [0xff]], ['fe', [0xfe]], ['truncated', [0xe2, 0x82]],
    ['overlong', [0xc0, 0xaf]], ['surrogate', [0xed, 0xa0, 0x80]],
    ['above Unicode limit', [0xf4, 0x90, 0x80, 0x80]],
    ['invalid continuation', [0xe2, 0x28, 0xa1]]
  ]) {
    test(`invalid UTF8 ${label} in ${field} cannot become an identifier`, () => {
      const response = runBytes(wireWithBytes(field, bytes));
      assert.equal(response.ok, false);
      assert.equal(response.error.code, 'JSON_PARSE_FAILED');
      assert.equal(response.requestId, '');
      assert.equal(response.creationId, '');
    });
  }
}

for (const id of ['synthetic-ASCII', '合成-🌿', 'literal-\uFFFD']) {
  test(`valid UTF8 identifier ${JSON.stringify(id)} remains exact`, () => {
    const response = runBytes(Buffer.from(`${JSON.stringify(request(id))}\n`));
    assert.equal(response.ok, true);
    assert.equal(response.requestId, id);
    assert.equal(response.creationId, CREATION_ID);
  });
}

test('a JSON escaped replacement character remains a valid distinct identifier', () => {
  const response = runBytes(Buffer.from(`${JSON.stringify(request('escaped-\uFFFD')).replace('\uFFFD', '\\ufffd')}\n`));
  assert.equal(response.ok, true);
  assert.equal(response.requestId, 'escaped-\uFFFD');
});

test('a leading UTF8 BOM keeps the original JSON parse rejection', () => {
  const response = runBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(`${JSON.stringify(request())}\n`)]));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'JSON_PARSE_FAILED');
  assert.equal(response.requestId, '');
});

test('valid multibyte bytes split across stdin writes remain exact', async () => {
  const id = 'split-🌿-合成';
  const bytes = Buffer.from(`${JSON.stringify(request(id))}\n`);
  const at = bytes.indexOf(Buffer.from('🌿'));
  const chunks = [bytes.subarray(0, at + 1), bytes.subarray(at + 1, at + 3), bytes.subarray(at + 3)];
  const child = spawn(process.execPath, ['--no-addons', entrypoint], { env: {} });
  const stdout = []; const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(chunk));
  child.stderr.on('data', (chunk) => stderr.push(chunk));
  const done = new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status, signal) => resolve({ status, signal, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
  const timeout = setTimeout(() => child.kill(), 5000);
  try {
    for (const chunk of chunks) {
      await new Promise((resolve, reject) => child.stdin.write(chunk, (error) => error ? reject(error) : resolve()));
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    child.stdin.end();
    const response = parseResult(await done);
    assert.equal(response.ok, true);
    assert.equal(response.requestId, id);
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null) child.kill();
  }
});
