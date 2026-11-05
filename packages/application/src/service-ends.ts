/** Primer y último viaje programado de cada ruta por tipo de día (sale del horario del GTFS). */
export interface ServiceEndsData {
  v: number;
  routes: Record<string, Partial<Record<"wk" | "sa" | "su", { first: [string, number]; last: [string, number] }>>>;
}
export interface ServiceMark {
  /** Es el último viaje del día de su ruta, según el horario programado. */
  isLast: boolean;
  /** Es el primer viaje del día. */
  isFirst: boolean;
  /** Hora programada de salida del viaje (segundos desde la medianoche; puede pasar de 24 h). */
  startSeconds: number;
}

/** Reconoce los buses que hacen el último (o primer) viaje de su ruta, cruzando el viaje en vivo con el horario. */
export class ServiceEnds {
  private last = new Map<string, number>();
  private first = new Map<string, number>();
  get size(): number { return this.last.size; }

  load(data: ServiceEndsData): void {
    this.last.clear(); this.first.clear();
    for (const days of Object.values(data.routes ?? {}))
      for (const d of Object.values(days ?? {})) {
        if (!d) continue;
        this.last.set(d.last[0], d.last[1]);
        this.first.set(d.first[0], d.first[1]);
      }
  }
  markOf(tripId: string | undefined): ServiceMark | undefined {
    if (!tripId) return undefined;
    const l = this.last.get(tripId), f = this.first.get(tripId);
    if (l == null && f == null) return undefined;
    return { isLast: l != null, isFirst: f != null, startSeconds: (l ?? f)! };
  }
}
