'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createConversationHost}=require('./host.cjs');
test('full adoption rechecks current scope, preview and expiry before delegation; tampering cannot widen it',async t=>{
 const {digest}=require('./operations.cjs');
 for(const mode of ['ok','scope-narrowed','preview-changed','journal-tampered','expired','wrong-receipt','lookup-unscoped','lookup-wrong-kind','lookup-wrong-scope']){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jso-adopt-host-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const journalPath=path.join(dir,'journal.json'),context={},events=new WeakMap();let writes=0,delegations=0,now=100000;
  const item={proposalItemId:'spi_'+'1'.repeat(64),requestId:'SYNTHETIC',resourceId:'R1',plannedStart:'2040-01-01T01:00:00.000Z',plannedEnd:'2040-01-01T01:30:00.000Z'};
  const preview={proposalId:'proposal',proposedItems:[item],baseScheduleRevision:0,configVersion:'c1',inputDigest:'sha256:'+'a'.repeat(64),resultDigest:'sha256:'+'b'.repeat(64),configDigest:'sha256:'+'c'.repeat(64)};
  let generated=0,receipt;
  const fetchImpl=async(_url,opt)=>{const a=JSON.parse(opt.body),p=JSON.parse(a.payload_json);let result;
   if(a.command==='read_state')result={ok:true,orders:[{id:'SYNTHETIC',name:'synthetic/non-customer'}],revisions:{scheduleRevision:0,projectionRevision:0}};
   if(a.command==='generate_proposal'){generated++;result={ok:true,preview:{...preview,generationCommand:p,...(generated>1&&mode==='preview-changed'?{inputDigest:'sha256:'+'d'.repeat(64)}:{})}};}
   if(a.command==='adopt_proposal'){writes++;const d=p.decision;receipt={...d,decisionCommandDigest:digest({domain:'scheduling-proposal-decision-command-v1',proposalId:d.proposalId,decisionType:d.decisionType,selectedProposalItemIds:d.selectedProposalItemIds,decisionNote:d.decisionNote,reasonCode:d.reasonCode}),adoptedItems:[{proposalItemId:item.proposalItemId,scheduleItemId:'SESSION'}]};if(mode==='wrong-receipt')receipt.proposalId='WRONG';if(mode.startsWith('lookup-'))throw Error('synthetic committed reply lost');result={ok:true,receipt};}
   if(a.command==='read_receipt'){result={ok:true,kind:'proposalDecision',resourceScope:['R1'],receipt};if(mode==='lookup-unscoped'){delete result.kind;delete result.resourceScope;}if(mode==='lookup-wrong-kind')result.kind='reschedule';if(mode==='lookup-wrong-scope')result.resourceScope=['OTHER'];}
   return {status:200,json:async()=>result};
  };
  const authority={isHuman:c=>c===context,snapshot:()=>({argsDigest:'digest'}),attestIntent:()=>({}),approve:()=>({}),bindInvocation(){},verifyAuthorization:()=>({}),finishInvocation(){}};
  const make=requestIds=>createConversationHost({config:{endpoint:'http://127.0.0.1:1/api/v2/agent/tools',token:'x'.repeat(40),resources:['R1'],requestIds,policy:'native-direct-and-confirm',maxMinutes:240},authority,readNativeEvent:c=>events.get(c),sessionCurrent:async()=>true,journalPath,delegate:async r=>{assert.equal(r.action,'adopt_proposal');delegations++;return {ok:true};},cancelDelegate:async()=>({ok:true}),refreshChart:async()=>({ok:true}),fetchImpl,clock:()=>new Date(now)});
  let host=make(['SYNTHETIC']);const planned=await host.propose({action:'adopt_proposal',conversationId:'C',messageId:'M',resourceId:'R1',planningWindowStart:'2040-01-01T00:00:00.000Z',planningWindowEnd:'2040-01-02T00:00:00.000Z'});assert.equal(planned.ok,true,mode);
  assert.equal(host.presented(context,{planId:planned.plan.id,conversationId:'C',text:planned.plan.presentation}).ok,true);
  if(mode==='scope-narrowed')host=make(['OTHER']);
  if(mode==='journal-tampered'){const data=JSON.parse(fs.readFileSync(journalPath));data.plans[planned.plan.id].proposal.items[0].plannedStart='2040-01-01T02:00:00.000Z';fs.writeFileSync(journalPath,JSON.stringify(data));host=make(['SYNTHETIC']);}
  if(mode==='expired')now+=300000;
  events.set(context,{messageId:'native-confirm',conversationId:'C',text:'可以',observedSequence:host.sequence()});
  const done=await host.submit(context,'R1');
  if(['ok','wrong-receipt'].includes(mode)||mode.startsWith('lookup-')){assert.equal(writes,1);assert.equal(delegations,1);if(mode==='ok')assert.equal(done.committed,true);else assert.equal(done.code,'RECONCILIATION_REQUIRED');}
  else{assert.equal(done.ok,false,mode);assert.equal(writes,0,mode);assert.equal(delegations,0,mode);}
 }
});
test('restored proposals and prepared operations obey current limit; unknown operations only read original receipt',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jso-limits-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
 const journalPath=path.join(dir,'journal.json'),events=new WeakMap(),context={};let writes=0,delegations=0,reads=0;
 const before={plannedStart:'2026-10-14T01:00:00Z',plannedEnd:'2026-10-14T02:00:00Z'};
 const authority={isHuman:c=>c===context,snapshot:()=>({argsDigest:'digest'}),attestIntent:()=>({}),approve:()=>({}),bindInvocation(){},verifyAuthorization:()=>({}),finishInvocation(){}};
 const fetchImpl=async(_url,opt)=>{const a=JSON.parse(opt.body),p=JSON.parse(a.payload_json);let result;
 if(a.command==='read_state')result={ok:true,sessions:[{scheduleItemId:'A',...before}],orders:[],progress:[],resources:[],revisions:{scheduleRevision:1,projectionRevision:1}};
 if(a.command==='preview_shift')result={ok:true,before,command:{...p,plannedStart:'2026-10-14T01:30:00Z',plannedEnd:'2026-10-14T02:30:00Z'},commandDigest:'synthetic'};
 if(a.command==='reschedule'){writes++;result={ok:true,receipt:{operationId:p.operationId}};}
 if(a.command==='read_receipt'){reads++;result={ok:true,kind:'reschedule',receipt:{operationId:p.operationId,resourceId:'R1'}};}
 return {status:200,json:async()=>result};};
 const make=maxMinutes=>createConversationHost({config:{endpoint:'http://127.0.0.1:1/api/v2/agent/tools',token:'x'.repeat(40),resources:['R1'],policy:'native-direct-and-confirm',maxMinutes},authority,readNativeEvent:c=>events.get(c),sessionCurrent:async()=>true,journalPath,delegate:async()=>{delegations++;return {ok:true};},cancelDelegate:async()=>({ok:true}),refreshChart:async()=>({ok:true}),fetchImpl});
 const first=make(240),p=await first.propose({conversationId:'C',messageId:'model',resourceId:'R1',scheduleItemId:'A',minutes:30});first.presented(context,{planId:p.plan.id,conversationId:'C',text:p.plan.presentation});
 const narrowed=make(5);events.set(context,{messageId:'confirm',conversationId:'C',text:'可以',observedSequence:narrowed.sequence()});assert.equal((await narrowed.submit(context,'R1')).code,'SHIFT_LIMIT');
 assert.equal((await make(5).submit(context,'R1')).code,'SHIFT_LIMIT');assert.equal(writes,0);assert.equal(delegations,0);
 const journal=JSON.parse(fs.readFileSync(journalPath));const operation=Object.values(journal.operations)[0];operation.phase='unknown';fs.writeFileSync(journalPath,JSON.stringify(journal));
 const recovered=await make(5).submit(context,'R1');assert.equal(recovered.committed,true);assert.equal(recovered.operationId,operation.id);assert.equal(reads,1);assert.equal(writes,0);assert.equal(delegations,0);
 // A fresh still-valid proposal may execute within the current limit.
 fs.rmSync(journalPath);const allowed=make(30),q=await allowed.propose({conversationId:'C',messageId:'model2',resourceId:'R1',scheduleItemId:'A',minutes:30});allowed.presented(context,{planId:q.plan.id,conversationId:'C',text:q.plan.presentation});events.set(context,{messageId:'confirm2',conversationId:'C',text:'可以',observedSequence:allowed.sequence()});assert.equal((await allowed.submit(context,'R1')).committed,true);assert.equal(writes,1);assert.equal(delegations,1);
 fs.rmSync(journalPath);events.set(context,{messageId:'direct',conversationId:'C',text:'把A延后30分钟'});assert.equal((await make(5).submit(context,'R1')).code,'SHIFT_LIMIT');
 const directJournal=JSON.parse(fs.readFileSync(journalPath)),direct=Object.values(directJournal.operations)[0];direct.phase='unknown';fs.writeFileSync(journalPath,JSON.stringify(directJournal));assert.equal((await make(5).submit(context,'R1')).operationId,direct.id);assert.equal(reads,2);assert.equal(writes,1);assert.equal(delegations,1);
});
