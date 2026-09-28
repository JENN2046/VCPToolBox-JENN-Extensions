'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const { createServer } = require('node:http');
const { once } = require('node:events');
const test = require('node:test');

const packageRoot = path.resolve(__dirname, '..', 'ShootingOperationsPackages', 'VcpSyncAdapter');
const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package-manifest.json'), 'utf8'));
const {
  ShootingOperationsSyncAdapter,
  ShootingOperationsSyncError
} = require(path.join(packageRoot, 'index.cjs'));

const schedulerCredential = 'scheduler-test-credential-0001';

async function withServer(handler, action) {
  const server = createServer(handler);
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

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function initialSnapshot() {
  return {
    schemaVersion: 1,
    revision: 0,
    updatedAt: '2026-09-28T00:00:00.000Z',
    products: [],
    tasks: [],
    sessions: []
  };
}

test('package source is runtime-eligible but production side effects remain disabled', () => {
  assert.equal(manifest.defaultEnabled, false);
  assert.equal(manifest.runtimeEnabled, false);
  assert.equal(manifest.runtimeEligible, true);
  assert.equal(manifest.activationState, 'SOURCE_ONLY_RUNTIME_DISABLED');
  for (const key of [
    'networkAuthorized',
    'realBackendAuthorized',
    'realAuthAuthorized',
    'businessWritesAuthorized',
    'providerCallsAuthorized',
    'bridgeCallsAuthorized',
    'privateDataAuthorized',
    'databaseAccessAuthorized',
    'storageAccessAuthorized',
    'persistentEnablementAuthorized'
  ]) {
    assert.equal(manifest[key], false, key);
  }
  assert.equal(manifest.productionActionRequired, 'PROD-10-ENABLE-VCP-REMOTE-SYNC');
  assert.equal(manifest.rollbackActionId, 'ROLLBACK-09-DISABLE-VCP-CONFIG');
  assert.equal(manifest.secretBoundary.rawCredentialExposedToAgent, false);
  assert.equal(manifest.secretBoundary.rawCredentialPersistedByPackage, false);
  assert.equal(manifest.secretBoundary.rawCredentialLoggedByPackage, false);
});

test('read-only pull sends no scheduler credential', async () => {
  await withServer((request, response) => {
    assert.equal(request.method, 'GET');
    assert.equal(request.url, '/api/v1/snapshot');
    assert.equal(request.headers.authorization, undefined);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, snapshot: initialSnapshot() }));
  }, async (baseUrl) => {
    const adapter = new ShootingOperationsSyncAdapter({
      baseUrl,
      schedulerCredential
    });
    const snapshot = await adapter.pull();
    assert.equal(snapshot.revision, 0);
  });
});

test('pull -> guarded push -> verification pull uses revision and idempotency guards', async () => {
  let snapshot = initialSnapshot();
  const methods = [];

  await withServer(async (request, response) => {
    methods.push(request.method);
    if (request.method === 'GET' && request.url === '/api/v1/snapshot') {
      assert.equal(request.headers.authorization, undefined);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ ok: true, snapshot }));
      return;
    }

    if (request.method === 'PUT' && request.url === '/api/v1/snapshot') {
      assert.equal(request.headers.authorization, `Bearer ${schedulerCredential}`);
      assert.equal(request.headers['if-match'], '0');
      assert.equal(request.headers['idempotency-key'], 'prod10-test-write-0001');
      const incoming = await readJson(request);
      snapshot = {
        schemaVersion: 1,
        revision: 1,
        updatedAt: '2026-09-28T00:01:00.000Z',
        products: incoming.products,
        tasks: incoming.tasks,
        sessions: incoming.sessions
      };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        status: 200,
        revision: 1,
        updatedAt: snapshot.updatedAt
      }));
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: false, code: 'NOT_FOUND' }));
  }, async (baseUrl) => {
    const adapter = new ShootingOperationsSyncAdapter({ baseUrl, schedulerCredential });
    const current = await adapter.pull();
    const intended = {
      ...current,
      products: [['SKU-ADAPTER', 'Adapter Test']],
      tasks: [{
        id: 'TASK-ADAPTER',
        sku: 'SKU-ADAPTER',
        name: 'Adapter Test',
        client: '待确认',
        deliver: '主图',
        kind: '静物'
      }]
    };
    const result = await adapter.guardedPushAndVerify(intended, {
      expectedRevision: current.revision,
      operationId: 'prod10-test-write-0001'
    });
    assert.equal(result.write.revision, 1);
    assert.equal(result.verifiedSnapshot.revision, 1);
    assert.equal(result.verifiedSnapshot.tasks[0].id, 'TASK-ADAPTER');
  });

  assert.deepEqual(methods, ['GET', 'PUT', 'GET']);
});

