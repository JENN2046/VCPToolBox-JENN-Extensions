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

// Process-wide console capture is test-only and always restored, including
// against the old wrapper whose concurrent finally blocks corrupt it.
async function withLoggerConsoleCapture(fn) {
  const methods = ['log', 'warn', 'error'];
  const original = Object.fromEntries(methods.map((name) => [name, console[name]]));
  const events = [];
  const capture = Object.fromEntries(methods.map((name) => [name, (...args) => events.push({ name, args })]));
  Object.assign(console, capture);
  try {
    return await fn({ methods, capture, events });
  } finally {
    Object.assign(console, original);
  }
}

function assertLoggerConsoleIdentity(methods, capture) {
  for (const name of methods) assert.strictEqual(console[name], capture[name], `console.${name} changed`);
}

test('concurrent ExecuteWorkflow preserves every host console method after completion', async () => {
  await withLoggerConsoleCapture(async ({ methods, capture }) => {
    const entrypoint = freshEntrypoint();
    const responses = await Promise.all([
      entrypoint.handleRequest({ action: 'ExecuteWorkflow', user_input: 'synthetic ecommerce dress' }),
      entrypoint.handleRequest({ action: 'ExecuteWorkflow', user_input: 'synthetic portrait' })
    ]);
    for (const response of responses) {
      assert.equal(response.status, 'success');
      assert.equal(response.result.simulated, true);
      assert.equal(response.result.provider_called, false);
      assert.equal(response.result.comfyui_called, false);
    }
    assertLoggerConsoleIdentity(methods, capture);
  });
});

test('pending ExecuteWorkflow does not swallow unrelated caller logging', async () => {
  await withLoggerConsoleCapture(async ({ methods, capture, events }) => {
    const entrypoint = freshEntrypoint();
    const pending = [
      entrypoint.handleRequest({ action: 'ExecuteWorkflow', user_input: 'synthetic ecommerce dress' }),
      entrypoint.handleRequest({ action: 'ExecuteWorkflow', user_input: 'synthetic portrait' })
    ];
    console.log('synthetic caller log');
    console.warn('synthetic caller warn');
    console.error('synthetic caller error');
    const during = events.slice();
    await Promise.all(pending);
    assert.deepEqual(during, [
      { name: 'log', args: ['synthetic caller log'] },
      { name: 'warn', args: ['synthetic caller warn'] },
      { name: 'error', args: ['synthetic caller error'] }
    ]);
    assert.deepEqual(events, during, 'optional wrapper leaked orchestrator logs');
    assertLoggerConsoleIdentity(methods, capture);
  });
});

test('concurrent rejection propagates without corrupting the host console', async () => {
  await withLoggerConsoleCapture(async ({ methods, capture }) => {
    const entrypoint = freshEntrypoint();
    const Agent = require(orchestratorPath);
    const originalExecute = Agent.prototype.execute;
    const gates = [];
    Agent.prototype.execute = function () {
      return new Promise((resolve, reject) => gates.push({ resolve, reject }));
    };
    try {
      const first = entrypoint.handleRequest({ action: 'ExecuteWorkflow', user_input: 'synthetic portrait' });
      const second = entrypoint.handleRequest({ action: 'ExecuteWorkflow', user_input: 'synthetic portrait' });
      const settled = Promise.allSettled([first, second]);
      assert.equal(gates.length, 2);
      gates[0].resolve({ success: true, simulated: true });
      await first;
      gates[1].reject(new Error('synthetic workflow rejection'));
      const results = await settled;
      assert.equal(results[0].status, 'fulfilled');
      assert.equal(results[1].status, 'rejected');
      assert.equal(results[1].reason.message, 'synthetic workflow rejection');
      assertLoggerConsoleIdentity(methods, capture);
    } finally {
      Agent.prototype.execute = originalExecute;
    }
  });
});

