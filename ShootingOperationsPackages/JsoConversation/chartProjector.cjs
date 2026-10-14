'use strict';
const {pathToFileURL}=require('node:url');const path=require('node:path');
function createChartProjector({controller,chartService,clock=()=>new Date()}){
 let queue=Promise.resolve();
 return state=>{
  const work=async()=>{
   const {chartData,createChartCommand,refreshChartCommand}=await import(pathToFileURL(path.join(__dirname,'chart.mjs')));
   const data=chartData(state,clock().toISOString());let manifest,prior;
   try{manifest=await chartService.readManifest('jso-local-candidate');prior=await chartService.readData('jso-local-candidate');}
   catch(error){if(error.code!=='ENOENT'&&error.code!=='CHART_NOT_FOUND')throw error;await controller.processToolCall(createChartCommand(data));return {ok:true,created:true,revisions:data.revisions};}
   if(prior.revisions&&(data.revisions.scheduleRevision<prior.revisions.scheduleRevision||data.revisions.projectionRevision<prior.revisions.projectionRevision))return {ok:true,discarded:'older-response',revisions:prior.revisions};
   await controller.processToolCall(refreshChartCommand(data,manifest.dataRevision));return {ok:true,revisions:data.revisions};
  };
  const result=queue.then(work);queue=result.catch(()=>{});return result;
 };
}
module.exports={createChartProjector};
