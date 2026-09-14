'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

// Linux source-only integration test: real Git, fresh synthetic objects and files only.
// Neither the repository's default maps nor any real payload/configuration is opened.
const tools = path.resolve(__dirname, '../scripts');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-boundary-'));
const repo = path.join(root, 'repo');
const template = path.join(root, 'empty-template');
const trace = path.join(root, 'synthetic-git-calls.jsonl');
const monitor = path.join(root, 'git-monitor.cjs');
fs.mkdirSync(repo); fs.mkdirSync(template);
const gitFlags = ['-c', 'remote.origin.promisor=false', '-c', 'protocol.allow=never', '-c', 'core.fsmonitor=false'];
const env = {
  PATH: '/usr/bin:/bin', HOME: path.join(root, 'absent-home'),
  GIT_ALLOW_PROTOCOL: '', GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0',
  GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 'Synthetic', GIT_AUTHOR_EMAIL: 'synthetic@example.invalid',
  GIT_COMMITTER_NAME: 'Synthetic', GIT_COMMITTER_EMAIL: 'synthetic@example.invalid',
  GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z'
};
function git(args, input) {
  const result = cp.spawnSync('git', [...gitFlags, ...args], { cwd: repo, env, input, timeout: 5000, maxBuffer: 1048576 });
  assert.equal(result.error, undefined, 'synthetic Git command completed');
  assert.equal(result.status, 0, 'synthetic Git command succeeded');
  return result.stdout.toString('utf8').trim();
}
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const data = new Map([
  ['fixture/a.cjs', Buffer.from('// Synthetic only; never executed.\n')],
  ['fixture/中文.cjs', Buffer.from('// Synthetic Unicode path only.\n')],
  ['fixture/executable.cjs', Buffer.from('// Synthetic executable mode; never executed.\n')],
  ['fixture/.env', Buffer.from('SYNTHETIC_NOT_A_SECRET\n')],
  ['fixture/private/blocked.txt', Buffer.from('SYNTHETIC_NOT_PRIVATE\n')],
  ['fixture/secrets/blocked.txt', Buffer.from('SYNTHETIC_NOT_A_SECRET\n')],
  ['fixture/file.pem', Buffer.from('SYNTHETIC_NOT_A_KEY\n')],
  ['fixture/logs/blocked.txt', Buffer.from('SYNTHETIC_NOT_A_LOG\n')],
  ['modelredirect.json', Buffer.from('{"synthetic":true}\n')],
  ['outside.txt', Buffer.from('SYNTHETIC_OUTSIDE_PACKAGE_ROOT\n')],
  ['fixture/link.cjs', Buffer.from('../outside.txt')]
]);
git(['init', '-q', `--template=${template}`]);
const objects = [...data].map(([name, bytes]) => ({ name, mode: name === 'fixture/link.cjs' ? '120000' : name === 'fixture/executable.cjs' ? '100755' : '100644', oid: git(['hash-object', '-w', '--stdin'], bytes) }));
function tree(rows) {
  const lines = []; const dirs = new Map();
  for (const row of rows) {
    const split = row.name.indexOf('/');
    if (split < 0) lines.push(`${row.mode} blob ${row.oid}\t${row.name}\0`);
    else {
      const head = row.name.slice(0, split);
      if (!dirs.has(head)) dirs.set(head, []);
      dirs.get(head).push({ ...row, name: row.name.slice(split + 1) });
    }
  }
  for (const [name, children] of dirs) lines.push(`040000 tree ${tree(children)}\t${name}\0`);
  return git(['mktree', '-z'], Buffer.from(lines.join('')));
}
const commit = git(['commit-tree', tree(objects)], Buffer.from('Synthetic fixture only\n'));
// Transparent instrumentation forwards to the real Git command with transport/config restrictions.
// It records only synthetic command arguments, never Git stdout/stderr or payload contents.
fs.writeFileSync(monitor, `const cp = require('node:child_process');
const fs = require('node:fs');
const original = cp.spawnSync;
cp.spawnSync = function(file, args, options) {
  if (file === 'git') {
    fs.appendFileSync(${JSON.stringify(trace)}, JSON.stringify(args) + '\\n');
    return original(file, [...${JSON.stringify(gitFlags)}, ...args], options);
  }
  return original(file, args, options);
};\n`);
let sequence = 0;
function packageMap(files) {
  return { schemaVersion: 1, payloadSourceCommit: commit, packages: [{ packageId: 'synthetic-package', creationIds: [], root: 'fixture', payloadClass: 'fixture', runtimeEligible: false, files, reviewExceptions: [], notes: 'Synthetic only; no runtime authorization.' }] };
}
function manifestFrame(files) {
  return Buffer.from(files.slice().sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(name => `${sha(data.get(name))}  ${name}\n`).join(''));
}
function prepare(map, manifest) {
  const dir = path.join(root, `case-${sequence++}`); fs.mkdirSync(dir);
  const raw = Buffer.from(JSON.stringify(map, null, 2) + '\n'); fs.writeFileSync(path.join(dir, 'map.json'), raw);
  if (manifest) {
    fs.writeFileSync(path.join(dir, 'manifest.sha256'), manifest);
    const attestation = { schemaVersion: 1, creationRegistrySha256: '', payloadSourceCommit: commit, packageFilesSha256: sha(raw), manifestSha256: sha(manifest), manifestEntryCount: manifest.toString().trim().split('\n').length };
    for (const key of ['defaultRuntimeAuthorization', 'pluginExecutionAuthorized', 'providerExecutionAuthorized', 'bridgeExecutionAuthorized', 'privateDataIncluded', 'databaseStateIncluded']) attestation[key] = false;
    fs.writeFileSync(path.join(dir, 'attestation.json'), JSON.stringify(attestation) + '\n');
  }
  return dir;
}
const builder = 'build-deterministic-manifest.cjs';
const verifier = 'verify-deterministic-manifest.cjs';
function run(tool, dir) {
  fs.writeFileSync(trace, '');
  const args = ['--no-addons', '--require', monitor, path.join(tools, tool), '--package-files', path.join(dir, 'map.json'), '--manifest', path.join(dir, 'manifest.sha256'), '--attestation', path.join(dir, 'attestation.json')];
  const result = cp.spawnSync(process.execPath, args, { cwd: repo, env, timeout: 10000, maxBuffer: 1048576 });
  assert.equal(result.error, undefined, 'tool finished within bounds'); assert.equal(result.signal, null);
  const calls = fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const reads = calls.filter(args => args[0] === 'show').map(args => args[1].slice(commit.length + 1));
  let output = null;
  if (result.stdout.length) output = JSON.parse(result.stdout.toString('utf8'));
  return { status: result.status, calls, reads, output };
}
function rejectedWithoutBodies(result) {
  assert.equal(result.status, 1); assert.deepEqual(result.reads, [], 'all metadata must pass before ANY payload body read');
}
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('fixed commit, Unicode and ordinary executable mode retain deterministic snapshots despite dirty worktree', () => {
  const files = ['fixture/中文.cjs', 'fixture/executable.cjs', 'fixture/a.cjs'];
  const dir = prepare(packageMap(files)); assert.equal(run(builder, dir).status, 0);
  const manifest = fs.readFileSync(path.join(dir, 'manifest.sha256')); const attestation = fs.readFileSync(path.join(dir, 'attestation.json'));
  assert.deepEqual(manifest, manifestFrame(files));
  fs.mkdirSync(path.join(repo, 'fixture')); fs.writeFileSync(path.join(repo, 'fixture/a.cjs'), 'DIRTY SYNTHETIC WORKTREE\n');
  assert.equal(run(builder, dir).status, 0);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'manifest.sha256')), manifest);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'attestation.json')), attestation);
  const result = run(verifier, dir); assert.equal(result.status, 0); assert.equal(result.output.ok, true);
});
const denied = ['fixture/.env', 'fixture/private/blocked.txt', 'fixture/secrets/blocked.txt', 'fixture/file.pem', 'fixture/logs/blocked.txt', 'modelredirect.json'];
for (const name of denied) {
  test(`builder rejects synthetic protected ${name} before any Git call`, () => {
    const result = run(builder, prepare(packageMap([name]))); rejectedWithoutBodies(result); assert.deepEqual(result.calls, []);
  });
  test(`verifier rejects synthetic protected ${name} before any blob read`, () => {
    const result = run(verifier, prepare(packageMap([name]), manifestFrame([name]))); rejectedWithoutBodies(result); assert.ok(result.output.counters.manifest_prohibited_path_count > 0);
  });
}
for (const name of ['../outside.txt', '/absolute.txt', 'C:/absolute.txt', 'fixture/*.cjs', 'fixture/../outside.txt']) {
  test(`builder rejects invalid exact path ${name} before Git`, () => {
    const result = run(builder, prepare(packageMap([name]))); rejectedWithoutBodies(result); assert.deepEqual(result.calls, []);
  });
}
for (const tool of [builder, verifier]) {
  test(`${tool} rejects Git symlink mode without reading link or target`, () => {
    rejectedWithoutBodies(run(tool, prepare(packageMap(['fixture/link.cjs']), manifestFrame(['fixture/link.cjs']))));
  });
}
test('unallowlisted ordinary entry prevents reads of both that entry and valid allowlisted entries', () => {
  const result = run(verifier, prepare(packageMap(['fixture/a.cjs']), manifestFrame(['fixture/a.cjs', 'outside.txt'])));
  rejectedWithoutBodies(result); assert.equal(result.output.counters.manifest_unallowlisted_path_count, 1);
});
test('explicit exact files retain existing package-root metadata behavior without inventing a new restriction', () => {
  const dir = prepare(packageMap(['outside.txt'])); assert.equal(run(builder, dir).status, 0);
  assert.equal(run(verifier, dir).status, 0);
});
test('invalid schema prevents all Git and payload reads', () => {
  const map = packageMap(['fixture/a.cjs']); map.schemaVersion = 99;
  const result = run(verifier, prepare(map, manifestFrame(['fixture/a.cjs'])));
  rejectedWithoutBodies(result); assert.deepEqual(result.calls, []); assert.ok(result.output.failures.length > 0);
});

