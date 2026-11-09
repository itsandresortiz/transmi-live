/** Hora «de verdad»: la del servidor de datos, no la del reloj del dispositivo (que puede estar adelantado o atrasado
 *  y haría que dos aparatos muestren tiempos distintos para el mismo bus). */
/** Un reloj de aparato desfasado más de 2 minutos es raro; una diferencia mayor viene de datos congelados. */
export const MAX_SKEW_MS = 120_000;
const samples: number[] = [];
let offsetMs = 0;
/** Recibe la diferencia medida en cada consulta; se usa la mediana de las últimas para ignorar consultas lentas. */
export function updateClockOffset(ms: number): void {
  // si la fuente deja de publicar, su «hora» se queda en el último dato y la diferencia crece sin parar: eso no es un reloj mal puesto, se ignora
  if (!Number.isFinite(ms) || Math.abs(ms) > MAX_SKEW_MS) return;
  samples.push(ms);
  if (samples.length > 9) samples.shift();
  const s = samples.slice().sort((a, b) => a - b);
  offsetMs = s[Math.floor(s.length / 2)]!;
}
export const clockOffsetMs = () => offsetMs;
/** Ahora, en ms desde 1970, según el servidor. */
export const nowMs = () => Date.now() + offsetMs;
export const nowSec = () => nowMs() / 1000;
