# FieldShift AI — System Architecture (Module 00)

## 1. Architectural Vision

**FieldShift AI** is a global-ready agricultural decision-support platform built for the NASA Space Apps 2026 challenge (*"Field Shift: Adapting Farms with NASA Data"*). Its architecture separates geospatial client visualization, backend API orchestration, shared domain contracts, replaceable environmental data providers, decoupled regional agricultural knowledge, and server-side AI reasoning.

Maharashtra, India (`IN-MH`) is configured as the initial demonstration geography, while all types, schemas, and regional repositories support adding new countries, climate zones, crop calendars, and agronomic rule sets without altering core application logic.

---

## 2. Layered Monorepo Architecture

```
client/src/     → React 19 UI, Leaflet maps, Recharts visualizations, typed API client
server/         → Express API, Zod validation, provider skeletons, knowledge repository, AI boundary
shared/         → Canonical TypeScript interfaces, Zod schemas, global parameter & region constants
data/           → Decoupled regional agronomic JSON (crops, calendars, soil zones, rotation rules)
tests/          → Node test suite verifying schemas, decoupled knowledge loading, and API contracts
```

### Dependency Direction

- `client/src/*` imports only from `@shared/*` and internal client modules (`client/src/*`). It never imports server code or accesses API credentials.
- `server/*` imports from `shared/*` and `data/*` (via `KnowledgeRepository`).
- `shared/*` has zero runtime dependency on `client/` or `server/`.

---

## 3. Common Environmental Observation Model

Defined in `shared/types/observation.ts` and validated by `shared/schemas/observation.schema.ts`, every meteorological, rainfall, soil moisture, and soil property record conforms to `EnvironmentalObservation<TValue>`:

- **Location & Coverage**: `GeoCoordinate` (`latitude`, `longitude`, optional elevation) + `SpatialCoverage` supporting `point`, `bbox`, `region`, and GeoJSON `Polygon` / `MultiPolygon` (`EPSG:4326`).
- **Parameter & Value**: Canonical parameter key (e.g., `precipitation_total`, `soil_moisture_root_zone`, `soil_ph`), numeric or nullable value, and canonical SI/agronomic unit (`mm/day`, `m3/m3`, `degC`, `g/kg`).
- **Temporal Provenance**: `observationTimestamp`, `retrievalTimestamp`, and `temporalAggregation`.
- **Source & Resolution**: `DataProvenance` (provider ID, dataset name/version, endpoint, license) and `SpatialResolution`.
- **Quality**: `ObservationQuality` (`measured`, `derived`, `interpolated`, `provisional`, `missing`, `invalid`, plus optional confidence/uncertainty).

This guarantees downstream agronomic scoring and Gemini reasoning operate on a uniform, provenance-preserving observation stream without fabricated values.

---

## 4. Independent & Replaceable Provider Interfaces

Defined in `shared/types/providers.ts` and implemented as modular skeletons under `server/providers/`, `server/agriculture/`, and `server/ai/`:

| Interface | Current Adapter | Target Data Source | Planned Activation |
| --- | --- | --- | --- |
| `NasaWeatherProvider` | `NasaPowerWeatherProvider` | NASA POWER Agroclimatology | Module 01 |
| `NasaRainfallProvider` | `NasaGpmRainfallProvider` | NASA GPM IMERG | Module 01 |
| `NasaSoilMoistureProvider` | `NasaSmapSoilMoistureProvider` | NASA SMAP L3/L4 | Module 02 |
| `SatelliteImageryProvider` | `NasaGibsImageryProvider` | NASA GIBS WMTS | Module 02 |
| `SoilCharacteristicsProvider` | `IsricSoilGridsProvider` | ISRIC SoilGrids v2.0 | Module 02 |
| `AgriculturalKnowledgeProvider` | `FileBasedAgriculturalKnowledgeProvider` | Decoupled JSON (`data/`) | Active (Baseline) |
| `AiAdvisoryProvider` | `GeminiAdvisoryProvider` | Google GenAI (`@google/genai`) | Module 04 |

Any provider can be swapped (e.g., replacing ISRIC SoilGrids with a national soil survey API or switching local JSON files to a database-backed repository) without modifying controllers, scoring logic, or frontend components.

