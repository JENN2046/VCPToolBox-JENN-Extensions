'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');
const entrypointPath = path.join(repoRoot, 'Plugin', 'AIGentPrompt', 'stdio-entrypoint.cjs');

function freshEntrypoint() {
  delete require.cache[require.resolve(entrypointPath)];
  return require(entrypointPath);
}

function assertNoAbsolutePath(value) {
  if (typeof value === 'string') {
    assert(!/[A-Za-z]:[\\/]|\\\\|\/Users\//.test(value), `absolute path leaked: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertNoAbsolutePath);
    return;
  }
  if (value && typeof value === 'object') {
    Object.values(value).forEach(assertNoAbsolutePath);
  }
}

test('import has no stdout side effect', () => {
  const writes = [];
  const originalStdout = process.stdout.write;
  process.stdout.write = function capture(chunk, encoding, callback) {
    writes.push(String(chunk));
    if (typeof callback === 'function') callback();
    return true;
  };
  try {
    freshEntrypoint();
  } finally {
    process.stdout.write = originalStdout;
  }
  assert.deepEqual(writes, []);
});

test('HealthCheck success', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({ action: 'HealthCheck' }, { AIGENT_RAG_ENABLED: 'false' });
  assert.equal(response.status, 'success');
  assert.equal(response.result.package_name, 'AIGentPrompt');
  assert.equal(response.result.compatibility_mode, 'no-rag');
  assert.equal(response.result.rag_enabled, false);
  assert.equal(response.result.external_effects_enabled, false);
  assert(response.result.supported_actions.includes('GenerateImagePrompt'));
  assert.equal(response.result.source_business_module_preserved, true);
});

test('GenerateImagePrompt no-RAG success', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({
    action: 'GenerateImagePrompt',
    user_input: 'neutral synthetic studio portrait with soft light',
    model_type: 'flux',
    quality: 'ultra'
  }, { AIGENT_RAG_ENABLED: 'false' });
  assert.equal(response.status, 'success');
  assert(response.result.prompt.length > 0);
  assert(response.result.negative_prompt.length > 0);
  assert.equal(response.result.model_type, 'flux');
  assert.equal(response.result.compatibility_mode, 'no-rag');
  assert.equal(response.result.rag_enabled, false);
  assert.equal(response.result.external_effects, false);
  assert.equal(response.result.quality_parameter_parity, 'KNOWN_GAP');
});

test('similar_prompts empty', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({
    action: 'GenerateImagePrompt',
    user_input: 'neutral synthetic studio portrait with soft light',
    model_type: 'flux',
    quality: 'base'
  }, {});
  assert.deepEqual(response.result.similar_prompts, []);
  assert.deepEqual(response.result.legacy_business_result.similar_prompts, []);
});

test('model allowlist', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({
    action: 'GenerateImagePrompt',
    user_input: 'portrait',
    model_type: 'unknown',
    quality: 'base'
  }, {});
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'REQUEST_REJECTED');
});

test('quality validation', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({
    action: 'GenerateImagePrompt',
    user_input: 'portrait',
    model_type: 'flux',
    quality: 'maximum'
  }, {});
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'REQUEST_REJECTED');
});

test('empty input rejection', async () => {
  const entrypoint = freshEntrypoint();
  const parsed = entrypoint.parseRequestText('');
  assert.equal(parsed.ok, false);
  assert.equal(parsed.response.error.code, 'EMPTY_INPUT');
});

test('unknown action rejection', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({ action: 'RunEverything' }, {});
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'UNKNOWN_ACTION');
});

test('mismatched action/tool_name rejection', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({ action: 'HealthCheck', tool_name: 'GenerateImagePrompt' }, {});
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'ACTION_MISMATCH');
});

test('SearchPromptTemplates returns RAG_DISABLED', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({
    action: 'SearchPromptTemplates',
    query: 'neutral synthetic portrait template',
    category: 'portrait',
    limit: 3
  }, {});
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'RAG_DISABLED');
});

test('truthy AIGENT_RAG_ENABLED returns RAG_GATE_REQUIRED', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({ action: 'HealthCheck' }, { AIGENT_RAG_ENABLED: 'true' });
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'RAG_GATE_REQUIRED');
});

test('prototype-pollution key rejection', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest(JSON.parse('{"action":"HealthCheck","__proto__":{"polluted":true}}'), {});
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'REQUEST_REJECTED');
});

test('secret-shaped field rejection', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({
    action: 'GenerateImagePrompt',
    user_input: 'portrait',
    model_type: 'flux',
    quality: 'base',
    API_KEY: ['sk', 'exampleexampleexampleexample'].join('-')
  }, {});
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'REQUEST_REJECTED');
});

test('stdout response exactly one JSON line', async () => {
  const entrypoint = freshEntrypoint();
  const line = await entrypoint.runStdinText(JSON.stringify({ action: 'HealthCheck' }), {});
  assert.equal((line.match(/\n/g) || []).length, 1);
  assert.equal(line.endsWith('\n'), true);
  const parsed = JSON.parse(line);
  assert.equal(parsed.status, 'success');
});

test('no filesystem write API', () => {
  const source = fs.readFileSync(entrypointPath, 'utf8');
  assert(!/\bwriteFile(?:Sync)?\b|\bappendFile(?:Sync)?\b|\bcreateWriteStream\b|\brmSync\b|\bunlinkSync\b/.test(source));
});

test('no network API', () => {
  const source = fs.readFileSync(entrypointPath, 'utf8');
  assert(!/\bfetch\b|\bXMLHttpRequest\b|\bWebSocket\b|\bhttp\.|\bhttps\.|\bnet\.|\btls\.|\bdgram\./.test(source));
});

