'use strict';
const {ConversationService,parseShift}=require('./service.cjs');
const {createAgentAdapter}=require('../JsoAgentAdapter/index.cjs');
const {createConfiguredAdapter}=require('../JsoAgentAdapter/config.cjs');
// Trusted composition only, never exported as a model/stdin command. Reuses the host's
// ApprovalReceiptAuthority instance and existing authenticated session/delegation adapter.
function createConversationHost({config,authority,readNativeEvent,delegate,cancelDelegate,sessionCurrent,journalPath,journalGuard,refreshChart,fetchImpl=fetch,clock}){
 if(!authority||typeof readNativeEvent!=='function'||typeof delegate!=='function'||typeof cancelDelegate!=='function'||typeof sessionCurrent!=='function')throw Error('TRUSTED_CONVERSATION_INTERFACE_REQUIRED');
 const contexts=new Map(),agent=createAgentAdapter({endpoint:config.endpoint,token:config.token,fetchImpl});
 const safe=createConfiguredAdapter(config,{fetchImpl});
 const service=new ConversationService({journalPath,journalGuard,clock,
  tool:args=>agent.call(args),verifyOwner:async()=>true,refreshChart,
  ownerCancel:operation=>cancelDelegate({source:service.journal.data.sources[operation.sourceId],command:operation.proposal.command}),
  ownerAuthorize:async operation=>{
   const {command,before}=operation.proposal;
   if(!config.resources.includes(command.resourceId))return {ok:false,code:'FORBIDDEN'};
   const minutes=(Date.parse(command.plannedStart)-Date.parse(before?.plannedStart))/60000;
   const endMinutes=(Date.parse(command.plannedEnd)-Date.parse(before?.plannedEnd))/60000;
   if(!Number.isSafeInteger(minutes)||minutes===0||minutes!==endMinutes||Math.abs(minutes)>config.maxMinutes)return {ok:false,code:'SHIFT_LIMIT'};
   const context=contexts.get(operation.sourceId),event=readNativeEvent(context);
   const source=service.journal.data.sources[operation.sourceId];
   if(!event||!source||event.messageId!==source.id||event.text!==source.text||event.conversationId!==source.conversationId||!authority.isHuman(context)||!await sessionCurrent(context,operation.proposal.command.resourceId))return {ok:false,code:'TRUSTED_SESSION_REQUIRED'};
   if(operation.cancelled)return {ok:false,code:'CANCELLED'};
   const payload={command:'reschedule',requestId:operation.id,sourceId:source.id,conversationId:source.conversationId,schedule:operation.proposal.command};
   const record=authority.snapshot('JennShootingOperations',payload,{requiresApproval:true,matchedRule:'JennShootingOperations:reschedule',matchedCommand:'reschedule'},{enabled:true});
   const intent=authority.attestIntent(record,{decision:'approve',hostApprovalRequestId:source.id,targetDigest:record.argsDigest},context);
   const handle=authority.approve(record,intent),invocation={};authority.bindInvocation(handle,invocation,payload);
   try{
    const receipt=authority.verifyAuthorization({toolName:'JennShootingOperations',command:'reschedule',requestId:operation.id,payload},invocation);
    // The receiving adapter must independently resolve this SAME session to existing
    // JSO permissions. This callback is host construction, never user/model JSON.
    return await delegate({context,source,command:operation.proposal.command,receipt});
   }finally{authority.finishInvocation(invocation);}
  }
 });
 return {
  reloadJournal:()=>service.journal.reload(),
  call:args=>safe.call(args),
  async propose({conversationId,messageId,scheduleItemId,resourceId,minutes}){
   if(!config.resources.includes(resourceId))return {ok:false,code:'FORBIDDEN'};
   if(!Number.isSafeInteger(minutes)||minutes===0||Math.abs(minutes)>config.maxMinutes)return {ok:false,code:'SHIFT_LIMIT'};
   return service.propose({conversationId,messageId,scheduleItemId,resourceId,minutes});
  },
  // Called only by the trusted normal-message renderer transport after exact readback.
  // It uses ordinary message text; no JSO card, window, login or approval notification.
  presented(context,{planId,text,conversationId}){
   const p=service.journal.data.plans[planId];
   if(!authority.isHuman(context)||!p||p.conversationId!==conversationId||text!==p.presentation)return {ok:false,code:'PRESENTATION_MISMATCH'};
   service.markPresented(planId,conversationId,p.proposal.commandDigest);return {ok:true};
  },
  async prepare(context,resourceId){
   if(config.policy!=='native-direct-and-confirm')return {handled:false,ok:false,code:'READ_ONLY_POLICY'};
   const event=readNativeEvent(context);
   if(!event||!authority.isHuman(context)||!await sessionCurrent(context,resourceId))return {handled:false,ok:false,code:'TRUSTED_SESSION_REQUIRED'};
   if(!config.resources.includes(resourceId))return {handled:true,ok:false,code:'FORBIDDEN'};
   const text=event.text.trim(),hasContext=Object.values(service.journal.data.plans).some(p=>p.conversationId===event.conversationId&&!p.closed)||Object.values(service.journal.data.sources).some(s=>s.conversationId===event.conversationId);
   if(!parseShift(text)&&!(hasContext&&/^(再延后|再推迟|再提前|可以|同意|执行吧|取消|不要|不用了|不同意|改成|改为)/u.test(text)))return {handled:false,ok:true};
   const source=service.captureNative(event);return {handled:true,ok:true,sourceId:source.id};
  },
  source:id=>service.journal.data.sources[id]||null,
  async submit(context,resourceId){
   if(config.policy!=='native-direct-and-confirm')return {ok:false,code:'READ_ONLY_POLICY'};
   const event=readNativeEvent(context);
   if(!event||!authority.isHuman(context)||!await sessionCurrent(context,resourceId))return {ok:false,code:'TRUSTED_SESSION_REQUIRED'};
   if(!config.resources.includes(resourceId))return {ok:false,code:'FORBIDDEN'};
   // The final command is checked in ownerAuthorize. Receipt-only recovery must
   // remain available even when the original source exceeds today's limit.
   const source=service.captureNative(event);contexts.set(source.id,context);
   try{return await service.submit(source.id,resourceId);}finally{contexts.delete(source.id);}
  },
  invalidateMessage:(conversationId,messageId)=>service.invalidateMessage(conversationId,messageId),
  recover:()=>service.recover(),
  // Read-only values for a trusted renderer, not authorizations or bearer secrets.
  sequence:()=>service.journal.data.sequence||0
 };
}
module.exports={createConversationHost};
