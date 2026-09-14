#!/usr/bin/env node
'use strict';

const MAX_INPUT_BYTES = 16 * 1024;

const WorkflowOrchestratorAgent = require('./WorkflowOrchestrator.js');

const ALLOWED_ACTIONS = new Set(['HealthCheck', 'ListTemplates', 'ExecuteWorkflow']);
const SILENT_LOGGER = Object.freeze({ log() {}, warn() {}, error() {} });

function responseError(code, message) {
  return {
    status: 'error',
    error: { code, message }
  };
}

function actionFromRequest(request) {
  const action = String(request.action || '').trim();
  const toolName = String(request.tool_name || '').trim();
  if (action && toolName && action !== toolName) {
    return { ok: false, response: responseError('ACTION_MISMATCH', 'action and tool_name must match') };
  }
  const value = action || toolName;
  if (!ALLOWED_ACTIONS.has(value)) {
    return { ok: false, response: responseError('UNKNOWN_ACTION', `unsupported action: ${value || '(empty)'}`) };
  }
  return { ok: true, action: value };
}

function assertPlainRequest(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    return responseError('REQUEST_REJECTED', 'request must be an object');
  }
  for (const key of Object.keys(request)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return responseError('REQUEST_REJECTED', 'unsafe request key');
    }
  }
  return null;
}

function realExecutionRequested(request) {
  return request.simulate === false
    || request.auto_execute === true
    || request.external_effects === true
    || request.execute === true
    || request.execute_workflow === true;
}

async function handleRequest(request) {
  const shapeError = assertPlainRequest(request);
  if (shapeError) return shapeError;
  const action = actionFromRequest(request);
  if (!action.ok) return action.response;

  const agent = new WorkflowOrchestratorAgent({ logger: SILENT_LOGGER });
  if (action.action === 'HealthCheck') {
    return {
      status: 'success',
      result: {
        package_name: 'AIGentWorkflow',
        protocol: 'LEGACY_FLAT_ACTION_V1',
        simulate_required: true,
        auto_execute_default: false,
        comfyui_injected: false,
        provider_injected: false,
        network_required: false,
        supported_actions: Array.from(ALLOWED_ACTIONS)
      }
    };
  }

  if (action.action === 'ListTemplates') {
    const templates = agent.getAvailableTemplates();
    const category = String(request.category || '').trim();
    return {
      status: 'success',
      result: {
        templates: category ? templates.filter((item) => item.category === category) : templates,
        category: category || null,
        template_scan_performed: false
      }
    };
  }

  if (realExecutionRequested(request)) {
    return responseError('REAL_EXECUTION_DENIED', 'ExecuteWorkflow is simulate-only in FS2F compatibility mode');
  }

  const userInput = String(request.user_input || request.description || 'synthetic ecommerce studio product image').trim();
  const result = await agent.execute(userInput, {
    simulate: true,
    auto_execute: false,
    external_effects: false
  });
  if (result.success === false) {
    return responseError('REQUEST_REJECTED', result.error);
  }
  return {
    status: 'success',
    result: {
      ...result,
      simulated: true,
      auto_execute: false,
      external_effects: false,
      comfyui_called: false,
      provider_called: false,
      network_called: false
    }
  };
}

async function runStdinText(input) {
  if (Buffer.byteLength(String(input || ''), 'utf8') > MAX_INPUT_BYTES) {
    return `${JSON.stringify(responseError('INPUT_TOO_LARGE', 'Request exceeds the compatibility input limit.'))}\n`;
  }
  let request = {};
  if (String(input || '').trim()) {
    try {
      request = JSON.parse(input);
    } catch (error) {
      return `${JSON.stringify(responseError('INVALID_JSON', error.message))}\n`;
    }
  }
  const response = await handleRequest(request);
  return `${JSON.stringify(response)}\n`;
}

async function readStdin() {
  const chunks = [];
  let total = 0;
  for await (const chunk of process.stdin) {
    total += chunk.length;
    if (total > MAX_INPUT_BYTES) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const input = await readStdin();
  if (input === null) {
    process.stdout.write(`${JSON.stringify(responseError('INPUT_TOO_LARGE', 'Request exceeds the compatibility input limit.'))}\n`);
    return;
  }
  process.stdout.write(await runStdinText(input));
}

if (require.main === module) {
  main().catch(() => {
    process.stdout.write(`${JSON.stringify(responseError('REQUEST_REJECTED', 'Request could not be processed.'))}\n`);
  });
}

module.exports = {
  handleRequest,
  runStdinText
};