for (const tool of [builder, verifier]) {
  for (const [kind, invalid] of [['symlink', 'fixture/link.cjs'], ['missing', 'fixture/z-missing.cjs'], ['tree', 'fixture']]) {
    test(`${tool} preflights all ${kind} metadata before reading any valid sibling`, () => {
      const files = ['fixture/a.cjs', invalid];
      const manifest = Buffer.from(`${sha(data.get('fixture/a.cjs'))}  fixture/a.cjs\n${'0'.repeat(64)}  ${invalid}\n`);
      const result = run(tool, prepare(packageMap(files), manifest));
      rejectedWithoutBodies(result);
    });
  }
}
test('verifier rejects unsorted manifest before blob phase', () => {
  const files = ['fixture/a.cjs', 'fixture/中文.cjs'];
  const manifest = Buffer.from(files.slice().reverse().map(name => `${sha(data.get(name))}  ${name}\n`).join(''));
  const result = run(verifier, prepare(packageMap(files), manifest));
  rejectedWithoutBodies(result); assert.equal(result.output.counters.formatting_error_count, 1);
});
test('verifier rejects duplicate manifest paths before blob phase', () => {
  const manifest = Buffer.concat([manifestFrame(['fixture/a.cjs']), manifestFrame(['fixture/a.cjs'])]);
  const result = run(verifier, prepare(packageMap(['fixture/a.cjs']), manifest));
  rejectedWithoutBodies(result); assert.equal(result.output.counters.duplicate_path_count, 1);
});
test('verifier rejects casefold collisions before blob phase', () => {
  const manifest = Buffer.from(`${'0'.repeat(64)}  fixture/A.cjs\n${sha(data.get('fixture/a.cjs'))}  fixture/a.cjs\n`);
  const result = run(verifier, prepare(packageMap(['fixture/a.cjs']), manifest));
  rejectedWithoutBodies(result); assert.equal(result.output.counters.casefold_collision_count, 1);
});
test('verifier rejects invalid manifest path before reading any valid sibling', () => {
  const manifest = Buffer.from(`${sha(data.get('fixture/a.cjs'))}  fixture/a.cjs\n${'0'.repeat(64)}  fixture/*.cjs\n`);
  const result = run(verifier, prepare(packageMap(['fixture/a.cjs']), manifest));
  rejectedWithoutBodies(result); assert.ok(result.output.counters.path_escape_count > 0);
});
for (const key of ['manifestSha256', 'providerExecutionAuthorized']) {
  test(`verifier rejects attestation ${key} mismatch before blob phase`, () => {
    const dir = prepare(packageMap(['fixture/a.cjs']), manifestFrame(['fixture/a.cjs']));
    const file = path.join(dir, 'attestation.json'); const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
    proof[key] = key === 'manifestSha256' ? '0'.repeat(64) : true; fs.writeFileSync(file, JSON.stringify(proof) + '\n');
    const result = run(verifier, dir); rejectedWithoutBodies(result); assert.ok(result.output.counters.attestation_mismatch_count > 0);
  });
}
test('verifier still hashes admitted payloads and rejects wrong digest', () => {
  const manifest = Buffer.from(`${'0'.repeat(64)}  fixture/a.cjs\n`);
  const result = run(verifier, prepare(packageMap(['fixture/a.cjs']), manifest));
  assert.equal(result.status, 1); assert.deepEqual(result.reads, ['fixture/a.cjs']); assert.equal(result.output.counters.manifest_hash_mismatch_count, 1);
});

