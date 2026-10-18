'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{EventEmitter}=require('node:events'),{createHash,randomUUID}=require('node:crypto');
const {JSDOM}=require(process.env.JSO_TEST_DEPENDENCIES?process.env.JSO_TEST_DEPENDENCIES+'/jsdom':'jsdom');
const {createEditor,KNOWN_RUNTIME_HASHES}=require('./main.cjs');
const viewId='00000000-0000-4000-8000-000000000005';
const state={ok:true,revisions:{scheduleRevision:1,projectionRevision:2},orders:[],progress:[],sessions:[],resources:[]};
async function host(t,oldRuntime=false){
 const {runtime}=await import('./runtime.mjs'),root=fs.mkdtempSync(path.join(os.tmpdir(),'jso-read-status-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const projectBasePath=path.resolve(process.env.JSO_CHART_TEST_CHAT_ROOT||path.resolve(__dirname,'../../../chat-http-baseline'),'VCPDistributedServer');
 const events=[],calls=[];let response={ok:true,state},destroyed=false,replacements=0,upgrades=0,projectionGate=null;
 const wc=new EventEmitter();wc.id=1;wc.getURL=()=>require('node:url').pathToFileURL(path.resolve(projectBasePath,'../Chartmodules/chart.html')).href;
 wc.executeJavaScript=async code=>vm.runInNewContext(code,{window:{__jsoChartEditor:{viewId,receive:m=>events.push(m)}}});
 const win={webContents:wc,isDestroyed:()=>destroyed,isFocused:()=>true},service=new EventEmitter();
 service.readManifest=async()=>({dataRevision:1});service.readData=async()=>({...state,projectionFormat:2});
 service.getSource=async()=>({hash:oldRuntime==='custom'?'c'.repeat(64):oldRuntime?'854bed0931c51e827cc4369a417d4a1a818738e9e218592c5b7ca685952ebbd5':createHash('sha256').update(runtime).digest('hex'),codeRevision:1});
 service.editSource=async()=>{upgrades++;oldRuntime=false;};service.replaceData=async()=>{replacements++;const gate=projectionGate;projectionGate=null;if(gate){gate.enter();await gate.wait;}};
 const app=new EventEmitter(),client={call:async action=>{calls.push(action);return typeof response==='function'?response():response;}};
 const editor=await createEditor({chartService:service,projectBasePath,config:{},app,BrowserWindow:{getAllWindows:()=>[win]},client,stateRoot:root});t.after(()=>editor.shutdown());
 await editor.handle({chartId:'jso-local-candidate',name:'jso-editor',payload:{kind:'ready',viewId}});
 return {editor,events,calls,status:()=>events.filter(m=>m.kind==='read-status').at(-1),set:r=>{response=r;},holdProjection(){let enter,release,fail;const entered=new Promise(r=>enter=r),wait=new Promise((resolve,reject)=>{release=resolve;fail=reject;});projectionGate={enter,wait};return {entered,release,fail};},counts:()=>({replacements,upgrades}),close(){destroyed=true;wc.emit('destroyed');}};
}
test('read status advances only on success, including unchanged revisions; failures and access rejection retain facts/time',async t=>{
 const f=await host(t),first=f.status();assert.equal(first.status,'current');assert.ok(Number.isFinite(Date.parse(first.lastReadAt)));
 for(const code of ['CHART_SERVICE_UNAVAILABLE','TRANSPORT_AUTH_REQUIRED','APPLICATION_SESSION_REQUIRED']){
  f.set({ok:false,code});await f.editor.refresh();assert.equal(f.status().status,code==='CHART_SERVICE_UNAVAILABLE'?'unavailable':'denied');assert.equal(f.status().lastReadAt,first.lastReadAt);
 }
 f.set(()=>{throw Error('network');});await f.editor.refresh();assert.equal(f.status().status,'unavailable');assert.equal(f.status().lastReadAt,first.lastReadAt);
 await new Promise(r=>setTimeout(r,3));f.set({ok:true,state});await f.editor.refresh();assert.equal(f.status().status,'current');assert.ok(Date.parse(f.status().lastReadAt)>Date.parse(first.lastReadAt));
 assert.deepEqual(f.counts(),{replacements:0,upgrades:0});assert.ok(f.calls.every(c=>c==='snapshot'));
});
test('closed view gets no late read status; known PR20 editor upgrades without widening custom-runtime matching',async t=>{
 const f=await host(t,true);assert.equal(f.counts().upgrades,1);assert.ok(KNOWN_RUNTIME_HASHES.includes('854bed0931c51e827cc4369a417d4a1a818738e9e218592c5b7ca685952ebbd5'));
 let release,closed=false;f.set(()=>new Promise(r=>release=r));const flight=f.editor.refresh({isCurrent:()=>!closed});await new Promise(r=>setImmediate(r));const count=f.events.length;closed=true;f.close();release({ok:true,state});await flight;assert.equal(f.events.length,count);
 const custom=await host(t,'custom');assert.equal(custom.counts().upgrades,0);
});
test('late projection completion cannot hide a more recent read failure',async t=>{
 const f=await host(t),gate=f.holdProjection();f.set({ok:true,state:{...state,revisions:{scheduleRevision:2,projectionRevision:3}}});const earlier=f.editor.refresh();await gate.entered;
 f.set({ok:false,code:'CHART_SERVICE_UNAVAILABLE'});await f.editor.refresh();const failure=f.status();assert.equal(failure.status,'unavailable');
 gate.release();await earlier;assert.equal(f.status().status,'unavailable');assert.equal(f.status().lastReadAt,failure.lastReadAt);
});
test('older projection failure cannot overwrite a newer successful read and projection',async t=>{
 const f=await host(t),gate=f.holdProjection();f.set({ok:true,state:{...state,revisions:{scheduleRevision:2,projectionRevision:3}}});const earlier=f.editor.refresh();await gate.entered;
 f.set({ok:true,state:{...state,revisions:{scheduleRevision:3,projectionRevision:4}}});const newer=f.editor.refresh();await new Promise(r=>setImmediate(r));gate.fail(Error('synthetic projection failure'));
 const results=await Promise.all([earlier,newer]);assert.equal(results[0].ok,false);assert.equal(results[1].ok,true);assert.equal(f.status().status,'current');assert.equal(f.counts().replacements,2);assert.ok(f.calls.every(c=>c==='snapshot'));
});
async function renderer(t,sessions=[]){
 const {editorRuntime}=await import('./runtime.mjs'),dom=new JSDOM('<main></main>'),{window}=dom;t.after(()=>dom.window.close());
 const runtime=vm.runInNewContext('('+editorRuntime.toString()+')()',{window,document:window.document,crypto:{randomUUID},Date,Intl});
 const context={root:window.document.querySelector('main'),data:{...state,sessions},emit(){}};runtime.mount(context);t.after(()=>runtime.destroy());
 const send=(status,lastReadAt)=>runtime.receive({kind:'read-status',viewId:runtime.viewId,status,lastReadAt});return {runtime,window,context,send};
}
test('empty success, initial failure, stale empty data and recovery are visibly distinct',async t=>{
 const f=await renderer(t);assert.match(f.runtime.emptyMessage.textContent,/不能判断/);
 f.send('unavailable',null);assert.match(f.runtime.readMessage.textContent,/可能过期/);assert.match(f.runtime.emptyMessage.textContent,/不能判断/);assert.doesNotMatch(f.runtime.emptyMessage.textContent,/当前没有已确认/);
 const at='2040-01-01T01:00:00.000Z';f.send('current',at);assert.match(f.runtime.emptyMessage.textContent,/当前没有已确认排班/);assert.match(f.runtime.readMessage.textContent,/最近一次读取成功/);
 f.send('denied',at);assert.match(f.runtime.readMessage.textContent,/读取被拒/);assert.match(f.runtime.emptyMessage.textContent,/上次读到.*可能过期/);
 f.send('current',at);assert.match(f.runtime.emptyMessage.textContent,/当前没有已确认排班/);assert.doesNotMatch(f.runtime.readMessage.textContent,/过期|被拒/);
});
test('read status updates preserve slot DOM, drag, preview, stale Save, and unresolved save receipt text',async t=>{
 const session={scheduleItemId:'S',resourceId:'R',plannedStart:'2040-01-01T01:00:00.000Z',plannedEnd:'2040-01-01T01:30:00.000Z',bufferAfterMinutes:20,status:'confirmed',lockStatus:'unlocked'};
 const f=await renderer(t,[session]),slot=f.window.document.querySelector('[data-jso-slot]');assert.equal(f.runtime.emptyMessage,null);
 const pending={previewId:'P',presentation:'unchanged preview',base:{...state.revisions}};f.runtime.pending=pending;f.runtime.preview.textContent=pending.presentation;f.runtime.stale=true;f.runtime.save.disabled=true;f.runtime.message.textContent='JSO 已有新安排';f.runtime.drag={id:'S'};
 f.send('denied','2040-01-01T01:00:00.000Z');f.send('current','2040-01-01T01:01:00.000Z');assert.equal(slot.isConnected,true);assert.equal(f.runtime.pending,pending);assert.equal(f.runtime.drag.id,'S');assert.equal(f.runtime.preview.textContent,pending.presentation);assert.equal(f.runtime.stale,true);assert.equal(f.runtime.save.disabled,true);assert.equal(f.runtime.message.textContent,'JSO 已有新安排');
 f.runtime.drag=null;f.runtime.receive({kind:'result',viewId:f.runtime.viewId,unknown:true,message:'保存结果待核对；未重复提交。'});f.send('current','2040-01-01T01:02:00.000Z');assert.equal(f.runtime.readOnly,true);assert.equal(f.runtime.message.textContent,'保存结果待核对；未重复提交。');assert.equal(f.runtime.save.disabled,true);
});
