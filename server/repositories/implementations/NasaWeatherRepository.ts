import type {
  ClimateTrendSummary,
  ClimateTrendsQuery,
  DailyWeatherObservation,
  DateRange,
  MonthlyWeatherSummary,
  NasaDatasetId,
  TemperatureTrendAnalysis,
  WeatherTelemetryRequest,
  WeatherTelemetrySnapshot,
} from '../../../shared/index.ts';
import { env } from '../../config/env.ts';
import { ExternalServiceError } from '../../errors/AppError.ts';
import type { ISatelliteRainfallProvider } from '../../providers/ISatelliteRainfallProvider.ts';
import { fetchJsonWithRetry, type FetchLike } from '../../utils/resilientHttp.ts';
import { resolveSpatialRequestContext } from '../../utils/spatialRequest.ts';
import { TtlCache } from '../../utils/ttlCache.ts';
import type { IWeatherRepository } from '../interfaces/index.ts';

interface NasaPowerApiResponse {
  header?: {
    title?: string;
    fill_value?: number;
    start?: string;
    end?: string;
    sources?: string[];
  };
  parameters?: Record<
    string,
    {
      units?: string;
      longname?: string;
    }
  >;
  properties?: {
    parameter?: Record<string, Record<string, number>>;
  };
}

export interface NasaWeatherRepositoryOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
  timeoutMs?: number;
  cacheTtlMs?: number;
  gpmProvider?: ISatelliteRainfallProvider;
}

const DAILY_PARAMETERS = [
  'T2M',
  'T2M_MAX',
  'T2M_MIN',
  'PRECTOTCORR',
  'ALLSKY_SFC_SW_DWN',
  'RH2M',
  'WS2M',
] as const;

const FORECAST_DISCLAIMER =
  'Historical & near-real-time satellite/reanalysis observations only. Forecasts are not manufactured from historical observations.';

function formatYyyymmdd(isoDate: string): string {
  return isoDate.replaceAll('-', '');
}

function toIsoDate(yyyymmdd: string): string {
  if (/^\d{8}$/.test(yyyymmdd)) {
    return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
  }
  return yyyymmdd;
}

function defaultDateRange(): DateRange {
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

function cleanValue(raw: number | undefined, fillValue: number): number | null {
  if (raw === undefined || !Number.isFinite(raw) || raw === fillValue || raw <= -900) {
    return null;
  }
  return Number(raw.toFixed(2));
}

function average(values: Array<number | null>): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) {
    return null;
  }
  return Number((valid.reduce((sum, v) => sum + v, 0) / valid.length).toFixed(2));
}

function computeTemperatureTrend(dailySeries: DailyWeatherObservation[]): TemperatureTrendAnalysis {
  const points = dailySeries
    .map((d, idx) => ({ x: idx, y: d.temperatureMeanC }))
    .filter((pt): pt is { x: number; y: number } => pt.y !== null);

  if (points.length < 3) {
    return {
      slopeCPerDay: null,
      totalChangeC: null,
      direction: 'insufficient_data',
      firstHalfMeanC: null,
      secondHalfMeanC: null,
      sampleCount: points.length,
    };
  }

  const n = points.length;
  const meanX = points.reduce((s, p) => s + p.x, 0) / n;
  const meanY = points.reduce((s, p) => s + p.y, 0) / n;

  let num = 0;
  let den = 0;
  for (const pt of points) {
    const dx = pt.x - meanX;
    num += dx * (pt.y - meanY);
    den += dx * dx;
  }

  const slope = den === 0 ? 0 : num / den;
  const spanDays = points[n - 1].x - points[0].x;
  const totalChange = slope * spanDays;

  const mid = Math.floor(n / 2);
  const firstHalfMeanC = average(points.slice(0, mid).map((p) => p.y));
  const secondHalfMeanC = average(points.slice(mid).map((p) => p.y));

  let direction: TemperatureTrendAnalysis['direction'] = 'stable';
  if (totalChange >= 0.3) {
    direction = 'warming';
  } else if (totalChange <= -0.3) {
    direction = 'cooling';
  }

  return {
    slopeCPerDay: Number(slope.toFixed(4)),
    totalChangeC: Number(totalChange.toFixed(2)),
    direction,
    firstHalfMeanC,
    secondHalfMeanC,
    sampleCount: n,
  };
}

