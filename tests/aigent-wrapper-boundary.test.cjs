'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const INPUT_LIMIT = 16 * 1024;
const packages = ['AIGentQuality', 'AIGentStyle', 'AIGentWorkflow'];
const health = Buffer.from(JSON.stringify({ action: 'HealthCheck' }));
function pad(size, value = health) {
  assert(value.length <= size);
  return Buffer.concat([value, Buffer.alloc(size - value.length, 0x20)]);
}
function entry(name) { return path.join(repoRoot, 'Plugin', name, 'stdio-entrypoint.cjs'); }
function runMain(name, chunks, { waitForEOF = false, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--permission', `--allow-fs-read=${repoRoot}`, `--allow-fs-read=${os.tmpdir()}`,
      '--no-addons', entry(name)
    ], { env: { PATH: '/usr/bin', LANG: 'C.UTF-8', TZ: 'UTC', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let ended = false;
    let outputBeforeEOF = false;
    let outputBytes = 0;
    const output = [];
    const deadline = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('synthetic stdin deadline')); }, 3000);
    child.once('error', error => { clearTimeout(deadline); reject(error); });
    child.stdout.on('data', chunk => {
      outputBytes += chunk.length;
      if (outputBytes > 65536) { child.kill('SIGKILL'); reject(new Error('synthetic stdout limit')); return; }
      if (!ended) outputBeforeEOF = true;
      output.push(chunk);
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(deadline);
      try {
        assert.equal(code, 0); assert.equal(signal, null);
        const text = Buffer.concat(output).toString('utf8');
        assert.equal((text.match(/\n/g) || []).length, 1);
        assert.equal(text.endsWith('\n'), true);
        resolve({ response: JSON.parse(text), outputBeforeEOF });
      } catch (error) { reject(error); }
    });
    (async () => {
      for (let i = 0; i < chunks.length; i++) {
        if (child.stdin.destroyed) break;
        child.stdin.write(chunks[i]);
        if (i + 1 < chunks.length) await new Promise(r => setTimeout(r, 40));
      }
      if (waitForEOF) await new Promise(r => setTimeout(r, 60));
      ended = true; child.stdin.end();
    })().catch(reject);
  });
}
function assertError(response, code) {
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, code);
  assert.equal(response.result, undefined);
}
for (const name of packages) {
  test(`${name}: main accepts exact byte limit at EOF`, async () => {
    assert.equal((await runMain(name, [pad(INPUT_LIMIT)])).response.status, 'success');
  });
  test(`${name}: main rejects one chunk over byte limit`, async () => {
    assertError((await runMain(name, [pad(INPUT_LIMIT + 1)])).response, 'INPUT_TOO_LARGE');
  });
  test(`${name}: main rejects valid prefix plus overflowing chunk`, async () => {
    assertError((await runMain(name, [health, Buffer.alloc(INPUT_LIMIT + 1 - health.length, 0x20)])).response, 'INPUT_TOO_LARGE');
  });
  test(`${name}: main counts UTF-8 bytes`, async () => {
    const value = Buffer.from(JSON.stringify({ action: 'HealthCheck', note: '中'.repeat(5500) }));
    assert(value.toString('utf8').length < INPUT_LIMIT && value.length > INPUT_LIMIT);
    assertError((await runMain(name, [value])).response, 'INPUT_TOO_LARGE');
  });
  test(`${name}: main preserves split UTF-8 at exact limit`, async () => {
    const value = Buffer.from(JSON.stringify({ action: 'HealthCheck', note: '😀'.repeat(1000) }));
    const data = pad(INPUT_LIMIT, value); const split = value.indexOf(Buffer.from('😀')) + 2;
    assert.equal((await runMain(name, [data.subarray(0, split), data.subarray(split)])).response.status, 'success');
  });
  test(`${name}: main waits for EOF`, async () => {
    const result = await runMain(name, [health], { waitForEOF: true });
    assert.equal(result.outputBeforeEOF, false); assert.equal(result.response.status, 'success');
  });
  test(`${name}: main rejects incomplete JSON at EOF`, async () => {
    assertError((await runMain(name, [Buffer.from('{"action":"HealthCheck"')])).response, 'INVALID_JSON');
  });
  test(`${name}: main rejects non-JSON suffix at EOF`, async () => {
    assertError((await runMain(name, [health, Buffer.from('x')])).response, 'INVALID_JSON');
  });
  test(`${name}: runStdinText also rejects oversized input`, async () => {
    const wrapper = require(entry(name));
    assertError(JSON.parse(await wrapper.runStdinText(pad(INPUT_LIMIT + 1).toString('utf8'), {})), 'INPUT_TOO_LARGE');
  });
}

