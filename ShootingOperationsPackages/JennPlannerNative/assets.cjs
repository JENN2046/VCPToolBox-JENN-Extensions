'use strict';
const fs=require('node:fs'),path=require('node:path'),{createHash}=require('node:crypto');
module.exports=function assets(){
 const root=path.join(__dirname,'artifact'),manifest=JSON.parse(fs.readFileSync(path.join(root,'artifact.json'),'utf8'));
 if(manifest.chartId!=='jso-calendar-isolated'||manifest.protocol!=='jso-editor')throw Error('CALENDAR_ARTIFACT_INVALID');
 const result={hashes:{}};
 for(const [kind,name]of [['runtime','runtime.js'],['template','template.html'],['style','style.css']]){
  const value=fs.readFileSync(path.join(root,name),'utf8'),hash=createHash('sha256').update(value).digest('hex');
  if(hash!==manifest.hashes[name])throw Error('CALENDAR_ARTIFACT_MISMATCH');result[kind]=value;result.hashes[kind]=hash;
 }
 return result;
};
