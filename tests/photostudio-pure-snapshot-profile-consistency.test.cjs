'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../PhotoStudioPackages/PurePlanningAdapters');
const { listAdapterProfiles } = require(path.join(root, 'index.cjs'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'adapter-profile-manifest.json'), 'utf8'));
// Current human choice: retain V2 copy and allow legacy-template differences.
// This does not infer a requirement from actual fullParity results.
for (const creationId of ['jenn.photo-studio.plugin-case-content-draft', 'jenn.photo-studio.plugin-reply-draft']) {
  test(`selected profile requirement is consistent for ${creationId}`, () => {
    const declared = manifest.profiles.filter(row => row.creationId === creationId);
    const exported = listAdapterProfiles().filter(row => row.creationId === creationId);
    assert.equal(declared.length, 1); assert.equal(exported.length, 1);
    assert.equal(declared[0].legacyTemplateParityRequired, false);
    assert.equal(exported[0].legacyTemplateParityRequired, false);
    for (const key of ['creationId', 'action', 'status', 'runtimeActionEligible', 'fullParity', 'legacyTemplateParityRequired']) {
      assert.deepEqual(exported[0][key], declared[0][key], key);
    }
    assert.equal(declared[0].userAcceptanceStatus, 'PENDING');
    assert.equal(manifest.defaultEnabled, false); assert.equal(manifest.runtimeEnabled, false);
  });
}
