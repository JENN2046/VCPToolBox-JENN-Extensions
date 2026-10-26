return {mount(context){this.context=context;this.viewId=crypto.randomUUID();const self=this;const actualDocument=document,actualWindow=window,root=context.root;const listeners=[];const listen=(obj,type,fn,options)=>{obj.addEventListener(type,fn,options);listeners.push(()=>obj.removeEventListener(type,fn,options));};const doc={body:{hasAttribute:n=>n==='data-calendar-editor'},querySelector:s=>root.querySelector(s),querySelectorAll:s=>root.querySelectorAll(s),createElement:n=>actualDocument.createElement(n),addEventListener:(t,f,o)=>listen(actualDocument,t,f,o),removeEventListener:(t,f,o)=>actualDocument.removeEventListener(t,f,o),elementFromPoint:(x,y)=>actualDocument.elementFromPoint(x,y),get activeElement(){return actualDocument.activeElement;},get hidden(){return actualDocument.hidden;}};const win={addEventListener:(t,f,o)=>listen(actualWindow,t,f,o),removeEventListener:(t,f,o)=>actualWindow.removeEventListener(t,f,o),location:{reload(){}}};listen(root,'click',e=>{const link=e.target.closest('a');if(link&&link.getAttribute('href')!=='#main'){e.preventDefault();if(link.textContent.includes('工作安排')||link.textContent.includes('订单')||link.textContent.includes('需求'))root.querySelector('#message').textContent='订单管理请使用 JSO 网页的工作安排。';}},true);this.removeListeners=()=>listeners.splice(0).forEach(f=>f());this.view=(function(document,window){const {showMessage,dateKey,mondayOf,minutes,sessionState,layoutSessions}=(()=>{function showMessage(element, message, type = 'info') {
  element.textContent = message;
  element.dataset.type = type;
  element.setAttribute('role', type === 'error' ? 'alert' : 'status');
}

function dateKey(date) {
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function mondayOf(date) {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  result.setDate(result.getDate() - (result.getDay() + 6) % 7);
  return result;
}

function minutes(value) {
  const [hours, minute] = value.split(':').map(Number);
  return hours * 60 + minute;
}

// Display only: the persisted task status is never changed by the clock.
function sessionState(session, tasks, now = new Date()) {
  if (tasks.length && tasks.every(task => task.status === 'cancelled')) return 'cancelled';
  const active = tasks.filter(task => task.status !== 'cancelled');
  if (active.length && active.every(task => task.status === 'completed')) return 'completed';
  const time = now.getHours() * 60 + now.getMinutes();
  if (session.date === dateKey(now) && time >= minutes(session.start) && time < minutes(session.end)) return 'live';
  return 'scheduled';
}

// Partition overlapping events without changing their scheduled times.
function layoutSessions(sessions) {
  const sorted = [...sessions].sort((a, b) => minutes(a.start) - minutes(b.start) || minutes(a.end) - minutes(b.end));
  const result = [];
  let group = [];
  let ends = [];
  let groupEnd = -1;
  const flush = () => {
    group.forEach(item => result.push({ ...item, columns: ends.length }));
    group = [];
    ends = [];
  };
  for (const session of sorted) {
    const start = minutes(session.start);
    const end = Math.max(minutes(session.end), start + 60);
    if (start >= groupEnd) flush();
    let column = ends.findIndex(value => value <= start);
    if (column < 0) column = ends.length;
    ends[column] = end;
    group.push({ session, column });
    groupEnd = Math.max(...ends);
  }
  flush();
  return result;
}

function mergeFiles(existing, incoming) {
  const key = file => JSON.stringify([file.name, file.size, file.type, file.lastModified]);
  const seen = new Set(existing.map(key));
  return [...existing, ...incoming.filter(file => {
    if (seen.has(key(file))) return false;
    seen.add(key(file));
    return true;
  })];
}

function fileSelectionError(files) {
  if (files.length > 10) return '最多选择 10 个文件，请移除部分文件后再添加。';
  for (const { file, kind } of files) {
    const limit = kind === 'image' ? 12 : 20;
    if (!file.size || file.size > limit * 1024 * 1024) return '“' + file.name + '”' + (file.size ? '超过 ' + limit + ' MB' : '是空文件') + '，请重新选择。';
  }
  if (files.reduce((total, { file }) => total + file.size, 0) > 40 * 1024 * 1024) return '文件总容量超过 40 MB，请移除部分文件后再添加。';
  return '';
}

return {showMessage,dateKey,mondayOf,minutes,sessionState,layoutSessions};})();
const {boardView,beijingParts}=(()=>{// Display view only: retain the native V3 order/session facts; no legacy protocol conversion.
function beijingParts(instant){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant));
 const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`};
}
function actualSessionState(session){
 if(session.status==='cancelled')return 'cancelled';
 const runs=session.runs||[];if(runs.some(r=>r.status==='shooting'))return 'live';if(runs.some(r=>r.status==='blocked'))return 'blocked';
 if(runs.length&&runs.every(r=>r.status==='completed'))return 'completed';return 'scheduled';
}
function boardView(state){
 return {protocolVersion:3,revision:state.revisions.projectionRevision,
  tasks:state.orderFacts.map(r=>{const sessions=state.sessions.filter(s=>s.requestIds.includes(r.id));const states=sessions.map(actualSessionState);const status=r.lifecycle==='cancelled'?'cancelled':states.includes('live')?'live':states.includes('blocked')?'blocked':states.length&&states.every(s=>s==='completed')?'completed':states.length?'scheduled':'pending';return {...r,sku:r.submission.sku,deliver:r.submission.coreBriefSummary,status,request:{...r.submission,deliverableCount:r.submission.deliverables.count}};}),
  sessions:state.sessions.map(s=>({...s,date:beijingParts(s.plannedStart).date,start:beijingParts(s.plannedStart).time,end:beijingParts(s.plannedEnd).time,ids:s.requestIds,place:'Jenn',actualState:actualSessionState(s)}))};
}

return {boardView,beijingParts};})();
const {clearReferenceImages,retainReferenceImages,referenceGallery}=(()=>{const images=new Map();
let generation=0;
const key=reference=>JSON.stringify([reference.id,reference.name,reference.contentType,reference.sha256,reference.size]);
function discard(id,entry){if(entry.url)URL.revokeObjectURL(entry.url);images.delete(id);}
function clearReferenceImages(){generation++;for(const [id,entry] of images)discard(id,entry);}
function retainReferenceImages(references){
 const valid=new Set(references.map(key));
 for(const [id,entry] of images)if(!valid.has(id))discard(id,entry);
}
function referenceGallery(references,getToken,publicBoard=false){
 const galleryGeneration=generation;
 const root=document.createElement('div');root.className='reference-gallery';root.style.display='grid';root.style.gap='10px';root.style.minWidth='0';
 for(const reference of references||[]){
  const id=key(reference);
  const button=document.createElement('button');button.type='button';button.textContent='查看参考图：'+reference.name;
  async function open(){
   if(galleryGeneration!==generation||!root.isConnected)return;
   const current=generation,token=getToken();button.disabled=true;button.textContent='正在读取参考图…';
   let entry=images.get(id);
   if(!entry){
    entry={};images.set(id,entry);
    entry.pending=(async()=>{
     const response=await fetch((publicBoard?'/api/v3/public/board/references/':'/api/v3/business/references/')+encodeURIComponent(reference.id),{credentials:publicBoard?'omit':'same-origin',headers:!publicBoard&&token?{Authorization:'Bearer '+token}:{}});
     if(!response.ok)throw Error(publicBoard?'参考图已不可用，请刷新看板后重试。':'参考图读取失败，请重新登录或刷新后重试。');
     const blob=await response.blob();
     if(current!==generation||images.get(id)!==entry||token!==getToken())return;
     entry.url=URL.createObjectURL(blob);
    })();
   }
   try{
    await entry.pending;
    if(current!==generation||images.get(id)!==entry||token!==getToken()||!root.isConnected||!entry.url)return;
    const image=document.createElement('img');image.alt=reference.name;image.src=entry.url;image.style.maxWidth='100%';image.style.maxHeight='320px';image.style.display='block';image.style.height='auto';image.style.objectFit='contain';
    image.addEventListener('error',()=>{image.remove();button.hidden=false;button.textContent='浏览器无法预览此格式；可下载原图。';});
    const link=document.createElement('a');link.href=entry.url;link.download=reference.name;link.textContent='下载参考图：'+reference.name;link.style.display='block';link.style.overflowWrap='anywhere';
    root.append(image,link);button.textContent=reference.name;button.hidden=true;
   }catch(e){
    if(images.get(id)===entry)discard(id,entry);
    if(current===generation&&token===getToken()&&root.isConnected){button.textContent=e.message;button.disabled=false;}
   }
  }
  button.addEventListener('click',open);root.append(button);
  // Reattach the opened image (or the same pending read) after a successful poll.
  if(images.has(id))queueMicrotask(open);
 }
 return root;
}

return {clearReferenceImages,retainReferenceImages,referenceGallery};})();
const {canMove}=(()=>{// Browser-neutral command coordinator. JSO remains the authority for eligibility,
// preview, version checks and the atomic write. No optimistic business mutations.
const identityKey=s=>JSON.stringify([s.principal.subjectId,s.principal.role,[...s.principal.resourceIds].sort()]);
const sameRevision=(a,b)=>a?.scheduleRevision===b?.scheduleRevision&&a?.projectionRevision===b?.projectionRevision;
function canMove(state,s){
 return Boolean(state&&state.principal.role==='administrator'&&state.writeAdmission==='enabled'
  &&state.principal.resourceIds.includes(s.resourceId)&&s.status==='confirmed'&&s.lockStatus==='unlocked'
  &&s.allocationMode==='single'&&s.resourceResolutionStatus==='resolved'&&s.requestIds.length===1
  &&!s.hasRunHistory&&!(s.runs||[]).length&&Number.isSafeInteger(s.bufferAfterMinutes));
}
class CalendarCommand {
 constructor({api,pendingStore,onChange=()=>{},id=()=>`CALENDAR-${crypto.randomUUID()}`}){
  Object.assign(this,{api,pendingStore,onChange,id});this.state=null;this.preview=null;this.pending=null;this.busy=false;this.closed=false;this.generation=0;this.message='';this.abort=new AbortController();
 }
 changed(){if(!this.closed)this.onChange(this);}
 clearAuthentication(){this.generation++;this.state=null;this.preview=null;this.message='登录失效，请到工作安排重新登录；待核对操作保留。';this.changed();}
 async refresh(){
  if(this.closed)return;
  if(this.reading)return this.reading;
  const generation=this.generation;
  this.reading=(async()=>{
   try{
    const next=await this.api('/api/v3/business/state',undefined,this.abort.signal);
    if(this.closed||generation!==this.generation)return;
    const key=identityKey(next);
    if(this.committedRevisions&&key===this.key&&(next.revisions.scheduleRevision<this.committedRevisions.scheduleRevision||next.revisions.projectionRevision<this.committedRevisions.projectionRevision))throw Error('权威投影尚未达到已提交版本。');
    if(this.state&&key===identityKey(this.state)&&(!sameRevision(next.revisions,this.state.revisions))
     &&(next.revisions.projectionRevision<this.state.revisions.projectionRevision||next.revisions.scheduleRevision<this.state.revisions.scheduleRevision))return;
    if(!this.state||key!==identityKey(this.state)){
     this.preview=null;this.committedRevisions=null;this.pending=this.pendingStore.load(key);this.key=key;
    }else if(this.preview&&!sameRevision(next.revisions,this.state.revisions)){
     this.preview=null;this.message='安排已变化，原预览已失效，请重新拖动核对。';
    }
    if(!this.busy)this.pending=this.pendingStore.load(key);
    this.state=next;if(this.message.startsWith('显示待刷新'))this.message='已读取最新排期。';this.changed();return next;
   }catch(e){if(this.closed||generation!==this.generation)return;if(e.status===401||e.status===403)this.clearAuthentication();else{this.message='显示待刷新：'+e.message;this.changed();}throw e;}
  })().finally(()=>{this.reading=null;});
  return this.reading;
 }
 async previewMove(scheduleItemId,plannedStart,endAt){
  if(this.key)this.pending=this.pendingStore.load(this.key);
  if(this.closed||this.busy||this.pending)throw Error('请先完成或核对上一次操作。');
  const s=this.state?.sessions.find(s=>s.id===scheduleItemId);
  if(!s||!canMove(this.state,s))throw Error('此场次不在当前可拖动范围。');
  const day=iso=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(iso));
  if(day(s.plannedStart)!==day(plannedStart)||day(plannedStart)!==day(endAt))throw Error('本轮只支持原日期内调整。');
  const generation=this.generation,key=this.key,revision={...this.state.revisions};
  this.busy=true;this.preview=null;this.message='正在生成 JSO 预览…';this.changed();
  try{
   const input={scheduleItemId:s.id,resourceId:s.resourceId,mode:'plan',plannedStart,endAt,bufferAfterMinutes:s.bufferAfterMinutes};
   const result=await this.api('/api/v3/business/day-adjustment/preview',input,this.abort.signal);
   if(this.closed||generation!==this.generation||key!==this.key)return;
   if(!sameRevision(revision,this.state.revisions)||result.preview.expectedScheduleRevision!==revision.scheduleRevision||result.preview.expectedProjectionRevision!==revision.projectionRevision)throw Error('安排已变化，请刷新后重新预览。');
   this.preview=result;this.message=result.preview.canApply?'请核对全部联动场次，再确认保存。':'预览存在阻断，未改变排期。';
  }catch(e){if(!this.closed&&generation===this.generation){this.message='预览未完成：'+e.message;if(e.status===401||e.status===403)this.clearAuthentication();}throw e;}finally{this.busy=false;this.changed();}
 }
 cancel(){if(this.busy||this.pending)return;this.preview=null;this.message='已取消，原排期未改变。';this.changed();}
 async apply(){
  if(this.key)this.pending=this.pendingStore.load(this.key);
  if(this.closed||this.busy||this.pending||!this.preview?.preview.canApply)throw Error('请先生成可保存的预览。');
  const command={operationId:this.id(),input:structuredClone(this.preview.preview.input),previewDigest:this.preview.previewDigest};
  const pending={operationId:command.operationId,command};
  // Persist before sending; a failed local record must prevent the write.
  this.pendingStore.save(this.key,pending);this.pending=pending;this.busy=true;this.preview=null;this.message='正在保存，请勿重复提交。';this.changed();
  const generation=this.generation;
  try{
   const result=await this.api('/api/v3/business/day-adjustment/apply',command,this.abort.signal);
   if(this.closed||generation!==this.generation)return;
   this.validateReceipt(result,pending);if(this.pendingStore.load(this.key)?.operationId!==pending.operationId)throw Error('待核对记录已变化，请重新核对。');this.pendingStore.save(this.key,null);this.pending=null;
   this.message='已保存，正在读取最新排期。';
  }catch(e){
   if(!this.closed&&generation===this.generation){
    if(e.definite){this.pendingStore.save(this.key,null);this.pending=null;this.message='未保存：'+e.message;}
    else this.message='保存结果待核对；保留原操作号，只查询回执，不重新提交。';
    if(e.status===401||e.status===403)this.clearAuthentication();
   }
   throw e;
  }finally{this.busy=false;this.changed();}
  // A projection read failure does not turn a confirmed write into a failed write.
  try{await this.reading?.catch(()=>{});await this.refresh();if(!this.closed&&generation===this.generation){this.message='已保存并更新排期。';this.changed();}}
  catch{if(!this.closed){this.message='已保存，显示待刷新。';this.changed();}}
 }
 validateReceipt(result,pending){
  const r=result.receipt;
  if(r?.operationId!==pending.operationId||r.kind!=='dynamic-day-adjustment'||r.actor?.subjectId!==this.state?.principal.subjectId||r.previewDigest!==pending.command.previewDigest)throw Error('回执不匹配，请保留原操作核对。');
  if(Number.isSafeInteger(r.scheduleRevision)&&Number.isSafeInteger(r.projectionRevision))this.committedRevisions={scheduleRevision:r.scheduleRevision,projectionRevision:r.projectionRevision};
 }
 async recover(){
  if(this.key)this.pending=this.pendingStore.load(this.key);
  if(!this.pending||this.busy||this.closed||!this.state)return;
  const generation=this.generation,pending=this.pending;this.busy=true;this.changed();
  try{
   const result=await this.api('/api/v3/business/operations/'+encodeURIComponent(pending.operationId),undefined,this.abort.signal);
   if(this.closed||generation!==this.generation)return;
   this.validateReceipt(result,pending);if(this.pendingStore.load(this.key)?.operationId!==pending.operationId)throw Error('待核对记录已变化，请重新核对。');this.pendingStore.save(this.key,null);this.pending=null;this.message='已找到原操作成功回执。';
  }catch(e){if(!this.closed&&generation===this.generation){this.message='原操作仍待核对（未找到不代表未提交）：'+e.message;if(e.status===401||e.status===403)this.clearAuthentication();}throw e;}
  finally{this.busy=false;this.changed();}
  try{await this.reading?.catch(()=>{});await this.refresh();}catch{/* confirmed receipt remains successful */}
 }
 close(){this.closed=true;this.generation++;this.preview=null;this.abort.abort();}
}

return {canMove};})();
const {mountManagementCalendar}=(()=>{
let protocolVersion=1,token='',authEpoch=0,publicBoard=false;
const displayState=(session,tasks)=>protocolVersion===3?session.actualState:sessionState(session,tasks);
const today=()=>protocolVersion===3?new Date(beijingParts(new Date()).date+'T12:00:00'):new Date();
const $ = selector => document.querySelector(selector);
const calendar = $('#calendar');
const message = $('#message');
const board = $('#board');
const agenda = $('#day-agenda');
const mobile = matchMedia('(max-width: 760px)');
const labels = { live: '拍摄中', scheduled: '已排期', blocked:'受阻', completed: '已完成', cancelled: '已取消' };
const editingCalendar=document.body.hasAttribute('data-calendar-editor');
let editor=null;
let editorLoading=false;
let currentSnapshot;
let viewMode = 'week';
let anchorDate = new Date();
let openCard;
let pinnedCard;
let clockTimer;
const expandedPending=new Set();

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function maps(snapshot) {
  const taskById = new Map(snapshot.tasks.map(task => [task.id, task]));
  const sessionsByDate = new Map();
  snapshot.sessions.forEach(session => {
    const items = sessionsByDate.get(session.date) || [];
    items.push(session);
    sessionsByDate.set(session.date, items);
  });
  sessionsByDate.forEach(items => items.sort((a, b) => a.start.localeCompare(b.start)));
  return { taskById, sessionsByDate };
}

function taskType(task) {
  if(protocolVersion===3)return task.kind==='静物'?'静物 / '+task.shootingSubtype:task.shootingSubtype==='细节'?'历史细节（未细分）':task.shootingSubtype;
  return [task.request?.productionType || '未分类', task.request?.shootingSubtype || task.kind].filter(Boolean).join(' · ');
}

function closeCard() {
  if (openCard) {
    openCard.classList.remove('is-open');
    openCard.querySelector('.session-summary').setAttribute('aria-expanded', 'false');
    openCard.querySelector('.session-peek').hidden = true;
  }
  openCard = null;
  pinnedCard = null;
}

function expandCard(item) {
  if (openCard && openCard !== item) closeCard();
  const bounds = item.getBoundingClientRect();
  const width = Math.min(248, innerWidth - 32 - bounds.width);
  item.style.setProperty('--peek-width', width + 'px');
  item.classList.toggle('expand-left', !mobile.matches && bounds.right + width > innerWidth - 24);
  item.classList.add('is-open');
  item.querySelector('.session-summary').setAttribute('aria-expanded', 'true');
  item.querySelector('.session-peek').hidden = false;
  openCard = item;
}

function showDetails(session, tasks) {
  $('#session-dialog').dataset.sessionId=session.id;
  closeCard();
  const content = $('#session-dialog-content');
  const head = element('div', 'session-detail-meta');
  head.append(element('span', 'status-badge ' + displayState(session, tasks), labels[displayState(session, tasks)]),
    element('p', '', '计划 '+session.date + ' · ' + session.start + '–' + session.end),
    element('p', '', session.place || '地点待确认'));
  if(protocolVersion===3){
    head.append(element('p','','已确认预计结束：'+(session.confirmedForecast?beijingParts(session.confirmedForecast.estimatedEnd).time:'尚未确认')));
    for(const run of session.runs||[])head.append(element('p','','实际开拍：'+(run.startedAt?beijingParts(run.startedAt).time:'未发生')+'；实际完成：'+(run.completedAt?beijingParts(run.completedAt).time:'未发生')));
  }
  const sections = tasks.map(task => {
    const section = element('section', 'detail-task');
    section.append(element('h3', '', task.name), element('p', 'muted', taskType(task) + ' · ' + task.sku));
    const description = element('dl', 'detail-list');
    const request = task.request;
    const pairs = [['拍摄要求', task.deliver], ['客户', task.client], ['任务状态', { live:'拍摄中', blocked:'受阻', pending: '待排期', scheduled: '已排期', blocked:'受阻', completed: '已完成', cancelled: '已取消' }[task.status] || '未标记']];
    if (request) pairs.push(['提报人', request.requestedBy], ['期望日期', request.desiredDate], ['交付', [request.deliverableCount ? request.deliverableCount + ' 份' : '', request.aspectRatio, request.durationSeconds ? request.durationSeconds + ' 秒' : '', request.audioRequirement].filter(Boolean).join(' · ')], ['补充说明', request.note]);
    for (const [label, value] of pairs) {
      if (value) description.append(element('dt', '', label), element('dd', '', value));
    }
    section.append(description,referenceGallery(task.references,()=>token,publicBoard));
    return section;
  });
  content.replaceChildren(head, ...sections);
  if (session.note) content.append(element('h3', '', '场次备注'), element('p', 'preserve-lines', session.note));
  $('#session-dialog').showModal();
}

function sessionElement(session, taskById, mode = 'week') {
  const tasks = session.ids.map(id => taskById.get(id)).filter(Boolean);
  const names = session.ids.map(id => taskById.get(id)?.name || id).join(' / ');
  const state = displayState(session, tasks);
  const types = new Set(tasks.map(task => task.request?.productionType));
  const item = element('article', 'session-card ' + mode + '-session ' + (types.has('视频') ? 'video' : 'print') + ' state-' + state);
  item.dataset.sessionId = session.id;
  const summary = element('button', 'session-summary');
  summary.type = 'button';
  summary.setAttribute('aria-label', session.start + '至' + session.end + '，' + names + '，' + labels[state] + '，展开详情');
  summary.setAttribute('aria-expanded', 'false');
  const top = element('span', 'session-top');
  top.append(element('time', '', session.start + '–' + session.end));
  const badge = element('span', 'status-badge ' + state, labels[state]);
  if (protocolVersion!==3&&state === 'live') badge.title = '按排班时间显示，不代表实际开拍确认';
  summary.append(top, element('strong', 'session-name', names), badge);
  if(protocolVersion===3&&session.confirmedForecast)summary.append(element('small','','预计 '+beijingParts(session.confirmedForecast.estimatedEnd).time));
  const peek = element('div', 'session-peek');
  peek.hidden = true;
  const detail = element('div', 'peek-meta');
  detail.append(element('span', 'peek-label', '拍摄详情'), element('p', '', [...new Set(tasks.map(taskType))].join(' / ')), element('p', 'muted', session.place || '地点待确认'));
  const more = element('button', 'text-button', '查看完整详情 ↗');
  more.type = 'button';
  more.addEventListener('click', () => showDetails(session, tasks));
  peek.append(detail, more);
  item.append(summary, peek);
  item.addEventListener('pointerenter', event => {
    if (event.pointerType === 'mouse' && !mobile.matches) expandCard(item);
  });
  item.addEventListener('pointerleave', () => {
    if (openCard === item && pinnedCard !== item && !item.contains(document.activeElement)) closeCard();
  });
  summary.addEventListener('focus', () => { if (!mobile.matches) expandCard(item); });
  item.addEventListener('focusout', event => {
    if (!item.contains(event.relatedTarget) && openCard === item) closeCard();
  });
  summary.addEventListener('click', () => {
    if (pinnedCard === item) closeCard();
    else { expandCard(item); pinnedCard = item; }
  });
  if(editingCalendar && mode==='week')editor?.decorate(item,session);
  return item;
}

function selectDay(date) {
  anchorDate = date;
  renderCalendar();
  const selected = calendar.querySelector('[aria-pressed="true"]');
  selected?.focus({ preventScroll: true });
}

function dayButton(date, className, text) {
  const button = element('button', className, text);
  button.type = 'button';
  const key = dateKey(date);
  button.setAttribute('aria-label', key + '，查看当日场次');
  button.setAttribute('aria-pressed', String(key === dateKey(anchorDate)));
  if (key === dateKey(today())) {
    button.classList.add('today');
    button.setAttribute('aria-current', 'date');
  }
  button.addEventListener('click', () => selectDay(date));
  return button;
}

function renderAgenda(taskById, sessionsByDate) {
  const sessions = sessionsByDate.get(dateKey(anchorDate)) || [];
  const title = element('div', 'section-title');
  title.append(element('h2', '', (anchorDate.getMonth() + 1) + '月' + anchorDate.getDate() + '日'), element('span', 'muted', sessions.length + ' 场拍摄'));
  agenda.replaceChildren(title, ...sessions.map(session => sessionElement(session, taskById, 'agenda')));
  if (!sessions.length) agenda.append(element('p', 'empty-state', '当天暂无拍摄安排'));
}

function renderWeek(taskById, sessionsByDate) {
  $('#calendar-weekdays').hidden = true;
  calendar.className = 'week-calendar';
  const start = mondayOf(anchorDate);
  const dates = Array.from({ length: 7 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
  $('#calendar-title').textContent = start.getFullYear() + '年' + (start.getMonth() + 1) + '月' + start.getDate() + '日 — ' + (dates[6].getMonth() + 1) + '月' + dates[6].getDate() + '日';
  const sessions = dates.flatMap(date => sessionsByDate.get(dateKey(date)) || []);
  const startHour = Math.min(9, ...sessions.map(session => Math.floor(minutes(session.start) / 60)));
  const endHour = Math.max(19, ...sessions.map(session => Math.ceil(Math.max(minutes(session.end), minutes(session.start) + 60) / 60)));
  const height = (endHour - startHour) * 64;
  calendar.style.setProperty('--timeline-height', height + 'px');
  const corner = element('div', 'week-corner', '时间');
  const heads = dates.map((date, index) => {
    const button = dayButton(date, 'week-dayhead');
    const inner = element('span', 'dayhead-inner');
    inner.append(element('span', '', '周' + '一二三四五六日'[index]), element('strong', '', date.getDate()));
    const count = (sessionsByDate.get(dateKey(date)) || []).length;
    if (count) inner.append(element('small', 'day-count', count + ' 场'));
    button.append(inner);
    return button;
  });
  const hours = element('div', 'week-hours');
  for (let hour = startHour; hour < endHour; hour += 1) {
    const label = element('span', '', String(hour).padStart(2, '0') + ':00');
    label.style.top = (hour - startHour) * 64 + 'px';
    hours.append(label);
  }
  const lanes = dates.map(date => {
    const lane = element('div', 'week-lane');
    lane.dataset.date=dateKey(date);lane.dataset.startMinute=String(startHour*60);
    layoutSessions(sessionsByDate.get(dateKey(date)) || []).forEach(({ session, column, columns }) => {
      const item = sessionElement(session, taskById);
      item.style.top = (minutes(session.start) - startHour * 60) * 64 / 60 + 5 + 'px';
      item.style.height = Math.max(54, (minutes(session.end) - minutes(session.start)) * 64 / 60 - 10) + 'px';
      item.style.left = 'calc(' + column * 100 / columns + '% + 5px)';
      item.style.width = 'calc(' + 100 / columns + '% - 10px)';
      if (minutes(session.end) - minutes(session.start) < 75) item.classList.add('short-session');
      if (columns > 1) item.classList.add('overlap-session');
      lane.append(item);
    });
    return lane;
  });
  calendar.replaceChildren(corner, ...heads, hours, ...lanes);
  $('#period-summary').textContent = sessions.length ? '本周 ' + sessions.length + ' 场拍摄' : '本周暂无拍摄安排';
}

function renderMonth(taskById, sessionsByDate) {
  $('#calendar-weekdays').hidden = false;
  calendar.className = 'calendar-grid';
  const year = anchorDate.getFullYear();
  const month = anchorDate.getMonth();
  $('#calendar-title').textContent = year + '年' + (month + 1) + '月';
  const start = mondayOf(new Date(year, month, 1));
  const cells = [];
  let total = 0;
  for (let index = 0; index < 42; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const sessions = sessionsByDate.get(dateKey(date)) || [];
    const cell = element('section', 'calendar-day' + (date.getMonth() !== month ? ' outside-month' : ''));
    const number = dayButton(date, 'calendar-date', date.getDate());
    number.setAttribute('aria-label', dateKey(date) + '，' + sessions.length + ' 场拍摄');
    cell.append(number);
    if (date.getMonth() === month) total += sessions.length;
    const list = element('div', 'month-sessions');
    list.append(...sessions.map(session => sessionElement(session, taskById, 'month')));
    cell.append(list);
    if (sessions.length) cell.append(element('span', 'month-count', sessions.length + ' 场'));
    cells.push(cell);
  }
  calendar.replaceChildren(...cells);
  $('#period-summary').textContent = total ? '本月 ' + total + ' 场拍摄' : '本月暂无拍摄安排';
}

function renderCalendar() {
  if (!currentSnapshot) return;
  closeCard();
  const { taskById, sessionsByDate } = maps(currentSnapshot);
  $('#view-week').setAttribute('aria-pressed', String(viewMode === 'week'));
  $('#view-month').setAttribute('aria-pressed', String(viewMode === 'month'));
  $('#previous-period').setAttribute('aria-label', viewMode === 'week' ? '上一周' : '上一月');
  $('#next-period').setAttribute('aria-label', viewMode === 'week' ? '下一周' : '下一月');
  if (viewMode === 'week') renderWeek(taskById, sessionsByDate);
  else renderMonth(taskById, sessionsByDate);
  renderAgenda(taskById, sessionsByDate);
}

function renderPending(snapshot) {
  const scheduled = new Set(snapshot.sessions.flatMap(session => session.ids));
  const tasks = snapshot.tasks.filter(task => !scheduled.has(task.id) && task.status !== 'cancelled');
  const validIds=new Set(tasks.map(task=>task.id));
  for(const id of expandedPending)if(!validIds.has(id))expandedPending.delete(id);
  $('#pending-count').textContent = tasks.length;
  const cards = tasks.map(task => {
    const item = element('article', 'pending-task');
    const button = element('button', 'pending-summary');
    button.type = 'button';
    button.append(element('strong', '', task.name), element('span', 'muted', taskType(task)));
    if (task.request?.desiredDate) button.append(element('small', '', '期望 ' + task.request.desiredDate.slice(5).replace('-', '月') + '日'));
    const detail = element('div', 'pending-detail');
    detail.hidden = !expandedPending.has(task.id);
    detail.append(element('p', '', 'SKU · ' + task.sku), element('p', 'preserve-lines', task.deliver), element('p', 'muted', task.request?.requestedBy || task.client));
    button.setAttribute('aria-expanded', String(!detail.hidden));
    button.addEventListener('click', () => {
      detail.hidden = !detail.hidden;
      if(detail.hidden)expandedPending.delete(task.id);else expandedPending.add(task.id);
      button.setAttribute('aria-expanded', String(!detail.hidden));
    });
    detail.append(referenceGallery(task.references,()=>token,publicBoard));
    item.append(button, detail);
    return item;
  });
  $('#pending').replaceChildren(...cards);
  if (!tasks.length) $('#pending').append(element('p', 'empty-state', '暂无待排任务'), element('a', 'text-link', '提交拍摄需求 →'));
  const link = $('#pending .text-link');
  if (link) link.href = protocolVersion===3?'/manage':'/submit';
}

function clearBoardReadView(){
  board.hidden=true;currentSnapshot=null;clearReferenceImages();expandedPending.clear();clearInterval(clockTimer);
  $('#session-dialog').close();$('#session-dialog-content').replaceChildren();$('#pending').replaceChildren();calendar.replaceChildren();agenda.replaceChildren();
}

async function loadBoard() {
  if(editingCalendar){
    if(!editor||editorLoading||editor.blocked())return;
    editorLoading=true;
    try{await editor.read();}finally{editorLoading=false;}
    return;
  }
  let epoch=authEpoch;
  $('#retry').hidden=true;showMessage(message,'正在读取排班…');
  try{
    const profile=await fetch('/api/client-profile',{credentials:'omit',cache:'no-store'});if(!profile.ok)throw Error('服务暂时不可用，请稍后重试。');
    const profileResult=await profile.json();if(epoch!==authEpoch)return;protocolVersion=profileResult.protocolVersion;
    const nextPublicBoard=profileResult.publicBoard===true;
    if(publicBoard!==nextPublicBoard){
      authEpoch++;epoch=authEpoch;token='';clearBoardReadView();$('#board-token').value='';$('#board-login').hidden=true;$('#board-logout').hidden=true;
    }
    publicBoard=nextPublicBoard;
    if(protocolVersion===3){
      $('#create-order-link').href='/manage';$('#create-order-link').textContent='＋ 新建订单';$('#create-order-link').hidden=publicBoard;document.querySelector('.pending-panel').hidden=publicBoard;
      document.querySelector('.legend').textContent='北京时间 · 实际进度以开拍和完成记录为准';
      if(!token&&!publicBoard){clearBoardReadView();$('#board-login').hidden=false;showMessage(message,'请使用 Jenn 业务身份登录。');return;}
    }
    const response=await fetch(protocolVersion===3?(publicBoard?'/api/v3/public/board':'/api/v3/business/board'):'/api/v1/snapshot',{credentials:publicBoard?'omit':'same-origin',cache:'no-store',headers:!publicBoard&&token?{Authorization:'Bearer '+token}:{}});
    if(!response.ok)throw Error(response.status===401?'登录失效或令牌无效，请重新登录。':response.status===403?'没有此看板的访问权限。':'排班读取失败，请刷新重试。');
    const result=await response.json();if(epoch!==authEpoch)return;const detailId=$('#session-dialog').open?$('#session-dialog').dataset.sessionId:null;
    currentSnapshot=protocolVersion===3?boardView(result):result.snapshot;
    retainReferenceImages(currentSnapshot.tasks.flatMap(task=>task.references||[]));
    if(protocolVersion===3&&!board.dataset.loaded)anchorDate=today();
    board.dataset.loaded='yes';renderCalendar();renderPending(currentSnapshot);if(detailId){const selected=currentSnapshot.sessions.find(s=>s.id===detailId);if(selected)showDetails(selected,currentSnapshot.tasks.filter(t=>selected.ids.includes(t.id)));else $('#session-dialog').close();}
    $('#revision').textContent='数据版本 '+currentSnapshot.revision+' · 看板只读';board.hidden=false;
    $('#board-login').hidden=true;$('#board-logout').hidden=protocolVersion!==3||publicBoard;showMessage(message,'');
    clearInterval(clockTimer);clockTimer=setInterval(protocolVersion===3?loadBoard:updateLiveStates,30000);
  }catch(e){if(epoch!==authEpoch)return;clearBoardReadView();if(protocolVersion===3&&!publicBoard)$('#board-login').hidden=false;showMessage(message,e.message,'error');$('#retry').hidden=false;}
}
$('#board-login').addEventListener('submit',e=>{e.preventDefault();authEpoch++;clearReferenceImages();expandedPending.clear();token=$('#board-token').value;$('#board-token').value='';loadBoard();});
$('#board-logout').addEventListener('click',()=>{authEpoch++;token='';clearBoardReadView();$('#board-login').hidden=false;$('#board-logout').hidden=true;showMessage(message,'已退出。');});

function updateLiveStates() {
  if (!currentSnapshot) return;
  const { taskById } = maps(currentSnapshot);
  currentSnapshot.sessions.forEach(session => {
    const state = displayState(session, session.ids.map(id => taskById.get(id)).filter(Boolean));
    document.querySelectorAll('.session-card').forEach(item => {
      if (item.dataset.sessionId !== session.id) return;
      Object.keys(labels).forEach(key => item.classList.toggle('state-' + key, key === state));
      const badge = item.querySelector('.status-badge');
      badge.className = 'status-badge ' + state;
      badge.textContent = labels[state];
      badge.title = state === 'live' ? '按排班时间显示，不代表实际开拍确认' : '';
      const names = session.ids.map(id => taskById.get(id)?.name || id).join(' / ');
      item.querySelector('.session-summary').setAttribute('aria-label', session.start + '至' + session.end + '，' + names + '，' + labels[state] + '，展开详情');
    });
  });
}

$('#view-week').addEventListener('click', () => { viewMode = 'week'; renderCalendar(); });
$('#view-month').addEventListener('click', () => { viewMode = 'month'; renderCalendar(); });
function movePeriod(direction) {
  anchorDate = viewMode === 'month'
    ? new Date(anchorDate.getFullYear(), anchorDate.getMonth() + direction, Math.min(anchorDate.getDate(), new Date(anchorDate.getFullYear(), anchorDate.getMonth() + direction + 1, 0).getDate()))
    : new Date(anchorDate.getFullYear(), anchorDate.getMonth(), anchorDate.getDate() + direction * 7);
  renderCalendar();
}
$('#previous-period').addEventListener('click', () => movePeriod(-1));
$('#next-period').addEventListener('click', () => movePeriod(1));
$('#current-period').addEventListener('click', () => { anchorDate = today(); renderCalendar(); });
$('#retry').addEventListener('click', loadBoard);
$('#close-session').addEventListener('click', () => $('#session-dialog').close());
$('#session-dialog').addEventListener('click', event => {
  const rect = event.currentTarget.getBoundingClientRect();
  if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) event.currentTarget.close();
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && openCard) {
    openCard.querySelector('.session-summary').focus({ preventScroll: true });
    closeCard();
  }
});
document.addEventListener('click', event => { if (openCard && !openCard.contains(event.target)) closeCard(); });
mobile.addEventListener('change', closeCard);
window.addEventListener('resize', () => {
  if (openCard) expandCard(openCard);
});
if(!editingCalendar)loadBoard();

// The ordinary /board never installs a write adapter. The separate authenticated
// candidate explicitly supplies its reader and gestures; rendering stays shared.
function mountManagementCalendar(adapter){
 if(!editingCalendar||editor)throw Error('CALENDAR_HOST_INVALID');
 editor=adapter;protocolVersion=3;
 $('#create-order-link').href='/manage';$('#create-order-link').textContent='＋ 新建订单';
 $('#board-login').hidden=true;$('#board-logout').hidden=true;
 document.querySelector('.legend').textContent='北京时间 · 拖动同日场次后预览，确认才保存';
 const publish=state=>{
  const next=boardView(state);
  if(currentSnapshot&&next.revision<currentSnapshot.revision)return;
  if(!currentSnapshot)anchorDate=new Date(state.businessToday+'T12:00:00');
  currentSnapshot=next;board.hidden=false;
  retainReferenceImages(next.tasks.flatMap(t=>t.references||[]));
  renderCalendar();renderPending(next);
  $('#revision').textContent='数据版本 '+next.revision+' · 已提交事实';
 };
 const clear=()=>clearBoardReadView();
 const refresh=()=>loadBoard();
 const resume=()=>{if(!document.hidden)refresh();};
 document.addEventListener('visibilitychange',resume);window.addEventListener('online',refresh);
 clockTimer=setInterval(refresh,5000);
 return {publish,clear,refresh,close(){clearInterval(clockTimer);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',refresh);clear();editor=null;}};
}

return {mountManagementCalendar};})();
const {mountCalendarEditor}=(()=>{function mountCalendarEditor({commandFactory,withSaveLock=(_command,fn)=>fn()}){
const $=s=>document.querySelector(s),dialog=$('#adjustment-dialog');
const previewText=document.createElement('pre');previewText.dataset.jsoPreview='';previewText.style.whiteSpace='pre-wrap';dialog.insertBefore(previewText,$('#adjustment-changes'));
$('#adjustment-confirm').dataset.jsoSave='';
let host,command,gesture=null,suppressUntil=0,disposed=false,lastSignature=null;
const local=iso=>{const p=beijingParts(iso);return p.date+' '+p.time;};
function changed(c){
 if(disposed)return;
 $('#message').textContent=c.message;
 const signature=c.state?JSON.stringify([c.state.revisions,c.state.principal,c.state.writeAdmission]):null;
 if(signature!==lastSignature){if(gesture)cancelGesture();lastSignature=signature;if(c.state)host.publish(c.state);else host.clear();}
 $('#save-recovery').hidden=!c.pending;$('#recover-save').disabled=c.busy||!c.state;
 $('#adjustment-confirm').disabled=c.busy||!c.preview?.preview.canApply||Boolean(c.pending);
 $('#adjustment-cancel').disabled=c.busy;
 if(!c.preview){if(dialog.open)dialog.close();return;}
 const p=c.preview.preview;
 previewText.textContent=c.preview.presentation||'';previewText.hidden=!c.preview.presentation;
 $('#adjustment-changes').hidden=Boolean(c.preview.presentation);
 $('#adjustment-summary').textContent=c.message+' 实际开拍、完成记录不会被改写。';
 const rows=p.changes.map(v=>`${v.before.scheduleItemId}\n${local(v.before.plannedStart)}–${local(v.before.plannedEnd)} → ${local(v.after.plannedStart)}–${local(v.after.plannedEnd)}；缓冲 ${v.after.bufferAfterMinutes} 分钟`);
 for(const issue of [...p.warnings,...p.unresolved])rows.push((issue.scheduleItemId||'')+' '+issue.code);
 $('#adjustment-changes').replaceChildren(...rows.map(text=>{const li=document.createElement('li');li.textContent=text;return li;}));
 if(!dialog.open)dialog.showModal();
}
function cleanGesture(){
 const g=gesture;gesture=null;document.querySelectorAll('.calendar-drag-shadow').forEach(e=>e.remove());
 if(g?.target.hasPointerCapture(g.pointerId))g.target.releasePointerCapture(g.pointerId);
}
function cancelGesture(){if(!gesture)return;cleanGesture();$('#message').textContent='已取消拖动，原排期未改变。';}
function decorate(item,s){
 if(!canMove(command.state,s))return;
 item.classList.add('calendar-movable');
 item.querySelector('.session-summary').addEventListener('pointerdown',e=>{
  if(e.button!==0||gesture||command.busy||command.pending||dialog.open)return;
  const lane=item.closest('.week-lane');
  if(!lane)return;
  gesture={target:e.currentTarget,pointerId:e.pointerId,x:e.clientX,y:e.clientY,moved:false,lane,s,candidate:null};
  e.currentTarget.setPointerCapture(e.pointerId);
 });
}
function move(e){
 const g=gesture;if(!g||g.pointerId!==e.pointerId)return;
 if(!g.moved&&Math.hypot(e.clientX-g.x,e.clientY-g.y)<5)return;
 g.moved=true;e.preventDefault();g.candidate=null;
 document.querySelectorAll('.calendar-drag-shadow').forEach(el=>el.remove());
 const rect=g.lane.getBoundingClientRect();
 if(e.clientX<rect.left||e.clientX>rect.right||e.clientY<rect.top||e.clientY>rect.bottom){$('#message').textContent='仅支持原日期时间列，移出后松手取消。';return;}
 const delta=Math.round((e.clientY-g.y)/64*60/15)*15;
 const start=new Date(Date.parse(g.s.plannedStart)+delta*60000).toISOString(),end=new Date(Date.parse(g.s.plannedEnd)+delta*60000).toISOString();
 if(beijingParts(start).date!==g.lane.dataset.date||beijingParts(end).date!==g.lane.dataset.date)return;
 g.candidate={start,end};
 const shadow=document.createElement('div');shadow.className='calendar-drag-shadow';shadow.textContent=beijingParts(start).time+'–'+beijingParts(end).time+' · 待预览';
 const t=beijingParts(start).time.split(':').map(Number);shadow.style.top=((t[0]*60+t[1]-Number(g.lane.dataset.startMinute))*64/60+5)+'px';shadow.style.height=Math.max(54,(Date.parse(end)-Date.parse(start))/60000*64/60-10)+'px';g.lane.append(shadow);
 $('#message').textContent='松手生成整批调整预览，确认后才保存。';
}
function run(fn){const before=command.message;Promise.resolve().then(fn).catch(e=>{if(!disposed){command.message=command.message!==before?command.message:e.message;changed(command);}});}
function up(e){
 const g=gesture;if(!g||e.pointerId!==g.pointerId)return;cleanGesture();
 if(!g.moved)return;suppressUntil=Date.now()+450;
 if(!g.candidate){$('#message').textContent='已取消拖动，原排期未改变。';return;}
 if(g.candidate.start===g.s.plannedStart)return;
 run(()=>command.previewMove(g.s.id,g.candidate.start,g.candidate.end));
}
function suppress(e){if(e.target.closest('#calendar')&&Date.now()<suppressUntil){e.preventDefault();e.stopImmediatePropagation();}}
const keydown=e=>{if(e.key==='Escape')cancelGesture();};
const lost=e=>{if(gesture?.pointerId===e.pointerId)cancelGesture();};
const pagehide=()=>{if(disposed)return;disposed=true;cleanGesture();command.close();host.close();document.removeEventListener('pointermove',move);document.removeEventListener('pointerup',up);document.removeEventListener('pointercancel',cancelGesture);document.removeEventListener('lostpointercapture',lost);document.removeEventListener('click',suppress,true);document.removeEventListener('keydown',keydown);window.removeEventListener('blur',cancelGesture);window.removeEventListener('jso-session-changed',sessionChanged);window.removeEventListener('pagehide',pagehide);};
function sessionChanged(e){if(!e.detail.authenticated){cancelGesture();command.clearAuthentication();}}
command=commandFactory({onChange:changed});
host=mountManagementCalendar({read:()=>command.refresh().catch(()=>{}),decorate,blocked:()=>Boolean(gesture)||command.busy});
const locked=fn=>withSaveLock(command,fn);
$('#adjustment-confirm').addEventListener('click',()=>run(()=>locked(()=>command.apply())));
$('#adjustment-cancel').addEventListener('click',()=>command.cancel());
dialog.addEventListener('cancel',e=>{e.preventDefault();command.cancel();});
$('#recover-save').addEventListener('click',()=>run(()=>locked(()=>command.recover())));
document.addEventListener('pointermove',move);document.addEventListener('pointerup',up);document.addEventListener('pointercancel',cancelGesture);document.addEventListener('lostpointercapture',lost);document.addEventListener('click',suppress,true);document.addEventListener('keydown',keydown);window.addEventListener('blur',cancelGesture);window.addEventListener('jso-session-changed',sessionChanged);window.addEventListener('pagehide',pagehide,{once:true});
const pageshow=e=>{if(e.persisted)window.location.reload();};window.addEventListener('pageshow',pageshow);
return {command,refresh:()=>command.refresh(),close:pagehide,proof(kind,input){
 const p=command.preview;const hit=kind==='mouse'?document.elementFromPoint(input.x,input.y):document.activeElement;const save=$('#adjustment-confirm');
 return {eligible:Boolean(!disposed&&dialog.open&&p?.previewId&&p.preview.canApply&&previewText.textContent===p.presentation&&(hit===save||save.contains(hit))&&(!save.disabled||command.busy)&&save.getBoundingClientRect().height>0),text:p?.previewId,conversationId:command.viewId};
}};
}

return {mountCalendarEditor};})();
const {createNativeCalendar}=(()=>{// Renderer intent port only: no HTTP, credentials, local business persistence or
// approval flag. The existing main-process editor owns preview IDs and writes.
function nativeManagement(data){
 const progress=new Map((data.progress||[]).map(p=>[p.scheduleItemId,p]));
 return {ok:true,protocolVersion:3,businessToday:data.businessToday,revisions:data.revisions,writeAdmission:data.writeAdmission,
  principal:{subjectId:'host-bound-display',role:'administrator',resourceIds:(data.resources||[]).map(r=>r.resourceId)},
  orderFacts:(data.orders||[]).map(o=>({...o,references:[],submission:{sku:o.sku||'',coreBriefSummary:o.coreBriefSummary||o.name,productionType:o.productionType,shootingSubtype:o.shootingSubtype,requestedBy:o.requestedBy,desiredDate:o.desiredDate,deliverables:{count:o.deliverableCount}}})),
  sessions:(data.sessions||[]).map(s=>({...s,id:s.scheduleItemId,requestIds:progress.get(s.scheduleItemId)?.requestIds||[],runs:progress.get(s.scheduleItemId)?.runs||[],confirmedForecast:progress.get(s.scheduleItemId)?.confirmedForecast??null}))};
}
function createNativeCalendar({emit,onChange,viewId}){
 const c={state:null,preview:null,pending:null,busy:false,message:'正在读取 JSO…',viewId,closed:false,requestId:null,denied:true,saving:false,
  changed(){if(!this.closed)onChange(this);},
  async refresh(){}, // The trusted host already coalesces authenticated 5s reads.
  update(data){
   if(this.closed||!data?.revisions)return;if(this.denied){this.lastData=data;return;}
   if(this.state&&data.ownerBinding===this.ownerBinding&&['scheduleRevision','projectionRevision'].some(k=>data.revisions[k]<this.state.revisions[k]))return;
   const bindingChanged=this.ownerBinding&&this.ownerBinding!==data.ownerBinding;
   if(bindingChanged){this.preview=null;this.requestId=null;this.busy=false;if(this.saving)this.pending={hostJournal:true};this.saving=false;emit({kind:'cancel',viewId});this.message='业务身份范围已变化，请重新核对。';}
   const previous=this.state?.revisions;
   if(this.preview&&previous&&(previous.scheduleRevision!==data.revisions.scheduleRevision||previous.projectionRevision!==data.revisions.projectionRevision)){
    this.preview=null;this.requestId=null;emit({kind:'cancel',viewId});this.message='JSO 已有新安排，请重新拖动核对。';
   }
   this.ownerBinding=data.ownerBinding;this.lastData=data;this.state=nativeManagement(data);this.changed();
  },
  async previewMove(id,start,end){
   if(this.closed||this.busy||this.pending||!this.state)throw Error('请先完成或核对原操作。');
   const s=this.state.sessions.find(s=>s.id===id);if(!s)throw Error('场次已变化。');
   this.requestId=crypto.randomUUID();this.preview=null;this.busy=true;this.message='正在读取 JSO 整批预览…';this.changed();
   emit({kind:'preview',viewId,requestId:this.requestId,baseRevisions:{...this.state.revisions},input:{scheduleItemId:id,resourceId:s.resourceId,mode:'plan',plannedStart:start,endAt:end,bufferAfterMinutes:s.bufferAfterMinutes}});
  },
  async apply(){
   if(this.closed||this.busy||this.pending||!this.preview?.preview.canApply)throw Error('请重新预览后保存。');
   this.busy=true;this.saving=true;this.message='正在保存，等待 JSO 确认…';this.changed();
   emit({kind:'save',viewId,previewId:this.preview.previewId});
  },
  cancel(){if(this.busy||this.pending)return;emit({kind:'cancel',viewId});this.requestId=null;this.preview=null;this.message='已取消，原排期未改变。';this.changed();},
  async recover(){if(!this.busy){this.busy=true;this.changed();emit({kind:'recover',viewId});}},
  clearAuthentication(){if(this.saving)this.pending={hostJournal:true};this.saving=false;this.denied=true;this.state=null;this.preview=null;this.requestId=null;this.busy=false;this.message='读取被拒，请核对宿主连接和业务身份。';this.changed();},
  receive(m){
   if(this.closed||m.viewId!==viewId)return;
   if(m.kind==='read-status'){
    if(m.status==='denied')this.clearAuthentication();
    else if(m.status==='unavailable'&&!this.pending&&!this.busy&&!this.preview){this.message='暂未取回最新安排，当前显示可能过期。';this.changed();}
    else if(m.status==='current'){this.denied=false;if(!this.pending&&!this.busy&&!this.preview&&(this.message==='正在读取 JSO…'||this.message.startsWith('读取被拒')||this.message.startsWith('暂未取回')))this.message='已读取 JSO 最新排期。';if(this.lastData)this.update(this.lastData);else this.changed();}return;
   }
   if(m.kind==='preview'&&m.requestId===this.requestId){
    this.busy=false;
    if(m.ok&&m.preview&&this.state&&m.preview.expectedScheduleRevision===this.state.revisions.scheduleRevision&&m.preview.expectedProjectionRevision===this.state.revisions.projectionRevision){this.preview={preview:m.preview,previewId:m.previewId,presentation:m.presentation};this.message=m.canApply?'请核对整批影响，再实际点击确认保存。':'存在阻断，原排期未改变。';}
    else{this.preview=null;this.requestId=null;this.message=m.message||'安排已变化，请重新预览。';}this.changed();return;
   }
   if(m.kind==='result'){this.busy=false;this.saving=false;this.preview=null;this.requestId=null;this.pending=m.unknown?{hostJournal:true}:null;this.message=m.message;this.changed();}
  },
  close(){if(this.closed)return;this.closed=true;emit({kind:'close',viewId});this.preview=null;this.state=null;}
 };
 return c;
}

return {createNativeCalendar};})();
return mountCalendarEditor({commandFactory:({onChange})=>createNativeCalendar({onChange,viewId:self.viewId,emit:p=>context.emit('jso-editor',p)})});})(doc,win);actualWindow.__jsoChartEditor={viewId:this.viewId,receive:m=>self.view.command.receive(m),proof:(k,i)=>self.view.proof(k,i)};this.view.command.update(context.data);context.emit('jso-editor',{kind:'ready',viewId:this.viewId});context.reportReady?.();},update(change,context){this.context=context;this.view?.command.update(context.data);},destroy(){this.view?.close();this.removeListeners?.();if(window.__jsoChartEditor?.viewId===this.viewId)delete window.__jsoChartEditor;},resize(){},setTheme(){}};