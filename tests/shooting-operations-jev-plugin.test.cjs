#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { once } = require('node:events');

const plugin = require('../Plugin/JennShootingOperations/JennShootingOperations.js');
const manager = require('../scripts/manage-jso-jev-category.cjs');
const acceptance = require('../scripts/prod10-jso-acceptance.cjs');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jso-jev-plugin-'));
}

async function withServer(handler, action) {
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    return await action(`http://127.0.0.1:${address.port}`);
  } finally {
    server.close();
    await once(server, 'close');
  }
}

function writeBinding(root, binding) {
  const dir = path.join(
    root,
    'state',
    'live',
    'integrations',
    'jenn-shooting-operations'
  );
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'binding.json');
  fs.writeFileSync(file, JSON.stringify(binding));
  return file;
}

function baseBinding(endpoint) {
  return {
    schemaVersion: 1,
    enabled: true,
    readCapabilityEnabled: true,
    acceptanceWriteEnabled: false,
    endpoint,
    productionActionRequired: 'PROD-10-ENABLE-VCP-REMOTE-SYNC',
    rollbackActionId: 'ROLLBACK-09-DISABLE-VCP-CONFIG',
    schedulerCredentialSource: {
      type: 'env_file',
      path: '/not/used',
      key: 'SCHEDULER_TOKEN'
    }
  };
}

function withBindingPath(bindingPath, action) {
  const previous = process.env.JENN_SHOOTING_OPERATIONS_BINDING_PATH;
  process.env.JENN_SHOOTING_OPERATIONS_BINDING_PATH = bindingPath;
  return Promise.resolve()
    .then(action)
    .finally(() => {
      if (previous === undefined) {
        delete process.env.JENN_SHOOTING_OPERATIONS_BINDING_PATH;
      } else {
        process.env.JENN_SHOOTING_OPERATIONS_BINDING_PATH = previous;
      }
    });
}

