<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# FieldShift AI — Agricultural Environmental Intelligence & Decision-Support Platform

FieldShift AI is a production-grade agricultural decision-support platform designed for the NASA Space Apps Challenge (*"Field Shift: Adapting Farms with NASA Data"*). It connects multi-mission NASA Earth observations, ISRIC SoilGrids pedometric data, user laboratory soil calibration, deterministic agronomic engines, multi-temporal trend validation, and a grounded Gemini AI agricultural assistant operating in English and Hindi.

---

## 1. Project Overview

### 1.1 Problem Statement
Smallholder and commercial farmers face accelerating climate volatility, localized droughts, shifting monsoon windows, and soil degradation. While petabytes of high-value Earth observation data are freely available from NASA and international agencies (ECOSTRESS, Landsat, Sentinel, SMAP, GPM, and POWER), agricultural decision-makers face steep hurdles:
- **Spatial Resolution Mismatches**: Regional climate grids (~50 km) cannot represent field-scale crop stress (~30–70 m), leading to misleading recommendations if point sensors are naively substituted for parcel boundaries.
- **Sensor Temporal Asynchrony**: Satellite constellations orbit independently; thermal infrared (ECOSTRESS on the ISS) and multispectral optical (Landsat/Sentinel) data arrive on different days and at different overpass times.
- **Epistemic Confusion**: Unverified AI chatbots frequently hallucinate weather forecasts, fabricate soil nutrient levels, or emit dangerous automated pump and chemical dosage prescriptions.

### 1.2 The FieldShift AI Solution
FieldShift AI solves this by:
1. **Precise Spatial Plumbing**: Enforces valid RFC 7946 closed GeoJSON polygon parcel boundaries with geodesic area calculations while strictly refusing silent centroid substitution for coarse regional providers.
2. **Multi-Mission Sensor Fusion**: Ingests NASA ECOSTRESS 70 m thermal evapotranspiration (`ECO_L3T_JET.002`) and evaporative stress index (`ECO_L4T_ESI.002`), NASA/USGS Landsat 8/9 & Sentinel-2 HLS 30 m surface reflectance (`HLSL30.002`/`HLSS30.002`), NASA SMAP L4 root-zone soil moisture, NASA GPM IMERG rainfall rates, and NASA POWER agroclimatology.
3. **Deterministic Crop Suitability & Multi-Season Rotation Planning**: Evaluates regional ICAR/KVK crop rules, water requirements, and soil constraints with mathematical stability (scores are 100% invariant to observational noise).
4. **Phase 4 & 5 Validated Analytics & Bounded Trend Projections**: Conducts rigorous pixel coverage and QA mask filtering, multi-temporal linear regression (rate of change per week), and outputs 7-day and 14-day trend projections with widening uncertainty envelopes $[L, U]$—strictly disclaimed as historical trajectory extrapolations, never weather forecasts or yield guarantees.
5. **Actionable In-Field Verification & Guardrails**: Translates satellite signals into farmer ground-truthing steps while prohibiting exact irrigation volumes ($\text{mm}/\text{L}$), pump automation, and plant disease claims.
6. **Bilingual Grounded Gemini AI**: Powers an agronomist assistant in English and Hindi (Devanagari script) with prompt-injection defense, 3-tier evidence separation, and KVK consultation advisories.

---

## 2. System Architecture

