import type {
  ProviderDescriptor,
  SatelliteImageryLayer,
  SatelliteImageryProvider,
  SpatialCoverage,
} from '../../../shared/types/index.ts';
import { getServerEnv } from '../../utils/env.ts';
import { getNasaProviderConfig } from './nasa.config.ts';

export class NasaGibsImageryProvider implements SatelliteImageryProvider {
  public readonly descriptor: ProviderDescriptor;

  constructor() {
    const env = getServerEnv();
    const config = getNasaProviderConfig();
    this.descriptor = {
      id: 'nasa-gibs',
      name: 'NASA GIBS Satellite Imagery',
      category: 'satellite_imagery',
      status: 'configured',
      requiresCredentials: false,
      credentialsPresent: true,
      supportedParameters: ['ndvi', 'evi', 'true_color_reflectance'],
      spatialResolutionLabel: '250 m – 500 m WMTS Tiles',
      provenance: {
        providerId: 'nasa-gibs',
        providerName: 'NASA Global Imagery Browse Services (GIBS)',
        datasetName: 'MODIS / VIIRS WMTS Layers',
        endpoint: config.gibsWmtsUrl,
        license: 'Public Domain (NASA EOSDIS)',
      },
      plannedModule: 'Module 02',
    };
  }

  async listAvailableLayers(_coverage?: SpatialCoverage): Promise<SatelliteImageryLayer[]> {
    return [
      {
        layerId: 'MODIS_Terra_CorrectedReflectance_TrueColor',
        title: 'MODIS Terra True Color Reflectance',
        subtitle: 'Daily true color surface reflectance at 250m resolution.',
        providerId: 'nasa-gibs',
        tileUrlTemplate: `${getNasaProviderConfig().gibsWmtsUrl}/MODIS_Terra_CorrectedReflectance_TrueColor/default/{Time}/EPSG4326/2km/{z}/{y}/{x}.jpg`,
        format: 'image/jpeg',
        projection: 'EPSG:4326',
        temporalSupport: true,
        defaultDate: new Date(Date.now() - 86400000 * 2).toISOString().slice(0, 10),
        attribution: 'NASA EOSDIS GIBS',
        maxZoom: 9,
      },
      {
        layerId: 'MODIS_Terra_NDVI_8Day',
        title: 'MODIS Terra Vegetation Index (NDVI)',
        subtitle: '8-day composite Normalized Difference Vegetation Index.',
        providerId: 'nasa-gibs',
        tileUrlTemplate: `${getNasaProviderConfig().gibsWmtsUrl}/MODIS_Terra_NDVI_8Day/default/{Time}/EPSG4326/2km/{z}/{y}/{x}.png`,
        format: 'image/png',
        projection: 'EPSG:4326',
        temporalSupport: true,
        defaultDate: new Date(Date.now() - 86400000 * 8).toISOString().slice(0, 10),
        attribution: 'NASA EOSDIS GIBS',
        maxZoom: 9,
      },
    ];
  }
}