// PR14: use the same actual CLI and synthetic Git fixture to observe registry ordering.
function changeProof(dir, mutate) {
  const file = path.join(dir, 'attestation.json');
  const proof = JSON.parse(fs.readFileSync(file, 'utf8'));
  const replacement = mutate(proof);
  fs.writeFileSync(file, JSON.stringify(replacement === undefined ? proof : replacement) + '\n');
}
function registryCase() {
  const dir = prepare(packageMap(['fixture/a.cjs']), manifestFrame(['fixture/a.cjs']));
  const registry = path.join(dir, 'registry.json');
  const bytes = Buffer.from('{"syntheticRegistry":true}\n');
  fs.writeFileSync(registry, bytes);
  changeProof(dir, proof => { proof.creationRegistrySha256 = sha(bytes); });
  return { dir, registry };
}
function observed(tool, dir, registry, supplied = true) {
  const readsFile = path.join(dir, 'registry-read-count.txt');
  const hook = path.join(dir, 'registry-monitor.cjs');
  fs.writeFileSync(readsFile, ''); fs.writeFileSync(trace, '');
  // Observe and forward the exact synthetic path only; do not replace its bytes or errors.
  fs.writeFileSync(hook, `const fs = require('node:fs');
const read = fs.readFileSync;
fs.readFileSync = function(file, ...args) {
  if (file === ${JSON.stringify(registry)}) fs.appendFileSync(${JSON.stringify(readsFile)}, 'R');
  return Reflect.apply(read, this, [file, ...args]);
};\n`);
  const args = ['--no-addons', '--require', monitor, '--require', hook, path.join(tools, tool), '--package-files', path.join(dir, 'map.json'), '--manifest', path.join(dir, 'manifest.sha256'), '--attestation', path.join(dir, 'attestation.json')];
  if (supplied) args.push('--registry', registry);
  const result = cp.spawnSync(process.execPath, args, { cwd: repo, env, timeout: 10000, maxBuffer: 1048576 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  const calls = fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  const reads = calls.filter(args => args[0] === 'show').map(args => args[1].slice(commit.length + 1));
  const output = result.stdout.length ? JSON.parse(result.stdout.toString('utf8')) : null;
  return { status: result.status, calls, reads, output, registryReads: fs.readFileSync(readsFile).length };
}
const independentProofChanges = [
  ['payloadSourceCommit', '0'.repeat(40)], ['packageFilesSha256', '0'.repeat(64)],
  ['manifestSha256', '0'.repeat(64)], ['manifestEntryCount', 2],
  ...['defaultRuntimeAuthorization', 'pluginExecutionAuthorized', 'providerExecutionAuthorized', 'bridgeExecutionAuthorized', 'privateDataIncluded', 'databaseStateIncluded'].map(key => [key, true])
];
for (const [key, value] of independentProofChanges) {
  test(`independent proof ${key} rejects before a supplied synthetic registry is read`, () => {
    const { dir, registry } = registryCase(); changeProof(dir, proof => { proof[key] = value; });
    const result = observed(verifier, dir, registry); rejectedWithoutBodies(result);
    assert.equal(result.registryReads, 0); assert.ok(result.output.counters.attestation_mismatch_count > 0);
  });
}
for (const [label, value] of [['missing', undefined], ['string', '1'], ['zero', 0], ['future', 2], ['null', null], ['boolean', true]]) {
  test(`attestation schemaVersion ${label} rejects before registry and payload`, () => {
    const { dir, registry } = registryCase(); changeProof(dir, proof => { proof.schemaVersion = value; });
    const result = observed(verifier, dir, registry); rejectedWithoutBodies(result); assert.equal(result.registryReads, 0);
    assert.ok(result.output.counters.attestation_mismatch_count > 0);
  });
}
for (const [label, proof] of [['null', null], ['array', []], ['number', 1]]) {
  test(`non-object attestation ${label} rejects before registry and payload`, () => {
    const { dir, registry } = registryCase(); changeProof(dir, () => proof);
    const result = observed(verifier, dir, registry); rejectedWithoutBodies(result); assert.equal(result.registryReads, 0);
    assert.ok(result.output.counters.attestation_mismatch_count > 0);
  });
}
test('bound registry cannot be omitted even when all other attestation fields match', () => {
  const { dir, registry } = registryCase(); const result = observed(verifier, dir, registry, false);
  rejectedWithoutBodies(result); assert.equal(result.registryReads, 0); assert.ok(result.output.counters.attestation_mismatch_count > 0);
});
for (const [label, value] of [['missing', undefined], ['empty', ''], ['malformed', 'not-a-digest']]) {
  test(`supplied registry with ${label} binding rejects before reading it`, () => {
    const { dir, registry } = registryCase(); changeProof(dir, proof => { proof.creationRegistrySha256 = value; });
    const result = observed(verifier, dir, registry); rejectedWithoutBodies(result); assert.equal(result.registryReads, 0);
  });
}
test('valid bound registry is read once and payload hashes still execute', () => {
  const { dir, registry } = registryCase(); const result = observed(verifier, dir, registry);
  assert.equal(result.status, 0); assert.equal(result.registryReads, 1); assert.deepEqual(result.reads, ['fixture/a.cjs']); assert.equal(result.output.ok, true);
});
test('valid registry shape with wrong digest reads only registry and rejects payload', () => {
  const { dir, registry } = registryCase(); changeProof(dir, proof => { proof.creationRegistrySha256 = '0'.repeat(64); });
  const result = observed(verifier, dir, registry); rejectedWithoutBodies(result); assert.equal(result.registryReads, 1); assert.equal(result.output.counters.attestation_mismatch_count, 1);
});
test('explicit empty registry binding preserves valid no-registry verification', () => {
  const { dir, registry } = registryCase(); changeProof(dir, proof => { proof.creationRegistrySha256 = ''; });
  const result = observed(verifier, dir, registry, false);
  assert.equal(result.status, 0); assert.equal(result.registryReads, 0); assert.deepEqual(result.reads, ['fixture/a.cjs']);
});
const validReview = () => ({ path: 'fixture/a.cjs', reason: 'Synthetic source fixture', riskClassification: 'reviewed_source_name_only', evidenceReference: 'synthetic-fixture', runtimeEligible: false });
const schemaChanges = [
  ['packageId', pkg => { pkg.packageId = 'invalid id'; }],
  ['payloadClass', pkg => { pkg.payloadClass = 'unknown'; }],
  ['runtimeEligible', pkg => { pkg.runtimeEligible = 'false'; }],
  ['reviewExceptions array', pkg => { pkg.reviewExceptions = {}; }],
  ['review object', pkg => { pkg.reviewExceptions = [null]; }],
  ['review required keys', pkg => { pkg.reviewExceptions = [{}]; }],
  ['review risk', pkg => { pkg.reviewExceptions = [{ ...validReview(), riskClassification: 'unknown' }]; }],
  ['review boolean', pkg => { pkg.reviewExceptions = [{ ...validReview(), runtimeEligible: 'false' }]; }],
  ['review unsupported key', pkg => { pkg.reviewExceptions = [{ ...validReview(), extra: false }]; }],
  ['package unsupported key', pkg => { pkg.extra = false; }]
];
for (const [label, mutate] of schemaChanges) {
  for (const tool of [builder, verifier]) {
    test(`${tool} applies shared package schema ${label} before all Git and payload reads`, () => {
      const map = packageMap(['fixture/a.cjs']); mutate(map.packages[0]);
      const dir = prepare(map, tool === verifier ? manifestFrame(['fixture/a.cjs']) : undefined);
      const result = run(tool, dir); rejectedWithoutBodies(result); assert.deepEqual(result.calls, []);
      if (tool === builder) { assert.equal(fs.existsSync(path.join(dir, 'manifest.sha256')), false); assert.equal(fs.existsSync(path.join(dir, 'attestation.json')), false); }
    });
  }
}
for (const tool of [builder, verifier]) {
  test(`${tool} rejects duplicate package identity with disjoint roots before Git`, () => {
    const map = packageMap(['fixture/a.cjs']); map.packages.push({ ...map.packages[0], root: 'other', files: ['outside.txt'] });
    const result = run(tool, prepare(map, manifestFrame(['fixture/a.cjs', 'outside.txt'])));
    rejectedWithoutBodies(result); assert.deepEqual(result.calls, []);
  });
}
test('shared package schema accepts existing valid review exception contract', () => {
  const map = packageMap(['fixture/a.cjs']); map.packages[0].reviewExceptions = [validReview()];
  const dir = prepare(map); assert.equal(run(builder, dir).status, 0); assert.equal(run(verifier, dir).status, 0);
});
for (const placement of ['leading', 'internal', 'trailing']) {
  test(`canonical manifest rejects ${placement} blank record before registry and payload`, () => {
    const files = ['fixture/a.cjs', 'fixture/中文.cjs']; const original = manifestFrame(files).toString();
    const text = placement === 'leading' ? '\n' + original : placement === 'trailing' ? original + '\n' : original.replace('\n', '\n\n');
    const dir = prepare(packageMap(files), Buffer.from(text)); changeProof(dir, proof => { proof.manifestEntryCount = files.length; });
    const registry = path.join(dir, 'registry.json'); fs.writeFileSync(registry, '{}\n');
    const result = observed(verifier, dir, registry, false); rejectedWithoutBodies(result); assert.equal(result.registryReads, 0); assert.deepEqual(result.calls, []);
  });
}
test('empty package set retains the builder single-LF output and zero-entry verification', () => {
  const map = packageMap([]); map.packages = [];
  const dir = prepare(map); assert.equal(run(builder, dir).status, 0);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'manifest.sha256')), Buffer.from('\n'));
  const result = run(verifier, dir); assert.equal(result.status, 0); assert.equal(result.output.manifestEntryCount, 0); assert.deepEqual(result.reads, []);
});
test('empty package set rejects multiple LF rather than admitting empty records', () => {
  const map = packageMap([]); map.packages = [];
  const dir = prepare(map, Buffer.from('\n\n')); changeProof(dir, proof => { proof.manifestEntryCount = 0; });
  const result = run(verifier, dir); rejectedWithoutBodies(result); assert.deepEqual(result.calls, []);
});
test('nonempty package set cannot use the single-LF zero-entry output', () => {
  const dir = prepare(packageMap(['fixture/a.cjs']), Buffer.from('\n')); changeProof(dir, proof => { proof.manifestEntryCount = 0; });
  const result = run(verifier, dir); rejectedWithoutBodies(result); assert.equal(result.output.counters.allowlisted_missing_from_manifest_count, 1);
});