function buildMonthlySummaries(dailySeries: DailyWeatherObservation[]): MonthlyWeatherSummary[] {
  const buckets = new Map<string, DailyWeatherObservation[]>();
  for (const day of dailySeries) {
    const month = day.date.slice(0, 7);
    const list = buckets.get(month);
    if (list) {
      list.push(day);
    } else {
      buckets.set(month, [day]);
    }
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, days]) => {
      const maxVals = days.map((d) => d.temperatureMaxC).filter((v): v is number => v !== null);
      const minVals = days.map((d) => d.temperatureMinC).filter((v): v is number => v !== null);
      const totalPrecip = days.reduce((sum, d) => sum + (d.precipitationMmDay ?? 0), 0);

      return {
        month,
        observationDays: days.filter((d) => d.temperatureMeanC !== null || d.precipitationMmDay !== null).length,
        temperatureMeanC: average(days.map((d) => d.temperatureMeanC)),
        temperatureMaxC: maxVals.length > 0 ? Number(Math.max(...maxVals).toFixed(2)) : null,
        temperatureMinC: minVals.length > 0 ? Number(Math.min(...minVals).toFixed(2)) : null,
        totalPrecipitationMm: Number(totalPrecip.toFixed(2)),
        meanSolarRadiationMjM2Day: average(days.map((d) => d.solarRadiationMjM2Day)),
        meanRelativeHumidityPercent: average(days.map((d) => d.relativeHumidityPercent)),
        meanWindSpeedMs: average(days.map((d) => d.windSpeedMs)),
      };
    });
}

export class NasaWeatherRepository implements IWeatherRepository {
  private readonly baseUrl: string;
  private readonly fetchFn?: FetchLike;
  private readonly timeoutMs: number;
  private readonly gpmProvider?: ISatelliteRainfallProvider;
  private readonly dailyCache: TtlCache<WeatherTelemetrySnapshot>;
  private readonly trendsCache: TtlCache<ClimateTrendSummary>;

  constructor(options: NasaWeatherRepositoryOptions = {}) {
    this.baseUrl = (options.baseUrl ?? env.nasaPowerBaseUrl).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn;
    this.timeoutMs = options.timeoutMs ?? env.weatherHttpTimeoutMs;
    this.gpmProvider = options.gpmProvider;
    const ttl = options.cacheTtlMs ?? env.weatherCacheTtlMs;
    this.dailyCache = new TtlCache<WeatherTelemetrySnapshot>(ttl, 150);
    this.trendsCache = new TtlCache<ClimateTrendSummary>(ttl, 100);
  }

