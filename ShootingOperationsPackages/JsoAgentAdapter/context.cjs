'use strict';
function invocationContext(env){
 let value;try{value=JSON.parse(env.VCP_EXECUTION_CONTEXT);}catch{return null;}
 if(value?.protocol!=='trusted-conversation-v1')return null;
 const url=new URL(value.endpoint);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||!/^\/?$/.test(url.pathname)||!/^[a-f0-9]{64}$/.test(value.capability||''))throw Error('INVOCATION_CONTEXT_INVALID');
 const response=body=>fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(16000),headers:{authorization:'Bearer '+value.capability,'content-type':'application/json'},body:JSON.stringify(body)});
 async function request(body){return (await response(body)).json();}
 return {native:value.native===true,namespace:/^[a-f0-9]{64}$/.test(value.namespace||'')?value.namespace:null,request,fetchImpl:async(_url,options)=>{const r=await response({kind:'agent',args:JSON.parse(options.body)});return {status:r.status,json:()=>r.json()};}};
}
module.exports={invocationContext};
