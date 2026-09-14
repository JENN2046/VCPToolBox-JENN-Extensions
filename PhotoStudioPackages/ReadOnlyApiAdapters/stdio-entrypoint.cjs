'use strict';

const {
  ACTIONS,
  buildDeliveryOperatorProjection,
  buildDeliveryOperatorOperationsProjection,
  buildWeeklyProjectDigestProjection,
  buildProjectFieldQualityProjection
} = require('./index.cjs');

const PROTOCOL_VERSION = 1;
const PROTOCOL_NAME = 'CANONICAL_JSONL_V1';
const CREATION_IDS = Object.freeze({
  delivery: 'jenn.photo-studio.plugin-delivery-operator-report',
  weekly: 'jenn.photo-studio.plugin-weekly-project-digest',
  fieldAudit: 'jenn.photo-studio.plugin-field-audit'
});
const MAX_INPUT_BYTES = 262144;
const MAX_OUTPUT_BYTES = 262144;
const MAX_JSON_DEPTH = 12;
const POLLUTION_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype']);
const FORBIDDEN_DATA_KEYS = Object.freeze([
  'authorization',
  'cookie',
  'password',
  'secret',
  'token',
  'accessToken',
  'refreshToken',
  'downloadToken',
  'packageKey',
  'manifestKey',
  'storageKey',
  'email',
  'phone'
]);

const ACTION_TABLE = Object.freeze({
  [ACTIONS.legacyDelivery]: Object.freeze({
    creationId: CREATION_IDS.delivery,
    payloadField: null,
    build: (payload) => buildDeliveryOperatorProjection({
      referenceDate: payload.referenceDate,
      commandCenter: payload.commandCenterSnapshot,
      readiness: payload.deliveryReadinessSnapshot
    })
  }),
  [ACTIONS.deliveryOperations]: Object.freeze({
    creationId: CREATION_IDS.delivery,
    payloadField: 'operationsDeliveriesSnapshot',
    build: (payload) => buildDeliveryOperatorOperationsProjection({
      operationsDeliveriesSnapshot: payload.operationsDeliveriesSnapshot
    })
  }),
  [ACTIONS.weeklyOperations]: Object.freeze({
    creationId: CREATION_IDS.weekly,
    payloadField: 'operationsWeeklyProjectsSnapshot',
    build: (payload) => buildWeeklyProjectDigestProjection({
      operationsWeeklyProjectsSnapshot: payload.operationsWeeklyProjectsSnapshot
    })
  }),
  [ACTIONS.fieldQualityOperations]: Object.freeze({
    creationId: CREATION_IDS.fieldAudit,
    payloadField: 'operationsProjectFieldQualitySnapshot',
    build: (payload) => buildProjectFieldQualityProjection({
      operationsProjectFieldQualitySnapshot: payload.operationsProjectFieldQualitySnapshot
    })
  })
});

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function byteLength(value) {
  return Buffer.byteLength(value, 'utf8');
}

