'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),{randomUUID}=require('node:crypto');
const {JSDOM}=require('jsdom'),calendar=require('./assets.cjs')();
function renderer(t){
 const dom=new JSDOM(calendar.template,{url:'https://synthetic.invalid/'}),{window}=dom;
 window.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
 window.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
 const runtime=vm.runInNewContext('(function(){'+calendar.runtime+'\n})()',{window,document:window.document,crypto:{randomUUID},Date,Intl,URL,console,
  matchMedia:()=>({matches:false,addEventListener(){},removeEventListener(){}}),setInterval:()=>1,clearInterval(){},setTimeout,clearTimeout});
 const context={root:window.document.body,data:{businessToday:'2040-01-01',writeAdmission:'enabled',ownerBinding:'synthetic-owner',revisions:{scheduleRevision:5,projectionRevision:8},resources:[],orders:[],sessions:[],progress:[]},emit(){},reportReady(){}};
 runtime.mount(context);t.after(()=>{runtime.destroy();dom.window.close();});
 return {command:runtime.view.command,message:()=>window.document.querySelector('#message').textContent,
  send:m=>window.__jsoChartEditor.receive({viewId:runtime.viewId,...m})};
}
test('native first authenticated read replaces initial loading text in the actual mounted calendar',t=>{
 const f=renderer(t);assert.equal(f.command.state,null);
 f.send({kind:'read-status',status:'current'});
 assert.ok(f.command.state);assert.equal(f.message(),'已读取 JSO 最新排期。');
});
test('native unavailable and denied reads visibly recover on the next current read',t=>{
 const f=renderer(t);f.send({kind:'read-status',status:'current'});
 for(const status of ['unavailable','denied']){
  f.send({kind:'read-status',status});assert.match(f.message(),/暂未取回|读取被拒/);
  f.send({kind:'read-status',status:'current'});assert.equal(f.message(),'已读取 JSO 最新排期。');assert.ok(f.command.state);
 }
});
test('background read status preserves saving and unknown-result messages and recovery state',t=>{
 const f=renderer(t);f.send({kind:'read-status',status:'current'});
 f.send({kind:'result',unknown:true,message:'保存结果待核对；未重复提交。'});
 for(const status of ['unavailable','current']){
  f.send({kind:'read-status',status});assert.equal(f.message(),'保存结果待核对；未重复提交。');assert.ok(f.command.pending);
 }
 f.send({kind:'result',message:'已保存到 JSO，并回读最新安排。'});
 f.send({kind:'read-status',status:'current'});assert.equal(f.message(),'已保存到 JSO，并回读最新安排。');
 f.command.busy=true;f.command.message='正在保存，等待 JSO 确认…';
 f.send({kind:'read-status',status:'unavailable'});assert.equal(f.command.message,'正在保存，等待 JSO 确认…');
});
