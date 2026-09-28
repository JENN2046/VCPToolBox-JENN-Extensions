'use strict';

const { isDeepStrictEqual } = require('node:util');

const OPERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

class ShootingOperationsSyncError extends Error {
  constructor(message, {
    code = 'SHOOTING_OPERATIONS_SYNC_ERROR',
    status = null,
    revision = null,
    uncertain = false
  } = {}) {
    super(message);
    this.name = 'ShootingOperationsSyncError';
    this.code = code;
    this.status = status;
    this.revision = revision;
    this.uncertain = uncertain === true;
  }
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function normalizeBaseUrl(value) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new TypeError('baseUrl is required');
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new TypeError('baseUrl must be a valid URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new TypeError('baseUrl must use http or https');
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new TypeError('baseUrl must not contain credentials, query, or fragment');
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new TypeError('baseUrl must identify the service root');
  }
  parsed.pathname = '/';
  return parsed.toString().replace(/\/$/u, '');
}

function isExplicitLoopbackUrl(value) {
  const parsed = new URL(value);
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/gu, '');
  return parsed.protocol === 'http:'
    && ['localhost', '127.0.0.1', '::1'].includes(hostname);
}

function validateBoundedInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new TypeError(`${label} must be an integer between ${min} and ${max}`);
  }
}

function validateOperationId(value) {
  if (typeof value !== 'string' || !OPERATION_ID.test(value)) {
    throw new TypeError('operationId does not satisfy the Jenn Shooting Operations idempotency-key contract');
  }
}

function canonicalSnapshotPayload(snapshot) {
  if (!isPlainObject(snapshot)
      || !Array.isArray(snapshot.products)
      || !Array.isArray(snapshot.tasks)
      || !Array.isArray(snapshot.sessions)) {
    throw new TypeError('snapshot must contain products, tasks, and sessions arrays');
  }
  return {
    products: snapshot.products,
    tasks: snapshot.tasks,
    sessions: snapshot.sessions
  };
}

function prepareWireSnapshot(snapshot, expectedRevision) {
  canonicalSnapshotPayload(snapshot);
  if (!Number.isInteger(snapshot.revision)
      || snapshot.revision < 0
      || snapshot.revision !== expectedRevision) {
    throw new TypeError('snapshot.revision must exactly match expectedRevision');
  }

  let body;
  try {
    body = JSON.stringify({
      schemaVersion: 1,
      revision: expectedRevision,
      updatedAt: snapshot.updatedAt,
      products: snapshot.products,
      tasks: snapshot.tasks,
      sessions: snapshot.sessions
    });
  } catch {
    throw new TypeError('snapshot must be JSON serializable');
  }
  if (typeof body !== 'string') {
    throw new TypeError('snapshot must be JSON serializable');
  }

  let wireSnapshot;
  try {
    wireSnapshot = JSON.parse(body);
  } catch {
    throw new TypeError('snapshot must serialize to valid JSON');
  }
  if (!isPlainObject(wireSnapshot)
      || wireSnapshot.schemaVersion !== 1
      || wireSnapshot.revision !== expectedRevision
      || !Array.isArray(wireSnapshot.products)
      || !Array.isArray(wireSnapshot.tasks)
      || !Array.isArray(wireSnapshot.sessions)) {
    throw new TypeError('serialized snapshot does not satisfy the guarded write envelope');
  }

  return {
    body,
    wireSnapshot,
    intendedPayload: canonicalSnapshotPayload(wireSnapshot)
  };
}

function responseLimitError(status, uncertain) {
  return new ShootingOperationsSyncError(
    'Jenn Shooting Operations response exceeded the configured byte limit',
    { code: 'RESPONSE_LIMIT_EXCEEDED', status, uncertain }
  );
}

