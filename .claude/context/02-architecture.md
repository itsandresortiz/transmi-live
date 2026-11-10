# 02 · Arquitectura

## Capas (DDD) y reglas de dependencia
```
domain  ←  application  ←  infrastructure
                ↑                ↑
          apps/web y apps/mobile  (solo ellas conocen React / React Native / el navegador)
```
- **`packages/domain`** (`src/transit/*`, `src/card/tullave.ts`, `src/shared/geo.ts`): entidades y reglas puras. `Vehicle` (con historial y rumbo), `Fleet`, `TransitNetwork` (rutas, paradas, trazados), `RoadPath` (proyección sobre el trazado), `Delay`, `ServiceAlert`, `TripUpdate`, `trunk-lines.ts` (letras y colores de las líneas de la troncal), `stop.ts` (`parseStopName`: nombre limpio, vagón = letra A→1, plataforma de portal), `prediction.ts`, `card/tullave.ts` (`parseTuLlave`, `maskedReading`, movimientos por mes).
- **`packages/application`**: casos de uso y estado. `TransitState` (flota, red, retrasos, avisos, horarios; `touch()` + `subscribe()`), `LiveDataService` (sondea y aplica lotes), `queries.ts` (`searchRoutes`, `searchStopGroups`, `upcomingAtStop`, `nearestStops`, `trunkStations`, `routesAtStop`, `siblingStops`, `alertsFor`, alias de estaciones), `motion.ts` (`MotionEngine`), `eta.ts` (`arrivalAtIndex`), `planner.ts` (cómo llegar), `departures.ts` y `service-ends.ts` (horarios del GTFS), `station-geometry.ts` (formas de las estaciones, **compartido**), `trunk-data.ts` (ejes de las troncales con su letra y portales; da el color de línea de cada estación), `traffic.ts`, `travel-times.ts` (apagado, ver `07-decisions.md`).
- **`packages/infrastructure`**: `gtfsrt/decoders.ts` (protobuf → `VehicleReport`, `TripUpdate`, `ServiceAlert`), `feed/proxy-live-feed.ts` (+ `worker-live-feed.ts` en la web), `gtfs/parse.ts` (zip reducido → red), `gtfs/patches.ts` (correcciones puntuales al GTFS), `gtfs/network-source.ts`.
- **Puertos** (`application/src/ports.ts`): `LiveFeedPort`, `NetworkSourcePort`, `Clock`. Cada app los conecta en su **raíz de composición** (`apps/web/src/composition-root.ts`, `apps/mobile/src/composition-root.ts`). Es el único lugar que conoce adaptadores.
- Reglas: el dominio no importa nada de fuera; la aplicación solo importa el dominio; las apps no contienen reglas de negocio nuevas (si es lógica de tránsito, va a `packages/*` con prueba).

## Flujo de datos en vivo
1. **Fuente**: TransMilenio publica `positions.pb`, `tripupdates.pb`, `alerts.pb` (~cada 21–60 s; llegan con 1–3 min de retraso real).
2. **Reenvío**: (a) función de Supabase `tm` (CORS, caché de 4 s, endpoint `live` que espera cambios); (b) respaldo: el workflow `Datos en vivo` publica los mismos archivos en la rama `live-data` (`scripts/live_loop.sh`, ~cada 7 s durante unos 5 min por ejecución).
3. **Adaptador** `ProxyLiveFeed` pregunta con huellas (`pos`, `tu`, `al`) y baja solo lo que cambió; si el proxy falla usa la rama de respaldo (`source: "delayed"`). En la web corre en un Web Worker.
4. **`LiveDataService.refresh()`** → `TransitState.applyTripUpdates / applyAlerts / applyPositions` (descarta lotes incompletos: <60 % de la flota).
5. **`applyPositions`**: ingiere en `Fleet`, resuelve el sistema de cada bus, **`reconcileLastStops()`** y observa tiempos por tramo.
6. Las pantallas se suscriben con `transit.subscribe` / `useTransitVersion` (app) y se repintan; el reloj corregido (`clock.ts`) usa la hora del servidor, no la del aparato.

