'use strict';
const {safeOrigin}=require('./bridge.cjs');
function createClient({url,transportToken,authorization,fetchImpl=fetch}){
 const u=safeOrigin(url);if(u.pathname.replace(/\/$/,'')!=='/api/plugins/JsoChartBridge'||!transportToken||!/^Bearer [\x21-\x7e]{32,4096}$/.test(authorization||''))throw Error('CHART_CLIENT_BINDING_INVALID');
 return {async call(action,body={}){
  if(!['snapshot','preview','apply','recover'].includes(action))throw Error('CHART_ACTION_INVALID');
  try{const response=await fetchImpl(u.origin+'/api/plugins/JsoChartBridge/'+action,{method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),headers:{authorization:'Bearer '+transportToken,'x-vcp-application-authorization':authorization,'content-type':'application/json'},body:JSON.stringify(body)});if([401,403].includes(response.status))return {ok:false,code:'TRANSPORT_AUTH_REQUIRED'};const value=await response.json();if(!response.ok||typeof value?.ok!=='boolean')return {ok:false,code:action==='apply'?'RESULT_UNKNOWN':'CHART_SERVICE_UNAVAILABLE'};return value;}catch{return {ok:false,code:action==='apply'?'RESULT_UNKNOWN':'CHART_SERVICE_UNAVAILABLE'};}
 }};
}
module.exports={createClient};
