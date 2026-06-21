'use strict';

function validateNoProviderDryRun(plan = {}) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  return {
    ok: true,
    mode: 'no_provider_dry_run',
    adapterId: 'jenn.ai-image.provider-adapter',
    steps: steps.length,
    providerCalls: 0,
    imageGeneration: 0,
    outputWrites: 0,
    bridgeCalls: 0,
    localStateReads: 0
  };
}

module.exports = Object.freeze({ validateNoProviderDryRun });