### Dato clave: la «última parada» que informa TransMilenio suele estar mal
Medido el 2026-11-10: solo ~8 % de los buses estaban a <1 km de su `lastStopId`; ~73 % a >3 km. Además, los `tripId` casi nunca existen en el `trips.txt` publicado (el GTFS va por detrás del feed). Por eso:
- `TransitState.reconcileLastStops()` reemplaza `v.lastStopId` por la última parada realmente pasada, calculada con la **posición** del bus sobre el trazado (`sequenceByPosition`), solo si el dato informado no concuerda con dónde está el bus (y nunca inventa una si el bus no trae ninguna). Se memoriza por reporte.
- `sequenceByStop` prueba la ruta del feed y, si falla, la ruta que nombra el `tripId` (último tramo del código).
- `sequenceForDisplay(v)` = por parada y, si no, por posición (lo usan «próxima parada», «Voy en este bus» y la ficha de ruta). El motor de movimiento llama `nextStopOf(v, now, false)` (solo la parada informada) para no inventar movimiento.
- El GTFS trae **un solo trazado por ruta**, y en alimentadores/zonales ese trazado va y vuelve por la misma calle: las paradas se proyectan **en orden** (`RoadPath.projectAfter`, en `shapeStops`) y el bus según su rumbo (`projectAlong`). Si el bus va a >300 m del recorrido o su parada no concuerda y no se puede ubicar, `lastStopId` se **borra** (no se anuncia una parada lejana).

## Motor de movimiento (`MotionEngine`)
Pega cada bus a su trazado y lo hace avanzar entre reportes: ganancia 0,5 de la velocidad medida, corrección suave sin retroceder (hasta 3× su ritmo), desliza los saltos en ~2 s, desde el primer lote deduce velocidad de la ruta y la parada siguiente. Medido en la web (README raíz): error mediano ~87 m, 0 m a lo ancho. `step(v, nowSec)` se llama cuadro a cuadro (web, canvas) o a 4 Hz como máximo (app).
En la app, `useBuses.ts` **filtra primero por el último reporte** (±3 km del viewport) y solo calcula esos, adapta la frecuencia con `cadenceMs(zoom, buses en pantalla)` (66 ms de cerca con pocos buses … 700 ms de lejos) y poda el motor cada 30 s. Los buses se pintan en `BusLayer` (componente aparte y memorizado dentro de `TransitMap.tsx`).

## ETA (`arrivalAtIndex`)
Ubica el bus en el trazado, calcula cuánto del tramo hacia la siguiente parada ya recorrió, suma el resto del tramo y ~50–62 s por parada restante (según sistema), contado desde el reporte. Error mediano medido: 26–37 s con 12–16 lotes reales (18–27 s en la ruta C15). Todos los dispositivos muestran el mismo tiempo (sin aprendizaje por aparato).

## Dibujo
- **Web**: `apps/web/src/map/MapController.ts` (capas de MapLibre), `BusCanvas.ts` (buses en canvas 2D a ~60 fps), `busTop.ts` (**dibujo del bus visto desde arriba, compartido**), `stations.ts` (reexporta `station-geometry`), `theme.ts` (colores por tema).
- **App**: `apps/mobile/src/map/TransitMap.tsx` (MapLibre React Native: buses, red, estaciones, semáforos, ruta, parada enfocada; todas las capas están **siempre montadas**, solo cambia `visibility`), `useBuses.ts` (GeoJSON de buses), `styleProps.ts` (`sp()` reparte el estilo en `paint`/`layout` con nombres en kebab-case), `sprites.ts` (imágenes de buses y semáforo).
- **Imágenes de buses de la app**: se generan con `npx tsx tools/bus-sprites.ts` (Playwright renderiza el mismo `busTop.ts`) en `apps/mobile/assets/sprites-top/top-<sistema>-<s|l>.png` (`l` = articulado). **No editar a mano.** El mismo comando genera `assets/sprites-rear/rear-<sistema>-<s|l>.png` (bus en 3D desde atrás para la escena del viaje: caja proyectada con la cámara de `RideScene`, dibujo en `tools/bus-rear-draw.js`; `meta.json` dice dónde colocar cada imagen. Si cambia la cámara de la escena hay que cambiar `CAM` allí y regenerar).

