'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{fork}=require('node:child_process'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const options={skip:!process.env.JSO_TOOLBOX_SOURCE,timeout:15000};
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jso-stdio-race-')),children=new Set();let barrier=null,writes=0,delegations=0,receipt=null;
 t.after(()=>{for(const c of children)c.kill();fs.rmSync(root,{recursive:true,force:true});});
 const state={ok:true,businessSchemaVersion:12,activeConfig:{businessTimeZone:'Asia/Shanghai'},sessions:[{scheduleItemId:'A',resourceId:'R',plannedStart:'2040-01-01T01:00:00.000Z',plannedEnd:'2040-01-01T02:00:00.000Z'}],orders:[],progress:[],resources:[],revisions:{scheduleRevision:1,projectionRevision:1}};
 function pause(command){let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);barrier={command,enter,gate};return {entered,release};}
 function call(args){return new Promise((resolve,reject)=>{const child=fork(path.join(__dirname,'stdio-worker.fixture.cjs'),[],{stdio:['ignore','ignore','inherit','ipc']});children.add(child);child.on('exit',()=>children.delete(child));child.on('error',reject);child.on('message',async m=>{
  if(m.error)return reject(Error(m.error));if(m.done)return resolve(m.done);
  const command=m.type==='owner'?m.body.kind:m.args.command;
  if(barrier?.command===command){const b=barrier;barrier=null;b.enter();await b.gate;}
  const reply=value=>child.send({reply:m.id,value});
  if(m.type==='owner'){if(command==='owner-session')return reply({ok:true,role:'administrator',subjectId:'synthetic-owner',resourceIds:['R']});if(!m.body.payload.cancel)delegations++;return reply({ok:true,cancelled:!!m.body.payload.cancel});}
  const p=JSON.parse(m.args.payload_json);
  if(command==='read_state')return reply(state);
  if(command==='preview_shift')return reply({ok:true,before:state.sessions[0],command:{operationId:p.operationId,scheduleItemId:'A',resourceId:'R',plannedStart:'2040-01-01T01:07:00.000Z',plannedEnd:'2040-01-01T02:07:00.000Z',expectedScheduleRevision:1,expectedProjectionRevision:1,configDigest:'sha256:'+'a'.repeat(64)},commandDigest:'sha256:'+'b'.repeat(64)});
  if(command==='reschedule'){writes++;receipt={operationId:p.operationId};return reply({ok:true,receipt});}
  if(command==='read_receipt')return reply(receipt?{ok:true,receipt}:{ok:false,code:'OPERATION_NOT_FOUND'});
  reject(Error('unexpected '+command));
 });child.send({start:true,journal:path.join(root,'journal'),args});});}
 const prepare=(id,text)=>call({nativeAction:'prepare',payload:{messageId:id,conversationId:'C',observedSequence:0,text}});
 const execute=id=>call({nativeAction:'execute',payload:{sourceId:id,conversationId:'C'}});
 const cancel=async()=>{await prepare('native-cancel','取消');return execute('native-cancel');};
 return {call,prepare,execute,cancel,pause,writes:()=>writes,delegations:()=>delegations};
}
for(const command of ['read_state','preview_shift'])test(`cross-process cancel during ${command} prevents delegation and dispatch`,options,async t=>{
 const h=setup(t);await h.prepare('native-direct','把A延后7分钟');const b=h.pause(command),pending=h.execute('native-direct');await b.entered;
 const cancelled=await h.cancel();assert.ok(cancelled.cancelled>0);b.release();assert.equal((await pending).code,'CANCELLED');assert.equal((await h.execute('native-direct')).code,'CANCELLED');assert.equal(h.writes(),0);assert.equal(h.delegations(),0);
});
test('cross-process message invalidation supersedes pending proposal',options,async t=>{
 const h=setup(t),b=h.pause('preview_shift'),pending=h.call({nativeAction:'propose',payload:{conversationId:'C',messageId:'M',scheduleItemId:'A',minutes:7}});await b.entered;
 assert.equal((await h.call({nativeAction:'invalidate',payload:{conversationId:'C',messageId:'M'}})).ok,true);b.release();assert.equal((await pending).code,'PROPOSAL_SUPERSEDED');assert.equal(h.writes(),0);
});
test('authorization claim prevents duplicate execution and allows pre-dispatch cancellation',options,async t=>{
 const h=setup(t);await h.prepare('native-direct','把A延后7分钟');const b=h.pause('owner-delegation'),pending=h.execute('native-direct');await b.entered;
 assert.equal((await h.execute('native-direct')).code,'RECONCILIATION_REQUIRED');assert.ok((await h.cancel()).cancelled>0);b.release();assert.equal((await pending).code,'CANCELLED');assert.equal(h.writes(),0);assert.equal(h.delegations(),1);
});
test('after dispatch claim cancellation reconciles and never reports cancellation or resends',options,async t=>{
 const h=setup(t);await h.prepare('native-direct','把A延后7分钟');const b=h.pause('reschedule'),pending=h.execute('native-direct');await b.entered;
 const cancelled=await h.cancel();assert.equal(cancelled.cancelled,0);assert.equal(cancelled.reconciliation[0].code,'RECONCILIATION_REQUIRED');assert.equal((await h.execute('native-direct')).code,'RECONCILIATION_REQUIRED');b.release();assert.equal((await pending).committed,true);assert.equal((await h.execute('native-direct')).committed,true);assert.equal(h.writes(),1);assert.equal(h.delegations(),1);
});
