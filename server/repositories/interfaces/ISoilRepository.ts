import type {
  SoilMoistureRequest,
  SoilMoistureSnapshot,
  SoilProfile,
  SoilProfileRequest,
} from '../../../shared/index.ts';

export interface ISoilRepository {
  fetchSoilProfile(request: SoilProfileRequest): Promise<SoilProfile>;
  fetchSoilMoisture(request: SoilMoistureRequest): Promise<SoilMoistureSnapshot>;
}