## App móvil: pantallas y navegación
- `app/_layout.tsx` (raíz): `Stack` con `(tabs)` y **todas las demás pantallas como `modal`** con encabezado nativo (`unstable_settings.anchor = "(tabs)"` para que un enlace directo siempre deje el inicio debajo). `Launch` (pantalla de arranque) y `RideWatcher` / `WidgetSync` viven aquí.
- `app/(tabs)/_layout.tsx`: `NativeTabs` (barra de vidrio nativa): Inicio, Mapa, Rutas, Cómo llegar, Más.
- `src/ui/kit.tsx`: `Tap`, `Card`, `Glass` (con refresco al volver del segundo plano), `RoundButton`, `PrimaryButton`, `Chip`. `src/ui/theme.ts` + `palette.ts` (claro/oscuro/alto contraste). `src/ui/GlassSegments.tsx`: selector con burbuja de vidrio deslizante (filtros del mapa). `src/ui/CloseToolbar.tsx`: X de cerrar **nativa** (`Stack.Toolbar`).
- Estado local: zustand + AsyncStorage (`favorites.ts` → `tm.saved.v1`, `map/layers.ts` → `tm.layers.v1`), efímero en `map/focus.ts`, `planner/store.ts`, `ride.ts`.

## Módulos nativos y extensiones
- **`modules/tullave`** (Swift, Core NFC ISO7816): solo lee y devuelve respuestas de la tarjeta; el análisis vive en `packages/domain/src/card/tullave.ts`. Requiere el permiso «NFC Tag Reading» en el App ID y un iPhone real.
- **`targets/widget`** (SwiftUI/WidgetKit, vía `@bacons/apple-targets`): lee un JSON que la app deja en el **App Group** `group.com.transmilive.app` (`src/widgetSync.tsx`). Solo existe con `WIDGET=1` (`app.config.js`).
- **`modules/tripactivity`** (Swift, ActivityKit): crea/actualiza/termina la actividad en vivo del viaje. Su estructura `TripActivityAttributes` está **repetida idéntica** en `targets/widget/TripActivity.swift` (iOS las empareja por nombre): cambiar una exige cambiar la otra. Sin push: solo se actualiza con la app abierta; la cuenta regresiva corre sola.
- **`plugins/sin-push.js`**: quita `aps-environment` (instalar `expo-notifications` lo agregaba y exigiría el permiso de push en la cuenta de Apple). Los avisos del viaje son **locales**.
- **Parches al GTFS** (`packages/infrastructure/src/gtfs/patches.ts`): correcciones declarativas que se apagan solas cuando TransMilenio publique el dato (hoy: H15 para en «Calle 57» antes de la estación Calle 53).

## Caché y funcionamiento sin conexión
- Web: `offline-cache.ts` (`tm-data-v1`, última respuesta buena) + `public/sw.js` (app instalable). La caché del GTFS reducido se renueva por hora (`?t=`).
- App: `src/offline.ts` guarda rutas y horarios en el teléfono (rutas: se reutilizan 12 h; horarios: 6 h; sin red, lo que haya). Nunca se guardan buses en vivo.

## Seguridad y privacidad
- Sin cuentas, sin base de datos de usuarios, sin analítica. Favoritos, casa/trabajo, apodos y capas viven solo en el aparato.
- La ubicación se usa solo con la app abierta y no se guarda (ver `apps/web/public/privacidad.html`, pendiente de revisión del dueño).
- La lectura de la TuLlave ocurre en el teléfono; el número se oculta por defecto y no se guarda ni se envía.
- La función de Supabase es **pública y de solo lectura** (JWT desactivado a propósito): solo sirve tres archivos fijos. Ninguna llave privada está en el repo (`.env` ignorado, `*.p8` ignorado).
