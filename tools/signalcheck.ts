/**
 * Contrasta los semáforos medidos a mano (`tools/data/mediciones-semaforos.json`) con los buses reales durante unos minutos y dice lo
 * que los buses aprenden de cada semáforo (ver `learnFromBuses`): cuánto encajan, si el ciclo parece corrido, qué sentido obedece y si
 * los arranques caen tras el verde. Lo mismo se acumula solo cada 10 min en la rama `signal-stats` (`tools/signalstats.ts`).
 *
 * Uso: NODE_USE_ENV_PROXY=1 npx tsx tools/signalcheck.ts [segundos]      (de día, con buses en la calle)
 */
import { readFileSync } from "node:fs";
import { learnFromBuses, measuredSignals, signalPlans } from "@transmi/application";
import { buildNetwork, decodePositions, parseGtfsLite } from "@transmi/infrastructure";
import { SignalNearCollector } from "./signal-near";

const SECONDS = Number(process.argv[2] ?? 600);
const sigs = measuredSignals(JSON.parse(readFileSync("tools/data/mediciones-semaforos.json", "utf8"))).map((s) => ({ ...s, model: signalPlans(s.marks) }));
const g = await fetch("https://raw.githubusercontent.com/itsandresortiz/transmi-live/live-data/gtfs-lite.zip");
const net = buildNetwork(await parseGtfsLite(new Uint8Array(await g.arrayBuffer())));
const isTrunk = (routeId: string) => { const sys = net.routes.get(routeId)?.system; return sys === "troncal" || sys === "dual"; };
const calles = ((await (await fetch("https://raw.githubusercontent.com/itsandresortiz/transmi-live/signal-stats/osm-calles.json")).json()) as { s: Record<string, [number]> }).s;
const col = new SignalNearCollector(sigs);
const end = Date.now() + SECONDS * 1000;
let polls = 0;
while (Date.now() < end) {
  try {
    const r = await fetch("https://gtfs.transmilenio.gov.co/positions.pb", { headers: { "User-Agent": "Mozilla/5.0 (transmi-live)" } });
    if (r.ok) {
      polls++;
      for (const v of decodePositions(new Uint8Array(await r.arrayBuffer()))) col.add({ id: v.id, lon: v.position.lon, lat: v.position.lat, t: v.reportedAt, trunk: isTrunk(v.routeId) });
    }
  } catch (e) { console.log("consulta fallida:", (e as Error).message); }
  await new Promise((res) => setTimeout(res, 8000));
}
console.log(`consultas: ${polls}`);
sigs.forEach((s, k) => {
  const L = learnFromBuses(s.model, s.inverse, col.obs[k]!, col.goes[k]!, calles[`${s.lon.toFixed(6)},${s.lat.toFixed(6)}`]?.[0]);
  console.log(`\n${s.title}${s.tm ? " (TransMilenio)" : ""}${s.inverse ? " · opuesto" : ""} · ${L.n} reportes · ${L.goes.n} arranques`);
  console.log(`  ${L.text}`);
  console.log(`  ejes: ${L.axes.map((a) => `${a.axis} n=${a.n} igual=${a.same.toFixed(2)} contrario=${a.flipped.toFixed(2)}`).join(" | ")}`);
  if (L.shift) console.log(`  mejor corrimiento: ${L.shift.s} s → ${L.shift.agree.toFixed(2)}`);
});
