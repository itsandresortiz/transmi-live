# 05 · Integraciones y operación

## Servicios externos
| Servicio | Para qué | Notas |
| --- | --- | --- |
| **TransMilenio** (`gtfs.transmilenio.gov.co`) | Feeds en vivo y `GTFS.zip` | Solo accesible desde GitHub Actions o el Mac del dueño (el contenedor de Claude no lo alcanza). Publica con 1–3 min de retraso; pausa de madrugada |
| **Supabase** (Edge Function) | Proxy CORS de solo lectura (`supabase/functions/tm/index.ts`; en producción se llama `rapid-responder`) | JWT **desactivado a propósito** (datos públicos). **El dueño la despliega a mano**; Claude no la despliega. Caché de 4 s; `GET /live` espera cambios hasta 25 s para reducir invocaciones |
| **GitHub** | Código, Actions, Pages, ramas de datos, reportes de usuarios (issues) | La API se usa con el conector de GitHub; sin `gh` en el contenedor para escribir (ver `06-conventions.md`) |
| **GitHub Pages** | Hosting de la web | Se publica con cada `push` a `main` (workflow `Publicar app web`) |
| **OpenFreeMap** | Teselas y estilo del mapa de la app | Sin llave |
| **Photon (komoot)** | Buscador de direcciones en «Cómo llegar» | Sin llave; se le envía el texto escrito y la ubicación redondeada |
| **Secretaría Distrital de Movilidad** | Red semafórica (CC BY 4.0) | `tools/semaforos.ts` |
| **Apple** | TestFlight, App Store Connect, App ID, App Groups, NFC | Cuenta de Apple del dueño |
| **Repositorio de referencia (de terceros)** | Proyecto de otro equipo que se revisó como referencia | **Solo lectura**; no se escribió nada ahí y su clon local se borró. Se adoptaron: accesibilidad, prueba de contraste, estado del feed, bienvenida, apodos de paradas, reportes y política de privacidad |

## Workflows de GitHub Actions (`.github/workflows`)
| Archivo | Cuándo | Qué hace |
| --- | --- | --- |
| `deploy-web.yml` («Publicar app web») | `push` a `main` (si cambian `apps/**`, `packages/**`, `tools/seo.ts`, `tools/semaforos.ts`, lockfiles), lunes 09:17 UTC, manual | `npm ci` → `npm test` → build → SEO → semáforos → Pages. **Si las pruebas fallan no se publica**. Tiene concurrencia (un push nuevo cancela el anterior) |
| `live-data.yml` («Datos en vivo») | cada 5 min + se re-lanza a sí mismo | Copia `positions/tripupdates/alerts` a `live-data` (`scripts/live_loop.sh`) |
| `gtfs-daily.yml` | 04:30 Bogotá y manual | `slim_gtfs.py` → `gtfs-lite.zip`; `build_schedule.py` → rama `schedule-data` |
| `health.yml` («Vigilancia de datos») | :11 y :41 de cada hora | Abre/actualiza/cierra un issue `salud-datos` si los datos fallan |
| `hop-stats.yml`, `signal-stats.yml` | cada 5 / 10 min | Graban tiempos por tramo y comportamiento cerca de semáforos |
| `precision.yml`, `probe-semaforos.yml` | manual | Mide la precisión de los buses; prueba fuentes de semáforos |

Lecciones: no lanzar `deploy-web` a mano justo después de un `push` (se pisan y falla); si un `push` no dispara el despliegue, mirar `paths` y que las pruebas pasen en un entorno **sin** `apps/mobile/node_modules` (hubo un fallo por eso: `vitest.config.ts` fija `esbuild.tsconfigRaw`).

