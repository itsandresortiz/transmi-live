/** Hora «de verdad»: la del servidor de datos, no la del reloj del dispositivo (que puede estar adelantado o atrasado
 *  y haría que dos aparatos muestren tiempos distintos para el mismo bus). */
const samples: number[] = [];
let offsetMs = 0;
/** Recibe la diferencia medida en cada consulta; se usa la mediana de las últimas para ignorar consultas lentas. */
export function updateClockOffset(ms: number): void {
  samples.push(ms);
  if (samples.length > 9) samples.shift();
  const s = samples.slice().sort((a, b) => a - b);
  offsetMs = s[Math.floor(s.length / 2)]!;
}
export const clockOffsetMs = () => offsetMs;
/** Ahora, en ms desde 1970, según el servidor. */
export const nowMs = () => Date.now() + offsetMs;
export const nowSec = () => nowMs() / 1000;
