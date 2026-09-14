const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const DEFAULT_PACKAGE_FILES = path.join('manifests', 'PACKAGE_FILES.json');
const DEFAULT_MANIFEST = path.join('manifests', 'MANIFEST.sha256');
const DEFAULT_ATTESTATION = path.join('manifests', 'PAYLOAD_ATTESTATION.json');

function parseArgs(argv) {
  const args = {
    packageFiles: DEFAULT_PACKAGE_FILES,
    manifest: DEFAULT_MANIFEST,
    attestation: DEFAULT_ATTESTATION,
    registry: null,
    verifierPath: 'scripts/verify-deterministic-manifest.cjs'
  };
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (typeof value !== 'string' || value.length === 0 || value.startsWith('--')) {
      throw new Error(`Missing value for ${key}`);
    }
    if (key === '--package-files') args.packageFiles = value;
    else if (key === '--manifest') args.manifest = value;
    else if (key === '--attestation') args.attestation = value;
    else if (key === '--registry') args.registry = value;
    else if (key === '--verifier-path') args.verifierPath = value;
    else throw new Error(`Unknown argument: ${key}`);
    i += 1;
  }
  return args;
}

function runGit(args, options = {}) {
  const result = cp.spawnSync('git', args, {
    env: { ...process.env, GIT_NO_REPLACE_OBJECTS: '1' },
    encoding: options.encoding === null ? null : 'utf8',
    maxBuffer: 128 * 1024 * 1024
  });
  if (result.status !== 0) {
    const stderr = options.encoding === null ? result.stderr.toString('utf8') : result.stderr;
    const stdout = options.encoding === null ? result.stdout.toString('utf8') : result.stdout;
    throw new Error(`git ${args.join(' ')} failed: ${stderr || stdout}`);
  }
  return result.stdout;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function assertPosixExactPath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0) throw new Error('Path must be a non-empty string');
  if (filePath.includes('\\')) throw new Error(`Backslash is forbidden: ${filePath}`);
  if (filePath.startsWith('/') || /^[A-Za-z]:/.test(filePath) || filePath.startsWith('//')) throw new Error(`Absolute path is forbidden: ${filePath}`);
  if (filePath.split('/').includes('..')) throw new Error(`Path escape is forbidden: ${filePath}`);
  if (/[*?{}]/.test(filePath)) throw new Error(`Glob-like path is forbidden: ${filePath}`);
  if (filePath === 'manifests/MANIFEST.sha256' || filePath === 'manifests/PAYLOAD_ATTESTATION.json') {
    throw new Error(`Self-referential payload path is forbidden: ${filePath}`);
  }
}

function isHardDenied(filePath) {
  const segments = filePath.split('/');
  const deniedSegments = new Set([
    '.git', '.agent_board', 'localstate', 'node_modules', 'cache', 'state',
    'logs', 'log', 'output', 'outputs', 'receipts', 'secrets', 'private', 'debuglog',
    'image', 'vectorstore', 'vcptimedcontacts', 'vcptimedresults'
  ]);
  if (segments.some((segment) => deniedSegments.has(segment.toLowerCase()))) return true;
  if (/(^|\/)\.env($|\.)/i.test(filePath)) return true;
  if (/(^|\/)config\.env(\.local)?$/i.test(filePath)) return true;
  if (/(^|\/)[^/]*\.env(?:\.[^/]*)?$/i.test(filePath) && !/\.(example|template)$/i.test(filePath)) return true;
  if (/\.(sqlite|sqlite3|db|db3|duckdb|faiss|parquet|log|pem|key|p12|pfx|jks|kdbx)$/i.test(filePath)) return true;
  if (/\.(sqlite|db)-(shm|wal)$/i.test(filePath)) return true;
  const operatorFiles = new Set([
    'modelredirect.json',
    'agent_map.json',
    'preprocessor_order.json',
    'tag-processor-config.env',
    'semanticmodelrouter.local.json',
    'sarprompt.json',
    'ip_blacklist.json',
    'plugin/userauth/code.bin'
  ]);
  return operatorFiles.has(filePath.toLowerCase());
}

