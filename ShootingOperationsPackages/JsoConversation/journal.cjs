'use strict';
const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
// Host-only local journal. Atomic replacement + fsync before any mutation dispatch.
// It is not an authority endpoint or a business database.
class Journal{
 constructor(file,beforeSave=()=>{}){this.beforeSave=beforeSave;this.file=file;fs.mkdirSync(path.dirname(file),{recursive:true});this.data=fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{version:1,sources:{},operations:{},plans:{}};if(this.data.version!==1)throw Error('JOURNAL_VERSION');}
 reload(){
  if(!fs.existsSync(this.file))return;
  const next=JSON.parse(fs.readFileSync(this.file,'utf8'));if(next.version!==1)throw Error('JOURNAL_VERSION');
  // Keep references held by suspended operations, but replace every persisted value.
  const merge=(target,value)=>{for(const key of Object.keys(target))if(!(key in value))delete target[key];for(const [key,v] of Object.entries(value)){if(v&&typeof v==='object'&&!Array.isArray(v)&&target[key]&&typeof target[key]==='object'&&!Array.isArray(target[key]))merge(target[key],v);else target[key]=v;}};
  merge(this.data,next);
 }
 tick(){this.data.sequence=(this.data.sequence||0)+1;return this.data.sequence;}
 save(){this.beforeSave();const temp=this.file+'.'+crypto.randomUUID()+'.tmp';const fd=fs.openSync(temp,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify(this.data));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,this.file);const dir=fs.openSync(path.dirname(this.file),'r');try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}}
 source({text,conversationId,messageId,observedSequence}){if(typeof text!=='string'||!text.trim()||text.length>4000||!conversationId||!messageId)throw Error('SOURCE_INVALID');const prior=this.data.sources[messageId];if(prior){if(prior.text!==text||prior.conversationId!==conversationId)throw Error('SOURCE_REPLACED');return prior;}const r={id:messageId,text,conversationId,sequence:this.tick(),...(Number.isSafeInteger(observedSequence)&&observedSequence>=0?{observedSequence}:{}),createdAt:new Date().toISOString(),operationId:null};this.data.sources[messageId]=r;this.save();return r;}
 bind(sourceId,proposal){const source=this.data.sources[sourceId];if(!source)throw Error('SOURCE_UNKNOWN');if(source.operationId){const r=this.data.operations[source.operationId];if(JSON.stringify(r.proposal.command)!==JSON.stringify(proposal.command))throw Error('SOURCE_REBOUND');return r;}const r={id:proposal.command.operationId,sourceId,proposal,phase:'prepared',cancelled:false};if(this.data.operations[r.id])throw Error('OPERATION_REBOUND');source.operationId=r.id;this.data.operations[r.id]=r;this.save();return r;}
}
module.exports={Journal};
