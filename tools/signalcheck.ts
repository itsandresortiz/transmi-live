/**
 * Contrasta los semáforos medidos a mano (`tools/data/mediciones-semaforos.json`) con los buses reales: durante unos minutos baja las
 * posiciones de TransMilenio y, por cada reporte de un bus a menos de 80 m de un semáforo medido, anota si iba detenido o avanzando y en
 * qué color debía estar el semáforo en ese momento (según el ciclo medido). Si el modelo está bien, los buses detenidos cerca del
 * semáforo deberían caer casi siempre en su rojo, y los que lo cruzan rápido, en su verde. Para el de TransMilenio solo cuentan buses
 * troncales y duales; para los de carros, los demás.
 *
 * Uso: NODE_USE_ENV_PROXY=1 npx tsx tools/signalcheck.ts [segundos]      (de día, con buses en la calle)
 */
import { readFileSync } from "node:fs";
import { measuredSignals, opposite, signalModel, signalNow, type SignalColor } from "@transmi/application";
import { buildNetwork, decodePositions, parseGtfsLite } from "@transmi/infrastructure";

const SECONDS = Number(process.argv[2] ?? 600), NEAR_M = 80;
const meters = (lon1: number, lat1: number, lon2: number, lat2: number) => Math.hypot((lon1 - lon2) * 111_320 * Math.cos((4.65 * Math.PI) / 180), (lat1 - lat2) * 110_570);
const sigs = measuredSignals(JSON.parse(readFileSync("tools/data/mediciones-semaforos.json", "utf8"))).map((s) => ({ ...s, model: signalModel(s.marks) })).filter((s) => s.model);
const colorAt = (s: (typeof sigs)[number], t: number): SignalColor => (s.inverse ? opposite(s.model!, t) : signalNow(s.model!, t).c);

interface Obs { still: boolean; color: SignalColor; d: number }
const obs = sigs.map(() => [] as Obs[]);
// qué buses cuentan para cada semáforo: los de TransMilenio (troncal y dual) para el de TransMilenio, los demás para los de carros;
// cerca del de TransMilenio también pasan buses zonales por los carriles mixtos, que siguen otro semáforo
const g = await fetch("https://raw.githubusercontent.com/itsandresortiz/transmi-live/live-data/gtfs-lite.zip");
const net = buildNetwork(await parseGtfsLite(new Uint8Array(await g.arrayBuffer())));
const isTrunk = (routeId: string) => { const sys = net.routes.get(routeId)?.system; return sys === "troncal" || sys === "dual"; };
const last = new Map<string, { lon: number; lat: number; t: number }>();
const end = Date.now() + SECONDS * 1000;
let polls = 0;
while (Date.now() < end) {
  try {
    const r = await fetch("https://gtfs.transmilenio.gov.co/positions.pb", { headers: { "User-Agent": "Mozilla/5.0 (transmi-live)" } });
    if (r.ok) {
      polls++;
      for (const v of decodePositions(new Uint8Array(await r.arrayBuffer()))) {
        const p = last.get(v.id);
        last.set(v.id, { lon: v.position.lon, lat: v.position.lat, t: v.reportedAt });
        if (!p || v.reportedAt <= p.t || v.reportedAt - p.t > 90) continue;
        const speed = meters(p.lon, p.lat, v.position.lon, v.position.lat) / (v.reportedAt - p.t);
        sigs.forEach((s, k) => {
          const d = meters(s.lon, s.lat, v.position.lon, v.position.lat);
          if (d > NEAR_M || isTrunk(v.routeId) !== s.tm) return;
          obs[k]!.push({ still: speed < 1.2, color: colorAt(s, v.reportedAt * 1000), d });
        });
      }
    }
  } catch (e) { console.log("consulta fallida:", (e as Error).message); }
  await new Promise((res) => setTimeout(res, 8000));
}
console.log(`consultas: ${polls}`);
sigs.forEach((s, k) => {
  const o = obs[k]!, still = o.filter((x) => x.still), moving = o.filter((x) => !x.still);
  const pct = (a: Obs[], c: SignalColor) => (a.length ? `${Math.round((100 * a.filter((x) => x.color === c).length) / a.length)} %` : "-");
  console.log(`\n${s.title}${s.tm ? " (TransMilenio)" : ""}${s.inverse ? " · opuesto" : ""} · ${o.length} reportes de buses a ≤${NEAR_M} m`);
  console.log(`  detenidos: ${still.length} → en rojo según el modelo ${pct(still, "r")}, en verde ${pct(still, "g")}`);
  console.log(`  avanzando: ${moving.length} → en verde ${pct(moving, "g")}, en rojo ${pct(moving, "r")}`);
});
