import type { GeoPoint } from "../shared/geo";
import type { Route, RouteId } from "./route";
import type { Stop, StopId } from "./stop";

/** Trazado representativo de una ruta en un sentido. */
export interface RouteShape {
  readonly routeId: RouteId;
  readonly direction: string;
  readonly headsign: string;
  readonly points: readonly GeoPoint[];
  readonly stopIds: readonly StopId[];
}

/** Agregado: la red estática (rutas, paradas y trazados) que viene del GTFS. */
export class TransitNetwork {
  readonly routes = new Map<RouteId, Route>();
  readonly stops = new Map<StopId, Stop>();
  /** Destinos conocidos por ruta (para buscar por destino). */
  readonly headsigns = new Map<RouteId, string[]>();
  readonly shapes = new Map<RouteId, RouteShape[]>();

  get isLoaded(): boolean { return this.routes.size > 0 && !this.hasOnlyProvisional(); }
  private hasOnlyProvisional(): boolean {
    for (const r of this.routes.values()) if (!r.provisional) return false;
    return true;
  }

  shapesOf(routeId: RouteId): readonly RouteShape[] { return this.shapes.get(routeId) ?? []; }
}
