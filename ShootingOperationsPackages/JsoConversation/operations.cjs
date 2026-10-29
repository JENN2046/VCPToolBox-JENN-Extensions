'use strict';
const {createHash}=require('node:crypto');
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':value&&typeof value==='object'?'{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}':JSON.stringify(value);
const digest=value=>'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');
const actionOf=proposal=>proposal.action||'reschedule';
const operationId=proposal=>actionOf(proposal)==='adopt_proposal'?proposal.command.decision.decisionId:proposal.command.operationId;
const resourceOf=proposal=>actionOf(proposal)==='adopt_proposal'?proposal.command.generationCommand.resourceScope[0]:proposal.command.resourceId;
function decisionDigest(d){return digest({domain:'scheduling-proposal-decision-command-v1',proposalId:d.proposalId,decisionType:d.decisionType,selectedProposalItemIds:d.selectedProposalItemIds,decisionNote:d.decisionNote,reasonCode:d.reasonCode});}
function receiptMatches(proposal,result,{lookup=false}={}){
 const r=result?.receipt;if(!r)return false;
 if(actionOf(proposal)==='reschedule')return r.operationId===operationId(proposal);
 const d=proposal.command.decision,ids=d.selectedProposalItemIds;
 if(lookup&&(result.kind!=='proposalDecision'||!Array.isArray(result.resourceScope)
  ||canonical([...result.resourceScope].sort())!==canonical([...proposal.command.generationCommand.resourceScope].sort())))return false;
 return (!result.kind||result.kind==='proposalDecision'&&Array.isArray(result.resourceScope)
  &&canonical([...result.resourceScope].sort())===canonical([...proposal.command.generationCommand.resourceScope].sort()))&&r.decisionId===d.decisionId&&r.proposalId===d.proposalId
  &&r.decisionType==='accept'&&r.decisionCommandDigest===decisionDigest(d)
  &&canonical(r.selectedProposalItemIds)===canonical(ids)&&Array.isArray(r.adoptedItems)&&r.adoptedItems.length===ids.length
  &&new Set(r.adoptedItems.map(i=>i.proposalItemId)).size===ids.length
  &&new Set(r.adoptedItems.map(i=>i.scheduleItemId)).size===ids.length
  &&r.adoptedItems.every(i=>ids.includes(i.proposalItemId)&&typeof i.scheduleItemId==='string'&&i.scheduleItemId.length>0);
}
module.exports={actionOf,operationId,resourceOf,digest,canonical,receiptMatches};
