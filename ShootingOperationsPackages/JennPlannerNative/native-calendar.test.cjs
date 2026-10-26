'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm'),{EventEmitter}=require('node:events'),{pathToFileURL}=require('node:url');
const {createCalendar}=require('./main.cjs'),calendar=require('./assets.cjs')(),{stage}=require('./stage-client.cjs');
const viewId='00000000-0000-4000-8000-000000000005';
const chatRoot=path.resolve(process.env.JSO_CHART_TEST_CHAT_ROOT||path.resolve(__dirname,'../../../chat-http-baseline'));
async function fixture(t,priorChange={},nextChange={},sourceChange={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jso-native-context-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const base={ok:true,source:'JSO',projectionFormat:3,ownerBinding:'["synthetic-owner",["R"]]',businessToday:'2040-01-01',writeAdmission:'enabled',revisions:{scheduleRevision:5,projectionRevision:8},orders:[],sessions:[],progress:[],resources:[]};
 let prior={...structuredClone(base),...priorChange},next={...structuredClone(base),activeConfig:{businessTimeZone:'Asia/Shanghai'},...nextChange},dataRevision=2,writes=0,applyCalls=0,applyResponse=()=>({ok:false,code:'SYNTHETIC_NO_WRITE'});
 const events=[],wc=new EventEmitter();wc.id=1;wc.getURL=()=>pathToFileURL(path.join(chatRoot,'Chartmodules/chart.html')).href;wc.executeJavaScript=async code=>vm.runInNewContext(code,{window:{__jsoChartEditor:{viewId,receive:m=>events.push(m),proof:()=>{const p=events.findLast(x=>x.kind==='preview');return {eligible:Boolean(p?.previewId),text:p?.previewId,conversationId:viewId};}}},document:{querySelector:()=>({textContent:events.findLast(x=>x.kind==='preview')?.presentation})}});
 const win={webContents:wc,isDestroyed:()=>false,isFocused:()=>true},service=new EventEmitter();
 service.readManifest=async()=>({id:'jso-calendar-isolated',codeRevision:1,dataRevision});service.readData=async()=>structuredClone(prior);
 const sourceHashes={...calendar.hashes,...sourceChange};let sourceEdits=0,codeRevision=1;
 service.getSource=async(_id,kind)=>({hash:sourceHashes[kind],codeRevision});
 service.editSource=async(id,edit)=>{assert.equal(id,'jso-calendar-isolated');assert.equal(edit.expectedCodeRevision,codeRevision);assert.equal(edit.file,'runtime');assert.equal(edit.content,calendar.runtime);sourceHashes.runtime=require('node:crypto').createHash('sha256').update(edit.content).digest('hex');sourceEdits++;codeRevision++;};
 service.replaceData=async(id,data,options)=>{assert.equal(id,'jso-calendar-isolated');assert.equal(options.expectedDataRevision,dataRevision);prior=structuredClone(data);dataRevision++;writes++;};
 const input={scheduleItemId:'S',resourceId:'R',mode:'plan',plannedStart:'2040-01-01T01:15:00.000Z',endAt:'2040-01-01T01:45:00.000Z',bufferAfterMinutes:20};
 const client={call:async(action,body)=>{
  if(action==='snapshot')return {ok:true,state:next};
  if(action==='preview')return {ok:true,subjectId:'synthetic-owner',previewDigest:'sha256:'+'a'.repeat(64),preview:{canApply:true,input,expectedScheduleRevision:next.revisions.scheduleRevision,expectedProjectionRevision:next.revisions.projectionRevision,changes:[{before:{scheduleItemId:'S',plannedStart:'2040-01-01T01:00:00.000Z',plannedEnd:'2040-01-01T01:30:00.000Z',bufferAfterMinutes:20},after:{scheduleItemId:'S',plannedStart:input.plannedStart,plannedEnd:input.endAt,bufferAfterMinutes:20}}],warnings:[],unresolved:[]}};
  if(action==='apply'){applyCalls++;return applyResponse(body);}
  throw Error('UNEXPECTED_ACTION');
 }};
 const app=new EventEmitter(),editor=await createCalendar({chartService:service,projectBasePath:path.join(chatRoot,'VCPDistributedServer'),config:{},app,BrowserWindow:{getAllWindows:()=>[win]},client,stateRoot:root});t.after(()=>editor.shutdown());
 const handle=payload=>editor.handle({chartId:'jso-calendar-isolated',name:'jso-editor',payload:{viewId,...payload}});
 return {editor,handle,events,input,root,set(change){next={...next,...change};},data:()=>structuredClone(prior),writes:()=>writes,sourceEdits:()=>sourceEdits,applyCalls:()=>applyCalls,setApply:fn=>{applyResponse=fn;},pressEnter:()=>wc.emit('before-input-event',{}, {type:'keyDown',key:'Enter',shift:false,isComposing:false,isAutoRepeat:false})};
}
test('only exact previous native calendar migrates through revision-checked source editing',async t=>{
 const f=await fixture(t,{}, {},{runtime:'353707eee8dd5487f566bf71795cf71dd0be0c6e2a30fcd4c263e4e1d191be76'});
 assert.equal(f.sourceEdits(),1);assert.equal(f.writes(),0);assert.equal(f.applyCalls(),0);
 await f.editor.refresh();assert.equal(f.sourceEdits(),1);
});
test('custom runtime or changed template/style refuses native migration',async t=>{
 for(const source of [{runtime:'a'.repeat(64)},{runtime:'353707eee8dd5487f566bf71795cf71dd0be0c6e2a30fcd4c263e4e1d191be76',template:'b'.repeat(64)},{runtime:'353707eee8dd5487f566bf71795cf71dd0be0c6e2a30fcd4c263e4e1d191be76',style:'c'.repeat(64)}])await assert.rejects(fixture(t,{}, {},source),/CALENDAR_SOURCE_MISMATCH/);
});
for(const [name,change] of [['business date',{businessToday:'2040-01-02'}],['write admission',{writeAdmission:'disabled'}],['Owner binding',{ownerBinding:'["different-owner",["R"]]'}]])test(`same revisions refresh changed ${name}`,async t=>{
 const f=await fixture(t,{},change);assert.equal(f.writes(),1);for(const [key,value] of Object.entries(change))assert.equal(f.data()[key],value);
});
test('unchanged context avoids redundant data writes and older same-Owner facts cannot overwrite newer projection',async t=>{
 const f=await fixture(t);assert.equal(f.writes(),0);await f.editor.refresh();assert.equal(f.writes(),0);
 f.set({businessToday:'2040-01-02',revisions:{scheduleRevision:4,projectionRevision:7}});await f.editor.refresh();assert.equal(f.writes(),0);assert.equal(f.data().businessToday,'2040-01-01');
});
for(const [name,change] of [['date',{businessToday:'2040-01-02'}],['admission',{writeAdmission:'disabled'}],['Owner',{ownerBinding:'["different-owner",["R"]]'}]])test(`changed ${name} invalidates old preview before Save`,async t=>{
 const f=await fixture(t);await f.handle({kind:'ready'});await f.handle({kind:'preview',requestId:'request',input:f.input,baseRevisions:{scheduleRevision:5,projectionRevision:8}});
 const preview=f.events.findLast(e=>e.kind==='preview');assert.equal(preview.ok,true);assert.equal(preview.canApply,true);
 f.set(change);await f.editor.refresh();await f.handle({kind:'save',previewId:preview.previewId});assert.equal(f.applyCalls(),0);assert.ok(f.events.some(e=>e.kind==='result'&&/预览、身份或保存状态已变化/.test(e.message)));
});
test('native Save still requires a real input proof; renderer intent alone never dispatches apply',async t=>{
 const f=await fixture(t);await f.handle({kind:'ready'});await f.handle({kind:'preview',requestId:'request',input:f.input,baseRevisions:{scheduleRevision:5,projectionRevision:8}});const preview=f.events.findLast(e=>e.kind==='preview');
 await f.handle({kind:'save',previewId:preview.previewId});assert.equal(f.applyCalls(),0);assert.ok(f.events.some(e=>e.kind==='result'&&/实际点击保存按钮/.test(e.message)));assert.equal(fs.existsSync(path.join(f.root,'pending.json')),false);
});
test('staged plugin has a self-contained validated calendar and shared host, never writes config or an existing destination',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'jso-native-stage-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const target=stage(path.join(root,'new'));
 assert.equal(require(path.join(target,'plugin-manifest.json')).name,'JennPlannerNative');assert.equal(typeof require(path.join(target,'service.cjs')).initialize,'function');
 assert.deepEqual(require(path.join(target,'bundle/JennPlannerNative/assets.cjs'))().hashes,calendar.hashes);assert.equal(fs.existsSync(path.join(target,'config.env')),false);assert.throws(()=>stage(target),/DESTINATION_MUST_BE_NEW/);
 fs.appendFileSync(path.join(target,'bundle/JennPlannerNative/artifact/runtime.js'),'\n/* tampered synthetic copy */');assert.throws(()=>require(path.join(target,'bundle/JennPlannerNative/assets.cjs'))(),/CALENDAR_ARTIFACT_MISMATCH/);
});

