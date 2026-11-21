/**
 * Líneas de cable aéreo de Bogotá en OpenStreetMap (en servicio y en obra), con sus estaciones: para dibujar el TransMiCable de
 * San Cristóbal, que aún no está en el GTFS, como «próximamente». Fuente: © colaboradores de OpenStreetMap (ODbL).
 * Salida: `<carpeta>/osm-cable.json` con las vías (aerialway / construction) y las estaciones (aerialway=station) con sus etiquetas.
 * Corre en GitHub (desde el contenedor de Claude el servidor de consultas corta la conexión).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? "dist-osm";
const BOX = "(4.45,-74.25,4.70,-73.98)";
const Q = `[out:json][timeout:120];(way["aerialway"]${BOX};way["construction"="aerialway"]${BOX};way["construction:aerialway"]${BOX};way["proposed:aerialway"]${BOX};node["aerialway"="station"]${BOX};node["construction:aerialway"="station"]${BOX};node["railway"="station"]["station"="aerialway"]${BOX};node["public_transport"="station"]["aerialway"="yes"]${BOX};);out body geom;`;
const SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

async function main() {
  let els: unknown[] = [], err: unknown = null;
  for (let k = 0; k < 6 && !els.length; k++) {
    if (k) await new Promise((r) => setTimeout(r, 20_000 * k));
    try {
      const r = await fetch(SERVERS[k % SERVERS.length]!, { method: "POST", body: new URLSearchParams({ data: Q }), headers: { "User-Agent": "transmi-live (datos abiertos)" } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      els = ((await r.json()) as { elements: unknown[] }).elements;
    } catch (e) { err = e; console.warn("intento", k + 1, "falló:", e instanceof Error ? e.message : e); }
  }
  if (!els.length && err) throw err;
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "osm-cable.json"), JSON.stringify({ fuente: "© colaboradores de OpenStreetMap (ODbL)", fecha: new Date().toISOString().slice(0, 10), elementos: els }));
  console.log("elementos:", els.length);
}
main().catch((e) => { console.error(e); process.exit(1); });
