#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const {
  ShootingOperationsSyncAdapter
} = require('../ShootingOperationsPackages/VcpSyncAdapter/index.cjs');

const ACTION_ID = 'PROD-10-ENABLE-VCP-REMOTE-SYNC';

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseEnvFileKey(filePath, key) {
  if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) {
    throw new Error('CREDENTIAL_FILE_PATH_INVALID');
  }

  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error('CREDENTIAL_FILE_PERMISSIONS_UNSAFE');
  }

  const body = fs.readFileSync(filePath, 'utf8');
  let found = null;
  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const index = line.indexOf('=');
    if (index < 1) continue;
    const candidate = line.slice(0, index).trim();
    if (candidate !== key) continue;
    if (found !== null) throw new Error('CREDENTIAL_KEY_DUPLICATE');

    let value = line.slice(index + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"'))
        || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    found = value;
  }

  if (typeof found !== 'string' || found.length < 16) {
    throw new Error('CREDENTIAL_KEY_UNAVAILABLE');
  }
  return found;
}

function loadBinding(filePath) {
  const binding = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!isPlainObject(binding)
      || binding.schemaVersion !== 1
      || binding.productionActionRequired !== ACTION_ID
      || binding.rollbackActionId !== 'ROLLBACK-09-DISABLE-VCP-CONFIG'
      || binding.enabled !== true
      || binding.acceptanceWriteEnabled !== true
      || typeof binding.endpoint !== 'string') {
    throw new Error('PROD10_BINDING_NOT_AUTHORIZED');
  }

  const source = binding.schedulerCredentialSource;
  if (!isPlainObject(source)
      || source.type !== 'env_file'
      || typeof source.path !== 'string'
      || source.key !== 'SCHEDULER_TOKEN') {
    throw new Error('CREDENTIAL_SOURCE_INVALID');
  }
  return binding;
}

async function runAcceptance(request) {
  if (!isPlainObject(request)
      || request.actionId !== ACTION_ID
      || typeof request.bindingPath !== 'string'
      || !Number.isInteger(request.expectedRevision)
      || typeof request.operationId !== 'string'
      || !isPlainObject(request.snapshot)) {
    throw new Error('PROD10_ACCEPTANCE_REQUEST_INVALID');
  }

  const binding = loadBinding(request.bindingPath);
  const schedulerCredential = parseEnvFileKey(
    binding.schedulerCredentialSource.path,
    binding.schedulerCredentialSource.key
  );

  const adapter = new ShootingOperationsSyncAdapter({
    baseUrl: binding.endpoint,
    schedulerCredential
  });
  const result = await adapter.guardedPushAndVerify(request.snapshot, {
    expectedRevision: request.expectedRevision,
    operationId: request.operationId
  });

  return {
    ok: true,
    actionId: ACTION_ID,
    revision: result.write.revision,
    verifiedRevision: result.verifiedSnapshot.revision,
    credentialExposed: false
  };
}

async function readStdin() {
  let body = '';
  for await (const chunk of process.stdin) {
    body += chunk;
    if (body.length > 2 * 1024 * 1024) {
      throw new Error('REQUEST_TOO_LARGE');
    }
  }

  const parsed = JSON.parse(body || '{}');
  if (!isPlainObject(parsed)) throw new Error('INVALID_REQUEST');
  return parsed;
}

async function main() {
  try {
    const result = await runAcceptance(await readStdin());
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({
      ok: false,
      error: String(error?.message || 'PROD10_ACCEPTANCE_FAILED').slice(0, 160)
    }) + '\n');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  ACTION_ID,
  loadBinding,
  parseEnvFileKey,
  runAcceptance
};
