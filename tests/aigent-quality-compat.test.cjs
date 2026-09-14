'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const entrypointPath = path.join(repoRoot, 'Plugin', 'AIGentQuality', 'stdio-entrypoint.cjs');

function freshEntrypoint() {
  delete require.cache[require.resolve(entrypointPath)];
  delete require.cache[require.resolve(path.join(repoRoot, 'Plugin', 'AIGentQuality', 'AIGentQuality.js'))];
  return require(entrypointPath);
}

async function withTemp(fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs2f-quality-'));
  try {
    return await fn(temp);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function writePng(filePath) {
  const bytes = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfab0d0000000049454e44ae426082',
    'hex'
  );
  fs.writeFileSync(filePath, bytes);
}

test('protocol import has no stdout side effect', () => {
  const writes = [];
  const original = process.stdout.write;
  process.stdout.write = function capture(chunk, encoding, callback) {
    writes.push(String(chunk));
    if (typeof callback === 'function') callback();
    return true;
  };
  try {
    freshEntrypoint();
  } finally {
    process.stdout.write = original;
  }
  assert.deepEqual(writes, []);
});

test('HealthCheck keeps external vision false', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({ action: 'HealthCheck' }, { AIGENT_QUALITY_EXTERNAL_VISION: 'false' });
  assert.equal(response.status, 'success');
  assert.equal(response.result.external_vision_enabled, false);
});

test('BuildRetryPlan uses synthetic in-memory report only', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({
    action: 'BuildRetryPlan',
    report: {
      image_path: '<synthetic>',
      filename: 'synthetic.png',
      verdict: 'review',
      score: 72,
      workflow_advice: {
        route: 'manual_review',
        actions: [{ action: 'manual_review', priority: 'medium' }]
      }
    }
  });
  assert.equal(response.status, 'success');
  assert.equal(response.result.source, 'synthetic_report');
  assert.equal(response.result.safety.external_service_called, false);
});

test('InspectImage reads one synthetic image inside grant', async () => withTemp(async (temp) => {
  const imagePath = path.join(temp, 'synthetic.png');
  writePng(imagePath);
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest(
    { action: 'InspectImage', image_path: imagePath },
    { AIGENT_QUALITY_ALLOWED_IMAGE_ROOT: temp }
  );
  assert.equal(response.status, 'success');
  assert.equal(response.result.filename, 'synthetic.png');
  assert.equal(response.result.dry_run, true);
}));

test('path outside authorized root is rejected by gate', async () => withTemp(async (temp) => {
  const outside = path.join(os.tmpdir(), 'fs2f-quality-outside.png');
  writePng(outside);
  try {
    const entrypoint = freshEntrypoint();
    const response = await entrypoint.handleRequest(
      { action: 'InspectImage', image_path: outside },
      { AIGENT_QUALITY_ALLOWED_IMAGE_ROOT: temp }
    );
    assert.equal(response.status, 'error');
    assert.equal(response.error.code, 'PATH_OUTSIDE_GRANT');
  } finally {
    fs.rmSync(outside, { force: true });
  }
}));

test('wrapper source has no write/network/provider APIs', () => {
  const source = fs.readFileSync(entrypointPath, 'utf8');
  assert(!/\bwriteFile(?:Sync)?\b|\bappendFile(?:Sync)?\bcreateWriteStream\b/.test(source));
  assert(!/\bfetch\b|\bXMLHttpRequest\b|\bWebSocket\b|\bhttp\.|\bhttps\./.test(source));
  assert(!/provider|bridge|child_process|\bspawn\b|\bexec\b|\bfork\b/.test(source));
});

test('malformed request is rejected', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest(null);
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'REQUEST_REJECTED');
});

test('unknown action is rejected', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({ action: 'InspectBatch' });
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'UNKNOWN_ACTION');
});

test('stdout remains one JSON line', async () => {
  const entrypoint = freshEntrypoint();
  const line = await entrypoint.runStdinText(JSON.stringify({ action: 'HealthCheck' }));
  assert.equal((line.match(/\n/g) || []).length, 1);
  assert.equal(JSON.parse(line).status, 'success');
});
