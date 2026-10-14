'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
const {createConversationHost}=require('./host.cjs');
async function runNative(args,config,env,invocation){
 const credential=invocation?.native;
 if(!credential||!args||!['status','prepare','execute','propose','presented','invalidate','recover'].includes(args.nativeAction))return {ok:false,code:'TRUSTED_NATIVE_TRANSPORT_REQUIRED'};
 if(!env.JSO_JOURNAL_PATH||!path.isAbsolute(env.JSO_JOURNAL_PATH)||!env.JSO_ASSISTANT_SUBJECT_ID)return {ok:false,code:'NATIVE_PLUGIN_CONFIG_REQUIRED'};
 const resource=env.JSO_DEFAULT_RESOURCE_ID||(config.resources.length===1?config.resources[0]:null);
 if(!resource||!config.resources.includes(resource))return {ok:false,code:'DEFAULT_RESOURCE_REQUIRED'};
 async function ownerRequest(route,body){return invocation.request({kind:route.endsWith('owner-session')?'owner-session':'owner-delegation',payload:body});}
 let principal;
 async function verify(){const p=await ownerRequest('/api/v2/agent/owner-session');if(!p.ok||p.role!=='administrator'||!p.resourceIds?.includes(resource)||principal&&p.subjectId!==principal.subjectId)return false;principal=p;return true;}
 if(!await verify())return {ok:false,code:'APPLICATION_SESSION_REQUIRED'};
 const file=env.JSO_JOURNAL_PATH+'.'+createHash('sha256').update(principal.subjectId).digest('hex').slice(0,24)+'.json';fs.mkdirSync(path.dirname(file),{recursive:true});
 const lock=file+'.lock';try{fs.mkdirSync(lock);}catch{return {ok:false,code:'JOURNAL_BUSY_RECONCILE_REQUIRED'};}
 try{
  const {ApprovalReceiptAuthority}=require(path.join(env.PROJECT_BASE_PATH,'modules/approvalReceiptAuthority'));
  // Adapt the existing JSO authenticated administrator to the kernel's admission contract.
  // No enrollment, token issuance, c2 profile activation or second Owner service.
  const authority=new ApprovalReceiptAuthority();const lease=Object.freeze({sessionId:principal.subjectId,expiresAt:Date.now()+30000});let live=true;
  authority.setHumanClientAdmission({validLease:l=>live&&l===lease&&Date.now()<l.expiresAt,productionHuman:l=>live&&l===lease&&principal.role==='administrator'});
  const context=Object.freeze({});authority.bindHttpRequest(context,lease);let event=null;
  const delegate=({source,command},cancel=false)=>ownerRequest('/api/v2/agent/owner-delegation',{sourceRef:source.id,assistantSubjectId:env.JSO_ASSISTANT_SUBJECT_ID,command,cancel});
  const host=createConversationHost({config,fetchImpl:invocation.fetchImpl,authority,readNativeEvent:c=>c===context?event:null,journalPath:file,sessionCurrent:async()=>{live=await verify();return live;},delegate:r=>delegate(r),cancelDelegate:r=>delegate(r,true),
   refreshChart:async state=>{const {chartData,createChartCommand}=await import('./chart.mjs');const data=chartData(state,new Date().toISOString());return {ok:true,projection:{version:[state.revisions.scheduleRevision,state.revisions.projectionRevision],create:createChartCommand(data),data}};}});
  const p=args.payload||{};
  if(args.nativeAction==='status')return {ok:true,sequence:host.sequence()};
  if(args.nativeAction==='recover')return {ok:true,results:await host.recover()};
  if(typeof p.conversationId!=='string'||!p.conversationId||p.conversationId.length>240)return {ok:false,code:'CONVERSATION_REQUIRED'};
  if(args.nativeAction==='prepare'){
   if(typeof p.text!=='string'||p.text.length>4000||!/^native-[A-Za-z0-9-]{1,150}$/.test(p.messageId||'')||!Number.isSafeInteger(p.observedSequence))return {ok:false,code:'NATIVE_SOURCE_INVALID'};
   event=Object.freeze({...p});return {...await host.prepare(context,resource),sequence:host.sequence()};
  }
  if(args.nativeAction==='execute'){
   const s=host.source(p.sourceId);if(!s||s.conversationId!==p.conversationId)return {ok:false,code:'SOURCE_UNKNOWN'};event=Object.freeze({messageId:s.id,text:s.text,conversationId:s.conversationId,observedSequence:s.observedSequence});
   return {...await host.submit(context,resource),sequence:host.sequence()};
  }
  if(args.nativeAction==='propose')return {...await host.propose({...p,resourceId:resource}),sequence:host.sequence()};
  if(args.nativeAction==='presented')return {...host.presented(context,p),sequence:host.sequence()};
  if(args.nativeAction==='invalidate'){host.invalidateMessage(p.conversationId,p.messageId);return {ok:true,sequence:host.sequence()};}
 }finally{fs.rmdirSync(lock);}
}
module.exports={runNative};
