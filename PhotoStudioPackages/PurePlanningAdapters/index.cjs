'use strict';

const {
  ACTION: CASE_ACTION,
  CREATION_ID: CASE_CREATION_ID,
  buildCaseContentDraftFromSnapshot
} = require('./caseContentDraftProjection.cjs');
const {
  ACTION: REPLY_ACTION,
  CREATION_ID: REPLY_CREATION_ID,
  buildClientReplyDraftFromSnapshot
} = require('./replyDraftProjection.cjs');
const {
  ACTION: DELIVERY_PRIORITY_ACTION,
  CREATION_ID: DELIVERY_PRIORITY_CREATION_ID,
  buildDeliveryPriorityFromSnapshot
} = require('./deliveryPriorityProjection.cjs');

const ACTIONS = Object.freeze({
  caseContentDraft: CASE_ACTION,
  replyDraft: REPLY_ACTION,
  deliveryPriority: DELIVERY_PRIORITY_ACTION
});

const CREATION_IDS = Object.freeze({
  caseContentDraft: CASE_CREATION_ID,
  replyDraft: REPLY_CREATION_ID,
  deliveryPriority: DELIVERY_PRIORITY_CREATION_ID
});

function listAdapterProfiles() {
  return [
    {
      creationId: CREATION_IDS.caseContentDraft,
      action: ACTIONS.caseContentDraft,
      status: 'PURE_SNAPSHOT_PLANNING_ADAPTER',
      runtimeActionEligible: 'synthetic-only',
      fullParity: false,
      legacyTemplateParityRequired: false
    },
    {
      creationId: CREATION_IDS.replyDraft,
      action: ACTIONS.replyDraft,
      status: 'PURE_SNAPSHOT_PLANNING_ADAPTER',
      runtimeActionEligible: 'synthetic-only',
      fullParity: false,
      legacyTemplateParityRequired: false
    },
    {
      creationId: CREATION_IDS.deliveryPriority,
      action: ACTIONS.deliveryPriority,
      status: 'PURE_SNAPSHOT_PLANNING_ADAPTER',
      runtimeActionEligible: 'synthetic-only',
      fullParity: false,
      legacyTemplateParityRequired: false
    }
  ];
}

module.exports = {
  ACTIONS,
  CREATION_IDS,
  listAdapterProfiles,
  buildCaseContentDraftFromSnapshot,
  buildClientReplyDraftFromSnapshot,
  buildDeliveryPriorityFromSnapshot
};
