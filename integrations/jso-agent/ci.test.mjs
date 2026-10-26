import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ROOT, COMPONENTS, loadManifest, validateManifest, resolvePlan} from './validate.mjs';
import {cleanEnv, runTestGroup, assessEvents, pairedReceipt} from './run.mjs';
const {manifest,profile} = loadManifest();
const copy = () => structuredClone(manifest);
test('the initial release binds exactly the accepted four-source composition',()=>{
  assert.equal(validateManifest(copy()).version,1);
  assert.deepEqual(Object.fromEntries(resolvePlan(manifest).map(c=>[c.component,c.sha])),Object.fromEntries(Object.entries(COMPONENTS).map(([k,v])=>[k,v[1]])));
});
for (const [name, mutate] of Object.entries({
  'moving branch':m=>m.components[0].acceptedSha='main',
  'moving tag':m=>m.components[0].acceptedSha='v1.0.0',
  'malformed SHA':m=>m.components[0].acceptedSha='g'.repeat(40),
  'unaccepted exact SHA':m=>m.components[0].acceptedSha='a'.repeat(40),
  'missing component':m=>m.components.pop(),
  'duplicate component':m=>m.components[1]=structuredClone(m.components[0]),
  'unknown repository':m=>m.components[0].repository='someone/other',
  'unknown component':m=>m.components[0].id='other',
  'contract version':m=>m.trustedActionContract=2,
  'component contract version':m=>m.components[0].contracts.consumes[0].version=2,
  'runtime acceptance':m=>m.jsoRuntimeAcceptance='R4',
  'malformed evidence':m=>m.acceptance.receipt+='?token=bad',
  'wrong acceptance':m=>m.acceptance.issue=m.acceptance.issue.replace('/83','/86'),
  'stale profile':m=>m.testProfile.version=0,
  'nonexistent profile':m=>m.testProfile.file='missing.json',
  'profile path escape':m=>m.testProfile.file='../profile.v1.json',
  'stale profile hash':m=>m.testProfile.sha256='0'.repeat(64),
  'unexpected root key':m=>m.authorized=true,
  'unexpected component key':m=>m.components[0].endpoint='https://production.invalid',
  'unknown contract key':m=>m.components[0].contracts.role='owner',
})) test(`manifest fails closed: ${name}`,()=>{const m=copy();mutate(m);assert.throws(()=>validateManifest(m));});
test('missing actual profile file fails closed',()=>{const dir=mkdtempSync(join(tmpdir(),'aic-profile-'));try{assert.throws(()=>validateManifest(copy(),dir));}finally{rmSync(dir,{recursive:true,force:true});}});
for (const component of Object.keys(COMPONENTS)) test(`candidate substitution changes only ${component}`,()=>{
  const candidate={component,repository:COMPONENTS[component][0],sha:'a'.repeat(40)};
  const plan=resolvePlan(manifest,candidate);
  for(const c of plan)assert.equal(c.sha,c.component===component?candidate.sha:COMPONENTS[c.component][1]);
  assert.equal(plan.filter(c=>c.source==='candidate').length,1);
});
for(const candidate of [{component:'unknown',repository:'unknown',sha:'a'.repeat(40)},
  {component:'extensions',repository:COMPONENTS.extensions[0],sha:'main'},
  {component:'extensions',repository:COMPONENTS.jso[0],sha:'a'.repeat(40)},
  {component:'extensions',repository:COMPONENTS.extensions[0],sha:'a'.repeat(40),approved:true}]) {
  test('invalid candidate cannot redirect a source',()=>assert.throws(()=>resolvePlan(manifest,candidate)));
}
test('test child environment never inherits provider, deployment, or Node injection settings',()=>{
  const env=cleanEnv('/synthetic/home',process.execPath,{JSO_TOOLBOX_SOURCE:'/synthetic/toolbox'});
  for(const key of ['OPENAI_API_KEY','JSO_LOCAL_AGENT_TOKEN','JSO_OWNER_APPLICATION_AUTHORIZATION','GITHUB_TOKEN','NODE_OPTIONS','SSH_AUTH_SOCK','HTTPS_PROXY'])assert.equal(env[key],undefined);
  assert.equal(env.JSO_TOOLBOX_SOURCE,'/synthetic/toolbox');
});
test('real Node skip event fails the paired gate, with explicit test name/reason',t=>{
  const dir=mkdtempSync(join(tmpdir(),'aic-skip-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const home=join(dir,'home');mkdirSync(join(home,'tmp'),{recursive:true});
  writeFileSync(join(dir,'required.test.cjs'),"const {test}=require('node:test');test('required read',()=>{});test('required cancellation',{skip:'deliberate negative control'},()=>{});\n");
  const result=runTestGroup({node:process.execPath,root:dir,files:['required.test.cjs'],env:cleanEnv(home,process.execPath),output:join(dir,'report')});
  assert.equal(result.exitCode,0);assert.equal(result.status,'FAIL');assert.equal(result.counts.skipped,1);
  assert.deepEqual(result.skipped,[{file:'required.test.cjs',name:'required cancellation',reason:'deliberate negative control'}]);
  const passed={...result,status:'PASS',counts:{tests:1,pass:1,fail:0,skipped:0,cancelled:0,todo:0},skipped:[],gateFailures:[]};
  const groups=Object.keys(COMPONENTS).map(component=>({component,...(component==='extensions'?result:passed)}));
  const receipt=pairedReceipt({manifest,profile,plan:resolvePlan(manifest),harnessSha:'a'.repeat(40),groups});
  assert.equal(receipt.status,'FAIL');assert.equal(receipt.counts.skipped,1);assert.equal(receipt.skipped[0].component,'extensions');
});
test('empty required file cannot count as successful test coverage',t=>{
  const dir=mkdtempSync(join(tmpdir(),'aic-empty-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));mkdirSync(join(dir,'home','tmp'),{recursive:true});
  writeFileSync(join(dir,'empty.test.cjs'),'');
  const result=runTestGroup({node:process.execPath,root:dir,files:['empty.test.cjs'],env:cleanEnv(join(dir,'home'),process.execPath),output:join(dir,'report')});
  assert.equal(result.status,'FAIL');assert.ok(result.gateFailures.some(x=>x.includes('emitted no test cases')));
});
test('missing or malformed event stream cannot become green on exit zero',()=>{
  assert.equal(assessEvents([],0,['missing.test.cjs'],'/synthetic').status,'FAIL');
  assert.equal(pairedReceipt({manifest,profile,plan:resolvePlan(manifest),groups:[]}).status,'FAIL');
});
test('profile includes real cross-process and cross-repository tests, not only unit substitutes',()=>{
  assert.ok(profile.groups.find(g=>g.component==='extensions').files.includes('ShootingOperationsPackages/JsoConversation/stdio.test.cjs'));
  assert.ok(profile.groups.find(g=>g.component==='jso').files.includes('tests/jso-conversation-r1.test.mjs'));
  assert.ok(profile.groups.find(g=>g.component==='jso').files.includes('tests/jso-conversation-cancellation-restart.test.mjs'));
});
