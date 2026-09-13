'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const packageRoot = path.resolve(__dirname, '..', 'PhotoStudioPackages', 'DeliveryTasksPlanningAdapter');
const entrypointSource = fs.readFileSync(path.join(packageRoot, 'stdio-entrypoint.cjs'), 'utf8');
const pureSources = Object.freeze({
  './index.cjs': fs.readFileSync(path.join(packageRoot, 'index.cjs'), 'utf8'),
  './deliveryTaskPlanProjection.cjs': fs.readFileSync(path.join(packageRoot, 'deliveryTaskPlanProjection.cjs'), 'utf8')
});
const MAX_BYTES = 262144;
const canonicalCreationId = 'jenn.photo-studio.plugin-delivery-tasks';
const action = 'plan_delivery_tasks_from_snapshot';

function outputLimitFrame(requestId = '', creationId = '') {
  return {
    protocolVersion: 1,
    requestId,
    creationId,
    ok: false,
    error: { code: 'OUTPUT_LIMIT_EXCEEDED', message: 'Response exceeds byte limit.' }
  };
}

function lineBytes(value) {
  return Buffer.byteLength(`${JSON.stringify(value)}\n`, 'utf8');
}

function memoryRuntime() {
  const listeners = new Map();
  const writes = [];
  let resumed = false;
  const moduleValue = { exports: {} };
  const loaded = new Map();
  function loadPureModule(request) {
    assert.ok(Object.prototype.hasOwnProperty.call(pureSources, request), 'Only the two reviewed pure modules may be required.');
    if (loaded.has(request)) return loaded.get(request).exports;
    const pureModule = { exports: {} };
    loaded.set(request, pureModule);
    const wrapper = vm.runInContext(`(function(require, module, exports) {\n${pureSources[request]}\n})`, context, { timeout: 1000 });
    wrapper(loadPureModule, pureModule, pureModule.exports);
    return pureModule.exports;
  }
  const onlyIndex = (request) => {
    assert.equal(request, './index.cjs', 'Only the reviewed pure planner may be required.');
    return loadPureModule(request);
  };
  onlyIndex.main = moduleValue;
  const context = vm.createContext({
    Buffer,
    module: moduleValue,
    exports: moduleValue.exports,
    require: onlyIndex,
    process: {
      stdin: {
        on(event, listener) {
          assert.ok(event === 'data' || event === 'end');
          assert.equal(listeners.has(event), false);
          listeners.set(event, listener);
          return this;
        },
        resume() { resumed = true; }
      },
      stdout: {
        write(value, encoding) {
          assert.equal(typeof value, 'string');
          assert.equal(encoding, 'utf8');
          writes.push(value);
          return true;
        }
      }
    }
  });
  vm.runInContext(entrypointSource, context, { filename: 'reviewed-stdio-entrypoint.cjs', timeout: 1000 });
  assert.equal(resumed, true, 'The real main() must have attached its in-memory input listeners.');
  assert.equal(listeners.size, 2);
  return {
    input(bytes) {
      // Split inside multibyte/escaped inputs as well as ordinary ASCII frames.
      for (let start = 0; start < bytes.length; start += 257) {
        listeners.get('data')(bytes.subarray(start, start + 257));
      }
      listeners.get('end')();
      return writes;
    },
    emit(response) {
      context.syntheticResponse = response;
      vm.runInContext('emit(syntheticResponse)', context, { timeout: 1000 });
      delete context.syntheticResponse;
      return writes;
    }
  };
}

function assertBoundedFrame(writes) {
  assert.equal(writes.length, 1, 'Each request must produce one write.');
  const line = writes[0];
  assert.equal(line.endsWith('\n'), true);
  assert.equal(line.slice(0, -1).includes('\n'), false, 'The output must be one JSON line.');
  assert.ok(Buffer.byteLength(line, 'utf8') <= MAX_BYTES, 'The newline-terminated UTF-8 frame must fit MAX_OUTPUT_BYTES.');
  return JSON.parse(line);
}

function runMain(request) {
  const bytes = Buffer.from(`${JSON.stringify(request)}\n`, 'utf8');
  assert.ok(bytes.length <= MAX_BYTES, 'Regression input must pass the existing input-byte gate.');
  return assertBoundedFrame(memoryRuntime().input(bytes));
}

