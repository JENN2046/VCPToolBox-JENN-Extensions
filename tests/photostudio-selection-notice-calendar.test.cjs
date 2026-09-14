'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const packageRoot = path.resolve(__dirname, '../PhotoStudioPackages/SelectionNoticeSnapshotAdapter');
const entrypoint = path.join(packageRoot, 'stdio-entrypoint.cjs');
const { buildSelectionNoticeFromSnapshot: build } = require(path.join(packageRoot, 'index.cjs'));
const { ACTION, CREATION_ID, handleRequest } = require(entrypoint);

function payload() {
  return {
    generatedAt: '2026-06-23T01:02:03.000Z', tone: 'formal',
    projectSnapshot: {
      project_id: 'synthetic-calendar-project', project_name: 'Synthetic Calendar',
      status: 'editing', due_date: '2026-07-08'
    },
    selectionDeadline: '2026-07-01'
  };
}

function request(input) {
  return { protocolVersion: 1, requestId: 'synthetic-calendar-request', creationId: CREATION_ID, action: ACTION, payload: input };
}

function calendarInput(field, value) {
  const input = payload();
  if (field === 'due_date') {
    input.projectSnapshot.due_date = value;
    delete input.selectionDeadline;
  } else if (field === 'generatedAt') {
    input.generatedAt = `${value}T12:34:56.789Z`;
  } else {
    input.selectionDeadline = value;
  }
  return input;
}

function assertRejected(input, label) {
  const before = JSON.stringify(input);
  assert.throws(() => build(input), TypeError, label);
  const response = handleRequest(request(input));
  assert.deepEqual(Object.keys(response).sort(), ['creationId', 'error', 'ok', 'protocolVersion', 'requestId']);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PROJECTION_REJECTED');
  assert.equal(response.requestId, 'synthetic-calendar-request');
  assert.equal(response.creationId, CREATION_ID);
  assert.equal(JSON.stringify(input), before, 'rejection must not normalize or mutate input');
}

function assertAdvisory(result) {
  assert.equal(result.requiresHumanReview, true);
  assert.equal(result.sendReady, false);
  assert.equal(result.dispatchAuthorized, false);
  assert.equal(result.automaticNotificationAuthorized, false);
}

for (const date of [
  '2026-02-31', '2026-02-29', '1900-02-29', '2100-02-29', '0001-02-29',
  '2026-04-31', '2026-06-31', '2026-00-10', '2026-13-10',
  '2026-01-00', '2026-01-32', '9999-12-32'
]) {
  test(`calendar rejects nonexistent ${date} in all three date inputs`, () => {
    for (const field of ['selectionDeadline', 'due_date', 'generatedAt']) {
      assertRejected(calendarInput(field, date), field);
    }
  });
}

for (const date of [
  '0000-02-29', '0001-01-01', '0099-12-31', '0400-02-29', '1600-02-29',
  '1900-02-28', '2000-02-29', '2024-02-29', '2026-04-30',
  '2026-12-31', '2400-02-29', '9999-12-31'
]) {
  test(`calendar preserves valid four-digit Gregorian date ${date}`, () => {
    for (const field of ['selectionDeadline', 'due_date', 'generatedAt']) {
      const input = calendarInput(field, date);
      const before = JSON.stringify(input);
      const result = build(input);
      assertAdvisory(result);
      if (field === 'generatedAt') {
        assert.equal(result.generatedAt, `${date}T12:34:56.789Z`);
      } else {
        assert.equal(result.selectionDeadline, date);
        assert.equal(result.selectionDeadlineSource, field === 'due_date' ? 'PROJECT_DUE_DATE' : 'EXPLICIT_INPUT');
        assert.ok(result.noticeContent.includes(`by ${date}.`));
      }
      assert.equal(JSON.stringify(input), before, 'accepted date stays exact without normalization');
    }
  });
}

for (const timestamp of [
  '2026-99-99T99:99:99Z', '2026-02-31T00:00:00Z',
  '2026-06-23T24:00:00Z', '2026-06-23T99:00:00Z',
  '2026-06-23T00:60:00Z', '2026-06-23T00:99:00Z',
  '2026-06-23T00:00:60Z', '2026-06-23T00:00:99Z',
  '2026-06-23T24:00:00.000Z'
]) {
  test(`calendar rejects out-of-range timestamp ${timestamp}`, () => {
    assertRejected({ ...payload(), generatedAt: timestamp });
  });
}

