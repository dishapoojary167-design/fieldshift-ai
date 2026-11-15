import type {
  CropEnvironmentalInputs,
  DateRange,
  EcostressResultPayload,
  FactorDataSourceType,
  FarmEnvironmentalContext,
  FarmEnvironmentalDataSourceSummary,
  FarmEnvironmentalObservationRecord,
  GeoCoordinates,
  GpmImergRainfallObservation,
  HlsResultPayload,
  SoilBoundaryContext,
} from '../../../shared/index.ts';
import type {
  IEvapotranspirationRepository,
  ISoilRepository,
  IVegetationRepository,
  IWeatherRepository,
} from '../../repositories/interfaces/index.ts';
import { resolveSpatialRequestContext } from '../../utils/spatialRequest.ts';
import { runPhase4EnvironmentalAnalytics } from '../../analytics/index.ts';
import type {
  AssembleContextOptions,
  IFarmEnvironmentalContextService,
} from '../interfaces/IFarmEnvironmentalContextService.ts';

interface NumericValidationResult {
  value: number | null;
  status: 'nominal' | 'missing' | 'invalid';
  note?: string;
}

function isFillOrMissing(value: number | null | undefined): boolean {
  if (value === null || value === undefined || typeof value !== 'number' || !Number.isFinite(value)) {
    return true;
  }
  return value === -999 || value === -9999 || value <= -900;
}

function validateNumericObservation(
  value: number | null | undefined,
  min: number,
  max: number,
  decimals: number,
  label: string,
): NumericValidationResult {
  if (isFillOrMissing(value)) {
    return { value: null, status: 'missing', note: `${label} fill value or telemetry missing.` };
  }
  const num = value as number;
  if (num < min || num > max) {
    return {
      value: null,
      status: 'invalid',
      note: `${label} value (${num}) failed physical bounds check [${min}, ${max}] and was rejected rather than coerced.`,
    };
  }
  return { value: Number(num.toFixed(decimals)), status: 'nominal' };
}

function validateTimestamp(dateStr?: string | null): {
  valid: boolean;
  isFuture: boolean;
  parsedMs?: number;
} {
  if (!dateStr || typeof dateStr !== 'string') {
    return { valid: false, isFuture: false };
  }
  const parsedMs = Date.parse(dateStr);
  if (!Number.isFinite(parsedMs)) {
    return { valid: false, isFuture: false };
  }
  // Allow 24h UTC clock skew margin
  const isFuture = parsedMs > Date.now() + 86_400_000;
  return { valid: !isFuture, isFuture, parsedMs };
}

function computeAgeDays(dateStr?: string | null): number | undefined {
  const ts = validateTimestamp(dateStr);
  if (!ts.parsedMs || ts.isFuture) return undefined;
  const diffMs = Date.now() - ts.parsedMs;
  return Math.max(0, Math.floor(diffMs / 86_400_000));
}