test('no child-process API', () => {
  const source = fs.readFileSync(entrypointPath, 'utf8');
  assert(!/child_process|\bspawn\b|\bexec\b|\bfork\b/.test(source));
});

test('no absolute local path in result', async () => {
  const entrypoint = freshEntrypoint();
  const response = await entrypoint.handleRequest({
    action: 'GenerateImagePrompt',
    user_input: 'neutral synthetic studio portrait with soft light',
    model_type: 'flux',
    quality: 'ultra'
  }, {});
  assertNoAbsolutePath(response);
});


// Exercise the original executable entrypoint with synthetic pipe input.
const { spawn } = require('node:child_process');
function runMainWithChunks(chunks, { pauseBeforeEOF = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--permission', `--allow-fs-read=${repoRoot}`, '--no-addons', entrypointPath
    ], { env: { PATH: '/usr/bin', LANG: 'C.UTF-8', TZ: 'UTC' }, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout = [];
    let totalOutput = 0;
    let outputBeforeEOF = false;
    let inputEnded = false;
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('synthetic main deadline exceeded'));
    }, 3000);
    child.on('error', reject);
    child.stdout.on('data', chunk => {
      totalOutput += chunk.length;
      if (totalOutput > 65536) {
        child.kill('SIGKILL');
        reject(new Error('synthetic main output exceeded limit'));
      }
      if (!inputEnded) outputBeforeEOF = true;
      stdout.push(chunk);
    });
    child.stderr.on('data', () => {});
    // An early rejection may close the pipe before a later synthetic write.
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.on('close', (code, signal) => {
      clearTimeout(deadline);
      try {
        assert.equal(code, 0);
        assert.equal(signal, null);
        const output = Buffer.concat(stdout).toString('utf8');
        assert.equal((output.match(/\n/g) || []).length, 1);
        assert.equal(output.endsWith('\n'), true);
        resolve({ response: JSON.parse(output), outputBeforeEOF });
      } catch (error) { reject(error); }
    });
    (async () => {
      for (let index = 0; index < chunks.length; index += 1) {
        if (child.stdin.destroyed) break;
        child.stdin.write(chunks[index]);
        if (index < chunks.length - 1) await new Promise(r => setTimeout(r, 40));
      }
      if (pauseBeforeEOF) await new Promise(r => setTimeout(r, 60));
      inputEnded = true;
      child.stdin.end();
    })().catch(reject);
  });
}
const INPUT_LIMIT = 16 * 1024;
const HEALTH_REQUEST = Buffer.from(JSON.stringify({ action: 'HealthCheck' }));
function paddedRequest(bytes, request = HEALTH_REQUEST) {
  assert(request.length <= bytes);
  return Buffer.concat([request, Buffer.alloc(bytes - request.length, 0x20)]);
}
function assertOversized(result) {
  assert.equal(result.response.status, 'error');
  assert.equal(result.response.error.code, 'INPUT_TOO_LARGE');
  assert.equal(result.response.result, undefined);
}

test('main accepts exactly the byte limit at EOF', async () => {
  const { response } = await runMainWithChunks([paddedRequest(INPUT_LIMIT)]);
  assert.equal(response.status, 'success');
  assert.equal(response.result.compatibility_mode, 'no-rag');
});

test('main rejects one chunk one byte beyond the limit', async () => {
  assertOversized(await runMainWithChunks([paddedRequest(INPUT_LIMIT + 1)]));
});

test('main rejects valid prefix followed by overflowing chunk', async () => {
  assertOversized(await runMainWithChunks([
    HEALTH_REQUEST, Buffer.alloc(INPUT_LIMIT + 1 - HEALTH_REQUEST.length, 0x20)
  ]));
});

test('main does not accept a full-size valid prefix after one extra byte', async () => {
  assertOversized(await runMainWithChunks([paddedRequest(INPUT_LIMIT), Buffer.from(' ')]));
});

test('main counts UTF-8 bytes rather than string characters', async () => {
  const request = Buffer.from(JSON.stringify({ action: 'HealthCheck', note: '中'.repeat(5500) }));
  assert(request.toString('utf8').length < INPUT_LIMIT);
  assert(request.length > INPUT_LIMIT);
  assertOversized(await runMainWithChunks([request]));
});

test('main rejoins split UTF-8 sequence and accepts exact byte limit', async () => {
  const request = Buffer.from(JSON.stringify({ action: 'HealthCheck', note: '😀'.repeat(3000) }));
  const bytes = paddedRequest(INPUT_LIMIT, request);
  const split = request.indexOf(Buffer.from('😀')) + 2;
  assert(split > 1);
  const { response } = await runMainWithChunks([bytes.subarray(0, split), bytes.subarray(split)]);
  assert.equal(response.status, 'success');
});

test('main waits for EOF before accepting a valid prefix', async () => {
  const result = await runMainWithChunks([HEALTH_REQUEST], { pauseBeforeEOF: true });
  assert.equal(result.outputBeforeEOF, false);
  assert.equal(result.response.status, 'success');
});

test('main rejects incomplete JSON at EOF', async () => {
  const { response } = await runMainWithChunks([Buffer.from('{"action":"HealthCheck"')]);
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'MALFORMED_JSON');
});

test('main rejects trailing non-JSON content instead of a valid prefix', async () => {
  const { response } = await runMainWithChunks([HEALTH_REQUEST, Buffer.from('x')]);
  assert.equal(response.status, 'error');
  assert.equal(response.error.code, 'MALFORMED_JSON');
});