## App iPhone: compilar y distribuir
- Identificadores: bundle `com.transmilive.app`; widget `com.transmilive.app.widget`; App Group `group.com.transmilive.app`; esquema de enlaces `transmilive`.
- Capacidades en el App ID: **NFC Tag Reading** (ya marcada), **App Groups** (solo widget; Xcode la crea con firma automática). **No** Push Notifications (lo evita `plugins/sin-push.js`).
- **Compilar y subir (Mac del dueño)**: **un solo comando** (`WIDGET=1 bash apps/mobile/scripts/testflight-local.sh`): el script baja lo nuevo de GitHub, cierra el servidor de pruebas y borra `ios/` y `build/` antes de compilar. `bash apps/mobile/scripts/testflight-local.sh` con `TEAM_ID` (desde 2026-11-10 queda guardado en el `~/.zshrc` del Mac del dueño: ya no hay que escribirlo; y `WIDGET=1` para incluir el widget). Hace `npm install` → `expo prebuild` → `xcodebuild archive/export` y abre Transporter con `build/ios/export/TransMiLIVE.ipa`. Número de compilación = `date +%y%m%d%H%M`. Se niega a compilar si la copia local está atrás de `origin/main` (imprime «Compilando la versión <hash>»).
- Antes de cada compilación el dueño debe: `git restore apps/mobile/package-lock.json` (npm lo modifica) → `git pull` → `git log --oneline -1` (verificar) → `rm -rf apps/mobile/ios apps/mobile/build`.
- Con firma automática hace falta **un iPhone registrado** en la cuenta (UDID, no ICCID). La llave `.p8` de la API **nunca** sale del Mac ni se pide en el chat.
- **Probar sin TestFlight (recomendado para iterar)**: `WIDGET=1 npx expo prebuild --platform ios --clean` → `xed ios` → ▶ en el simulador; en otra pestaña `WIDGET=1 npx expo start --dev-client` y pulsar **i**. Tras un `git pull` la app recarga sola (o **r**). El widget se ve en el *Canvas* de Xcode (`#Preview` en `Widget.swift`). NFC y notificaciones remotas no funcionan en el simulador.
- Ver una caída: iPhone › Ajustes › Privacidad y seguridad › Analíticas y mejoras › Datos de analíticas (`TransMiLIVE-…ips`), o App Store Connect › TestFlight › Crashes.

## Variables de entorno y configuración (solo nombres)
- Scripts de compilación: `TEAM_ID`, `WIDGET`, `UPLOAD` (`transporter`|`api`), `ASC_KEY_ID`, `ASC_ISSUER`, `ASC_KEY` (ruta al `.p8`), `BUNDLE_ID`, `SKIP_PULL_CHECK`.
- Actions: `GITHUB_TOKEN`, `GITHUB_REPOSITORY`, `BRANCH` (`scripts/publish.sh`), `REPO_URL`, `FEED_BASE`, `ITER`, `GAP` (`scripts/live_loop.sh`).
- Direcciones públicas (no secretas) en `apps/web/src/config.ts` y `apps/mobile/src/config.ts`: `proxyUrl`, `dataBase`, `scheduleBase`.
- `app.config.js` lee `WIDGET` y `TEAM_ID`, y expone `extra.widget` / `extra.widgetGroup` a la app.
- No hay `.env` en el repo (está en `.gitignore`).

## Utilidades de `tools/`
- `tools/bus-sprites.ts`: regenera las imágenes de buses de la app. Necesita `esbuild` (viene con Vite) y **Playwright con Chromium** (no es dependencia del repo; en el contenedor de Claude ya está global). Uso: `npx tsx tools/bus-sprites.ts`.
- `tools/semaforos.ts`, `tools/seo.ts`: los corre el despliegue de la web. `tools/precision.ts`, `tools/hopstats.ts`, `tools/signalstats.ts`: los corren workflows de medición.

## Verificación estándar antes de dar algo por terminado
```bash
npx vitest run                      # raíz: dominio, aplicación, infraestructura, flujo con lotes reales
npx tsc --noEmit -p apps/web        # tipos de la web
cd apps/mobile && npx tsc --noEmit  # tipos de la app
npx expo export --platform ios --output-dir <carpeta-temporal>   # ¿empaqueta?
npx expo prebuild --platform ios --no-install                    # ¿arma el proyecto? (con y sin WIDGET=1) y borrar ios/ después
```
Datos reales para validar: `git fetch origin +live-data:refs/remotes/origin/live-data` y leer `positions.pb`, `tripupdates.pb`, `gtfs-lite.zip` (ver `sessions/2026-11-10-datos-widget-y-pulido.md`).

## Google Play (Android)
- Paquete: `bash apps/mobile/scripts/playstore-local.sh` → `~/Desktop/TransMiLIVE-<compilación>.aab`, firmado con la llave de subida del Mac del dueño (`~/.transmilive/transmilive-subida.jks`; clave en el Llavero de macOS, elemento `transmilive-llave-subida`). Variables (solo nombres): `TM_UPLOAD_STORE`, `TM_UPLOAD_ALIAS`, `TM_UPLOAD_PASS`, `TM_VERSION_CODE`.
- La subida es manual en Google Play Console (el dueño). Nombre del paquete: `com.transmilive.app`. Conviene usar «Firma de apps de Google Play» (si se pierde la llave de subida, Google deja cambiarla).

