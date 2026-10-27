// Output validation only. The stable paired engine remains the sole test executor
// and receipt producer; its output format and skip-failure rules are unchanged.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {COMPONENTS, R2_COMPONENTS, PROFILE_SHA256, loadManifest, isSha, requireValue, sha256} from './validate.mjs';
import {STABLE_HARNESS} from './verify-engine-identity.mjs';

export function verifyReleaseReceipt(receipt, releaseId, harnessSha) {
  requireValue(['JSO_AGENT_R1','JSO_AGENT_R2'].includes(releaseId) && isSha(harnessSha), 'invalid receipt verification context');
  const expected=releaseId==='JSO_AGENT_R1' ? COMPONENTS : R2_COMPONENTS;
  const counts=releaseId==='JSO_AGENT_R1' ? {extensions:38,vcpchat:209,vcptoolbox:171,jso:72}
    : {extensions:38,vcpchat:209,vcptoolbox:191,jso:74};
  const total=Object.values(counts).reduce((a,b)=>a+b,0);
  requireValue(receipt?.schemaVersion===1 && receipt.releaseId===releaseId && receipt.status==='PASS'
    && receipt.candidate===null && receipt.productionAuthorization===false
    && receipt.evidenceClass==='synthetic-isolated-paired-tests', 'wrong release/receipt authority');
  requireValue(receipt.harness?.repository===COMPONENTS.extensions[0] && receipt.harness.sha===harnessSha, 'wrong receipt harness');
  requireValue(receipt.trustedActionContract===1 && receipt.jsoAgentApiContract===1
    && receipt.profile?.id==='jso-agent-paired' && receipt.profile.version===1
    && receipt.profile.sha256===PROFILE_SHA256, 'wrong receipt contract/profile');
  const checkCounts=(value,total)=>requireValue(value?.tests===total && value.pass===total
    && ['fail','skipped','cancelled','todo'].every(k=>value[k]===0), 'unexpected test counts or required skip');
  const empty=value=>Array.isArray(value) && value.length===0;
  checkCounts(receipt.counts,total);
  requireValue(empty(receipt.gateFailures) && empty(receipt.skipped), 'receipt gate failures/skips');
  requireValue(Array.isArray(receipt.components) && receipt.components.length===4
    && new Set(receipt.components.map(c=>c.component)).size===4, 'incomplete/duplicate receipt sources');
  for (const component of receipt.components) {
    const spec=expected[component.component];
    requireValue(spec && component.repository===spec[0] && component.sha===spec[1]
      && component.source==='accepted', 'receipt composition drift or single substitution');
  }
  requireValue(Array.isArray(receipt.groups) && receipt.groups.length===4
    && new Set(receipt.groups.map(g=>g.component)).size===4, 'incomplete/duplicate receipt groups');
  const {profile}=loadManifest();
  for (const group of receipt.groups) {
    requireValue(Object.hasOwn(counts,group.component) && group.status==='PASS' && group.exitCode===0
      && group.processError===null && empty(group.gateFailures) && empty(group.skipped)
      && empty(group.failedTests), 'failed/incomplete group');
    checkCounts(group.counts,counts[group.component]);
    const required=profile.groups.find(g=>g.component===group.component);
    requireValue(group.runtime==='v'+profile.nodeVersions[required.runtime]
      && group.checkoutTextMode===required.checkoutTextMode
      && JSON.stringify(group.requiredFiles)===JSON.stringify(required.files), 'receipt runtime/profile selection drift');
  }
  return receipt;
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [r1,r2,harness,...extra]=process.argv.slice(2);
    requireValue(r1 && r2 && harness && !extra.length, 'usage: verify-release-receipts.mjs r1-receipt r2-receipt exact-validator-sha');
    for (const [path,id,sha] of [[r1,'JSO_AGENT_R1',STABLE_HARNESS],[r2,'JSO_AGENT_R2',harness]]) {
      const raw=readFileSync(path), receipt=verifyReleaseReceipt(JSON.parse(raw),id,sha);
      // Standard receipt data plus the exact raw artifact member digest, visible
      // in GitHub logs as well as the unchanged uploaded JSON files.
      console.log(JSON.stringify({releaseId:id,rawReceiptSha256:sha256(raw),receipt}));
    }
  } catch(error) { console.error(error.message);process.exitCode=1; }
}
