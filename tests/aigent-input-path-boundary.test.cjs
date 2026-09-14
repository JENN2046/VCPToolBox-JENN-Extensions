'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const workflow = require('../Plugin/AIGentWorkflow/stdio-entrypoint.cjs');
const Agent = require('../Plugin/AIGentWorkflow/WorkflowOrchestrator.js');
const quality = require('../Plugin/AIGentQuality/stdio-entrypoint.cjs');
const qualityCore = require('../Plugin/AIGentQuality/AIGentQuality.js');
const style = require('../Plugin/AIGentStyle/stdio-entrypoint.cjs');
const styleCore = require('../Plugin/AIGentStyle/AIGentStyle.js');

function rejected(response, code = 'REQUEST_REJECTED') {
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, code);
  assert.equal(response.result, undefined);
}

const invalidPrompts = [
  ['missing', {}], ['empty', { user_input: '' }], ['whitespace', { user_input: ' \t ' }],
  ['both blank', { user_input: ' ', description: '\n' }], ['number', { user_input: 42 }],
  ['object', { user_input: {} }], ['array', { user_input: ['synthetic portrait'] }],
  ['boolean', { user_input: true }]
];
for (const [label, fields] of invalidPrompts) {
  test(`Workflow rejects ${label} prompt before execute`, async () => {
    const original = Agent.prototype.execute; let calls = 0;
    Agent.prototype.execute = async () => { calls++; return { success: true, simulated: true }; };
    try {
      rejected(await workflow.handleRequest({ action: 'ExecuteWorkflow', ...fields }));
      assert.equal(calls, 0);
    } finally { Agent.prototype.execute = original; }
  });
}
const validPrompts = [
  ['primary', { user_input: ' synthetic portrait ' }, 'synthetic portrait'],
  ['description alias', { description: ' synthetic portrait ' }, 'synthetic portrait'],
  ['blank primary fallback', { user_input: ' \t ', description: ' synthetic portrait ' }, 'synthetic portrait'],
  ['nonstring primary fallback', { user_input: {}, description: 'synthetic portrait' }, 'synthetic portrait'],
  ['primary precedence', { user_input: 'synthetic portrait', description: 'synthetic ecommerce dress' }, 'synthetic portrait']
];
for (const [label, fields, expected] of validPrompts) {
  test(`Workflow preserves ${label}`, async () => {
    const original = Agent.prototype.execute; const seen = [];
    Agent.prototype.execute = async (input, options) => { seen.push({ input, options }); return { success: true, simulated: true }; };
    try {
      const result = await workflow.handleRequest({ action: 'ExecuteWorkflow', ...fields });
      assert.equal(result.status, 'success'); assert.equal(result.result.simulated, true);
      assert.deepEqual(seen, [{ input: expected, options: { simulate: true, auto_execute: false, external_effects: false } }]);
    } finally { Agent.prototype.execute = original; }
  });
}
function main(fields) {
  const result = spawnSync(process.execPath, ['--no-addons', '--permission', `--allow-fs-read=${root}`,
    path.join(root, 'Plugin/AIGentWorkflow/stdio-entrypoint.cjs')], {
    env: { PATH: '/usr/bin', LANG: 'C.UTF-8' }, encoding: 'utf8', timeout: 3000, maxBuffer: 65536,
    input: JSON.stringify({ action: 'ExecuteWorkflow', ...fields })
  });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.signal, null);
  assert.equal(result.stderr, ''); assert.equal(result.stdout.split('\n').length, 2);
  return JSON.parse(result.stdout);
}
test('Workflow actual main rejects absent prompt without simulated result', () => rejected(main({})));
test('Workflow actual main accepts explicit description alias', () => {
  const result = main({ description: 'synthetic portrait' });
  assert.equal(result.status, 'success'); assert.equal(result.result.simulated, true);
  assert.equal(result.result.provider_called, false); assert.equal(result.result.network_called, false);
});

function png(file, width = 1) {
  const b = Buffer.alloc(24); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(width, 16); b.writeUInt32BE(1, 20); fs.writeFileSync(file, b);
}
async function fixture(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aigent-input-path-'));
  const grant = path.join(base, 'grant'), outside = path.join(base, 'outside');
  fs.mkdirSync(grant); fs.mkdirSync(outside);
  const image = path.join(grant, 'inside.png'), other = path.join(outside, 'outside.png');
  png(image); png(other, 8);
  try { return await fn({ base, grant, outside, image, other }); }
  finally { fs.rmSync(base, { recursive: true, force: true }); }
}
for (const [label, primary] of [['absent', undefined], ['null', null], ['empty', ''], ['whitespace', ' \t '], ['nonstring', 42]]) {
  test(`Quality uses valid legacy path for ${label} primary`, async () => fixture(async ({ grant, image }) => {
    const response = await quality.handleRequest({ action: 'InspectImage', image_path: primary, path: image }, { AIGENT_QUALITY_ALLOWED_IMAGE_ROOT: grant });
    assert.equal(response.status, 'success'); assert.equal(response.result.image_path, image);
  }));
}
test('Quality refuses object path coercion before image inspection', async () => {
  let coerced = 0, calls = 0; const bad = { toString() { coerced++; return '/tmp/unused.png'; } };
  const original = qualityCore.handleRequest; qualityCore.handleRequest = async () => { calls++; return {}; };
  try {
    rejected(await quality.handleRequest({ action: 'InspectImage', image_path: bad, path: bad }, {}));
    assert.equal(coerced, 0); assert.equal(calls, 0);
  } finally { qualityCore.handleRequest = original; }
});

