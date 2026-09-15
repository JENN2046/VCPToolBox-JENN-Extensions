const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

function parseArgs(argv) {
  const args = {
    packageFiles: path.join('manifests', 'PACKAGE_FILES.json'),
    manifest: path.join('manifests', 'MANIFEST.sha256'),
    attestation: path.join('manifests', 'PAYLOAD_ATTESTATION.json'),
    registry: null
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
    else throw new Error(`Unknown argument: ${key}`);
    i += 1;
  }
  return args;
}

function git(args, options = {}) {
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

function isRelativeExactPath(filePath) {
  return typeof filePath === 'string'
    && filePath.length > 0
    && filePath !== 'manifests/MANIFEST.sha256'
    && filePath !== 'manifests/PAYLOAD_ATTESTATION.json'
    && !filePath.includes('\\')
    && !filePath.startsWith('/')
    && !filePath.startsWith('//')
    && !/^[A-Za-z]:/.test(filePath)
    && !filePath.split('/').includes('..')
    && !/[*?{}]/.test(filePath);
}

function hardDenied(filePath) {
  const segments = filePath.split('/').map((segment) => segment.toLowerCase());
  const deniedSegments = [
    '.git', '.agent_board', 'localstate', 'node_modules', '.cache', '.tmp', 'tmp', 'cache', 'state',
    'logs', 'log', 'output', 'outputs', 'receipts', 'secrets', 'private', 'debuglog',
    'image', 'vectorstore', 'vcptimedcontacts', 'vcptimedresults'
  ];
  if (segments.some((segment) => deniedSegments.includes(segment))) return true;
  if (/(^|\/)\.env($|\.)/i.test(filePath)) return true;
  if (/(^|\/)config\.env(\.local)?$/i.test(filePath)) return true;
  if (/(^|\/)[^/]*\.env(?:\.[^/]*)?$/i.test(filePath) && !/\.(example|template)$/i.test(filePath)) return true;
  if (/\.(sqlite|sqlite3|db|db3|duckdb|faiss|parquet|log|pem|key|p12|pfx|jks|kdbx|crt|cer|der|keystore|pgpass)$/i.test(filePath)) return true;
  if (/(^|\/)[^/]*_(rsa|dsa|ecdsa|ed25519)$/i.test(filePath)) return true;
  if (/\.(sqlite|db)-(shm|wal)$/i.test(filePath)) return true;
  return [
    'modelredirect.json',
    'agent_map.json',
    'preprocessor_order.json',
    'tag-processor-config.env',
    'semanticmodelrouter.local.json',
    'sarprompt.json',
    'ip_blacklist.json',
    'plugin/userauth/code.bin'
  ].includes(filePath.toLowerCase());
}

function byteComparePath(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8'));
}

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function decodeUtf8Exact(bytes, label) {
  if (!Buffer.isBuffer(bytes)) throw new Error(`${label} must be read as bytes`);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`${label} must be valid UTF-8`);
  return text;
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
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
      const a = roots[i].root.toLowerCase();
      const b = roots[j].root.toLowerCase();
      if (a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
        failures.push(`Ambiguous package roots: ${roots[i].packageId}=${a}, ${roots[j].packageId}=${b}`);
      }
    }
  }

  return packageFiles.packages.filter(isPlainObject);
}

function treeEntry(commit, filePath) {
  const output = git(['-c', 'core.quotepath=false', 'ls-tree', '-z', commit, '--', filePath]).toString('utf8');
  const line = output.split('\0').filter(Boolean).find((candidate) => candidate.endsWith(`\t${filePath}`));
  if (!line) return null;
  const match = line.match(/^(\d+)\s+(\S+)\s+([a-f0-9]+)\t(.+)$/);
  if (!match) throw new Error(`Cannot parse ls-tree output for ${filePath}`);
  return { mode: match[1], type: match[2], objectId: match[3], path: match[4] };
}

function blobSha256(commit, filePath) {
  const bytes = git(['show', `${commit}:${filePath}`], { encoding: null });
  return sha256Buffer(bytes);
}

