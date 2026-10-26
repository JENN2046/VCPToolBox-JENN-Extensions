'use strict';
const ID=/^[A-Za-z0-9_-]{1,160}$/;
const validId=v=>typeof v==='string'&&ID.test(v);
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const revisions=r=>r&&['scheduleRevision','projectionRevision'].every(k=>Number.isSafeInteger(r[k])&&r[k]>=0);
const same=(a,b)=>revisions(a)&&revisions(b)&&a.scheduleRevision===b.scheduleRevision&&a.projectionRevision===b.projectionRevision;
function inputValid(v){return exact(v,['scheduleItemId','resourceId','mode','plannedStart','endAt','bufferAfterMinutes'])&&validId(v.scheduleItemId)&&validId(v.resourceId)&&['plan','forecast'].includes(v.mode)&&[v.endAt,...(v.mode==='plan'?[v.plannedStart]:[])].every(t=>typeof t==='string'&&Number.isFinite(Date.parse(t))&&new Date(t).toISOString()===t)&&(v.mode!=='forecast'||v.plannedStart===null)&&Number.isSafeInteger(v.bufferAfterMinutes)&&v.bufferAfterMinutes>=0&&v.bufferAfterMinutes<=1440;}
function safeOrigin(value){const u=new URL(value);if(u.username||u.password||u.search||u.hash||!(u.protocol==='https:'||(u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname))))throw Error('SECURE_ENDPOINT_REQUIRED');return u;}
// Management snapshots and Agent snapshots describe the same JSO facts. Only
// explicitly configured resources are returned; no attachments or credentials.
function chartState(state,scope){
 if(!state?.ok||state.protocolVersion!==3||state.principal?.role!=='administrator'||!revisions(state.revisions))throw Error('SNAPSHOT_INVALID');
 const sessions=state.sessions.filter(s=>scope.includes(s.resourceId));const assigned=new Set(sessions.flatMap(s=>s.requestIds));
 const catalogue=state.principal.resourceIds.every(id=>scope.includes(id));
 const orders=state.orderFacts.filter(o=>assigned.has(o.id)||(catalogue&&!state.sessions.some(s=>s.requestIds.includes(o.id)))).map(o=>({id:o.id,name:o.name,kind:o.kind,shootingSubtype:o.shootingSubtype,lifecycle:o.lifecycle,sku:o.submission?.sku,coreBriefSummary:o.submission?.coreBriefSummary,client:o.client,productionType:o.submission?.productionType,requestedBy:o.submission?.requestedBy,desiredDate:o.submission?.desiredDate,deliverableCount:o.submission?.deliverables?.count}));
 const active=state.configs.find(c=>c.active);
 return {ok:true,businessSchemaVersion:12,writeAdmission:state.writeAdmission,ownerBinding:JSON.stringify([state.principal.subjectId,[...scope].sort()]),businessToday:state.businessToday,revisions:state.revisions,
  activeConfig:active?{businessTimeZone:active.configJson.businessTimeZone,configVersion:active.configVersion,configDigest:active.configDigest}:null,
  resources:state.resources.filter(r=>scope.includes(r.resource_id)).map(r=>({resourceId:r.resource_id,displayName:r.v1_display_place,status:r.status})),orders,
  sessions:sessions.map(s=>({scheduleItemId:s.id,resourceId:s.resourceId,plannedStart:s.plannedStart,plannedEnd:s.plannedEnd,bufferAfterMinutes:s.bufferAfterMinutes,status:s.status,lockStatus:s.lockStatus,allocationMode:s.allocationMode,resourceResolutionStatus:s.resourceResolutionStatus,hasRunHistory:s.hasRunHistory})),
  progress:sessions.map(s=>({scheduleItemId:s.id,requestIds:s.requestIds,runs:s.runs,confirmedForecast:s.confirmedForecast??null}))};
}
function createBridge({endpoint,resources,fetchImpl=fetch}){
 const u=safeOrigin(endpoint);if(u.pathname!=='/api/v2/agent/tools'||!resources?.length||resources.some(r=>!validId(r)))throw Error('JSO_BINDING_INVALID');
 async function call(route,authorization,body){const response=await fetchImpl(u.origin+route,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(15000),headers:{authorization,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!value||typeof value.ok!=='boolean')throw Error('JSO_RESPONSE_INVALID');if(response.status>=500)throw Error('JSO_UNAVAILABLE');return value;}
 async function session(auth){if(typeof auth!=='string'||!/^Bearer [\x21-\x7e]{32,4096}$/.test(auth))return null;const p=await call('/api/v2/agent/owner-session',auth);return p.ok&&p.role==='administrator'&&typeof p.subjectId==='string'&&resources.every(id=>p.resourceIds?.includes(id))?p:null;}
 return {async run(action,body,auth){
  let writing=false;
  try{
   const owner=await session(auth);if(!owner)return {ok:false,code:'APPLICATION_SESSION_REQUIRED'};
   if(action==='snapshot'&&exact(body,[])){const state=await call('/api/v3/business/state',auth);if(!state.ok)return state;if(state.principal?.subjectId!==owner.subjectId)return {ok:false,code:'APPLICATION_SESSION_CHANGED'};return {ok:true,subjectId:owner.subjectId,state:chartState(state,resources)};}
   if(action==='preview'){
    if(!exact(body,['input','baseRevisions'])||!inputValid(body.input)||!revisions(body.baseRevisions)||!resources.includes(body.input.resourceId))return {ok:false,code:'INVALID_CHART_EDIT'};
    const state=await call('/api/v3/business/state',auth);if(!state.ok)return state;
    if(!same(state.revisions,body.baseRevisions))return {ok:false,code:'SCHEDULING_REVISION_CONFLICT'};
    const result=await call('/api/v3/business/day-adjustment/preview',auth,body.input);
    if(result.ok&&!same({scheduleRevision:result.preview.expectedScheduleRevision,projectionRevision:result.preview.expectedProjectionRevision},body.baseRevisions))return {ok:false,code:'SCHEDULING_REVISION_CONFLICT'};
    return {...result,subjectId:owner.subjectId};
   }
   if(action==='apply'){
    if(!exact(body,['operationId','input','previewDigest','subjectId'])||!validId(body.operationId)||!inputValid(body.input)||!resources.includes(body.input.resourceId)||!/^sha256:[a-f0-9]{64}$/.test(body.previewDigest))return {ok:false,code:'INVALID_CHART_EDIT'};
    if(body.subjectId!==owner.subjectId)return {ok:false,code:'APPLICATION_SESSION_CHANGED'};
    // No Agent grant is created: the existing authenticated administrator calls
    // the same business endpoint as management. The client binds Save to input.
    const {subjectId,...command}=body;writing=true;
    return await call('/api/v3/business/day-adjustment/apply',auth,command);
   }
   if(action==='recover'){
    if(!exact(body,['operationId','subjectId'])||!validId(body.operationId)||body.subjectId!==owner.subjectId)return {ok:false,code:'APPLICATION_SESSION_CHANGED'};
    const result=await call('/api/v3/business/operations/'+encodeURIComponent(body.operationId),auth);
    if(result.ok&&(result.receipt?.operationId!==body.operationId||!resources.includes(result.receipt?.preview?.input?.resourceId)))return {ok:false,code:'RECEIPT_SCOPE_MISMATCH'};
    return result;
   }
   return {ok:false,code:'INVALID_CHART_EDIT'};
  }catch{return {ok:false,code:writing?'RESULT_UNKNOWN':'CHART_SERVICE_UNAVAILABLE'};}
 }};
}
module.exports={createBridge,chartState,inputValid,revisions,same,safeOrigin};
