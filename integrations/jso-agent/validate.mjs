import {readFileSync, lstatSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {basename, dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const COMPONENTS = Object.freeze({
  extensions: ['JENN2046/VCPToolBox-JENN-Extensions', '6a6f0a9c0ca27e366bb4d81aa3a09ce999baef9c', 'main', [], ['trustedAction', 'jsoAgentApi']],
  vcpchat: ['JENN2046/VCPChat', '1f86d5912c6acb3588577945e19045edc1256731', 'NuobaoVCPchat', [], ['trustedAction']],
  vcptoolbox: ['JENN2046/VCPToolBox', 'ce904c476f58e0857aa9ee828619158a82d75e7e', 'master', ['trustedAction'], []],
  jso: ['JENN2046/jenn-shooting-operations', '0936ac209ebfd52c3901b06b43cdcdad9a8c3210', 'main', ['jsoAgentApi'], []],
});
export const R2_COMPONENTS = Object.freeze(Object.fromEntries(Object.entries(COMPONENTS).map(([id, value]) => [id,
  [value[0], {
    extensions:'54b0bfb4d94bc9f3a53516cd4082fb7c4c6d351c',
    vcpchat:'900fdda5e24347d802b738924d8456a42c01477f',
    vcptoolbox:'b0552cd3e109a8cfe38ac5ee292cc026891d7442',
    jso:'bfaf4dfe1c6558beb0ff9113990946aa85a257a3',
  }[id], ...value.slice(2)]])));
export const PROFILE_SHA256 = 'd1e6e5e16f83216053b6131ccc2d1dd7996ea019edd734ffde226fa7856e38b6';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function requireValue(value, message) { if (!value) throw Error(message); }
export const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
function keys(value, expected, label) {
  requireValue(value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).sort().join(',') === [...expected].sort().join(','), `${label}: unexpected or missing keys`);
}
export function validateManifest(manifest, directory = ROOT) {
  return validateRelease(manifest, directory, 'JSO_AGENT_R1', COMPONENTS, {
    issue:'https://github.com/JENN2046/jenn-shooting-operations/issues/83',
    receipt:'https://github.com/JENN2046/jenn-shooting-operations/issues/83#issuecomment-6423599717',
    result:'JSO_AGENT_REAL_ACCEPTANCE_R1_PASS',
  });
}
export function validateReleaseCandidate(manifest, directory = ROOT) {
  return validateRelease(manifest, directory, 'JSO_AGENT_R2', R2_COMPONENTS, {
    issue:'https://github.com/JENN2046/VCPToolBox-JENN-Extensions/issues/28',
    receipt:'https://github.com/JENN2046/jenn-shooting-operations/issues/83#issuecomment-6423599717',
    result:'JSO_AGENT_R2_CANDIDATE_NOT_ACCEPTED',
  });
}
function validateRelease(manifest, directory, releaseId, components, acceptance) {
  keys(manifest, ['schemaVersion','releaseId','acceptance','components','trustedActionContract','jsoAgentApiContract','jsoRuntimeAcceptance','testProfile'], 'manifest');
  requireValue(manifest.schemaVersion === 1 && manifest.releaseId === releaseId, 'unsupported schema/release');
  requireValue(manifest.trustedActionContract === 1 && manifest.jsoAgentApiContract === 1 && manifest.jsoRuntimeAcceptance === 'R5', 'unsupported contract/runtime version');
  keys(manifest.acceptance, ['issue','receipt','result'], 'acceptance');
  requireValue(Object.entries(acceptance).every(([key,value]) => manifest.acceptance[key] === value), 'malformed/unaccepted acceptance evidence');
  requireValue(Array.isArray(manifest.components) && manifest.components.length === 4, 'exactly four components required');
  const seen = new Set();
  for (const c of manifest.components) {
    keys(c, ['id','repository','acceptedSha','integrationBranch','contracts'], 'component');
    requireValue(Object.hasOwn(components, c.id) && !seen.has(c.id), 'unknown/duplicate component'); seen.add(c.id);
    const [repository, sha, branch, provides, consumes] = components[c.id];
    requireValue(c.repository === repository, 'unknown repository');
    requireValue(isSha(c.acceptedSha), 'accepted SHA must be exact lowercase 40-hex, never a branch/tag');
    requireValue(c.acceptedSha === sha, `${releaseId} exact pin changed; requires a new reviewed release`);
    requireValue(c.integrationBranch === branch, 'unexpected informational branch');
    keys(c.contracts, ['provides','consumes'], 'contracts');
    for (const [key, names] of [['provides', provides], ['consumes', consumes]]) {
      requireValue(Array.isArray(c.contracts[key]) && c.contracts[key].length === names.length, 'unsupported component contracts');
      for (const contract of c.contracts[key]) { keys(contract, ['name','version'], 'component contract'); requireValue(contract.version === 1, 'unsupported component contract version'); }
      requireValue(c.contracts[key].map(x=>x.name).sort().join(',') === [...names].sort().join(','), 'unsupported/ambiguous component contracts');
    }
  }
  const ref = manifest.testProfile;
  keys(ref, ['id','version','file','sha256'], 'testProfile');
  requireValue(ref.id === 'jso-agent-paired' && ref.version === 1 && ref.file === 'profile.v1.json', 'unsupported/stale test profile');
  requireValue(ref.sha256 === PROFILE_SHA256, 'reviewed profile digest changed');
  const file = resolve(directory, ref.file);
  requireValue(lstatSync(file).isFile() && !lstatSync(file).isSymbolicLink(), 'profile must be a regular local file');
  const bytes = readFileSync(file);
  requireValue(/^[a-f0-9]{64}$/.test(ref.sha256) && sha256(bytes) === ref.sha256, 'stale profile content digest');
  const profile = JSON.parse(bytes);
  keys(profile, ['schemaVersion','id','version','nodeVersions','groups','invariants'], 'profile');
  requireValue(profile.schemaVersion === 1 && profile.id === ref.id && profile.version === ref.version, 'profile identity mismatch');
  keys(profile.nodeVersions, ['node22','node24'], 'nodeVersions');
  requireValue(profile.nodeVersions.node22 === '22.23.1' && profile.nodeVersions.node24 === '24.21.0', 'unsupported profile runtime');
  requireValue(Array.isArray(profile.groups) && profile.groups.length === 4, 'profile requires four groups');
  const groups = new Set();
  for (const group of profile.groups) {
    keys(group, ['component','runtime','files','checkoutTextMode'], 'profile group');
    requireValue(seen.has(group.component) && !groups.has(group.component), 'duplicate/unknown profile group'); groups.add(group.component);
    requireValue(group.checkoutTextMode === (group.component === 'vcpchat' ? 'git-crlf' : 'git-lf'), 'unsupported checkout text mode');
    requireValue(group.runtime === (group.component === 'jso' ? 'node24' : 'node22'), 'wrong component runtime');
    requireValue(Array.isArray(group.files) && group.files.length > 0 && new Set(group.files).size === group.files.length, 'empty/duplicate required tests');
    requireValue(group.files.every(f => typeof f === 'string' && /^(tests|ShootingOperationsPackages)\/[A-Za-z0-9_./-]+\.(test\.(cjs|mjs)|cjs)$/.test(f)
      && !f.split('/').includes('..') && !f.includes('//')), 'unsafe test path');
  }
  const invariants = ['read-and-parser','preview-zero-write','reject-model-authority','presentation-human-source-binding','at-most-one-dispatch','concurrent-dispatch-reconciliation','original-id-unknown-recovery','durable-pre-dispatch-cancellation','restart-receipt-recovery','native-transport-security','business-scope-digest-revisions','credential-and-log-separation'];
  keys(profile.invariants, invariants, 'invariant coverage');
  for (const coverage of Object.values(profile.invariants)) requireValue(Array.isArray(coverage) && coverage.length > 0
    && new Set(coverage).size === coverage.length && coverage.every(id => seen.has(id)), 'invalid invariant coverage');
  return profile;
}
export function resolvePlan(manifest, candidate = null) {
  requireValue(manifest.releaseId !== 'JSO_AGENT_R2' || !candidate, 'R2 release candidate requires the complete four-pin composition, not substitution');
  if (candidate) {
    keys(candidate, ['component','repository','sha'], 'candidate');
    requireValue(Object.hasOwn(COMPONENTS, candidate.component) && candidate.repository === COMPONENTS[candidate.component][0] && isSha(candidate.sha), 'invalid candidate identity');
  }
  return manifest.components.map(c => ({component:c.id, repository:c.repository,
    sha: candidate?.component === c.id ? candidate.sha : c.acceptedSha, source: candidate?.component === c.id ? 'candidate' : 'accepted'}));
}
export function loadManifest(path = resolve(ROOT, 'compatibility.v1.json')) {
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  const validate = basename(path) === 'compatibility.r2.candidate.json' ? validateReleaseCandidate : validateManifest;
  return {manifest, profile:validate(manifest, dirname(resolve(path)))};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { const {manifest, profile} = loadManifest(process.argv[2]); console.log(JSON.stringify({valid:true, releaseId:manifest.releaseId, profile:profile.id, version:profile.version})); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
