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
- `hop-stats` depende solo del horario de GitHub: lleva días sin actualizarse (pendiente).