function nearLimitRequest(field, unit, otherFields = {}) {
  const request = { ...otherFields, [field]: '' };
  const perUnit = Buffer.byteLength(JSON.stringify(unit), 'utf8') - 2;
  request[field] = unit.repeat(Math.floor((MAX_BYTES - lineBytes(request)) / perUnit));
  assert.ok(lineBytes(request) <= MAX_BYTES);
  return request;
}

function assertAnonymousOutputLimit(response) {
  assert.deepEqual(response, outputLimitFrame());
}

test('main -> emit bounds the reported near-limit ASCII requestId regression', () => {
  const request = { requestId: 'x'.repeat(262120) };
  assert.equal(lineBytes(request), 262137);
  assertAnonymousOutputLimit(runMain(request));
});

test('main -> emit bounds a near-limit ASCII creationId', () => {
  assertAnonymousOutputLimit(runMain(nearLimitRequest('creationId', 'x')));
});

test('main -> emit measures UTF-8 bytes of a multibyte requestId', () => {
  const request = nearLimitRequest('requestId', '\u{1F642}', { creationId: 'ordinary-creation' });
  assert.ok(lineBytes(request) > JSON.stringify(request).length);
  assertAnonymousOutputLimit(runMain(request));
});

test('main -> emit measures JSON escaping bytes of creationId', () => {
  const request = nearLimitRequest('creationId', '"\\\n\t\0', { requestId: 'ordinary-request' });
  assert.ok(lineBytes(request) > request.creationId.length);
  assertAnonymousOutputLimit(runMain(request));
});

test('main -> emit preserves ordinary IDs in an existing validation-error frame', () => {
  const response = runMain({ requestId: 'ordinary-request', creationId: 'ordinary-creation' });
  assert.equal(response.error.code, 'PROTOCOL_VERSION_UNSUPPORTED');
  assert.equal(response.requestId, 'ordinary-request');
  assert.equal(response.creationId, 'ordinary-creation');
});

test('main -> emit preserves ordinary IDs and the successful advisory result', () => {
  const response = runMain({
    protocolVersion: 1,
    requestId: 'ordinary-request',
    creationId: canonicalCreationId,
    action,
    payload: { projectSnapshot: { project_id: 'SYNTHETIC-1', project_type: 'other', status: 'reviewing' } }
  });
  assert.equal(response.ok, true);
  assert.equal(response.requestId, 'ordinary-request');
  assert.equal(response.creationId, canonicalCreationId);
  assert.equal(response.result.plannedTaskCount, 4);
  assert.equal(response.result.executionAuthorized, false);
});

test('first output-limit fallback preserves ordinary IDs including UTF-8 and escapes', () => {
  const requestId = 'normal-\u{1F642}-"\\';
  const creationId = 'ordinary-creation';
  const response = assertBoundedFrame(memoryRuntime().emit({
    protocolVersion: 1, requestId, creationId, ok: true, result: { synthetic: 'x'.repeat(MAX_BYTES) }
  }));
  assert.deepEqual(response, outputLimitFrame(requestId, creationId));
});

test('an output-limit fallback exactly at the byte limit retains its IDs', () => {
  const creationId = 'ordinary-creation';
  const requestId = 'x'.repeat(MAX_BYTES - lineBytes(outputLimitFrame('', creationId)));
  assert.equal(lineBytes(outputLimitFrame(requestId, creationId)), MAX_BYTES);
  const response = assertBoundedFrame(memoryRuntime().emit({
    protocolVersion: 1, requestId, creationId, ok: true, result: { synthetic: 'x'.repeat(MAX_BYTES) }
  }));
  assert.deepEqual(response, outputLimitFrame(requestId, creationId));
});

test('an output-limit fallback one byte over the limit uses the fixed anonymous shape', () => {
  const creationId = 'ordinary-creation';
  const requestId = 'x'.repeat(MAX_BYTES - lineBytes(outputLimitFrame('', creationId)) + 1);
  assert.equal(lineBytes(outputLimitFrame(requestId, creationId)), MAX_BYTES + 1);
  const response = assertBoundedFrame(memoryRuntime().emit({
    protocolVersion: 1, requestId, creationId, ok: true, result: { synthetic: 'x'.repeat(MAX_BYTES) }
  }));
  assertAnonymousOutputLimit(response);
});

test('main keeps the existing fixed anonymous input-limit error shape', () => {
  const response = assertBoundedFrame(memoryRuntime().input(Buffer.alloc(MAX_BYTES + 1, 120)));
  assert.equal(response.error.code, 'INPUT_LIMIT_EXCEEDED');
  assert.equal(response.requestId, '');
  assert.equal(response.creationId, '');
});
