'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const entrypointPath = path.join(repoRoot, 'Plugin', 'AIGentStyle', 'stdio-entrypoint.cjs');

function freshEntrypoint(env = {}) {
  for (const [key, value] of Object.entries(env)) process.env[key] = value;
  delete require.cache[require.resolve(entrypointPath)];
  delete require.cache[require.resolve(path.join(repoRoot, 'Plugin', 'AIGentStyle', 'AIGentStyle.js'))];
  return require(entrypointPath);
}

async function withTemp(fn) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'fs2f-style-'));
  try {
    return await fn(temp);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function writePng(filePath) {
  fs.writeFileSync(filePath, Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000100ffff03000006000557bfab0d0000000049454e44ae426082',
    'hex'
  ));
}

test('HealthCheck reports training false', async () => withTemp(async (temp) => {
  const entrypoint = freshEntrypoint({
    AIGENT_STYLE_ALLOW_TRAINING: 'false',
    AIGENT_STYLE_DATASET_ROOT: temp,
    AIGENT_STYLE_OUTPUT_ROOT: path.join(temp, 'out')
  });
  const response = await entrypoint.handleRequest({ action: 'HealthCheck' });
  assert.equal(response.status, 'success');
  assert.equal(response.result.allow_training, false);
}));

test('RecommendParams is pure planning', async () => {
  const entrypoint = freshEntrypoint({ AIGENT_STYLE_ALLOW_TRAINING: 'false' });
  const response = await entrypoint.handleRequest({ action: 'RecommendParams', image_count: 18, scenario: 'portrait' });
  assert.equal(response.status, 'success');
  assert.equal(response.result.network_module, 'lora');
});

test('PrepareDataset reads synthetic dataset without output write', async () => withTemp(async (temp) => {
  const dataset = path.join(temp, 'dataset');
  const output = path.join(temp, 'output');
  fs.mkdirSync(dataset);
  fs.mkdirSync(output);
  writePng(path.join(dataset, 'style.png'));
  const before = fs.readdirSync(output);
  const entrypoint = freshEntrypoint({
    AIGENT_STYLE_ALLOW_TRAINING: 'false',
    AIGENT_STYLE_DATASET_ROOT: temp,
    AIGENT_STYLE_OUTPUT_ROOT: output
  });
  const response = await entrypoint.handleRequest(
    { action: 'PrepareDataset', dataset_path: dataset, dataset_name: 'synthetic-style' },
    { AIGENT_STYLE_ALLOWED_DATASET_ROOT: temp }
  );
  const after = fs.readdirSync(output);
  assert.equal(response.status, 'success');
  assert.equal(response.result.image_count, 1);
  assert.deepEqual(after, before);
}));

test('write_manifest=true is denied by gate', async () => {
  const entrypoint = freshEntrypoint({ AIGENT_STYLE_ALLOW_TRAINING: 'false' });
  const response = await entrypoint.handleRequest({ action: 'PrepareDataset', write_manifest: true });
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'WRITE_OR_EXECUTION_DENIED');
});

test('write_captions=true is denied by gate', async () => {
  const entrypoint = freshEntrypoint({ AIGENT_STYLE_ALLOW_TRAINING: 'false' });
  const response = await entrypoint.handleRequest({ action: 'PrepareDataset', write_captions: true });
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'WRITE_OR_EXECUTION_DENIED');
});

test('training-enable request is denied', async () => {
  const entrypoint = freshEntrypoint({ AIGENT_STYLE_ALLOW_TRAINING: 'false' });
  const response = await entrypoint.handleRequest({ action: 'PrepareDataset', execute_training: true });
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'WRITE_OR_EXECUTION_DENIED');
});

test('dataset path escape is rejected', async () => withTemp(async (temp) => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'fs2f-style-outside-'));
  try {
    const entrypoint = freshEntrypoint({
      AIGENT_STYLE_ALLOW_TRAINING: 'false',
      AIGENT_STYLE_DATASET_ROOT: temp,
      AIGENT_STYLE_OUTPUT_ROOT: path.join(temp, 'out')
    });
    const response = await entrypoint.handleRequest(
      { action: 'PrepareDataset', dataset_path: outside },
      { AIGENT_STYLE_ALLOWED_DATASET_ROOT: temp }
    );
    assert.equal(response.status, 'error');
    assert.equal(response.error.code, 'PATH_OUTSIDE_GRANT');
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
  }
}));

test('wrapper source has no child or network action', () => {
  const source = fs.readFileSync(entrypointPath, 'utf8');
  assert(!/child_process|\bspawn\b|\bexec\b|\bfork\b|Worker/.test(source));
  assert(!/\bfetch\b|\bXMLHttpRequest\b|\bWebSocket\b|\bhttp\.|\bhttps\./.test(source));
});

test('unknown action is rejected', async () => {
  const entrypoint = freshEntrypoint({ AIGENT_STYLE_ALLOW_TRAINING: 'false' });
  const response = await entrypoint.handleRequest({ action: 'ExecuteTrainingJob' });
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'UNKNOWN_ACTION');
});

test('stdout remains one JSON line', async () => {
  const entrypoint = freshEntrypoint({ AIGENT_STYLE_ALLOW_TRAINING: 'false' });
  const line = await entrypoint.runStdinText(JSON.stringify({ action: 'HealthCheck' }));
  assert.equal((line.match(/\n/g) || []).length, 1);
  assert.equal(JSON.parse(line).status, 'success');
});
