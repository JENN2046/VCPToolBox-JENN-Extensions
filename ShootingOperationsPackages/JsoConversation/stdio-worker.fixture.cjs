'use strict';
const {runNative}=require('./stdio.cjs');
let next=0;const waiting=new Map();
const rpc=message=>new Promise(resolve=>{const id=++next;waiting.set(id,resolve);process.send({id,...message});});
process.on('message',async m=>{
 if(m.reply){waiting.get(m.reply)?.(m.value);waiting.delete(m.reply);return;}
 if(!m.start)return;
 const config={endpoint:'http://127.0.0.1:1/api/v2/agent/tools',token:'synthetic'.padEnd(40,'x'),resources:['R'],policy:'native-direct-and-confirm',maxMinutes:240};
 const env={JSO_JOURNAL_PATH:m.journal,JSO_ASSISTANT_SUBJECT_ID:'assistant',PROJECT_BASE_PATH:process.env.JSO_TOOLBOX_SOURCE};
 const invocation={native:true,request:body=>rpc({type:'owner',body}),fetchImpl:async(_url,options)=>({status:200,json:()=>rpc({type:'agent',args:JSON.parse(options.body)})})};
 try{process.send({done:await runNative(m.args,config,env,invocation)});}catch(error){process.send({error:error.stack});}finally{process.disconnect();}
});