// PR14 CLI follow-up: all input values are explicit synthetic files, never defaults.
function runArgvCase(tool, dir, suffix) {
  fs.writeFileSync(trace, '');
  const observedPaths = ['map.json', 'manifest.sha256', 'attestation.json', 'registry.json'].map(name => path.join(dir, name));
  const readTrace = path.join(dir, 'input-read-count.txt'); fs.writeFileSync(readTrace, '');
  const hook = path.join(dir, 'input-monitor.cjs');
  fs.writeFileSync(hook, `const fs = require('node:fs');
const read = fs.readFileSync; const selected = new Set(${JSON.stringify(observedPaths)});
fs.readFileSync = function(file, ...args) {
  if (selected.has(file)) fs.appendFileSync(${JSON.stringify(readTrace)}, 'R');
  return Reflect.apply(read, this, [file, ...args]);
};\n`);
  const args = ['--no-addons', '--require', monitor, '--require', hook, path.join(tools, tool), '--package-files', observedPaths[0], '--manifest', observedPaths[1], '--attestation', observedPaths[2], ...suffix];
  const result = cp.spawnSync(process.execPath, args, { cwd: repo, env, timeout: 10000, maxBuffer: 1048576 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  const calls = fs.readFileSync(trace, 'utf8').split('\n').filter(Boolean).map(JSON.parse);
  return { status: result.status, calls, inputReads: fs.readFileSync(readTrace).length };
}
for (const tool of [builder, verifier]) {
  const options = ['--package-files', '--manifest', '--attestation', '--registry', ...(tool === builder ? ['--verifier-path'] : [])];
  for (const option of options) {
    for (const [label, tail] of [['missing', []], ['empty', ['']], ['next-option', ['--registry']]]) {
      test(`${tool} rejects ${option} ${label} value before any input or Git read`, () => {
        const dir = prepare(packageMap(['fixture/a.cjs']), manifestFrame(['fixture/a.cjs']));
        const result = runArgvCase(tool, dir, [option, ...tail]);
        assert.equal(result.status, 1); assert.equal(result.inputReads, 0); assert.deepEqual(result.calls, []);
      });
    }
  }
  test(`${tool} cannot erase a supplied registry with a repeated empty argument`, () => {
    const { dir, registry } = registryCase();
    const result = runArgvCase(tool, dir, ['--registry', registry, '--registry', '']);
    assert.equal(result.status, 1); assert.equal(result.inputReads, 0); assert.deepEqual(result.calls, []);
  });
}
test('explicit dot-prefixed double-dash path and nonempty verifier metadata remain valid', () => {
  const dir = prepare(packageMap(['fixture/a.cjs']), manifestFrame(['fixture/a.cjs']));
  const name = `--synthetic-registry-${sequence++}.json`; const bytes = Buffer.from('{"synthetic":true}\n');
  fs.writeFileSync(path.join(repo, name), bytes);
  const result = runArgvCase(builder, dir, ['--registry', './' + name, '--verifier-path', ' synthetic verifier metadata ']);
  assert.equal(result.status, 0);
  const proof = JSON.parse(fs.readFileSync(path.join(dir, 'attestation.json'), 'utf8'));
  assert.equal(proof.creationRegistrySha256, sha(bytes)); assert.equal(proof.verifierPath, ' synthetic verifier metadata ');
  assert.equal(runArgvCase(verifier, dir, ['--registry', './' + name]).status, 0);
});

// Exact synthetic receipt-category paths satisfy the real tree metadata checks.
// No operational receipt or repository receipt is read or executed.
const receiptPaths = ['receipts/run.md', 'fixture/receipts/run.md', 'fixture/Receipts/run.md'];
const similarPaths = ['fixture/receipts.txt', 'receipts-source/a.cjs'];
const receiptBytes = Buffer.from('SYNTHETIC CATEGORY FIXTURE ONLY; NOT AN OPERATIONAL RECEIPT.\n');
const receiptObjects = [...receiptPaths, ...similarPaths].map(name => ({ name, mode: '100644', oid: git(['hash-object', '-w', '--stdin'], receiptBytes) }));
const receiptCommit = git(['commit-tree', tree([...objects, ...receiptObjects])], Buffer.from('Synthetic receipt-category metadata only\n'));
function prepareReceipts(files) {
  const map = packageMap(files); map.payloadSourceCommit = receiptCommit;
  const frame = Buffer.from(files.slice().sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(name => `${sha(data.has(name) ? data.get(name) : receiptBytes)}  ${name}\n`).join(''));
  const dir = prepare(map, frame); changeProof(dir, proof => { proof.payloadSourceCommit = receiptCommit; }); return dir;
}
for (const tool of [builder, verifier]) {
  for (const name of receiptPaths) {
    test(`${tool} rejects exact receipt segment ${name} before all payload bodies`, () => {
      const result = run(tool, prepareReceipts(['fixture/a.cjs', name])); rejectedWithoutBodies(result);
      if (tool === builder) assert.deepEqual(result.calls, []);
      else assert.equal(result.output.counters.manifest_prohibited_path_count, 2);
    });
  }
  for (const name of similarPaths) {
    test(`${tool} retains non-receipt exact segment ${name}`, () => {
      const result = run(tool, prepareReceipts([name])); assert.equal(result.status, 0); assert.deepEqual(result.reads, [name]);
    });
  }
}

// PR14 output/root follow-up: actual CLI with only temporary synthetic inputs.
function failedRegistryPreservesOutputs(kind, existing) {
  const dir = prepare(packageMap(['fixture/a.cjs']));
  const outputDir = path.join(dir, 'outputs');
  const manifest = path.join(outputDir, 'manifest.sha256');
  const attestation = path.join(outputDir, 'attestation.json');
  const oldManifest = Buffer.from('SYNTHETIC PREVIOUS MANIFEST\n');
  const oldAttestation = Buffer.from('SYNTHETIC PREVIOUS ATTESTATION\n');
  if (existing) {
    fs.mkdirSync(outputDir);
    fs.writeFileSync(manifest, oldManifest);
    fs.writeFileSync(attestation, oldAttestation);
  }
  const registry = path.join(dir, 'registry.json');
  if (kind === 'directory') fs.mkdirSync(registry);
  if (kind === 'injected-eacces') fs.writeFileSync(registry, '{"synthetic":true}\n');
  const events = path.join(dir, 'output-events.txt');
  fs.writeFileSync(events, '');
  const hook = path.join(dir, 'output-monitor.cjs');
  // Missing and directory reads forward real errors. EACCES is injected for this
  // one synthetic registry so the test is independent of the namespace's UID.
  fs.writeFileSync(hook, `const fs = require('node:fs');
const read = fs.readFileSync, write = fs.writeFileSync, mkdir = fs.mkdirSync;
fs.readFileSync = function(file, ...args) {
  if (file === ${JSON.stringify(registry)}) {
    fs.appendFileSync(${JSON.stringify(events)}, 'R');
    if (${JSON.stringify(kind)} === 'injected-eacces') {
      const error = new Error('Synthetic registry read denied'); error.code = 'EACCES'; throw error;
    }
  }
  return Reflect.apply(read, this, [file, ...args]);
};
fs.writeFileSync = function(file, ...args) {
  if ([${JSON.stringify(manifest)}, ${JSON.stringify(attestation)}].includes(file)) fs.appendFileSync(${JSON.stringify(events)}, 'W');
  return Reflect.apply(write, this, [file, ...args]);
};
fs.mkdirSync = function(file, ...args) {
  if (file === ${JSON.stringify(outputDir)}) fs.appendFileSync(${JSON.stringify(events)}, 'M');
  return Reflect.apply(mkdir, this, [file, ...args]);
};
`);
  const result = cp.spawnSync(process.execPath, [
    '--no-addons', '--require', monitor, '--require', hook, path.join(tools, builder),
    '--package-files', path.join(dir, 'map.json'), '--manifest', manifest,
    '--attestation', attestation, '--registry', registry
  ], { cwd: repo, env, timeout: 10000, maxBuffer: 1048576 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 1, 'failed registry must reject the build');
  assert.equal(result.stdout.length, 0, 'no successful build response');
  const observedEvents = fs.readFileSync(events, 'utf8');
  assert.equal(observedEvents.replace(/[^R]/g, ''), 'R', 'the supplied registry read was attempted once');
  if (existing) {
    assert.deepEqual(fs.readFileSync(manifest), oldManifest, 'previous manifest bytes preserved');
    assert.deepEqual(fs.readFileSync(attestation), oldAttestation, 'previous attestation bytes preserved');
  } else {
    assert.equal(fs.existsSync(outputDir), false, 'failed input does not create the output directory');
  }
  assert.equal(observedEvents, 'R', 'no output mkdir or write before registry validation');
}
for (const kind of ['missing', 'directory', 'injected-eacces']) {
  for (const existing of [true, false]) {
    test(`builder ${kind} registry failure preserves ${existing ? 'existing outputs' : 'absent output directory'}`, () => {
      failedRegistryPreservesOutputs(kind, existing);
    });
  }
}

function rootMap(roots) {
  const files = ['fixture/a.cjs', 'outside.txt'];
  const map = packageMap([files[0]]);
  map.packages = roots.map((root, index) => ({
    ...map.packages[0], root, packageId: 'synthetic-root-' + index, files: [files[index]]
  }));
  return { map, files: files.slice(0, roots.length) };
}
for (const tool of [builder, verifier]) {
  for (const root of ['./fixture', 'fixture/.', 'fixture//child', 'fixture/./child', '.', 'fixture//child///']) {
    test(`${tool} rejects noncanonical root ${root} before any Git or payload read`, () => {
      const { map, files } = rootMap([root]);
      const result = run(tool, prepare(map, manifestFrame(files)));
      rejectedWithoutBodies(result); assert.deepEqual(result.calls, []);
    });
  }
  for (const roots of [['fixture', './fixture'], ['fixture/child', 'fixture//child'], ['fixture', './fixture/child']]) {
    test(`${tool} rejects aliased overlapping roots ${roots.join(' vs ')} before any Git or payload read`, () => {
      const { map, files } = rootMap(roots);
      const result = run(tool, prepare(map, manifestFrame(files)));
      rejectedWithoutBodies(result); assert.deepEqual(result.calls, []);
    });
  }
  for (const root of ['fixture/', 'fixture///', 'fixture/中文.v1', 'fixture.v1', 'fixture / child']) {
    test(`${tool} preserves existing exact-root metadata ${root}`, () => {
      const { map, files } = rootMap([root]);
      const dir = prepare(map, manifestFrame(files)); const result = run(tool, dir);
      assert.equal(result.status, 0); assert.deepEqual(result.reads, files);
      assert.deepEqual(fs.readFileSync(path.join(dir, 'manifest.sha256')), manifestFrame(files));
    });
  }
  for (const roots of [['fixture/', 'fixture///'], ['fixture///', 'fixture/child/']]) {
    test(`${tool} retains normalized root overlap rejection ${roots.join(' vs ')}`, () => {
      const { map, files } = rootMap(roots);
      const result = run(tool, prepare(map, manifestFrame(files)));
      rejectedWithoutBodies(result); assert.deepEqual(result.calls, []);
    });
  }
}


// PR14 object identity follow-up: replacement refs and clones are synthetic/tmpfs only.
function invokeAt(tool, dir, cwd) {
  fs.writeFileSync(trace, '');
  assert.equal(Object.hasOwn(env, 'GIT_NO_REPLACE_OBJECTS'), false, 'fixture must not mask the production fix');
  const result = cp.spawnSync(process.execPath, [
    '--no-addons', '--require', monitor, path.join(tools, tool),
    '--package-files', path.join(dir, 'map.json'), '--manifest', path.join(dir, 'manifest.sha256'),
    '--attestation', path.join(dir, 'attestation.json')
  ], { cwd, env, timeout: 10000, maxBuffer: 1048576 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  return { status: result.status, stdout: result.stdout,
    output: result.stdout.length ? JSON.parse(result.stdout.toString('utf8')) : null };
}
function withSyntheticReplacement(kind, check) {
  const different = Buffer.from('// SYNTHETIC REPLACEMENT PAYLOAD ONLY\n');
  const replacementBlob = git(['hash-object', '-w', '--stdin'], different);
  const originalBlob = objects.find(row => row.name === 'fixture/a.cjs').oid;
  const replacementCommit = git(['commit-tree', tree(objects.map(row =>
    row.name === 'fixture/a.cjs' ? { ...row, oid: replacementBlob } : row
  ))], Buffer.from('Synthetic replacement commit only\n'));
  const replaced = kind === 'commit' ? commit : originalBlob;
  const replacement = kind === 'commit' ? replacementCommit : replacementBlob;
  git(['update-ref', 'refs/heads/synthetic', commit]);
  git(['symbolic-ref', 'HEAD', 'refs/heads/synthetic']);
  git(['update-ref', 'refs/replace/' + replaced, replacement]);
  try {
    // Prove replacement lookup is active when the caller does not disable it.
    assert.equal(git(['show', commit + ':fixture/a.cjs']), different.toString('utf8').trim());
    const clean = path.join(root, 'clean-clone-' + sequence++);
    const cloned = cp.spawnSync('git', [...gitFlags, '-c', 'protocol.file.allow=always',
      'clone', '--local', '--no-hardlinks', '--no-checkout', '--template=' + template, repo, clean
    ], { env: { ...env, GIT_ALLOW_PROTOCOL: 'file' }, timeout: 10000, maxBuffer: 1048576 });
    assert.equal(cloned.error, undefined); assert.equal(cloned.status, 0, 'exact synthetic local clone succeeds');
    const refs = cp.spawnSync('git', [...gitFlags, 'for-each-ref', '--format=%(refname)', 'refs/replace'],
      { cwd: clean, env, timeout: 5000, maxBuffer: 1048576 });
    assert.equal(refs.status, 0); assert.equal(refs.stdout.length, 0, 'clean clone carries no replacement refs');
    check({ clean, different });
  } finally {
    git(['update-ref', '-d', 'refs/replace/' + replaced]);
  }
}
for (const kind of ['commit', 'blob']) {
  test(`builder ignores synthetic ${kind} replacement and matches the clean clone bytes`, () => {
    withSyntheticReplacement(kind, ({ clean }) => {
      const dir = prepare(packageMap(['fixture/a.cjs']));
      const replacedBuild = invokeAt(builder, dir, repo);
      const manifest = fs.readFileSync(path.join(dir, 'manifest.sha256'));
      const attestation = fs.readFileSync(path.join(dir, 'attestation.json'));
      const cleanBuild = invokeAt(builder, dir, clean);
      assert.equal(replacedBuild.status, 0); assert.equal(cleanBuild.status, 0);
      assert.deepEqual(manifest, manifestFrame(['fixture/a.cjs']), 'hash the attested original commit object');
      assert.deepEqual(manifest, fs.readFileSync(path.join(dir, 'manifest.sha256')));
      assert.deepEqual(attestation, fs.readFileSync(path.join(dir, 'attestation.json')));
      assert.deepEqual(replacedBuild.stdout, cleanBuild.stdout);
      assert.equal(JSON.parse(attestation).payloadSourceCommit, commit);
    });
  });
  test(`verifier accepts original objects despite synthetic ${kind} replacement and matches clean clone`, () => {
    withSyntheticReplacement(kind, ({ clean }) => {
      const dir = prepare(packageMap(['fixture/a.cjs']), manifestFrame(['fixture/a.cjs']));
      const replacedVerify = invokeAt(verifier, dir, repo);
      const cleanVerify = invokeAt(verifier, dir, clean);
      assert.equal(cleanVerify.status, 0); assert.equal(replacedVerify.status, 0);
      assert.equal(replacedVerify.output.ok, true); assert.deepEqual(replacedVerify.stdout, cleanVerify.stdout);
    });
  });
  test(`verifier rejects a digest borrowed from synthetic ${kind} replacement in both repositories`, () => {
    withSyntheticReplacement(kind, ({ clean, different }) => {
      const forged = Buffer.from(sha(different) + '  fixture/a.cjs\n');
      const dir = prepare(packageMap(['fixture/a.cjs']), forged);
      const replacedVerify = invokeAt(verifier, dir, repo);
      const cleanVerify = invokeAt(verifier, dir, clean);
      assert.equal(cleanVerify.status, 1); assert.equal(replacedVerify.status, 1);
      assert.equal(replacedVerify.output.counters.manifest_hash_mismatch_count, 1);
      assert.deepEqual(replacedVerify.stdout, cleanVerify.stdout);
    });
  });
}

// These names model denied categories; every committed body below is synthetic.
const selfReferencePaths = ['manifests/MANIFEST.sha256', 'manifests/PAYLOAD_ATTESTATION.json'];
const namedEnvPaths = [
  'fixture/credentials.env', 'fixture/service.env.local', 'nested/service.ENV.PRODUCTION',
  'fixture/service.env.production.local', 'fixture/service.env.example.local', 'fixture/service.env.template.local'
];
const namedTemplatePaths = [
  'fixture/service.env.example', 'fixture/service.env.template', 'fixture/config.env.example',
  'fixture/config.env.template', 'fixture/service.environment', 'fixture/example.service.env.template'
];
const identityBytes = Buffer.from('SYNTHETIC CATEGORY DATA ONLY; NO CREDENTIALS OR OPERATIONAL DATA\n');
const identityObjects = [...selfReferencePaths, ...namedEnvPaths, ...namedTemplatePaths].map(name => ({
  name, mode: '100644', oid: git(['hash-object', '-w', '--stdin'], identityBytes)
}));
const identityCommit = git(['commit-tree', tree([...objects, ...identityObjects])],
  Buffer.from('Synthetic identity-category fixture only\n'));
function prepareIdentity(files, rootOverride) {
  const map = packageMap(files); map.payloadSourceCommit = identityCommit;
  if (rootOverride !== undefined) map.packages[0].root = rootOverride;
  const frame = Buffer.from(files.slice().sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)))
    .map(name => sha(data.has(name) ? data.get(name) : identityBytes) + '  ' + name + '\n').join(''));
  const dir = prepare(map, frame); changeProof(dir, proof => { proof.payloadSourceCommit = identityCommit; }); return dir;
}
for (const tool of [builder, verifier]) {
  for (const name of selfReferencePaths) {
    test(`${tool} rejects self-reference payload ${name} before any sibling or artifact body`, () => {
      const result = run(tool, prepareIdentity(['fixture/a.cjs', name]));
      rejectedWithoutBodies(result);
    });
    test(`${tool} rejects self-reference package root ${name} before any Git or body`, () => {
      const result = run(tool, prepareIdentity(['fixture/a.cjs'], name));
      rejectedWithoutBodies(result); assert.deepEqual(result.calls, []);
    });
  }
  for (const name of namedEnvPaths) {
    test(`${tool} rejects non-template env suffix ${name} before all body reads`, () => {
      rejectedWithoutBodies(run(tool, prepareIdentity(['fixture/a.cjs', name])));
    });
  }
  for (const name of namedTemplatePaths) {
    test(`${tool} preserves prior named template or ordinary path ${name}`, () => {
      const result = run(tool, prepareIdentity([name]));
      assert.equal(result.status, 0); assert.deepEqual(result.reads, [name]);
    });
  }
}


// Adjacent identity checks retain the existing string SHA/ID contract; no new schema fields.
for (const tool of [builder, verifier]) {
  test(`${tool} rejects array payloadSourceCommit before Git despite a coercible hex value`, () => {
    const map = packageMap(['fixture/a.cjs']); map.payloadSourceCommit = [commit];
    const dir = prepare(map, manifestFrame(['fixture/a.cjs']));
    changeProof(dir, proof => { proof.payloadSourceCommit = [commit]; });
    const result = run(tool, dir); rejectedWithoutBodies(result); assert.deepEqual(result.calls, []);
  });
  for (const [kind, packageId] of [['array', ['synthetic-package']], ['number', 123], ['boolean', true]]) {
    test(`${tool} rejects ${kind} packageId before Git rather than regex coercion`, () => {
      const map = packageMap(['fixture/a.cjs']); map.packages[0].packageId = packageId;
      const result = run(tool, prepare(map, manifestFrame(['fixture/a.cjs'])));
      rejectedWithoutBodies(result); assert.deepEqual(result.calls, []);
    });
  }
  test(`${tool} rejects duplicate array packageIds that are distinct JSON objects`, () => {
    const map = packageMap(['fixture/a.cjs']); map.packages[0].packageId = ['same'];
    map.packages.push({ ...map.packages[0], packageId: ['same'], root: 'other', files: ['outside.txt'] });
    const result = run(tool, prepare(map, manifestFrame(['fixture/a.cjs', 'outside.txt'])));
    rejectedWithoutBodies(result); assert.deepEqual(result.calls, []);
  });
}

