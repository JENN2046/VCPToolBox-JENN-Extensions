#!/usr/bin/env node
'use strict';
const {parseConfig,createConfiguredAdapter}=require('../../ShootingOperationsPackages/JsoAgentAdapter/config.cjs');
async function run(){let raw='';for await(const c of process.stdin){raw+=c;if(Buffer.byteLength(raw)>270336)throw Error('REQUEST_TOO_LARGE');}
 const args=JSON.parse(raw);const context=require('../../ShootingOperationsPackages/JsoAgentAdapter/context.cjs').invocationContext(process.env);
 const config=parseConfig({...process.env,...(context?{JSO_LOCAL_AGENT_TOKEN:'HOST-RETAINED-NOT-A-CREDENTIAL'.padEnd(40,'x')}:{})});
 const adapter=createConfiguredAdapter(config,context?{fetchImpl:context.fetchImpl}:{});
 const result=context?.native ? await require('../../ShootingOperationsPackages/JsoConversation/stdio.cjs').runNative(args,config,process.env,context) : await adapter.call(args);process.stdout.write(JSON.stringify({status:result.ok?'success':'error',result})+'\n');}
run().catch(()=>process.stdout.write(JSON.stringify({status:'error',result:{ok:false,code:'LOCAL_AGENT_BINDING_OR_ARGUMENTS_INVALID'}})+'\n'));
