/** Primer y último viaje programado de cada ruta por tipo de día (sale del horario del GTFS). */
export interface ServiceEndsData {
  v: number;
  /** Fechas (AAAAMMDD) con horario distinto al de su día de la semana: festivos, etc. */
  dates?: Record<string, "wk" | "sa" | "su">;
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

export type DayType = "wk" | "sa" | "su";
/** Horas del día (hora de Bogotá) antes de las cuales el «día de servicio» sigue siendo el anterior: los horarios pasan de las 24:00. */
const SERVICE_DAY_CUTOFF_H = 3;

/** Día de servicio de un instante: su tipo de horario y los segundos transcurridos desde la medianoche de ese día (puede pasar de 86 400). */
export function serviceDay(nowMs: number, dates: Record<string, DayType> = {}): { type: DayType; secs: number } {
  const bog = new Date(nowMs - 5 * 3600_000);                       // Bogotá es UTC-5 todo el año
  let secs = bog.getUTCHours() * 3600 + bog.getUTCMinutes() * 60 + bog.getUTCSeconds() + bog.getUTCMilliseconds() / 1000;
  let day = new Date(Date.UTC(bog.getUTCFullYear(), bog.getUTCMonth(), bog.getUTCDate()));
  if (bog.getUTCHours() < SERVICE_DAY_CUTOFF_H) { day = new Date(day.getTime() - 86_400_000); secs += 86_400; }
  const key = `${day.getUTCFullYear()}${String(day.getUTCMonth() + 1).padStart(2, "0")}${String(day.getUTCDate()).padStart(2, "0")}`;
  const dow = day.getUTCDay();
  return { type: dates[key] ?? (dow === 0 ? "su" : dow === 6 ? "sa" : "wk"), secs };
}

export interface RouteDayStatus {
  /** `before`: aún no sale el primero · `running`: en servicio · `ended`: salió el último y ya no hay buses en la calle. */
  state: "before" | "running" | "ended";
  firstStart: number;
  lastStart: number;
  /** Con el servicio de hoy terminado: a qué hora sale el primero del siguiente día de servicio (segundos desde la medianoche), si se sabe. */
  nextFirstStart?: number;
}

/** Reconoce los buses que hacen el último (o primer) viaje de su ruta, cruzando el viaje en vivo con el horario. */
export class ServiceEnds {
  private last = new Map<string, number>();
  private first = new Map<string, number>();
  private byRoute: ServiceEndsData["routes"] = {};
  private dates: Record<string, DayType> = {};
  get size(): number { return this.last.size; }

  load(data: ServiceEndsData): void {
    this.last.clear(); this.first.clear();
    this.byRoute = data.routes ?? {}; this.dates = data.dates ?? {};
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

  /** Tipo de día y segundos transcurridos del día de servicio en este instante. */
  dayAt(nowMs: number): { type: DayType; secs: number } { return serviceDay(nowMs, this.dates); }

  /** Primer y último viaje de la ruta en cada tipo de día (segundos desde la medianoche), y cuál es el de hoy. */
  scheduleOf(routeId: string, nowMs: number): { today: DayType; days: { type: DayType; first: number; last: number }[] } | undefined {
    const r = this.byRoute[routeId]; if (!r) return undefined;
    const days = (["wk", "sa", "su"] as DayType[]).flatMap((type) => { const d = r[type]; return d ? [{ type, first: d.first[1], last: d.last[1] }] : []; });
    return days.length ? { today: serviceDay(nowMs, this.dates).type, days } : undefined;
  }

  /** Estado de la ruta hoy según el horario programado. `activeBuses` son los buses de esa ruta que ahora mismo circulan. */
  routeStatus(routeId: string, nowMs: number, activeBuses: number): RouteDayStatus | undefined {
    const { type, secs } = serviceDay(nowMs, this.dates);
    const d = this.byRoute[routeId]?.[type];
    if (!d) return undefined;
    const firstStart = d.first[1], lastStart = d.last[1];
    const state = secs < firstStart - 900 && activeBuses === 0 ? "before" : secs > lastStart && activeBuses === 0 ? "ended" : "running";
    const nextFirstStart = state === "ended" ? this.byRoute[routeId]?.[this.nextDayType(nowMs)]?.first[1] : undefined;
    return { state, firstStart, lastStart, nextFirstStart };
  }

  /** Tipo de horario del día de servicio que sigue al actual (para decir cuándo sale el primer bus una vez terminó el de hoy). */
  nextDayType(nowMs: number): DayType {
    const { secs } = serviceDay(nowMs, this.dates);
    return serviceDay(nowMs - secs * 1000 + 36 * 3600_000, this.dates).type;      // mediodía del día siguiente
  }
}
