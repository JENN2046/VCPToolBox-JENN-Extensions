'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
test('newly generated chart renders Beijing start/end and both authoritative revisions',async()=>{
 const {createChartCommand,chartData}=await import('./chart.mjs');
 const state={ok:true,businessSchemaVersion:12,activeConfig:{businessTimeZone:'Asia/Shanghai'},revisions:{scheduleRevision:3,projectionRevision:6},orders:[{id:'R',name:'隔离测试产品3D主图',shootingSubtype:'产品3D主图'}],sessions:[{scheduleItemId:'S',plannedStart:'2026-10-15T02:01:00.000Z',plannedEnd:'2026-10-15T02:31:00.000Z'}],progress:[{scheduleItemId:'S',requestIds:['R'],runs:[]}],resources:[]};
 const snapshot=JSON.stringify(state),command=createChartCommand(chartData(state,'2026-10-14T13:31:43.405Z'));
 class E{constructor(){this.children=[];this.textContent=''}append(e){this.children.push(e)}replaceChildren(){this.children=[]}}
 const root=new E();let ready=0,stable=0;const api=vm.runInNewContext('(function(){'+command.runtime+'})()',{document:{createElement:()=>new E()},Date});
 const ctx={data:command.initialData,root,reportReady:()=>ready++,reportStable:()=>stable++};api.mount(ctx);
 const text=n=>n.textContent+'\n'+n.children.map(text).join('\n');
 assert.match(text(root),/北京时间（Asia\/Shanghai）/);assert.match(text(root),/2026\/10\/15 10:01:00 — 2026\/10\/15 10:31:00/);assert.match(text(root),/排程版本 3 · 投影版本 6/);assert.equal(JSON.stringify(state),snapshot);assert.equal(ready,1);assert.equal(stable,1);
 api.update({},ctx);assert.equal(root.children.length,3);assert.equal(JSON.stringify(state),snapshot);
});