async function readResponseBytes(response, maxResponseBytes, uncertain) {
  const contentLength = response.headers?.get?.('content-length');
  if (contentLength !== null && contentLength !== undefined) {
    if (!/^\d+$/u.test(contentLength) || Number(contentLength) > maxResponseBytes) {
      try {
        await response.body?.cancel?.();
      } catch {
        // The bounded failure is authoritative even if transport cancellation fails.
      }
      throw responseLimitError(response.status, uncertain);
    }
  }

  if (!response.body) return Buffer.alloc(0);

  const chunks = [];
  let total = 0;

  if (typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > maxResponseBytes) {
          try {
            await reader.cancel();
          } catch {
            // Do not replace the bounded failure with a cancellation detail.
          }
          throw responseLimitError(response.status, uncertain);
        }
        chunks.push(chunk);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Reader release has no effect on the request verdict.
      }
    }
    return Buffer.concat(chunks, total);
  }

  for await (const value of response.body) {
    const chunk = Buffer.from(value);
    total += chunk.length;
    if (total > maxResponseBytes) {
      try {
        await response.body.destroy?.();
      } catch {
        // Do not replace the bounded failure with a cancellation detail.
      }
      throw responseLimitError(response.status, uncertain);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

function publicFailure(payload, status, { uncertain = false } = {}) {
  const code = typeof payload?.code === 'string' && /^[A-Z0-9_]{1,80}$/u.test(payload.code)
    ? payload.code
    : `HTTP_${status}`;
  const revision = Number.isInteger(payload?.revision) && payload.revision >= 0
    ? payload.revision
    : null;
  return new ShootingOperationsSyncError(
    `Jenn Shooting Operations request failed: ${code}`,
    { code, status, revision, uncertain }
  );
}

class ShootingOperationsSyncAdapter {
  #baseUrl;
  #schedulerCredential;
  #fetchImpl;
  #timeoutMs;
  #maxResponseBytes;

  constructor({
    baseUrl,
    schedulerCredential = null,
    fetchImpl = globalThis.fetch,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxResponseBytes = DEFAULT_MAX_RESPONSE_BYTES
  } = {}) {
    const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
    if (schedulerCredential !== null
        && (typeof schedulerCredential !== 'string' || schedulerCredential.length < 16)) {
      throw new TypeError('schedulerCredential must be null or a configured scheduler credential');
    }
    if (schedulerCredential !== null
        && !normalizedBaseUrl.startsWith('https://')
        && !isExplicitLoopbackUrl(normalizedBaseUrl)) {
      throw new TypeError('schedulerCredential requires HTTPS except for explicit loopback HTTP');
    }
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('fetch implementation is required');
    }
    validateBoundedInteger(timeoutMs, 'timeoutMs', { min: 1, max: 60_000 });
    validateBoundedInteger(maxResponseBytes, 'maxResponseBytes', { min: 1024, max: 8 * 1024 * 1024 });

    this.#baseUrl = normalizedBaseUrl;
    this.#schedulerCredential = schedulerCredential;
    this.#fetchImpl = fetchImpl;
    this.#timeoutMs = timeoutMs;
    this.#maxResponseBytes = maxResponseBytes;
    Object.freeze(this);
  }

  async #request(method, path, { headers = {}, body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.#timeoutMs);
    const isWrite = !['GET', 'HEAD', 'OPTIONS'].includes(method);
    try {
      const response = await this.#fetchImpl(new URL(path, `${this.#baseUrl}/`), {
        method,
        headers: {
          Accept: 'application/json',
          ...headers
        },
        ...(body === undefined ? {} : { body }),
        signal: controller.signal
      });

      const bytes = await readResponseBytes(response, this.#maxResponseBytes, isWrite);

      let payload = null;
      if (bytes.length > 0) {
        try {
          payload = JSON.parse(bytes.toString('utf8'));
        } catch {
          throw new ShootingOperationsSyncError(
            'Jenn Shooting Operations returned invalid JSON',
            { code: 'INVALID_RESPONSE', status: response.status, uncertain: isWrite }
          );
        }
      }
      if (payload !== null && !isPlainObject(payload)) {
        throw new ShootingOperationsSyncError(
          'Jenn Shooting Operations returned an invalid response shape',
          { code: 'INVALID_RESPONSE', status: response.status, uncertain: isWrite }
        );
      }
      if (!response.ok) {
        throw publicFailure(payload, response.status, {
          uncertain: isWrite && response.status >= 500
        });
      }
      return payload;
    } catch (error) {
      if (error instanceof ShootingOperationsSyncError) throw error;
      const timedOut = error?.name === 'AbortError';
      throw new ShootingOperationsSyncError(
        isWrite
          ? 'Jenn Shooting Operations write outcome is uncertain and requires reconciliation'
          : 'Jenn Shooting Operations read failed before a valid response',
        {
          code: isWrite
            ? (timedOut ? 'WRITE_TIMEOUT_UNCERTAIN' : 'WRITE_TRANSPORT_UNCERTAIN')
            : (timedOut ? 'READ_TIMEOUT' : 'READ_TRANSPORT_FAILED'),
          uncertain: isWrite
        }
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async pull() {
    const payload = await this.#request('GET', '/api/v1/snapshot');
    if (payload?.ok !== true
        || !isPlainObject(payload.snapshot)
        || !Number.isInteger(payload.snapshot.revision)
        || payload.snapshot.revision < 0
        || !Array.isArray(payload.snapshot.products)
        || !Array.isArray(payload.snapshot.tasks)
        || !Array.isArray(payload.snapshot.sessions)) {
      throw new ShootingOperationsSyncError(
        'Jenn Shooting Operations returned an invalid snapshot response',
        { code: 'INVALID_RESPONSE', status: 200 }
      );
    }
    return payload.snapshot;
  }

  async #guardedPushPrepared(prepared) {
    const payload = await this.#request('PUT', '/api/v1/snapshot', {
      headers: {
        Authorization: `Bearer ${this.#schedulerCredential}`,
        'Content-Type': 'application/json',
        'If-Match': String(prepared.expectedRevision),
        'Idempotency-Key': prepared.operationId
      },
      body: prepared.body
    });

    if (payload?.ok !== true
        || !Number.isInteger(payload.revision)
        || payload.revision !== prepared.expectedRevision + 1
        || typeof payload.updatedAt !== 'string') {
      throw new ShootingOperationsSyncError(
        'Jenn Shooting Operations returned an invalid guarded-write response',
        { code: 'INVALID_RESPONSE', status: 200, uncertain: true }
      );
    }
    return payload;
  }

  #prepareGuardedPush(snapshot, options = {}) {
    if (typeof this.#schedulerCredential !== 'string') {
      throw new ShootingOperationsSyncError(
        'Scheduler capability is not configured for guarded writes',
        { code: 'WRITE_CAPABILITY_NOT_CONFIGURED' }
      );
    }
    const { expectedRevision, operationId } = options;
    validateBoundedInteger(expectedRevision, 'expectedRevision');
    validateOperationId(operationId);
    return {
      ...prepareWireSnapshot(snapshot, expectedRevision),
      expectedRevision,
      operationId
    };
  }

  async guardedPush(snapshot, options = {}) {
    const prepared = this.#prepareGuardedPush(snapshot, options);
    return this.#guardedPushPrepared(prepared);
  }

  async guardedPushAndVerify(snapshot, options = {}) {
    const prepared = this.#prepareGuardedPush(snapshot, options);
    const write = await this.#guardedPushPrepared(prepared);
    const verified = await this.pull();

    if (verified.revision !== write.revision
        || !isDeepStrictEqual(canonicalSnapshotPayload(verified), prepared.intendedPayload)) {
      throw new ShootingOperationsSyncError(
        'Jenn Shooting Operations verification pull did not match the guarded write',
        {
          code: 'VERIFY_MISMATCH',
          revision: Number.isInteger(verified?.revision) ? verified.revision : null
        }
      );
    }
    return { write, verifiedSnapshot: verified };
  }
}

module.exports = {
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_TIMEOUT_MS,
  OPERATION_ID,
  ShootingOperationsSyncAdapter,
  ShootingOperationsSyncError
};
