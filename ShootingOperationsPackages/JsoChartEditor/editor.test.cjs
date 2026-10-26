'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createBridge,chartState}=require('./bridge.cjs'),{createClient}=require('./client.cjs');
const {JSDOM}=require(process.env.JSO_TEST_DEPENDENCIES?process.env.JSO_TEST_DEPENDENCIES+'/jsdom':'jsdom');
const principal={ok:true,subjectId:'owner',role:'administrator',resourceIds:['R']};
const state={ok:true,protocolVersion:3,principal,revisions:{scheduleRevision:1,projectionRevision:2},businessToday:'2040-01-01',configs:[],resources:[],orderFacts:[],sessions:[]};
function bridge(values){const calls=[];return {calls,bridge:createBridge({endpoint:'http://127.0.0.1:1/api/v2/agent/tools',resources:['R'],fetchImpl:async(url,options)=>{calls.push({url,options});const value=values.shift();if(value instanceof Error)throw value;return {status:200,json:async()=>value};}})};}
const input={scheduleItemId:'S',resourceId:'R',mode:'plan',plannedStart:'2040-01-01T01:00:00.000Z',endAt:'2040-01-01T02:00:00.000Z',bufferAfterMinutes:20};
const auth='Bearer '+'a'.repeat(40);
test('scope, stale revisions, identity changes and model fields cannot become writes',async()=>{
 for(const [action,body,values,code] of [
  ['apply',{operationId:'OP',subjectId:'other',input,previewDigest:'sha256:'+'a'.repeat(64)},[principal],'APPLICATION_SESSION_CHANGED'],
  ['apply',{operationId:'OP',subjectId:'owner',input:{...input,resourceId:'OTHER'},previewDigest:'sha256:'+'a'.repeat(64)},[principal],'INVALID_CHART_EDIT'],
  ['preview',{input,baseRevisions:{scheduleRevision:0,projectionRevision:1}},[principal,state],'SCHEDULING_REVISION_CONFLICT'],
  ['apply',{operationId:'OP',subjectId:'owner',input,previewDigest:'sha256:'+'a'.repeat(64),approved:true},[principal],'INVALID_CHART_EDIT']]){
  const f=bridge(values);assert.equal((await f.bridge.run(action,body,auth)).code,code);assert.ok(f.calls.every(c=>!c.url.endsWith('/apply')));
 }
});
test('only explicit apply dispatches; timeout remains unknown and is never retried',async()=>{const f=bridge([principal,Error('lost response')]);const result=await f.bridge.run('apply',{operationId:'OP',subjectId:'owner',input,previewDigest:'sha256:'+'a'.repeat(64)},auth);assert.equal(result.code,'RESULT_UNKNOWN');assert.equal(f.calls.filter(c=>c.url.endsWith('/apply')).length,1);});
test('management projection excludes other resources, attachments and scoped-out order facts',()=>{const result=chartState({...state,principal:{...principal,resourceIds:['R','OTHER']},orderFacts:[{id:'A',name:'allowed',references:['secret']},{id:'B',name:'other'},{id:'U',name:'unassigned'}],sessions:[{id:'S',resourceId:'R',requestIds:['A'],runs:[]},{id:'X',resourceId:'OTHER',requestIds:['B'],runs:[]}]},['R']);assert.deepEqual(result.orders.map(o=>o.id),['A']);assert.equal(result.sessions.length,1);assert.ok(!JSON.stringify(result).includes('secret'));});
test('client refuses public plaintext transport and never exposes credentials in failure values',async()=>{assert.throws(()=>createClient({url:'http://example.com/api/plugins/JsoChartBridge',transportToken:'T',authorization:auth}),/SECURE/);const c=createClient({url:'http://127.0.0.1/api/plugins/JsoChartBridge',transportToken:'T',authorization:auth,fetchImpl:async()=>{throw Error(auth)}});const r=await c.call('apply',{});assert.equal(r.code,'RESULT_UNKNOWN');assert.ok(!JSON.stringify(r).includes('aaaa'));});
for(const status of [401,403])test('transport auth '+status+' is a definite pre-bridge failure even with a non-JSON body',async()=>{
 const client=createClient({url:'http://127.0.0.1/api/plugins/JsoChartBridge',transportToken:'T',authorization:auth,fetchImpl:async()=>({status,ok:false,json:async()=>{throw Error('HTML auth error');}})});
 assert.equal((await client.call('apply',{})).code,'TRANSPORT_AUTH_REQUIRED');
});
test('live snapshot during drag/draft preserves DOM, disables stale Save and cancel reveals latest facts',async()=>{
 const {editorRuntime}=await import('./runtime.mjs');const dom=new JSDOM('<main></main>',{url:'file:///fixture/Chartmodules/chart.html'}),{window}=dom;
 const fn=window.Function; // Compile in a DOM context, as the actual VChart runtime does.
 const runtime=require('node:vm').runInNewContext('('+editorRuntime.toString()+')()',{window,document:window.document,crypto:{randomUUID:require('node:crypto').randomUUID},Date,Intl});
 const data={revisions:{scheduleRevision:1,projectionRevision:2},orders:[],progress:[],sessions:[]};const context={data,root:window.document.querySelector('main'),emit(){}};runtime.mount(context);
 runtime.pending={requestId:'request',base:{...data.revisions}};const root=context.root,marker=window.document.createElement('div');marker.textContent='local draft';root.append(marker);
 const next={...context,data:{...data,revisions:{scheduleRevision:2,projectionRevision:3}}};runtime.update({type:'data-replaced'},next);assert.equal(marker.isConnected,true);assert.equal(runtime.stale,true);assert.equal(runtime.save.disabled,true);assert.match(runtime.message.textContent,/新安排/);runtime.clearDraft();runtime.render();assert.match(root.textContent,/排程 2/);runtime.destroy();dom.window.close();
});
test('re-drag after a stale preview uses latest stable session facts and revisions',async()=>{
 const {editorRuntime}=await import('./runtime.mjs');const dom=new JSDOM('<main></main>',{url:'file:///fixture/Chartmodules/chart.html'}),{window}=dom;
 const runtime=require('node:vm').runInNewContext('('+editorRuntime.toString()+')()',{window,document:window.document,crypto:{randomUUID:require('node:crypto').randomUUID},Date,Intl});
 const session={scheduleItemId:'S',resourceId:'R',plannedStart:'2040-01-01T01:00:00.000Z',plannedEnd:'2040-01-01T01:30:00.000Z',bufferAfterMinutes:20,status:'confirmed',lockStatus:'unlocked'};
 const data={revisions:{scheduleRevision:1,projectionRevision:2},orders:[],progress:[],sessions:[session]};const context={data,root:window.document.querySelector('main'),emit(){}};runtime.mount(context);
 runtime.pending={base:{...data.revisions}};const updated={...context,data:{...data,revisions:{scheduleRevision:3,projectionRevision:4},sessions:[{...session,plannedStart:'2040-01-01T01:10:00.000Z',plannedEnd:'2040-01-01T01:40:00.000Z'}]}};runtime.update({},updated);
 const slot=window.document.querySelector('[data-jso-slot]');slot.setPointerCapture=()=>{};const event=new window.Event('pointerdown',{bubbles:true});Object.assign(event,{clientX:10,pointerId:1});slot.dispatchEvent(event);
 assert.deepEqual({...runtime.drag.base},{scheduleRevision:3,projectionRevision:4});assert.equal(runtime.drag.start,Date.parse('2040-01-01T01:10:00.000Z'));
 runtime.drag=null;runtime.pending={base:{...updated.data.revisions}};
 const anotherDay={...updated,data:{...updated.data,revisions:{scheduleRevision:4,projectionRevision:5},sessions:[{...session,plannedStart:'2040-01-02T01:00:00.000Z',plannedEnd:'2040-01-02T01:30:00.000Z'}]}};runtime.update({},anotherDay);slot.dispatchEvent(event);
 assert.equal(runtime.drag,null);assert.match(runtime.message.textContent,/日期已变化/);assert.equal(slot.isConnected,false);
 const latestSlot=window.document.querySelector('[data-jso-slot]');latestSlot.setPointerCapture=()=>{};latestSlot.dispatchEvent(event);assert.equal(runtime.drag.start,Date.parse('2040-01-02T01:00:00.000Z'));assert.equal(runtime.drag.origin,Date.parse('2040-01-02T00:00:00+08:00'));
 runtime.destroy();dom.window.close();
});
test('native snapshot exposes explicit display context and movable-state fields without exposing attachments',()=>{
 const value=chartState({...state,writeAdmission:'enabled',principal:{...principal,resourceIds:['R']},orderFacts:[{id:'A',name:'allowed',references:['private-attachment'],submission:{sku:'SYNTHETIC',coreBriefSummary:'synthetic brief',requestedBy:'synthetic requester',desiredDate:'2040-01-01',deliverables:{count:1}}}],sessions:[{id:'S',resourceId:'R',requestIds:['A'],runs:[],allocationMode:'single',resourceResolutionStatus:'resolved',hasRunHistory:0}]},['R']);
 assert.equal(value.writeAdmission,'enabled');assert.equal(value.businessToday,'2040-01-01');assert.equal(value.ownerBinding,JSON.stringify(['owner',['R']]));assert.equal(value.sessions[0].allocationMode,'single');assert.equal(value.sessions[0].resourceResolutionStatus,'resolved');assert.equal(value.sessions[0].hasRunHistory,0);assert.equal(value.orders[0].sku,'SYNTHETIC');assert.ok(!JSON.stringify(value).includes('private-attachment'));
});
test('snapshot rejects an application Owner changing between session authentication and management read',async()=>{
 const f=bridge([principal,{...state,principal:{...principal,subjectId:'different-owner'}}]);assert.equal((await f.bridge.run('snapshot',{},auth)).code,'APPLICATION_SESSION_CHANGED');assert.equal(f.calls.length,2);
});
