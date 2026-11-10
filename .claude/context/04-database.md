# 04 · Datos y persistencia

**TransMi LIVE no tiene base de datos propia** (ni tablas, ni RLS, ni migraciones, ni cuentas de usuario). La función de Supabase solo reenvía archivos de TransMilenio y **no usa la base de datos de Supabase** **(?: confirmar en el panel de Supabase que el proyecto no tiene tablas)**. Esta es la lista de dónde vive cada dato.

## Fuentes de verdad
| Dato | Formato | Origen | Dónde se publica | Quién lo lee |
| --- | --- | --- | --- | --- |
| Posiciones de buses | GTFS-realtime `positions.pb` | TransMilenio | Proxy `tm` y rama `live-data` | `decodePositions` → `VehicleReport` |
| Retrasos por viaje | `tripupdates.pb` | TransMilenio | ídem | `decodeTripUpdates` → `TripUpdate` (solo ~5 % de los buses lo trae) |
| Avisos de servicio | `alerts.pb` | TransMilenio | ídem | `decodeAlerts` → `ServiceAlert` |
| Huellas del lote | `meta.json` `{pos,tu,al,at}` | `scripts/live_loop.sh` | rama `live-data` | `ProxyLiveFeed` |
| Red (rutas, paradas, trazados) | `gtfs-lite.zip` (routes, trips, stops, shapes, stop_times del viaje representativo de cada ruta y sentido) | `scripts/slim_gtfs.py` sobre `GTFS.zip` de TransMilenio (~116 MB) | rama `live-data` (workflow `GTFS diario`, 04:30 Bogotá) | `parseGtfsLite` + `buildNetwork` (+ `applyStopPatches`) |
| Horarios (primer/último viaje, salidas por parada) | `schedule.json.gz`, `service-ends.json.gz`, `departures.json.gz` | `scripts/build_schedule.py` | rama `schedule-data` | `ServiceEnds`, `Departures` |
| Semáforos de Bogotá | `semaforos.json` `{v, at, rows:[[lon,lat,dirección,localidad,tipo]]}` | Secretaría de Movilidad (datos abiertos, CC BY 4.0) vía `tools/semaforos.ts` | despliegue de la web (`transmilive.com/semaforos.json`) | web y app |
| Mapa base y calles | teselas vectoriales / JSON OSM | OpenFreeMap (app) · `apps/web/src/data/*.json` (web: estaciones, localidades, roads, streets, troncales) | — | MapLibre |
| Buses de ejemplo (demostración) | 8 × `positions-N.pb` (lotes reales del 2026-11-09 por la noche, ~80 s entre ellos) | recogidos de la rama `live-data` | carpeta `demo/` en `main` | `apps/mobile/src/demo.ts` |
| Estadísticas de calidad | JSON de tiempos por tramo y comportamiento en semáforos | workflows `hop-stats` y `signal-stats` | ramas `hop-stats` y `signal-stats` | `tools/hopstats.ts`, `tools/signalstats.ts` |

Las ramas de datos (`live-data`, `schedule-data`, `hop-stats`, `signal-stats`) son **huérfanas y se reescriben con `--force`**: tienen un solo commit. Con `git fetch` hay que usar `+rama:refs/remotes/origin/rama` o falla en silencio.

## Particularidades del GTFS que hay que recordar
- Un solo recorrido por ruta y sentido en el GTFS publicado; `direction_id` suele venir vacío.
- La **letra** del nombre de una parada de troncal es el vagón (A=1, B=2…); los números (`- 2 ó 5`, `- 4 ó 6`…) distinguen sentidos.
- Hay paradas sin ruta (p. ej. la estación nueva «Calle 53 - Universidad Manuela Beltrán», id sin código): `station-geometry`/`queries.ts` las usan como **nombre alterno** de la estación pegada (<80 m) cuyo nombre empiece igual.
- El `tripId` del feed termina en un código de ruta que a menudo **no existe** en el GTFS (el GTFS va por detrás del feed). Ver `02-architecture.md`.
- `feed_version` = 1, válido todo 2026 (¿no se actualiza durante el año? **(?)**).

## Persistencia local (en el aparato; nada sale de él)
| Clave | Dónde | Qué guarda |
| --- | --- | --- |
| `tm.favorites.v1` | web (localStorage) | paradas y rutas favoritas |
| `tm.places.v1` | web | casa y trabajo |
| `tm.recents.v1` | web | destinos recientes |
| `tm.saved.v1` | app (AsyncStorage, zustand persist) | paradas y rutas favoritas, apodos (`nicknames`), casa y trabajo |
| `tm.layers.v1` | app | capas del mapa (semáforos, estaciones) |
| `tm.appearance.v1` | app | apariencia elegida: automático, claro u oscuro |
| `tm.onboarded.v1` | app | ya vio la bienvenida |
| `tm-data-v1` | web (Cache Storage) | última respuesta buena de cada fuente (modo sin conexión) |
| App Group `group.com.transmilive.app`, clave `snapshot` | app → widget (UserDefaults compartido) | JSON `{at, stops:[{id,name,arrivals:[{r,h,t,c}]}]}` con lo que viene a hasta 3 paradas favoritas; solo con `WIDGET=1` |

## Si algún día hubiera base de datos
Se registraría aquí: tablas, relaciones, RLS, migraciones y funciones. Hoy no aplica.