function withAcceptanceBindingPath(bindingPath, action) {
  const key = acceptance.BINDING_PATH_ENV;
  const previous = process.env[key];
  process.env[key] = bindingPath;
  return Promise.resolve()
    .then(action)
    .finally(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
}

test('plugin manifest exposes only semantic intent and health to the Agent', () => {
  const manifest = JSON.parse(fs.readFileSync(
    path.resolve(__dirname, '..', 'Plugin', 'JennShootingOperations', 'plugin-manifest.json'),
    'utf8'
  ));
  assert.deepEqual(
    manifest.capabilities.invocationCommands.map(item => item.commandIdentifier),
    ['SemanticIntent', 'HealthCheck']
  );
  assert.equal(manifest.externalRuntimeCompatibility.runtimeEnabled, false);
  assert.equal(manifest.externalRuntimeCompatibility.executionAuthorized, false);
  assert.equal(manifest.externalRuntimeCompatibility.credentialValueIncluded, false);
});

test('JEV category manager applies idempotently and removes only its owned category and prompt block', () => {
  const dir = tempDir();
  const configPath = path.join(dir, 'jev.json');
  const promptPath = path.join(dir, 'prompt.txt');
  const categoryFragment = path.resolve(
    __dirname,
    '..',
    'JevCapabilities',
    'shooting-operations.category.json'
  );
  const promptFragment = path.resolve(
    __dirname,
    '..',
    'JevCapabilities',
    'JevToolCall.shooting-operations.fragment.md'
  );

  fs.writeFileSync(configPath, JSON.stringify({
    version: 1,
    virtualToolName: 'JEV',
    maxExpandedCalls: 5,
    categories: {
      daily_tools: {
        aliases: ['日用工具'],
        defaultTool: 'x',
        tools: { x: { plugin: 'X' } }
      }
    }
  }));
  fs.writeFileSync(promptPath, 'base prompt\n');

  manager.applyCategory(configPath, categoryFragment);
  manager.applyPrompt(promptPath, promptFragment);
  manager.applyCategory(configPath, categoryFragment);
  manager.applyPrompt(promptPath, promptFragment);

  const applied = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(applied.categories.daily_tools.tools.x.plugin, 'X');
  assert.equal(
    applied.categories.shooting_operations.tools.jenn_shooting_operations.plugin,
    'JennShootingOperations'
  );
  const prompt = fs.readFileSync(promptPath, 'utf8');
  assert.equal(
    prompt.split(manager.MARKER_START).length - 1,
    1
  );

  manager.removeCategory(configPath, categoryFragment);
  manager.removePrompt(promptPath);
  const removed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(removed.categories.shooting_operations, undefined);
  assert.equal(removed.categories.daily_tools.tools.x.plugin, 'X');
  assert.doesNotMatch(
    fs.readFileSync(promptPath, 'utf8'),
    /JSO_JEV_CAPABILITY_R1_BEGIN/u
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test('category manager fails closed on a conflicting pre-existing shooting category', () => {
  const dir = tempDir();
  const configPath = path.join(dir, 'jev.json');
  const fragment = path.resolve(
    __dirname,
    '..',
    'JevCapabilities',
    'shooting-operations.category.json'
  );

  fs.writeFileSync(configPath, JSON.stringify({
    categories: {
      shooting_operations: {
        aliases: ['冲突'],
        defaultTool: 'evil',
        tools: {
          evil: {
            plugin: 'OtherPlugin'
          }
        }
      }
    }
  }));

  assert.throws(
    () => manager.applyCategory(configPath, fragment),
    /JEV_CATEGORY_CONFLICT/u
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Agent semantic read pulls current state without attaching any scheduler credential', async () => {
  await withServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/api/v1/snapshot');
    assert.equal(request.headers.authorization, undefined);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      ok: true,
      snapshot: {
        schemaVersion: 1,
        revision: 4,
        updatedAt: '2026-09-28T00:00:00.000Z',
        products: [],
        tasks: [{ id: 'TASK-1', name: '音箱拍摄' }],
        sessions: []
      }
    }));
  }, async endpoint => {
    const root = tempDir();
    const bindingPath = writeBinding(root, baseBinding(endpoint));
    try {
      await withBindingPath(bindingPath, async () => {
        const result = await plugin.handleRequest({
          action: 'SemanticIntent',
          jev_expression: '请使用 {拍摄运营}，查看【今天有什么要拍的】。',
          jev_primary: ['今天有什么要拍的']
        });
        assert.equal(result.status, 'success');
        assert.equal(result.result.intentClass, 'read');
        assert.equal(result.result.writePerformed, false);
        assert.equal(result.result.currentSnapshot.revision, 4);
        assert.equal(result.result.currentSnapshot.tasks[0].id, 'TASK-1');
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});

test('Agent-supplied endpoint or credential fields are ignored in favor of runtime binding', async () => {
  let calls = 0;
  await withServer((request, response) => {
    calls += 1;
    assert.equal(request.headers.authorization, undefined);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      ok: true,
      snapshot: {
        schemaVersion: 1,
        revision: 2,
        updatedAt: '2026-09-28T00:00:00.000Z',
        products: [],
        tasks: [],
        sessions: []
      }
    }));
  }, async endpoint => {
    const root = tempDir();
    const bindingPath = writeBinding(root, baseBinding(endpoint));
    try {
      await withBindingPath(bindingPath, () => plugin.handleRequest({
        action: 'SemanticIntent',
        endpoint: 'https://evil.example',
        schedulerCredential: 'should-never-be-used',
        jev_expression: '请使用 {拍摄运营}，查看【项目状态】。'
      }));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  assert.equal(calls, 1);
});

test('write-like JEV intent becomes a proposal and performs no write', async () => {
  const methods = [];
  await withServer((request, response) => {
    methods.push(request.method);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      ok: true,
      snapshot: {
        schemaVersion: 1,
        revision: 7,
        updatedAt: '2026-09-28T00:00:00.000Z',
        products: [],
        tasks: [],
        sessions: []
      }
    }));
  }, async endpoint => {
    const root = tempDir();
    const bindingPath = writeBinding(root, baseBinding(endpoint));
    try {
      await withBindingPath(bindingPath, async () => {
        const result = await plugin.handleRequest({
          action: 'SemanticIntent',
          jev_expression: '请使用 {拍摄运营}，提出【把音箱项目排到周三下午】的变更提议。',
          jev_primary: ['把音箱项目排到周三下午']
        });
        assert.equal(result.result.intentClass, 'propose_write');
        assert.equal(result.result.writePerformed, false);
        assert.equal(result.result.currentRevision, 7);
        assert.equal(
          result.result.proposal.requiredCapability,
          'AUTHORIZED_GUARDED_WRITE'
        );
      });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  assert.deepEqual(methods, ['GET']);
});

test('unsupported Agent action cannot reach guarded write', async () => {
  const root = tempDir();
  const bindingPath = writeBinding(root, baseBinding('http://127.0.0.1:1'));
  try {
    await withBindingPath(bindingPath, async () => {
      const result = await plugin.handleRequest({
        action: 'ApplyGuardedSnapshot',
        snapshot: {}
      });
      assert.deepEqual(result, {
        status: 'error',
        error: 'UNSUPPORTED_AGENT_ACTION'
      });
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('PROD-10 acceptance harness requires exact action, safe token file and acceptance write gate', async () => {
  const credential = 'synthetic-scheduler-credential-0001';
  let snapshot = {
    schemaVersion: 1,
    revision: 0,
    updatedAt: '2026-09-28T00:00:00.000Z',
    products: [],
    tasks: [],
    sessions: []
  };

  await withServer(async (request, response) => {
    if (request.method === 'PUT') {
      assert.equal(request.headers.authorization, `Bearer ${credential}`);
      assert.equal(request.headers['if-match'], '0');
      assert.equal(
        request.headers['idempotency-key'],
        'prod10-acceptance-test-0001'
      );

      let body = '';
      for await (const chunk of request) body += chunk;
      const incoming = JSON.parse(body);
      snapshot = {
        ...incoming,
        revision: 1,
        updatedAt: '2026-09-28T00:01:00.000Z'
      };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        revision: 1,
        updatedAt: snapshot.updatedAt
      }));
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, snapshot }));
  }, async endpoint => {
    const dir = tempDir();
    const tokenPath = path.join(dir, '.env.tokens');
    fs.writeFileSync(
      tokenPath,
      `SCHEDULER_TOKEN=${credential}\n`,
      { mode: 0o600 }
    );

    const bindingPath = path.join(dir, 'binding.json');
    fs.writeFileSync(bindingPath, JSON.stringify({
      ...baseBinding(endpoint),
      acceptanceWriteEnabled: true,
      schedulerCredentialSource: {
        type: 'env_file',
        path: tokenPath,
        key: 'SCHEDULER_TOKEN'
      }
    }));

    const result = await withAcceptanceBindingPath(
      bindingPath,
      () => acceptance.runAcceptance({
        actionId: 'PROD-10-ENABLE-VCP-REMOTE-SYNC',
        expectedRevision: 0,
        operationId: 'prod10-acceptance-test-0001',
        snapshot: {
          ...snapshot,
          tasks: [{ id: 'TASK-ACCEPT', name: 'Acceptance' }]
        }
      })
    );

    assert.deepEqual(result, {
      ok: true,
      actionId: 'PROD-10-ENABLE-VCP-REMOTE-SYNC',
      revision: 1,
      verifiedRevision: 1,
      credentialExposed: false
    });

    const unsafe = path.join(dir, '.unsafe.tokens');
    fs.writeFileSync(
      unsafe,
      `SCHEDULER_TOKEN=${credential}\n`,
      { mode: 0o644 }
    );
    assert.throws(
      () => acceptance.parseEnvFileKey(unsafe, 'SCHEDULER_TOKEN'),
      /CREDENTIAL_FILE_PERMISSIONS_UNSAFE/u
    );

    const disabledBinding = path.join(dir, 'disabled-binding.json');
    fs.writeFileSync(disabledBinding, JSON.stringify({
      ...baseBinding(endpoint),
      schedulerCredentialSource: {
        type: 'env_file',
        path: tokenPath,
        key: 'SCHEDULER_TOKEN'
      }
    }));
    await withAcceptanceBindingPath(disabledBinding, () => assert.rejects(
      acceptance.runAcceptance({
        actionId: 'PROD-10-ENABLE-VCP-REMOTE-SYNC',
        expectedRevision: 1,
        operationId: 'prod10-acceptance-test-0002',
        snapshot
      }),
      /PROD10_BINDING_NOT_AUTHORIZED/u
    ));

    await withAcceptanceBindingPath(bindingPath, () => assert.rejects(
      acceptance.runAcceptance({
        actionId: 'PROD-10-ENABLE-VCP-REMOTE-SYNC',
        bindingPath: disabledBinding,
        expectedRevision: 1,
        operationId: 'prod10-acceptance-test-0003',
        snapshot
      }),
      /PROD10_ACCEPTANCE_REQUEST_INVALID/u
    ));

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

test('health report is low-disclosure and Agent write capability remains false', () => {
  const result = plugin.healthCheck({
    enabled: true,
    readCapabilityEnabled: true,
    acceptanceWriteEnabled: true,
    productionActionRequired: 'PROD-10-ENABLE-VCP-REMOTE-SYNC',
    rollbackActionId: 'ROLLBACK-09-DISABLE-VCP-CONFIG',
    schedulerCredentialSource: {
      path: '/secret/location',
      key: 'SCHEDULER_TOKEN'
    }
  });

  assert.equal(result.enabled, true);
  assert.equal(result.agentWriteCapability, false);
  assert.equal(result.credentialExposedToAgent, false);
  assert.equal(JSON.stringify(result).includes('/secret/location'), false);
  assert.equal(JSON.stringify(result).includes('SCHEDULER_TOKEN'), false);
});

test('runtime manifest binds the JEV-first plugin and category source bytes', () => {
  const crypto = require('node:crypto');
  const manifestPath = path.resolve(__dirname, '..', 'manifests', 'MANIFEST.sha256');
  const rows = fs.readFileSync(manifestPath, 'utf8')
    .trim()
    .split('\n')
    .map(line => {
      const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
      assert.ok(match, 'invalid checksum row');
      return [match[2], match[1]];
    });
  const entries = new Map(rows);
  const sourcePaths = [
    'JevCapabilities/JevToolCall.shooting-operations.fragment.md',
    'JevCapabilities/shooting-operations.category.json',
    'Plugin/JennShootingOperations/JennShootingOperations.js',
    'Plugin/JennShootingOperations/binding.example.json',
    'Plugin/JennShootingOperations/binding.schema.json',
    'Plugin/JennShootingOperations/plugin-manifest.json'
  ];

  for (const relativePath of sourcePaths) {
    const actual = crypto.createHash('sha256')
      .update(fs.readFileSync(path.resolve(__dirname, '..', relativePath)))
      .digest('hex');
    assert.equal(entries.get(relativePath), actual, relativePath);
  }
});
