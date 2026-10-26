import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, copyFileSync, lstatSync, realpathSync} from 'node:fs';
import {resolve, dirname, join, relative, isAbsolute, delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {ROOT, COMPONENTS, loadManifest, resolvePlan, requireValue, sha256} from './validate.mjs';

const HARNESS = resolve(ROOT, '../..');
const CHECKOUT_PATHS = {
  extensions:['ShootingOperationsPackages','Plugin/JennShootingOperations'],
  vcpchat:['tests','modules','preloads','VCPDistributedServer/Plugin/ChartController','vendor'],
  vcptoolbox:['tests','modules','routes','Plugin'],
  jso:['tests','src','contracts','fixtures','examples','public','scripts'],
};
export function cleanEnv(home, node, extra = {}) {
  return {PATH:dirname(node) + delimiter + '/usr/bin' + delimiter + '/bin', HOME:home,
    XDG_CONFIG_HOME:join(home, '.config'), TMPDIR:join(home, 'tmp'), LANG:'C.UTF-8', TZ:'UTC',
    CI:'true', NO_COLOR:'1', ...extra};
}
function command(exe, args, options = {}) {
  const result = spawnSync(exe, args, {encoding:'utf8', timeout:180000, maxBuffer:16*1024*1024, ...options});
  requireValue(!result.error && result.status === 0, `${exe.split('/').at(-1)} failed (${result.error?.code || result.status})`);
  return result.stdout.trim();
}
function git(root, args) { return command('git', ['-C',root,...args]); }
export function verifyCheckout(root, sha) {
  requireValue(existsSync(root) && realpathSync(root) === resolve(root), 'source root missing or aliased');
  requireValue(git(root, ['rev-parse','--show-toplevel']) === root, 'source root must be checkout top level');
  requireValue(git(root, ['rev-parse','HEAD']) === sha, 'checkout HEAD does not match resolved exact SHA');
  requireValue(git(root, ['status','--porcelain','--untracked-files=normal']) === '', 'source checkout is dirty');
}
function outside(parent, child) {
  const rel = relative(parent, child);
  return rel.startsWith('..' + '/') || rel === '..' || isAbsolute(rel);
}
function provision(plan, workspace, nodes, env) {
  requireValue(!existsSync(workspace), 'provision workspace must be new; no existing checkout is overwritten');
  mkdirSync(workspace, {recursive:true});
  const roots = {};
  for (const c of plan) {
    const root = join(workspace, c.component); mkdirSync(root); roots[c.component] = root;
    for (const args of [
      ['init','-q'], ['remote','add','origin',`https://github.com/${c.repository}.git`],
      ['-c','credential.helper=','fetch','--depth=1','--filter=blob:none','origin',c.sha],
      ['sparse-checkout','init','--cone'], ['sparse-checkout','set',...CHECKOUT_PATHS[c.component]],
      ['checkout','--detach',c.sha],
    ]) command('git', ['-c','core.hooksPath=/dev/null',...args], {cwd:root, env});
  }
  const deps = join(workspace, 'test-deps'); mkdirSync(deps);
  for (const name of ['package.json','package-lock.json']) copyFileSync(join(ROOT,'deps',name),join(deps,name));
  // Provision declared, locked dependencies only. No repository postinstall/build hooks.
  const npm = join(dirname(nodes.node24),'npm');
  command(npm, ['ci','--ignore-scripts','--no-audit','--no-fund'], {cwd:deps, env});
  command(npm, ['ci','--ignore-scripts','--no-audit','--no-fund'], {cwd:roots.jso, env});
  return {roots, deps:join(deps,'node_modules')};
}
export function assessEvents(events, exitCode, requiredFiles, root) {
  const relativeFile = file => file ? relative(root, resolve(file)).replaceAll('\\','/') : null;
  const summaries = events.filter(e => e.type === 'test:summary' && !e.data.file);
  const summary = summaries.length === 1 ? summaries[0].data : null;
  const counts = summary?.counts || {tests:0,passed:0,failed:0,cancelled:0,skipped:0,todo:0};
  const failures = [];
  if (exitCode !== 0) failures.push('test process failed');
  if (!summary || !summary.success) failures.push('missing/unsuccessful root test summary');
  if (counts.tests < 1) failures.push('no tests ran');
  for (const kind of ['failed','cancelled','skipped','todo']) if (counts[kind]) failures.push(`required tests ${kind}: ${counts[kind]}`);
  for (const file of requiredFiles) {
    const hasTest = events.some(e => ['test:pass','test:fail'].includes(e.type) && e.data.testType === 'test'
      && e.data.line && e.data.name !== file && e.data.name !== resolve(root,file) && relativeFile(e.data.file) === file);
    if (!hasTest) failures.push(`required file emitted no test cases: ${file}`);
  }
  const skipped = events.filter(e => ['test:pass','test:fail'].includes(e.type) && e.data.skip !== undefined && e.data.skip !== false)
    .map(e => ({file:relativeFile(e.data.file),name:e.data.name,reason:typeof e.data.skip === 'string' ? e.data.skip : 'marked skipped without a reason'}));
  const failedTests = events.filter(e => e.type === 'test:fail').map(e => ({file:relativeFile(e.data.file),name:e.data.name,failureType:e.data.failureType || 'test failure'}));
  return {status:failures.length ? 'FAIL' : 'PASS', counts:{tests:counts.tests,pass:counts.passed,fail:counts.failed,
    skipped:counts.skipped,cancelled:counts.cancelled,todo:counts.todo}, skipped,failedTests,gateFailures:failures};
}
export function runTestGroup({node, root, files, env, output, reporter = join(ROOT,'reporter.cjs')}) {
  mkdirSync(output, {recursive:true});
  const report = join(output,'events.jsonl');
  const child = spawnSync(node, ['--test','--test-concurrency=1',`--test-reporter=${reporter}`,`--test-reporter-destination=${report}`,...files],
    {cwd:root,env,encoding:'utf8',timeout:180000,maxBuffer:16*1024*1024});
  writeFileSync(join(output,'stdout.log'),child.stdout || '');
  writeFileSync(join(output,'stderr.log'),child.stderr || '');
  let events = [];
  try { events = readFileSync(report,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line)); }
  catch { /* Missing/malformed reports must fail, even if the process exit status is zero. */ }
  return {...assessEvents(events,child.status,files,root),exitCode:child.status,processError:child.error?.code || null};
}
export function pairedReceipt({manifest, profile, plan, candidate, harnessSha, groups, errors = []}) {
  const counts = {tests:0,pass:0,fail:0,skipped:0,cancelled:0,todo:0};
  for (const group of groups) for (const key of Object.keys(counts)) counts[key] += group.counts[key];
  const complete = plan?.length === 4 && groups.length === 4 && new Set(groups.map(g=>g.component)).size === 4;
  return {schemaVersion:1,status:complete && !errors.length && groups.every(g=>g.status==='PASS') ? 'PASS':'FAIL',
    releaseId:manifest?.releaseId || null,candidate:candidate || null,components:plan || [],
    harness:{repository:COMPONENTS.extensions[0],sha:harnessSha || null},
    trustedActionContract:manifest?.trustedActionContract || null,jsoAgentApiContract:manifest?.jsoAgentApiContract || null,
    profile:profile ? {id:profile.id,version:profile.version,sha256:manifest.testProfile.sha256}:null,
    counts,skipped:groups.flatMap(g=>g.skipped.map(s=>({component:g.component,...s}))),groups,
    gateFailures:[...errors,...(!complete?['incomplete four-component execution']:[])],
    evidenceClass:'synthetic-isolated-paired-tests',productionAuthorization:false,finishedAt:new Date().toISOString()};
}
export async function runPaired(options) {
  const out = resolve(options.out); mkdirSync(out,{recursive:true});
  const home = mkdtempSync(join(out,'isolated-home-')); mkdirSync(join(home,'tmp'));
  let manifest, profile, plan, harnessSha, candidate = null;
  const groups = [], errors = [];
  try {
    ({manifest,profile} = loadManifest(options.manifest || join(ROOT,'compatibility.v1.json')));
    requireValue(['accepted','candidate'].includes(options.mode), 'mode must be accepted or candidate');
    if (options.mode === 'candidate') candidate = {component:options.candidateComponent, repository:options.candidateRepository, sha:options.candidateSha};
    else requireValue(!options.candidateComponent && !options.candidateRepository && !options.candidateSha, 'accepted mode cannot substitute a candidate');
    plan = resolvePlan(manifest,candidate);
    harnessSha = git(HARNESS,['rev-parse','HEAD']); verifyCheckout(HARNESS,harnessSha);
    requireValue(outside(HARNESS,out), 'output must be outside harness checkout');
    const nodes = {node22:resolve(options.node22),node24:resolve(options.node24)};
    const versions = {};
    for (const [key,node] of Object.entries(nodes)) {
      versions[key] = command(node,['--version']);
      requireValue(versions[key] === 'v'+profile.nodeVersions[key], `wrong ${key} runtime; use profile version`);
    }
    let roots, deps;
    if (options.workspace) {
      requireValue(!options.rootsFile && !options.deps, 'workspace provisioning cannot mix supplied roots/deps');
      ({roots,deps} = provision(plan,resolve(options.workspace),nodes,cleanEnv(home,nodes.node24)));
    } else {
      requireValue(options.rootsFile && options.deps, 'supply workspace or roots-file and deps');
      roots = JSON.parse(readFileSync(options.rootsFile,'utf8')); deps = resolve(options.deps);
      requireValue(Object.keys(roots).sort().join(',') === Object.keys(COMPONENTS).sort().join(','), 'roots map must contain exactly four components');
      for (const key of Object.keys(roots)) roots[key] = resolve(roots[key]);
    }
    for (const c of plan) { verifyCheckout(roots[c.component],c.sha); requireValue(outside(roots[c.component],out), 'output must be outside source checkouts'); }
    for (const [name,version] of Object.entries(JSON.parse(readFileSync(join(ROOT,'deps/package.json'))).dependencies)) {
      requireValue(JSON.parse(readFileSync(join(deps,name,'package.json'))).version === version, 'wrong/missing isolated test dependency');
    }
    // Existing tests consume a historical flat author-source directory. Stage exact bytes,
    // without changing either source checkout or adapting their business implementations.
    const author = join(out,'chart-author-source'); mkdirSync(author);
    const staged = [];
    for (const [from,to] of [['modules/services/chartService.js','chartService.js'],['VCPDistributedServer/Plugin/ChartController/ChartControllerService.js','ChartControllerService.js']]) {
      const source = join(roots.vcpchat,from); requireValue(lstatSync(source).isFile() && !lstatSync(source).isSymbolicLink(), 'author source missing/aliased');
      copyFileSync(source,join(author,to)); staged.push({component:'vcpchat',source:from,sha256:sha256(readFileSync(source))});
    }
    writeFileSync(join(out,'chart-author-source.json'),JSON.stringify(staged,null,2)+'\n');
    for (const group of profile.groups) {
      const root = roots[group.component], node = nodes[group.runtime];
      for (const file of group.files) requireValue(lstatSync(join(root,file)).isFile() && !lstatSync(join(root,file)).isSymbolicLink(), `required test missing/aliased: ${group.component}/${file}`);
      const env = cleanEnv(home,node,{NODE_PATH:deps,JSO_TOOLBOX_SOURCE:roots.vcptoolbox,JSO_TOOLBOX_ROOT:roots.vcptoolbox,
        JSO_CHAT_SOURCE:roots.vcpchat,JSO_EXTENSIONS_ROOT:roots.extensions,JSO_VCHART_AUTHOR_SOURCE:author});
      const result = runTestGroup({node,root,files:group.files,env,output:join(out,group.component)});
      groups.push({component:group.component,runtime:versions[group.runtime],requiredFiles:group.files,...result});
      console.log(JSON.stringify({component:group.component,status:result.status,counts:result.counts}));
    }
    for (const c of plan) verifyCheckout(roots[c.component],c.sha);
    verifyCheckout(HARNESS,harnessSha);
  } catch (error) { errors.push(error.message); }
  const receipt = pairedReceipt({manifest,profile,plan,candidate,harnessSha,groups,errors});
  writeFileSync(join(out,'paired-result.v1.json'),JSON.stringify(receipt,null,2)+'\n');
  return receipt;
}
function parseArgs(args) {
  const names = {mode:'mode',out:'out',manifest:'manifest',workspace:'workspace','roots-file':'rootsFile',deps:'deps',node22:'node22',node24:'node24',
    'candidate-component':'candidateComponent','candidate-repository':'candidateRepository','candidate-sha':'candidateSha'};
  const result = {};
  for (let i=0;i<args.length;i+=2) {
    const name = args[i]?.slice(2), value=args[i+1];
    requireValue(args[i]?.startsWith('--') && Object.hasOwn(names,name) && value && !value.startsWith('--') && !Object.hasOwn(result,names[name]), 'invalid/duplicate CLI argument');
    result[names[name]]=value;
  }
  requireValue(result.out && result.node22 && result.node24, '--out, --node22 and --node24 are required');
  return result;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const receipt = await runPaired(parseArgs(process.argv.slice(2))); console.log(JSON.stringify({status:receipt.status,counts:receipt.counts,gateFailures:receipt.gateFailures})); if(receipt.status!=='PASS')process.exitCode=1; }
  catch(error) { console.error(error.message); process.exitCode=1; }
}
