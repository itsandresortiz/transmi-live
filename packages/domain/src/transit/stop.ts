import type { GeoPoint } from "../shared/geo";

export type StopId = string;
export interface Stop {
  readonly id: StopId;
  readonly code: string;
  readonly name: string;
  readonly position: GeoPoint;
}
