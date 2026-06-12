#!/usr/bin/env node
'use strict';

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptPath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(scriptPath), '..');

function packagePath(...segments) {
  const target = path.resolve(packageRoot, ...segments);
  const relative = path.relative(packageRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`path escapes external package root: ${segments.join('/')}`);
  }
  return target;
}

async function readPackageText(relativePath) {
  return fs.readFile(packagePath(...relativePath.split('/')), 'utf8');
}

async function pathExists(relativePath) {
  try {
    await fs.access(packagePath(...relativePath.split('/')));
    return true;
  } catch {
    return false;
  }
}

function missingMarkers(text, markers) {
  return markers.filter((marker) => !text.includes(marker));
}

function forbiddenMarkers(text, markers) {
  return markers.filter((marker) => text.includes(marker));
}

const checks = [];

function addCheck(label, ok, detail = '') {
  checks.push({ label, ok, detail });
}

const docPath = 'docs/STATIC_NO_PROVIDER_EXTRACTION_PREP.md';
const manifestPath = 'Plugin/JennAIGentOrchestrator/plugin-manifest.json';
const sourcePath = 'Plugin/JennAIGentOrchestrator/AIGentOrchestrator.js';

const docExists = await pathExists(docPath);
const manifestExists = await pathExists(manifestPath);
const sourceExists = await pathExists(sourcePath);

addCheck('external static prep doc exists', docExists);
addCheck('JennAIGentOrchestrator manifest exists', manifestExists);
addCheck('JennAIGentOrchestrator source exists', sourceExists);

const docText = docExists ? await readPackageText(docPath) : '';
const manifestText = manifestExists ? await readPackageText(manifestPath) : '';
const sourceText = sourceExists ? await readPackageText(sourcePath) : '';
const combinedTargetText = `${manifestText}\n${sourceText}`;

const identityMarkers = ['JennAIGentOrchestrator'];
const commandMarkers = ['PlanImagePipeline', 'PlanRetryPipeline', 'HealthCheck'];
const docMarkers = [
  'Jenn external package static no-provider extraction prep',
  'JennAIGentOrchestrator',
  'PlanImagePipeline',
  'PlanRetryPipeline',
  'HealthCheck',
  'planner-only',
  'not provider-backed',
  'not downstream-backed',
  'no provider calls',
  'no downstream plugin calls',
  'no LocalState writes',
  'no persistent env/config writes',
  'no generated outputs/logs/cache/secrets',
  'static validation only',
  'no runtime cutover',
  'aiImageJennTrialFixtures is a future static data move candidate',
  'aiImageNativeDelegateBindings is a future static data move candidate',
];

const missingIdentityMarkers = missingMarkers(combinedTargetText, identityMarkers);
addCheck(
  'JennAIGentOrchestrator identity marker is present',
  missingIdentityMarkers.length === 0,
  missingIdentityMarkers.join(', ')
);

const missingCommandMarkers = missingMarkers(combinedTargetText, commandMarkers);
addCheck(
  'JennAIGentOrchestrator command markers are present',
  missingCommandMarkers.length === 0,
  missingCommandMarkers.join(', ')
);

const forbiddenRuntimeMarkers = forbiddenMarkers(sourceText, [
  'processToolCall',
]);
addCheck(
  'JennAIGentOrchestrator source has no processToolCall marker',
  forbiddenRuntimeMarkers.length === 0,
  forbiddenRuntimeMarkers.join(', ')
);

const forbiddenProviderMarkers = forbiddenMarkers(sourceText, [
  'fetch(',
  'axios',
  'http.request',
  'https.request',
]);
addCheck(
  'JennAIGentOrchestrator source has no provider/network markers',
  forbiddenProviderMarkers.length === 0,
  forbiddenProviderMarkers.join(', ')
);

const forbiddenWriteOrSpawnMarkers = forbiddenMarkers(sourceText, [
  'writeFile',
  'appendFile',
  'createWriteStream',
  'spawn(',
  'exec(',
]);
addCheck(
  'JennAIGentOrchestrator source has no write/spawn markers',
  forbiddenWriteOrSpawnMarkers.length === 0,
  forbiddenWriteOrSpawnMarkers.join(', ')
);

const missingDocMarkers = missingMarkers(docText, docMarkers);
addCheck(
  'external static prep doc contains no-provider boundary markers',
  missingDocMarkers.length === 0,
  missingDocMarkers.join(', ')
);

const failed = checks.filter((check) => !check.ok);

if (failed.length > 0) {
  console.error('[jenn-static-no-provider] failed');
  for (const check of failed) {
    console.error(`- ${check.label}${check.detail ? `: ${check.detail}` : ''}`);
  }
  process.exit(1);
}

console.log(`[jenn-static-no-provider] ok: ${checks.length} static checks passed`);