for (const timestamp of [
  '0000-01-01T00:00:00Z', '0000-02-29T23:59:59.999Z',
  '2026-06-23T00:00:00.000Z', '2026-06-23T23:59:59Z',
  '2026-06-23T01:02:03.001Z', '9999-12-31T23:59:59.999Z'
]) {
  test(`calendar preserves exact allowed UTC timestamp ${timestamp}`, () => {
    const input = { ...payload(), generatedAt: timestamp };
    const before = JSON.stringify(input);
    const first = build(input);
    assert.equal(first.generatedAt, timestamp);
    assertAdvisory(first);
    assert.deepEqual(build(input), first);
    assert.equal(JSON.stringify(input), before);
  });
}

for (const timestamp of [
  '2026-06-23T01:02:03+00:00', '2026-06-23T01:02:03-01:00',
  '2026-06-23T01:02:03z', '2026-06-23t01:02:03Z',
  '2026-06-23T01:02:03.0Z', '2026-06-23T01:02:03.00Z',
  '2026-06-23T01:02:03.0000Z', ' 2026-06-23T01:02:03Z'
]) {
  test(`calendar keeps the original timestamp grammar rejection ${timestamp}`, () => {
    assertRejected({ ...payload(), generatedAt: timestamp });
  });
}

for (const value of [undefined, null]) {
  test(`calendar keeps optional deadlines absent for ${String(value)}`, () => {
    const input = payload();
    input.selectionDeadline = value;
    input.projectSnapshot.due_date = value;
    const before = JSON.stringify(input);
    const result = build(input);
    assert.equal(result.selectionDeadline, null);
    assert.equal(result.selectionDeadlineSource, 'NOT_PROVIDED');
    assert.ok(result.warnings.includes('SELECTION_DEADLINE_NOT_PROVIDED'));
    assertAdvisory(result);
    assert.equal(JSON.stringify(input), before);
  });
}

test('calendar validates even a due date shadowed by a valid explicit deadline', () => {
  const input = payload();
  input.projectSnapshot.due_date = '2026-02-31';
  assertRejected(input);
});

function runMain(input) {
  const result = spawnSync(process.execPath, ['--no-addons', entrypoint], {
    input: `${JSON.stringify(request(input))}\n`, encoding: 'utf8', env: {}, timeout: 5000, maxBuffer: 1048576
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout.split('\n').length, 2);
  assert.ok(result.stdout.endsWith('\n'));
  assert.ok(Buffer.byteLength(result.stdout) <= 262144);
  const response = JSON.parse(result.stdout);
  assert.equal(response.requestId, 'synthetic-calendar-request');
  assert.equal(response.creationId, CREATION_ID);
  return response;
}

for (const field of ['selectionDeadline', 'due_date', 'generatedAt']) {
  test(`actual main rejects the reported invalid ${field} before producing a notice`, () => {
    const input = calendarInput(field, '2026-02-31');
    if (field === 'generatedAt') input.generatedAt = '2026-99-99T99:99:99Z';
    const response = runMain(input);
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'PROJECTION_REJECTED');
    assert.equal(Object.hasOwn(response, 'result'), false);
  });
}

test('actual main preserves the exact valid calendar result and advisory envelope', () => {
  const input = payload();
  input.generatedAt = '2000-02-29T23:59:59.999Z';
  input.selectionDeadline = '2400-02-29';
  const response = runMain(input);
  assert.equal(response.ok, true);
  assert.deepEqual(response.result, build(input));
  assertAdvisory(response.result);
});

test('calendar dates reject trailing line terminators rather than relying on the dollar anchor', () => {
  for (const ending of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    for (const field of ['selectionDeadline', 'due_date']) {
      assertRejected(calendarInput(field, `2026-07-01${ending}`), field);
    }
  }
});

test('UTC timestamps reject trailing line terminators without trimming the metadata', () => {
  for (const ending of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
    assertRejected({ ...payload(), generatedAt: `2026-07-01T01:02:03.000Z${ending}` });
  }
});
