'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createChartProjector}=require('./chartProjector.cjs');
const root=process.env.JSO_VCHART_AUTHOR_SOURCE;
test('existing ChartController/ChartService receive projection, reject stale revisions and recover', {skip:!root},async t=>{
 const {ChartService}=require(path.join(root,'chartService.js'));const controller=require(path.join(root,'ChartControllerService.js'));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jso-config-chart-')),service=await new ChartService({appDataRoot:dir}).initialize();t.after(async()=>{await service.shutdown();fs.rmSync(dir,{recursive:true,force:true});});controller.initialize({chartService:service});
 let project=createChartProjector({controller,chartService:service});const state=n=>({ok:true,businessSchemaVersion:12,revisions:{scheduleRevision:n,projectionRevision:n},activeConfig:{businessTimeZone:'Asia/Shanghai'},orders:[],sessions:[],resources:[],progress:[]});
 await project(state(4));await project(state(6));assert.equal((await project(state(5))).discarded,'older-response');project=createChartProjector({controller,chartService:service});await project(state(2));assert.equal((await service.readData('jso-local-candidate')).revisions.scheduleRevision,6);await project(state(7));assert.equal((await service.readData('jso-local-candidate')).revisions.scheduleRevision,7);
});
