'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');

const tools = path.resolve(__dirname, '../scripts');
const builder = path.join(tools, 'build-deterministic-manifest.cjs');
const verifier = path.join(tools, 'verify-deterministic-manifest.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-final-boundary-'));
const repo = path.join(root, 'repo');
const cases = path.join(root, 'cases');
const replacementPath = 'fixture/\uFFFD.cjs';
const replacementBytes = Buffer.from('// synthetic U+FFFD path only\n');

fs.mkdirSync(repo);
fs.mkdirSync(cases);

const env = {
  ...process.env,
  HOME: path.join(root, 'home'),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_TERMINAL_PROMPT: '0',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_AUTHOR_NAME: 'Synthetic',
  GIT_AUTHOR_EMAIL: 'synthetic@example.invalid',
  GIT_COMMITTER_NAME: 'Synthetic',
  GIT_COMMITTER_EMAIL: 'synthetic@example.invalid'
};

function git(args, input) {
  const result = cp.spawnSync('git', args, {
    cwd: repo,
    env,
    input,
    timeout: 5000,
    maxBuffer: 1024 * 1024
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr.toString('utf8'));
  return result.stdout.toString('utf8').trim();
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function run(tool, dir) {
  const result = cp.spawnSync(process.execPath, [
    '--no-addons',
    tool,
    '--package-files', path.join(dir, 'map.json'),
    '--manifest', path.join(dir, 'manifest.sha256'),
    '--attestation', path.join(dir, 'attestation.json')
  ], {
    cwd: repo,
    env,
    timeout: 10000,
    maxBuffer: 1024 * 1024
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return {
    status: result.status,
    stdout: result.stdout.toString('utf8'),
    stderr: result.stderr.toString('utf8')
  };
}

let sequence = 0;
function caseDir() {
  const dir = path.join(cases, String(sequence++));
  fs.mkdirSync(dir);
  return dir;
}

function packageMap(sourceCommit) {
  return {
    schemaVersion: 1,
    payloadSourceCommit: sourceCommit,
    packages: [{
      packageId: 'synthetic-final-boundary',
      creationIds: [],
      root: 'fixture',
      payloadClass: 'fixture',
      runtimeEligible: false,
      files: [replacementPath],
      reviewExceptions: [],
      notes: 'Synthetic only; no runtime authorization.'
    }]
  };
}

function writeMap(dir, map, crlf = false) {
  let text = JSON.stringify(map, null, 2) + '\n';
  if (crlf) text = text.replace(/\n/g, '\r\n');
  fs.writeFileSync(path.join(dir, 'map.json'), Buffer.from(text, 'utf8'));
}

function replaceFirstValidReplacementCharacter(bytes) {
  const marker = Buffer.from('\uFFFD', 'utf8');
  const index = bytes.indexOf(marker);
  assert.notEqual(index, -1, 'fixture contains a real U+FFFD byte sequence');
  return Buffer.concat([
    bytes.subarray(0, index),
    Buffer.from([0xff]),
    bytes.subarray(index + marker.length)
  ]);
}

fs.mkdirSync(path.join(repo, 'fixture'));
fs.writeFileSync(path.join(repo, replacementPath), replacementBytes);
git(['init', '-q']);
git(['add', '--', replacementPath]);
git(['commit', '-qm', 'synthetic source commit']);
const commit = git(['rev-parse', 'HEAD']);
git(['tag', '-a', 'synthetic-annotated', '-m', 'synthetic annotated tag', commit]);
const tagObject = git(['rev-parse', 'refs/tags/synthetic-annotated']);
assert.equal(git(['cat-file', '-t', commit]), 'commit');
assert.equal(git(['cat-file', '-t', tagObject]), 'tag');

test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('valid U+FFFD package path remains accepted end-to-end', () => {
  const dir = caseDir();
  writeMap(dir, packageMap(commit));
  assert.equal(run(builder, dir).status, 0);
  const verified = run(verifier, dir);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).ok, true);
});

test('package CRLF to LF canonicalization remains accepted', () => {
  const dir = caseDir();
  writeMap(dir, packageMap(commit), true);
  assert.equal(run(builder, dir).status, 0);
  const verified = run(verifier, dir);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).ok, true);
});

test('verifier rejects malformed package UTF-8 instead of hashing a lossy re-encoding', () => {
  const dir = caseDir();
  writeMap(dir, packageMap(commit));
  assert.equal(run(builder, dir).status, 0);
  const file = path.join(dir, 'map.json');
  fs.writeFileSync(file, replaceFirstValidReplacementCharacter(fs.readFileSync(file)));
  const verified = run(verifier, dir);
  assert.equal(verified.status, 1);
  assert.match(verified.stderr, /PACKAGE_FILES must be valid UTF-8/);
});

test('verifier rejects malformed manifest UTF-8 instead of hashing a lossy re-encoding', () => {
  const dir = caseDir();
  writeMap(dir, packageMap(commit));
  assert.equal(run(builder, dir).status, 0);
  const file = path.join(dir, 'manifest.sha256');
  fs.writeFileSync(file, replaceFirstValidReplacementCharacter(fs.readFileSync(file)));
  const verified = run(verifier, dir);
  assert.equal(verified.status, 1);
  assert.match(verified.stderr, /MANIFEST must be valid UTF-8/);
});

test('builder rejects an annotated tag object as payloadSourceCommit', () => {
  const dir = caseDir();
  writeMap(dir, packageMap(tagObject));
  const built = run(builder, dir);
  assert.equal(built.status, 1);
  assert.match(built.stderr, /payloadSourceCommit must identify a commit object directly/);
  assert.equal(fs.existsSync(path.join(dir, 'manifest.sha256')), false);
  assert.equal(fs.existsSync(path.join(dir, 'attestation.json')), false);
});

test('verifier rejects an annotated tag object even when proof hashes are rebound to it', () => {
  const dir = caseDir();
  writeMap(dir, packageMap(commit));
  assert.equal(run(builder, dir).status, 0);

  const rebound = packageMap(tagObject);
  const reboundBytes = Buffer.from(JSON.stringify(rebound, null, 2) + '\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'map.json'), reboundBytes);

  const proofPath = path.join(dir, 'attestation.json');
  const proof = JSON.parse(fs.readFileSync(proofPath, 'utf8'));
  proof.payloadSourceCommit = tagObject;
  proof.packageFilesSha256 = sha256(reboundBytes);
  fs.writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n');

  const verified = run(verifier, dir);
  assert.equal(verified.status, 1);
  const result = JSON.parse(verified.stdout);
  assert.equal(result.ok, false);
  assert.ok(result.failures.includes('payloadSourceCommit must identify a commit object directly'));
});
