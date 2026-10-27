// Reviewed SHA256 identities of exact Git bytes at the immutable R1 harness.
// This validates files; it neither provisions sources nor executes paired tests.
import {readFileSync, lstatSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

export const STABLE_HARNESS = '77e89fae03202a3d861d6f3e78c8a06666df304d';
export const STABLE_FILES = Object.freeze({
  'integrations/jso-agent/run.mjs':'5a844fc070595b31c45987d231852c80d10f219a3207b04d0c41894c3e426dcb',
  'integrations/jso-agent/reporter.cjs':'23c3db08b43600f5513684f34eeec1c8cdc2358f667640f612a2a06b79476cdd',
  'integrations/jso-agent/profile.v1.json':'d1e6e5e16f83216053b6131ccc2d1dd7996ea019edd734ffde226fa7856e38b6',
  'integrations/jso-agent/deps/package.json':'c419a0a0cecf209d431a4155d5a5165020ff1a9e0b683638212d5034729a4bb8',
  'integrations/jso-agent/deps/package-lock.json':'e564ad1366177a6af060a0c4771c0d209f1d61fee980e2c3f40c62b47acb3812',
  'integrations/jso-agent/verify-required-skip.mjs':'d68a19c8a3eac7d3abfad2bc2d07bed100660609d4c686eecca519dafdf82b46',
  '.github/workflows/jso-agent-paired.yml':'aed2001d9b065e3e41eb54ac1bc7c706107bbf690eb8edbe6f453bfda01d0746',
  'integrations/jso-agent/compatibility.v1.json':'055802b95ecf6223ef664fcf399f23776806a2bb11367f55e56c444ebf19f5fe',
});
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function bytes(root, path) {
  const file=resolve(root,path), stat=lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error(`engine file must be regular: ${path}`);
  return readFileSync(file);
}
export function verifyEngineIdentity(root = ROOT, reference = null) {
  for (const [path, digest] of Object.entries(STABLE_FILES)) {
    const actual=bytes(root,path);
    if (createHash('sha256').update(actual).digest('hex') !== digest) throw Error(`stable bytes changed: ${path}`);
    if (reference && !actual.equals(bytes(reference,path))) throw Error(`immutable reference mismatch: ${path}`);
  }
  return {stableHarness:STABLE_HARNESS, files:STABLE_FILES};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2);
    if (args.length && !(args.length===2 && args[0]==='--reference')) throw Error('usage: verify-engine-identity.mjs [--reference exact-stable-checkout]');
    console.log(JSON.stringify(verifyEngineIdentity(ROOT,args[1] ? resolve(args[1]) : null)));
  } catch(error) { console.error(error.message);process.exitCode=1; }
}
