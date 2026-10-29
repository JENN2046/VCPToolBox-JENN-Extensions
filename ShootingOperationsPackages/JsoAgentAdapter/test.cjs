const test=require('node:test'),assert=require('node:assert/strict');const {createAgentAdapter}=require('./index.cjs');
const binding={endpoint:'http://127.0.0.1:1/api/v2/agent/tools',token:'SYNTHETIC-ASSISTANT'.padEnd(40,'x')};
test('stdio broker status reaches both write transports instead of manufacturing a definite failure',async t=>{
 const {createServer}=require('node:http'),{invocationContext}=require('./context.cjs');let calls=0;
 const server=createServer((req,res)=>{calls++;req.resume();res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,code:'INVOCATION_RESULT_UNKNOWN'}));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const context=invocationContext({VCP_EXECUTION_CONTEXT:JSON.stringify({protocol:'trusted-conversation-v1',endpoint:`http://127.0.0.1:${server.address().port}`,capability:'a'.repeat(64),native:true})});
 const adapter=createAgentAdapter({...binding,fetchImpl:context.fetchImpl});
 for(const command of ['reschedule','adopt_proposal'])assert.equal((await adapter.call({command,payload_json:'{}'})).code,'RESULT_UNKNOWN');
 assert.equal(calls,2);
});
test('unstructured or server-failed mutation response is unknown and never retried',async()=>{for(const response of [{status:200,json:async()=>({unexpected:true})},{status:503,json:async()=>({ok:false,code:'SERVICE_ERROR'})}]){let calls=0;const adapter=createAgentAdapter({...binding,fetchImpl:async()=>{calls++;return response;}});assert.equal((await adapter.call({command:'reschedule',payload_json:'{}'})).code,'RESULT_UNKNOWN');assert.equal(calls,1);}});
test('model cannot add credential/approval fields or change endpoint origin',async()=>{let calls=0;const adapter=createAgentAdapter({...binding,fetchImpl:async()=>{calls++;throw Error('unexpected')}});assert.equal((await adapter.call({command:'reschedule',payload_json:'{}',ownerToken:'forged'})).code,'INVALID_AGENT_ARGUMENTS');assert.equal(calls,0);assert.throws(()=>createAgentAdapter({...binding,endpoint:'https://example.com/api/v2/agent/tools'}),/LOCAL_AGENT_BINDING_INVALID/);});

test('adoption failures remain unknown and never retry, including timeout and malformed success',async()=>{
 for(const response of [{status:503,json:async()=>({ok:false,code:'SERVICE_UNAVAILABLE'})},{status:200,json:async()=>({unexpected:true})},null]){
  let calls=0;const adapter=createAgentAdapter({...binding,fetchImpl:async()=>{calls++;if(!response)throw Error('synthetic timeout');return response;}});
  assert.equal((await adapter.call({command:'adopt_proposal',payload_json:'{}'})).code,'RESULT_UNKNOWN');assert.equal(calls,1);
 }
});
