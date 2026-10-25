'use strict';
const fs=require('node:fs'),path=require('node:path');
function stage(destination){
 const target=path.resolve(destination);if(fs.existsSync(target))throw Error('DESTINATION_MUST_BE_NEW');
 require('./assets.cjs')();
 fs.mkdirSync(target,{recursive:true});
 const wrapper=path.resolve(__dirname,'../../ClientPlugins/JennPlannerNative');
 for(const file of ['service.cjs','plugin-manifest.json'])fs.copyFileSync(path.join(wrapper,file),path.join(target,file));
 const bundle=path.join(target,'bundle');fs.mkdirSync(bundle);fs.mkdirSync(path.join(bundle,'JennPlannerNative'));fs.mkdirSync(path.join(bundle,'JsoChartEditor'));
 for(const file of ['main.cjs','assets.cjs'])fs.copyFileSync(path.join(__dirname,file),path.join(bundle,'JennPlannerNative',file));
 fs.cpSync(path.join(__dirname,'artifact'),path.join(bundle,'JennPlannerNative/artifact'),{recursive:true});
 for(const file of ['main.cjs','client.cjs','bridge.cjs','runtime.mjs'])fs.copyFileSync(path.join(__dirname,'../JsoChartEditor',file),path.join(bundle,'JsoChartEditor',file));
 return target;
}
if(require.main===module){if(!process.argv[2])throw Error('EXPLICIT_NEW_DESTINATION_REQUIRED');console.log(stage(process.argv[2]));}
module.exports={stage};
