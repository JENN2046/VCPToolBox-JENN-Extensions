'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),{createHash}=require('node:crypto');
const {createEditor}=require('./main.cjs');
const viewId='00000000-0000-4000-8000-000000000005';
const input={scheduleItemId:'S',resourceId:'R',mode:'plan',plannedStart:'2040-01-01T01:00:00.000Z',endAt:'2040-01-01T02:00:00.000Z',bufferAfterMinutes:20};
function barrier(){let enter,release;const entered=new Promise(r=>enter=r),gate=new Promise(r=>release=r);return {entered,enter,gate,release};}
async function fixture(t,gateKind){
 const {runtime}=await import('./runtime.mjs');const targetHash=createHash('sha256').update(runtime).digest('hex'),root=fs.mkdtempSync(path.join(os.tmpdir(),'jso-save-race-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const projectBasePath=path.resolve(__dirname,'../../../chat-current/VCPDistributedServer');let displayed={},destroyed=false,blockRead=false;const gate=barrier(),calls=[];
 const wc=new EventEmitter();wc.id=1;wc.getURL=()=>require('node:url').pathToFileURL(path.resolve(projectBasePath,'../Chartmodules/chart.html')).href;
 wc.executeJavaScript=async code=>{
  if(code.includes('?.proof(')&&gateKind==='proof'){gate.enter();await gate.gate;}
  return vm.runInNewContext(code,{window:{__jsoChartEditor:{viewId,receive:m=>{displayed=m;},proof:()=>({eligible:true,text:displayed.previewId,conversationId:viewId})}},document:{querySelector:()=>({textContent:displayed.presentation})}});
 };
 const win={webContents:wc,isDestroyed:()=>destroyed,isFocused:()=>true};
 const service=new EventEmitter();service.getSource=async()=>({hash:targetHash});service.readData=async()=>{if(gateKind==='read'&&blockRead){gate.enter();await gate.gate;}return {revisions:{scheduleRevision:1,projectionRevision:1}};};
 const client={call:async(action,body)=>{if(action==='snapshot')return {ok:false};if(action==='preview')return {ok:true,subjectId:'owner',previewDigest:'sha256:'+'a'.repeat(64),preview:{input:body.input,expectedScheduleRevision:1,expectedProjectionRevision:1,changes:[],warnings:[],unresolved:[],canApply:true}};if(action==='apply'){calls.push(body);return {ok:true,receipt:{operationId:body.operationId}};}throw Error('unexpected '+action);}};
 const app=new EventEmitter();const editor=await createEditor({chartService:service,projectBasePath,config:{},app,BrowserWindow:{getAllWindows:()=>[win]},client,stateRoot:root});t.after(()=>editor.shutdown());
 const send=p=>editor.handle({chartId:'jso-local-candidate',name:'jso-editor',payload:{viewId,...p}});
 await send({kind:'ready'});await send({kind:'preview',requestId:'old',input,baseRevisions:{scheduleRevision:1,projectionRevision:1}});const previewId=displayed.previewId;blockRead=true;
 wc.emit('before-mouse-event',{}, {type:'mouseDown',button:'left',x:1,y:1});
 if(gateKind==='read')await new Promise(r=>setImmediate(r));
 const pending=send({kind:'save',previewId});await gate.entered;
 return {send,pending,gate,calls,close(){destroyed=true;wc.emit('destroyed');}};
}
for(const gateKind of ['read','proof'])for(const invalidate of ['cancel','close','unmount','replacement'])test('Save stays bound during '+gateKind+' await / '+invalidate,async t=>{
 const f=await fixture(t,gateKind);if(invalidate==='close')f.close();else if(invalidate==='cancel'||invalidate==='unmount')await f.send({kind:invalidate==='unmount'?'close':'cancel'});else await f.send({kind:'preview',requestId:'new',input:{...input,endAt:'2040-01-01T03:00:00.000Z'},baseRevisions:{scheduleRevision:1,projectionRevision:1}});
 f.gate.release();await f.pending;
 if(invalidate==='replacement'){assert.ok(f.calls.length<=1);if(f.calls.length)assert.equal(f.calls[0].input.endAt,input.endAt);}else assert.equal(f.calls.length,0);
});
