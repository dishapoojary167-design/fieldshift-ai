import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildGibsWmtsTileUrl,
  createInitialLayerStates,
  GIBS_LAYER_DEFINITIONS,
} from '../client/config/gibsLayers.ts';

describe('NASA GIBS layer definitions and WMTS URL builder', () => {
  it('defines all 5 environmental layers with units, attribution, date, and legend', () => {
    const ids = GIBS_LAYER_DEFINITIONS.map((l) => l.id);
    assert.deepEqual(ids, ['satellite', 'rainfall', 'temperature', 'soil_moisture', 'vegetation']);

    for (const layer of GIBS_LAYER_DEFINITIONS) {
      assert.ok(layer.gibsLayerId.length > 0);
      assert.ok(layer.units.length > 0);
      assert.ok(layer.sourceAttribution.includes('NASA GIBS'));
      assert.match(layer.defaultDate, /^\d{4}-\d{2}-\d{2}$/);
      if (layer.legend.type === 'gradient') {
        assert.ok(layer.legend.stops.length >= 4);
      } else {
        assert.ok(layer.legend.swatches.length >= 2);
      }
    }
  });

  it('builds valid NASA GIBS EPSG:3857 WMTS tile templates', () => {
    const satellite = GIBS_LAYER_DEFINITIONS.find((l) => l.id === 'satellite')!;
    const url = buildGibsWmtsTileUrl(satellite, '2026-11-10');
    assert.equal(
      url,
      'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/MODIS_Terra_CorrectedReflectance_TrueColor/default/2026-11-10/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpeg',
    );

    const initial = createInitialLayerStates();
    assert.equal(initial.length, 5);
    assert.ok(initial.every((state) => state.enabled === false));
  });
});
