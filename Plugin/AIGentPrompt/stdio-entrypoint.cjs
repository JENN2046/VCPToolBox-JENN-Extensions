'use strict';

const AIGentPrompt = require('./AIGentPrompt.js');

const MAX_INPUT_BYTES = 16 * 1024;
const MAX_USER_INPUT_CHARS = 1000;
const SUPPORTED_ACTIONS = Object.freeze([
  'HealthCheck',
  'GenerateImagePrompt',
  'SearchPromptTemplates'
]);
const MODEL_TYPES = Object.freeze(['flux', 'sdxl', 'midjourney']);
const QUALITY_LEVELS = Object.freeze(['base', 'ultra', 'photorealistic', 'artistic']);
const SECRET_KEY_RE = /(?:api[_-]?key|token|password|authorization|cookie|session|client[_-]?secret|private[_-]?key)/i;
const SECRET_VALUE_RE = /(?:sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})/;
const PRIVATE_PATH_RE = /(?:^|[\\/\s])(?:LocalState|\.agent_board|dailynote|MEMORY\.md|AGENTS\.override\.md)(?:[\\/\s]|$)|[A-Za-z]:[\\/]|\\\\/i;
const INJECTION_KEYS = new Set([
  'node_options',
  'node_path',
  'ld_preload',
  'dyld_insert_libraries',
  'knowledgebasemanager',
  'ragdiaryplugin',
  'manager',
  'provider',
  'bridge',
  'callback',
  'execute',
  'execute_pipeline',
  'confirm_external_effects'
]);

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasTruthyRagEnv(env = process.env) {
  const value = env.AIGENT_RAG_ENABLED;
  if (value === undefined || value === null) return false;
  const normalized = String(value).trim().toLowerCase();
  return !['', '0', 'false', 'no', 'off'].includes(normalized);
}

function errorResponse(code, message) {
  return { status: 'error', error: { code, message } };
}

function successResponse(result) {
  return { status: 'success', result };
}

function validateJsonValue(value, location = 'request') {
  if (typeof value === 'string') {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) {
      return `${location} contains binary/control data`;
    }
    if (SECRET_VALUE_RE.test(value)) return `${location} contains a secret-shaped value`;
    if (PRIVATE_PATH_RE.test(value)) return `${location} contains a private or absolute path`;
    return '';
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return '';
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const failure = validateJsonValue(value[index], `${location}[${index}]`);
      if (failure) return failure;
    }
    return '';
  }
  if (!isPlainObject(value)) return `${location} must be a plain JSON value`;
  for (const key of Object.keys(value)) {
    const normalized = key.toLowerCase();
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
      return `${location} contains a prototype-pollution key`;
    }
    if (SECRET_KEY_RE.test(key) || INJECTION_KEYS.has(normalized)) {
      return `${location} contains a blocked field`;
    }
    const failure = validateJsonValue(value[key], `${location}.${key}`);
    if (failure) return failure;
  }
  return '';
}

function parseRequestText(text) {
  if (Buffer.byteLength(text || '', 'utf8') > MAX_INPUT_BYTES) {
    return { ok: false, response: errorResponse('INPUT_TOO_LARGE', 'Request exceeds the compatibility input limit.') };
  }
  if (!text || !text.trim()) {
    return { ok: false, response: errorResponse('EMPTY_INPUT', 'Request body is empty.') };
  }
  let request;
  try {
    request = JSON.parse(text);
  } catch {
    return { ok: false, response: errorResponse('MALFORMED_JSON', 'Request body must be valid JSON.') };
  }
  if (!isPlainObject(request)) {
    return { ok: false, response: errorResponse('REQUEST_SHAPE_INVALID', 'Request must be a plain JSON object.') };
  }
  const failure = validateJsonValue(request);
  if (failure) {
    return { ok: false, response: errorResponse('REQUEST_REJECTED', failure) };
  }
  return { ok: true, request };
}

function resolveAction(request) {
  const action = typeof request.action === 'string' ? request.action.trim() : '';
  const toolName = typeof request.tool_name === 'string' ? request.tool_name.trim() : '';
  if (action && toolName && action !== toolName) {
    return { ok: false, response: errorResponse('ACTION_MISMATCH', 'action and tool_name must match when both are provided.') };
  }
  const resolved = action || toolName;
  if (!resolved || resolved.includes('*') || !SUPPORTED_ACTIONS.includes(resolved)) {
    return { ok: false, response: errorResponse('UNKNOWN_ACTION', 'Requested action is not authorized for no-RAG compatibility.') };
  }
  return { ok: true, action: resolved };
}

