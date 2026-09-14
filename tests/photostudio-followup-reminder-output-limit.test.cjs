'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.resolve(__dirname, '..', 'PhotoStudioPackages', 'FollowupReminderPlanningAdapter');
const MAX = 262144;
const SOURCE = Object.fromEntries(['stdio-entrypoint.cjs', 'index.cjs', 'followupReminderPlanProjection.cjs'].map(name => [name, fs.readFileSync(path.join(ROOT, name), 'utf8')]));
function runMain(input) {
  const listeners = new Map();
  const written = [];
  const fakeProcess = {
    stdin: { on(event, cb) { listeners.set(event, cb); }, resume() {} },
    stdout: { write(value, encoding) { written.push(Buffer.from(value, encoding)); return true; } }
  };
  const context = vm.createContext({ Buffer, process: fakeProcess });
  const modules = new Map();
  const entry = { exports: {} };
  modules.set('stdio-entrypoint.cjs', entry);
  const requireBound = name => {
    if (name !== './index.cjs' && name !== './followupReminderPlanProjection.cjs') throw new Error('UNADMITTED_IMPORT');
    const key = name.slice(2);
    if (modules.has(key)) return modules.get(key).exports;
    const module = { exports: {} }; modules.set(key, module);
    vm.runInContext(`(function(require,module,exports){${SOURCE[key]}\n})`, context, { filename: key })(requireBound, module, module.exports);
    return module.exports;
  };
  requireBound.main = entry;
  vm.runInContext(`(function(require,module,exports){${SOURCE['stdio-entrypoint.cjs']}\n})`, context, { filename: 'stdio-entrypoint.cjs' })(requireBound, entry, entry.exports);
  assert.deepEqual([...listeners.keys()].sort(), ['data', 'end']);
  const bytes = Buffer.from(input, 'utf8');
  for (let i = 0; i < bytes.length; i += 4093) listeners.get('data')(bytes.subarray(i, i + 4093));
  assert.equal(written.length, 0, 'nothing is emitted before EOF');
  listeners.get('end')();
  assert.equal(written.length, 1, 'one final output frame');
  const raw = written[0];
  assert.equal(raw.at(-1), 10);
  const frame = JSON.parse(raw.toString('utf8'));
  return { inputBytes: bytes.length, outputBytes: raw.length, frame };
}
function largeInput(field, unit) {
  const emptySize = Buffer.byteLength(JSON.stringify({ [field]: '' }) + '\n');
  const cost = Buffer.byteLength(JSON.stringify(unit)) - 2;
  const count = Math.floor((MAX - emptySize) / cost);
  return JSON.stringify({ [field]: unit.repeat(count) }) + '\n';
}
for (const field of ['requestId', 'creationId']) {
  for (const [label, unit] of [['ASCII','x'], ['UTF8','雪'], ['JSON_ESCAPE','\\']]) {
    test(`reachable ${field} ${label} error frame respects output bytes`, () => {
      const r = runMain(largeInput(field, unit));
      assert.ok(r.inputBytes <= MAX, 'input is within limit, including LF');
      assert.ok(r.outputBytes <= MAX, 'final serialized error frame includes LF in the limit');
      assert.equal(r.frame.error.code, 'OUTPUT_LIMIT_EXCEEDED');
      assert.equal(r.frame.requestId, '');
      assert.equal(r.frame.creationId, '');
      assert.equal(r.outputBytes, 146);
    });
  }
}
function validRequest(requestId = 'fixture-request') {
  return { protocolVersion: 1, requestId, creationId: 'jenn.photo-studio.plugin-followup-reminder', action: 'plan_followup_reminder_from_snapshot', payload: { referenceDate: '2026-06-24', reminderType: 'quotation_followup', projectSnapshot: { project_id: 'fixture-project', status: 'quoted' } } };
}
test('ordinary IDs and successful advisory payload are unchanged', () => {
  const input = validRequest();const r = runMain(JSON.stringify(input) + '\n');
  assert.equal(r.frame.ok, true);assert.equal(r.frame.requestId, input.requestId);assert.equal(r.frame.creationId, input.creationId);
  assert.equal(r.frame.result.recommendationType, 'ADVISORY_ONLY');assert.equal(r.frame.result.stateMutationAuthorized, false);assert.ok(r.outputBytes < MAX);
});
test('first bounded OUTPUT_LIMIT fallback retains IDs when it fits', () => {
  const input = validRequest('x'.repeat(MAX - 600));const r = runMain(JSON.stringify(input) + '\n');
  assert.ok(r.inputBytes <= MAX);assert.ok(r.outputBytes <= MAX);assert.equal(r.frame.error.code, 'OUTPUT_LIMIT_EXCEEDED');
  assert.equal(r.frame.requestId, input.requestId);assert.equal(r.frame.creationId, input.creationId);
});
test('input at exact byte budget differs from one byte over', () => {
  const at = largeInput('requestId','x');assert.equal(Buffer.byteLength(at), MAX);
  const a = runMain(at);assert.equal(a.frame.error.code,'OUTPUT_LIMIT_EXCEEDED');assert.ok(a.outputBytes <= MAX);
  const b = runMain(at + ' ');assert.equal(b.inputBytes,MAX+1);assert.equal(b.frame.error.code,'INPUT_LIMIT_EXCEEDED');assert.ok(b.outputBytes<=MAX);
});
test('malformed multiline input keeps existing fixed rejection shape', () => {
  const r=runMain('{}\n{}\n');assert.equal(r.frame.error.code,'INPUT_LINE_REQUIRED');assert.equal(r.frame.requestId,'');assert.equal(r.frame.creationId,'');assert.ok(r.outputBytes<=MAX);
});