## Cadenas de datos: cómo se mantienen vivas (2026-11-11)
- «Datos en vivo» (`live-data.yml`) y «Llegadas para el widget» (`widget-data.yml`) se relanzan solas al terminar. El horario `*/5` de GitHub es solo un respaldo y en este repo casi no corre (se ha visto cada ~8 h). Por eso cada una revisa a la otra al final y la relanza si no hay ejecución en curso ni en espera.
- Si las dos se caen a la vez, hay que lanzar una a mano (Actions › «Datos en vivo» › Run workflow); la vigilancia (`health.yml`) abre un issue «salud-datos», pero tarde.
- La rama `live-data` la escriben dos procesos: el bucle en vivo (los `.pb` y `meta.json`) y el diario (`gtfs-lite.zip`, `network.json.gz`). El bucle toma siempre del remoto los archivos del diario antes de empujar; `publish.sh` comprueba 20 s después que lo suyo siga ahí y repite hasta 4 veces.
- La app y la web usan primero el intermediario (Supabase) y, si falla, `live-data` solo si tiene menos de 10 minutos. La hora de `meta.json` del respaldo es la de publicación: nunca se usa como reloj.
- `hop-stats` se relanza solo (lo revisa `live-data.yml`). Al 2026-11-17: ~302.000 claves (ruta|sentido|tramo|día|franja), ~2 millones de tramos recorridos; publica además `profile.json.gz` (perfil para la app; `use` lo controla `PROFILE_USE` en `tools/hopstats.ts`). `signal-stats`: ~10.100 puntos cerca de semáforos con ~47.000 observaciones; **aún no se usa** en la app.
- (2026-11-17) **Buscador de Servicios de TransMilenio**: su código toma los datos de un servidor aparte (`ms-transmiapp-rm2xahnybq-uk.a.run.app`, `/api/v1/rutas/{id}/{sentido}/paraderos`, `/rutas/{id}/informacion`, `/paraderos/…`, `/rutas/buscar`). Se permitió ese servidor en el entorno «TransMi LIVE», pero responde **403 «Acceso denegado»** a todo lo que no venga de su propia página (no pide llave: filtra por origen). No se intentó hacerse pasar por su página (sería saltarse su control de acceso). Para usarlo hace falta pedirle acceso a TransMilenio o que lo publiquen como datos abiertos.
- (2026-11-17) **GTFS diario**: el horario de GitHub (cron 09:30 UTC) se retrasa hasta ~10 h; `live-data.yml` lo lanza si a partir de las 4:30 de Bogotá no ha corrido ese día.
- (2026-11-17) Rama `live-data`: además de `network.json.gz` (v1, apps publicadas) se publica `network2.json.gz` (v2 compacto, apps desde la 1.0.6) en el GTFS diario.
- (2026-11-17) **Semáforos**: la «Red semafórica» de Movilidad (`sig.simur.gov.co/.../DatosAbiertos/RedSemaforica/FeatureServer/0`, 1.746 puntos) tiene **un punto por cruce (controlador)**, no por cada semáforo físico: cada punto trae `TOTALGRUPOSENALES` (≈20.600 grupos en total; p. ej. 6 = 3 para carros + 3 peatonales), `GRUPOSVEHICULARES`, `GRUPOS_BRT`, `GRUPOSPEATONALES`, `NUMEROFASES`, `OPERACIONACTUAL` (NORMAL 1.466, PMT 253, Desvío-PMT 27). Los equipos que manejan 2–5 cruces (DOBLE 530, TRIPLE 69…) salen como un punto por cruce. `tools/semaforos.ts` guarda además los grupos por tipo, fases, operación y la posición de cada semáforo tomada de **OpenStreetMap** (Overpass `overpass-api.de`, ODbL; ver changelog). Hosts permitidos en el entorno.
- (2026-11-17) **¿Qué tan llenos van los buses?** Los datos en vivo no lo traen (el campo de ocupación del estándar viene vacío; cada bus trae solo viaje, posición, hora, parada y vehículo). **Validaciones (entradas por estación cada 15 min)**: TransMilenio las publicaba en el almacenamiento `storage.googleapis.com/validaciones_tmsa` (índices `ValidacionTroncal.html`, `ValidacionZonal.html`, `validaciones_mensuales.html`; antes públicos), pero hoy responden 403 (acceso cerrado). El portal de datos de Bogotá (`datosabiertos.bogota.gov.co`, «Consolidado de salidas sistema troncal por franja horaria», último 2023) y su copia `hub.tumidata.org` cortan la conexión desde la nube. Sin fuente usable por ahora.
- (2026-11-17) **Servidor de mapas público de TransMilenio** (`gis.transmilenio.gov.co/arcgis/rest/services`, ArcGIS, sin llave): `Troncal/consulta_esquemas_estaciones` (1.085 polígonos: vagones, conexiones, transiciones y entradas de cada estación, con sentido «Vagon 1 W-E»), `Troncal/consulta_estaciones_troncales` (vagones, accesos, biciestación, wifi por estación), `BRT/consulta_desvios_brt` (122 planes de desvío de la troncal «viables», no en vivo), `BRT/ConsultaEstacionesCable`. El portal `datosabiertos-transmilenio.hub.arcgis.com` además guarda GTFS estáticos viejos (2023–2026). Hosts permitidos en el entorno «TransMi LIVE»: estos dos, `storage.googleapis.com`, los de Bogotá/tumidata y el servidor del buscador.
- (2026-11-17) **GTFS completo** (`GTFS.zip`, vigente hasta 2026-12-31): además de lo que ya usamos trae `parent_station` (740 vagones agrupados en 160 estaciones oficiales; hoy agrupamos por nombre), `fare_attributes` (pasaje 3.550 COP; ventana de transbordo solo para TransMiCable), `frequencies` (TransMiCable cada 10–16 min), festivos en `calendar_dates` (ya usados en horarios) y `shape_dist_traveled`. `wheelchair_boarding` es 1 en todas las paradas (no sirve) y `stop_headsign` trae claves internas. Los avisos en vivo solo traen desvíos de buses zonales: los cierres de vagones de la troncal **no vienen** (se anuncian en redes).
- **Cambios del feed de TransMilenio vistos en noviembre de 2026**: los avisos traen periodos de segundos (hora del reporte) y `tripupdates.pb` ya no trae paradas ni horas de llegada (solo retraso por viaje; ~5 % de los buses en la calle tienen viaje con dato). `hop-stats` mide ahora con posiciones y se relanza solo.
- `positions.pb` (nov. 2026): `stop_id` y `current_stop_sequence` son fijos por viaje (no indican por dónde va el bus). Lo único fiable es posición, hora del GPS, ruta, viaje y placa. Todo lo que dependa de «última parada» debe salir de la posición.