```
                                      ┌─────────────────────────────────────────────────────────┐
                                      │              Client Layer (React 19 + Vite 8)           │
                                      │  Mapbox/Leaflet Viewport · Boundary Tools · Recharts    │
                                      │  Crop Advisory · Rotation Planner · Gemini Assistant    │
                                      └────────────────────────────┬────────────────────────────┘
                                                                   │ HTTP / JSON
                                                                   ▼
                                      ┌─────────────────────────────────────────────────────────┐
                                      │             Express 4.21 API Gateway / Routes           │
                                      │   /location · /weather · /soil · /crops · /rotation     │
                                      │   /evapotranspiration · /vegetation · /environmental    │
                                      │   /farm-intelligence · /ai/ask (Zod Schema Validation)  │
                                      └──────┬─────────────────────┬────────────────────┬───────┘
                                             │                     │                    │
              ┌──────────────────────────────┴───────┐             │                    └─────────────────────────────┐
              ▼                                      ▼             ▼                                                  ▼
┌───────────────────────────┐         ┌──────────────────────────┐  ┌────────────────────────────────┐  ┌───────────────────────────┐
│     Spatial Plumbing      │         │  Deterministic Engines   │  │   Phase 4 & 5 Intelligence     │  │   Gemini AI Assistant     │
│ - GeoJSON Polygon (RFC7946)│        │ - Crop Suitability       │  │ - Quality Validation (4A)      │  │ - 3-Tier Evidence Guard   │
│ - Geodesic Area / BBox    │         │ - Multi-Season Rotation  │  │ - Multi-Temporal OLS (4B)      │  │ - Injection Quarantine    │
│ - Centroid Resolution     │         │ - ICAR/KVK Knowledge     │  │ - Stress Screening (4C)        │  │ - Bilingual Grounding     │
│ - Refuse Silent Centroid  │         │ - Invariant 0-100 Scores │  │ - Bounded 7-14d Projections(5B)│  │   (English & हिन्दी)       │
└─────────────┬─────────────┘         └──────────────┬───────────┘  │ - Verification Actions (5C)    │  └─────────────┬─────────────┘
              │                                      │              └────────────────┬───────────────┘                │
              └──────────────────────────────────────┼───────────────────────────────┴────────────────────────────────┘
                                                     ▼
                                      ┌─────────────────────────────────────────────────────────┐
                                      │           External Earth Observation Providers          │
                                      │ - NASA AppEEARS (ECOSTRESS 70m, Landsat/HLS 30m)        │
                                      │ - NASA POWER Agroclimatology (0.5° Grid API)            │
                                      │ - NASA GPM IMERG Near-Real-Time Precipitation           │
                                      │ - NASA SMAP L4 9km Soil Moisture                        │
                                      │ - ISRIC SoilGrids v2.0 (REST & WCS Fallback)            │
                                      │ - NASA GIBS WMTS Global Satellite Tile Imagery          │
                                      └─────────────────────────────────────────────────────────┘
```

### 2.1 3-Tier Epistemic Separation Model
To prevent observational fabrication and AI hallucination, all system layers enforce strict evidence categorization:
1. **Tier 1: Direct Observations / Measurements**: Real sensor data with explicit acquisition timestamps (Lab soil tests, NASA POWER weather, NASA SMAP L4, ECOSTRESS $\text{W/m}^2$, Landsat/HLS surface reflectance).
2. **Tier 2: Modelled Estimates & Screening**: Pedometric interpolations (ISRIC SoilGrids Q0.05–Q0.95), ICAR crop suitability rankings ($0\text{--}100$), and Phase 4 stress screening.
3. **Tier 3: Trend Projections**: Bounded 7-day and 14-day linear extrapolations with expanding uncertainty envelopes ($[L, U]$) and explicit non-forecast disclaimers.

---

## 3. Technology Stack

- **Runtime & Language**: Node.js v22 (LTS), TypeScript 5.8+, ECMAScript Modules (ESM).
- **Backend Framework**: Express 4.21, Zod 3.24+ (Strict Request/Response Validation), Dotenv.
- **Frontend SPA**: React 19, Vite 8, Tailwind CSS v4, Lucide React Icons, Responsive SVG Visualizations.
- **Geospatial & Mapping**: Leaflet 1.9, React-Leaflet 5.0, NASA GIBS WMTS tile integrations, Custom Geodesic Algorithms (Spherical Excess Area, Haversine Distance, Bounding Box Calculations).
- **AI & Grounding**: Google `@google/genai` TypeScript SDK (Gemini 2.5 Flash / Gemini Pro), Prompt-Injection Sanitization Filters.
- **Test Runner & Verification**: Node.js Native Test Runner (`node:test`, `node:assert/strict`), TSX.

---

## 4. API Documentation Reference

All endpoints are prefixed with `/api/v1` and return standardized envelopes:
```json
{
  "success": true,
  "data": { ... },
  "meta": { "apiVersion": "v1", "timestamp": "...", "requestId": "..." }
}
```

### 4.1 Location & Geospatial
- `POST /api/v1/location/resolve`: Reverse geocodes coordinates to administrative region, state, and agro-climatic zone.

### 4.2 Weather & Soil Telemetry
- `POST /api/v1/weather/telemetry`: Retrieves 30-day historical NASA POWER weather and GPM IMERG rainfall.
- `POST /api/v1/weather/trends`: Long-term climate normal baselines and heat-stress frequency trends.
- `POST /api/v1/soil/profile`: Depth-stratified ISRIC SoilGrids v2.0 profile ($0\text{--}5$, $5\text{--}15$, $15\text{--}30$, $30\text{--}60\text{ cm}$) with uncertainty intervals and texture class.
- `POST /api/v1/soil/moisture`: NASA SMAP L4 root-zone ($0\text{--}100\text{ cm}$) and surface ($0\text{--}5\text{ cm}$) soil moisture in $\text{m}^3/\text{m}^3$.