  async fetchWeatherTelemetry(request: WeatherTelemetryRequest): Promise<WeatherTelemetrySnapshot> {
    const spatial = resolveSpatialRequestContext(
      request,
      'NASA POWER & GPM IMERG weather lookup',
    );
    const targetCoords = spatial.targetLocation;
    const dateRange = request.dateRange ?? defaultDateRange();
    const includeGpm = request.includeGpmImerg ?? true;

    const cacheKey = `${targetCoords.latitude.toFixed(3)},${targetCoords.longitude.toFixed(3)}:${dateRange.startDate}:${dateRange.endDate}:${includeGpm}`;
    const cached = this.dailyCache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        boundaryContext: spatial.boundaryContext,
        spatialProcessing: spatial.spatialProcessing,
        sourceAttributions: cached.sourceAttributions.map((s) => ({ ...s, cached: true })),
      };
    }

    const url = new URL(`${this.baseUrl}/temporal/daily/point`);
    url.searchParams.set('parameters', DAILY_PARAMETERS.join(','));
    url.searchParams.set('community', 'AG');
    url.searchParams.set('longitude', String(targetCoords.longitude));
    url.searchParams.set('latitude', String(targetCoords.latitude));
    url.searchParams.set('start', formatYyyymmdd(dateRange.startDate));
    url.searchParams.set('end', formatYyyymmdd(dateRange.endDate));
    url.searchParams.set('format', 'JSON');

    const [powerResponse, gpmImerg] = await Promise.all([
      fetchJsonWithRetry<NasaPowerApiResponse>(url.toString(), {
        fetchFn: this.fetchFn,
        timeoutMs: this.timeoutMs,
        maxRetries: 2,
        serviceName: 'NASA POWER Daily API',
      }),
      includeGpm && this.gpmProvider
        ? this.gpmProvider.getPointRainfall(targetCoords, dateRange.endDate, {
            boundary: spatial.boundaryContext,
            geometry: spatial.geometry,
            bbox: spatial.bbox,
            spatialProcessingMode: request.spatialProcessingMode,
          })
        : Promise.resolve(null),
    ]);

    const params = powerResponse.properties?.parameter;
    if (!params || !params.T2M) {
      throw new ExternalServiceError('NASA POWER Daily API returned an unexpected payload structure.');
    }

    const fillValue = powerResponse.header?.fill_value ?? -999;
    const dateKeys = Object.keys(params.T2M).sort();

    let cumulativeRain = 0;
    const dailySeries: DailyWeatherObservation[] = dateKeys.map((rawDate) => {
      const precip = cleanValue(params.PRECTOTCORR?.[rawDate], fillValue);
      if (precip !== null) {
        cumulativeRain = Number((cumulativeRain + precip).toFixed(2));
      }

      return {
        date: toIsoDate(rawDate),
        temperatureMeanC: cleanValue(params.T2M?.[rawDate], fillValue),
        temperatureMaxC: cleanValue(params.T2M_MAX?.[rawDate], fillValue),
        temperatureMinC: cleanValue(params.T2M_MIN?.[rawDate], fillValue),
        precipitationMmDay: precip,
        cumulativePrecipitationMm: cumulativeRain,
        solarRadiationMjM2Day: cleanValue(params.ALLSKY_SFC_SW_DWN?.[rawDate], fillValue),
        relativeHumidityPercent: cleanValue(params.RH2M?.[rawDate], fillValue),
        windSpeedMs: cleanValue(params.WS2M?.[rawDate], fillValue),
      };
    });

    const availableDays = dailySeries.filter(
      (d) => d.temperatureMeanC !== null || d.precipitationMmDay !== null,
    ).length;
    const maxVals = dailySeries.map((d) => d.temperatureMaxC).filter((v): v is number => v !== null);
    const minVals = dailySeries.map((d) => d.temperatureMinC).filter((v): v is number => v !== null);

    const retrievedAt = new Date().toISOString();
    const sources: NasaDatasetId[] = ['POWER'];
    const sourceAttributions = [
      {
        id: 'nasa-power',
        name: 'NASA POWER Daily Agroclimatology API',
        attribution: 'NASA Langley Research Center (LaRC) POWER Project (AG Community)',
        url: 'https://power.larc.nasa.gov/',
        cached: false,
        retrievedAt,
      },
    ];

    if (gpmImerg) {
      sources.push('GPM');
      sourceAttributions.push({
        id: 'nasa-gpm-imerg',
        name: gpmImerg.product,
        attribution: gpmImerg.provider,
        url: 'https://gpm.nasa.gov/data/imerg',
        cached: false,
        retrievedAt,
      });
    }

    const result: WeatherTelemetrySnapshot = {
      location: targetCoords,
      boundaryContext: spatial.boundaryContext,
      spatialProcessing: spatial.spatialProcessing,
      dateRange,
      dataClassification: 'observed_historical',
      forecastDisclaimer: FORECAST_DISCLAIMER,
      units: {
        temperature: '°C',
        precipitation: 'mm/day',
        cumulativePrecipitation: 'mm',
        solarRadiation: 'MJ/m²/day',
        relativeHumidity: '%',
        windSpeed: 'm/s',
        gpmRate: 'mm/hr',
      },
      summary: {
        totalDays: dailySeries.length,
        availableDays,
        missingDays: dailySeries.length - availableDays,
        meanTempC: average(dailySeries.map((d) => d.temperatureMeanC)),
        maxTempC: maxVals.length > 0 ? Number(Math.max(...maxVals).toFixed(2)) : null,
        minTempC: minVals.length > 0 ? Number(Math.min(...minVals).toFixed(2)) : null,
        totalPrecipitationMm: cumulativeRain,
        meanSolarRadiationMjM2Day: average(dailySeries.map((d) => d.solarRadiationMjM2Day)),
        meanRelativeHumidityPercent: average(dailySeries.map((d) => d.relativeHumidityPercent)),
        meanWindSpeedMs: average(dailySeries.map((d) => d.windSpeedMs)),
      },
      temperatureTrend: computeTemperatureTrend(dailySeries),
      dailySeries,
      monthlySummaries: buildMonthlySummaries(dailySeries),
      gpmImerg,
      sourceAttributions,
      sources,
      retrievedAt,
    };

    this.dailyCache.set(cacheKey, result);
    return result;
  }

  async fetchClimateTrends(query: ClimateTrendsQuery): Promise<ClimateTrendSummary> {
    const years = query.years ?? 5;
    const endYear = new Date().getUTCFullYear() - 1;
    const startYear = Math.max(1981, endYear - years + 1);

    const cacheKey = `${query.latitude.toFixed(3)},${query.longitude.toFixed(3)}:${startYear}-${endYear}`;
    const cached = this.trendsCache.get(cacheKey);
    if (cached) {
      return {
        ...cached,
        sourceAttributions: cached.sourceAttributions.map((s) => ({ ...s, cached: true })),
      };
    }

    const url = new URL(`${this.baseUrl}/temporal/monthly/point`);
    url.searchParams.set('parameters', 'T2M,PRECTOTCORR');
    url.searchParams.set('community', 'AG');
    url.searchParams.set('longitude', String(query.longitude));
    url.searchParams.set('latitude', String(query.latitude));
    url.searchParams.set('start', String(startYear));
    url.searchParams.set('end', String(endYear));
    url.searchParams.set('format', 'JSON');

    const response = await fetchJsonWithRetry<NasaPowerApiResponse>(url.toString(), {
      fetchFn: this.fetchFn,
      timeoutMs: this.timeoutMs,
      maxRetries: 2,
      serviceName: 'NASA POWER Monthly API',
    });

    const params = response.properties?.parameter;
    if (!params || !params.T2M) {
      throw new ExternalServiceError('NASA POWER Monthly API returned an unexpected payload.');
    }

    const fillValue = response.header?.fill_value ?? -999;
    const yearlySummaries: ClimateTrendSummary['yearlySummaries'] = [];

    for (let y = startYear; y <= endYear; y++) {
      const annualKey = `${y}13`;
      const meanTempC = cleanValue(params.T2M?.[annualKey], fillValue);
      const precipRate = cleanValue(params.PRECTOTCORR?.[annualKey], fillValue);
      const daysInYear = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365;
      const totalPrecipitationMm =
        precipRate !== null ? Number((precipRate * daysInYear).toFixed(1)) : null;

      yearlySummaries.push({
        year: y,
        meanTempC,
        totalPrecipitationMm,
      });
    }

    const validTemps = yearlySummaries.filter((y) => y.meanTempC !== null);
    const validPrecips = yearlySummaries.filter((y) => y.totalPrecipitationMm !== null);

    const baselineTemp = average(validTemps.map((y) => y.meanTempC));
    const latestTemp = validTemps.at(-1)?.meanTempC ?? null;
    const temperatureAnomalyC =
      baselineTemp !== null && latestTemp !== null
        ? Number((latestTemp - baselineTemp).toFixed(2))
        : null;

    const baselinePrecip = average(validPrecips.map((y) => y.totalPrecipitationMm));
    const latestPrecip = validPrecips.at(-1)?.totalPrecipitationMm ?? null;
    const precipitationAnomalyPercent =
      baselinePrecip !== null && baselinePrecip > 0 && latestPrecip !== null
        ? Number((((latestPrecip - baselinePrecip) / baselinePrecip) * 100).toFixed(1))
        : null;

    const firstTemp = validTemps[0]?.meanTempC ?? null;
    let heatStressDaysTrend = 'Insufficient multi-year observations';
    if (firstTemp !== null && latestTemp !== null && validTemps.length >= 2) {
      const delta = Number((latestTemp - firstTemp).toFixed(2));
      heatStressDaysTrend =
        delta > 0.2
          ? `Annual mean +${delta.toFixed(2)} °C from ${validTemps[0].year} to ${validTemps.at(-1)!.year}`
          : delta < -0.2
            ? `Annual mean ${delta.toFixed(2)} °C from ${validTemps[0].year} to ${validTemps.at(-1)!.year}`
            : `Stable annual mean (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} °C) across ${validTemps.length} years`;
    }

    const retrievedAt = new Date().toISOString();
    const result: ClimateTrendSummary = {
      location: { latitude: query.latitude, longitude: query.longitude },
      baselineYears: yearlySummaries.length,
      dataClassification: 'observed_historical',
      forecastDisclaimer: FORECAST_DISCLAIMER,
      temperatureAnomalyC,
      annualMeanTempC: baselineTemp,
      annualPrecipitationMm: baselinePrecip,
      precipitationAnomalyPercent,
      heatStressDaysTrend,
      yearlySummaries,
      sources: ['POWER'],
      sourceAttributions: [
        {
          id: 'nasa-power-monthly',
          name: 'NASA POWER Monthly & Annual Climatology API',
          attribution: 'NASA Langley Research Center (LaRC) POWER Project (AG Community)',
          url: 'https://power.larc.nasa.gov/',
          cached: false,
          retrievedAt,
        },
      ],
    };

    this.trendsCache.set(cacheKey, result);
    return result;
  }
}
