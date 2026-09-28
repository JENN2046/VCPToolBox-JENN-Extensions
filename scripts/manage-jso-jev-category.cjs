#!/usr/bin/env node
'use strict';

const fs = require('node:fs');

const MARKER_START = '<!-- JSO_JEV_CAPABILITY_R1_BEGIN -->';
const MARKER_END = '<!-- JSO_JEV_CAPABILITY_R1_END -->';

function atomicWrite(filePath, body) {
  const stat = fs.statSync(filePath);
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, body, { mode: stat.mode & 0o777 });
  fs.renameSync(tempPath, filePath);
}

function loadFragment(fragmentPath) {
  const fragment = JSON.parse(fs.readFileSync(fragmentPath, 'utf8'));
  if (!fragment
      || fragment.schemaVersion !== 1
      || fragment.categoryKey !== 'shooting_operations'
      || fragment.category?.defaultTool !== 'jenn_shooting_operations'
      || fragment.category?.tools?.jenn_shooting_operations?.plugin !== 'JennShootingOperations'
      || fragment.category.tools.jenn_shooting_operations.argumentMode !== 'semantic_passthrough') {
    throw new Error('INVALID_JEV_CATEGORY_FRAGMENT');
  }
  return fragment;
}

function applyCategory(targetPath, fragmentPath) {
  const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  const fragment = loadFragment(fragmentPath);
  if (!target?.categories || typeof target.categories !== 'object') {
    throw new Error('INVALID_JEV_TARGET');
  }

  const existing = target.categories[fragment.categoryKey];
  if (existing && JSON.stringify(existing) !== JSON.stringify(fragment.category)) {
    throw new Error('JEV_CATEGORY_CONFLICT');
  }

  target.categories[fragment.categoryKey] = fragment.category;
  atomicWrite(targetPath, JSON.stringify(target, null, 2) + '\n');
}

function removeCategory(targetPath, fragmentPath) {
  const target = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
  const fragment = loadFragment(fragmentPath);
  const existing = target?.categories?.[fragment.categoryKey];

  if (!existing) return;
  if (JSON.stringify(existing) !== JSON.stringify(fragment.category)) {
    throw new Error('JEV_CATEGORY_DRIFT');
  }

  delete target.categories[fragment.categoryKey];
  atomicWrite(targetPath, JSON.stringify(target, null, 2) + '\n');
}

function ownedPromptBlock(fragmentBody) {
  const body = fragmentBody.trim();
  if (!body.startsWith(MARKER_START) || !body.endsWith(MARKER_END)) {
    throw new Error('INVALID_JEV_PROMPT_FRAGMENT');
  }
  return body;
}

function applyPrompt(targetPath, fragmentPath) {
  const source = fs.readFileSync(targetPath, 'utf8');
  const owned = ownedPromptBlock(fs.readFileSync(fragmentPath, 'utf8'));
  const start = source.indexOf(MARKER_START);
  const end = source.indexOf(MARKER_END);

  let next;
  if (start >= 0 || end >= 0) {
    if (start < 0 || end < start) throw new Error('JEV_PROMPT_MARKER_CONFLICT');
    next = source.slice(0, start)
      + owned
      + source.slice(end + MARKER_END.length);
  } else {
    next = source.replace(/\s*$/u, '\n\n') + owned + '\n';
  }
  atomicWrite(targetPath, next);
}

function removePrompt(targetPath) {
  const source = fs.readFileSync(targetPath, 'utf8');
  const start = source.indexOf(MARKER_START);
  const end = source.indexOf(MARKER_END);

  if (start < 0 && end < 0) return;
  if (start < 0 || end < start) throw new Error('JEV_PROMPT_MARKER_CONFLICT');

  const next = (
    source.slice(0, start)
    + source.slice(end + MARKER_END.length)
  ).replace(/\n{3,}/gu, '\n\n');
  atomicWrite(targetPath, next);
}

function main(argv = process.argv.slice(2)) {
  const [mode, configPath, promptPath, categoryFragment, promptFragment] = argv;
  if (!['apply', 'remove'].includes(mode)
      || !configPath
      || !promptPath
      || !categoryFragment) {
    throw new Error(
      'usage: manage-jso-jev-category.cjs apply|remove <jev-config> <jev-prompt> <category-fragment> [prompt-fragment]'
    );
  }

  if (mode === 'apply') {
    if (!promptFragment) throw new Error('PROMPT_FRAGMENT_REQUIRED');
    applyCategory(configPath, categoryFragment);
    applyPrompt(promptPath, promptFragment);
  } else {
    removeCategory(configPath, categoryFragment);
    removePrompt(promptPath);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(String(error?.message || error) + '\n');
    process.exitCode = 1;
  }
}

module.exports = {
  MARKER_END,
  MARKER_START,
  applyCategory,
  applyPrompt,
  loadFragment,
  main,
  removeCategory,
  removePrompt
};