function writePng(file) {
  const b = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(1, 16); b.writeUInt32BE(1, 20);
  fs.writeFileSync(file, b);
}
async function withFixture(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aigent-wrapper-'));
  const grant = path.join(root, 'grant'); const outside = path.join(root, 'outside');
  fs.mkdirSync(grant); fs.mkdirSync(outside);
  const image = path.join(grant, 'synthetic.png'); writePng(image);
  writePng(path.join(outside, 'outside.png'));
  try { return await fn({ root, grant, outside, image }); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
test('Quality missing grant rejects before image header read', async () => withFixture(async ({ image }) => {
  const wrapper = require(entry('AIGentQuality')); let opens = 0; const original = fs.openSync;
  fs.openSync = function(file, ...rest) { if (file === image) opens++; return original.call(this, file, ...rest); };
  try { assertError(await wrapper.handleRequest({ action: 'InspectImage', image_path: image }, {}), 'PATH_GRANT_REQUIRED'); assert.equal(opens, 0); }
  finally { fs.openSync = original; }
}));
test('Style missing grant rejects before dataset enumeration', async () => withFixture(async ({ grant }) => {
  const wrapper = require(entry('AIGentStyle')); let reads = 0; const original = fs.readdirSync;
  fs.readdirSync = function(file, ...rest) { if (file === grant) reads++; return original.call(this, file, ...rest); };
  try { assertError(await wrapper.handleRequest({ action: 'PrepareDataset', dataset_path: grant }, {}), 'PATH_GRANT_REQUIRED'); assert.equal(reads, 0); }
  finally { fs.readdirSync = original; }
}));
test('Style missing explicit path cannot enumerate configured fallback outside grant', async () => withFixture(async ({ root, grant }) => {
  const result = await runMain('AIGentStyle', [Buffer.from(JSON.stringify({ action: 'PrepareDataset', dataset_name: 'outside' }))], {
    env: { AIGENT_STYLE_DATASET_ROOT: root, AIGENT_STYLE_ALLOWED_DATASET_ROOT: grant }
  });
  assertError(result.response, 'REQUEST_REJECTED');
}));
test('Quality grant root must be a directory', async () => withFixture(async ({ image }) => {
  assertError((await runMain('AIGentQuality', [Buffer.from(JSON.stringify({ action: 'InspectImage', image_path: image }))], {
    env: { AIGENT_QUALITY_ALLOWED_IMAGE_ROOT: image }
  })).response, 'PATH_OUTSIDE_GRANT');
}));
test('Quality rejects an image symlink outside grant', async () => withFixture(async ({ grant, outside }) => {
  const link = path.join(grant, 'escape.png'); fs.symlinkSync(path.join(outside, 'outside.png'), link);
  assertError((await runMain('AIGentQuality', [Buffer.from(JSON.stringify({ action: 'InspectImage', image_path: link }))], {
    env: { AIGENT_QUALITY_ALLOWED_IMAGE_ROOT: grant }
  })).response, 'PATH_OUTSIDE_GRANT');
}));
test('Style rejects a dataset symlink outside grant', async () => withFixture(async ({ grant, outside }) => {
  const link = path.join(grant, 'escape'); fs.symlinkSync(outside, link);
  assertError((await runMain('AIGentStyle', [Buffer.from(JSON.stringify({ action: 'PrepareDataset', dataset_path: link }))], {
    env: { AIGENT_STYLE_ALLOWED_DATASET_ROOT: grant }
  })).response, 'PATH_OUTSIDE_GRANT');
}));
test('Quality actual main still inspects a granted synthetic image', async () => withFixture(async ({ grant, image }) => {
  const response = (await runMain('AIGentQuality', [Buffer.from(JSON.stringify({ action: 'InspectImage', image_path: image }))], {
    env: { AIGENT_QUALITY_ALLOWED_IMAGE_ROOT: grant }
  })).response;
  assert.equal(response.status, 'success'); assert.equal(response.result.filename, 'synthetic.png'); assert.equal(response.result.dry_run, true);
}));
test('Style actual main still plans a granted synthetic dataset', async () => withFixture(async ({ grant }) => {
  const response = (await runMain('AIGentStyle', [Buffer.from(JSON.stringify({ action: 'PrepareDataset', dataset_path: grant }))], {
    env: { AIGENT_STYLE_ALLOWED_DATASET_ROOT: grant }
  })).response;
  assert.equal(response.status, 'success'); assert.equal(response.result.image_count, 1);
}));


test('Quality validates the same trimmed path that the core reads', async () => withFixture(async ({ grant, outside }) => {
  const trimmed = path.join(grant, 'trim.png');
  const untrimmed = trimmed + ' ';
  writePng(untrimmed);
  fs.symlinkSync(path.join(outside, 'outside.png'), trimmed);
  assertError((await runMain('AIGentQuality', [Buffer.from(JSON.stringify({ action: 'InspectImage', image_path: untrimmed }))], {
    env: { AIGENT_QUALITY_ALLOWED_IMAGE_ROOT: grant }
  })).response, 'PATH_OUTSIDE_GRANT');
}));
test('Quality actual main preserves the valid path alias', async () => withFixture(async ({ grant, image }) => {
  const response = (await runMain('AIGentQuality', [Buffer.from(JSON.stringify({ action: 'InspectImage', path: image }))], {
    env: { AIGENT_QUALITY_ALLOWED_IMAGE_ROOT: grant }
  })).response;
  assert.equal(response.status, 'success'); assert.equal(response.result.filename, 'synthetic.png');
}));
