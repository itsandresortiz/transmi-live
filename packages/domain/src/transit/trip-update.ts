export interface TripUpdate {
  readonly tripId: string;
  readonly routeId?: string;
  /** Segundos de retraso (negativo = adelantado). */
  readonly delaySeconds: number | null;
  readonly nextStop?: { readonly stopId: string; readonly arrivalAt?: number };
  readonly reportedAt?: number;
}
