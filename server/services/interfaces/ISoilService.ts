import type {
  ServiceReadinessStatus,
  SoilMoistureRequest,
  SoilMoistureSnapshot,
  SoilProfile,
  SoilProfileRequest,
} from '../../../shared/index.ts';

export interface ISoilService {
  getStatus(): ServiceReadinessStatus;
  getSoilProfile(request: SoilProfileRequest): Promise<SoilProfile>;
  getSoilMoisture(request: SoilMoistureRequest): Promise<SoilMoistureSnapshot>;
}
