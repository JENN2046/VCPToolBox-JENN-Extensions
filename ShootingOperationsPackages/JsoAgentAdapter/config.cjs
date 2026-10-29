'use strict';
const {createAgentAdapter}=require('./index.cjs');
const READ_COMMANDS=new Set(['read_state','read_receipt','preview_calendar','preview_shift','propose_reschedule','generate_proposal']);
const VCP_ARGUMENT_KEYS=new Set(['command','payload_json','maid','valet']);
function normalizeConfiguredArguments(args){
 if(!args||Object.getPrototypeOf(args)!==Object.prototype||!Object.hasOwn(args,'command')
  ||typeof args.command!=='string'||Object.keys(args).some(key=>!VCP_ARGUMENT_KEYS.has(key)))return null;
 // VCP signatures are untrusted trace metadata, never a JSO identity or grant.
 // Strip only this explicit allowlist before the strict JSO API envelope.
 for(const key of ['maid','valet'])if(Object.hasOwn(args,key)){
  const value=args[key];
  if(typeof value!=='string'||!value.trim()||value.length>160||/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value))return null;
 }
 if(Object.hasOwn(args,'maid')&&Object.hasOwn(args,'valet')&&args.maid.trim()!==args.valet.trim())return null;
 // Only omission on this read-only command has a default. Explicit malformed
 // values and every other command retain their existing required payload.
 const payload_json=Object.hasOwn(args,'payload_json')?args.payload_json:args.command==='read_state'?'{}':undefined;
 return typeof payload_json==='string'?{command:args.command,payload_json}:null;
}
function parseConfig(env){
 const endpoint=String(env.JSO_LOCAL_AGENT_ENDPOINT||'');
 const token=env.JSO_LOCAL_AGENT_TOKEN;
 const resources=String(env.JSO_RESOURCE_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(!resources.length||new Set(resources).size!==resources.length||resources.some(s=>!/^[A-Za-z0-9_-]{1,160}$/.test(s)))throw Error('JSO_RESOURCE_SCOPE_REQUIRED');
 const policy=env.JSO_CALL_POLICY||'read-only';
 if(!['read-only','native-direct-and-confirm'].includes(policy))throw Error('JSO_CALL_POLICY_INVALID');
 const maxMinutes=Number(env.JSO_MAX_SHIFT_MINUTES||240);
 if(!Number.isSafeInteger(maxMinutes)||maxMinutes<1||maxMinutes>1439)throw Error('JSO_SHIFT_LIMIT_INVALID');
 const requestIds=String(env.JSO_NATIVE_REQUEST_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(new Set(requestIds).size!==requestIds.length||requestIds.some(s=>!/^[A-Za-z0-9_-]{1,160}$/.test(s)))throw Error('JSO_REQUEST_SCOPE_INVALID');
 return Object.freeze({endpoint,token,resources:Object.freeze(resources),policy,maxMinutes,requestIds:Object.freeze(requestIds)});
}
function createConfiguredAdapter(config,{fetchImpl=fetch}={}){
 const transport=createAgentAdapter({endpoint:config.endpoint,token:config.token,fetchImpl});
 return {async call(args){
  args=normalizeConfiguredArguments(args);
  if(!args)return {ok:false,code:'INVALID_AGENT_ARGUMENTS'};
  // Model/stdin calls have no authenticated native confirmation context. A setting never grants it.
  if(!READ_COMMANDS.has(args.command))return {ok:false,code:'TRUSTED_CONVERSATION_INTERFACE_REQUIRED'};
  let payload;try{payload=JSON.parse(args.payload_json);}catch{return {ok:false,code:'INVALID_AGENT_ARGUMENTS'};}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return {ok:false,code:'INVALID_AGENT_ARGUMENTS'};
  if(args.command==='read_state'){
   const requested=payload.resourceScope??config.resources;
   if(!Array.isArray(requested)||!requested.length||requested.some(id=>!config.resources.includes(id)))return {ok:false,code:'FORBIDDEN'};
   payload={...payload,resourceScope:requested};
  }
  if(args.command==='generate_proposal'&&(!Array.isArray(payload.resourceScope)||!payload.resourceScope.length||payload.resourceScope.some(id=>!config.resources.includes(id))))return {ok:false,code:'FORBIDDEN'};
  if(payload.resourceId!==undefined&&!config.resources.includes(payload.resourceId))return {ok:false,code:'FORBIDDEN'};
  if(args.command==='preview_shift'&&(!Number.isSafeInteger(payload.minutes)||Math.abs(payload.minutes)>config.maxMinutes||payload.minutes===0))return {ok:false,code:'SHIFT_LIMIT'};
  const result=await transport.call({command:args.command,payload_json:JSON.stringify(payload)});
  if(args.command==='read_receipt'&&result.ok===true){
   const scopedMove=result.kind==='reschedule'&&result.receipt?.operationId===payload.operationId&&config.resources.includes(result.receipt?.resourceId);
   const scopedDecision=result.kind==='proposalDecision'&&result.receipt?.decisionId===payload.operationId&&Array.isArray(result.resourceScope)&&result.resourceScope.length>0&&new Set(result.resourceScope).size===result.resourceScope.length&&result.resourceScope.every(id=>config.resources.includes(id))&&result.receipt?.decisionType==='accept'&&/^sha256:[a-f0-9]{64}$/.test(result.receipt?.decisionCommandDigest);
   if(!scopedMove&&!scopedDecision)return {ok:false,code:'FORBIDDEN'};
  }
  return result;
 }};
}
module.exports={parseConfig,createConfiguredAdapter};
