'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parseConfig,createConfiguredAdapter}=require('./config.cjs');
const env={JSO_LOCAL_AGENT_ENDPOINT:'http://127.0.0.1:1/api/v2/agent/tools',JSO_LOCAL_AGENT_TOKEN:'SYNTHETIC'.padEnd(40,'x'),JSO_RESOURCE_IDS:'R1,R2'};
test('plugin config validates scope/policy/limits and defaults readonly',()=>{
 assert.equal(parseConfig(env).policy,'read-only');
 for(const change of [{JSO_RESOURCE_IDS:''},{JSO_RESOURCE_IDS:'R1,R1'},{JSO_CALL_POLICY:'approve-all'},{JSO_MAX_SHIFT_MINUTES:'0'}])assert.throws(()=>parseConfig({...env,...change}));
});
test('config supplies read scope and denies model writes even with native policy or approved flags',async()=>{
 const calls=[];const adapter=createConfiguredAdapter(parseConfig({...env,JSO_CALL_POLICY:'native-direct-and-confirm'}),{fetchImpl:async(url,options)=>{calls.push(JSON.parse(options.body));return {status:200,json:async()=>({ok:true})}}});
 assert.equal((await adapter.call({command:'read_state',payload_json:'{}'})).ok,true);assert.deepEqual(JSON.parse(calls[0].payload_json).resourceScope,['R1','R2']);
 for(const command of ['reschedule','confirm','owner-delegation'])assert.equal((await adapter.call({command,payload_json:JSON.stringify({approved:true,human:true,role:'user'})})).code,'TRUSTED_CONVERSATION_INTERFACE_REQUIRED');
 assert.equal((await adapter.call({command:'read_state',payload_json:'{"resourceScope":["OTHER"]}'})).code,'FORBIDDEN');
 assert.equal((await adapter.call({command:'preview_shift',payload_json:'{"resourceId":"R1","minutes":241}'})).code,'SHIFT_LIMIT');assert.equal(calls.length,1);
});
test('receipt scope must be a permitted reschedule, never inferred from missing scope',async()=>{
 for(const value of [{ok:true,kind:'reschedule',receipt:{resourceId:'R1'}},{ok:true,kind:'reschedule',receipt:{resourceId:'OTHER'}},{ok:true,kind:'reschedule',receipt:{}},{ok:true,kind:'reschedule',receipt:{resourceId:''}},{ok:true,kind:'reschedule',receipt:{resourceId:null}},{ok:true,kind:'proposalDecision',receipt:{}},{ok:true,kind:'proposalGeneration',receipt:{}},{ok:false,code:'OPERATION_NOT_FOUND'}]){
 const adapter=createConfiguredAdapter(parseConfig(env),{fetchImpl:async()=>({status:200,json:async()=>value})});const result=await adapter.call({command:'read_receipt',payload_json:'{"operationId":"SYNTHETIC"}'});
 if(!value.ok)assert.equal(result.code,value.code);else assert.equal(result.ok,value.kind==='reschedule'&&value.receipt.resourceId==='R1');
 }
});