test('revision conflict fails closed and is never retried', async () => {
  let calls = 0;
  await withServer((request, response) => {
    calls += 1;
    response.writeHead(409, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      ok: false,
      code: 'REVISION_CONFLICT',
      revision: 7,
      privateDetail: schedulerCredential
    }));
  }, async (baseUrl) => {
    const adapter = new ShootingOperationsSyncAdapter({ baseUrl, schedulerCredential });
    await assert.rejects(
      () => adapter.guardedPush(initialSnapshot(), {
        expectedRevision: 0,
        operationId: 'prod10-conflict-0001'
      }),
      (error) => {
        assert.ok(error instanceof ShootingOperationsSyncError);
        assert.equal(error.code, 'REVISION_CONFLICT');
        assert.equal(error.status, 409);
        assert.equal(error.revision, 7);
        assert.equal(error.uncertain, false);
        assert.equal(error.message.includes(schedulerCredential), false);
        assert.equal(JSON.stringify(error).includes(schedulerCredential), false);
        return true;
      }
    );
  });
  assert.equal(calls, 1);
});

test('write transport failure is surfaced as uncertain with one attempt only', async () => {
  let calls = 0;
  const adapter = new ShootingOperationsSyncAdapter({
    baseUrl: 'https://example.invalid',
    schedulerCredential,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('network unavailable');
    }
  });

  await assert.rejects(
    () => adapter.guardedPush(initialSnapshot(), {
      expectedRevision: 0,
      operationId: 'prod10-uncertain-0001'
    }),
    (error) => {
      assert.ok(error instanceof ShootingOperationsSyncError);
      assert.equal(error.code, 'WRITE_TRANSPORT_UNCERTAIN');
      assert.equal(error.uncertain, true);
      assert.equal(error.message.includes(schedulerCredential), false);
      return true;
    }
  );
  assert.equal(calls, 1);
});

test('invalid operation id and missing write capability fail before network access', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    throw new Error('should not run');
  };
  const readonly = new ShootingOperationsSyncAdapter({
    baseUrl: 'https://example.invalid',
    fetchImpl
  });
  const writable = new ShootingOperationsSyncAdapter({
    baseUrl: 'https://example.invalid',
    schedulerCredential,
    fetchImpl
  });

  await assert.rejects(
    () => readonly.guardedPush(initialSnapshot(), {
      expectedRevision: 0,
      operationId: 'prod10-write-0001'
    }),
    (error) => error.code === 'WRITE_CAPABILITY_NOT_CONFIGURED'
  );
  await assert.rejects(
    () => writable.guardedPush(initialSnapshot(), {
      expectedRevision: 0,
      operationId: 'short'
    }),
    /idempotency-key contract/u
  );
  assert.equal(calls, 0);
});


test('chunked response is stopped at the configured byte cap before full buffering', async () => {
  await withServer((request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.write('{"ok":true,"padding":"');
    response.write('x'.repeat(2048));
    response.end('"}');
  }, async (baseUrl) => {
    const adapter = new ShootingOperationsSyncAdapter({
      baseUrl,
      maxResponseBytes: 1024
    });
    await assert.rejects(
      () => adapter.pull(),
      (error) => {
        assert.ok(error instanceof ShootingOperationsSyncError);
        assert.equal(error.code, 'RESPONSE_LIMIT_EXCEEDED');
        assert.equal(error.uncertain, false);
        return true;
      }
    );
  });
});

test('write-side 5xx is uncertain and is never retried', async () => {
  let calls = 0;
  await withServer((request, response) => {
    calls += 1;
    response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      ok: false,
      code: 'UPSTREAM_FAILURE',
      privateDetail: schedulerCredential
    }));
  }, async (baseUrl) => {
    const adapter = new ShootingOperationsSyncAdapter({ baseUrl, schedulerCredential });
    await assert.rejects(
      () => adapter.guardedPush(initialSnapshot(), {
        expectedRevision: 0,
        operationId: 'prod10-server-uncertain-0001'
      }),
      (error) => {
        assert.ok(error instanceof ShootingOperationsSyncError);
        assert.equal(error.code, 'UPSTREAM_FAILURE');
        assert.equal(error.status, 502);
        assert.equal(error.uncertain, true);
        assert.equal(error.message.includes(schedulerCredential), false);
        return true;
      }
    );
  });
  assert.equal(calls, 1);
});

