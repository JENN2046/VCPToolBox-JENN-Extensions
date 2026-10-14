'use strict';
const {createAgentAdapter}=require('./index.cjs');
const READ_COMMANDS=new Set(['read_state','read_receipt','preview_calendar','preview_shift','propose_reschedule']);
function parseConfig(env){
 const endpoint=String(env.JSO_LOCAL_AGENT_ENDPOINT||'');
 const token=env.JSO_LOCAL_AGENT_TOKEN;
 const resources=String(env.JSO_RESOURCE_IDS||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(!resources.length||new Set(resources).size!==resources.length||resources.some(s=>!/^[A-Za-z0-9_-]{1,160}$/.test(s)))throw Error('JSO_RESOURCE_SCOPE_REQUIRED');
 const policy=env.JSO_CALL_POLICY||'read-only';
 if(!['read-only','native-direct-and-confirm'].includes(policy))throw Error('JSO_CALL_POLICY_INVALID');
 const maxMinutes=Number(env.JSO_MAX_SHIFT_MINUTES||240);
 if(!Number.isSafeInteger(maxMinutes)||maxMinutes<1||maxMinutes>1439)throw Error('JSO_SHIFT_LIMIT_INVALID');
 return Object.freeze({endpoint,token,resources:Object.freeze(resources),policy,maxMinutes});
}
function createConfiguredAdapter(config,{fetchImpl=fetch}={}){
 const transport=createAgentAdapter({endpoint:config.endpoint,token:config.token,fetchImpl});
 return {async call(args){
  if(!args||Object.keys(args).sort().join(',')!=='command,payload_json'||typeof args.payload_json!=='string')return {ok:false,code:'INVALID_AGENT_ARGUMENTS'};
  // Model/stdin calls have no authenticated native confirmation context. A setting never grants it.
  if(!READ_COMMANDS.has(args.command))return {ok:false,code:'TRUSTED_CONVERSATION_INTERFACE_REQUIRED'};
  let payload;try{payload=JSON.parse(args.payload_json);}catch{return {ok:false,code:'INVALID_AGENT_ARGUMENTS'};}
  if(!payload||typeof payload!=='object'||Array.isArray(payload))return {ok:false,code:'INVALID_AGENT_ARGUMENTS'};
  if(args.command==='read_state'){
   const requested=payload.resourceScope??config.resources;
   if(!Array.isArray(requested)||!requested.length||requested.some(id=>!config.resources.includes(id)))return {ok:false,code:'FORBIDDEN'};
   payload={...payload,resourceScope:requested};
  }
  if(payload.resourceId!==undefined&&!config.resources.includes(payload.resourceId))return {ok:false,code:'FORBIDDEN'};
  if(args.command==='preview_shift'&&(!Number.isSafeInteger(payload.minutes)||Math.abs(payload.minutes)>config.maxMinutes||payload.minutes===0))return {ok:false,code:'SHIFT_LIMIT'};
  const result=await transport.call({command:args.command,payload_json:JSON.stringify(payload)});
  if(args.command==='read_receipt'&&result.ok===true&&(result.kind!=='reschedule'||!config.resources.includes(result.receipt?.resourceId)))return {ok:false,code:'FORBIDDEN'};
  return result;
 }};
}
module.exports={parseConfig,createConfiguredAdapter};