function parseManifest(raw) {
  if (raw.includes('\r')) throw new Error('Manifest must use LF line endings only');
  if (!raw.endsWith('\n')) throw new Error('Manifest must end with one newline');
  // The builder emits exactly one LF for a zero-entry package set.
  if (raw === '\n') return [];
  const lines = raw.slice(0, -1).split('\n');
  return lines.map((line) => {
    const match = line.match(/^([a-f0-9]{64})  ([^\n]+)$/);
    if (!match) throw new Error(`Invalid manifest line format: ${line}`);
    return { sha256: match[1], path: match[2] };
  });
}

function main() {
  const args = parseArgs(process.argv);
  const packageBytes = fs.readFileSync(args.packageFiles);
  const packageText = decodeUtf8Exact(packageBytes, 'PACKAGE_FILES');
  const packageRaw = packageText.replace(/\r\n/g, '\n');
  const packageCanonicalBytes = Buffer.from(packageRaw, 'utf8');
  const packageFiles = JSON.parse(packageRaw);
  const manifestBytes = fs.readFileSync(args.manifest);
  const manifestRaw = decodeUtf8Exact(manifestBytes, 'MANIFEST');
  const manifestEntries = parseManifest(manifestRaw);
  const attestationBytes = fs.readFileSync(args.attestation);
  const attestationRaw = decodeUtf8Exact(attestationBytes, 'PAYLOAD_ATTESTATION').replace(/\r\n/g, '\n');
  const attestation = JSON.parse(attestationRaw);

  const counters = {
    manifest_missing_from_commit_count: 0,
    manifest_prohibited_path_count: 0,
    manifest_unallowlisted_path_count: 0,
    allowlisted_missing_from_manifest_count: 0,
    manifest_hash_mismatch_count: 0,
    casefold_collision_count: 0,
    symlink_payload_count: 0,
    path_escape_count: 0,
    database_payload_count: 0,
    private_payload_count: 0,
    duplicate_path_count: 0,
    formatting_error_count: 0,
    attestation_mismatch_count: 0
  };
  const failures = [];

  const packageList = validatePackageSchema(packageFiles, failures);
  const allowlisted = [];
  if (failures.length > 0) {
    finish();
    return;
  }
  const payloadSourceType = git(['cat-file', '-t', packageFiles.payloadSourceCommit]).trim();
  if (payloadSourceType !== 'commit') {
    failures.push('payloadSourceCommit must identify a commit object directly');
    finish();
    return;
  }
  const casefold = new Set();
  const seen = new Set();
  for (const pkg of packageList) {
    if (!Array.isArray(pkg.files) || pkg.files.length === 0) failures.push(`Package ${pkg.packageId} has no files`);
    for (const filePath of pkg.files || []) {
      if (!isRelativeExactPath(filePath)) {
        counters.path_escape_count += 1;
        failures.push(`Invalid path: ${filePath}`);
        continue;
      }
      if (hardDenied(filePath)) {
        counters.manifest_prohibited_path_count += 1;
        if (/\.(sqlite|sqlite3|db|db3|duckdb|faiss|parquet)$/i.test(filePath) || /\.(sqlite|db)-(shm|wal)$/i.test(filePath)) counters.database_payload_count += 1;
        failures.push(`Hard-denied allowlist path: ${filePath}`);
      }
      const folded = filePath.toLowerCase();
      if (casefold.has(folded)) counters.casefold_collision_count += 1;
      casefold.add(folded);
      if (seen.has(filePath)) counters.duplicate_path_count += 1;
      seen.add(filePath);
      const entry = treeEntry(packageFiles.payloadSourceCommit, filePath);
      if (!entry) {
        counters.manifest_missing_from_commit_count += 1;
        failures.push(`Allowlisted path missing from commit: ${filePath}`);
      } else {
        if (entry.type !== 'blob') failures.push(`Allowlisted path is not a blob: ${filePath}`);
        if (entry.mode === '120000') counters.symlink_payload_count += 1;
        if (!entry.mode.startsWith('100')) failures.push(`Allowlisted path is not a regular blob: ${filePath}`);
      }
      allowlisted.push(filePath);
    }
  }

  const manifestPathSet = new Set();
  const hashCandidates = [];
  for (const entry of manifestEntries) {
    if (!isRelativeExactPath(entry.path)) counters.path_escape_count += 1;
    if (hardDenied(entry.path)) {
      counters.manifest_prohibited_path_count += 1;
      if (/\.(sqlite|sqlite3|db|db3|duckdb|faiss|parquet)$/i.test(entry.path) || /\.(sqlite|db)-(shm|wal)$/i.test(entry.path)) counters.database_payload_count += 1;
    }
    const folded = entry.path.toLowerCase();
    if ([...manifestPathSet].some((p) => p.toLowerCase() === folded)) counters.casefold_collision_count += 1;
    if (manifestPathSet.has(entry.path)) counters.duplicate_path_count += 1;
    manifestPathSet.add(entry.path);
    if (!seen.has(entry.path)) counters.manifest_unallowlisted_path_count += 1;
    const tree = treeEntry(packageFiles.payloadSourceCommit, entry.path);
    if (!tree) {
      counters.manifest_missing_from_commit_count += 1;
    } else if (tree.type !== 'blob') {
      failures.push(`Manifest path is not a blob: ${entry.path}`);
    } else if (tree.mode === '120000') {
      counters.symlink_payload_count += 1;
    } else if (!tree.mode.startsWith('100')) {
      failures.push(`Manifest path is not a regular blob: ${entry.path}`);
    } else {
      hashCandidates.push(entry);
    }
  }
  for (const filePath of allowlisted) {
    if (!manifestPathSet.has(filePath)) counters.allowlisted_missing_from_manifest_count += 1;
  }
  const sortedPaths = manifestEntries.map((entry) => entry.path).slice().sort(byteComparePath);
  if (JSON.stringify(sortedPaths) !== JSON.stringify(manifestEntries.map((entry) => entry.path))) counters.formatting_error_count += 1;

  // Reject the complete metadata set before reading any payload blob or optional registry.
  if (failures.length > 0 || Object.values(counters).some((value) => value !== 0)) {
    finish();
    return;
  }

  if (!isPlainObject(attestation) || attestation.schemaVersion !== 1) {
    counters.attestation_mismatch_count += 1;
    finish();
    return;
  }

  const manifestSha256 = sha256Buffer(manifestBytes);
  const packageFilesSha256 = sha256Buffer(packageCanonicalBytes);
  if (attestation.payloadSourceCommit !== packageFiles.payloadSourceCommit) counters.attestation_mismatch_count += 1;
  if (attestation.packageFilesSha256 !== packageFilesSha256) counters.attestation_mismatch_count += 1;
  if (attestation.manifestSha256 !== manifestSha256) counters.attestation_mismatch_count += 1;
  if (attestation.manifestEntryCount !== manifestEntries.length) counters.attestation_mismatch_count += 1;
  for (const key of ['defaultRuntimeAuthorization', 'pluginExecutionAuthorized', 'providerExecutionAuthorized', 'bridgeExecutionAuthorized', 'privateDataIncluded', 'databaseStateIncluded']) {
    if (attestation[key] !== false) counters.attestation_mismatch_count += 1;
  }

  // All independent proof fields and the required registry binding must pass first.
  const registryBindingValid = args.registry
    ? typeof attestation.creationRegistrySha256 === 'string' && /^[a-f0-9]{64}$/.test(attestation.creationRegistrySha256)
    : attestation.creationRegistrySha256 === '';
  if (!registryBindingValid) counters.attestation_mismatch_count += 1;
  if (Object.values(counters).some((value) => value !== 0)) {
    finish();
    return;
  }
  const registrySha256 = args.registry ? sha256Buffer(fs.readFileSync(args.registry)) : '';
  if (attestation.creationRegistrySha256 !== registrySha256) counters.attestation_mismatch_count += 1;

  if (Object.values(counters).every((value) => value === 0)) {
    for (const entry of hashCandidates) {
      if (entry.sha256 !== blobSha256(packageFiles.payloadSourceCommit, entry.path)) {
        counters.manifest_hash_mismatch_count += 1;
      }
    }
  }
  finish();

  function finish() {
    const nonZeroCounters = Object.entries(counters).filter(([, value]) => value !== 0);
    const result = {
      ok: failures.length === 0 && nonZeroCounters.length === 0,
      payloadSourceCommit: packageFiles.payloadSourceCommit,
      manifestEntryCount: manifestEntries.length,
      allowlistedPathCount: allowlisted.length,
      counters,
      failures
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exit(1);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
