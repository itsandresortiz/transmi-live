# 01 · Panorama

## Qué es
**TransMi LIVE** es un mapa en vivo del transporte público de Bogotá: dónde está cada bus, en cuánto llega a tu parada, de dónde viene el próximo, avisos del servicio, cómo llegar, y (solo en la app de iPhone) el saldo de la tarjeta **TuLlave** por NFC.
Nombre público: **«TransMi LIVE»** (no «TransmiLive» ni «Transmi Live»). Repo: `itsandresortiz/transmi-live`.
No está afiliado a TransMilenio: usa sus datos abiertos.

## Para quién
Usuarios de Bogotá en el celular, sobre todo con prisa en la calle. El dueño del proyecto es hispanohablante, no técnico en profundidad, y prefiere explicaciones claras y pasos cortos (ver `06-conventions.md`).

## Qué existe hoy
| Producto | Dónde | Estado |
| --- | --- | --- |
| **Web** (React + Vite + MapLibre GL) | `apps/web`, publicada en GitHub Pages; el dueño la usa en transmilive.com (dominio propio; el `CNAME` no está en el repo **(?)**) | En producción; se publica sola con cada `push` a `main` |
| **App nativa de iPhone** (Expo SDK 58, React Native 0.88, expo-router) | `apps/mobile`, distribuida por **TestFlight** (bundle id `com.transmilive.app`) | En pruebas con el dueño; compilaciones manuales desde su Mac |
| **Widget iOS «Parada favorita»** (SwiftUI/WidgetKit) | `apps/mobile/targets/widget` | Escrito y compilado en Xcode (simulador); **opcional**: solo con `WIDGET=1`. Falta probarlo en TestFlight/dispositivo |
| **Lector NFC de la TuLlave** (módulo Swift propio) | `apps/mobile/modules/tullave` | Funciona en iPhone real (el dueño lo probó con su tarjeta) |
| **Función de Supabase** (proxy de feeds) | `supabase/functions/tm/index.ts` | El dueño la despliega a mano; en producción se llama `rapid-responder` (nombre en `config.ts`) |
| **Workflows de GitHub Actions** (datos en vivo, GTFS diario, vigilancia, estadísticas) | `.github/workflows/*` | Activos |

Android: el proyecto Expo lo permite pero **no se ha trabajado** (NFC y widget son solo iOS).

## Stack
- TypeScript en todo (modo estricto), monorepo con **DDD** en `packages/*`.
- Web: React 18, Vite, MapLibre GL, Web Worker para decodificar los feeds, service worker propio (sin conexión).
- App: Expo SDK 58, React Native 0.88 (arquitectura nueva), Hermes, `expo-router` (typed routes), `NativeTabs`, Reanimated 4, `expo-glass-effect` (Liquid Glass de iOS 26), `@maplibre/maplibre-react-native` 11, zustand + AsyncStorage, `@bacons/apple-targets` (widget), `expo-notifications` (avisos locales), `expo-keep-awake`, `expo-location`, `expo-haptics`.
- Pruebas: Vitest (config en la raíz). Mapa base: OpenFreeMap (positron) en la app; datos OSM propios en la web.

## Estructura del repositorio
```
packages/
  domain/          Reglas del negocio sin dependencias (buses, rutas, paradas, retrasos, avisos, tarjeta TuLlave, predicción)
  application/     Casos de uso: TransitState, consultas, motor de movimiento, ETA, planificador, estaciones, tiempos
  infrastructure/  Adaptadores: lector GTFS-realtime, feeds (proxy/worker), lector del GTFS reducido, correcciones al GTFS
apps/
  web/             App web (composition-root.ts conecta puertos y adaptadores)
  mobile/          App Expo (app/ = pantallas y rutas, src/ = lógica y UI, modules/ = Swift, targets/ = widget, plugins/)
supabase/functions/tm   Proxy de solo lectura de los feeds de TransMilenio
scripts/ tools/         Datos (GTFS reducido, horarios, publicación) y utilidades (semáforos, sprites, estadísticas)
.github/workflows/      Datos en vivo, GTFS diario, despliegue, vigilancia, estadísticas
docs/                   TESTFLIGHT.md (guía antigua con Capacitor, ver nota)
.claude/                CLAUDE.md (instrucciones), context/ (esta memoria) y hooks/ (recordatorio de documentar)
test/                   Pruebas transversales (reloj, enlaces, contraste móvil, pipeline con lotes reales)
```
Notas:
- `apps/web` y `packages/*` son espacios de trabajo npm de la raíz; **`apps/mobile` NO**: tiene su propia instalación (`npm install` dentro de `apps/mobile`) para que React Native no frene el despliegue de la web.
- `docs/TESTFLIGHT.md`, `capacitor.config.json`, `scripts/ios-setup.sh` y `scripts/ios-testflight.sh` son de la primera vía (Capacitor empaquetando la web). **Quedó obsoleta**: la app real es Expo (ver `07-decisions.md`). `apps/mobile/scripts/testflight-local.sh` es el camino vigente.

## Entornos
- **Local del dueño**: Mac con Xcode; compila con `apps/mobile/scripts/testflight-local.sh` o corre en simulador con `npx expo run:ios` + `npx expo start --dev-client`.
- **Contenedor de Claude** (Linux): sin Xcode ni red hacia el sitio de TransMilenio ni hacia transmilive.com; sí GitHub (API y `git`) y npm. Puede lanzar Playwright (Chromium) para generar imágenes.
- **GitHub Actions**: descarga los feeds y el GTFS, despliega la web, mide la calidad de los datos.
- **Producción web**: GitHub Pages. **Producción app**: TestFlight (aún no App Store).

## Roles
- **Dueño** (único humano): decide qué se publica, compila y sube a TestFlight, despliega a mano la función de Supabase, tiene la cuenta de Apple para publicar. Prueba en un iPhone real y en el simulador.
- **Claude**: escribe código, pruebas y datos de ejemplo, valida con datos reales publicados en la rama `live-data`, y empuja a `main`. No tiene acceso a Xcode ni al iPhone.
- **Terceros**: usuarios de TestFlight (pocos, por ahora) **(?)**.

## Datos de referencia útiles
- Zona horaria de los usuarios: `America/Bogota` (UTC−5). El servicio de TransMilenio termina de noche y empieza ~4:30 a. m.: sin buses de noche es normal.
- Repositorios hermanos que **no** hay que tocar: cualquier repositorio de terceros usado como referencia (solo lectura; ver `06-conventions.md`) y los demás proyectos del dueño (no usar sus recursos).