---

## 5. Multi-Region Extensibility

Country- and region-specific knowledge lives exclusively in `data/` and `shared/constants/regions.ts`:

- `data/crops/` — crop physiology, temperature/pH bounds, drought/heat/waterlogging tolerances.
- `data/crop-calendars/` — seasonal sowing/harvesting windows per agro-climatic zone.
- `data/soil/` — reference soil taxonomy zones for regional context.
- `data/rotation-rules/` — nitrogen replenishment, pest-break, and residual moisture rules.

Adding another region (e.g., East Africa, US Midwest, or Brazil Cerrado) requires registering its `RegionDescriptor` and dataset mapping without touching core services or UI code.

---

## 6. Runtime & Security Architecture

- **Server Entry (`server.ts`)**: Express runs on `0.0.0.0:3000`. In development (`NODE_ENV !== 'production'`), Vite runs in middleware mode; in production, Express serves compiled static assets from `dist/`.
- **Credential Isolation**: `GEMINI_API_KEY` and `NASA_EARTHDATA_TOKEN` are validated and read strictly inside `server/utils/env.ts` and are never exposed in API payloads or bundled into the client.
- **Validation & Error Handling**: Incoming API parameters are validated via Zod middleware (`server/middleware/validate.ts`), with centralized error formatting (`server/middleware/errorHandler.ts`) returning standardized `ApiResponse<T>` envelopes with `x-request-id` correlation.

---

## 7. Completed Roadmap (Phases 0–5 & Modules 00–09)

- **Modules 00–09 & Phases 0–3E**: Geospatial polygon/BBox pipeline, live NASA POWER & GPM IMERG telemetry, NASA SMAP L4 & ISRIC SoilGrids v2.0 (+ local Lab Soil calibration), NASA GIBS WMTS overlays, NASA AppEEARS async ECOSTRESS ET/ESI (70 m) & Landsat/HLS NDVI/NDWI (30 m), decoupled ICAR/KVK crop knowledge base, deterministic crop suitability & multi-season rotation planner, grounded Gemini AI assistant (EN/HI), and full React environmental intelligence dashboard.
- **Phase 4 — Environmental Intelligence Validation & Advanced Analytics (`/api/v1/environmental/analyze`)**:
  - `server/analytics/EnvironmentalQualityValidator.ts` (4A): Preserves genuine zero measurements, rejects fill values (`-999`/`-9999`) & out-of-bounds pixels, flags inverted/future timestamps & missing QA bitmasks.
  - `server/analytics/MultiTemporalAnalyzer.ts` (4B): Strictly enforces $\ge 3$ usable scenes across $\ge 7$ days before fitting OLS slopes, detects $>14\text{d}$ sampling gaps, never treats cross-mission timestamps as simultaneous.
  - `server/analytics/StressDetectionEngine.ts` (4C) & `EnvironmentalConfidenceEngine.ts` (4D) & `EnvironmentalMonitoringService.ts` (4E): Explainable thermal/vegetation stress screening with deduplicated alerts and masked-scene suppression.
- **Phase 5 — Farm-Level Predictive & Actionable Intelligence (`/api/v1/farm-intelligence/summary`)**:
  - `server/intelligence/FarmLevelIntelligenceService.ts` (5A): Polygon-scoped synthesis combining 30 m/70 m satellite telemetry with ~9 km SMAP & ~50 km POWER scale notes and overall parcel posture without altering deterministic Crop/Rotation scoring.
  - `server/intelligence/PredictiveInsightsEngine.ts` (5B): Bounded 7–14 day linear trend projections with widening uncertainty bands when fresh history requirements ($\ge 3$ scenes, $\ge 7\text{d}$, non-stale) are met; never presented as weather forecasts or yield predictions.
  - `server/intelligence/ActionRecommendationEngine.ts` (5C): Evidence-linked verification actions referencing specific metrics/dates while prohibiting exact irrigation volumes (mm/liters), pump automation commands, chemical dosages, or disease diagnoses.
  - Epistemic separation enforced end-to-end across REST responses, SVG trend charts, and `AiAssistantService` context grounding.