function haversineDistanceKm(a: GeoCoordinates, b?: GeoCoordinates | null): number | null {
  if (!b || !Number.isFinite(b.latitude) || !Number.isFinite(b.longitude)) {
    return null;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const rKm = 6371;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return 2 * rKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function resolveDefaultGrowingPeriodRange(): DateRange {
  const end = new Date();
  // NASA POWER daily products typically lag ~3-4 days behind UTC today
  end.setUTCDate(end.getUTCDate() - 4);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 29);
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

function buildSpatialScaleNote(
  datasetScaleLabel: string,
  cellAreaHectares: number,
  boundary?: SoilBoundaryContext,
): string {
  if (!boundary) {
    return `${datasetScaleLabel}; represents regional grid-cell conditions around the farm coordinate, not field-level sensor precision.`;
  }
  return `${datasetScaleLabel} (~${cellAreaHectares.toLocaleString('en-US')} ha cell) vs. farm parcel "${boundary.name}" (${boundary.areaHectares.toFixed(2)} ha); reflects regional background rather than parcel-level micro-variability.`;
}

export class FarmEnvironmentalContextService implements IFarmEnvironmentalContextService {
  private readonly weatherRepository: IWeatherRepository;
  private readonly soilRepository: ISoilRepository;
  private readonly evapotranspirationRepository?: IEvapotranspirationRepository;
  private readonly vegetationRepository?: IVegetationRepository;

  constructor(options: {
    weatherRepository: IWeatherRepository;
    soilRepository: ISoilRepository;
    evapotranspirationRepository?: IEvapotranspirationRepository;
    vegetationRepository?: IVegetationRepository;
  }) {
    this.weatherRepository = options.weatherRepository;
    this.soilRepository = options.soilRepository;
    this.evapotranspirationRepository = options.evapotranspirationRepository;
    this.vegetationRepository = options.vegetationRepository;
  }

  async assembleContext(options: AssembleContextOptions): Promise<FarmEnvironmentalContext> {
    const spatial = resolveSpatialRequestContext(
      options,
      'FarmEnvironmentalContextService',
    );
    const targetLocation = spatial.targetLocation;
    const normalizedBoundary = spatial.boundaryContext;
    const dateRange: DateRange = options.dateRange ?? resolveDefaultGrowingPeriodRange();
    const retrievalTimestamp = new Date().toISOString();
    const existing = options.existingInputs ?? {};
    const labTest = options.labSoilTest ?? null;
    const shouldAutoFetch = options.autoFetchMissingFarmData !== false;

    const needsWeatherTelemetry =
      shouldAutoFetch &&
      (existing.temperatureMeanC === undefined ||
        (existing.seasonalRainfallMm === undefined && existing.observedRainfallMm === undefined) ||
        existing.gpmPrecipitationRateMmHr === undefined ||
        existing.relativeHumidityPercent === undefined ||
        existing.solarRadiationMjM2Day === undefined ||
        existing.windSpeedMs === undefined);

    const needsClimateAnnual =
      shouldAutoFetch &&
      existing.seasonalRainfallMm === undefined &&
      existing.annualRainfallMm === undefined;

    const needsSoilProfile =
      shouldAutoFetch &&
      ((existing.soilPh === undefined && (labTest?.ph === undefined || labTest.ph === null)) ||
        (existing.soilTexture === undefined && !labTest?.textureClass) ||
        (existing.organicCarbonGKg === undefined &&
          (labTest?.organicCarbonGKg === undefined || labTest.organicCarbonGKg === null)));

    const needsSoilMoisture =
      shouldAutoFetch &&
      existing.soilMoistureM3M3 === undefined &&
      existing.soilMoistureSurfaceM3M3 === undefined &&
      existing.soilMoistureRootZoneM3M3 === undefined;

    const needsEcostress = shouldAutoFetch && options.ecostressResult === undefined;
    const needsHls = shouldAutoFetch && options.hlsResult === undefined;

    const [weatherRes, trendsRes, soilProfileRes, soilMoistureRes, ecostressRes, hlsRes] = await Promise.allSettled([
      needsWeatherTelemetry
        ? this.weatherRepository.fetchWeatherTelemetry({
            location: targetLocation,
            boundary: normalizedBoundary,
            geometry: spatial.geometry,
            bbox: spatial.bbox,
            spatialProcessingMode: options.spatialProcessingMode,
            dateRange,
            includeGpmImerg: true,
          })
        : Promise.resolve(null),
      needsClimateAnnual
        ? this.weatherRepository.fetchClimateTrends({
            latitude: targetLocation.latitude,
            longitude: targetLocation.longitude,
            years: 5,
          })
        : Promise.resolve(null),
      needsSoilProfile
        ? this.soilRepository.fetchSoilProfile({
            location: targetLocation,
            boundary: normalizedBoundary,
            geometry: spatial.geometry,
            bbox: spatial.bbox,
            spatialProcessingMode: options.spatialProcessingMode,
            depthCm: '0-5',
          })
        : Promise.resolve(null),
      needsSoilMoisture
        ? this.soilRepository.fetchSoilMoisture({
            location: targetLocation,
            boundary: normalizedBoundary,
            geometry: spatial.geometry,
            bbox: spatial.bbox,
            spatialProcessingMode: options.spatialProcessingMode,
            dateRange,
          })
        : Promise.resolve(null),
      options.ecostressResult !== undefined
        ? Promise.resolve(options.ecostressResult)
        : needsEcostress && this.evapotranspirationRepository?.getLatestCompletedResult
          ? this.evapotranspirationRepository.getLatestCompletedResult({
              location: targetLocation,
              boundary: normalizedBoundary,
              geometry: spatial.geometry,
              bbox: spatial.bbox,
              dateRange,
            })
          : Promise.resolve(null),
      options.hlsResult !== undefined
        ? Promise.resolve(options.hlsResult)
        : needsHls && this.vegetationRepository?.getLatestCompletedResult
          ? this.vegetationRepository.getLatestCompletedResult({
              location: targetLocation,
              boundary: normalizedBoundary,
              geometry: spatial.geometry,
              bbox: spatial.bbox,
              dateRange,
            })
          : Promise.resolve(null),
    ]);

    const ecostressPayload = ecostressRes.status === 'fulfilled' ? ecostressRes.value : null;
    const hlsPayload = hlsRes.status === 'fulfilled' ? hlsRes.value : null;

    const observations: FarmEnvironmentalObservationRecord[] = [];
    const missingParameters: string[] = [];
    const staleParameters: string[] = [];
    const invalidParameters: string[] = [];
    const providerWarnings: string[] = [];

    if (weatherRes.status === 'rejected') {
      providerWarnings.push(
        'NASA POWER daily weather / GPM IMERG retrieval failed; weather inputs could not be auto-populated.',
      );
    }
    if (trendsRes.status === 'rejected') {
      providerWarnings.push(
        'NASA POWER multi-year climate trend retrieval failed; annual rainfall baseline unavailable.',
      );
    }
    if (soilProfileRes.status === 'rejected') {
      providerWarnings.push(
        'ISRIC SoilGrids retrieval failed; modelled soil properties unavailable unless verified lab test records are supplied.',
      );
    }
    if (soilMoistureRes.status === 'rejected') {
      providerWarnings.push('NASA SMAP soil moisture retrieval failed.');
    }
    if (ecostressRes.status === 'rejected') {
      providerWarnings.push('NASA ECOSTRESS evapotranspiration retrieval failed.');
    }
    if (hlsRes.status === 'rejected') {
      providerWarnings.push('NASA Landsat/HLS vegetation retrieval failed.');
    }

    const weather = weatherRes.status === 'fulfilled' ? weatherRes.value : null;
    const trends = trendsRes.status === 'fulfilled' ? trendsRes.value : null;
    const soilProfile = soilProfileRes.status === 'fulfilled' ? soilProfileRes.value : null;
    const smap = soilMoistureRes.status === 'fulfilled' ? soilMoistureRes.value : null;

    if (soilProfile?.status === 'unavailable') {
      providerWarnings.push(
        'ISRIC SoilGrids profile was unavailable for this coordinate; supply verified laboratory soil test records for calibrated evaluation.',
      );
    }

    // Distance checks to verify spatial representativeness of returned provider coordinates
    const weatherDistanceKm = weather ? haversineDistanceKm(targetLocation, weather.location) : null;
    const isWeatherLocationMatch = weatherDistanceKm === null || weatherDistanceKm <= 60;
    const soilDistanceKm = soilProfile ? haversineDistanceKm(targetLocation, soilProfile.location) : null;
    const isSoilLocationMatch = soilDistanceKm === null || soilDistanceKm <= 5;
    const smapDistanceKm = smap ? haversineDistanceKm(targetLocation, smap.location) : null;
    const isSmapLocationMatch = smapDistanceKm === null || smapDistanceKm <= 20;

    // 1. NASA POWER Weather Validation
    const latestDaily = weather?.dailySeries?.at(-1);
    const weatherObsDate = latestDaily?.date ?? weather?.dateRange?.endDate;
    const weatherTs = validateTimestamp(weatherObsDate);
    const weatherAgeDays = computeAgeDays(weatherObsDate);
    const isWeatherStale = weatherAgeDays !== undefined && weatherAgeDays > 45;
    const weatherPeriodLabel = weather?.dateRange
      ? `${weather.dateRange.startDate} to ${weather.dateRange.endDate} (${weather.summary.availableDays} days)`
      : `${dateRange.startDate} to ${dateRange.endDate}`;

    const recordParamState = (
      paramId: string,
      status: 'nominal' | 'estimated' | 'interpolated' | 'missing' | 'invalid',
      isStale: boolean,
    ) => {
      if (status === 'missing') missingParameters.push(paramId);
      if (status === 'invalid') invalidParameters.push(paramId);
      if (isStale && status !== 'missing' && status !== 'invalid') {
        staleParameters.push(paramId);
      }
    };

    // Temperature Mean (T2M)
    const t2mSourceIsUser = existing.temperatureMeanC !== undefined && existing.temperatureMeanC !== null;
    const rawT2M = t2mSourceIsUser ? existing.temperatureMeanC : weather?.summary?.meanTempC;
    const t2mCheck = validateNumericObservation(rawT2M, -50, 60, 2, 'Mean air temperature (T2M)');
    const t2mFutureInvalid = !t2mSourceIsUser && weatherTs.isFuture;
    const validT2M = t2mFutureInvalid ? null : t2mCheck.value;
    const t2mStatus = t2mFutureInvalid ? 'invalid' : t2mCheck.status;
    const t2mRep =
      validT2M !== null && (t2mSourceIsUser || isWeatherLocationMatch);

    observations.push({
      parameterId: 'temperatureMeanC',
      parameterName: 'Mean Air Temperature (2m, T2M)',
      value: validT2M,
      unit: '°C',
      sourceProvider: t2mSourceIsUser ? 'User Input' : 'NASA POWER',
      datasetId: t2mSourceIsUser ? 'USER_OVERRIDE_TEMP' : 'POWER_POINT_DAILY_T2M',
      datasetVersion: t2mSourceIsUser ? 'Farm User Entry' : 'NASA POWER API v2.0 (AG Community)',
      spatialResolution: t2mSourceIsUser
        ? { label: 'Farm / user entry' }
        : { value: 55, unit: 'km', label: '0.5° × 0.5° (~55 km × 55 km grid)' },
      isRepresentative: t2mRep,
      representativenessNote: !isWeatherLocationMatch && !t2mSourceIsUser
        ? `Returned coordinate is ${weatherDistanceKm?.toFixed(1)} km from selected farm (> 60 km limit).`
        : t2mSourceIsUser
          ? 'Farm-level user/field temperature input.'
          : buildSpatialScaleNote('0.5° × 0.5° (~55 km) NASA POWER grid', 302500, normalizedBoundary),
      observationPeriod: t2mSourceIsUser ? 'User-specified evaluation input' : weatherPeriodLabel,
      observationTimestamp: t2mSourceIsUser ? undefined : weatherObsDate,
      retrievalTimestamp,
      quality: {
        status: t2mStatus,
        qualityFlag: validT2M !== null ? 0 : null,
        missingValueIndicator: -999,
        notes: t2mFutureInvalid
          ? 'Rejected future observation timestamp.'
          : t2mCheck.note ?? 'Validated daily average air temperature (2m)',
      },
      staleness: {
        isStale: !t2mSourceIsUser && isWeatherStale,
        ageDays: t2mSourceIsUser ? undefined : weatherAgeDays,
        note:
          !t2mSourceIsUser && isWeatherStale
            ? `Observation window ended ${weatherAgeDays} days ago (> 45-day staleness threshold)`
            : 'Recent historical observation window',
      },
    });
    recordParamState('temperatureMeanC', t2mStatus, !t2mSourceIsUser && isWeatherStale);

    // Temperature Max (T2M_MAX)
    const tmaxIsUser = existing.temperatureMaxC !== undefined && existing.temperatureMaxC !== null;
    const tmaxCheck = validateNumericObservation(
      tmaxIsUser ? existing.temperatureMaxC : weather?.summary?.maxTempC,
      -50,
      65,
      2,
      'Maximum air temperature (T2M_MAX)',
    );
    const validTMax = !tmaxIsUser && weatherTs.isFuture ? null : tmaxCheck.value;
    const tmaxStatus = !tmaxIsUser && weatherTs.isFuture ? 'invalid' : tmaxCheck.status;
    observations.push({
      parameterId: 'temperatureMaxC',
      parameterName: 'Maximum Temperature (2m, T2M_MAX)',
      value: validTMax,
      unit: '°C',
      sourceProvider: tmaxIsUser ? 'User Input' : 'NASA POWER',
      datasetId: tmaxIsUser ? 'USER_OVERRIDE_TMAX' : 'POWER_POINT_DAILY_T2M_MAX',
      datasetVersion: tmaxIsUser ? 'Farm User Entry' : 'NASA POWER API v2.0',
      spatialResolution: tmaxIsUser
        ? { label: 'Farm / user entry' }
        : { value: 55, unit: 'km', label: '0.5° × 0.5° (~55 km grid)' },
      isRepresentative: validTMax !== null && (tmaxIsUser || isWeatherLocationMatch),
      representativenessNote: 'Regional daily maximum temperature for heat-stress assessment.',
      observationPeriod: tmaxIsUser ? 'User-specified' : weatherPeriodLabel,
      observationTimestamp: tmaxIsUser ? undefined : weatherObsDate,
      retrievalTimestamp,
      quality: {
        status: tmaxStatus,
        qualityFlag: validTMax !== null ? 0 : null,
        missingValueIndicator: -999,
        notes: tmaxCheck.note,
      },
      staleness: {
        isStale: !tmaxIsUser && isWeatherStale,
        ageDays: tmaxIsUser ? undefined : weatherAgeDays,
      },
    });
    recordParamState('temperatureMaxC', tmaxStatus, !tmaxIsUser && isWeatherStale);

    // Temperature Min (T2M_MIN)
    const tminIsUser = existing.temperatureMinC !== undefined && existing.temperatureMinC !== null;
    const tminCheck = validateNumericObservation(
      tminIsUser ? existing.temperatureMinC : weather?.summary?.minTempC,
      -60,
      55,
      2,
      'Minimum air temperature (T2M_MIN)',
    );
    const validTMin = !tminIsUser && weatherTs.isFuture ? null : tminCheck.value;
    const tminStatus = !tminIsUser && weatherTs.isFuture ? 'invalid' : tminCheck.status;
    observations.push({
      parameterId: 'temperatureMinC',
      parameterName: 'Minimum Temperature (2m, T2M_MIN)',
      value: validTMin,
      unit: '°C',
      sourceProvider: tminIsUser ? 'User Input' : 'NASA POWER',
      datasetId: tminIsUser ? 'USER_OVERRIDE_TMIN' : 'POWER_POINT_DAILY_T2M_MIN',
      datasetVersion: tminIsUser ? 'Farm User Entry' : 'NASA POWER API v2.0',
      spatialResolution: tminIsUser
        ? { label: 'Farm / user entry' }
        : { value: 55, unit: 'km', label: '0.5° × 0.5° (~55 km grid)' },
      isRepresentative: validTMin !== null && (tminIsUser || isWeatherLocationMatch),
      representativenessNote: 'Regional daily minimum temperature for frost risk assessment.',
      observationPeriod: tminIsUser ? 'User-specified' : weatherPeriodLabel,
      observationTimestamp: tminIsUser ? undefined : weatherObsDate,
      retrievalTimestamp,
      quality: {
        status: tminStatus,
        qualityFlag: validTMin !== null ? 0 : null,
        missingValueIndicator: -999,
        notes: tminCheck.note,
      },
      staleness: {
        isStale: !tminIsUser && isWeatherStale,
        ageDays: tminIsUser ? undefined : weatherAgeDays,
      },
    });
    recordParamState('temperatureMinC', tminStatus, !tminIsUser && isWeatherStale);

    // Observed / Seasonal Rainfall (PRECTOTCORR)
    // Guard against silent zero when dailySeries has all-null precipitationMmDay
    const rainIsUser =
      (existing.seasonalRainfallMm !== undefined && existing.seasonalRainfallMm !== null) ||
      (existing.observedRainfallMm !== undefined && existing.observedRainfallMm !== null);

    let rawPrecip: number | null | undefined = null;
    if (existing.seasonalRainfallMm !== undefined && existing.seasonalRainfallMm !== null) {
      rawPrecip = existing.seasonalRainfallMm;
    } else if (existing.observedRainfallMm !== undefined && existing.observedRainfallMm !== null) {
      rawPrecip = existing.observedRainfallMm;
    } else if (weather && weather.summary.availableDays > 0) {
      const hasValidPrecipDay =
        weather.dailySeries.length === 0 ||
        weather.dailySeries.some((d) => d.precipitationMmDay !== null);
      rawPrecip = hasValidPrecipDay ? weather.summary.totalPrecipitationMm : null;
    }

    const precipCheck = validateNumericObservation(
      rawPrecip,
      0,
      15000,
      1,
      'Observed cumulative rainfall (PRECTOTCORR)',
    );
    const validPrecip = !rainIsUser && weatherTs.isFuture ? null : precipCheck.value;
    const precipStatus = !rainIsUser && weatherTs.isFuture ? 'invalid' : precipCheck.status;
    observations.push({
      parameterId: 'observedRainfallMm',
      parameterName: 'Observed Cumulative Rainfall (PRECTOTCORR)',
      value: validPrecip,
      unit: 'mm',
      sourceProvider: rainIsUser ? 'User Input' : 'NASA POWER',
      datasetId: rainIsUser ? 'USER_OVERRIDE_RAINFALL' : 'POWER_POINT_DAILY_PRECTOTCORR',
      datasetVersion: rainIsUser ? 'Farm User Entry' : 'NASA POWER API v2.0',
      spatialResolution: rainIsUser
        ? { label: 'Farm / user entry' }
        : { value: 55, unit: 'km', label: '0.5° × 0.5° (~55 km grid)' },
      isRepresentative: validPrecip !== null && (rainIsUser || isWeatherLocationMatch),
      representativenessNote: rainIsUser
        ? 'Farm-provided seasonal rainfall input.'
        : buildSpatialScaleNote(
            '0.5° × 0.5° (~55 km) bias-corrected reanalysis precipitation',
            302500,
            normalizedBoundary,
          ),
      observationPeriod: rainIsUser ? 'User-specified seasonal rainfall' : weatherPeriodLabel,
      observationTimestamp: rainIsUser ? undefined : weatherObsDate,
      retrievalTimestamp,
      quality: {
        status: precipStatus,
        qualityFlag: validPrecip !== null ? 0 : null,
        missingValueIndicator: -999,
        notes: precipCheck.note ?? 'Bias-corrected cumulative surface precipitation (historical)',
      },
      staleness: {
        isStale: !rainIsUser && isWeatherStale,
        ageDays: rainIsUser ? undefined : weatherAgeDays,
        note:
          !rainIsUser && isWeatherStale
            ? `Observation window ended ${weatherAgeDays} days ago`
            : 'Recent historical accumulation',
      },
    });
    recordParamState('observedRainfallMm', precipStatus, !rainIsUser && isWeatherStale);

    // Annual Rainfall Baseline (5-Year Trends)
    const annualIsUser = existing.annualRainfallMm !== undefined && existing.annualRainfallMm !== null;
    const annualCheck = validateNumericObservation(
      annualIsUser ? existing.annualRainfallMm : trends?.annualPrecipitationMm,
      0,
      15000,
      0,
      'Multi-year annual rainfall baseline',
    );
    const validAnnualPrecip = annualCheck.value;
    observations.push({
      parameterId: 'annualRainfallMm',
      parameterName: 'Multi-Year Baseline Annual Rainfall',
      value: validAnnualPrecip,
      unit: 'mm',
      sourceProvider: annualIsUser ? 'User Input' : 'NASA POWER',
      datasetId: annualIsUser ? 'USER_OVERRIDE_ANNUAL_RAIN' : 'POWER_CLIMATE_TRENDS_5YR',
      datasetVersion: annualIsUser ? 'Farm User Entry' : 'NASA POWER 5-Year Climatology Baseline',
      spatialResolution: { value: 55, unit: 'km', label: '0.5° × 0.5° (~55 km grid)' },
      isRepresentative: validAnnualPrecip !== null,
      representativenessNote:
        '5-year historical annual rainfall average; distinct from single-season observed accumulation and NOT a forecast.',
      observationPeriod: '5-year rolling historical baseline',
      retrievalTimestamp,
      quality: {
        status: annualCheck.status,
        qualityFlag: validAnnualPrecip !== null ? 0 : null,
        missingValueIndicator: -999,
        notes: annualCheck.note,
      },
      staleness: { isStale: false, note: 'Multi-year climatological baseline' },
    });
    recordParamState('annualRainfallMm', annualCheck.status, false);

    // Relative Humidity (RH2M)
    const rhIsUser =
      existing.relativeHumidityPercent !== undefined && existing.relativeHumidityPercent !== null;
    const rhCheck = validateNumericObservation(
      rhIsUser ? existing.relativeHumidityPercent : weather?.summary?.meanRelativeHumidityPercent,
      0,
      100,
      1,
      'Relative humidity at 2m (RH2M)',
    );
    const validRh = !rhIsUser && weatherTs.isFuture ? null : rhCheck.value;
    const rhStatus = !rhIsUser && weatherTs.isFuture ? 'invalid' : rhCheck.status;
    observations.push({
      parameterId: 'relativeHumidityPercent',
      parameterName: 'Relative Humidity at 2m (RH2M)',
      value: validRh,
      unit: '%',
      sourceProvider: rhIsUser ? 'User Input' : 'NASA POWER',
      datasetId: rhIsUser ? 'USER_OVERRIDE_RH' : 'POWER_POINT_DAILY_RH2M',
      datasetVersion: rhIsUser ? 'Farm User Entry' : 'NASA POWER API v2.0',
      spatialResolution: { value: 55, unit: 'km', label: '0.5° × 0.5° (~55 km grid)' },
      isRepresentative: validRh !== null && (rhIsUser || isWeatherLocationMatch),
      representativenessNote:
        'Regional atmospheric humidity for foliar disease pressure and evapotranspiration context.',
      observationPeriod: rhIsUser ? 'User-specified' : weatherPeriodLabel,
      observationTimestamp: rhIsUser ? undefined : weatherObsDate,
      retrievalTimestamp,
      quality: {
        status: rhStatus,
        qualityFlag: validRh !== null ? 0 : null,
        missingValueIndicator: -999,
        notes: rhCheck.note,
      },
      staleness: {
        isStale: !rhIsUser && isWeatherStale,
        ageDays: rhIsUser ? undefined : weatherAgeDays,
      },
    });
    recordParamState('relativeHumidityPercent', rhStatus, !rhIsUser && isWeatherStale);

    // Solar Radiation (ALLSKY_SFC_SW_DWN)
    const solIsUser =
      existing.solarRadiationMjM2Day !== undefined && existing.solarRadiationMjM2Day !== null;
    const solCheck = validateNumericObservation(
      solIsUser ? existing.solarRadiationMjM2Day : weather?.summary?.meanSolarRadiationMjM2Day,
      0,
      45,
      2,
      'Solar radiation (ALLSKY_SFC_SW_DWN)',
    );
    const validSol = !solIsUser && weatherTs.isFuture ? null : solCheck.value;
    const solStatus = !solIsUser && weatherTs.isFuture ? 'invalid' : solCheck.status;
    observations.push({
      parameterId: 'solarRadiationMjM2Day',
      parameterName: 'All Sky Insolation Incident (ALLSKY_SFC_SW_DWN)',
      value: validSol,
      unit: 'MJ/m²/day',
      sourceProvider: solIsUser ? 'User Input' : 'NASA POWER',
      datasetId: solIsUser ? 'USER_OVERRIDE_SOLAR' : 'POWER_POINT_DAILY_ALLSKY_SFC_SW_DWN',
      datasetVersion: solIsUser ? 'Farm User Entry' : 'NASA POWER API v2.0',
      spatialResolution: { value: 55, unit: 'km', label: '0.5° × 0.5° (~55 km grid)' },
      isRepresentative: validSol !== null && (solIsUser || isWeatherLocationMatch),
      representativenessNote:
        'Regional incident solar irradiance supporting photosynthetic energy and ET context.',
      observationPeriod: solIsUser ? 'User-specified' : weatherPeriodLabel,
      observationTimestamp: solIsUser ? undefined : weatherObsDate,
      retrievalTimestamp,
      quality: {
        status: solStatus,
        qualityFlag: validSol !== null ? 0 : null,
        missingValueIndicator: -999,
        notes: solCheck.note,
      },
      staleness: {
        isStale: !solIsUser && isWeatherStale,
        ageDays: solIsUser ? undefined : weatherAgeDays,
      },
    });
    recordParamState('solarRadiationMjM2Day', solStatus, !solIsUser && isWeatherStale);

    // Wind Speed (WS2M)
    const windIsUser = existing.windSpeedMs !== undefined && existing.windSpeedMs !== null;
    const windCheck = validateNumericObservation(
      windIsUser ? existing.windSpeedMs : weather?.summary?.meanWindSpeedMs,
      0,
      60,
      2,
      'Wind speed at 2m (WS2M)',
    );
    const validWind = !windIsUser && weatherTs.isFuture ? null : windCheck.value;
    const windStatus = !windIsUser && weatherTs.isFuture ? 'invalid' : windCheck.status;
    observations.push({
      parameterId: 'windSpeedMs',
      parameterName: 'Wind Speed at 2m (WS2M)',
      value: validWind,
      unit: 'm/s',
      sourceProvider: windIsUser ? 'User Input' : 'NASA POWER',
      datasetId: windIsUser ? 'USER_OVERRIDE_WIND' : 'POWER_POINT_DAILY_WS2M',
      datasetVersion: windIsUser ? 'Farm User Entry' : 'NASA POWER API v2.0',
      spatialResolution: { value: 55, unit: 'km', label: '0.5° × 0.5° (~55 km grid)' },
      isRepresentative: validWind !== null && (windIsUser || isWeatherLocationMatch),
      representativenessNote:
        'Regional 2m wind speed for crop lodging and evaporative demand context.',
      observationPeriod: windIsUser ? 'User-specified' : weatherPeriodLabel,
      observationTimestamp: windIsUser ? undefined : weatherObsDate,
      retrievalTimestamp,
      quality: {
        status: windStatus,
        qualityFlag: validWind !== null ? 0 : null,
        missingValueIndicator: -999,
        notes: windCheck.note,
      },
      staleness: {
        isStale: !windIsUser && isWeatherStale,
        ageDays: windIsUser ? undefined : weatherAgeDays,
      },
    });
    recordParamState('windSpeedMs', windStatus, !windIsUser && isWeatherStale);

    // 2. NASA GPM IMERG Satellite Precipitation (kept strictly distinct from NASA POWER accumulation)
    const gpm: GpmImergRainfallObservation | null = weather?.gpmImerg ?? null;
    const gpmIsUser =
      existing.gpmPrecipitationRateMmHr !== undefined && existing.gpmPrecipitationRateMmHr !== null;
    const rawGpmRate = gpmIsUser
      ? existing.gpmPrecipitationRateMmHr
      : gpm?.status === 'available'
        ? gpm.precipitationRateMmHr
        : null;
    const gpmCheck = validateNumericObservation(
      rawGpmRate,
      0,
      500,
      2,
      'NASA GPM IMERG precipitation rate',
    );
    const gpmTs = validateTimestamp(gpm?.observationTimestamp);
    const gpmFutureInvalid = !gpmIsUser && Boolean(gpm?.observationTimestamp) && gpmTs.isFuture;
    const validGpmRate = gpmFutureInvalid ? null : gpmCheck.value;
    const gpmStatus = gpmFutureInvalid ? 'invalid' : gpmCheck.status;
    const gpmAgeDays = computeAgeDays(gpm?.observationTimestamp);
    const isGpmStale = !gpmIsUser && gpmAgeDays !== undefined && gpmAgeDays > 7;

    observations.push({
      parameterId: 'gpmPrecipitationRateMmHr',
      parameterName: 'Satellite Rainfall Rate (GPM IMERG)',
      value: validGpmRate,
      unit: 'mm/hr',
      sourceProvider: gpmIsUser ? 'User Input' : 'NASA GPM IMERG',
      datasetId: 'GPM_3IMERGDF_LATE',
      datasetVersion: gpm?.product ?? 'GPM IMERG v07',
      spatialResolution: { value: 11, unit: 'km', label: '0.1° × 0.1° (~11 km × 11 km grid)' },
      isRepresentative: validGpmRate !== null && (gpmIsUser || isWeatherLocationMatch),
      representativenessNote: buildSpatialScaleNote(
        '0.1° × 0.1° (~11 km) GPM IMERG satellite rainfall rate',
        12100,
        normalizedBoundary,
      ),
      observationPeriod: gpm?.observationTimestamp ? `Snapshot ${gpm.observationTimestamp}` : undefined,
      observationTimestamp: gpm?.observationTimestamp ?? undefined,
      retrievalTimestamp,
      quality: {
        status: gpmStatus,
        qualityFlag: validGpmRate !== null ? 0 : 1,
        missingValueIndicator: -9999,
        notes: gpmFutureInvalid
          ? 'Rejected future GPM observation timestamp.'
          : gpm?.message ??
            gpmCheck.note ??
            'Satellite microwave/infrared precipitation rate (not interchangeable with seasonal accumulation)',
      },
      staleness: {
        isStale: isGpmStale,
        ageDays: gpmAgeDays,
        note: isGpmStale
          ? `GPM observation is ${gpmAgeDays} days old (> 7-day threshold)`
          : 'Recent satellite pass',
      },
    });
    recordParamState('gpmPrecipitationRateMmHr', gpmStatus, isGpmStale);

    // 3. NASA SMAP Soil Moisture
    const smapTs = validateTimestamp(smap?.observationDate);
    const smapAgeDays = computeAgeDays(smap?.observationDate);
    const isSmapStale = smapAgeDays !== undefined && smapAgeDays > 14;
    const smapFutureInvalid = Boolean(smap?.observationDate) && smapTs.isFuture;

    // Surface SMAP (0-5 cm)
    const smapSurfIsUser =
      existing.soilMoistureSurfaceM3M3 !== undefined && existing.soilMoistureSurfaceM3M3 !== null;
    const smapSurfCheck = validateNumericObservation(
      smapSurfIsUser ? existing.soilMoistureSurfaceM3M3 : smap?.surfaceMoistureM3M3,
      0,
      1,
      3,
      'Surface soil moisture (SMAP 0–5 cm)',
    );
    const validSmapSurface = !smapSurfIsUser && smapFutureInvalid ? null : smapSurfCheck.value;
    const smapSurfStatus = !smapSurfIsUser && smapFutureInvalid ? 'invalid' : smapSurfCheck.status;
    observations.push({
      parameterId: 'soilMoistureSurfaceM3M3',
      parameterName: 'Surface Soil Moisture (0–5 cm, SPL3SMP_E)',
      value: validSmapSurface,
      unit: 'm³/m³',
      sourceProvider: smapSurfIsUser ? 'User Input' : 'NASA SMAP',
      datasetId: 'SPL3SMP_E_V006',
      datasetVersion: 'SMAP Enhanced L3 Radiometer Global Daily 9 km (SPL3SMP_E V006)',
      spatialResolution: { value: 9, unit: 'km', label: '9 km × 9 km (EASE-Grid 2.0)' },
      isRepresentative: validSmapSurface !== null && (smapSurfIsUser || isSmapLocationMatch),
      representativenessNote: !isSmapLocationMatch && !smapSurfIsUser
        ? `SMAP footprint center is ${smapDistanceKm?.toFixed(1)} km from farm (> 20 km threshold).`
        : buildSpatialScaleNote('9 km × 9 km EASE-Grid 2.0 surface soil moisture', 8100, normalizedBoundary),
      observationPeriod: smap?.observationDate ? `Observation date ${smap.observationDate}` : undefined,
      observationTimestamp: smap?.observationDate ?? undefined,
      retrievalTimestamp,
      quality: {
        status: smapSurfStatus,
        qualityFlag: validSmapSurface !== null ? 0 : 1,
        missingValueIndicator: -9999.0,
        notes: smapSurfCheck.note ?? 'L-band passive microwave volumetric soil moisture (does not measure NPK/pH)',
      },
      staleness: {
        isStale: !smapSurfIsUser && isSmapStale,
        ageDays: smapSurfIsUser ? undefined : smapAgeDays,
        note:
          !smapSurfIsUser && isSmapStale
            ? `SMAP observation is ${smapAgeDays} days old (> 14-day threshold)`
            : 'Recent satellite pass',
      },
    });
    recordParamState('soilMoistureSurfaceM3M3', smapSurfStatus, !smapSurfIsUser && isSmapStale);

    // Root-Zone SMAP (0-100 cm)
    const smapRootIsUser =
      (existing.soilMoistureRootZoneM3M3 !== undefined &&
        existing.soilMoistureRootZoneM3M3 !== null) ||
      (existing.soilMoistureM3M3 !== undefined && existing.soilMoistureM3M3 !== null);
    const rawSmapRoot =
      existing.soilMoistureRootZoneM3M3 ?? existing.soilMoistureM3M3 ?? smap?.rootZoneMoistureM3M3;
    const smapRootCheck = validateNumericObservation(
      rawSmapRoot,
      0,
      1,
      3,
      'Root-zone soil moisture (SMAP L4 0–100 cm)',
    );
    const validSmapRoot = !smapRootIsUser && smapFutureInvalid ? null : smapRootCheck.value;
    const smapRootStatus = !smapRootIsUser && smapFutureInvalid ? 'invalid' : smapRootCheck.status;
    observations.push({
      parameterId: 'soilMoistureRootZoneM3M3',
      parameterName: 'Root-Zone Soil Moisture (0–100 cm, SPL4SMGP)',
      value: validSmapRoot,
      unit: 'm³/m³',
      sourceProvider: smapRootIsUser ? 'User Input' : 'NASA SMAP',
      datasetId: 'SPL4SMGP_V007',
      datasetVersion: 'SMAP L4 Global 9 km Surface and Root-Zone (SPL4SMGP V007)',
      spatialResolution: { value: 9, unit: 'km', label: '9 km × 9 km (EASE-Grid 2.0)' },
      isRepresentative: validSmapRoot !== null && (smapRootIsUser || isSmapLocationMatch),
      representativenessNote: smapRootIsUser
        ? 'Farm/user root-zone soil moisture entry.'
        : buildSpatialScaleNote(
            '9 km × 9 km CLSM root-zone soil moisture assimilation',
            8100,
            normalizedBoundary,
          ),
      observationPeriod: smapRootIsUser
        ? 'User-specified'
        : smap?.observationDate
          ? `Observation date ${smap.observationDate}`
          : undefined,
      observationTimestamp: smapRootIsUser ? undefined : smap?.observationDate ?? undefined,
      retrievalTimestamp,
      quality: {
        status: smapRootStatus,
        qualityFlag: validSmapRoot !== null ? 0 : 1,
        missingValueIndicator: -9999.0,
        notes: smapRootCheck.note ?? 'Land surface model assimilation incorporating SMAP observations',
      },
      staleness: {
        isStale: !smapRootIsUser && isSmapStale,
        ageDays: smapRootIsUser ? undefined : smapAgeDays,
        note:
          !smapRootIsUser && isSmapStale
            ? `SMAP observation is ${smapAgeDays} days old (> 14-day threshold)`
            : undefined,
      },
    });
    recordParamState('soilMoistureRootZoneM3M3', smapRootStatus, !smapRootIsUser && isSmapStale);

    // 4. Soil Characteristics (User override -> Verified Lab Soil Test -> ISRIC SoilGrids modelled estimate)
    const labAgeDays = computeAgeDays(labTest?.sampleDate);
    const isLabStale = labAgeDays !== undefined && labAgeDays > 1095;

    // Soil pH
    let finalPh: number | null = null;
    let phStatus: 'nominal' | 'estimated' | 'missing' | 'invalid' = 'missing';
    let phSource: FactorDataSourceType = 'unavailable';
    let phProvider: FarmEnvironmentalObservationRecord['sourceProvider'] = 'ISRIC SoilGrids';
    let phResolutionLabel = '250 m × 250 m digital soil map grid';
    let phRepNote = 'ISRIC SoilGrids v2.0 machine-learning spatial prediction (250 m); verify with lab soil test.';
    let phDatasetId = 'SOILGRIDS_PH_H2O_0_5CM';
    let phDatasetVersion = 'ISRIC SoilGrids 2020 REST v2.0';
    let phTimestamp: string | undefined;
    let phStale = false;
    let phQualityNote: string | undefined;

    if (existing.soilPh !== undefined && existing.soilPh !== null) {
      const check = validateNumericObservation(existing.soilPh, 2.5, 11, 1, 'Soil pH');
      finalPh = check.value;
      phStatus = check.status;
      phQualityNote = check.note;
      if (finalPh !== null) {
        phSource = existing.soilPhSource ?? 'user_input';
        phProvider = phSource === 'measured_lab' ? 'Laboratory Soil Test' : phSource === 'modelled_estimate' ? 'ISRIC SoilGrids' : 'User Input';
        phResolutionLabel = phSource === 'modelled_estimate' ? '250 m × 250 m grid' : 'Point field sample / entry';
        phDatasetId = phSource === 'measured_lab' ? 'FARM_LAB_SOIL_TEST' : phSource === 'modelled_estimate' ? 'SOILGRIDS_PH_H2O_0_5CM' : 'USER_OVERRIDE_PH';
        phRepNote = phSource === 'measured_lab' ? 'Verified laboratory soil pH sample.' : 'User-supplied or cached soil pH observation.';
      }
    } else if (labTest?.ph !== undefined && labTest.ph !== null) {
      const check = validateNumericObservation(labTest.ph, 2.5, 11, 1, 'Laboratory Soil pH');
      finalPh = check.value;
      phStatus = check.status;
      phQualityNote = check.note;
      if (finalPh !== null) {
        phSource = 'measured_lab';
        phProvider = 'Laboratory Soil Test';
        phResolutionLabel = 'Point field sample';
        phRepNote = `Verified laboratory soil test (${labTest.labName}, sampled ${labTest.sampleDate}).`;
        phDatasetId = 'FARM_LAB_SOIL_TEST';
        phDatasetVersion = 'Farmer Laboratory Test Result';
        phTimestamp = labTest.sampleDate;
        phStale = isLabStale;
      }
    } else if (soilProfile?.surfaceSummary?.ph?.mean !== undefined && soilProfile.surfaceSummary.ph.mean !== null) {
      const check = validateNumericObservation(soilProfile.surfaceSummary.ph.mean, 2.5, 11, 1, 'SoilGrids Soil pH');
      finalPh = check.value;
      phStatus = check.status === 'nominal' ? 'estimated' : check.status;
      phQualityNote = check.note ?? 'ISRIC modelled mean [Q0.05–Q0.95]';
      if (finalPh !== null) {
        phSource = 'modelled_estimate';
      }
    }

    observations.push({
      parameterId: 'soilPh',
      parameterName: 'Topsoil pH in H₂O (0–5 cm)',
      value: finalPh,
      unit: 'pH',
      sourceProvider: phProvider,
      datasetId: phDatasetId,
      datasetVersion: phDatasetVersion,
      spatialResolution: {
        value: phSource === 'modelled_estimate' ? 0.25 : undefined,
        unit: phSource === 'modelled_estimate' ? 'km' : undefined,
        label: phResolutionLabel,
      },
      isRepresentative:
        finalPh !== null && (phSource !== 'modelled_estimate' || isSoilLocationMatch),
      representativenessNote: phRepNote,
      observationTimestamp: phTimestamp,
      retrievalTimestamp,
      quality: {
        status: phStatus,
        qualityFlag: finalPh !== null ? 0 : null,
        missingValueIndicator: -999,
        notes: phQualityNote,
      },
      staleness: {
        isStale: phStale,
        ageDays: phSource === 'measured_lab' ? labAgeDays : undefined,
        note: phStale ? `Lab sample is ${labAgeDays} days old (> 3 years)` : undefined,
      },
    });
    recordParamState('soilPh', phStatus, phStale);

    // Soil Texture
    let finalTexture: string | null = null;
    let textureStatus: 'nominal' | 'estimated' | 'missing' = 'missing';
    let textureSource: FactorDataSourceType = 'unavailable';
    let textureProvider: FarmEnvironmentalObservationRecord['sourceProvider'] = 'ISRIC SoilGrids';
    let textureResLabel = '250 m × 250 m grid';
    let textureDatasetId = 'SOILGRIDS_TEXTURE_0_5CM';
    let textureDatasetVersion = 'ISRIC SoilGrids 2020';
    let textureTimestamp: string | undefined;
    let textureStale = false;

    if (existing.soilTexture && existing.soilTexture.trim().length > 0) {
      finalTexture = existing.soilTexture.trim();
      textureStatus = existing.soilTextureSource === 'modelled_estimate' ? 'estimated' : 'nominal';
      textureSource = existing.soilTextureSource ?? 'user_input';
      textureProvider =
        textureSource === 'measured_lab'
          ? 'Laboratory Soil Test'
          : textureSource === 'modelled_estimate'
            ? 'ISRIC SoilGrids'
            : 'User Input';
      textureResLabel =
        textureSource === 'modelled_estimate' ? '250 m × 250 m grid' : 'Point field sample / entry';
      textureDatasetId =
        textureSource === 'measured_lab'
          ? 'FARM_LAB_SOIL_TEST'
          : textureSource === 'modelled_estimate'
            ? 'SOILGRIDS_TEXTURE_0_5CM'
            : 'USER_OVERRIDE_TEXTURE';
    } else if (labTest?.textureClass && labTest.textureClass.trim().length > 0) {
      finalTexture = labTest.textureClass.trim();
      textureStatus = 'nominal';
      textureSource = 'measured_lab';
      textureProvider = 'Laboratory Soil Test';
      textureResLabel = 'Point field sample';
      textureDatasetId = 'FARM_LAB_SOIL_TEST';
      textureDatasetVersion = 'Farmer Laboratory Test Result';
      textureTimestamp = labTest.sampleDate;
      textureStale = isLabStale;
    } else if (soilProfile?.surfaceSummary?.textureClass) {
      finalTexture = soilProfile.surfaceSummary.textureClass;
      textureStatus = 'estimated';
      textureSource = 'modelled_estimate';
    }

    observations.push({
      parameterId: 'soilTexture',
      parameterName: 'USDA Soil Texture Class (0–5 cm)',
      value: finalTexture,
      unit: 'USDA class',
      sourceProvider: textureProvider,
      datasetId: textureDatasetId,
      datasetVersion: textureDatasetVersion,
      spatialResolution: { label: textureResLabel },
      isRepresentative:
        finalTexture !== null && (textureSource !== 'modelled_estimate' || isSoilLocationMatch),
      representativenessNote:
        textureSource === 'measured_lab'
          ? 'Laboratory particle-size classification.'
          : textureSource === 'user_input'
            ? 'User-supplied field texture class.'
            : 'ISRIC SoilGrids Sand/Silt/Clay machine-learning classification (250 m grid).',
      observationTimestamp: textureTimestamp,
      retrievalTimestamp,
      quality: {
        status: textureStatus,
        qualityFlag: finalTexture !== null ? 0 : null,
      },
      staleness: {
        isStale: textureStale,
        ageDays: textureSource === 'measured_lab' ? labAgeDays : undefined,
      },
    });
    recordParamState('soilTexture', textureStatus, textureStale);

    // Soil Organic Carbon (SOC)
    let finalSoc: number | null = null;
    let socStatus: 'nominal' | 'estimated' | 'missing' | 'invalid' = 'missing';
    let socSource: FactorDataSourceType = 'unavailable';
    let socProvider: FarmEnvironmentalObservationRecord['sourceProvider'] = 'ISRIC SoilGrids';
    let socResLabel = '250 m × 250 m grid';
    let socDatasetId = 'SOILGRIDS_SOC_0_5CM';
    let socDatasetVersion = 'ISRIC SoilGrids 2020';
    let socTimestamp: string | undefined;
    let socStale = false;
    let socQualityNote: string | undefined;

    if (existing.organicCarbonGKg !== undefined && existing.organicCarbonGKg !== null) {
      const check = validateNumericObservation(existing.organicCarbonGKg, 0, 200, 1, 'Soil organic carbon');
      finalSoc = check.value;
      socStatus = check.status;
      socQualityNote = check.note;
      if (finalSoc !== null) {
        socSource = existing.organicCarbonSource ?? 'user_input';
        socProvider =
          socSource === 'measured_lab'
            ? 'Laboratory Soil Test'
            : socSource === 'modelled_estimate'
              ? 'ISRIC SoilGrids'
              : 'User Input';
        socResLabel =
          socSource === 'modelled_estimate' ? '250 m × 250 m grid' : 'Point field sample / entry';
      }
    } else if (labTest?.organicCarbonGKg !== undefined && labTest.organicCarbonGKg !== null) {
      const check = validateNumericObservation(
        labTest.organicCarbonGKg,
        0,
        200,
        1,
        'Laboratory soil organic carbon',
      );
      finalSoc = check.value;
      socStatus = check.status;
      socQualityNote = check.note;
      if (finalSoc !== null) {
        socSource = 'measured_lab';
        socProvider = 'Laboratory Soil Test';
        socResLabel = 'Point field sample';
        socDatasetId = 'FARM_LAB_SOIL_TEST';
        socDatasetVersion = 'Farmer Laboratory Test Result';
        socTimestamp = labTest.sampleDate;
        socStale = isLabStale;
      }
    } else if (
      soilProfile?.surfaceSummary?.organicCarbonGKg?.mean !== undefined &&
      soilProfile.surfaceSummary.organicCarbonGKg.mean !== null
    ) {
      const check = validateNumericObservation(
        soilProfile.surfaceSummary.organicCarbonGKg.mean,
        0,
        200,
        1,
        'SoilGrids organic carbon',
      );
      finalSoc = check.value;
      socStatus = check.status === 'nominal' ? 'estimated' : check.status;
      socQualityNote = check.note ?? 'ISRIC SoilGrids modelled SOC prediction';
      if (finalSoc !== null) {
        socSource = 'modelled_estimate';
      }
    }

    observations.push({
      parameterId: 'organicCarbonGKg',
      parameterName: 'Soil Organic Carbon (0–5 cm, SOC)',
      value: finalSoc,
      unit: 'g/kg',
      sourceProvider: socProvider,
      datasetId: socDatasetId,
      datasetVersion: socDatasetVersion,
      spatialResolution: { label: socResLabel },
      isRepresentative:
        finalSoc !== null && (socSource !== 'modelled_estimate' || isSoilLocationMatch),
      representativenessNote:
        socSource === 'measured_lab'
          ? 'Laboratory soil organic carbon analysis.'
          : socSource === 'user_input'
            ? 'User-supplied organic carbon measurement.'
            : 'ISRIC SoilGrids machine-learning predicted organic carbon density (250 m grid).',
      observationTimestamp: socTimestamp,
      retrievalTimestamp,
      quality: {
        status: socStatus,
        qualityFlag: finalSoc !== null ? 0 : null,
        notes: socQualityNote,
      },
      staleness: {
        isStale: socStale,
        ageDays: socSource === 'measured_lab' ? labAgeDays : undefined,
      },
    });
    recordParamState('organicCarbonGKg', socStatus, socStale);

    // 5. Phase 4 Validated NASA ECOSTRESS & Landsat/HLS Observations
    const phase4Analytics = runPhase4EnvironmentalAnalytics({
      ecostressPayload,
      hlsPayload,
    });
    const { etDailyWm2: etSnap, esiRatio: esiSnap, ndvi: ndviSnap, ndwi: ndwiSnap } =
      phase4Analytics.qualityReport.latestValidMetrics;

    const rawEt = existing.etDailyWm2 ?? etSnap.value;
    const etCheck = validateNumericObservation(rawEt, 0, 1500, 1, 'Daily Evapotranspiration (ET)');
    const etDate = existing.etDailyWm2 !== undefined && existing.etDailyWm2 !== null
      ? undefined
      : (etSnap.observationTimestamp ?? undefined);
    const etAgeDays = etDate ? (etSnap.ageDays ?? computeAgeDays(etDate)) : undefined;
    const isEtStale = Boolean(etSnap.isStale || (etAgeDays !== undefined && etAgeDays > 45));

    observations.push({
      parameterId: 'etDailyWm2',
      parameterName: 'Daily Evapotranspiration (ECO_L3T_JET)',
      value: etCheck.value,
      unit: 'W/m²',
      sourceProvider: 'NASA ECOSTRESS',
      datasetId: etSnap.productId ?? 'ECO_L3T_JET.002',
      datasetVersion: 'ECOSTRESS Collection 2 L3T JET v002',
      spatialResolution: { value: 70, unit: 'm', label: '70 m × 70 m thermal grid' },
      isRepresentative:
        etCheck.value !== null &&
        (etSnap.coveragePercent === null || etSnap.coveragePercent >= 50),
      representativenessNote:
        etSnap.coveragePercent !== null && etSnap.coveragePercent < 50
          ? `ECOSTRESS 70m observation with partial parcel coverage (${etSnap.coveragePercent.toFixed(1)}%).`
          : 'ECOSTRESS high-resolution 70m thermal evapotranspiration observation.',
      observationPeriod: etDate ? `Observation timestamp ${etDate}` : undefined,
      observationTimestamp: etDate,
      retrievalTimestamp: etSnap.retrievalTimestamp ?? retrievalTimestamp,
      quality: {
        status: etCheck.status,
        qualityFlag: etSnap.cloudMaskFlag,
        missingValueIndicator: -9999,
        notes: etCheck.note ?? 'Validated clear-sky ECOSTRESS daily ET',
      },
      staleness: {
        isStale: isEtStale,
        ageDays: etAgeDays,
      },
    });
    recordParamState('etDailyWm2', etCheck.status, isEtStale);

    // ESI Ratio (tracked with its own ECO_L4T_ESI timestamp & cloudMaskFlag)
    const rawEsi = existing.esiRatio ?? esiSnap.value;
    const esiCheck = validateNumericObservation(rawEsi, 0, 1, 3, 'Evaporative Stress Index (ESI)');
    const esiDate = existing.esiRatio !== undefined && existing.esiRatio !== null
      ? undefined
      : (esiSnap.observationTimestamp ?? undefined);
    const esiAgeDays = esiDate ? (esiSnap.ageDays ?? computeAgeDays(esiDate)) : undefined;
    const isEsiStale = Boolean(esiSnap.isStale || (esiAgeDays !== undefined && esiAgeDays > 45));

    observations.push({
      parameterId: 'esiRatio',
      parameterName: 'Evaporative Stress Index (ECO_L4T_ESI)',
      value: esiCheck.value,
      unit: 'Ratio (0–1)',
      sourceProvider: 'NASA ECOSTRESS',
      datasetId: esiSnap.productId ?? 'ECO_L4T_ESI.002',
      datasetVersion: 'ECOSTRESS Collection 2 L4T ESI v002',
      spatialResolution: { value: 70, unit: 'm', label: '70 m × 70 m thermal grid' },
      isRepresentative:
        esiCheck.value !== null &&
        (esiSnap.coveragePercent === null || esiSnap.coveragePercent >= 50),
      representativenessNote:
        esiSnap.coveragePercent !== null && esiSnap.coveragePercent < 50
          ? `ECOSTRESS 70m ESI ratio with partial parcel coverage (${esiSnap.coveragePercent.toFixed(1)}%).`
          : 'ECOSTRESS 70m evaporative stress index ratio.',
      observationPeriod: esiDate ? `Observation timestamp ${esiDate}` : undefined,
      observationTimestamp: esiDate,
      retrievalTimestamp: esiSnap.retrievalTimestamp ?? retrievalTimestamp,
      quality: {
        status: esiCheck.status,
        qualityFlag: esiSnap.cloudMaskFlag,
        missingValueIndicator: -9999,
        notes: esiCheck.note ?? 'Validated clear-sky Evaporative Stress Index',
      },
      staleness: {
        isStale: isEsiStale,
        ageDays: esiAgeDays,
      },
    });
    recordParamState('esiRatio', esiCheck.status, isEsiStale);

    // 6. NASA Landsat/HLS Vegetation Indices (NDVI, NDWI)
    const rawNdvi = existing.ndvi ?? ndviSnap.value;
    const ndviCheck = validateNumericObservation(rawNdvi, -1, 1, 3, 'Normalized Difference Vegetation Index (NDVI)');
    const ndviDate = existing.ndvi !== undefined && existing.ndvi !== null
      ? undefined
      : (ndviSnap.observationTimestamp ?? undefined);
    const ndviAgeDays = ndviDate ? (ndviSnap.ageDays ?? computeAgeDays(ndviDate)) : undefined;
    const isNdviStale = Boolean(ndviSnap.isStale || (ndviAgeDays !== undefined && ndviAgeDays > 45));

    observations.push({
      parameterId: 'ndvi',
      parameterName: 'Normalized Difference Vegetation Index (HLS L30/S30)',
      value: ndviCheck.value,
      unit: 'Index Ratio (-1 to 1)',
      sourceProvider: 'NASA Landsat/HLS',
      datasetId: ndviSnap.productId ?? 'HLSL30_HLSS30_002',
      datasetVersion: 'Harmonized Landsat Sentinel-2 v002',
      spatialResolution: { value: 30, unit: 'm', label: '30 m × 30 m surface reflectance grid' },
      isRepresentative:
        ndviCheck.value !== null &&
        (ndviSnap.coveragePercent === null || ndviSnap.coveragePercent >= 50),
      representativenessNote:
        ndviSnap.coveragePercent !== null && ndviSnap.coveragePercent < 50
          ? `HLS 30m NDVI with partial parcel coverage (${ndviSnap.coveragePercent.toFixed(1)}%).`
          : 'HLS 30m vegetation index for crop canopy greenness and vigor.',
      observationPeriod: ndviDate ? `Acquisition date ${ndviDate}` : undefined,
      observationTimestamp: ndviDate,
      retrievalTimestamp: ndviSnap.retrievalTimestamp ?? retrievalTimestamp,
      quality: {
        status: ndviCheck.status,
        qualityFlag: ndviSnap.cloudMaskFlag,
        missingValueIndicator: -9999,
        notes: ndviCheck.note ?? 'Validated clear-sky HLS NDVI vegetation index',
      },
      staleness: {
        isStale: isNdviStale,
        ageDays: ndviAgeDays,
      },
    });
    recordParamState('ndvi', ndviCheck.status, isNdviStale);

    // NDWI (tracked with its own acquisition timestamp & quality flag)
    const rawNdwi = existing.ndwi ?? ndwiSnap.value;
    const ndwiCheck = validateNumericObservation(rawNdwi, -1, 1, 3, 'Normalized Difference Water Index (NDWI)');
    const ndwiDate = existing.ndwi !== undefined && existing.ndwi !== null
      ? undefined
      : (ndwiSnap.observationTimestamp ?? undefined);
    const ndwiAgeDays = ndwiDate ? (ndwiSnap.ageDays ?? computeAgeDays(ndwiDate)) : undefined;
    const isNdwiStale = Boolean(ndwiSnap.isStale || (ndwiAgeDays !== undefined && ndwiAgeDays > 45));

    observations.push({
      parameterId: 'ndwi',
      parameterName: 'Normalized Difference Water Index (HLS L30/S30)',
      value: ndwiCheck.value,
      unit: 'Index Ratio (-1 to 1)',
      sourceProvider: 'NASA Landsat/HLS',
      datasetId: ndwiSnap.productId ?? 'HLSL30_HLSS30_002',
      datasetVersion: 'Harmonized Landsat Sentinel-2 v002',
      spatialResolution: { value: 30, unit: 'm', label: '30 m × 30 m surface reflectance grid' },
      isRepresentative:
        ndwiCheck.value !== null &&
        (ndwiSnap.coveragePercent === null || ndwiSnap.coveragePercent >= 50),
      representativenessNote:
        ndwiSnap.coveragePercent !== null && ndwiSnap.coveragePercent < 50
          ? `HLS 30m NDWI with partial parcel coverage (${ndwiSnap.coveragePercent.toFixed(1)}%).`
          : 'HLS 30m water index for canopy hydration and surface moisture assessment.',
      observationPeriod: ndwiDate ? `Acquisition date ${ndwiDate}` : undefined,
      observationTimestamp: ndwiDate,
      retrievalTimestamp: ndwiSnap.retrievalTimestamp ?? retrievalTimestamp,
      quality: {
        status: ndwiCheck.status,
        qualityFlag: ndwiSnap.cloudMaskFlag,
        missingValueIndicator: -9999,
        notes: ndwiCheck.note ?? 'Validated clear-sky HLS NDWI water index',
      },
      staleness: {
        isStale: isNdwiStale,
        ageDays: ndwiAgeDays,
      },
    });
    recordParamState('ndwi', ndwiCheck.status, isNdwiStale);

    const ecoDate = etDate ?? esiDate;
    const isEcoStale = isEtStale || isEsiStale;
    const hlsDate = ndviDate ?? ndwiDate;
    const isHlsStale = isNdviStale || isNdwiStale;

    // Compile validated normalized features for deterministic scoring engines (missing remains null)
    const features: CropEnvironmentalInputs = {
      ...existing,
      targetSeason: options.targetSeason ?? existing.targetSeason,
      temperatureMeanC: validT2M,
      temperatureMaxC: validTMax,
      temperatureMinC: validTMin,
      seasonalRainfallMm:
        existing.seasonalRainfallMm !== undefined && existing.seasonalRainfallMm !== null
          ? validPrecip
          : undefined,
      observedRainfallMm: validPrecip,
      observationDays:
        existing.observationDays ?? weather?.summary?.availableDays ?? null,
      annualRainfallMm: validAnnualPrecip,
      gpmPrecipitationRateMmHr: validGpmRate,
      relativeHumidityPercent: validRh,
      solarRadiationMjM2Day: validSol,
      windSpeedMs: validWind,
      soilMoistureM3M3: validSmapRoot ?? validSmapSurface,
      soilMoistureSurfaceM3M3: validSmapSurface,
      soilMoistureRootZoneM3M3: validSmapRoot,
      soilPh: finalPh,
      ...(phSource !== 'unavailable' ? { soilPhSource: phSource } : {}),
      soilTexture: finalTexture,
      ...(textureSource !== 'unavailable' ? { soilTextureSource: textureSource } : {}),
      organicCarbonGKg: finalSoc,
      ...(socSource !== 'unavailable' ? { organicCarbonSource: socSource } : {}),
      etDailyWm2: etCheck.value,
      esiRatio: esiCheck.value,
      ndvi: ndviCheck.value,
      ndwi: ndwiCheck.value,
    };

    const coarseResolutionCaveats: string[] = [
      'NASA POWER (~55 km grid) provides regional macro-climatic averages; micro-climatic variations across individual farm parcels are not resolved.',
      'NASA GPM IMERG (~11 km grid) provides satellite-derived precipitation rates (mm/hr); it is not interchangeable with cumulative seasonal rainfall or rain-gauge measurements.',
      'NASA SMAP (9 km EASE-Grid) estimates volumetric soil moisture (m³/m³) only; it does not resolve sub-field drainage and does not measure soil chemistry (N, P, K, pH, SOC).',
      'ISRIC SoilGrids (~250 m grid) provides modelled spatial predictions rather than point field measurements; verified laboratory soil tests are recommended for field calibration.',
      'NASA ECOSTRESS (70 m thermal grid) provides high-resolution daily evapotranspiration and evaporative stress index observations; cloud-masked or missing observations fallback gracefully without zero coercion.',
      'NASA HLS (30 m surface reflectance grid) provides high-resolution NDVI and NDWI vegetation indices filtered for cloud, shadow, and snow via Fmask QA.',
      'All NASA POWER, GPM IMERG, SMAP, ECOSTRESS, and HLS records represent historical or near-real-time observations, NOT future weather forecasts.',
    ];

    const dataSources: FarmEnvironmentalDataSourceSummary[] = [
      {
        id: 'nasa-power',
        name: 'NASA POWER Daily Weather',
        dataset: 'T2M, T2M_MAX, T2M_MIN, PRECTOTCORR, RH2M, ALLSKY_SFC_SW_DWN, WS2M',
        spatialResolution: '0.5° × 0.5° (~55 km)',
        role: 'Historical thermal regime, cumulative rainfall, humidity, solar radiation, and wind speed',
        isFresh: !isWeatherStale,
        cached: weather?.sourceAttributions?.some((s) => s.cached),
        limitations:
          'Coarse ~55 km regional atmospheric assimilation; does not capture field-level microclimate or serve as a future forecast.',
      },
      {
        id: 'nasa-gpm-imerg',
        name: 'NASA GPM IMERG Precipitation',
        dataset: 'GPM_3IMERGDF Late Run',
        spatialResolution: '0.1° × 0.1° (~11 km)',
        role: 'Satellite-derived near-real-time precipitation rate (mm/hr)',
        isFresh: !isGpmStale,
        limitations:
          '~11 km satellite footprint snapshot; distinct from seasonal rainfall totals and rain-gauge measurements.',
      },
      {
        id: 'nasa-smap',
        name: 'NASA SMAP Soil Moisture',
        dataset: 'SPL3SMP_E V006 (0–5 cm Surface) & SPL4SMGP V007 (0–100 cm Root Zone)',
        spatialResolution: '9 km × 9 km (EASE-Grid 2.0)',
        role: 'Volumetric soil moisture status (m³/m³)',
        isFresh: !isSmapStale,
        limitations:
          'Coarse 9 km grid volumetric water content only; does not resolve field irrigation heterogeneity or soil chemistry.',
      },
      {
        id: 'nasa-ecostress',
        name: 'NASA ECOSTRESS Evapotranspiration',
        dataset: 'ECO_L3T_JET (Daily ET) & ECO_L4T_ESI (Evaporative Stress Index)',
        spatialResolution: '70 m × 70 m thermal grid',
        role: 'High-resolution evapotranspiration and plant water stress monitoring',
        isFresh: !isEcoStale,
        limitations: 'Clear-sky thermal observations; cloud/water masked pixels excluded.',
        observationDate: ecoDate,
        productIdentifier: etSnap.productId ?? esiSnap.productId ?? 'ECO_L3T_JET.002',
        coveragePercent:
          etSnap.coveragePercent ??
          esiSnap.coveragePercent ??
          phase4Analytics.qualityReport.ecostress.meanCoveragePercent ??
          null,
        validPixelCount: etSnap.validPixelCount ?? esiSnap.validPixelCount ?? null,
      },
      {
        id: 'nasa-hls',
        name: 'NASA Harmonized Landsat Sentinel-2 (HLS)',
        dataset: 'HLSL30 & HLSS30 Surface Reflectance (NDVI, NDWI)',
        spatialResolution: '30 m × 30 m surface reflectance grid',
        role: 'High-resolution vegetation greenness (NDVI) and canopy water index (NDWI)',
        isFresh: !isHlsStale,
        limitations: 'Cloud/shadow/snow filtered via Fmask QA; optical observations require clear skies.',
        observationDate: hlsDate,
        productIdentifier: ndviSnap.productId ?? ndwiSnap.productId ?? 'HLSL30.002',
        coveragePercent:
          ndviSnap.coveragePercent ??
          ndwiSnap.coveragePercent ??
          phase4Analytics.qualityReport.hls.meanCoveragePercent ??
          null,
        validPixelCount: ndviSnap.validPixelCount ?? ndwiSnap.validPixelCount ?? null,
      },
      {
        id: phSource === 'measured_lab' ? 'farm-lab-test' : 'isric-soilgrids',
        name:
          phSource === 'measured_lab'
            ? 'Verified Laboratory Soil Test'
            : 'ISRIC SoilGrids REST v2.0',
        dataset:
          phSource === 'measured_lab'
            ? 'Point Field Laboratory Soil Analysis'
            : 'ISRIC SoilGrids 2020 (pH, USDA Texture, SOC)',
        spatialResolution:
          phSource === 'measured_lab' ? 'Point field sample' : '250 m × 250 m digital soil map',
        role: 'Topsoil chemical and physical characteristics (pH, texture, organic carbon)',
        isFresh: !phStale,
        limitations:
          phSource === 'measured_lab'
            ? 'Point-sampled laboratory chemistry; valid for sampled depth and horizon.'
            : 'Modelled 250 m spatial estimate (Q0.05–Q0.95); verify with local laboratory soil testing.',
      },
    ];

    const validCount = observations.filter(
      (o) => o.quality.status === 'nominal' || o.quality.status === 'estimated' || o.quality.status === 'interpolated',
    ).length;
    const representativeCount = observations.filter((o) => o.isRepresentative).length;

    return {
      location: targetLocation,
      boundaryContext: normalizedBoundary,
      spatialProcessing: spatial.spatialProcessing,
      dateRange,
      retrievedAt: retrievalTimestamp,
      growingPeriodContext: {
        targetSeason: options.targetSeason ?? existing.targetSeason,
        dateRange,
        classification: 'observed_historical',
        note: `Observed historical window (${dateRange.startDate} to ${dateRange.endDate}) assembled for ${options.targetSeason ?? existing.targetSeason ?? 'selected farm'} evaluation.`,
      },
      features,
      observations,
      missingParameters,
      staleParameters,
      invalidParameters,
      validationSummary: {
        validCount,
        missingCount: missingParameters.length,
        staleCount: staleParameters.length,
        invalidCount: invalidParameters.length,
        representativeCount,
      },
      coarseResolutionCaveats,
      providerWarnings,
      gpmImergObservation: gpm,
      ecostressPayload,
      hlsPayload,
      qualityAssessment: phase4Analytics.qualityReport,
      environmentalAnalytics: phase4Analytics,
      dataSources,
    };
  }
}
