#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const { isDeepStrictEqual } = require('node:util');

const MARKER_START = '<!-- JSO_JEV_CAPABILITY_R1_BEGIN -->';
const MARKER_END = '<!-- JSO_JEV_CAPABILITY_R1_END -->';

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

function ownedPromptBlock(fragmentBody) {
  const body = fragmentBody.trim();
  if (!body.startsWith(MARKER_START) || !body.endsWith(MARKER_END)) {
    throw new Error('INVALID_JEV_PROMPT_FRAGMENT');
  }
  return body;
}

function markerCount(source, marker) {
  let count = 0;
  let offset = 0;
  while (true) {
    const index = source.indexOf(marker, offset);
    if (index < 0) return count;
    count += 1;
    offset = index + marker.length;
  }
}

function planCategoryMutation(mode, targetPath, fragmentPath) {
  const source = fs.readFileSync(targetPath, 'utf8');
  const target = JSON.parse(source);
  const fragment = loadFragment(fragmentPath);
  if (!target?.categories || typeof target.categories !== 'object') {
    throw new Error('INVALID_JEV_TARGET');
  }

  const existing = target.categories[fragment.categoryKey];
  if (mode === 'apply') {
    if (existing && !isDeepStrictEqual(existing, fragment.category)) {
      throw new Error('JEV_CATEGORY_CONFLICT');
    }
    target.categories[fragment.categoryKey] = fragment.category;
  } else if (mode === 'remove') {
    if (!existing) return { filePath: targetPath, source, next: source };
    if (!isDeepStrictEqual(existing, fragment.category)) {
      throw new Error('JEV_CATEGORY_DRIFT');
    }
    delete target.categories[fragment.categoryKey];
  } else {
    throw new Error('INVALID_MUTATION_MODE');
  }

  return {
    filePath: targetPath,
    source,
    next: JSON.stringify(target, null, 2) + '\n'
  };
}

function planPromptMutation(mode, targetPath, fragmentPath) {
  const source = fs.readFileSync(targetPath, 'utf8');
  const owned = ownedPromptBlock(fs.readFileSync(fragmentPath, 'utf8'));
  const startCount = markerCount(source, MARKER_START);
  const endCount = markerCount(source, MARKER_END);
  if (startCount > 1 || endCount > 1 || startCount !== endCount) {
    throw new Error('JEV_PROMPT_MARKER_CONFLICT');
  }

  if (startCount === 0) {
    if (mode === 'remove') {
      return { filePath: targetPath, source, next: source };
    }
    return {
      filePath: targetPath,
      source,
      next: source + '\n' + owned + '\n'
    };
  }

  const start = source.indexOf(MARKER_START);
  const end = source.indexOf(MARKER_END, start + MARKER_START.length);
  if (end < start) throw new Error('JEV_PROMPT_MARKER_CONFLICT');
  const blockEnd = end + MARKER_END.length;
  const currentBlock = source.slice(start, blockEnd);

  if (mode === 'apply') {
    return {
      filePath: targetPath,
      source,
      next: source.slice(0, start) + owned + source.slice(blockEnd)
    };
  }

  if (mode !== 'remove') throw new Error('INVALID_MUTATION_MODE');
  if (currentBlock !== owned) throw new Error('JEV_PROMPT_DRIFT');
  if (start === 0 || source[start - 1] !== '\n' || source[blockEnd] !== '\n') {
    throw new Error('JEV_PROMPT_SEPARATOR_DRIFT');
  }

  return {
    filePath: targetPath,
    source,
    next: source.slice(0, start - 1) + source.slice(blockEnd + 1)
  };
}

function prepareWrite(plan, index) {
  if (plan.next === plan.source) return null;
  const stat = fs.statSync(plan.filePath);
  const mode = stat.mode & 0o777;
  const nextPath = plan.filePath + '.jso-jev-' + process.pid + '-' + index + '.next';
  const rollbackPath = plan.filePath + '.jso-jev-' + process.pid + '-' + index + '.rollback';
  fs.writeFileSync(nextPath, plan.next, { mode });
  fs.writeFileSync(rollbackPath, plan.source, { mode });
  return { ...plan, nextPath, rollbackPath };
}

function cleanupPrepared(prepared) {
  for (const item of prepared) {
    if (!item) continue;
    for (const candidate of [item.nextPath, item.rollbackPath]) {
      try {
        fs.unlinkSync(candidate);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
  }
}

function commitPreparedWrites(plans) {
  const prepared = [];
  try {
    plans.forEach((plan, index) => {
      const item = prepareWrite(plan, index);
      if (item) prepared.push(item);
    });
  } catch (error) {
    cleanupPrepared(prepared);
    throw error;
  }

  const committed = [];
  try {
    for (const item of prepared) {
      fs.renameSync(item.nextPath, item.filePath);
      committed.push(item);
    }
  } catch (error) {
    let rollbackFailure = null;
    for (const item of committed.reverse()) {
      try {
        fs.renameSync(item.rollbackPath, item.filePath);
      } catch (rollbackError) {
        rollbackFailure ||= rollbackError;
      }
    }
    try {
      cleanupPrepared(prepared);
    } catch (cleanupError) {
      rollbackFailure ||= cleanupError;
    }
    if (rollbackFailure) {
      const combined = new Error('JEV_MANAGED_STATE_ROLLBACK_FAILED');
      combined.cause = rollbackFailure;
      throw combined;
    }
    throw error;
  }

  for (const item of prepared) {
    try {
      fs.unlinkSync(item.rollbackPath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

function mutateManagedState(mode, {
  configPath,
  promptPath,
  categoryFragment,
  promptFragment
}) {
  if (!['apply', 'remove'].includes(mode)
      || !configPath
      || !promptPath
      || !categoryFragment
      || !promptFragment) {
    throw new Error('INVALID_MANAGED_STATE_REQUEST');
  }

  const categoryPlan = planCategoryMutation(mode, configPath, categoryFragment);
  const promptPlan = planPromptMutation(mode, promptPath, promptFragment);
  commitPreparedWrites([categoryPlan, promptPlan]);
}

function applyManagedState(options) {
  mutateManagedState('apply', options);
}

function removeManagedState(options) {
  mutateManagedState('remove', options);
}

function main(argv = process.argv.slice(2)) {
  const [mode, configPath, promptPath, categoryFragment, promptFragment] = argv;
  if (!['apply', 'remove'].includes(mode)
      || !configPath
      || !promptPath
      || !categoryFragment
      || !promptFragment) {
    throw new Error(
      'usage: manage-jso-jev-category.cjs apply|remove <jev-config> <jev-prompt> <category-fragment> <prompt-fragment>'
    );
  }
  mutateManagedState(mode, {
    configPath,
    promptPath,
    categoryFragment,
    promptFragment
  });
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
  applyManagedState,
  commitPreparedWrites,
  loadFragment,
  main,
  markerCount,
  mutateManagedState,
  ownedPromptBlock,
  planCategoryMutation,
  planPromptMutation,
  removeManagedState
};