- (2026-11-14) iPhone: el número de compilación lo pone `testflight-local.sh` en `TM_BUILD_NUMBER` (fecha y hora) antes de `expo prebuild`; `app.config.js` lo pasa a `ios.buildNumber`. Android: `TM_VERSION_CODE` (igual idea).

- (2026-11-14) Entorno de nube personal «TransMi LIVE» (para este repo): red limitada + `www.transmilenio.gov.co`, `transmilenio.gov.co`, `gtfs.transmilenio.gov.co`. El entorno «Default» no permite esos dominios.
- (2026-11-14) Sitio de TransMilenio revisado: **no tiene planeador de viajes A→B en la web**. Para planear remite a «TransMi App» (App Store id1195720094; Play `com.nexura.transmilenio`) y, para el SITP, a Moovit (página de sitp.gov.co). Su «Buscador de Servicios» (`https://buscador-rutas.transmilenio.gov.co`, Angular) consulta rutas (paraderos y horarios) y paraderos (rutas que pasan, mapa de la estación) contra un servicio propio en `/api/v1/…` (vistos: `troncales/listar`, `tipos-servicios/listar`, `zonas/listar`, `estaciones/listar`; las de ruta y paradero se arman por id). Serviría para contrastar el orden de paradas y horarios del GTFS. Consultar ese servicio desde la sesión quedó bloqueado por los permisos (no se llamó). El entorno «TransMi LIVE» ya permite `buscador-rutas.transmilenio.gov.co`.
- (2026-11-16) **Google Play rechazó el paquete 26111114** por «Formulario de seguridad de los datos no válido: Ubicación precisa». Causa: la app envía a Photon la ubicación redondeada a 3 decimales (~100 m); para Google (y para Apple: «coarse» = menos de 3 decimales) eso es **ubicación precisa**, y se había declarado «aproximada». Solución acordada: declarar en Play «Ubicación precisa» recopilada y compartida, procesada de forma efímera, opcional, para funcionalidad de la app; corregir igual la etiqueta del App Store; la política de privacidad ya lo dice así. No se cambió el código.
- (2026-11-17) **Capturas automáticas en el simulador**: `bash apps/mobile/scripts/capturas.sh` (en el Mac, desde `apps/mobile`) compila una versión para el simulador sin la bienvenida (`TM_CAPTURAS=1` → `extra.capturas`), pone la ubicación en Portal Suba, abre por enlace Inicio, Mapa, Buscar, Cómo llegar, Más, paradas (Portal Suba T2 `74452`, Héroes `61217`), ruta 7 (`14047`), ¿En qué bus vas?, Cerca y Avisos, en claro y oscuro, y guarda las capturas en el Escritorio. `SOLO_CAPTURAS=1` repite sin compilar. **Sin probar en el Mac (?)**. Sirve para que Claude revise el diseño (no puede ver la app desde la nube).

- `signal-stats` (2026-11-17): además de los conteos, guarda 7 días de reportes de buses junto a los semáforos medidos a mano (`cerca-medidos.json.gz`, sin identidad del bus) y publica `aprendizaje.json` (lo que dicen los buses de cada semáforo medido; lo lee el cronómetro de la web en `?pruebas`).
- `signal-stats.yml` casi no corría con su horario (GitHub lo lanzaba pocas veces al día): desde 2026-11-17 `live-data.yml` lo lanza si no está corriendo, entre 4:30 a. m. y 11:30 p. m. de Bogotá.
