#!/usr/bin/env node
'use strict';
const {createAgentAdapter}=require('../../ShootingOperationsPackages/JsoAgentAdapter/index.cjs');
async function run(){let raw='';for await(const c of process.stdin){raw+=c;if(Buffer.byteLength(raw)>270336)throw Error('REQUEST_TOO_LARGE');}
 const args=JSON.parse(raw);const adapter=createAgentAdapter({endpoint:process.env.JSO_LOCAL_AGENT_ENDPOINT,token:process.env.JSO_LOCAL_AGENT_TOKEN});
 const result=await adapter.call(args);process.stdout.write(JSON.stringify({status:result.ok?'success':'error',result})+'\n');}
run().catch(()=>process.stdout.write(JSON.stringify({status:'error',result:{ok:false,code:'LOCAL_AGENT_BINDING_OR_ARGUMENTS_INVALID'}})+'\n'));
