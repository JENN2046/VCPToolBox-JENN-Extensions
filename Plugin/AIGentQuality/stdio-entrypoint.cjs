#!/usr/bin/env node
'use strict';

const MAX_INPUT_BYTES = 16 * 1024;

const fs = require('fs');
const path = require('path');
const quality = require('./AIGentQuality.js');

const ALLOWED_ACTIONS = new Set(['HealthCheck', 'BuildRetryPlan', 'InspectImage']);

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

function realInside(root, child) {
  const resolvedRoot = fs.realpathSync(path.resolve(root));
  if (!fs.statSync(resolvedRoot).isDirectory()) return false;
  const resolvedChild = fs.realpathSync(path.resolve(child));
  return resolvedChild === resolvedRoot || resolvedChild.startsWith(`${resolvedRoot}${path.sep}`);
}

function assertImageGrant(request, env) {
  const imagePath = request.image_path || request.path;
  if (typeof imagePath !== 'string' || !imagePath.trim()
      || (request.image_path != null && typeof request.image_path !== 'string')) {
    return responseError('REQUEST_REJECTED', 'image_path must be a non-empty string for InspectImage');
  }
  if (typeof env.AIGENT_QUALITY_ALLOWED_IMAGE_ROOT !== 'string' || !env.AIGENT_QUALITY_ALLOWED_IMAGE_ROOT.trim()) {
    return responseError('PATH_GRANT_REQUIRED', 'InspectImage requires an explicit allowed image root.');
  }
  try {
    if (!realInside(env.AIGENT_QUALITY_ALLOWED_IMAGE_ROOT, imagePath.trim())) {
      return responseError('PATH_OUTSIDE_GRANT', 'image_path is outside the authorized synthetic root');
    }
  } catch (error) {
    return responseError('PATH_OUTSIDE_GRANT', error.message);
  }
  return null;
}

function queueEntryFromReport(report) {
  return {
    image_path: report.image_path || '<synthetic-report>',
    filename: report.filename || 'synthetic-report',
    verdict: report.verdict || 'review',
    score: Number.isFinite(report.score) ? report.score : null,
    route: report.workflow_advice && report.workflow_advice.route || 'manual_review',
    actions: report.workflow_advice && Array.isArray(report.workflow_advice.actions)
      ? report.workflow_advice.actions
      : []
  };
}

function buildRetryPlanFromReport(report) {
  const needsAction = report.verdict !== 'pass'
    || !report.workflow_advice
    || report.workflow_advice.route !== 'accept';
  return {
    dry_run: true,
    source: 'synthetic_report',
    overall_verdict: report.verdict || 'review',
    retry_count: needsAction ? 1 : 0,
    retry_queue: needsAction ? [queueEntryFromReport(report)] : [],
    safety: {
      real_generation_retried: false,
      workflow_invoked: false,
      external_service_called: false
    },
    report
  };
}

async function handleRequest(request, env = process.env) {
  const shapeError = assertPlainRequest(request);
  if (shapeError) return shapeError;
  const action = actionFromRequest(request);
  if (!action.ok) return action.response;

  if (action.action === 'BuildRetryPlan') {
    if (!request.report || typeof request.report !== 'object' || Array.isArray(request.report)) {
      return responseError('REQUEST_REJECTED', 'BuildRetryPlan requires a synthetic report in FS2F compatibility mode');
    }
    return {
      status: 'success',
      result: buildRetryPlanFromReport(request.report)
    };
  }

  if (action.action === 'InspectImage') {
    const grantError = assertImageGrant(request, env);
    if (grantError) return grantError;
    request = { ...request, image_path: (request.image_path || request.path).trim() };
  }

  return quality.handleRequest({ ...request, action: action.action });
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
