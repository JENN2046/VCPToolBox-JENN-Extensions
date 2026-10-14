'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createConversationHost}=require('./host.cjs');
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
