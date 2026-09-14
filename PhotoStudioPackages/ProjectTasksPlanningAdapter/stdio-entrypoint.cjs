'use strict';

const { planProjectTasksFromSnapshot } = require('./index.cjs');

const PROTOCOL_VERSION = 1;
const PROTOCOL_NAME = 'CANONICAL_JSONL_V1';
const CREATION_ID = 'jenn.photo-studio.plugin-project-tasks';
const ACTION = 'plan_project_tasks_from_snapshot';
const MAX_INPUT_BYTES = 262144;
const MAX_OUTPUT_BYTES = 262144;
const MAX_JSON_DEPTH = 12;
const POLLUTION_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);
const PROTECTED_KEYS = Object.freeze([
  'authorization',
  'cookie',
  'password',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'databaseUrl',
  'imagePath',
  'storageKey',
  'downloadUrl',
  'galleryUrl',
  'photoStudioDataDir',
  'localStatePath'
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function keyDenied(key) {
  const lower = String(key).toLowerCase();
  return PROTECTED_KEYS.some((item) => item.toLowerCase() === lower);
}

function inspectJsonShape(value, depth = 0) {
  if (depth > MAX_JSON_DEPTH) return { ok: false, code: 'JSON_DEPTH_EXCEEDED' };
  if (!value || typeof value !== 'object') return { ok: true };
  if (Array.isArray(value)) {
    for (const item of value) {
      const result = inspectJsonShape(item, depth + 1);
      if (!result.ok) return result;
    }
    return { ok: true };
  }
  if (!isPlainObject(value)) return { ok: false, code: 'OBJECT_SHAPE_INVALID' };
  for (const key of Object.keys(value)) {
    if (POLLUTION_KEYS.includes(key)) return { ok: false, code: 'PROTOTYPE_POLLUTION_KEY' };
    if (keyDenied(key)) return { ok: false, code: 'PROTECTED_DATA_KEY_DENIED' };
    const result = inspectJsonShape(value[key], depth + 1);
    if (!result.ok) return result;
  }
  return { ok: true };
}

function safeString(value, fallback = '') {
  return typeof value === 'string' ? value : fallback;
}

function safeErrorMessage(message) {
  return String(message || 'Request rejected.')
    .replace(/[A-Za-z]:\\[^\s"]+/g, '[redacted-path]')
    .replace(/\\\\[^\s"]+/g, '[redacted-path]')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [redacted]')
    .slice(0, 160);
}

function responseBase(request) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: safeString(request && request.requestId),
    creationId: safeString(request && request.creationId)
  };
}

function success(request, result) {
  return {
    ...responseBase(request),
    ok: true,
    result
  };
}

function failure(request, code, message) {
  return {
    ...responseBase(request),
    ok: false,
    error: {
      code: String(code || 'REQUEST_REJECTED').replace(/[^A-Z0-9_]/g, '_').slice(0, 80),
      message: safeErrorMessage(message)
    }
  };
}

function validateRequest(request) {
  if (!isPlainObject(request)) return failure(request, 'REQUEST_SHAPE_INVALID', 'Request must be a plain object.');
  const shape = inspectJsonShape(request);
  if (!shape.ok) return failure(request, shape.code, 'Request shape is not allowed.');
  if (request.protocolVersion !== PROTOCOL_VERSION) return failure(request, 'PROTOCOL_VERSION_UNSUPPORTED', 'Unsupported protocol version.');
  if (!safeString(request.requestId)) return failure(request, 'REQUEST_ID_REQUIRED', 'requestId is required.');
  if (request.action === '*' || String(request.action || '').includes('*')) return failure(request, 'ACTION_DENIED', 'Wildcard action is not authorized.');
  if (request.action !== ACTION) return failure(request, 'ACTION_DENIED', 'Action is not authorized for this entrypoint.');
  if (request.creationId !== CREATION_ID) return failure(request, 'CREATION_ID_DENIED', 'Creation id is not authorized for this action.');
  if (!isPlainObject(request.payload)) return failure(request, 'PAYLOAD_INVALID', 'Payload must be a plain object.');
  if (Object.prototype.hasOwnProperty.call(request.payload, 'action') || Object.prototype.hasOwnProperty.call(request.payload, 'tool_name')) {
    return failure(request, 'PAYLOAD_ACTION_COLLISION', 'Payload cannot contain action routing fields.');
  }
  return null;
}

function handleRequest(request) {
  const error = validateRequest(request);
  if (error) return error;
  try {
    return success(request, planProjectTasksFromSnapshot(request.payload));
  } catch (errorValue) {
    return failure(request, 'PROJECTION_REJECTED', errorValue && errorValue.message ? errorValue.message : 'Projection rejected input.');
  }
}

function parseLine(text) {
  if (!text.endsWith('\n')) return { ok: false, request: null, response: failure(null, 'INPUT_LINE_REQUIRED', 'Exactly one newline-terminated JSON line is required.') };
  const body = text.slice(0, -1);
  if (!body || body.includes('\n') || body.includes('\r')) {
    return { ok: false, request: null, response: failure(null, 'INPUT_LINE_REQUIRED', 'Exactly one JSON line is required.') };
  }
  try {
    return { ok: true, request: JSON.parse(body) };
  } catch {
    return { ok: false, request: null, response: failure(null, 'JSON_PARSE_FAILED', 'Input JSON could not be parsed.') };
  }
}

function emit(response) {
  const line = `${JSON.stringify(response)}\n`;
  if (byteLength(line) <= MAX_OUTPUT_BYTES) {
    process.stdout.write(line, 'utf8');
    return;
  }
  const fallback = `${JSON.stringify(failure(response, 'OUTPUT_LIMIT_EXCEEDED', 'Response exceeds byte limit.'))}\n`;
  if (byteLength(fallback) <= MAX_OUTPUT_BYTES) {
    process.stdout.write(fallback, 'utf8');
    return;
  }
  process.stdout.write(`${JSON.stringify(failure(null, 'OUTPUT_LIMIT_EXCEEDED', 'Response exceeds byte limit.'))}\n`, 'utf8');
}

function main() {
  const chunks = [];
  let bytes = 0;
  let rejected = false;

  process.stdin.on('data', (chunk) => {
    bytes += chunk.length;
    if (bytes > MAX_INPUT_BYTES) {
      rejected = true;
    } else {
      chunks.push(chunk);
    }
  });

  process.stdin.on('end', () => {
    if (rejected) {
      emit(failure(null, 'INPUT_LIMIT_EXCEEDED', 'Input exceeds byte limit.'));
      return;
    }
    const parsed = parseLine(Buffer.concat(chunks).toString('utf8'));
    emit(parsed.ok ? handleRequest(parsed.request) : parsed.response);
  });

  process.stdin.resume();
}

if (require.main === module) {
  main();
}

module.exports = {
  PROTOCOL_NAME,
  ACTION,
  CREATION_ID,
  handleRequest,
  parseLine
};
