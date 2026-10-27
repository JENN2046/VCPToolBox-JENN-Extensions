import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {Script} from 'node:vm';
import {ROOT, COMPONENTS, LEGACY_R1_COMPONENTS, R2_COMPONENTS, PROFILE_SHA256, loadManifest,
  validateManifest, validateLegacyR1, validateReleaseCandidate, validatePromotion, R2_PROMOTION_RECEIPT, resolvePlan, sha256} from './validate.mjs';
import {preparePromotion} from './prepare-promotion.mjs';
import {pairedReceipt, cleanEnv, runTestGroup} from './run.mjs';
import {STABLE_HARNESS, STABLE_FILES, RELEASE_FILES, verifyEngineIdentity} from './verify-engine-identity.mjs';
import {verifyReleaseReceipt} from './verify-release-receipts.mjs';

const {manifest:canonical,profile}=loadManifest();
const {manifest:r1}=loadManifest(join(ROOT,'compatibility.r1.legacy.json'),'r1');
const {manifest:r2}=loadManifest(join(ROOT,'compatibility.r2.candidate.json'));
const clone=value=>structuredClone(value);
const root=resolve(ROOT,'../..');
// Promotion and canonical loading must agree on the same frozen accepted data.
// Their authority differs: R2B certification executes the immutable R2A workflow.
const promotion=clone(canonical);
const modes=[['r1',r1,validateLegacyR1,LEGACY_R1_COMPONENTS],['candidate',r2,validateReleaseCandidate,R2_COMPONENTS],
  ['promotion',promotion,validatePromotion,R2_COMPONENTS],['canonical',canonical,validateManifest,COMPONENTS]];
const admitted=(mode,label)=>mode===label || ['canonical','promotion'].includes(mode) && ['canonical','promotion'].includes(label);

test('canonical R2 is accepted while legacy R1 and the R2 proposal remain separate and strict',()=>{
  assert.equal(r1.releaseId,'JSO_AGENT_R1');
  assert.equal(r2.releaseId,'JSO_AGENT_R2');
  assert.equal(r2.acceptance.result,'JSO_AGENT_R2_CANDIDATE_NOT_ACCEPTED');
  assert.equal(canonical.acceptance.result,'JSO_AGENT_R2_COMPATIBILITY_ACCEPTED');
  assert.deepEqual(canonical,promotion);
  assert.deepEqual(r2.testProfile,r1.testProfile);
  assert.equal(r2.testProfile.sha256,PROFILE_SHA256);
  assert.deepEqual(Object.fromEntries(resolvePlan(r2).map(c=>[c.component,c.sha])),
    Object.fromEntries(Object.entries(R2_COMPONENTS).map(([id,spec])=>[id,spec[1]])));
  assert.throws(()=>validateManifest(r2));
  assert.throws(()=>validateManifest(r1));
  assert.throws(()=>validateReleaseCandidate(r1));
  assert.throws(()=>validateReleaseCandidate(canonical));
  assert.throws(()=>validateLegacyR1(canonical));
  assert.throws(()=>resolvePlan(r2,{component:'extensions',repository:COMPONENTS.extensions[0],sha:'a'.repeat(40)}),/complete four-pin/);
});

for (const [label,original,validate,specs] of modes) {
  for (const id of Object.keys(specs)) test(`${label} rejects any ${id} pin/repository/branch/contract drift`,()=>{
    for(const field of ['acceptedSha','repository','integrationBranch']) {
      const m=clone(original),c=m.components.find(c=>c.id===id);
      c[field]=field==='acceptedSha'?'a'.repeat(40):'other';
      assert.throws(()=>validate(m));
    }
    for(const sha of ['main','v2.0.0','A'.repeat(40),'0'.repeat(40)]) {
      const m=clone(original);m.components.find(c=>c.id===id).acceptedSha=sha;
      assert.throws(()=>validate(m));
    }
    const m=clone(original),c=m.components.find(c=>c.id===id);
    const contract=[...c.contracts.provides,...c.contracts.consumes][0];contract.version=2;
    assert.throws(()=>validate(m));contract.version=1;contract.name='unknown';assert.throws(()=>validate(m));
  });
  for(const [name,mutate] of Object.entries({
    release:m=>m.releaseId='JSO_AGENT_R3',schema:m=>m.schemaVersion=2,
    missing:m=>m.components.pop(),duplicate:m=>m.components[1]=clone(m.components[0]),
    unknown:m=>m.components[0].id='unknown',trustedAction:m=>m.trustedActionContract=2,
    agentApi:m=>m.jsoAgentApiContract=2,runtime:m=>m.jsoRuntimeAcceptance='R4',
    issue:m=>m.acceptance.issue+='?unreviewed=true',receipt:m=>m.acceptance.receipt+='?unreviewed=true',
    result:m=>m.acceptance.result='ACCEPTED',profileId:m=>m.testProfile.id='other',
    profileVersion:m=>m.testProfile.version=2,profilePath:m=>m.testProfile.file='../profile.v1.json',
    profileDigest:m=>m.testProfile.sha256='0'.repeat(64),extra:m=>m.productionAuthorization=true,
  })) test(`${label} fails closed on ${name}`,()=>{const m=clone(original);mutate(m);assert.throws(()=>validate(m));});
}

