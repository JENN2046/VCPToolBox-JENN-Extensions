#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ShootingOperationsSyncAdapter
} = require('../../ShootingOperationsPackages/VcpSyncAdapter/index.cjs');

const BINDING_RELATIVE_PATH = path.join(
  'state',
  'live',
  'integrations',
  'jenn-shooting-operations',
  'binding.json'
);

function isPlainObject(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value);
}

function readJsonStdin() {
  return new Promise((resolve, reject) => {
    let input = '';
    let settled = false;

    const fail = error => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      if (settled) return;
      input += chunk;
      if (input.length > 1024 * 1024) {
        fail(new Error('REQUEST_TOO_LARGE'));
      }
    });
    process.stdin.on('error', fail);
    process.stdin.on('end', () => {
      if (settled) return;
      settled = true;
      if (!input.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(input);
        if (!isPlainObject(parsed)) throw new Error();
        resolve(parsed);
      } catch {
        reject(new Error('INVALID_JSON_REQUEST'));
      }
    });
  });
}

function findCanonicalRoot(projectBasePath) {
  if (typeof projectBasePath !== 'string' || !path.isAbsolute(projectBasePath)) {
    throw new Error('CANONICAL_ROOT_UNAVAILABLE');
  }

  let current = path.resolve(projectBasePath);
  for (let depth = 0; depth < 5; depth += 1) {
    if (fs.existsSync(path.join(current, 'CURRENT_RUNTIME.json'))
        && fs.existsSync(path.join(current, 'state', 'STATE_BINDINGS_R1.json'))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  throw new Error('CANONICAL_ROOT_UNAVAILABLE');
}

function resolveBindingPath() {
  if (process.env.JENN_SHOOTING_OPERATIONS_BINDING_PATH) {
    return path.resolve(process.env.JENN_SHOOTING_OPERATIONS_BINDING_PATH);
  }
  const root = findCanonicalRoot(process.env.PROJECT_BASE_PATH);
  return path.join(root, BINDING_RELATIVE_PATH);
}

function validateBinding(binding) {
  if (!isPlainObject(binding)
      || binding.schemaVersion !== 1
      || typeof binding.enabled !== 'boolean'
      || typeof binding.readCapabilityEnabled !== 'boolean'
      || typeof binding.acceptanceWriteEnabled !== 'boolean'
      || binding.productionActionRequired !== 'PROD-10-ENABLE-VCP-REMOTE-SYNC'
      || binding.rollbackActionId !== 'ROLLBACK-09-DISABLE-VCP-CONFIG'
      || typeof binding.endpoint !== 'string'
      || binding.endpoint.length === 0) {
    throw new Error('SHOOTING_OPERATIONS_BINDING_INVALID');
  }
  return binding;
}

function readBinding() {
  let body;
  try {
    body = fs.readFileSync(resolveBindingPath(), 'utf8');
  } catch {
    throw new Error('SHOOTING_OPERATIONS_BINDING_UNAVAILABLE');
  }

  try {
    return validateBinding(JSON.parse(body));
  } catch (error) {
    if (error?.message === 'SHOOTING_OPERATIONS_BINDING_INVALID') throw error;
    throw new Error('SHOOTING_OPERATIONS_BINDING_INVALID');
  }
}

function normalizeSemanticText(request) {
  const primary = Array.isArray(request.jev_primary)
    ? request.jev_primary.filter(value => typeof value === 'string').join(' ')
    : '';
  const constraints = Array.isArray(request.jev_constraints)
    ? request.jev_constraints.filter(value => typeof value === 'string').join(' ')
    : '';

  return [request.jev_expression, primary, constraints]
    .filter(value => typeof value === 'string' && value.trim())
    .join(' ')
    .slice(0, 12000);
}

function classifyIntent(request) {
  const text = normalizeSemanticText(request);
  if (!text) return 'read';

  const writeLike = [
    /(?:安排|排到|排在|改到|移动|移到|挪到|调整|修改|更新|新增|创建|删除|取消|标记|提交|保存|改成)/u,
    /(?:assign|schedule|move|update|create|delete|cancel|modify|save|submit)/iu
  ];

  return writeLike.some(pattern => pattern.test(text))
    ? 'propose_write'
    : 'read';
}

function publicSnapshot(snapshot) {
  return {
    schemaVersion: snapshot.schemaVersion,
    revision: snapshot.revision,
    updatedAt: snapshot.updatedAt,
    products: snapshot.products,
    tasks: snapshot.tasks,
    sessions: snapshot.sessions
  };
}

function healthCheck(binding) {
  return {
    enabled: binding.enabled === true,
    readCapabilityEnabled: binding.readCapabilityEnabled === true,
    acceptanceWriteEnabled: binding.acceptanceWriteEnabled === true,
    productionActionRequired: binding.productionActionRequired,
    rollbackActionId: binding.rollbackActionId,
    credentialExposedToAgent: false,
    agentWriteCapability: false
  };
}

async function semanticIntent(request, binding) {
  if (binding.enabled !== true || binding.readCapabilityEnabled !== true) {
    throw new Error('SHOOTING_OPERATIONS_READ_CAPABILITY_DISABLED');
  }

  const adapter = new ShootingOperationsSyncAdapter({
    baseUrl: binding.endpoint
  });
  const snapshot = await adapter.pull();
  const intentClass = classifyIntent(request);

  if (intentClass === 'propose_write') {
    return {
      intentClass,
      writePerformed: false,
      currentRevision: snapshot.revision,
      currentSnapshot: publicSnapshot(snapshot),
      proposal: {
        requestedIntent: normalizeSemanticText(request),
        requiredCapability: 'AUTHORIZED_GUARDED_WRITE',
        requiredProductionAction: 'PROD-10-ENABLE-VCP-REMOTE-SYNC'
      }
    };
  }

  return {
    intentClass,
    writePerformed: false,
    currentSnapshot: publicSnapshot(snapshot)
  };
}

async function handleRequest(request) {
  const binding = readBinding();
  const action = String(request.action || '').trim() || 'SemanticIntent';

  if (action === 'HealthCheck') {
    return {
      status: 'success',
      result: healthCheck(binding)
    };
  }

  if (action !== 'SemanticIntent') {
    return {
      status: 'error',
      error: 'UNSUPPORTED_AGENT_ACTION'
    };
  }

  return {
    status: 'success',
    result: await semanticIntent(request, binding)
  };
}

async function main() {
  try {
    const request = await readJsonStdin();
    const response = await handleRequest(request);
    process.stdout.write(JSON.stringify(response) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({
      status: 'error',
      error: String(error?.message || 'SHOOTING_OPERATIONS_ERROR').slice(0, 160)
    }) + '\n');
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  BINDING_RELATIVE_PATH,
  classifyIntent,
  findCanonicalRoot,
  handleRequest,
  healthCheck,
  normalizeSemanticText,
  publicSnapshot,
  readBinding,
  resolveBindingPath,
  semanticIntent,
  validateBinding
};
