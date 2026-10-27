// Read candidate JSON only. All validation and execution code comes from the
// immutable R2A checkout; the candidate's validator/workflows are never loaded.
import {readFileSync, writeFileSync, mkdirSync, lstatSync, existsSync} from 'node:fs';
import {resolve, join, relative, isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ROOT, COMPONENTS, loadManifest, isSha, requireValue, sha256} from './validate.mjs';
import {verifyCheckout} from './run.mjs';

export function preparePromotion(candidateRoot, candidateSha, output) {
  requireValue(isSha(candidateSha), 'promotion candidate SHA must be exact lowercase 40-hex');
  candidateRoot=resolve(candidateRoot);output=resolve(output);
  verifyCheckout(candidateRoot,candidateSha,COMPONENTS.extensions[0]);
  for (const parent of [candidateRoot,resolve(ROOT,'../..')]) {
    const path=relative(parent,output);
    requireValue(path==='..' || path.startsWith('../') || isAbsolute(path), 'promotion staging must be outside checkouts');
  }
  requireValue(!existsSync(output), 'promotion staging must be new');
  const directory=join(candidateRoot,'integrations/jso-agent');
  requireValue(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink()
    && !lstatSync(join(candidateRoot,'integrations')).isSymbolicLink(), 'candidate manifest directory must be local');
  const manifestPath=join(directory,'compatibility.v1.json');
  const manifestStat=lstatSync(manifestPath);
  requireValue(manifestStat.isFile() && !manifestStat.isSymbolicLink(), 'candidate manifest must be a regular local file');
  loadManifest(manifestPath,'promotion');
  const manifest=readFileSync(manifestPath), profile=readFileSync(join(directory,'profile.v1.json'));
  mkdirSync(output,{recursive:true});
  const staged=join(output,'compatibility.r2.promotion.json');
  writeFileSync(staged,manifest,{flag:'wx'});
  writeFileSync(join(output,'profile.v1.json'),profile,{flag:'wx'});
  // This is the same loadManifest path the byte-identical engine will use.
  loadManifest(staged);
  verifyCheckout(candidateRoot,candidateSha,COMPONENTS.extensions[0]);
  return {candidateRepository:COMPONENTS.extensions[0],candidateSha,manifestSha256:sha256(manifest),
    profileSha256:sha256(profile),stagedManifest:staged};
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const [candidate,sha,out,...extra]=process.argv.slice(2);
    requireValue(candidate && sha && out && !extra.length, 'usage: prepare-promotion.mjs candidate-checkout exact-candidate-sha new-staging-directory');
    console.log(JSON.stringify(preparePromotion(candidate,sha,out)));
  } catch(error) { console.error(error.message);process.exitCode=1; }
}
