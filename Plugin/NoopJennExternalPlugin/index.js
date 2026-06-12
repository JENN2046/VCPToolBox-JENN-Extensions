'use strict';

const metadata = Object.freeze({
  name: 'NoopJennExternalPlugin',
  gate: 'Gate 14',
  inert: true,
  productionReady: false,
});

function getMetadata() {
  return metadata;
}

if (require.main === module) {
  process.stdout.write(`${JSON.stringify({ ok: true, metadata })}\n`);
}

module.exports = Object.freeze({
  getMetadata,
  metadata,
});
