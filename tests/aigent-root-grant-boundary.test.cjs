'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const quality = require('../Plugin/AIGentQuality/stdio-entrypoint.cjs');
const style = require('../Plugin/AIGentStyle/stdio-entrypoint.cjs');

function png(file) {
  const b = Buffer.alloc(24); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.write('IHDR', 12, 'ascii'); b.writeUInt32BE(1, 16); b.writeUInt32BE(1, 20); fs.writeFileSync(file, b);
}
async function fixture(run) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'aigent-root-grant-'));
  const grant = path.join(base, 'grant'), child = path.join(grant, 'child'), sibling = path.join(base, 'grant-sibling');
  fs.mkdirSync(child, { recursive: true }); fs.mkdirSync(sibling);
  const image = path.join(child, 'inside.png'), outside = path.join(sibling, 'outside.png'); png(image); png(outside);
  try { return await run({ base, grant, child, sibling, image, outside }); }
  finally { fs.rmSync(base, { recursive: true, force: true }); }
}
const cases = [
  { name: 'Quality', wrapper: quality, action: 'InspectImage', field: 'image_path', env: 'AIGENT_QUALITY_ALLOWED_IMAGE_ROOT', resultField: 'image_path' },
  { name: 'Style', wrapper: style, action: 'PrepareDataset', field: 'dataset_path', env: 'AIGENT_STYLE_ALLOWED_DATASET_ROOT', resultField: 'dataset_path' }
];
async function inspect(spec, target, grant) {
  return spec.wrapper.handleRequest({ action: spec.action, [spec.field]: target }, { [spec.env]: grant });
}
function denied(response) {
  assert.equal(response.status, 'error'); assert.equal(response.error.code, 'PATH_OUTSIDE_GRANT'); assert.equal(response.result, undefined);
}
for (const spec of cases) {
  test(`${spec.name}: POSIX filesystem root grants a real synthetic target`, async () => fixture(async ({ image, child }) => {
    assert.equal(path.sep, '/');
    const target = spec.name === 'Quality' ? image : child;
    const result = await inspect(spec, target, '/');
    assert.equal(result.status, 'success'); assert.equal(result.result[spec.resultField], target);
  }));
  test(`${spec.name}: nonroot grant retains a real descendant`, async () => fixture(async ({ grant, image, child }) => {
    const target = spec.name === 'Quality' ? image : child;
    const result = await inspect(spec, target, grant);
    assert.equal(result.status, 'success'); assert.equal(result.result[spec.resultField], target);
  }));
  test(`${spec.name}: exact canonical root equality is retained`, async () => fixture(async ({ child }) => {
    const result = await inspect(spec, child, child);
    assert.equal(result.status, 'success'); assert.equal(result.result[spec.resultField], child);
  }));
  test(`${spec.name}: nonroot sibling prefix remains denied`, async () => fixture(async ({ grant, outside, sibling }) => {
    denied(await inspect(spec, spec.name === 'Quality' ? outside : sibling, grant));
  }));
  test(`${spec.name}: nonroot symlink escape remains denied`, async () => fixture(async ({ grant, outside, sibling }) => {
    const alias = path.join(grant, 'escape'); fs.symlinkSync(spec.name === 'Quality' ? outside : sibling, alias);
    denied(await inspect(spec, alias, grant));
  }));
  test(`${spec.name}: POSIX root still hands off the canonical alias target`, async () => fixture(async ({ grant, image, child }) => {
    const target = spec.name === 'Quality' ? image : child, alias = path.join(grant, 'inside-alias');
    fs.symlinkSync(target, alias);
    const result = await inspect(spec, alias, '/');
    assert.equal(result.status, 'success'); assert.equal(result.result[spec.resultField], target);
    assert.notEqual(result.result[spec.resultField], alias);
  }));
}

// Exercise the actual unchanged function text with explicit synthetic fs and
// path.win32 dependencies. This does not execute on Windows or read drive data.
function win32RealInside(name) {
  const source = fs.readFileSync(path.resolve(__dirname, `../Plugin/AIGent${name}/stdio-entrypoint.cjs`), 'utf8');
  const match = source.match(/^function realInside\(root, child\) \{[\s\S]*?^\}/m);
  assert(match, 'actual containment function must be present');
  const calls = [];
  const syntheticFs = {
    realpathSync(value) { calls.push(['realpath', value]); return path.win32.normalize(value); },
    statSync(value) { calls.push(['stat', value]); return { isDirectory() { return true; } }; }
  };
  const realInside = vm.runInNewContext(`(${match[0]})`, { fs: syntheticFs, path: path.win32 }, { timeout: 1000 });
  return { realInside, calls };
}
const windowsCases = [
  ['drive root child', 'C:\\', 'C:\\images\\inside.png', 'C:\\images\\inside.png'],
  ['drive root equality', 'C:\\', 'C:\\', 'C:\\'],
  ['nonroot child', 'C:\\grant', 'C:\\grant\\inside.png', 'C:\\grant\\inside.png'],
  ['nonroot equality', 'C:\\grant', 'C:\\grant', 'C:\\grant'],
  ['sibling prefix denial', 'C:\\grant', 'C:\\grant-sibling\\outside.png', null],
  ['other drive denial', 'C:\\', 'D:\\outside.png', null],
  ['UNC share root child', '\\\\server\\share\\', '\\\\server\\share\\inside.png', '\\\\server\\share\\inside.png'],
  ['other UNC share denial', '\\\\server\\share\\', '\\\\server\\other\\outside.png', null]
];
for (const spec of cases) {
  for (const [label, root, child, expected] of windowsCases) {
    test(`${spec.name}: synthetic win32 ${label}`, () => {
      const { realInside, calls } = win32RealInside(spec.name);
      assert.equal(realInside(root, child), expected);
      assert.deepEqual(calls, [
        ['realpath', path.win32.resolve(root)], ['stat', path.win32.normalize(path.win32.resolve(root))],
        ['realpath', path.win32.resolve(child)]
      ]);
    });
  }
}