for (const [mode,,validate] of modes) for (const [label,manifest] of modes) {
  test(`${mode} validator ${admitted(mode,label)?'accepts':'rejects'} ${label} manifest evidence`,()=>{
    if (admitted(mode,label)) assert.equal(validate(clone(manifest)).id,'jso-agent-paired');
    else assert.throws(()=>validate(clone(manifest)));
  });
}
test('promotion requires the exact reserved #28 receipt, not runtime/candidate/pending evidence',()=>{
  assert.equal(R2_PROMOTION_RECEIPT,'https://github.com/JENN2046/VCPToolBox-JENN-Extensions/issues/28#issuecomment-6436790468');
  for (const acceptance of [r1.acceptance,r2.acceptance,
    {...promotion.acceptance,issue:r1.acceptance.issue},
    {...promotion.acceptance,receipt:r1.acceptance.receipt},
    {...promotion.acceptance,receipt:R2_PROMOTION_RECEIPT+'?accepted=true'},
    {...promotion.acceptance,result:'PENDING_R2A_IMMUTABLE_POST_MERGE_RECEIPT'}]) {
    const manifest=clone(promotion);manifest.acceptance=clone(acceptance);assert.throws(()=>validatePromotion(manifest));
  }
});
test('explicit CLI modes reject wrong release/evidence; canonical default accepts only accepted R2',t=>{
  const dir=mkdtempSync(join(tmpdir(),'r2-modes-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(join(dir,'profile.v1.json'),readFileSync(join(ROOT,'profile.v1.json')));
  const path=join(dir,'compatibility.v1.json');
  for (const [label,manifest] of modes) {
    writeFileSync(path,JSON.stringify(manifest));
    for (const [mode] of modes) {
      const result=spawnSync(process.execPath,[join(ROOT,'validate.mjs'),'--mode',mode,'--manifest',path],{encoding:'utf8'});
      assert.equal(result.status,admitted(mode,label)?0:1,result.stderr);
    }
    if(['canonical','promotion'].includes(label)) assert.equal(loadManifest(path).manifest.releaseId,'JSO_AGENT_R2');
    else assert.throws(()=>loadManifest(path));
  }
  assert.throws(()=>loadManifest(path,'unknown'),/unknown manifest validation mode/);
});

function candidateFixture(t,manifest=promotion) {
  const dir=mkdtempSync(join(tmpdir(),'r2-promotion-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const candidate=join(dir,'candidate'),files=join(candidate,'integrations/jso-agent');mkdirSync(files,{recursive:true});
  writeFileSync(join(files,'compatibility.v1.json'),JSON.stringify(manifest));
  writeFileSync(join(files,'profile.v1.json'),readFileSync(join(ROOT,'profile.v1.json')));
  // Candidate code must never be imported/executed by the immutable validator.
  writeFileSync(join(files,'validate.mjs'),"throw Error('candidate validator executed');\n");
  const git=(...args)=>execFileSync('git',['-c','core.hooksPath=/dev/null','-C',candidate,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','-q');git('remote','add','origin','https://github.com/'+COMPONENTS.extensions[0]+'.git');
  git('add','.');git('-c','user.name=R2 fixture','-c','user.email=r2@example.invalid','commit','-qm','synthetic promotion data');
  return {dir,candidate,files,git,sha:git('rev-parse','HEAD'),out:join(dir,'staging')};
}
test('immutable preparation consumes exact clean candidate data and stages the unchanged engine input',t=>{
  const f=candidateFixture(t),result=preparePromotion(f.candidate,f.sha,f.out);
  assert.equal(result.candidateSha,f.sha);assert.equal(result.profileSha256,PROFILE_SHA256);
  assert.deepEqual(readFileSync(result.stagedManifest),readFileSync(join(f.files,'compatibility.v1.json')));
  assert.deepEqual(loadManifest(result.stagedManifest).manifest,promotion);
  assert.deepEqual(resolvePlan(loadManifest(result.stagedManifest).manifest),resolvePlan(r2));
  assert.equal(f.git('status','--porcelain'),'');
  assert.throws(()=>preparePromotion(f.candidate,f.sha,f.out),/must be new/);
});
for (const [label,manifest] of [['r1',r1],['candidate',r2]]) test(`promotion preparation refuses a clean ${label} candidate checkout`,t=>{
  const f=candidateFixture(t,manifest);assert.throws(()=>preparePromotion(f.candidate,f.sha,f.out));
});
test('promotion preparation refuses moving/wrong SHA, wrong repo, dirty data and checkout-local output',t=>{
  const f=candidateFixture(t);
  for(const sha of ['main','A'.repeat(40),'a'.repeat(40)]) assert.throws(()=>preparePromotion(f.candidate,sha,f.out));
  assert.throws(()=>preparePromotion(f.candidate,f.sha,join(f.candidate,'output')),/outside checkouts/);
  f.git('remote','set-url','origin','https://github.com/unknown/repo.git');
  assert.throws(()=>preparePromotion(f.candidate,f.sha,f.out),/repository identity/);
  f.git('remote','set-url','origin','https://github.com/'+COMPONENTS.extensions[0]+'.git');
  writeFileSync(join(f.files,'profile.v1.json'),'{}');
  assert.throws(()=>preparePromotion(f.candidate,f.sha,f.out),/dirty/);
  f.git('add','.');f.git('-c','user.name=R2 fixture','-c','user.email=r2@example.invalid','commit','-qm','bad profile');
  assert.throws(()=>preparePromotion(f.candidate,f.git('rev-parse','HEAD'),f.out),/profile content digest/);
});

const promotionWorkflow=readFileSync(join(root,'.github/workflows/jso-agent-promotion.yml'),'utf8');
const authorityCode=promotionWorkflow.split('// BEGIN PROMOTION AUTHORITY: tested verbatim without network access.')[1]
  .split('// END PROMOTION AUTHORITY')[0].replace(/^ {10}/gm,'');
async function authority({references,http=200,candidate='b'.repeat(40),repository=COMPONENTS.extensions[0],id=123}={}) {
  let output='',request='';const errors=[];
  const process={env:{CANDIDATE_SHA:candidate,CALLER_REPOSITORY:repository,RUN_ID:'123',GITHUB_OUTPUT:'/fake/output'},exitCode:0};
  await new Script(authorityCode).runInNewContext({process,AbortSignal,
    require:name=>{assert.equal(name,'node:fs');return {appendFileSync:(_path,text)=>output+=text};},
    fetch:async url=>{request=url;return {ok:http===200,status:http,json:async()=>({id,referenced_workflows:references})};},
    console:{log:()=>{},error:message=>errors.push(message)}});
  return {output,request,errors,exitCode:process.exitCode};
}
const reference=sha=>({path:COMPONENTS.extensions[0]+'/.github/workflows/jso-agent-promotion.yml@'+sha,sha});
test('reusable promotion workflow derives validator SHA from its own exact referenced workflow',async()=>{
  const result=await authority({references:[reference('a'.repeat(40))]});
  assert.equal(result.exitCode,0);assert.equal(result.output,'validator_sha='+'a'.repeat(40)+'\n');
  assert.equal(result.request,'https://api.github.com/repos/JENN2046/VCPToolBox-JENN-Extensions/actions/runs/123');
});
for (const [label,options] of Object.entries({
  missing:{},moving:{references:[{...reference('a'.repeat(40)),path:reference('main').path}]},
  mismatch:{references:[{...reference('a'.repeat(40)),path:reference('c'.repeat(40)).path}]},
  duplicate:{references:[reference('a'.repeat(40)),reference('c'.repeat(40))]},
  selfCertification:{references:[reference('b'.repeat(40))]},
  foreign:{references:[{path:'someone/other/.github/workflows/jso-agent-promotion.yml@'+'a'.repeat(40),sha:'a'.repeat(40)}]},
  movingCandidate:{candidate:'main'},foreignCaller:{repository:'someone/other'},
  unavailable:{http:403},wrongRun:{references:[reference('a'.repeat(40))],id:124},
})) test(`promotion workflow authority fails closed: ${label}`,async()=>{
  const result=await authority(options);assert.equal(result.exitCode,1);assert.equal(result.output,'');assert.equal(result.errors.length,1);
});

test('changing profile bytes and updating its declared digest cannot bless a new test selection',t=>{
  const dir=mkdtempSync(join(tmpdir(),'r2-profile-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const changed=clone(profile);changed.groups[0].files.pop();
  const raw=JSON.stringify(changed);writeFileSync(join(dir,'profile.v1.json'),raw);
  for(const [,manifest,validate] of modes) {
    const m=clone(manifest);
    m.testProfile.sha256=sha256(raw);assert.throws(()=>validate(m,dir),/reviewed profile digest/);
  }
});

test('candidate contents under the canonical filename cannot advance the default accepted release',t=>{
  const dir=mkdtempSync(join(tmpdir(),'r2-canonical-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(join(dir,'profile.v1.json'),readFileSync(join(ROOT,'profile.v1.json')));
  writeFileSync(join(dir,'compatibility.v1.json'),JSON.stringify(r2));
  assert.throws(()=>loadManifest(join(dir,'compatibility.v1.json')),/malformed\/unaccepted acceptance evidence/);
  writeFileSync(join(dir,'compatibility.r2.candidate.json'),JSON.stringify(r2));
  assert.equal(loadManifest(join(dir,'compatibility.r2.candidate.json')).manifest.releaseId,'JSO_AGENT_R2');
  writeFileSync(join(dir,'compatibility.r2.candidate.json'),JSON.stringify(canonical));
  assert.throws(()=>loadManifest(join(dir,'compatibility.r2.candidate.json')),/malformed\/unaccepted acceptance evidence/);
  writeFileSync(join(dir,'compatibility.r2.promotion.json'),JSON.stringify(r2));
  assert.throws(()=>loadManifest(join(dir,'compatibility.r2.promotion.json')),/malformed\/unaccepted acceptance evidence/);
});

test('accepted R2 retains the existing one-component candidate plan without admitting changed release pins',()=>{
  const candidate={component:'jso',repository:COMPONENTS.jso[0],sha:'a'.repeat(40)};
  const plan=resolvePlan(canonical,candidate);
  assert.equal(plan.filter(c=>c.source==='candidate').length,1);
  for(const c of plan) assert.equal(c.sha,c.component==='jso'?candidate.sha:COMPONENTS[c.component][1]);
  const drift=clone(canonical);drift.components[0].acceptedSha='b'.repeat(40);
  assert.throws(()=>resolvePlan(drift,candidate),/exact pin changed/);
});

test('stable engine/profile/deps/skip/workflow bytes and exact R2/legacy release metadata are pinned',()=>{
  assert.equal(verifyEngineIdentity().stableHarness,STABLE_HARNESS);
  assert.equal(STABLE_HARNESS,'77e89fae03202a3d861d6f3e78c8a06666df304d');
  assert.equal(STABLE_FILES['integrations/jso-agent/profile.v1.json'],PROFILE_SHA256);
});
for(const path of Object.keys({...STABLE_FILES,...RELEASE_FILES})) test(`identity guard rejects byte drift in ${path}`,t=>{
  const dir=mkdtempSync(join(tmpdir(),'r2-engine-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  for(const p of Object.keys({...STABLE_FILES,...RELEASE_FILES})) {mkdirSync(dirname(join(dir,p)),{recursive:true});writeFileSync(join(dir,p),readFileSync(join(root,p)));}
  verifyEngineIdentity(dir);
  writeFileSync(join(dir,path),Buffer.concat([readFileSync(join(dir,path)),Buffer.from('\n')]));
  assert.throws(()=>verifyEngineIdentity(dir),/(stable|release) bytes changed/);
  rmSync(join(dir,path));symlinkSync(join(root,path),join(dir,path));
  assert.throws(()=>verifyEngineIdentity(dir),/must be regular/);
});

function receipt(manifest=r2,harness='a'.repeat(40)) {
  const counts=manifest===r1?{extensions:38,vcpchat:209,vcptoolbox:171,jso:72}:{extensions:38,vcpchat:209,vcptoolbox:191,jso:74};
  const groups=profile.groups.map(g=>({component:g.component,runtime:'v'+profile.nodeVersions[g.runtime],
    checkoutTextMode:g.checkoutTextMode,requiredFiles:g.files,status:'PASS',exitCode:0,processError:null,
    counts:{tests:counts[g.component],pass:counts[g.component],fail:0,skipped:0,cancelled:0,todo:0},
    skipped:[],failedTests:[],gateFailures:[]}));
  return pairedReceipt({manifest,profile,plan:resolvePlan(manifest),harnessSha:harness,groups});
}
test('standard unmodified producer receipts distinguish immutable R1 control from full R2 candidate',()=>{
  const old=receipt(r1,STABLE_HARNESS),next=receipt();
  assert.equal(verifyReleaseReceipt(old,'JSO_AGENT_R1',STABLE_HARNESS).counts.pass,490);
  assert.equal(verifyReleaseReceipt(next,'JSO_AGENT_R2','a'.repeat(40)).counts.pass,512);
  assert.equal(next.candidate,null);assert.equal(next.productionAuthorization,false);
});
test('promotion receipt CLI enforces immutable harness, 512 passes and zero skips',t=>{
  const dir=mkdtempSync(join(tmpdir(),'r2-promotion-receipt-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const path=join(dir,'paired-result.v1.json'),harness='a'.repeat(40),data=receipt(promotion,harness);
  const run=sha=>spawnSync(process.execPath,[join(ROOT,'verify-release-receipts.mjs'),'--promotion',path,sha],{encoding:'utf8'});
  writeFileSync(path,JSON.stringify(data));assert.equal(run(harness).status,0);
  assert.equal(run('b'.repeat(40)).status,1);
  data.counts.skipped=1;writeFileSync(path,JSON.stringify(data));assert.equal(run(harness).status,1);
  writeFileSync(path,JSON.stringify(receipt(r1,harness)));assert.equal(run(harness).status,1);
});
for(const [name,mutate] of Object.entries({
  release:r=>r.releaseId='JSO_AGENT_R1',status:r=>r.status='FAIL',authority:r=>r.productionAuthorization=true,
  substitution:r=>r.candidate={component:'jso',sha:'a'.repeat(40)},pin:r=>r.components[0].sha='a'.repeat(40),
  repo:r=>r.components[0].repository='unknown/repo',sources:r=>r.components.pop(),duplicate:r=>r.components[1]=clone(r.components[0]),
  harness:r=>r.harness.sha='b'.repeat(40),contract:r=>r.trustedActionContract=2,agentApi:r=>r.jsoAgentApiContract=2,
  profile:r=>r.profile.sha256='0'.repeat(64),count:r=>r.counts.pass--,skip:r=>r.counts.skipped=1,
  failures:r=>r.gateFailures=['required skip'],groups:r=>r.groups.pop(),groupSkip:r=>r.groups[0].counts.skipped=1,
  groupFiles:r=>r.groups[0].requiredFiles=[],groupRuntime:r=>r.groups[0].runtime='v24.21.0',
})) test(`R2 receipt verifier rejects ${name}`,()=>{const r=receipt();mutate(r);assert.throws(()=>verifyReleaseReceipt(r,'JSO_AGENT_R2','a'.repeat(40)));});

test('a real required Node skip still produces a FAIL R2 receipt through the unchanged engine',t=>{
  const dir=mkdtempSync(join(tmpdir(),'r2-skip-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  mkdirSync(join(dir,'home/tmp'),{recursive:true});
  writeFileSync(join(dir,'required.test.cjs'),"require('node:test').test('required R2 fixture',{skip:'negative control'},()=>{});\n");
  const result=runTestGroup({node:process.execPath,root:dir,files:['required.test.cjs'],env:cleanEnv(join(dir,'home'),process.execPath),output:join(dir,'report')});
  assert.equal(result.status,'FAIL');assert.equal(result.counts.skipped,1);
  const r=receipt();r.groups[0]={...r.groups[0],...result};
  const failed=pairedReceipt({manifest:r2,profile,plan:resolvePlan(r2),harnessSha:'a'.repeat(40),groups:r.groups});
  assert.equal(failed.status,'FAIL');assert.equal(failed.counts.skipped,1);
  assert.throws(()=>verifyReleaseReceipt(failed,'JSO_AGENT_R2','a'.repeat(40)));
});