function isForbiddenDataKey(key) {
  return FORBIDDEN_DATA_KEYS.some((item) => item.toLowerCase() === String(key).toLowerCase());
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
    if (isForbiddenDataKey(key)) return { ok: false, code: 'PROTECTED_DATA_KEY_DENIED' };
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
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer [redacted]')
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

function emit(response) {
  const line = `${JSON.stringify(response)}\n`;
  if (byteLength(line) > MAX_OUTPUT_BYTES) {
    const fallback = failure(response, 'OUTPUT_LIMIT_EXCEEDED', 'Response exceeds byte limit.');
    const fallbackLine = `${JSON.stringify(fallback)}\n`;
    if (byteLength(fallbackLine) <= MAX_OUTPUT_BYTES) {
      process.stdout.write(fallbackLine, 'utf8');
      return;
    }
    process.stdout.write(`${JSON.stringify(failure(null, 'OUTPUT_LIMIT_EXCEEDED', 'Response exceeds byte limit.'))}\n`, 'utf8');
    return;
  }
  process.stdout.write(line, 'utf8');
}

function parseLine(text) {
  if (!text.endsWith('\n')) return { ok: false, request: null, response: failure(null, 'INPUT_LINE_REQUIRED', 'Exactly one newline-terminated JSON line is required.') };
  const body = text.slice(0, -1);
  if (!body || body.includes('\n') || body.includes('\r')) {
    return { ok: false, request: null, response: failure(null, 'INPUT_LINE_REQUIRED', 'Exactly one JSON line is required.') };
  }
  try {
    const request = JSON.parse(body);
    return { ok: true, request };
  } catch {
    return { ok: false, request: null, response: failure(null, 'JSON_PARSE_FAILED', 'Input JSON could not be parsed.') };
  }
}

function validatePayload(request, actionSpec) {
  if (!isPlainObject(request.payload)) return failure(request, 'PAYLOAD_INVALID', 'Payload must be a plain object.');
  if (Object.prototype.hasOwnProperty.call(request.payload, 'action')) return failure(request, 'PAYLOAD_ACTION_COLLISION', 'Payload cannot contain an action field.');
  if (!actionSpec.payloadField) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(safeString(request.payload.referenceDate))) return failure(request, 'REFERENCE_DATE_INVALID', 'referenceDate must use YYYY-MM-DD.');
    if (!isPlainObject(request.payload.commandCenterSnapshot)) return failure(request, 'SNAPSHOT_INVALID', 'commandCenterSnapshot must be a plain object.');
    if (!isPlainObject(request.payload.deliveryReadinessSnapshot)) return failure(request, 'SNAPSHOT_INVALID', 'deliveryReadinessSnapshot must be a plain object.');
    return null;
  }
  if (!isPlainObject(request.payload[actionSpec.payloadField])) {
    return failure(request, 'SNAPSHOT_INVALID', `${actionSpec.payloadField} must be a plain object.`);
  }
  return null;
}

function validateRequest(request) {
  if (!isPlainObject(request)) return failure(request, 'REQUEST_SHAPE_INVALID', 'Request must be a plain object.');
  const shape = inspectJsonShape(request);
  if (!shape.ok) return failure(request, shape.code, 'Request shape is not allowed.');
  if (request.protocolVersion !== PROTOCOL_VERSION) return failure(request, 'PROTOCOL_VERSION_UNSUPPORTED', 'Unsupported protocol version.');
  if (typeof request.action !== 'string') return failure(request, 'ACTION_DENIED', 'Action is not authorized for this entrypoint.');
  if (request.action === '*' || String(request.action).includes('*')) return failure(request, 'ACTION_DENIED', 'Wildcard action is not authorized.');
  if (!Object.prototype.hasOwnProperty.call(ACTION_TABLE, request.action)) return failure(request, 'ACTION_DENIED', 'Action is not authorized for this entrypoint.');
  const actionSpec = ACTION_TABLE[request.action];
  if (request.creationId !== actionSpec.creationId) return failure(request, 'CREATION_ID_DENIED', 'Creation id is not authorized for this action.');
  const payloadError = validatePayload(request, actionSpec);
  if (payloadError) return payloadError;
  return null;
}

function handleRequest(request) {
  const error = validateRequest(request);
  if (error) return error;
  const actionSpec = ACTION_TABLE[request.action];
  return success(request, actionSpec.build(request.payload));
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
    const input = Buffer.concat(chunks);
    const text = input.toString('utf8');
    // Reject lossy UTF-8 decoding before parsing or comparing caller identifiers.
    if (!Buffer.from(text, 'utf8').equals(input)) {
      emit(failure(null, 'JSON_PARSE_FAILED', 'Input JSON could not be parsed.'));
      return;
    }
    const parsed = parseLine(text);
    if (!parsed.ok) {
      emit(parsed.response);
      return;
    }
    emit(handleRequest(parsed.request));
  });

  process.stdin.resume();
}

if (require.main === module) {
  main();
}

module.exports = {
  PROTOCOL_NAME,
  CREATION_IDS,
  ACTIONS,
  ACTION_TABLE,
  handleRequest,
  parseLine
};