function comparePosixBytewise(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function isRelativeExactPath(filePath) {
  return typeof filePath === 'string'
    && filePath.length > 0
    && !filePath.includes('\\')
    && !filePath.startsWith('/')
    && !filePath.startsWith('//')
    && !/^[A-Za-z]:/.test(filePath)
    && !filePath.split('/').includes('..')
    && !/[*?{}]/.test(filePath);
}

function validatePackageSchema(packageFiles, failures) {
  if (!isPlainObject(packageFiles)) {
    failures.push('PACKAGE_FILES must be an object');
    return [];
  }
  if (packageFiles.schemaVersion !== 1) failures.push('PACKAGE_FILES schemaVersion must be 1');
  if (typeof packageFiles.payloadSourceCommit !== 'string' || !/^[a-f0-9]{40}$/.test(packageFiles.payloadSourceCommit || '')) failures.push('Invalid payloadSourceCommit');
  if (!Array.isArray(packageFiles.packages)) {
    failures.push('PACKAGE_FILES packages must be an array');
    return [];
  }

  const packageKeys = ['packageId', 'creationIds', 'root', 'payloadClass', 'runtimeEligible', 'files', 'reviewExceptions', 'notes'];
  const reviewKeys = ['path', 'reason', 'riskClassification', 'evidenceReference', 'runtimeEligible'];
  const payloadClasses = new Set(['runtime_source', 'source_preservation', 'fixture', 'support_metadata']);
  const riskClasses = new Set([
    'reviewed_source_name_only',
    'provider_source_no_secret',
    'memory_source_no_private_data',
    'photo_studio_source_no_private_data',
    'auth_source_no_secret'
  ]);
  const packageIds = new Set();
  const roots = [];

  for (const [index, pkg] of packageFiles.packages.entries()) {
    const label = `packages[${index}]`;
    if (!isPlainObject(pkg)) {
      failures.push(`${label} must be an object`);
      continue;
    }
    for (const key of packageKeys) {
      if (!(key in pkg)) failures.push(`${label} missing ${key}`);
    }
    for (const key of Object.keys(pkg)) {
      if (!packageKeys.includes(key)) failures.push(`${label} has unsupported property ${key}`);
    }
    if (typeof pkg.packageId !== 'string' || !/^[a-z0-9._-]+$/.test(pkg.packageId || '')) failures.push(`${label}.packageId is invalid`);
    if (packageIds.has(pkg.packageId)) failures.push(`${label}.packageId is duplicated`);
    packageIds.add(pkg.packageId);
    if (!Array.isArray(pkg.creationIds)) failures.push(`${label}.creationIds must be an array`);
    if (!isRelativeExactPath(pkg.root || '') || pkg.root.replace(/\/+$/, '').split('/').some(segment => segment === '.' || segment === '')) failures.push(`${label}.root must be an exact relative POSIX path`);
    else roots.push({ packageId: pkg.packageId, root: pkg.root.replace(/\/+$/, '') });
    if (!payloadClasses.has(pkg.payloadClass)) failures.push(`${label}.payloadClass is invalid`);
    if (typeof pkg.runtimeEligible !== 'boolean') failures.push(`${label}.runtimeEligible must be boolean`);
    if (!Array.isArray(pkg.files) || pkg.files.length === 0) failures.push(`${label}.files must be a non-empty array`);
    if (!Array.isArray(pkg.reviewExceptions)) failures.push(`${label}.reviewExceptions must be an array`);
    for (const [reviewIndex, review] of (Array.isArray(pkg.reviewExceptions) ? pkg.reviewExceptions : []).entries()) {
      const reviewLabel = `${label}.reviewExceptions[${reviewIndex}]`;
      if (!isPlainObject(review)) {
        failures.push(`${reviewLabel} must be an object`);
        continue;
      }
      for (const key of reviewKeys) {
        if (!(key in review)) failures.push(`${reviewLabel} missing ${key}`);
      }
      for (const key of Object.keys(review)) {
        if (!reviewKeys.includes(key)) failures.push(`${reviewLabel} has unsupported property ${key}`);
      }
      if (!riskClasses.has(review.riskClassification)) failures.push(`${reviewLabel}.riskClassification is invalid`);
      if (typeof review.runtimeEligible !== 'boolean') failures.push(`${reviewLabel}.runtimeEligible must be boolean`);
    }
  }

  for (let i = 0; i < roots.length; i += 1) {
    for (let j = i + 1; j < roots.length; j += 1) {
      const a = roots[i].root;
      const b = roots[j].root;
      if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
        failures.push(`Ambiguous package roots: ${roots[i].packageId}=${a}, ${roots[j].packageId}=${b}`);
      }
    }
  }

  return packageFiles.packages.filter(isPlainObject);
}

