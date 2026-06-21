'use strict';

function buildDryRunSummary(input = {}) {
  return {
    title: 'PhotoStudio dry-run package validation',
    projectRef: input.projectRef || 'not-in-package',
    templateRef: input.templateRef || 'redacted-template',
    writesPlanned: 0
  };
}

module.exports = {
  buildDryRunSummary
};
