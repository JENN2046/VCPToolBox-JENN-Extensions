#!/usr/bin/env node
'use strict';

const MAX_INPUT_BYTES = 16 * 1024;

const fs = require('fs');
const path = require('path');
const style = require('./AIGentStyle.js');

const ALLOWED_ACTIONS = new Set(['HealthCheck', 'RecommendParams', 'PrepareDataset']);
const FORBIDDEN_TRUE_FLAGS = new Set([
  'write_manifest',
  'write_captions',
  'write_job_manifest',
  'execute_training',
  'confirm_real_training',
  'allow_training',
  'real_training',
  'external_effects'
]);

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
    if (FORBIDDEN_TRUE_FLAGS.has(key) && request[key] === true) {
      return responseError('WRITE_OR_EXECUTION_DENIED', `${key}=true is not allowed in FS2F compatibility mode`);
    }
  }
  return null;
}

function realInside(root, child) {
  const resolvedRoot = fs.realpathSync(path.resolve(root));
  if (!fs.statSync(resolvedRoot).isDirectory()) return null;
  const resolvedChild = fs.realpathSync(path.resolve(child));
  return resolvedChild === resolvedRoot || resolvedChild.startsWith(`${resolvedRoot}${path.sep}`)
    ? resolvedChild : null;
}

function resolveDatasetGrant(request, env) {
  if (typeof request.dataset_path !== 'string' || !request.dataset_path.trim()) {
    return responseError('REQUEST_REJECTED', 'PrepareDataset requires an explicit dataset_path.');
  }
  if (typeof env.AIGENT_STYLE_ALLOWED_DATASET_ROOT !== 'string' || !env.AIGENT_STYLE_ALLOWED_DATASET_ROOT.trim()) {
    return responseError('PATH_GRANT_REQUIRED', 'PrepareDataset requires an explicit allowed dataset root.');
  }
  try {
    const canonicalPath = realInside(env.AIGENT_STYLE_ALLOWED_DATASET_ROOT, request.dataset_path);
    if (!canonicalPath) {
      return responseError('PATH_OUTSIDE_GRANT', 'dataset_path is outside the authorized synthetic root');
    }
    return canonicalPath;
  } catch (error) {
    return responseError('PATH_OUTSIDE_GRANT', error.message);
  }
}

async function handleRequest(request, env = process.env) {
  const shapeError = assertPlainRequest(request);
  if (shapeError) return shapeError;
  const action = actionFromRequest(request);
  if (!action.ok) return action.response;
  if (action.action === 'PrepareDataset') {
    const datasetPath = resolveDatasetGrant(request, env);
    if (typeof datasetPath !== 'string') return datasetPath;
    request = { ...request, dataset_path: datasetPath };
  }

  return style.handleRequest({ ...request, action: action.action });
}

async function runStdinText(input, env = process.env) {
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
  const response = await handleRequest(request, env);
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