test('verification accepts semantically identical objects with different key order', async () => {
  let intended = null;
  let phase = 0;

  await withServer(async (request, response) => {
    phase += 1;
    if (request.method === 'PUT') {
      intended = await readJson(request);
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        status: 200,
        revision: 1,
        updatedAt: '2026-09-28T00:01:00.000Z'
      }));
      return;
    }

    const task = intended.tasks[0];
    const reorderedTask = {
      kind: task.kind,
      deliver: task.deliver,
      client: task.client,
      name: task.name,
      sku: task.sku,
      id: task.id
    };
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      ok: true,
      snapshot: {
        schemaVersion: 1,
        revision: 1,
        updatedAt: '2026-09-28T00:01:00.000Z',
        products: intended.products,
        tasks: [reorderedTask],
        sessions: intended.sessions
      }
    }));
  }, async (baseUrl) => {
    const adapter = new ShootingOperationsSyncAdapter({ baseUrl, schedulerCredential });
    const snapshot = {
      ...initialSnapshot(),
      tasks: [{
        id: 'TASK-ORDER',
        sku: 'SKU-ORDER',
        name: 'Order',
        client: '待确认',
        deliver: '主图',
        kind: '静物'
      }]
    };
    const result = await adapter.guardedPushAndVerify(snapshot, {
      expectedRevision: 0,
      operationId: 'prod10-key-order-0001'
    });
    assert.equal(result.write.revision, 1);
    assert.equal(result.verifiedSnapshot.tasks[0].id, 'TASK-ORDER');
  });

  assert.equal(phase, 2);
});


test('checksum manifest binds the exact runtime adapter source and package metadata', () => {
  const checksumPath = path.resolve(__dirname, '..', 'manifests', 'MANIFEST.sha256');
  const entries = new Map(
    fs.readFileSync(checksumPath, 'utf8')
      .trim()
      .split('\n')
      .map((line) => {
        const match = /^([a-f0-9]{64})  (.+)$/u.exec(line);
        assert.ok(match, `invalid checksum-manifest line: ${line}`);
        return [match[2], match[1]];
      })
  );
  for (const relativePath of [
    'ShootingOperationsPackages/VcpSyncAdapter/index.cjs',
    'ShootingOperationsPackages/VcpSyncAdapter/package-manifest.json'
  ]) {
    const actual = crypto.createHash('sha256')
      .update(fs.readFileSync(path.resolve(__dirname, '..', relativePath)))
      .digest('hex');
    assert.equal(entries.get(relativePath), actual, relativePath);
  }
});


test('guarded write rejects a stale snapshot revision before network access', async () => {
  let calls = 0;
  const adapter = new ShootingOperationsSyncAdapter({
    baseUrl: 'https://example.invalid',
    schedulerCredential,
    fetchImpl: async () => {
      calls += 1;
      throw new Error('should not run');
    }
  });
  const stale = { ...initialSnapshot(), revision: 0 };
  await assert.rejects(
    () => adapter.guardedPush(stale, {
      expectedRevision: 1,
      operationId: 'prod10-stale-snapshot-0001'
    }),
    /snapshot\.revision must exactly match expectedRevision/u
  );
  assert.equal(calls, 0);
});

test('scheduler credential requires HTTPS except explicit loopback HTTP', () => {
  assert.throws(
    () => new ShootingOperationsSyncAdapter({
      baseUrl: 'http://example.com',
      schedulerCredential
    }),
    /requires HTTPS except for explicit loopback HTTP/u
  );

  assert.doesNotThrow(() => new ShootingOperationsSyncAdapter({
    baseUrl: 'http://127.0.0.1:3800',
    schedulerCredential
  }));
  assert.doesNotThrow(() => new ShootingOperationsSyncAdapter({
    baseUrl: 'http://localhost:3800',
    schedulerCredential
  }));
  assert.doesNotThrow(() => new ShootingOperationsSyncAdapter({
    baseUrl: 'https://jso.example.test',
    schedulerCredential
  }));
});

test('scheduler credential is private and absent from serialized adapter state', () => {
  const adapter = new ShootingOperationsSyncAdapter({
    baseUrl: 'https://example.invalid',
    schedulerCredential,
    fetchImpl: async () => {
      throw new Error('not called');
    }
  });
  assert.equal(adapter.schedulerCredential, undefined);
  assert.equal(Object.keys(adapter).includes('schedulerCredential'), false);
  assert.equal(JSON.stringify(adapter).includes(schedulerCredential), false);
});


