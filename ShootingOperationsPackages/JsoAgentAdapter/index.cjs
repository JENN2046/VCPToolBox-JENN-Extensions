'use strict';
const COMMANDS=new Set(['read_state','preview_calendar','preview_shift','propose_reschedule','generate_proposal','adopt_proposal','reschedule','read_receipt']);
const WRITES=new Set(['reschedule','adopt_proposal']);
function createAgentAdapter({endpoint,token,fetchImpl=fetch}){
 const url=new URL(endpoint);if(url.username||url.password||url.search||url.hash||url.pathname!=='/api/v2/agent/tools'
  ||url.protocol!=='http:'||!['127.0.0.1','[::1]'].includes(url.hostname)||typeof token!=='string'||! /^[\x21-\x7e]{32,}$/.test(token))throw Error('LOCAL_AGENT_BINDING_INVALID');
 return {async call(args){if(!args||Object.keys(args).sort().join(',')!=='command,payload_json'||!COMMANDS.has(args.command)||typeof args.payload_json!=='string'||Buffer.byteLength(args.payload_json)>262144)return {ok:false,code:'INVALID_AGENT_ARGUMENTS'};
  try{const response=await fetchImpl(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify(args)});const value=await response.json();if(WRITES.has(args.command)&&(response.status>=500||typeof value?.ok!=='boolean'))return {ok:false,code:'RESULT_UNKNOWN'};return typeof value?.ok==='boolean'?value:{ok:false,code:'SERVICE_RESULT_INVALID'};}
  catch{return {ok:false,code:WRITES.has(args.command)?'RESULT_UNKNOWN':'SERVICE_UNAVAILABLE'};}
 }};
}
module.exports={createAgentAdapter};
