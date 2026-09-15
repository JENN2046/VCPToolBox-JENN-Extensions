'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const cp = require('node:child_process');

const { buildDeliveryPriorityFromSnapshot: priority } = require('../PhotoStudioPackages/PurePlanningAdapters/deliveryPriorityProjection.cjs');
const ENTRY = path.resolve(__dirname, '../PhotoStudioPackages/PurePlanningAdapters/stdio-entrypoint.cjs');

function snapshot(exportKey, updatedAt, overrides = {}) {
  const value = {
    project_id: 'PRJ-SYN-UPDATED',
    export_key: exportKey,
    target_type: 'client_gallery',
    delivery_state: 'ready_to_publish',
    schedule_date: '2026-06-24',
    ...overrides
  };
  if (updatedAt !== undefined) value.updated_at = updatedAt;
  return value;
}

function payload(snapshots) {
  return {
    referenceDate: '2026-06-24',
    externalExportSnapshots: snapshots
  };
}

function project(snapshots) {
  return priority(payload(snapshots));
}

function runMain(snapshots) {
  const request = {
    protocolVersion: 1,
    requestId: 'synthetic-pr12-updated-at-final',
    creationId: 'jenn.photo-studio.plugin-delivery-priority',
    action: 'prioritize_delivery_actions_from_snapshot',
    payload: payload(snapshots)
  };
  const result = cp.spawnSync(process.execPath, ['--no-addons', ENTRY], {
    env: {},
    input: Buffer.from(JSON.stringify(request) + '\n', 'utf8'),
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  const lines = result.stdout.split('\n');
  assert.equal(lines.length, 2);
  assert.equal(lines[1], '');
  return JSON.parse(lines[0]);
}

test('malformed non-empty updated_at values reject instead of entering tie-breaking', () => {
  for (const value of [
    'zz-not-a-timestamp',
    '2026-02-30T10:00:00Z',
    '2026-06-24T24:00:00Z',
    '2026-06-24T10:60:00Z',
    '2026-06-24T10:00:60Z',
    '2026-06-24T10:00:00',
    '2026-06-24T10:00:00.1234567Z',
    '2026-06-24T10:00:00+24:00',
    '2026-06-24T10:00:00+08:60',
    '2026-06-24T10:00:00-00:00'
  ]) {
    assert.throws(() => project([snapshot('BAD', value)]), error => error instanceof TypeError && /updated_at/.test(error.message));
  }
});

test('supplied non-string updated_at values reject while missing null and blank remain absent', () => {
  for (const value of [0, false, {}, []]) {
    assert.throws(() => project([snapshot('BAD', value)]), /updated_at/);
  }
  const values = [
    snapshot('MISSING', undefined),
    snapshot('NULL', null),
    snapshot('EMPTY', ''),
    snapshot('BLANK', ' \t\n ')
  ];
  const result = project(values);
  assert.deepEqual(result.prioritizedActions.map(item => item.exportKey), ['MISSING', 'NULL', 'EMPTY', 'BLANK']);
  assert.deepEqual(result.prioritizedActions.map(item => item.updatedAt), [null, null, null, null]);
});

test('valid explicit-offset forms retain admitted text after existing trim behavior', () => {
  for (const value of [
    '2026-06-24T10:00:00Z',
    '2026-06-24T10:00:00.1Z',
    '2026-06-24T10:00:00.123456Z',
    '2026-06-24T18:00:00+08:00',
    '2026-06-24T02:30:00-07:30',
    '2026-06-24t10:00:00z'
  ]) {
    const result = project([snapshot('VALID', `  ${value}  `)]);
    assert.equal(result.prioritizedActions[0].updatedAt, value);
  }
});

test('chronological ordering wins over lexical ordering across offsets', () => {
  const result = project([
    snapshot('LEXICALLY-LARGER-BUT-OLDER', '2026-06-24T10:00:00+02:00'),
    snapshot('LEXICALLY-SMALLER-BUT-NEWER', '2026-06-24T09:30:00Z')
  ]);
  assert.deepEqual(result.prioritizedActions.map(item => item.exportKey), [
    'LEXICALLY-SMALLER-BUT-NEWER',
    'LEXICALLY-LARGER-BUT-OLDER'
  ]);
});

test('equivalent instants across offsets retain source-index tie order', () => {
  const result = project([
    snapshot('FIRST', '2026-06-24T10:00:00+02:00'),
    snapshot('SECOND', '2026-06-24T08:00:00Z')
  ]);
  assert.deepEqual(result.prioritizedActions.map(item => item.exportKey), ['FIRST', 'SECOND']);
});

test('microsecond precision beyond JavaScript milliseconds remains sortable', () => {
  const result = project([
    snapshot('OLDER', '2026-06-24T08:00:00.123455Z'),
    snapshot('NEWER', '2026-06-24T08:00:00.123456Z')
  ]);
  assert.deepEqual(result.prioritizedActions.map(item => item.exportKey), ['NEWER', 'OLDER']);
});

test('fractional precision from zero through six digits compares as the same instant when equivalent', () => {
  const result = project([
    snapshot('ZERO', '2026-06-24T08:00:00Z'),
    snapshot('ONE', '2026-06-24T08:00:00.0Z'),
    snapshot('SIX', '2026-06-24T08:00:00.000000Z')
  ]);
  assert.deepEqual(result.prioritizedActions.map(item => item.exportKey), ['ZERO', 'ONE', 'SIX']);
});

test('calendar boundaries use the same proleptic Gregorian rules as existing date validation', () => {
  assert.equal(project([snapshot('YEAR-ZERO', '0000-02-29T00:00:00Z')]).prioritizedActions[0].updatedAt, '0000-02-29T00:00:00Z');
  assert.equal(project([snapshot('MAX', '9999-12-31T23:59:59.999999Z')]).prioritizedActions[0].updatedAt, '9999-12-31T23:59:59.999999Z');
  assert.throws(() => project([snapshot('BAD-CENTURY', '1900-02-29T00:00:00Z')]), /updated_at/);
});

test('actual JSONL entrypoint rejects malformed updated_at with the bounded projection envelope', () => {
  const response = runMain([snapshot('BAD', 'zz-not-a-timestamp')]);
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PROJECTION_REJECTED');
  assert.equal(Object.hasOwn(response, 'result'), false);
});

test('actual JSONL entrypoint uses chronological offset ordering and preserves output text', () => {
  const snapshots = [
    snapshot('OLDER', '2026-06-24T10:00:00+02:00'),
    snapshot('NEWER', '2026-06-24T09:30:00Z')
  ];
  const response = runMain(snapshots);
  assert.equal(response.ok, true);
  assert.deepEqual(response.result.prioritizedActions.map(item => item.exportKey), ['NEWER', 'OLDER']);
  assert.deepEqual(response.result.prioritizedActions.map(item => item.updatedAt), ['2026-06-24T09:30:00Z', '2026-06-24T10:00:00+02:00']);
});
