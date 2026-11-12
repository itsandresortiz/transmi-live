import type { Clock, FeedSignature, LiveFeedPort } from "./ports";
import { systemClock } from "./ports";
import type { TransitState } from "./transit-state";

/** `idle`: la fuente responde pero no está publicando buses (típico de madrugada, cuando termina el servicio). */
export type Connection = "connecting" | "live" | "waiting" | "stale" | "idle";
export interface ConnectionStatus { connection: Connection; ageSeconds: number | null }

/** Qué tan fresco es el último lote, para mostrárselo al usuario. */
export function connectionStatus(state: TransitState, nowMs: number): ConnectionStatus {
  const answering = state.lastPollOkAt != null && nowMs - state.lastPollOkAt < 90_000;     // el servidor contestó hace poco
  if (state.lastBatchAt == null) return { connection: state.lastPollOkAt != null && answering ? "idle" : "connecting", ageSeconds: null };
  const age = Math.max(0, nowMs / 1000 - state.lastBatchAt);
  return { connection: age <= 45 ? "live" : age <= 180 ? "waiting" : answering ? "idle" : "stale", ageSeconds: age };
}

/** Qué decirle a la persona sobre los datos en vivo.
 *  `live`: hay buses y el dato es reciente · `few`: el dato es reciente pero reportan pocos buses (típico de madrugada): sigue siendo en vivo ·
 *  `late`: hay buses pero el último dato tiene más de 5 min · `none`: no llega nada reciente. */
export type LiveLevel = "live" | "few" | "late" | "none";
export const LIVE_MANY = 50, LIVE_LATE_S = 300;
export function liveLevel(state: TransitState, nowMs: number): LiveLevel {
  const n = state.fleet.size, age = state.lastBatchAt == null ? Infinity : nowMs / 1000 - state.lastBatchAt;
  if (n >= LIVE_MANY) return age > LIVE_LATE_S ? "late" : "live";
  return n > 0 && age <= LIVE_LATE_S ? "few" : "none";
}

/** ¿El teléfono está sin conexión? Se deduce de las consultas: dos o más fallidas seguidas (falla el intermediario y también la copia
 *  de respaldo) y ninguna buena en el último minuto. No hace falta pedirle permisos ni librerías al sistema. */
export function isOffline(state: TransitState, nowMs: number): boolean {
  return state.pollFailures >= 2 && state.lastPollFailAt != null && nowMs - state.lastPollFailAt < 90_000 && (state.lastPollOkAt == null || nowMs - state.lastPollOkAt > 45_000);
}

/** ¿A esta hora ya terminó el servicio? TransMilenio opera más o menos de 4:30 a. m. a 11 p. m. (domingos hasta las 10 p. m.).
 *  Solo sirve para **explicar** por qué no llegan buses de noche; nunca para esconder buses que sí están reportando. */
export function serviceClosedNow(nowMs: number): boolean {
  const d = new Date(nowMs - 5 * 3600_000);      // hora de Bogotá (UTC−5 todo el año)
  const minutes = d.getUTCHours() * 60 + d.getUTCMinutes(), sunday = d.getUTCDay() === 0;
  return minutes < 4 * 60 + 30 || minutes >= (sunday ? 22 : 23) * 60;
}

/** Qué decir cuando no llegan datos recientes de los buses. De noche la razón es que el servicio terminó, y así se dice
 *  («Sin datos en vivo» a medianoche suena a que la app está fallando). `short` es para rótulos chicos. */
export function liveDownText(nowMs: number, offline = false): { title: string; short: string; detail: string; closed: boolean; offline: boolean } {
  // sin conexión es la explicación que manda: ni «servicio finalizado» ni «TransMilenio no envía datos» serían ciertos
  if (offline) return { closed: false, offline: true, title: "Sin conexión a internet", short: "Sin conexión", detail: "No podemos traer los buses en vivo. Puedes seguir viendo rutas, paradas y horarios guardados en tu teléfono." };
  if (!serviceClosedNow(nowMs)) return { closed: false, offline: false, title: "Sin datos en vivo por ahora", short: "Sin datos en vivo", detail: "TransMilenio no está enviando la ubicación de los buses. Eso no significa que no haya servicio." };
  const beforeMidnight = new Date(nowMs - 5 * 3600_000).getUTCHours() >= 12;
  return { closed: true, offline: false, title: beforeMidnight ? "Servicio finalizado por hoy" : "Servicio finalizado", short: "Servicio finalizado", detail: "Los buses vuelven a salir hacia las 4:30 a. m. Mientras tanto puedes consultar rutas, paradas y horarios." };
}

/** Caso de uso: pedir a la fuente lo nuevo y aplicarlo al estado. */
export class LiveDataService {
  private signature: FeedSignature = {};
  private lastChangeMs = 0;
  private busy = false;
  failures = 0;
  /** Tras recibir un lote, la fuente nunca publicó otro antes de ~9 s: no vale la pena preguntar antes. */
  static readonly QUIET_MS = 9000;

  constructor(private readonly feed: LiveFeedPort, private readonly state: TransitState, private readonly clock: Clock = systemClock) {}

  /** Devuelve `true` si llegaron datos nuevos. Los errores se cuentan en `failures` y se relanzan. */
  async refresh(force = false): Promise<boolean> {
    if (this.busy) return false;
    if (!force && this.lastChangeMs && this.clock.now() - this.lastChangeMs < LiveDataService.QUIET_MS) return false;
    this.busy = true;
    try {
      const poll = await this.feed.poll(this.signature);
      this.failures = 0;
      this.state.pollFailures = 0;
      this.state.lastPollOkAt = this.clock.now();
      this.state.dropStale(this.clock.now());
      if (!poll) return false;
      const { batch, signature, source } = poll;
      const now = this.clock.now();
      if (batch.positions && this.state.fleet.size > 500 && batch.positions.length < 0.6 * this.state.fleet.size)
        throw new Error(`Lote incompleto (${batch.positions.length} buses)`);
      // retrasos y avisos primero, para que los buses nuevos ya tengan su retraso al aparecer
      if (batch.tripUpdates) this.state.applyTripUpdates(batch.tripUpdates);
      if (batch.alerts) this.state.applyAlerts(batch.alerts, now);
      if (batch.positions) {
        // un lote que trae mucho menos que el anterior llegó cortado: se descarta y se reintenta
        if (this.state.fleet.size > 500 && batch.positions.length < 0.6 * this.state.fleet.size)
          throw new Error(`Lote incompleto (${batch.positions.length} buses)`);
        this.state.applyPositions(batch.positions, now);
        this.lastChangeMs = now;
      }
      this.state.source = source;
      this.signature = { ...this.signature, ...signature };
      return true;
    } catch (e) {
      this.failures++;
      this.state.pollFailures++;
      this.state.lastPollFailAt = this.clock.now();
      // sin respuesta tampoco se dejan en pantalla buses viejos: antes solo se limpiaban cuando la consulta salía bien,
      // así que sin internet los buses quedaban congelados indefinidamente
      this.state.dropStale(this.clock.now());
      throw e;
    } finally {
      this.busy = false;
    }
  }
}
