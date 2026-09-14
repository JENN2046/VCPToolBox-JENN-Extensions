'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const entrypointPath = path.join(repoRoot, 'Plugin', 'AIGentWorkflow', 'stdio-entrypoint.cjs');
const orchestratorPath = path.join(repoRoot, 'Plugin', 'AIGentWorkflow', 'WorkflowOrchestrator.js');

function freshEntrypoint() {
  delete require.cache[require.resolve(entrypointPath)];
  delete require.cache[require.resolve(orchestratorPath)];
  return require(entrypointPath);
}

test('import/protocol has no stdout side effect', () => {
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

test('HealthCheck reports no injected ComfyUI or provider', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({ action: 'HealthCheck' });
  assert.equal(response.status, 'success');
  assert.equal(response.result.comfyui_injected, false);
  assert.equal(response.result.provider_injected, false);
});

test('ListTemplates uses in-memory templates only', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({ action: 'ListTemplates', category: 'ecommerce' });
  assert.equal(response.status, 'success');
  assert(response.result.templates.length >= 1);
  assert.equal(response.result.template_scan_performed, false);
});

test('ExecuteWorkflow is forced simulated', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({
    action: 'ExecuteWorkflow',
    user_input: 'synthetic ecommerce dress on white background',
    simulate: true
  });
  assert.equal(response.status, 'success');
  assert.equal(response.result.simulated, true);
  assert.equal(response.result.comfyui_called, false);
  assert.equal(response.result.provider_called, false);
  assert.equal(response.result.network_called, false);
});

test('real execution request is denied', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({
    action: 'ExecuteWorkflow',
    user_input: 'synthetic ecommerce image',
    simulate: false
  });
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'REAL_EXECUTION_DENIED');
});

test('uuid dependency closure uses no external uuid module', () => {
  const source = fs.readFileSync(orchestratorPath, 'utf8');
  assert(!/require\(['"]uuid['"]\)/.test(source));
});

test('wrapper does not call initialize or template fs scan', async () => {
  const source = fs.readFileSync(entrypointPath, 'utf8');
  assert(!/initialize\(|_loadWorkflowTemplates|readdir/.test(source));
});

test('wrapper source has no network API', () => {
  const source = fs.readFileSync(entrypointPath, 'utf8');
  assert(!/\bfetch\b|\bXMLHttpRequest\b|\bWebSocket\b|\bhttp\.|\bhttps\./.test(source));
});

test('stdout remains one JSON line', async () => {
  const entrypoint = freshEntrypoint();
  const line = await entrypoint.runStdinText(JSON.stringify({ action: 'ExecuteWorkflow', user_input: 'synthetic portrait', simulate: true }));
  assert.equal((line.match(/\n/g) || []).length, 1);
  assert.equal(JSON.parse(line).status, 'success');
});
