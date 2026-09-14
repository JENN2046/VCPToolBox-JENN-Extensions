'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { planFollowupReminderFromSnapshot: plan } = require('../PhotoStudioPackages/FollowupReminderPlanningAdapter/index.cjs');
const { handleRequest, ACTION, CREATION_ID } = require('../PhotoStudioPackages/FollowupReminderPlanningAdapter/stdio-entrypoint.cjs');

function payload(reminderType = 'quotation_followup', referenceDate = '9999-12-31', project = {}) {
  return {
    referenceDate,
    reminderType,
    projectSnapshot: {
      project_id: 'synthetic-date-boundary',
      status: reminderType === 'quotation_followup' ? 'quoted' : reminderType === 'delivery_followup' ? 'delivered' : 'completed',
      ...project
    },
    existingReminderSnapshots: []
  };
}

const overflowInputs = [
  ['quoted reference fallback', payload()],
  ['quoted first overflowing fallback', payload('quotation_followup', '9999-12-30')],
  ['delivery first overflowing fallback', payload('delivery_followup', '9999-12-29')],
  ['revisit first overflowing fallback', payload('revisit', '9999-12-02')],
  ['revisit first overflowing project date', payload('revisit', '2026-06-24', { due_date: '9999-12-02' })],
  ['delivery reference fallback', payload('delivery_followup')],
  ['revisit reference fallback', payload('revisit')],
  ['revisit project due date', payload('revisit', '2026-06-24', { due_date: '9999-12-31' })]
];
for (const [label, input] of overflowInputs) {
  test(`${label} rejects arithmetic beyond year 9999`, () => {
    const before = JSON.stringify(input);
    assert.throws(() => plan(input), {
      name: 'RangeError',
      message: 'Date arithmetic exceeds the YYYY-MM-DD range.'
    });
    assert.equal(JSON.stringify(input), before);
  });
}

const latestInputs = [
  ['quoted fallback', payload('quotation_followup', '9999-12-29'), 'REFERENCE_DATE_PLUS_2_DAYS'],
  ['delivery fallback', payload('delivery_followup', '9999-12-28'), 'REFERENCE_DATE_PLUS_3_DAYS'],
  ['revisit fallback', payload('revisit', '9999-12-01'), 'REFERENCE_DATE_PLUS_30_DAYS'],
  ['revisit project date', payload('revisit', '2026-06-24', { due_date: '9999-12-01' }), 'PROJECT_DUE_DATE_PLUS_30_DAYS']
];
for (const [label, input, source] of latestInputs) {
  test(`${label} keeps the latest representable result`, () => {
    const result = plan(input);
    assert.equal(result.recommendedDueDate, '9999-12-31');
    assert.equal(result.dueDateSource, source);
    assert.equal(result.newReminderPlanRecommended, true);
    assert.equal(result.executionAuthorized, false);
    assert.equal(result.stateMutationAuthorized, false);
  });
}

test('explicit last-day date bypasses unnecessary fallback arithmetic', () => {
  const result = plan({ ...payload(), explicitDueDate: '9999-12-31' });
  assert.equal(result.recommendedDueDate, '9999-12-31');
  assert.equal(result.dueDateSource, 'EXPLICIT_INPUT');
});

test('quotation project start date remains valid at the upper boundary', () => {
  const result = plan(payload('quotation_followup', '9999-12-31', { start_date: '9999-12-31' }));
  assert.equal(result.recommendedDueDate, '9999-12-31');
  assert.equal(result.dueDateSource, 'PROJECT_START_DATE');
});

test('existing pending reminder does not perform unused overflowing arithmetic', () => {
  const input = payload();
  input.existingReminderSnapshots = [{ project_id: input.projectSnapshot.project_id, reminder_type: input.reminderType, status: 'pending' }];
  const result = plan(input);
  assert.equal(result.planStatus, 'EXISTING_PENDING_REMINDER');
  assert.equal(result.newReminderPlanRecommended, false);
  assert.equal(result.recommendedDueDate, null);
});

test('ineligible project does not perform unused overflowing arithmetic', () => {
  const result = plan(payload('quotation_followup', '9999-12-31', { status: 'inquiry' }));
  assert.equal(result.planStatus, 'PROJECT_STATUS_INELIGIBLE');
  assert.equal(result.newReminderPlanRecommended, false);
  assert.equal(result.recommendedDueDate, null);
});

for (const [referenceDate, dueDate] of [
  ['2000-02-27', '2000-02-29'],
  ['1900-02-27', '1900-03-01'],
  ['0001-12-31', '0002-01-02']
]) {
  test(`normal calendar arithmetic remains valid from ${referenceDate}`, () => {
    const result = plan(payload('quotation_followup', referenceDate));
    assert.equal(result.recommendedDueDate, dueDate);
    assert.equal(result.dueDateSource, 'REFERENCE_DATE_PLUS_2_DAYS');
  });
}

test('protocol maps overflow to the existing projection rejection envelope', () => {
  const request = { protocolVersion: 1, requestId: 'synthetic-date-request', creationId: CREATION_ID, action: ACTION, payload: payload() };
  const result = handleRequest(request);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'PROJECTION_REJECTED');
  assert.equal(result.error.message, 'Date arithmetic exceeds the YYYY-MM-DD range.');
  assert.equal(result.requestId, request.requestId);
  assert.equal(result.creationId, CREATION_ID);
  assert.equal(Object.hasOwn(result, 'result'), false);
});

test('protocol still accepts the latest safe fallback result', () => {
  const result = handleRequest({ protocolVersion: 1, requestId: 'synthetic-safe-date', creationId: CREATION_ID, action: ACTION, payload: payload('quotation_followup', '9999-12-29') });
  assert.equal(result.ok, true);
  assert.equal(result.result.recommendedDueDate, '9999-12-31');
  assert.equal(result.result.notificationAuthorized, false);
});

for (const referenceDate of ['0000-12-31', '10000-01-01']) {
  test(`existing parser continues to reject ${referenceDate}`, () => {
    assert.throws(() => plan(payload('quotation_followup', referenceDate)), TypeError);
  });
}