for (const replace of [false, true]) {
  test(`Quality hands canonical target to actual core${replace ? ' after alias replacement' : ''}`, async () => fixture(async ({ grant, image, other }) => {
    const alias = path.join(grant, 'alias.png'); fs.symlinkSync(image, alias);
    const original = qualityCore.handleRequest, originalOpen = fs.openSync; const seen = [], opened = [];
    qualityCore.handleRequest = async function (request) {
      seen.push(request.image_path);
      if (replace) { fs.unlinkSync(alias); fs.symlinkSync(other, alias); }
      return original.call(this, request);
    };
    fs.openSync = function (file, ...args) { opened.push(file); return originalOpen.call(this, file, ...args); };
    let response;
    try { response = await quality.handleRequest({ action: 'InspectImage', image_path: alias }, { AIGENT_QUALITY_ALLOWED_IMAGE_ROOT: grant }); }
    finally { qualityCore.handleRequest = original; fs.openSync = originalOpen; }
    assert.equal(response.status, 'success'); assert.deepEqual(seen, [image]);
    assert.deepEqual(opened, [image]); assert.equal(response.result.image_path, image);
    assert.equal(response.result.filename, 'inside.png');
    if (replace) assert.equal(fs.realpathSync(alias), other);
  }));
  test(`Style hands canonical target to actual core${replace ? ' after alias replacement' : ''}`, async () => fixture(async ({ grant, outside }) => {
    const dataset = path.join(grant, 'dataset'), alias = path.join(grant, 'alias');
    fs.mkdirSync(dataset); png(path.join(dataset, 'inside-only.png')); fs.symlinkSync(dataset, alias);
    const original = styleCore.handleRequest, originalRead = fs.readdirSync; const seen = [], read = [];
    styleCore.handleRequest = async function (request) {
      seen.push(request.dataset_path);
      if (replace) { fs.unlinkSync(alias); fs.symlinkSync(outside, alias); }
      return original.call(this, request);
    };
    fs.readdirSync = function (file, ...args) { read.push(file); return originalRead.call(this, file, ...args); };
    let response;
    try { response = await style.handleRequest({ action: 'PrepareDataset', dataset_path: alias }, { AIGENT_STYLE_ALLOWED_DATASET_ROOT: grant }); }
    finally { styleCore.handleRequest = original; fs.readdirSync = originalRead; }
    assert.equal(response.status, 'success'); assert.deepEqual(seen, [dataset]); assert.deepEqual(read, [dataset]);
    assert.equal(response.result.dataset_path, dataset); assert.equal(response.result.image_count, 1);
    assert.equal(response.result.images[0].filename, 'inside-only.png');
    if (replace) assert.equal(fs.realpathSync(alias), outside);
  }));
}
test('Quality rejects a canonical target that core trim would change', async () => fixture(async ({ grant, other }) => {
  const target = path.join(grant, 'target.png '), trimmed = target.trim(), alias = path.join(grant, 'alias.png');
  png(target); fs.symlinkSync(other, trimmed); fs.symlinkSync(target, alias);
  const original = qualityCore.handleRequest; let called = 0;
  qualityCore.handleRequest = async function (request) { called++; return original.call(this, request); };
  try {
    rejected(await quality.handleRequest({ action: 'InspectImage', image_path: alias }, { AIGENT_QUALITY_ALLOWED_IMAGE_ROOT: grant }), 'PATH_OUTSIDE_GRANT');
    assert.equal(called, 0);
  } finally { qualityCore.handleRequest = original; }
}));
test('Style preserves a canonical dataset target with trailing whitespace', async () => fixture(async ({ grant, outside }) => {
  const target = path.join(grant, 'dataset '), alias = path.join(grant, 'alias');
  fs.mkdirSync(target); png(path.join(target, 'inside-space.png')); fs.symlinkSync(outside, target.trim()); fs.symlinkSync(target, alias);
  const response = await style.handleRequest({ action: 'PrepareDataset', dataset_path: alias }, { AIGENT_STYLE_ALLOWED_DATASET_ROOT: grant });
  assert.equal(response.status, 'success'); assert.equal(response.result.dataset_path, target);
  assert.equal(response.result.images[0].filename, 'inside-space.png');
}));