### 4.3 High-Resolution Satellites (ECOSTRESS & Landsat/HLS)
- `GET /api/v1/evapotranspiration/products`: Provider capabilities, layer metadata, and token configuration for ECOSTRESS `ECO_L3T_JET.002` and `ECO_L4T_ESI.002`.
- `POST /api/v1/evapotranspiration/jobs`: Submits async point or area (GeoJSON Polygon) extraction job to AppEEARS.
- `GET /api/v1/evapotranspiration/jobs/:jobId`: Checks status of an asynchronous extraction job.
- `GET /api/v1/evapotranspiration/jobs/:jobId/results`: Retrieves parsed observation payloads with quality mask filtering.
- `GET /api/v1/vegetation/products`: Capabilities for Harmonized Landsat Sentinel-2 `HLSL30.002` and `HLSS30.002`.
- `POST /api/v1/vegetation/jobs`: Submits async surface reflectance extraction job.
- `GET /api/v1/vegetation/jobs/:jobId/results`: Retrieves calibrated NDVI and NDWI observations.

### 4.4 Environmental Analytics & Farm Intelligence (Phases 4 & 5)
- `POST /api/v1/environmental/analyze`: Phase 4 multi-temporal validation, OLS rate of change per week, cross-sensor gap detection ($> 7\text{d}$), and stress screening.
- `POST /api/v1/farm-intelligence/summary`: Phase 5 parcel decision posture, bounded 7d & 14d predictive trend projections with uncertainty intervals, and evidence-linked farmer verification actions.

### 4.5 Crop Suitability & Rotation Planning
- `POST /api/v1/crops/recommend`: Deterministic crop suitability ranking based on weather, soil, and regional constraints.
- `POST /api/v1/rotation/generate`: Generates agronomic multi-season rotation plans (Baseline vs Alternative A/B) evaluating legume nitrogen credits, pest breaks, and soil health.
- `POST /api/v1/rotation/compare`: Side-by-side comparison matrix of user-customized rotation sequences.

### 4.6 Grounded AI Agronomist
- `POST /api/v1/ai/ask`: Context-grounded Gemini AI assistant supporting English and Hindi with prompt-injection defense and strict 3-tier evidence guardrails.

---

## 5. Installation & Local Development Guide

### 5.1 Prerequisites
- **Node.js**: `v20.0.0` or higher (`v22` recommended).
- **Package Manager**: `npm` (v10+).

### 5.2 Step-by-Step Setup
1. **Clone the repository**:
   ```bash
   git clone <repository_url>
   cd fieldshift-ai
   ```

2. **Install all dependencies**:
   ```bash
   npm install
   ```

3. **Configure Environment Variables**:
   Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
   Configure key variables:
   - `GEMINI_API_KEY`: Google Gemini API key for AI assistant features.
   - `NASA_EARTHDATA_TOKEN` *(optional)*: NASA Earthdata Bearer token for live AppEEARS LP DAAC job submission.
   - `PORT`: Server port (default: `3000`).

4. **Start Development Server**:
   ```bash
   npm run dev
   ```
   The application will be live at `http://localhost:3000`.

---

## 6. Production Deployment Guide

FieldShift AI is packaged as a unified full-stack application where Express serves both API endpoints and the compiled Vite frontend bundle.

### 6.1 Production Build
Execute the production build to compile static assets into `dist/`:
```bash
npm run build
```

### 6.2 Production Execution
Start the production server:
```bash
NODE_ENV=production npm start
```
The Express server mounts the static client from `dist/` and hosts all `/api/v1/*` routes.

### 6.3 Containerized Deployment (Docker / Google Cloud Run)
A standard container specification for Cloud Run or Kubernetes:
```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package*.json ./
RUN npm ci --only=production
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/shared ./shared
COPY --from=builder /app/data ./data
COPY --from=builder /app/server.ts ./server.ts
EXPOSE 3000
CMD ["node", "server.ts"]
```

### 6.4 Security & Deployment Safeguards
- **Zero Client Credential Leakage**: Client builds contains zero API keys or secrets. All external calls are proxied through the Express server.
- **CORS & Frame Restrictions**: AI Studio environment constraints prevent unauthorized iframe embedding while supporting authenticated applet preview URLs.
- **Rate Limiting**: Server applies sliding-window rate limiting on AI endpoints (`AI_RATE_LIMIT_MAX_REQUESTS="20"` per minute).

---

## 7. Demonstration Workflow (User Guide)

Follow this 6-step workflow for a comprehensive live demonstration:

### Step 1: Farm Parcel Selection & Boundary Drawing
- Open the application and navigate to the **Agricultural Map** tab.
- Click **"Load Demonstration Parcels"** in the Farm Boundaries panel.
- Select **Nashik Vineyard Parcel (Maharashtra)** (or click **"Draw Boundary"** on the map to place vertices and create a custom farm polygon).
- Observe real-time geodesic calculations: Area ($12.50\text{ ha}$ / $30.89\text{ ac}$), Perimeter, and Centroid coordinates ($19.9988^\circ\text{ N}, 73.7910^\circ\text{ E}$).