test('validated base URL and credential-bearing transport cannot be replaced after construction', async () => {
  let calls = 0;
  const originalFetch = async (url, options) => {
    calls += 1;
    assert.equal(String(url), 'https://safe.example/api/v1/snapshot');
    assert.equal(options.headers.Authorization, undefined);
    return new Response(JSON.stringify({ ok: true, snapshot: initialSnapshot() }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };
  const adapter = new ShootingOperationsSyncAdapter({
    baseUrl: 'https://safe.example',
    schedulerCredential,
    fetchImpl: originalFetch
  });

  assert.equal(Object.isFrozen(adapter), true);
  assert.throws(() => {
    adapter.baseUrl = 'http://non-loopback.example';
  }, TypeError);
  assert.throws(() => {
    adapter.fetchImpl = async () => {
      throw new Error('credential interceptor must never be installed');
    };
  }, TypeError);

  const snapshot = await adapter.pull();
  assert.equal(snapshot.revision, 0);
  assert.equal(calls, 1);
});

test('root toJSON cannot detach the transmitted snapshot from expectedRevision', async () => {
  let received;
  await withServer(async (request, response) => {
    received = await readJson(request);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      ok: true,
      status: 200,
      revision: 1,
      updatedAt: '2026-09-28T00:01:00.000Z'
    }));
  }, async (baseUrl) => {
    const adapter = new ShootingOperationsSyncAdapter({ baseUrl, schedulerCredential });
    const snapshot = {
      ...initialSnapshot(),
      products: [['SKU-SAFE', 'Safe']],
      toJSON() {
        return {
          ...initialSnapshot(),
          revision: 999,
          products: [['SKU-EVIL', 'Detached']],
          tasks: [],
          sessions: []
        };
      }
    };
    const result = await adapter.guardedPush(snapshot, {
      expectedRevision: 0,
      operationId: 'prod10-root-tojson-0001'
    });
    assert.equal(result.revision, 1);
  });

  assert.equal(received.revision, 0);
  assert.deepEqual(received.products, [['SKU-SAFE', 'Safe']]);
});

test('verification compares against the exact JSON value transmitted on the wire', async () => {
  let stored = initialSnapshot();
  await withServer(async (request, response) => {
    if (request.method === 'PUT') {
      const incoming = await readJson(request);
      stored = {
        ...incoming,
        revision: 1,
        updatedAt: '2026-09-28T00:01:00.000Z'
      };
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        ok: true,
        status: 200,
        revision: 1,
        updatedAt: stored.updatedAt
      }));
      return;
    }

    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, snapshot: stored }));
  }, async (baseUrl) => {
    const adapter = new ShootingOperationsSyncAdapter({ baseUrl, schedulerCredential });
    const snapshot = {
      ...initialSnapshot(),
      tasks: [{
        id: 'TASK-WIRE',
        sku: 'SKU-WIRE',
        name: 'Wire',
        client: '待确认',
        deliver: '主图',
        kind: '静物',
        optionalUndefined: undefined
      }]
    };
    const result = await adapter.guardedPushAndVerify(snapshot, {
      expectedRevision: 0,
      operationId: 'prod10-wire-json-0001'
    });
    assert.equal(result.verifiedSnapshot.revision, 1);
    assert.equal(Object.hasOwn(result.verifiedSnapshot.tasks[0], 'optionalUndefined'), false);
  });
});


test('guarded write captures revision and operation id getters exactly once', async () => {
  let expectedRevisionReads = 0;
  let operationIdReads = 0;
  let receivedIfMatch = null;
  let receivedOperationId = null;

  await withServer(async (request, response) => {
    receivedIfMatch = request.headers['if-match'];
    receivedOperationId = request.headers['idempotency-key'];
    await readJson(request);
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({
      ok: true,
      status: 200,
      revision: 1,
      updatedAt: '2026-09-28T00:01:00.000Z'
    }));
  }, async (baseUrl) => {
    const adapter = new ShootingOperationsSyncAdapter({ baseUrl, schedulerCredential });
    const options = {};
    Object.defineProperties(options, {
      expectedRevision: {
        enumerable: true,
        get() {
          expectedRevisionReads += 1;
          return expectedRevisionReads === 1 ? 0 : 1;
        }
      },
      operationId: {
        enumerable: true,
        get() {
          operationIdReads += 1;
          return operationIdReads === 1 ? 'prod10-options-once-0001' : 'prod10-options-once-evil';
        }
      }
    });

    const result = await adapter.guardedPush(initialSnapshot(), options);
    assert.equal(result.revision, 1);
  });

  assert.equal(expectedRevisionReads, 1);
  assert.equal(operationIdReads, 1);
  assert.equal(receivedIfMatch, '0');
  assert.equal(receivedOperationId, 'prod10-options-once-0001');
});
