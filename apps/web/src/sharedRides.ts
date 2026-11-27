import { parseSharedRides } from "@transmi/application";
import { CONFIG, transit } from "./composition-root";
import { nowSec } from "./clock";

/** Posiciones que comparte la gente que va en un bus con la app (opcional y anónimo; ver `packages/application/src/shared-rides.ts`).
 *  Se leen cada ~20 s de un archivo público (no gasta invocaciones del servidor). Apagado mientras `CONFIG.sharedRidesUrl` sea `null`. */
export function startSharedRides(): () => void {
  const url = CONFIG.sharedRidesUrl;
  if (!url) return () => undefined;
  let stopped = false;
  const load = async () => {
    if (document.hidden || navigator.onLine === false) return;
    try {
      const r = await fetch(`${url}?t=${Math.floor(Date.now() / 10_000)}`);
      if (r.ok && !stopped) transit.sharedRides.set(parseSharedRides(await r.json()), nowSec());
    } catch { /* sin red: caducan solas a los 60 s */ }
  };
  void load();
  const timer = setInterval(() => void load(), 20_000);
  return () => { stopped = true; clearInterval(timer); };
}