### Step 2: Environmental Intelligence Dashboard
- Switch to the **Environmental Intelligence** tab.
- Inspect the **Parcel Decision Posture** card displaying overall status (e.g., `Watchful` or `Stressed`), observational confidence, and multi-sensor summary.
- Examine the **Sensor Coverage Badges**:
  - *ECOSTRESS 70m*: Evapotranspiration in $\text{W/m}^2$ and Evaporative Stress Index (ESI).
  - *Landsat/Sentinel-2 30m*: NDVI canopy greenness and NDWI canopy moisture.
  - *NASA SMAP L4*: Root-zone and surface soil moisture in $\text{m}^3/\text{m}^3$.
  - *NASA POWER*: 30-day mean temperature and cumulative precipitation.

### Step 3: Historical Trends & Time-Series Visualizations
- Scroll down to the **Multi-Temporal Satellite Observations & Trend Trajectories** section.
- Inspect the interactive SVG time-series charts for NDVI, NDWI, ET, and ESI.
- Note the solid line showing fitted historical regression with data points and acquisition dates.

### Step 4: Predictive Trend Projections (7d & 14d)
- On the charts, observe the **dashed projection line** extending 7 and 14 days forward.
- Notice the **shaded uncertainty polygon** $[L, U]$ that widens over time, reflecting statistical confidence intervals bounded by physical limits (e.g., $-1$ to $+1$ for NDVI).
- Read the explicit scientific disclaimer: *"Statistical trend extrapolation of historical observations — NOT a numerical weather forecast or crop yield guarantee."*

### Step 5: Evidence-Linked Action Recommendations
- Review the **Actionable Farmer Verification Guidance** cards.
- Observe how recommendations are directly linked to observed anomalies (e.g., *"Auger soil sampling at 15 cm depth"* when root-zone moisture diverges from satellite thermal stress).
- Note the strict adherence to the guardrail: no exact liter/mm pump commands or chemical dosages.

### Step 6: Bilingual Grounded AI Agronomist Consultation
- Switch to the **AI Agronomist** tab.
- Click a suggested question or enter:
  - *English*: *"How is the vegetation trend on my farm according to satellite observations?"*
  - *Hindi*: *"मेरे खेत में वनस्पति सूचकांक (NDVI) और मिट्टी की नमी का क्या रुझान है?"*
- Observe the structured response:
  - Explicit **3-Tier Evidence Separation** (Direct Observations vs Modelled Estimates vs Trend Projections).
  - Accurate Hindi (Devanagari) agronomic explanation.
  - Advisory to consult local **Krishi Vigyan Kendra (KVK)** experts.

---

## 8. Known Limitations & Edge-Case Handling

1. **NASA AppEEARS Authentication Dependency**:
   - Live on-demand extraction from NASA LP DAAC requires an active NASA Earthdata login token. When unconfigured, the system reports authentication status transparently and processes uploaded GeoJSON parcels and pre-fetched COG observation bundles seamlessly.
2. **Pedometric REST Timeouts & Urban Masks**:
   - Remote queries to ISRIC SoilGrids REST API can occasionally exceed 3.5s latency or fall onto urban/water masks. The system handles this gracefully via WCS fallback or clear `unavailable` state markers without breaking the UI.
3. **Cloud & Shadow Contamination**:
   - Overcast or cloudy satellite overpasses are automatically filtered using Fmask and ECOSTRESS QA bitmasks (`cloudMaskFlag === 0`), preventing corrupt vegetation or thermal index spikes.
4. **Prescriptive Boundaries**:
   - The platform strictly disclaims automated irrigation pump actuation, exact volumetric dosage, and remote plant disease pathology diagnosis.

---

## 9. Future Scope

- **Direct STAC / COG Cloud Streaming**: Integrate NASA CMR-STAC and Earth Search APIs to perform dynamic browser-side WebAssembly raster zonal statistics directly over Cloud-Optimized GeoTIFFs (COGs).
- **IoT Probe Ingestion**: Add LoRaWAN and MQTT connectors for real-time telemetry from on-farm soil moisture probes and automated weather stations (AWS).
- **Offline Progressive Web App (PWA)**: Implement service workers and IndexedDB caching for full offline field scouting in remote rural regions.
- **Global Geographic Expansion**: Expand regional knowledge packs beyond South Asia (India) to Sub-Saharan Africa (Kenya, Ethiopia) and South America (Brazil Cerrado).


