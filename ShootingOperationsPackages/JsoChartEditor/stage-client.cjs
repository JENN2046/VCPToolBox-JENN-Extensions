'use strict';
const fs=require('node:fs'),path=require('node:path');
function stage(destination){
 const target=path.resolve(destination);if(fs.existsSync(target))throw Error('DESTINATION_MUST_BE_NEW');
 fs.mkdirSync(target,{recursive:true});
 const wrapper=path.resolve(__dirname,'../../ClientPlugins/JsoChartEditor');
 for(const file of ['service.cjs','plugin-manifest.json'])fs.copyFileSync(path.join(wrapper,file),path.join(target,file));
 fs.mkdirSync(path.join(target,'bundle'));
 for(const file of ['main.cjs','client.cjs','bridge.cjs','runtime.mjs'])fs.copyFileSync(path.join(__dirname,file),path.join(target,'bundle',file));
 return target;
}
if(require.main===module){if(!process.argv[2])throw Error('EXPLICIT_NEW_DESTINATION_REQUIRED');console.log(stage(process.argv[2]));}
module.exports={stage};