async function suppressLegacyConsole(callback) {
  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error
  };
  const sink = () => {};
  console.log = sink;
  console.warn = sink;
  console.error = sink;
  try {
    return await callback();
  } finally {
    console.log = original.log;
    console.warn = original.warn;
    console.error = original.error;
  }
}

function healthCheck() {
  return successResponse({
    package_name: 'AIGentPrompt',
    compatibility_mode: 'no-rag',
    rag_enabled: false,
    external_effects_enabled: false,
    supported_actions: SUPPORTED_ACTIONS.slice(),
    deferred_actions: [{
      action: 'SearchPromptTemplates',
      status: 'PRESERVED_PENDING_EXPLICIT_RAG_GATE'
    }],
    source_business_module_preserved: true
  });
}

function validateGenerateRequest(request) {
  const allowed = new Set(['action', 'tool_name', 'user_input', 'model_type', 'quality']);
  for (const key of Object.keys(request)) {
    if (!allowed.has(key)) return `Field ${key} is not allowed in no-RAG GenerateImagePrompt.`;
  }
  if (typeof request.user_input !== 'string' || !request.user_input.trim()) {
    return 'user_input is required.';
  }
  if (request.user_input.length > MAX_USER_INPUT_CHARS) {
    return 'user_input exceeds the compatibility length limit.';
  }
  if (request.model_type !== undefined && !MODEL_TYPES.includes(request.model_type)) {
    return 'model_type is outside the no-RAG allowlist.';
  }
  if (request.quality !== undefined && !QUALITY_LEVELS.includes(request.quality)) {
    return 'quality is outside the no-RAG allowlist.';
  }
  return '';
}

async function generateImagePrompt(request) {
  const validationFailure = validateGenerateRequest(request);
  if (validationFailure) return errorResponse('REQUEST_REJECTED', validationFailure);

  const modelType = request.model_type || 'flux';
  const quality = request.quality || 'ultra';
  const agent = new AIGentPrompt({});
  const legacyResult = await suppressLegacyConsole(() => agent.generatePrompt(request.user_input.trim(), { modelType }));

  if (!legacyResult || legacyResult.success !== true) {
    return errorResponse('LEGACY_GENERATION_FAILED', 'Legacy no-RAG prompt generation failed.');
  }

  const result = {
    legacy_business_result: {
      ...legacyResult,
      similar_prompts: []
    },
    prompt: legacyResult.prompt,
    negative_prompt: legacyResult.negative_prompt,
    intent: legacyResult.intent,
    model_type: legacyResult.model_type || modelType,
    requested_quality: quality,
    quality_parameter_parity: 'KNOWN_GAP',
    compatibility_mode: 'no-rag',
    rag_enabled: false,
    similar_prompts: [],
    external_effects: false
  };

  return successResponse(result);
}

function searchPromptTemplates() {
  return errorResponse('RAG_DISABLED', 'Template search requires an explicitly authorized RAG bridge.');
}

async function handleRequest(request, env = process.env) {
  if (hasTruthyRagEnv(env)) {
    return errorResponse('RAG_GATE_REQUIRED', 'Full RAG requires a separate explicit gate.');
  }
  if (!isPlainObject(request)) {
    return errorResponse('REQUEST_SHAPE_INVALID', 'Request must be a plain JSON object.');
  }
  const valueFailure = validateJsonValue(request);
  if (valueFailure) return errorResponse('REQUEST_REJECTED', valueFailure);

  const actionCheck = resolveAction(request);
  if (!actionCheck.ok) return actionCheck.response;

  if (actionCheck.action === 'HealthCheck') return healthCheck();
  if (actionCheck.action === 'GenerateImagePrompt') return generateImagePrompt(request);
  if (actionCheck.action === 'SearchPromptTemplates') return searchPromptTemplates();
  return errorResponse('UNKNOWN_ACTION', 'Requested action is not authorized for no-RAG compatibility.');
}

async function runStdinText(text, env = process.env) {
  const parsed = parseRequestText(text);
  const response = parsed.ok ? await handleRequest(parsed.request, env) : parsed.response;
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
  const text = await readStdin();
  if (text === null) {
    process.stdout.write(`${JSON.stringify(errorResponse('INPUT_TOO_LARGE', 'Request exceeds the compatibility input limit.'))}\n`);
    return;
  }
  const line = await runStdinText(text, process.env);
  process.stdout.write(line);
}

if (require.main === module) {
  main().catch(() => {
    process.stdout.write(`${JSON.stringify(errorResponse('ENTRYPOINT_FAILED', 'Compatibility entrypoint failed.'))}\n`);
  });
}

module.exports = {
  MAX_INPUT_BYTES,
  SUPPORTED_ACTIONS,
  parseRequestText,
  resolveAction,
  handleRequest,
  runStdinText,
  hasTruthyRagEnv
};
