'use strict';
const {digest}=require('./operations.cjs');
function adoptionAllowed(proposal,{resources,requestIds=[]}){
 const c=proposal?.command,items=proposal?.items,scope=c?.generationCommand?.resourceScope;
 if(proposal?.action!=='adopt_proposal'||!Array.isArray(scope)||scope.length!==1||!resources.includes(scope[0])
  ||!requestIds.length||!Array.isArray(items)||!items.length||c.decision?.decisionType!=='accept'
  ||items.some(i=>i.resourceId!==scope[0]||!requestIds.includes(i.requestId)))return false;
 const ids=items.map(i=>i.proposalItemId).sort();
 return new Set(ids).size===ids.length&&JSON.stringify(ids)===JSON.stringify(c.decision.selectedProposalItemIds)
  &&proposal.commandDigest===digest({domain:'jso-agent-command-v1',action:'adopt_proposal',command:c});
}
module.exports={adoptionAllowed};
