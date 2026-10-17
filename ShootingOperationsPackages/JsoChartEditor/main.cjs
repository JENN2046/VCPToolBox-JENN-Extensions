'use strict';
const fs=require('node:fs'),path=require('node:path'),{pathToFileURL,fileURLToPath}=require('node:url'),{createHash,randomUUID}=require('node:crypto');
const {createClient}=require('./client.cjs'),{same,revisions}=require('./bridge.cjs');
const CHART='jso-local-candidate',UUID=/^[a-f0-9-]{36}$/;
let singleton;
async function createEditor({chartService,projectBasePath,config,app,BrowserWindow,env=process.env,client:providedClient,stateRoot}){
 const {installNativeConversationPort}=require(path.join(projectBasePath,'../modules/services/trustedConversation/nativePort.cjs'));
 const {runtime}=await import(pathToFileURL(path.join(__dirname,'runtime.mjs')));
 const targetHash=createHash('sha256').update(runtime).digest('hex');
 const client=providedClient||createClient({url:config.JSO_CHART_BRIDGE_URL,transportToken:env[config.JSO_CHART_TRANSPORT_TOKEN_ENV],authorization:env[config.JSO_CHART_APPLICATION_AUTHORIZATION_ENV]});
 const root=stateRoot||path.join(app.getPath('userData'),'JSOChartEditor'),file=path.join(root,'pending.json');
 const binding=createHash('sha256').update(config.JSO_CHART_BRIDGE_URL||'injected-isolated-client').digest('hex');
 let pending=null,disposed=false,saving=false,projectQueue=Promise.resolve(),upgradeQueue=Promise.resolve();
 const views=new Map(),ports=new Map();
 function persist(value){fs.mkdirSync(root,{recursive:true,mode:0o700});fs.writeFileSync(file+'.tmp',JSON.stringify(value),{mode:0o600});fs.renameSync(file+'.tmp',file);pending=value;}
 try{const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||(stat.mode&0o077))throw Error('CHART_JOURNAL_UNSAFE');const saved=JSON.parse(fs.readFileSync(file));if(saved&&saved.binding!==binding)throw Error('CHART_JOURNAL_BINDING_CHANGED');pending=saved;}catch(e){if(e.code!=='ENOENT')throw e;}
 const page=path.resolve(projectBasePath,'../Chartmodules/chart.html');
 function owned(win){try{return !disposed&&!win.isDestroyed()&&new URL(win.webContents.getURL()).protocol==='file:'&&path.resolve(fileURLToPath(win.webContents.getURL()))===page;}catch{return false;}}
 async function tell(record,message){if(!record||!owned(record.win))return;await record.win.webContents.executeJavaScript(`window.__jsoChartEditor?.receive(${JSON.stringify({...message,viewId:record.viewId})})`).catch(()=>{});}
 async function project(state){
  if(!state?.ok||!revisions(state.revisions))return;
  const work=async()=>{if(disposed)return;const manifest=await chartService.readManifest(CHART),prior=await chartService.readData(CHART);
   if(['scheduleRevision','projectionRevision'].some(k=>state.revisions[k]<(prior.revisions?.[k]??0)))return;
   if(same(prior.revisions,state.revisions)&&prior.projectionFormat===2)return;
   const data={source:'JSO',projectionFormat:2,refreshMode:'authenticated-poll-5s',observedAt:new Date().toISOString(),businessTimeZone:state.activeConfig?.businessTimeZone,revisions:state.revisions,orders:state.orders,sessions:state.sessions,progress:state.progress,resources:state.resources,_nativeProjectionVersion:[state.revisions.scheduleRevision,state.revisions.projectionRevision]};
   await chartService.replaceData(CHART,data,{expectedDataRevision:manifest.dataRevision});
  };
  const next=projectQueue.then(work);projectQueue=next.catch(()=>{});return next;
 }
 async function refresh(){const result=await client.call('snapshot');if(result.ok)await project(result.state);return result;}
 async function locate(viewId){
  for(const win of BrowserWindow.getAllWindows().filter(owned)){
   try{if(await win.webContents.executeJavaScript(`window.__jsoChartEditor?.viewId===${JSON.stringify(viewId)}`))return win;}catch{}
  }return null;
 }
 function attach(win){if(!owned(win)||ports.has(win.webContents.id))return;
  const wc=win.webContents;
  const port=installNativeConversationPort({window:win,isSessionCurrent:async()=>owned(win),snapshot:async(kind,input)=>{
   if(!owned(win))return null;
   const snapshot=await wc.executeJavaScript(`window.__jsoChartEditor?.proof(${JSON.stringify(kind)},${JSON.stringify({x:input.x,y:input.y,key:input.key})})`);
   const record=views.get(snapshot?.conversationId);
   if(!record||record.win!==win||record.previewId!==snapshot?.text)return null;
   const displayed=await wc.executeJavaScript(`document.querySelector('[data-jso-preview]')?.textContent`);
   return displayed===record.presentation?snapshot:null;
  }});
  ports.set(wc.id,port);wc.once('destroyed',()=>{port.dispose();ports.delete(wc.id);for(const [id,r] of views)if(r.win===win)views.delete(id);});
 }
 async function upgrade(){
  if(disposed)return;
  try{const source=await chartService.getSource(CHART,'runtime');
   // Only exact shipped templates; never replace a user's custom runtime.
   if(source.hash===targetHash)return;
   if(!KNOWN_RUNTIME_HASHES.includes(source.hash))return;
   await chartService.editSource(CHART,{file:'runtime',content:runtime,expectedCodeRevision:source.codeRevision});
  }catch(e){if(!['ENOENT','CHART_NOT_FOUND'].includes(e.code))throw e;}
 }
 const onChange=change=>{if(change?.chartId!==CHART||!['created','source-changed','restored'].includes(change.type))return;const work=upgradeQueue.then(upgrade);upgradeQueue=work.catch(()=>{});};
 async function currentRecord(r){return views.get(r.viewId)===r&&owned(r.win)&&await r.win.webContents.executeJavaScript(`window.__jsoChartEditor?.viewId===${JSON.stringify(r.viewId)}`);}
 async function recover(record){
  if(!pending){const read=await refresh();await tell(record,{kind:'result',message:read.ok?'已读取 JSO 最新安排。':'暂未取回 JSO 最新安排，当前显示保留。'});return;}
  if(saving){await tell(record,{kind:'result',unknown:true,message:'保存仍在处理中，请稍后核对原操作。'});return;}
  const result=await client.call('recover',{operationId:pending.command.operationId,subjectId:pending.command.subjectId});
  if(result.ok&&result.receipt?.operationId===pending.command.operationId){persist(null);const read=await refresh();await tell(record,{kind:'result',message:read.ok?'原保存已确认，已回读 JSO。':'原保存已确认，暂未取回最新显示。'});}
  else await tell(record,{kind:'result',unknown:true,message:'原保存结果仍待核对；未再次提交。'});
 }
 function presentation(result,data){
  const p=result.preview,fmt=t=>new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
  const lines=['北京时间 · '+(p.input.mode==='forecast'?'预计结束调整（实际开拍/完成不变）':'排班调整')];
  for(const c of p.changes){const progress=data.progress.find(item=>item.scheduleItemId===c.after.scheduleItemId),name=(progress?.requestIds||[]).map(id=>data.orders.find(order=>order.id===id)?.name||'拍摄场次').join('、')||'拍摄场次';lines.push(name+': '+fmt(c.before.plannedStart)+' — '+fmt(c.before.plannedEnd)+' → '+fmt(c.after.plannedStart)+' — '+fmt(c.after.plannedEnd));}
  if(p.forecast)lines.push('预计结束 → '+fmt(p.forecast.estimatedEnd));
  for(const item of [...p.warnings,...p.unresolved])lines.push('需核对：'+item.code);
  lines.push('排程 '+p.expectedScheduleRevision+' / 投影 '+p.expectedProjectionRevision);return lines.join('\n');
 }
 async function handle(event){
  if(disposed||event?.chartId!==CHART||event.name!=='jso-editor')return;
  const p=event.payload;if(!p||!UUID.test(p.viewId))return;
  // Unmount clears the renderer marker before this asynchronous event arrives.
  // Closing a known view only revokes its authority; it needs no renderer read.
  if(p.kind==='close'){const prior=views.get(p.viewId);if(prior){prior.generation++;prior.previewId=null;ports.get(prior.win.webContents.id)?.invalidate();views.delete(p.viewId);}return;}
  const win=await locate(p.viewId);if(!win)return;attach(win);
  if((await chartService.getSource(CHART,'runtime')).hash!==targetHash)return;
  let record=views.get(p.viewId);
  if(p.kind==='ready'){
   if(views.size>=16)return;record={viewId:p.viewId,win,generation:0};views.set(p.viewId,record);
   if(pending)await recover(record);else await refresh();return;
  }
  if(!record||record.win!==win)return;
  if(p.kind==='cancel'){record.generation++;record.previewId=null;ports.get(win.webContents.id)?.invalidate();return;}
  if(p.kind==='recover'){await recover(record);return;}
  if(p.kind==='preview'){
   if(saving||pending){await tell(record,{kind:'result',unknown:true,message:'请先核对上一次保存结果。'});return;}
   record.previewId=null;record.generation++;ports.get(win.webContents.id)?.invalidate();const generation=record.generation;
   const result=await client.call('preview',{input:p.input,baseRevisions:p.baseRevisions});
   if(!await currentRecord(record)||generation!==record.generation)return;
   if(!result.ok){await refresh();await tell(record,{kind:'preview',requestId:p.requestId,ok:false,message:'预览未完成：'+result.code+'。请重新拖动核对。'});return;}
   const displayedData=await chartService.readData(CHART);
   if(!await currentRecord(record)||generation!==record.generation)return;
   record.previewId=randomUUID();record.presentation=presentation(result,displayedData);record.base={scheduleRevision:result.preview.expectedScheduleRevision,projectionRevision:result.preview.expectedProjectionRevision};
   record.command={operationId:'CHART-'+randomUUID(),subjectId:result.subjectId,input:result.preview.input,previewDigest:result.previewDigest};
   await tell(record,{kind:'preview',requestId:p.requestId,ok:true,canApply:result.preview.canApply,previewId:record.previewId,presentation:record.presentation});return;
  }
  if(p.kind!=='save'||p.previewId!==record.previewId||!record.command||saving||pending||record.saving)return;
  // Freeze the exact preview that the physical event authorized before any
  // await. A cancel/replacement cannot redirect this Save to another command.
  const command=structuredClone(record.command),base={...record.base},generation=record.generation,previewId=record.previewId;
  saving=true;record.saving=true;
  const unchanged=()=>views.get(record.viewId)===record&&record.generation===generation&&record.previewId===previewId;
  try{
   let context;try{context=await ports.get(win.webContents.id).consume({text:previewId,conversationId:record.viewId});}catch{await tell(record,{kind:'result',message:'本次未提交：请在图表中实际点击保存按钮。'});return;}
   if(!context||!unchanged()||!await currentRecord(record)||!same((await chartService.readData(CHART)).revisions,base)||!unchanged()){
    await tell(record,{kind:'result',message:'安排、预览或窗口已变化，本次未提交，请重新拖动核对。'});return;
   }
   record.previewId=null;
   persist({binding,command});
   const result=await client.call('apply',command);
   if(result.ok&&result.receipt?.operationId===command.operationId){persist(null);const read=await refresh();await tell(record,{kind:'result',message:read.ok?'已保存到 JSO，并回读最新安排。':'JSO 已确认保存，暂未取回最新显示。'});}
   else if(result.ok||result.code==='RESULT_UNKNOWN'){await tell(record,{kind:'result',unknown:true,message:'保存结果待核对，未重复提交。请点“核对保存结果”。'});}
   else{persist(null);await refresh();await tell(record,{kind:'result',message:'未保存：'+(result.code||'RESPONSE_INVALID')+'。已回读 JSO，请重新拖动核对。'});}
  }catch{await tell(record,{kind:'result',unknown:!!pending,message:pending?'保存结果待核对；未重复提交。':'本次未提交，请稍后重新读取。'});}
  finally{saving=false;record.saving=false;}
 }
 const onEvent=event=>{void handle(event).catch(()=>{});};
 const created=(_event,win)=>{win.webContents.once('did-finish-load',()=>attach(win));};
 chartService.on('runtime-event',onEvent);chartService.on('change',onChange);app.on('browser-window-created',created);
 for(const win of BrowserWindow.getAllWindows())attach(win);
 await upgrade();
 return {shutdown(){disposed=true;chartService.off('runtime-event',onEvent);chartService.off('change',onChange);app.removeListener('browser-window-created',created);for(const port of ports.values())port.dispose();ports.clear();views.clear();},refresh,handle};
}
// SHA256 of the two shipped, read-only JSO templates (legacy and auto-refresh).
const KNOWN_RUNTIME_HASHES=['ac11206e74cf622e8b4075c4693be7ee82a2f0c0809e690b0f032b38ddeb763b','810b92afe6f17b071b0e776ad169be0d9ac4aab21cf6e5735107fabbb9d09b80'];
async function initialize(options){
 if(!options.config?.JSO_CHART_BRIDGE_URL)return;
 const {app,BrowserWindow}=require('electron');
 await singleton?.shutdown();singleton=await createEditor({...options,app,BrowserWindow,chartService:options.services?.chartService});
}
async function shutdown(){await singleton?.shutdown();singleton=null;}
module.exports={initialize,shutdown,cleanup:shutdown,createEditor,KNOWN_RUNTIME_HASHES};
