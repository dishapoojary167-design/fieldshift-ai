import assert from 'node:assert/strict';
import test from 'node:test';
import { FileBasedAgriculturalKnowledgeProvider } from '../server/agriculture/index.ts';
import { NotFoundError } from '../server/utils/errors.ts';

test('loads Maharashtra agricultural knowledge bundle independently of core code', async () => {
  const provider = new FileBasedAgriculturalKnowledgeProvider();
  const regions = await provider.listRegions();
  assert.equal(regions.length >= 1, true);

  const bundle = await provider.getRegionKnowledge('IN', 'IN-MH');
  assert.equal(bundle.region.regionName, 'Maharashtra');
  assert.equal(bundle.crops.length >= 5, true);
  assert.equal(bundle.calendars.length >= 5, true);
  assert.equal(bundle.soilZones.length >= 3, true);
  assert.equal(bundle.rotationRules.length >= 3, true);
});

test('throws NotFoundError for unregistered geography', async () => {
  const provider = new FileBasedAgriculturalKnowledgeProvider();
  await assert.rejects(() => provider.getRegionKnowledge('ZZ', 'ZZ-01'), NotFoundError);
});
