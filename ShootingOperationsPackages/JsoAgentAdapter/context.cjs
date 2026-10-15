'use strict';
function invocationContext(env){
 let value;try{value=JSON.parse(env.VCP_EXECUTION_CONTEXT);}catch{return null;}
 if(value?.protocol!=='trusted-conversation-v1')return null;
 const url=new URL(value.endpoint);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||!/^\/?$/.test(url.pathname)||!/^[a-f0-9]{64}$/.test(value.capability||''))throw Error('INVOCATION_CONTEXT_INVALID');
 async function request(body){const r=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(16000),headers:{authorization:'Bearer '+value.capability,'content-type':'application/json'},body:JSON.stringify(body)});return r.json();}
 return {native:value.native===true,namespace:/^[a-f0-9]{64}$/.test(value.namespace||'')?value.namespace:null,request,fetchImpl:async(_url,options)=>({status:200,json:()=>request({kind:'agent',args:JSON.parse(options.body)})})};
}
module.exports={invocationContext};
