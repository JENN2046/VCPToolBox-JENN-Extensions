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
function readonlyFixture(){
 const calls=[];
 const adapter=createConfiguredAdapter(parseConfig(env),{fetchImpl:async(url,options)=>{
  calls.push({url,headers:options.headers,body:JSON.parse(options.body)});
  return {status:200,json:async()=>({ok:true})};
 }});
 return {adapter,calls};
}
test('only an omitted read_state payload defaults to the configured read scope',async()=>{
 const {adapter,calls}=readonlyFixture();
 for(const args of [{command:'read_state'},{command:'read_state',payload_json:'{}'},
  {command:'read_state',payload_json:'{"resourceScope":["R2"]}'}])assert.equal((await adapter.call(args)).ok,true);
 assert.deepEqual(calls.map(c=>c.body),[
  {command:'read_state',payload_json:'{"resourceScope":["R1","R2"]}'},
  {command:'read_state',payload_json:'{"resourceScope":["R1","R2"]}'},
  {command:'read_state',payload_json:'{"resourceScope":["R2"]}'},
 ]);
 for(const command of ['read_receipt','preview_shift','preview_calendar','propose_reschedule'])
  assert.equal((await adapter.call({command})).code,'INVALID_AGENT_ARGUMENTS');
 assert.equal(calls.length,3);
});
test('explicit invalid payloads never become the default read request',async()=>{
 const {adapter,calls}=readonlyFixture();
 for(const payload_json of [undefined,null,{},[],true,1,'',' ','broken','[]','null','true','1'])
  assert.equal((await adapter.call({command:'read_state',payload_json})).code,'INVALID_AGENT_ARGUMENTS');
 assert.equal(calls.length,0);
});
test('VCP maid and valet are optional trace metadata, not JSO API arguments or credentials',async()=>{
 const {adapter,calls}=readonlyFixture();
 for(const metadata of [{maid:'合成助手'},{valet:'synthetic-agent'},
  {maid:'synthetic-agent',valet:'synthetic-agent'}]){
  assert.equal((await adapter.call({command:'read_state',...metadata})).ok,true);
  assert.equal((await adapter.call({command:'read_state',payload_json:'{}',...metadata})).ok,true);
 }
 assert.equal(calls.length,6);
 for(const call of calls){
  assert.deepEqual(Object.keys(call.body).sort(),['command','payload_json']);
  assert.equal(call.headers.authorization,'Bearer '+env.JSO_LOCAL_AGENT_TOKEN);
  assert.deepEqual(JSON.parse(call.body.payload_json),{resourceScope:['R1','R2']});
 }
});
test('malformed or conflicting trace metadata and unknown outer fields fail before transport',async()=>{
 const {adapter,calls}=readonlyFixture();
 for(const key of ['maid','valet'])for(const value of [undefined,null,{},[],true,1,'',' ','x'.repeat(161),'agent\nname','agent\u007fname','agent\u2028name'])
  assert.equal((await adapter.call({command:'read_state',payload_json:'{}',[key]:value})).code,'INVALID_AGENT_ARGUMENTS');
 assert.equal((await adapter.call({command:'read_state',maid:'one',valet:'two'})).code,'INVALID_AGENT_ARGUMENTS');
 for(const key of ['tool_name','role','approved','human','authorization','token','principal','grant','nativeAction','payload','extra'])
  assert.equal((await adapter.call({command:'read_state',payload_json:'{}',[key]:'forged'})).code,'INVALID_AGENT_ARGUMENTS');
 assert.equal(calls.length,0);
});
test('metadata compatibility preserves resource restrictions and never authorizes writes',async()=>{
 const calls=[];
 const adapter=createConfiguredAdapter(parseConfig({...env,JSO_CALL_POLICY:'native-direct-and-confirm'}),{fetchImpl:async()=>{calls.push(true);throw Error('unexpected transport');}});
 for(const metadata of [{maid:'administrator'},{valet:'owner'},{maid:'user',valet:'user'}]){
  for(const command of ['reschedule','adopt_proposal','confirm','owner-delegation'])
   assert.equal((await adapter.call({command,payload_json:'{}',...metadata})).code,'TRUSTED_CONVERSATION_INTERFACE_REQUIRED');
  for(const resourceScope of [[],['OTHER'],['R1','OTHER'],'R1'])
   assert.equal((await adapter.call({command:'read_state',payload_json:JSON.stringify({resourceScope}),...metadata})).code,'FORBIDDEN');
  assert.equal((await adapter.call({command:'preview_shift',payload_json:'{"resourceId":"R1","minutes":241}',...metadata})).code,'SHIFT_LIMIT');
 }
 assert.equal(calls.length,0);
});
test('the inner JSO transport still rejects VCP metadata instead of broadening its envelope',async()=>{
 let calls=0;
 const adapter=require('./index.cjs').createAgentAdapter({endpoint:env.JSO_LOCAL_AGENT_ENDPOINT,token:env.JSO_LOCAL_AGENT_TOKEN,
  fetchImpl:async()=>{calls++;throw Error('unexpected transport');}});
 for(const metadata of [{maid:'synthetic'},{valet:'synthetic'},{approved:'true'},{role:'administrator'}])
  assert.equal((await adapter.call({command:'read_state',payload_json:'{}',...metadata})).code,'INVALID_AGENT_ARGUMENTS');
 assert.equal(calls,0);
});
test('configured input must remain a plain command envelope',async()=>{
 const {adapter,calls}=readonlyFixture();
 for(const args of [null,undefined,[],true,'read_state',{},Object.create({command:'read_state'})])
  assert.equal((await adapter.call(args)).code,'INVALID_AGENT_ARGUMENTS');
 assert.equal(calls.length,0);
});
test('manifest read_state calls survive the actual VCP parser and configured adapter',
 {skip:!process.env.JSO_TOOLBOX_SOURCE},async()=>{
 const path=require('node:path'),fs=require('node:fs');
 const Parser=require(path.join(process.env.JSO_TOOLBOX_SOURCE,'modules/vcpLoop/toolCallParser.js'));
 const manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'../../Plugin/JennShootingOperations/plugin-manifest.local-agent.json'),'utf8'));
 const read=manifest.capabilities.invocationCommands.find(c=>c.commandIdentifier==='read_state');
 assert.ok(read.description.includes('payload_json'));assert.ok(read.description.includes('resourceScope'));
 const examples=[...read.description.matchAll(/<<<\[TOOL_REQUEST\]>>>[\s\S]*?<<<\[END_TOOL_REQUEST\]>>>/g)].map(m=>m[0]);
 examples.push(read.example);assert.equal(examples.length,3);
 const {adapter,calls}=readonlyFixture();
 for(const text of examples){const parsed=Parser.parse(text);assert.equal(parsed.length,1);assert.equal(parsed[0].name,'JennShootingOperations');assert.equal((await adapter.call(parsed[0].args)).ok,true);}
 assert.equal(calls.length,3);
 for(const call of calls){assert.deepEqual(Object.keys(call.body).sort(),['command','payload_json']);assert.deepEqual(JSON.parse(call.body.payload_json),{resourceScope:['R1','R2']});}
});
