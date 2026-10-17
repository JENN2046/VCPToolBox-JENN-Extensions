// Runs inside the existing VChart runtime. Coordinates are only a local input;
// commands carry stable session IDs and UTC instants, never pixel positions.
export function editorRuntime(){
 return {
  mount(context){
   this.context=context;this.viewId=crypto.randomUUID();this.pending=null;this.drag=null;this.stale=false;this.readOnly=false;
   const self=this;
   window.__jsoChartEditor={viewId:this.viewId,receive:m=>self.receive(m),proof:(kind,input)=>self.proof(kind,input)};
   this.render();context.emit('jso-editor',{kind:'ready',viewId:this.viewId});
  },
  format(t){return new Date(t).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});},
  el(tag,text,parent,css=''){const e=document.createElement(tag);if(text!==null)e.textContent=text;if(css)e.style.cssText=css;parent?.append(e);return e;},
  render(){
   const root=this.context.root,d=this.context.data;root.replaceChildren();
   this.el('h2','JSO · 拍摄排班',root);this.el('p','北京时间 · 排程 '+d.revisions.scheduleRevision+' / 投影 '+d.revisions.projectionRevision+' · 自动补读约5秒',root);
   this.el('p','拖动场次调整时间，拖右侧边缘调整结束时间；点一次“保存”提交。',root);
   this.message=this.el('p',this.status||'',root,'white-space:pre-wrap');this.message.dataset.jsoMessage='';
   const list=this.el('div',null,root);
   for(const s of d.sessions){
    const progress=d.progress.find(p=>p.scheduleItemId===s.scheduleItemId),run=progress?.runs.at(-1);
    const names=(progress?.requestIds||[]).map(id=>d.orders.find(o=>o.id===id)?.name||'拍摄场次').join('、');
    const planned=[s.plannedStart,s.plannedEnd];this.el('p',names+' · '+this.format(planned[0])+' — '+this.format(planned[1])+' · '+(run?.status||'未开始'),list);
    const day=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(s.plannedStart));
    const origin=Date.parse(day+'T00:00:00+08:00');
    const track=this.el('div',null,list,'position:relative;height:52px;background:repeating-linear-gradient(90deg,#183a42 0,#183a42 calc(100% / 24 - 1px),#658080 calc(100% / 24));border-radius:6px;margin:8px 0 22px;touch-action:none');
    const start=Date.parse(s.plannedStart),end=Date.parse(progress?.confirmedForecast?.estimatedEnd||s.plannedEnd);
    const slot=this.el('button',this.format(s.plannedStart).slice(-8)+' — '+this.format(new Date(end).toISOString()).slice(-8),track,'position:absolute;top:4px;height:44px;background:#307f83;color:white;border:1px solid #b8e3dc;border-radius:6px;white-space:nowrap;min-width:20px;touch-action:none;padding:0 12px;cursor:grab;overflow:hidden;font-size:12px');
    slot.type='button';slot.dataset.jsoSlot=s.scheduleItemId;
    const position=(a,b)=>{slot.style.left=((a-origin)/86400000*100)+'%';slot.style.width=((b-a)/86400000*100)+'%';};position(start,end);
    const handle=this.el('span','⋮',slot,'position:absolute;right:0;top:0;height:100%;width:12px;cursor:ew-resize;background:#285c68');handle.dataset.jsoResize='';
    if(progress?.confirmedForecast)this.el('p','已确认预计结束 '+this.format(progress.confirmedForecast.estimatedEnd),list);
    const current=['shooting','blocked'].includes(run?.status),completed=!!run&&!current;
    const editable=s.status==='confirmed'&&s.lockStatus==='unlocked'&&!completed&&!this.readOnly;
    slot.disabled=!editable;handle.hidden=!editable;
    slot.addEventListener('pointerdown',e=>{
     if(!editable||this.pending?.saving)return;
     const latest=this.context.data,item=latest.sessions.find(item=>item.scheduleItemId===s.scheduleItemId),progressNow=latest.progress.find(p=>p.scheduleItemId===s.scheduleItemId),runNow=progressNow?.runs.at(-1);
     const currentNow=['shooting','blocked'].includes(runNow?.status),resize=e.target===handle;
     if(!item||item.lockStatus!=='unlocked'||item.status!=='confirmed'||(runNow&&!currentNow)||(currentNow&&!resize)){this.clearDraft();this.render();return;}
     const latestDay=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(item.plannedStart));
     if(latestDay!==day){this.clearDraft();this.status='场次日期已变化，已显示最新安排，请重新拖动。';this.render();return;}
     e.preventDefault();this.clearDraft();
     const currentStart=Date.parse(item.plannedStart),currentEnd=Date.parse(progressNow?.confirmedForecast?.estimatedEnd||item.plannedEnd);
     this.drag={id:s.scheduleItemId,x:e.clientX,start:currentStart,end:currentEnd,resize,current:currentNow,resourceId:item.resourceId,bufferAfterMinutes:item.bufferAfterMinutes,base:{...latest.revisions},origin,delta:0};slot.setPointerCapture(e.pointerId);
     this.status='调整中，尚未保存';this.message.textContent=this.status;
    });
    slot.addEventListener('pointermove',e=>{const drag=this.drag;if(!drag||drag.id!==s.scheduleItemId)return;
     drag.delta=Math.round((e.clientX-drag.x)/track.getBoundingClientRect().width*1440/5)*5;
     const a=drag.start+(drag.resize?0:drag.delta*60000),b=drag.end+drag.delta*60000;
     if(b<=a||a<origin||b>origin+86400000)return;
     position(a,b);slot.firstChild.textContent=this.format(new Date(a).toISOString()).slice(-8)+' — '+this.format(new Date(b).toISOString()).slice(-8);
    });
    const finish=e=>{const drag=this.drag;if(!drag||drag.id!==s.scheduleItemId)return;this.drag=null;
     try{slot.releasePointerCapture(e.pointerId);}catch{}
     if(e.type==='pointercancel'||!drag.delta){this.status='未保存';this.render();return;}
     const a=drag.start+(drag.resize?0:drag.delta*60000),b=drag.end+drag.delta*60000;
     if(b<=a||a<origin||b>origin+86400000){this.status='请保持在同一天内，结束时间须晚于开始时间。';this.render();return;}
     const input={scheduleItemId:s.scheduleItemId,resourceId:drag.resourceId,mode:drag.current?'forecast':'plan',plannedStart:drag.current?null:new Date(a).toISOString(),endAt:new Date(b).toISOString(),bufferAfterMinutes:drag.bufferAfterMinutes};
     const requestId=crypto.randomUUID();this.pending={requestId,input,base:drag.base};this.status='正在读取 JSO 预览…';this.message.textContent=this.status;
     this.context.emit('jso-editor',{kind:'preview',viewId:this.viewId,requestId,input,baseRevisions:drag.base});
    };
    slot.addEventListener('pointerup',finish);slot.addEventListener('pointercancel',finish);
   }
   this.preview=this.el('pre','',root,'white-space:pre-wrap;border-top:1px solid #668;padding-top:14px');this.preview.dataset.jsoPreview='';
   this.save=this.el('button','保存',root,'padding:10px 24px;margin:8px');this.save.type='button';this.save.dataset.jsoSave='';this.save.disabled=true;
   this.save.addEventListener('click',()=>{if(!this.pending?.previewId||this.save.disabled)return;this.pending.saving=true;this.save.disabled=true;this.status='正在保存，等待 JSO 确认…';this.message.textContent=this.status;this.context.emit('jso-editor',{kind:'save',viewId:this.viewId,previewId:this.pending.previewId});});
   const cancel=this.el('button','取消调整',root,'padding:10px 18px;margin:8px');cancel.type='button';cancel.dataset.jsoCancel='';cancel.addEventListener('click',()=>{if(this.pending?.saving)return;this.context.emit('jso-editor',{kind:'cancel',viewId:this.viewId});this.clearDraft();this.status='调整已取消';this.render();});
   const recover=this.el('button','核对保存结果',root,'padding:10px 18px;margin:8px');recover.type='button';recover.dataset.jsoRecover='';recover.addEventListener('click',()=>this.context.emit('jso-editor',{kind:'recover',viewId:this.viewId}));
   this.context.reportReady?.();this.context.reportStable?.();
  },
  clearDraft(){this.pending=null;this.stale=false;},
  receive(m){
   if(m.viewId!==this.viewId)return;
   if(m.kind==='preview'&&this.pending?.requestId===m.requestId){
    if(m.ok&&m.canApply&&!this.stale){this.pending.previewId=m.previewId;this.pending.presentation=m.presentation;this.preview.textContent=m.presentation;this.save.disabled=false;this.save.dataset.previewId=m.previewId;this.status='核对影响后点“保存”；尚未写入。';}
    else{this.clearDraft();this.status=m.message||'无法保存，请重新拖动。';this.render();this.preview.textContent=m.presentation||'';}
    this.message.textContent=this.status;
   }
   if(m.kind==='result'){
    this.clearDraft();this.readOnly=!!m.unknown;this.status=m.message;this.render();
   }
  },
  proof(kind,input){
   if(!this.pending?.previewId||this.stale||!this.save||this.preview.textContent!==this.pending.presentation)return null;
   const hit=kind==='mouse'?document.elementFromPoint(input.x,input.y):document.activeElement;
   const eligible=(hit===this.save||this.save.contains(hit))&&(!this.save.disabled||this.pending.saving)&&this.save.getBoundingClientRect().height>0;
   return {eligible,text:this.pending.previewId,conversationId:this.viewId};
  },
  update(change,context){
   this.context=context;
   if(this.drag||this.pending){
    const base=this.drag?.base||this.pending?.base;
    if(base&&(base.scheduleRevision!==context.data.revisions.scheduleRevision||base.projectionRevision!==context.data.revisions.projectionRevision)){
     this.stale=true;if(this.save)this.save.disabled=true;this.status='JSO 已有新安排；当前预览保留，请重新拖动核对后保存。';this.message.textContent=this.status;
    }
    return;
   }
   this.render();
  },resize(){},setTheme(){},
  destroy(){this.context.emit('jso-editor',{kind:'close',viewId:this.viewId});if(window.__jsoChartEditor?.viewId===this.viewId)delete window.__jsoChartEditor;this.drag=null;this.pending=null;}
 };
}
export const runtime='return ('+editorRuntime.toString()+')();';
