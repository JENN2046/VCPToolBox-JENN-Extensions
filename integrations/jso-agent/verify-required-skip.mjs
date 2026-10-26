// Negative control: re-run the ACTUAL required Extensions files without their required
// ToolBox fixture reference. Reuse the just-completed baseline's other three results.
// This is labelled negative-control evidence, never a new successful paired run.
import {readFileSync, writeFileSync, mkdirSync, mkdtempSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {loadManifest, requireValue} from './validate.mjs';
import {cleanEnv, verifyCheckout, runTestGroup, pairedReceipt} from './run.mjs';
const [baselineDirectory,workspace,node22,output] = process.argv.slice(2).map(v=>resolve(v));
requireValue(baselineDirectory && workspace && node22 && output, 'usage: baseline-output provision-workspace node22 output');
const baseline=JSON.parse(readFileSync(join(baselineDirectory,'paired-result.v1.json')));
requireValue(baseline.status==='PASS' && baseline.candidate===null, 'negative control requires a passing frozen baseline');
const {manifest,profile}=loadManifest();
requireValue(baseline.profile.sha256===manifest.testProfile.sha256, 'baseline profile changed');
const group=profile.groups.find(g=>g.component==='extensions'), root=join(workspace,'extensions');
verifyCheckout(root,baseline.components.find(c=>c.component==='extensions').sha);
mkdirSync(output,{recursive:true});const home=mkdtempSync(join(output,'home-'));mkdirSync(join(home,'tmp'));
const env=cleanEnv(home,node22,{NODE_PATH:join(workspace,'test-deps/node_modules'),JSO_VCHART_AUTHOR_SOURCE:join(baselineDirectory,'chart-author-source')});
const result=runTestGroup({node:node22,root,files:group.files,env,output:join(output,'extensions')});
const groups=baseline.groups.map(g=>g.component==='extensions'?{component:'extensions',runtime:g.runtime,requiredFiles:group.files,...result}:g);
const receipt=pairedReceipt({manifest,profile,plan:baseline.components,harnessSha:baseline.harness.sha,groups});
receipt.negativeControl={kind:'required-source-reference-omitted',omitted:'JSO_TOOLBOX_SOURCE',
  reusedBaselineComponents:['vcpchat','vcptoolbox','jso'],baselineFinishedAt:baseline.finishedAt};
writeFileSync(join(output,'paired-result.v1.json'),JSON.stringify(receipt,null,2)+'\n');
requireValue(receipt.status==='FAIL' && result.counts.skipped>0 && result.skipped.some(s=>s.file==='ShootingOperationsPackages/JsoConversation/stdio.test.cjs'), 'required skip did not fail the gate');
console.log(JSON.stringify({negativeControlVerified:true,pairedGate:receipt.status,requiredSkipped:result.counts.skipped}));
