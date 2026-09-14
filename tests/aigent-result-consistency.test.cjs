'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const quality = require('../Plugin/AIGentQuality/stdio-entrypoint.cjs');
const workflow = require('../Plugin/AIGentWorkflow/stdio-entrypoint.cjs');
const Agent = require('../Plugin/AIGentWorkflow/WorkflowOrchestrator.js');
const silent = Object.freeze({ log() {}, warn() {}, error() {} });

const qualityCases = [
  ['pass without advice', { verdict: 'pass' }, 'review', 1],
  ['pass with null advice', { verdict: 'pass', workflow_advice: null }, 'review', 1],
  ['pass with manual route', { verdict: 'pass', workflow_advice: { route: 'manual_review' } }, 'review', 1],
  ['pass with retry route', { verdict: 'pass', workflow_advice: { route: 'retry' } }, 'review', 1],
  ['pass with empty route', { verdict: 'pass', workflow_advice: { route: '' } }, 'review', 1],
  ['pass with missing route', { verdict: 'pass', workflow_advice: {} }, 'review', 1],
  ['pass with accept route', { verdict: 'pass', workflow_advice: { route: 'accept' } }, 'pass', 0],
  ['review with accept route', { verdict: 'review', workflow_advice: { route: 'accept' } }, 'review', 1],
  ['fail with accept route', { verdict: 'fail', workflow_advice: { route: 'accept' } }, 'fail', 1],
  ['missing verdict remains review', {}, 'review', 1]
];
for (const [label, report, expectedVerdict, expectedCount] of qualityCases) {
  test(`Quality result consistency: ${label}`, async () => {
    const before = JSON.stringify(report);
    const response = await quality.handleRequest({ action: 'BuildRetryPlan', report });
    assert.equal(response.status, 'success');
    assert.equal(response.result.overall_verdict, expectedVerdict);
    assert.equal(response.result.retry_count, expectedCount);
    assert.equal(response.result.retry_queue.length, expectedCount);
    assert.strictEqual(response.result.report, report);
    assert.equal(JSON.stringify(report), before);
    assert.deepEqual(response.result.safety, {
      real_generation_retried: false, workflow_invoked: false, external_service_called: false
    });
    if (expectedCount) assert.equal(response.result.retry_queue[0].verdict, report.verdict || 'review');
  });
}

function assertWorkflowFailure(response, message) {
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'REQUEST_REJECTED');
  assert.equal(response.error.message, message);
  assert.equal(Object.hasOwn(response, 'result'), false);
  assert.equal(Object.hasOwn(response, 'simulated'), false);
}

test('Workflow actual unmatched description preserves core matching failure', async () => {
  const input = 'draw a landscape';
  const core = await new Agent({ logger: silent }).execute(input);
  assert.equal(core.success, false);
  assert.equal(typeof core.error, 'string');
  assert.equal(Object.hasOwn(core, 'simulated'), false);
  assertWorkflowFailure(await workflow.handleRequest({ action: 'ExecuteWorkflow', user_input: input }), core.error);
});

test('Workflow actual stdin unmatched request emits only a failure envelope', async () => {
  const root = path.resolve(__dirname, '..');
  const entry = path.join(root, 'Plugin/AIGentWorkflow/stdio-entrypoint.cjs');
  const core = await new Agent({ logger: silent }).execute('draw a landscape');
  const child = spawnSync(process.execPath, ['--no-addons', '--permission', `--allow-fs-read=${root}`, entry], {
    input: JSON.stringify({ action: 'ExecuteWorkflow', user_input: 'draw a landscape' }),
    encoding: 'utf8', timeout: 3000, maxBuffer: 65536,
    env: { PATH: path.dirname(process.execPath), LANG: 'C.UTF-8' }
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 0);
  assert.equal(child.signal, null);
  assert.equal(child.stderr, '');
  assert.equal(child.stdout.split('\n').length, 2);
  assert(child.stdout.endsWith('\n'));
  assertWorkflowFailure(JSON.parse(child.stdout), core.error);
});

test('Workflow core caught error is propagated without a simulation claim', async () => {
  const original = Agent.prototype.matchTemplate;
  Agent.prototype.matchTemplate = () => { throw new Error('synthetic matching exception'); };
  try {
    const response = await workflow.handleRequest({ action: 'ExecuteWorkflow', user_input: 'synthetic portrait' });
    assertWorkflowFailure(response, 'synthetic matching exception');
  } finally {
    Agent.prototype.matchTemplate = original;
  }
});

test('Workflow recognized description retains successful simulation fields', async () => {
  const response = await workflow.handleRequest({ action: 'ExecuteWorkflow', user_input: 'synthetic portrait' });
  assert.equal(response.status, 'success');
  assert.equal(response.result.success, true);
  assert.equal(response.result.simulated, true);
  assert.equal(Object.hasOwn(response, 'error'), false);
  for (const key of ['auto_execute', 'external_effects', 'comfyui_called', 'provider_called', 'network_called']) {
    assert.equal(response.result[key], false);
  }
});

test('Workflow mixed success and failure do not affect host console identities', async () => {
  const before = ['log', 'warn', 'error'].map(name => console[name]);
  const responses = await Promise.all([
    workflow.handleRequest({ action: 'ExecuteWorkflow', user_input: 'synthetic portrait' }),
    workflow.handleRequest({ action: 'ExecuteWorkflow', user_input: 'draw a landscape' })
  ]);
  assert.equal(responses[0].status, 'success');
  assert.equal(responses[0].result.simulated, true);
  assertWorkflowFailure(responses[1], '未找到匹配的工作流模板');
  assert.deepEqual(['log', 'warn', 'error'].map(name => console[name]), before);
});

test('Workflow real execution request remains denied', async () => {
  const response = await workflow.handleRequest({ action: 'ExecuteWorkflow', user_input: 'synthetic portrait', simulate: false });
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'REAL_EXECUTION_DENIED');
  assert.equal(Object.hasOwn(response, 'result'), false);
});