function validatePackageFiles(packageFiles) {
  const failures = [];
  validatePackageSchema(packageFiles, failures);
  if (failures.length > 0) throw new Error(failures.join('; '));
  if (!isPlainObject(packageFiles)) throw new Error('PACKAGE_FILES must be an object');
  if (packageFiles.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  if (!/^[a-f0-9]{40}$/.test(packageFiles.payloadSourceCommit || '')) throw new Error('payloadSourceCommit must be a 40-char lowercase SHA');
  if (!Array.isArray(packageFiles.packages)) throw new Error('packages must be an array');

  const allPaths = new Set();
  const allCaseFoldedPaths = new Set();
  const roots = [];
  for (const pkg of packageFiles.packages) {
    if (!isPlainObject(pkg)) throw new Error('package entry must be an object');
    for (const key of ['packageId', 'creationIds', 'root', 'payloadClass', 'runtimeEligible', 'files', 'reviewExceptions', 'notes']) {
      if (!(key in pkg)) throw new Error(`${pkg.packageId || '<unknown>'} missing ${key}`);
    }
    assertPosixExactPath(pkg.root);
    roots.push({ packageId: pkg.packageId, root: pkg.root });
    if (!Array.isArray(pkg.creationIds)) throw new Error(`${pkg.packageId} creationIds must be an array`);
    if (!Array.isArray(pkg.files) || pkg.files.length === 0) throw new Error(`${pkg.packageId} files must be a non-empty array`);
    const packagePaths = new Set();
    for (const filePath of pkg.files) {
      assertPosixExactPath(filePath);
      if (isHardDenied(filePath)) throw new Error(`Hard-denied payload path: ${filePath}`);
      if (packagePaths.has(filePath)) throw new Error(`Duplicate path in package ${pkg.packageId}: ${filePath}`);
      packagePaths.add(filePath);
      if (allPaths.has(filePath)) throw new Error(`Duplicate payload path: ${filePath}`);
      allPaths.add(filePath);
      const folded = filePath.toLowerCase();
      if (allCaseFoldedPaths.has(folded)) throw new Error(`Windows case-fold collision: ${filePath}`);
      allCaseFoldedPaths.add(folded);
    }
  }
  for (let i = 0; i < roots.length; i += 1) {
    for (let j = i + 1; j < roots.length; j += 1) {
      const a = roots[i].root.replace(/\/+$/, '');
      const b = roots[j].root.replace(/\/+$/, '');
      if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
        throw new Error(`Ambiguous package roots: ${roots[i].packageId}=${a}, ${roots[j].packageId}=${b}`);
      }
    }
  }
}

function getTreeEntry(commit, filePath) {
  const output = runGit(['-c', 'core.quotepath=false', 'ls-tree', '-z', commit, '--', filePath]).toString('utf8');
  const exact = output.split('\0').filter(Boolean).find((line) => line.endsWith(`\t${filePath}`));
  if (!exact) throw new Error(`Allowlisted path is not present in commit ${commit}: ${filePath}`);
  const match = exact.match(/^(\d+)\s+(\S+)\s+([a-f0-9]+)\t(.+)$/);
  if (!match) throw new Error(`Unable to parse git tree entry for ${filePath}`);
  const [, mode, type, objectId] = match;
  if (type !== 'blob') throw new Error(`Payload path is not a blob: ${filePath}`);
  if (mode === '120000') throw new Error(`Symlink payload path is forbidden: ${filePath}`);
  if (mode === '160000') throw new Error(`Submodule payload path is forbidden: ${filePath}`);
  if (!mode.startsWith('100')) throw new Error(`Non-regular blob mode is forbidden for ${filePath}: ${mode}`);
  return { mode, type, objectId };
}

function hashCommittedBlob(commit, filePath) {
  const bytes = runGit(['show', `${commit}:${filePath}`], { encoding: null });
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function writeLf(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content.replace(/\r\n/g, '\n'));
}

function main() {
  const args = parseArgs(process.argv);
  const packageFilesText = fs.readFileSync(args.packageFiles, 'utf8');
  const packageFiles = JSON.parse(packageFilesText);
  validatePackageFiles(packageFiles);
  runGit(['cat-file', '-e', `${packageFiles.payloadSourceCommit}^{commit}`]);

  const paths = packageFiles.packages.flatMap((pkg) => pkg.files).sort(comparePosixBytewise);
  // Validate every selected tree entry before reading the first payload body.
  paths.forEach((filePath) => getTreeEntry(packageFiles.payloadSourceCommit, filePath));
  const lines = paths.map((filePath) => `${hashCommittedBlob(packageFiles.payloadSourceCommit, filePath)}  ${filePath}`);
  const manifestText = `${lines.join('\n')}\n`;

  const registryHash = args.registry ? crypto.createHash('sha256').update(fs.readFileSync(args.registry)).digest('hex') : '';
  const attestation = {
    schemaVersion: 1,
    payloadSourceCommit: packageFiles.payloadSourceCommit,
    packageFilesSha256: crypto.createHash('sha256').update(Buffer.from(packageFilesText.replace(/\r\n/g, '\n'))).digest('hex'),
    manifestSha256: crypto.createHash('sha256').update(Buffer.from(manifestText, 'utf8')).digest('hex'),
    manifestEntryCount: lines.length,
    creationRegistrySha256: registryHash,
    generatorPath: 'scripts/build-deterministic-manifest.cjs',
    verifierPath: args.verifierPath,
    defaultRuntimeAuthorization: false,
    pluginExecutionAuthorized: false,
    providerExecutionAuthorized: false,
    bridgeExecutionAuthorized: false,
    privateDataIncluded: false,
    databaseStateIncluded: false
  };
  writeLf(args.manifest, manifestText);
  writeLf(args.attestation, `${JSON.stringify(attestation, null, 2)}\n`);
  console.log(JSON.stringify({ manifestEntryCount: lines.length, manifestSha256: attestation.manifestSha256 }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
