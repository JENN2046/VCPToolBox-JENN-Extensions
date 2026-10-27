import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {ROOT, COMPONENTS, R2_COMPONENTS, PROFILE_SHA256, loadManifest,
  validateManifest, validateReleaseCandidate, resolvePlan, sha256} from './validate.mjs';
import {pairedReceipt, cleanEnv, runTestGroup} from './run.mjs';
import {STABLE_HARNESS, STABLE_FILES, verifyEngineIdentity} from './verify-engine-identity.mjs';
import {verifyReleaseReceipt} from './verify-release-receipts.mjs';

const {manifest:r1,profile}=loadManifest();
const {manifest:r2}=loadManifest(join(ROOT,'compatibility.r2.candidate.json'));
const clone=value=>structuredClone(value);
const root=resolve(ROOT,'../..');

test('R2 is an explicit not-accepted four-pin proposal; canonical R1 remains separate and strict',()=>{
  assert.equal(r1.releaseId,'JSO_AGENT_R1');
  assert.equal(r2.releaseId,'JSO_AGENT_R2');
  assert.equal(r2.acceptance.result,'JSO_AGENT_R2_CANDIDATE_NOT_ACCEPTED');
  assert.deepEqual(r2.testProfile,r1.testProfile);
  assert.equal(r2.testProfile.sha256,PROFILE_SHA256);
  assert.deepEqual(Object.fromEntries(resolvePlan(r2).map(c=>[c.component,c.sha])),
    Object.fromEntries(Object.entries(R2_COMPONENTS).map(([id,spec])=>[id,spec[1]])));
  assert.throws(()=>validateManifest(r2));
  assert.throws(()=>validateReleaseCandidate(r1));
  assert.throws(()=>resolvePlan(r2,{component:'extensions',repository:COMPONENTS.extensions[0],sha:'a'.repeat(40)}),/complete four-pin/);
});

for (const [label,original,validate,specs] of [['R1',r1,validateManifest,COMPONENTS],['R2',r2,validateReleaseCandidate,R2_COMPONENTS]]) {
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

test('changing profile bytes and updating its declared digest cannot bless a new test selection',t=>{
  const dir=mkdtempSync(join(tmpdir(),'r2-profile-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const changed=clone(profile);changed.groups[0].files.pop();
  const raw=JSON.stringify(changed);writeFileSync(join(dir,'profile.v1.json'),raw);
  for(const [m,validate] of [[clone(r1),validateManifest],[clone(r2),validateReleaseCandidate]]) {
    m.testProfile.sha256=sha256(raw);assert.throws(()=>validate(m,dir),/reviewed profile digest/);
  }
});

test('candidate contents under the canonical filename cannot advance the default accepted release',t=>{
  const dir=mkdtempSync(join(tmpdir(),'r2-canonical-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  writeFileSync(join(dir,'profile.v1.json'),readFileSync(join(ROOT,'profile.v1.json')));
  writeFileSync(join(dir,'compatibility.v1.json'),JSON.stringify(r2));
  assert.throws(()=>loadManifest(join(dir,'compatibility.v1.json')),/unsupported schema\/release/);
  writeFileSync(join(dir,'compatibility.r2.candidate.json'),JSON.stringify(r2));
  assert.equal(loadManifest(join(dir,'compatibility.r2.candidate.json')).manifest.releaseId,'JSO_AGENT_R2');
});

test('stable engine, profile, deps, skip helper, reusable workflow and canonical R1 bytes are pinned',()=>{
  assert.equal(verifyEngineIdentity().stableHarness,STABLE_HARNESS);
  assert.equal(STABLE_HARNESS,'77e89fae03202a3d861d6f3e78c8a06666df304d');
  assert.equal(STABLE_FILES['integrations/jso-agent/profile.v1.json'],PROFILE_SHA256);
});
for(const path of Object.keys(STABLE_FILES)) test(`engine guard rejects byte drift in ${path}`,t=>{
  const dir=mkdtempSync(join(tmpdir(),'r2-engine-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  for(const p of Object.keys(STABLE_FILES)) {mkdirSync(dirname(join(dir,p)),{recursive:true});writeFileSync(join(dir,p),readFileSync(join(root,p)));}
  verifyEngineIdentity(dir,root);
  writeFileSync(join(dir,path),Buffer.concat([readFileSync(join(dir,path)),Buffer.from('\n')]));
  assert.throws(()=>verifyEngineIdentity(dir,root),/stable bytes changed/);
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
