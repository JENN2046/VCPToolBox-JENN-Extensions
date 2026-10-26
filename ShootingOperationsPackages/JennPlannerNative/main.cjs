'use strict';
// Explicit, bounded isolated chart target. No upgrade/allowlist of user runtimes.
const {createEditor}=require('../JsoChartEditor/main.cjs');
let instance;
async function createCalendar(options){return createEditor({...options,nativeCalendar:true});}
async function initialize(options){
 if(!options.config?.JSO_CHART_BRIDGE_URL)return;
 const {app,BrowserWindow}=require('electron');
 await instance?.shutdown();instance=await createCalendar({...options,app,BrowserWindow,chartService:options.services?.chartService});
}
async function shutdown(){await instance?.shutdown();instance=null;}
module.exports={initialize,shutdown,cleanup:shutdown,createCalendar};