test('default orchestrator keeps success and failure logging on console', async () => {
  await withLoggerConsoleCapture(async ({ methods, capture, events }) => {
    freshEntrypoint();
    const Agent = require(orchestratorPath);
    const agent = new Agent();
    const success = await agent.execute('synthetic ecommerce dress');
    const failure = await agent.execute(null);
    assert.equal(success.success, true);
    assert.equal(success.simulated, true);
    assert.equal(failure.success, false);
    assert.equal(typeof failure.error, 'string');
    assert(events.some((event) => event.name === 'log'));
    assert.equal(events.filter((event) => event.name === 'error').length, 1);
    assertLoggerConsoleIdentity(methods, capture);
  });
});

test('injected logger receives success and error with its own method receiver', async () => {
  await withLoggerConsoleCapture(async ({ methods, capture, events }) => {
    freshEntrypoint();
    const Agent = require(orchestratorPath);
    const records = [];
    const logger = Object.fromEntries(methods.map((name) => [name, function (...args) {
      records.push({ name, args, receiver: this });
    }]));
    const agent = new Agent({ logger });
    assert.equal((await agent.execute('synthetic portrait')).success, true);
    assert.equal((await agent.execute(null)).success, false);
    assert(records.some((record) => record.name === 'log'));
    assert.equal(records.filter((record) => record.name === 'error').length, 1);
    assert(records.every((record) => record.receiver === logger));
    assert.deepEqual(events, []);
    assertLoggerConsoleIdentity(methods, capture);
  });
});

test('concurrent orchestrator instances keep their injected logger records separate', async () => {
  await withLoggerConsoleCapture(async ({ methods, capture, events }) => {
    freshEntrypoint();
    const Agent = require(orchestratorPath);
    const buckets = [[], []];
    const loggers = buckets.map((bucket) => Object.fromEntries(methods.map((name) => [name, (...args) => bucket.push({ name, args })])));
    const inputs = ['synthetic ecommerce dress', 'synthetic portrait'];
    const results = await Promise.all(inputs.map((input, index) => new Agent({ logger: loggers[index] }).execute(input)));
    assert(results.every((result) => result.success === true && result.simulated === true));
    for (let index = 0; index < buckets.length; index++) {
      const requirements = buckets[index].filter((record) => record.args[0] === 'Requirements:');
      assert.equal(requirements.length, 1);
      assert.equal(requirements[0].args[1].raw, inputs[index]);
    }
    assert.deepEqual(events, []);
    assertLoggerConsoleIdentity(methods, capture);
  });
});

test('wrapper ignores request-supplied logging injection and stays silent', async () => {
  await withLoggerConsoleCapture(async ({ methods, capture, events }) => {
    const entrypoint = freshEntrypoint();
    let suppliedCalls = 0;
    const supplied = Object.fromEntries(methods.map((name) => [name, () => suppliedCalls++]));
    const response = await entrypoint.handleRequest({ action: 'ExecuteWorkflow', user_input: 'synthetic portrait', logger: supplied });
    assert.equal(response.status, 'success');
    assert.equal(response.result.simulated, true);
    assert.equal(suppliedCalls, 0);
    assert.deepEqual(events, []);
    assertLoggerConsoleIdentity(methods, capture);
  });
});

test('actual stdio ExecuteWorkflow emits one JSON response without orchestrator logs', () => {
  const { spawnSync } = require('node:child_process');
  const child = spawnSync(process.execPath, [
    '--no-addons', '--permission', `--allow-fs-read=${repoRoot}`, entrypointPath
  ], {
    input: JSON.stringify({ action: 'ExecuteWorkflow', user_input: 'synthetic portrait', simulate: true }),
    encoding: 'utf8', timeout: 3000, maxBuffer: 65536,
    env: { PATH: path.dirname(process.execPath), LANG: 'C.UTF-8' }
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.signal, null);
  assert.equal(child.stdout.split('\n').length, 2);
  assert(child.stdout.endsWith('\n'));
  const response = JSON.parse(child.stdout);
  assert.equal(response.status, 'success');
  assert.equal(response.result.simulated, true);
  assert.equal(response.result.provider_called, false);
  assert.equal(response.result.network_called, false);
  assert.equal(child.stderr, '');
});