test('acknowledged native receipt establishes a revision floor and cannot be replaced by a stale post-save read',async t=>{
 const f=await fixture(t);await f.handle({kind:'ready'});await f.handle({kind:'preview',requestId:'request',input:f.input,baseRevisions:{scheduleRevision:5,projectionRevision:8}});const preview=f.events.findLast(e=>e.kind==='preview');
 f.setApply(c=>({ok:true,receipt:{operationId:c.operationId,kind:'dynamic-day-adjustment',actor:{subjectId:c.subjectId},previewDigest:c.previewDigest,scheduleRevision:6,projectionRevision:9}}));f.pressEnter();await f.handle({kind:'save',previewId:preview.previewId});assert.equal(f.applyCalls(),1);assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'pending.json'))),null);
 assert.ok(f.events.some(e=>e.kind==='result'&&/已确认保存，暂未取回最新显示/.test(e.message)));
 f.set({revisions:{scheduleRevision:6,projectionRevision:9}});await f.editor.refresh();const writes=f.writes();assert.equal(f.data().revisions.scheduleRevision,6);
 f.set({businessToday:'2040-01-02',revisions:{scheduleRevision:5,projectionRevision:8}});await f.editor.refresh();assert.equal(f.writes(),writes);assert.equal(f.data().revisions.scheduleRevision,6);assert.equal(f.data().businessToday,'2040-01-01');
});
test('wrong-Owner successful response stays unknown, retains the original journal and does not allow another preview/write',async t=>{
 const f=await fixture(t);await f.handle({kind:'ready'});await f.handle({kind:'preview',requestId:'request',input:f.input,baseRevisions:{scheduleRevision:5,projectionRevision:8}});const preview=f.events.findLast(e=>e.kind==='preview');
 f.setApply(c=>({ok:true,receipt:{operationId:c.operationId,kind:'dynamic-day-adjustment',actor:{subjectId:'different-owner'},previewDigest:c.previewDigest,scheduleRevision:6,projectionRevision:9}}));f.pressEnter();await f.handle({kind:'save',previewId:preview.previewId});assert.equal(f.applyCalls(),1);const journal=JSON.parse(fs.readFileSync(path.join(f.root,'pending.json')));assert.equal(journal.command.subjectId,'synthetic-owner');assert.match(journal.command.operationId,/^CHART-/);assert.ok(f.events.some(e=>e.kind==='result'&&e.unknown));
 await f.handle({kind:'preview',requestId:'different-request',input:f.input,baseRevisions:{scheduleRevision:5,projectionRevision:8}});assert.equal(f.applyCalls(),1);assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'pending.json'))).command.operationId,journal.command.operationId);
});
