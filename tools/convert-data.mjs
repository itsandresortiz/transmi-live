// Convierte los datos geográficos de la versión anterior (assets/*.js) a JSON para la web nueva.
// Uso: node tools/convert-data.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
const out = "apps/web/src/data";
mkdirSync(out, { recursive: true });
const load = (file, names) => new Function(readFileSync(file, "utf8") + `\nreturn {${names.join(",")}};`)();
const geo = load("assets/geo.js", ["LOCALIDADES", "TRONC", "ESTS"]);
const roads = load("assets/roads.js", ["ROADS"]);
const streets = load("assets/streets.js", ["STREETS"]);
const w = (n, d) => { writeFileSync(`${out}/${n}.json`, JSON.stringify(d)); console.log(n, (JSON.stringify(d).length / 1024).toFixed(0) + " KB"); };
w("localidades", geo.LOCALIDADES);
w("troncales", geo.TRONC);
w("estaciones", geo.ESTS);
w("roads", roads.ROADS);
w("streets", streets.STREETS);
