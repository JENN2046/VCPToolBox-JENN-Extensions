'use strict';
const {randomUUID}=require('node:crypto');const {Journal}=require('./journal.cjs');
const fail=(code,extra={})=>({ok:false,code,...extra});
// A deliberately bounded first action, not a general natural-language authority prover.
// Exact order/session label + numeric minutes; conditions/quotes/composite actions fall through.
function parseShift(text){const match=/^把(.+?)(?:的场次|场次)?(延后|推迟|提前)([1-9][0-9]{0,3})分钟[。！!]?$/u.exec(text.trim());if(!match)return null;const name=match[1];if(/[“”"「」\n]|如果|但是|但|不要|取消|并且|然后|同时/u.test(name))return null;return {name,minutes:Number(match[3])*(match[2]==='提前'?-1:1)};}
class ConversationService{
 constructor({journalPath,tool,ownerAuthorize,ownerCancel,verifyOwner,refreshChart,clock=()=>new Date()}){this.journal=new Journal(journalPath);this.tool=tool;this.ownerAuthorize=ownerAuthorize;this.ownerCancel=ownerCancel;this.verifyOwner=verifyOwner;this.refreshChart=refreshChart;this.clock=clock;this.inflight=new Map();this.previewVersions=new Map();this.conversationVersions=new Map();}
 // Only the trusted native input owner calls this. Never expose capture over model IPC/HTTP.
 captureNative(source){return this.journal.source(source);}
 async call(action,payload){const r=await this.tool({command:action,payload_json:JSON.stringify(payload)});const value=r?.result??r;if(typeof value?.ok!=='boolean')throw Error('SERVICE_RESULT_INVALID');return value;}
 async read(resourceId){return this.call('read_state',{resourceScope:[resourceId]});}
 async submit(sourceId,resourceId){
  const source=this.journal.data.sources[sourceId];if(!source)return fail('TRUSTED_SOURCE_REQUIRED');
  if(!await this.verifyOwner())return fail('OWNER_SESSION_REQUIRED');
  if(source.operationId)return this.execute(source.operationId);
  if(source.cancelled)return fail('CANCELLED');
  const text=source.text.trim().replace(/[。！!]$/u,'');
  const plans=Object.values(this.journal.data.plans).filter(p=>p.conversationId===source.conversationId&&!p.closed);
  if(['取消','不要','不用了','不同意'].includes(text)){this.invalidateConversation(source.conversationId);for(const prior of Object.values(this.journal.data.sources))if(prior.conversationId===source.conversationId&&prior.sequence<source.sequence&&!prior.operationId)prior.cancelled=true;this.journal.save();const active=Object.values(this.journal.data.operations).filter(o=>this.journal.data.sources[o.sourceId]?.conversationId===source.conversationId&&!['failed','cancelled','committed'].includes(o.phase));const results=await Promise.all(active.map(o=>this.cancel(o.id)));return {ok:true,cancelled:plans.length+results.filter(r=>r.cancelled).length,reconciliation:results.filter(r=>!r.cancelled)};}
  if(['可以','同意','执行吧'].includes(text)){
   if(plans.length!==1)return fail('AMBIGUOUS_CONFIRMATION',{message:plans.length?'请说明确认哪一个方案。':'当前没有待确认方案。'});
   const plan=plans[0];if(!plan.presented)return fail('PROPOSAL_NOT_PRESENTED');
   if(source.observedSequence!==undefined?source.observedSequence<plan.presentedSequence:source.sequence<=plan.presentedSequence)return fail('CONFIRMATION_PREDATES_PRESENTATION');
   if(plan.expiresAt<=this.clock().getTime())return fail('PROPOSAL_EXPIRED');
   const operation=this.journal.bind(sourceId,plan.proposal);plan.closed=true;this.journal.save();return this.execute(operation.id);
  }
  if(plans.length&&/^(可以|同意|不要|不同意|取消|改成|改为)/u.test(text)){this.invalidateConversation(source.conversationId);return fail('NEEDS_CLARIFICATION',{message:'原方案已关闭。请说明场次名称，以及新的提前或延后分钟数。'});}
  let intent=parseShift(text);
  const follow=/^再(延后|推迟|提前)([1-9][0-9]{0,3})分钟$/u.exec(text);
  if(follow){const prior=Object.values(this.journal.data.operations).filter(o=>o.phase==='committed'&&this.journal.data.sources[o.sourceId]?.conversationId===source.conversationId).at(-1);if(prior)intent={name:prior.proposal.command.scheduleItemId,minutes:Number(follow[2])*(follow[1]==='提前'?-1:1)};}
  if(!intent)return fail('NEEDS_CLARIFICATION',{message:'请说明场次名称，以及提前或延后多少分钟。'});
  const state=await this.read(resourceId);if(source.cancelled)return fail('CANCELLED');if(!state.ok)return state;
  const matches=state.sessions.filter(s=>s.scheduleItemId===intent.name||state.progress?.find(p=>p.scheduleItemId===s.scheduleItemId)?.requestIds.some(id=>state.orders?.some(o=>o.id===id&&(o.name===intent.name||o.id===intent.name))));
  if(matches.length!==1)return fail('AMBIGUOUS_TARGET',{message:'请明确要调整的场次。'});
  const session=matches[0];
  const operationId='JSOCHAT-'+randomUUID();
  const proposal=await this.call('preview_shift',{operationId,scheduleItemId:session.scheduleItemId,resourceId,minutes:intent.minutes,
   expectedScheduleRevision:state.revisions.scheduleRevision,expectedProjectionRevision:state.revisions.projectionRevision});
  if(source.cancelled)return fail('CANCELLED');
  if(!proposal.ok)return proposal;
  return this.execute(this.journal.bind(sourceId,proposal).id);
 }
 async propose({conversationId,resourceId,scheduleItemId,minutes,messageId=null}){
  const key=JSON.stringify([conversationId,messageId]);
  const version=(this.previewVersions.get(key)||0)+1;this.previewVersions.set(key,version);
  const conversationVersion=this.conversationVersions.get(conversationId)||0;this.conversationVersions.set(conversationId,conversationVersion);
  const superseded=()=>conversationVersion!==(this.conversationVersions.get(conversationId)||0)||(messageId!==null&&version!==this.previewVersions.get(key));
  if(messageId){const previous=Object.values(this.journal.data.plans).filter(p=>p.conversationId===conversationId&&p.messageId===messageId);for(const p of previous){if(!p.closed&&p.proposal.command.scheduleItemId===scheduleItemId&&p.minutes===minutes)return {ok:true,plan:p};p.closed=true;}this.journal.save();}
  const state=await this.read(resourceId);if(superseded())return fail('PROPOSAL_SUPERSEDED');if(!state.ok)return state;
  const proposal=await this.call('preview_shift',{operationId:'JSOCHAT-'+randomUUID(),scheduleItemId,resourceId,minutes,...{expectedScheduleRevision:state.revisions.scheduleRevision,expectedProjectionRevision:state.revisions.projectionRevision}});
  if(superseded())return fail('PROPOSAL_SUPERSEDED');
  if(!proposal.ok)return proposal;
  const session=state.sessions.find(s=>s.scheduleItemId===scheduleItemId);
  const names=state.orders.filter(o=>state.progress.find(p=>p.scheduleItemId===scheduleItemId)?.requestIds.includes(o.id)).map(o=>o.name).join('、');
  const time=v=>new Date(v).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  const presentation=`排期调整方案：${names||scheduleItemId} · ${state.resources.find(r=>r.resourceId===resourceId)?.displayName||resourceId}\n北京时间：${time(session.plannedStart)} — ${time(session.plannedEnd)} → ${time(proposal.command.plannedStart)} — ${time(proposal.command.plannedEnd)}\n${minutes>0?'延后':'提前'} ${Math.abs(minutes)} 分钟；仅调整此场次，其他场次不变，不发送通知。\n方案有效期5分钟。可回复“可以”执行，回复“取消”关闭，或说明新的调整。`;
  const plan={id:randomUUID(),conversationId,messageId,minutes,presentation,proposal,presented:false,closed:false,expiresAt:this.clock().getTime()+300000};this.journal.data.plans[plan.id]=plan;this.journal.save();return {ok:true,plan};
 }
 markPresented(planId,conversationId,commandDigest){const p=this.journal.data.plans[planId];if(!p||p.conversationId!==conversationId||p.proposal.commandDigest!==commandDigest)throw Error('PRESENTATION_MISMATCH');if(p.closed)throw Error('PROPOSAL_CLOSED');if(!p.presented){p.presented=true;p.presentedSequence=this.journal.tick();}this.journal.save();}
 invalidateMessage(conversationId,messageId){const key=JSON.stringify([conversationId,messageId]);this.previewVersions.set(key,(this.previewVersions.get(key)||0)+1);for(const p of Object.values(this.journal.data.plans))if(p.conversationId===conversationId&&p.messageId===messageId)p.closed=true;this.journal.save();}
 invalidateConversation(conversationId){this.conversationVersions.set(conversationId,(this.conversationVersions.get(conversationId)||0)+1);for(const p of Object.values(this.journal.data.plans))if(p.conversationId===conversationId)p.closed=true;this.journal.save();}
 async cancel(operationId){const r=this.journal.data.operations[operationId];if(!r)return fail('OPERATION_NOT_FOUND');if(['dispatching','unknown','committed'].includes(r.phase))return this.reconcile(r);r.cancelled=true;r.phase='cancelled';this.journal.save();await this.ownerCancel?.(r);return {ok:true,cancelled:true};}
 execute(id){if(this.inflight.has(id))return this.inflight.get(id);const p=this.executeOnce(id).finally(()=>this.inflight.delete(id));this.inflight.set(id,p);return p;}
 async reconcile(r){const found=await this.call('read_receipt',{operationId:r.id});if(found.ok&&found.receipt?.operationId===r.id){r.phase='committed';r.receipt=found.receipt;this.journal.save();return this.finish(r);}return fail('RECONCILIATION_REQUIRED',{operationId:r.id,receiptCode:found.code});}
 async recover(){const results=[];for(const r of Object.values(this.journal.data.operations)){if(['dispatching','unknown'].includes(r.phase))results.push(await this.reconcile(r));}return results;}
 async finish(r){let chart={ok:false,code:'REFRESH_NOT_ATTEMPTED'};try{const state=await this.read(r.proposal.command.resourceId);if(state.ok)chart=await this.refreshChart(state);}catch{}return {ok:true,committed:true,operationId:r.id,receipt:r.receipt,chart};}
 async executeOnce(id){
  const r=this.journal.data.operations[id];if(!r)return fail('OPERATION_NOT_FOUND');
  if(r.phase==='committed')return this.finish(r);
  if(r.phase==='failed')return fail(r.failure,{operationId:r.id});
  if(['dispatching','unknown'].includes(r.phase))return this.reconcile(r);
  if(r.cancelled||r.phase==='cancelled')return fail('CANCELLED');
  if(!await this.verifyOwner())return fail('OWNER_SESSION_REQUIRED');
  let admitted;try{admitted=await this.ownerAuthorize(r);}catch{return fail('AUTHORIZATION_UNAVAILABLE');}
  if(r.cancelled)return fail('CANCELLED');
  if(!admitted.ok){if(admitted.code==='RECONCILIATION_REQUIRED')return this.reconcile(r);return admitted;}
  r.phase='dispatching';this.journal.save();
  let result;try{result=await this.call('reschedule',r.proposal.command);}catch{result=fail('RESULT_UNKNOWN');}
  if(result.ok&&result.receipt?.operationId!==r.id)result=fail('RESULT_UNKNOWN');
  if(result.ok){r.phase='committed';r.receipt=result.receipt;this.journal.save();return this.finish(r);}
  if(!result.code)result=fail('RESULT_UNKNOWN');
  r.phase=['RESULT_UNKNOWN','RECONCILIATION_REQUIRED','SERVICE_UNAVAILABLE'].includes(result.code)?'unknown':'failed';r.failure=result.code;this.journal.save();
  if(['RESULT_UNKNOWN','RECONCILIATION_REQUIRED','SERVICE_UNAVAILABLE'].includes(result.code))return this.reconcile(r);
  return fail(result.code,{operationId:r.id});
 }
}
module.exports={ConversationService,parseShift};
