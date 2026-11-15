import assert from 'node:assert/strict';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/app.ts';
import { JsonCropKnowledgeRepository } from '../server/repositories/implementations/JsonCropKnowledgeRepository.ts';
import type {
  AgroClimaticRegionsResult,
  ApiErrorResponse,
  ApiSuccessResponse,
  CropKnowledgeCatalogResult,
  CropKnowledgeProfile,
} from '../shared/index.ts';

async function startTestServer(app: ReturnType<typeof createApp>) {
  let server!: Server;
  const baseUrl = await new Promise<string>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  return {
    baseUrl,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

describe('Module 5: Agricultural Crop Knowledge Base', () => {
  const repository = new JsonCropKnowledgeRepository();
  let baseUrl = '';
  let closeServer: () => Promise<void>;

  before(async () => {
    const app = createApp();
    const started = await startTestServer(app);
    baseUrl = started.baseUrl;
    closeServer = started.close;
  });

  after(async () => {
    await closeServer();
  });

  it('contains all required Indian reference crops with ICAR/KVK provenance and validation statuses', async () => {
    const result = await repository.searchCrops({});
    const ids = new Set(result.crops.map((c) => c.id));

    for (const requiredId of [
      'soybean',
      'chickpea',
      'wheat',
      'sorghum',
      'pearl-millet',
      'finger-millet',
      'rice',
      'maize',
    ]) {
      assert.ok(ids.has(requiredId), `Expected crop '${requiredId}' in knowledge base`);
    }

    const validStatuses = new Set(['icar_kvk_verified', 'provisional_regional', 'unavailable']);
    for (const crop of result.crops) {
      const validatedParams = [
        crop.growingSeasons,
        crop.regionalSuitability,
        crop.temperatureRequirements,
        crop.waterRequirements,
        crop.soilPreferences,
        crop.growingDuration,
        crop.nutrientRequirements,
        crop.irrigationNeeds,
        crop.nitrogenFixationCharacteristics,
        crop.cropRotationCompatibility,
      ];

      for (const param of validatedParams) {
        assert.ok(validStatuses.has(param.validationStatus));
        assert.ok(param.validationNote.length > 5);
        assert.ok(
          param.sources.length >= 1,
          `${crop.id} parameter must include at least one ICAR/KVK source`,
        );
        assert.ok(param.sources[0].institute.length > 0);
        assert.ok(param.sources[0].title.length > 0);
      }
    }
  });

  it('explicitly marks unavailable or non-applicable values as null rather than fabricating numbers', async () => {
    const wheat = await repository.getCropById('wheat');
    assert.ok(wheat);
    assert.equal(wheat.nitrogenFixationCharacteristics.value?.fixesAtmosphericNitrogen, false);
    assert.equal(wheat.nitrogenFixationCharacteristics.value?.estimatedFixationKgNHa, null);
    assert.equal(wheat.nitrogenFixationCharacteristics.value?.residualNitrogenCreditKgNHa, null);

    const rice = await repository.getCropById('rice');
    assert.ok(rice);
    assert.equal(rice.irrigationNeeds.validationStatus, 'unavailable');
    assert.equal(rice.irrigationNeeds.value?.recommendedIrrigationsRange, null);

    const soybean = await repository.getCropById('soybean');
    assert.ok(soybean);
    assert.equal(soybean.soilPreferences.value?.salinityThresholdEcDsM, null);
    assert.equal(soybean.nitrogenFixationCharacteristics.validationStatus, 'provisional_regional');
  });

  it('filters cleanly by search, Indian agro-climatic zone, state, season, water, N-fixation, and pH', async () => {
    const byLocalName = await repository.searchCrops({ search: 'Bajra' });
    assert.equal(byLocalName.filteredCount, 1);
    assert.equal(byLocalName.crops[0].id, 'pearl-millet');

    const byScientific = await repository.searchCrops({ search: 'Cicer arietinum' });
    assert.equal(byScientific.filteredCount, 1);
    assert.equal(byScientific.crops[0].id, 'chickpea');

    const byZone = await repository.searchCrops({ agroClimaticZone: 'acz-14-western-dry' });
    const zoneIds = byZone.crops.map((c) => c.id);
    assert.ok(zoneIds.includes('pearl-millet'));
    assert.ok(!zoneIds.includes('rice'));

    const byStateRabi = await repository.searchCrops({ state: 'Madhya Pradesh', season: 'Rabi' });
    const mpRabiIds = byStateRabi.crops.map((c) => c.id);
    assert.ok(mpRabiIds.includes('wheat'));
    assert.ok(mpRabiIds.includes('chickpea'));
    assert.ok(!mpRabiIds.includes('soybean'));

    const nFixing = await repository.searchCrops({ nitrogenFixingOnly: true });
    assert.deepEqual(
      nFixing.crops.map((c) => c.id).sort(),
      ['chickpea', 'groundnut', 'pigeonpea', 'soybean'],
    );

    const acidicPh = await repository.searchCrops({ phTarget: 5.2 });
    const acidicIds = acidicPh.crops.map((c) => c.id);
    assert.ok(acidicIds.includes('rice'));
    assert.ok(acidicIds.includes('finger-millet'));
    assert.ok(!acidicIds.includes('chickpea'));
  });

  it('serves /api/v1/crops/regions, /catalog, /:cropId cleanly with error handling', async () => {
    const regionsRes = await fetch(`${baseUrl}/api/v1/crops/regions`);
    assert.equal(regionsRes.status, 200);
    const regionsBody = (await regionsRes.json()) as ApiSuccessResponse<AgroClimaticRegionsResult>;
    assert.equal(regionsBody.data.zones.length, 15);
    assert.ok(regionsBody.data.states.some((s) => s.state === 'Madhya Pradesh'));

    const catalogRes = await fetch(
      `${baseUrl}/api/v1/crops/catalog?state=Maharashtra&season=Kharif&waterRequirement=low`,
    );
    assert.equal(catalogRes.status, 200);
    const catalogBody = (await catalogRes.json()) as ApiSuccessResponse<CropKnowledgeCatalogResult>;
    assert.ok(catalogBody.data.filteredCount >= 1);
    assert.ok(catalogBody.data.crops.some((c) => c.id === 'pearl-millet'));
    assert.ok(catalogBody.data.knowledgeSeparationNotice.includes('does not compute'));

    const detailRes = await fetch(`${baseUrl}/api/v1/crops/soybean`);
    assert.equal(detailRes.status, 200);
    const detailBody = (await detailRes.json()) as ApiSuccessResponse<CropKnowledgeProfile>;
    assert.equal(detailBody.data.cropName, 'Soybean');

    const missingRes = await fetch(`${baseUrl}/api/v1/crops/unknown-crop-xyz`);
    assert.equal(missingRes.status, 404);
    const missingBody = (await missingRes.json()) as ApiErrorResponse;
    assert.equal(missingBody.error.code, 'NOT_FOUND');

    const invalidRes = await fetch(`${baseUrl}/api/v1/crops/catalog?phTarget=14.5`);
    assert.equal(invalidRes.status, 400);
    const invalidBody = (await invalidRes.json()) as ApiErrorResponse;
    assert.equal(invalidBody.error.code, 'VALIDATION_ERROR');
  });
});
