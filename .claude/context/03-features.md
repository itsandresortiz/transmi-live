# 03 · Funciones y pantallas

## Web (`apps/web`)
Una sola página con mapa a pantalla completa y una hoja deslizable (`ui/Sheet.tsx`) que cambia de vista; todo se enlaza por `#/…` (`src/deeplink.ts`).
| Vista / función | Archivos | Notas |
| --- | --- | --- |
| Mapa de buses en vivo | `map/MapController.ts`, `BusRenderer.ts`, `BusCanvas.ts`, `busTop.ts` | Buses vistos desde arriba, giran con su rumbo; color por sistema o por puntualidad; aro ámbar en el «último servicio» |
| Rutas, buses, paradas, avisos | `ui/views.tsx` (`RoutesView`, `BusesView`, `StopsView`, `AlertsView`, `RouteDetailView`) | La ficha de un bus muestra «Por dónde va este bus» con hora estimada a cada parada (usa `sequenceForDisplay`) |
| Parada / estación / ruta en una parada | `ui/stopViews.tsx` | Rutas que vienen, de dónde viene el próximo, «luego», último/primer servicio, vagones hermanos, horario programado si no hay buses |
| Favoritos y «cerca de ti» | `ui/mine.tsx`, `ui/favorites.ts` (`tm.favorites.v1`) | Paradas y rutas guardadas |
| Cómo llegar | `ui/planner.tsx`, `plannerStore.ts` (`tm.recents.v1`), `packages/application/src/planner.ts` | Itinerarios con caminata + buses en vivo + horarios; casa/trabajo en `places.ts` (`tm.places.v1`) |
| Seguir este viaje (Cómo llegar) | `ui/trip.tsx` (`TripBar`) | Guía paso a paso en pantalla con la lógica compartida `trip-guide`; sin notificaciones del sistema; se pierde al recargar |
| Seguir bus y modo viaje | `ui/FollowBar.tsx`, `ui/ride.tsx` | «Voy en este bus»: elige la parada donde bajas y avisa en pantalla (sin notificaciones del sistema) |
| Mi tarjeta TuLlave | `ui/card.tsx` | Solo funciona si la página está dentro de una app nativa que exponga `window.TransmiNative.tullave`; en el navegador explica que hace falta la app |
| Ajustes | `ui/Settings.tsx` | Estado del servicio, capas (calles, paradas, red, buses, **semáforos**, tráfico), color de buses, movimiento, tamaño de texto, contraste, instalar |
| Compartir / enlaces | `ui/share.tsx`, `deeplink.ts` | `#/ruta/ID?d=SENTIDO`, `#/parada/ID`, `#/estacion/ID1,ID2`, `#/viaje/lat,lon,nombre/lat,lon,nombre` |
| Sin conexión / instalable | `public/sw.js`, `offline-cache.ts`, `manifest.webmanifest` | Abre con lo último visto |
| SEO / páginas estáticas | `tools/seo.ts`, `public/sitemap.xml`, `robots.txt` | Se regeneran cada lunes con el GTFS más reciente |
| Semáforos y tráfico | `tools/semaforos.ts` (genera `semaforos.json`), `packages/application/src/traffic.ts` | `semaforos.json` lo publica el despliegue de la web junto a la página |

## App iPhone (`apps/mobile`)
### Pestañas (`app/(tabs)`)
| Pestaña | Archivo | Qué hace |
| --- | --- | --- |
| **Inicio** | `index.tsx` | Saludo, píldora «N en vivo» (abre el mapa) y campana de avisos, buscador, **Tus paradas** (carrusel: cada favorita con sus 3 próximos buses o la próxima hora programada; «Ver todas»), acceso rápido (Cerca de mí, Casa, Trabajo, Favoritos), «Cómo llegar» y «Rutas», y tus rutas favoritas |
| **Mapa** | `mapa.tsx` | Mapa en vivo: abre centrado en ti la primera vez (si estás en Bogotá), filtros de sistema en vidrio, «En vivo», botón de ubicación (solo al alejarte), botón de capas (semáforos, estaciones), brújula propia (solo si el mapa está girado), tarjeta de «siguiendo un bus» con próxima parada |
| **Buscar** (archivo `rutas.tsx`, ruta `/rutas`) | `rutas.tsx` | Un campo y un selector Rutas / Paradas: lista y busca rutas; busca paradas, estaciones y portales por nombre o código (dice qué es cada una); sin texto: «Paradas cerca de mí» y favoritas |
| **Cómo llegar** | `viaje.tsx` | Origen/destino, salir ahora / salir a las / llegar a las, orden, itinerarios; tocar un tramo de bus abre la parada con esa ruta; modo «guardar casa/trabajo» (`planner/store.ts` `saveAs`) |
| **Más** | `mas.tsx` | Tarjeta TuLlave destacada arriba (abre `/card`) y listas agrupadas tipo Ajustes: Servicio (buses en la calle, avisos con conteo), Tus cosas (Favoritos, Cerca de mí), Apariencia (Automático/Claro/Oscuro, `src/appearance.ts`), Pruebas (escondido: 8 toques en «Buses en la calle»), Ayuda (reportar problema → correo de contacto, privacidad), versión y compilación |

### Ventanas (todas `modal` con X nativa)
| Ruta | Archivo | Qué hace |
| --- | --- | --- |
| `/stop/[id]` | `app/stop/[id].tsx` | Parada: rutas con bus en camino (con «luego»), **todas** las demás rutas que paran (con horario si no hay bus), vagones hermanos, avisos, compartir, cómo llegar, favorito, «Personalizar parada»; al tocar una ruta muestra el detalle (próximo bus, «Seguir este bus», «Ver en el mapa», siguientes, recorrido hasta la parada). Acepta `?route=` para abrir directo el detalle |
| `/bus/[id]` | `app/bus/[id].tsx` | Bus: estado de puntualidad, próxima parada, «Voy en este bus», «Ver la ruta» |
| `/ride/[id]` | `app/ride/[id].tsx` | **Voy en este bus**: tablero de a bordo (título «Llegando a…», escena animada `src/ui/RideScene.tsx` con la avenida en perspectiva y bordes fundidos, tarjeta de información, barra «Trayecto» por segmentos cuando hay parada de bajada) y próximas paradas (hasta 30) con cuenta regresiva y hora; tocar una = «aquí bajas»; vibración 3 paradas antes / 1 antes / al llegar y **notificaciones locales** programadas (`src/RideWatcher.tsx`, `notify.ts`); mantiene la pantalla encendida. Tocar un aviso abre esta ventana con ese bus. Abrirla marca el bus como **seguido** (`useMapFocus.followBusId`): al cerrarla, el mapa muestra la tarjeta fija «Vas en este bus» |
| `/route/[id]` | `app/route/[id].tsx` | Ruta: mapa con trazado y buses, buses en vivo con próxima parada, paradas con buses que van hacia ellas, horario, avisos, favorito |
| `/trip` | `app/trip.tsx` | **Seguir este viaje** (se inicia desde una opción de «Cómo llegar»): arriba, el viaje completo dibujado en el mapa con los buses de sus rutas en vivo; tarjeta «Ahora» (qué hacer y cuenta regresiva), pasos con hora y estado, «Terminar viaje». `TripWatcher` avanza los pasos con la ubicación (solo con la app abierta) y el bus en vivo, y programa avisos locales de cada paso; con la app cerrada salen a la hora estimada. `TripBanner` lo recuerda en Inicio y Cómo llegar |
| `/avisos` | `app/avisos.tsx` | Avisos vigentes |
| `/card` | `app/card.tsx` | Mi tarjeta: lee el saldo por NFC (módulo `tullave`), tarjeta oscura con saldo animado, número oculto, resumen del mes, movimientos |
| `/cerca` | `app/cerca.tsx` | Paradas y estaciones a <1 km con sus próximos buses; «Verme en el mapa» |
| `/favoritos` | `app/favoritos.tsx` | Paradas y rutas guardadas; «Ordenar» sube/baja paradas (el orden manda en Inicio y la primera alimenta el widget) |
| `/personalizar/[id]` | `app/personalizar/[id].tsx` | Ponerle nombre a una parada (la guarda también en favoritos) |
| `/onboarding` | `app/onboarding.tsx` | Primera vez (fullScreenModal; `tm.onboarded.v1`); espera a que termine `Launch` |

### Transversal
- **Modo demostración** (`src/demo.ts`, interruptor en «Más › Pruebas»): buses de ejemplo para probar sin servicio. Descarga `demo/positions-1..8.pb` desde `raw.githubusercontent.com/…/main/demo/`, aplica un lote cada 20 s con la hora corrida a ahora y repite. No se guarda entre aperturas; al apagarlo saca los buses. `FeedStatus`, Inicio y Más dicen «Demostración» (morado), nunca «en vivo».
- **Pantalla de arranque** (`src/ui/Launch.tsx`): marca + cápsula LIVE, avenida con buses de arriba cruzando, línea de estado animada, y una insignia roja que se abre como ventana revelando la app (mín. 1,5 s, máx. 7 s). Respeta «Reducir movimiento».
- **Accesibilidad** (`src/accessibility.ts`): reducir movimiento/transparencia, más contraste, texto grande, mapa oculto a VoiceOver.
- **Estado honesto de los datos** (`src/ui/FeedStatus.tsx`): usa `liveLevel()`: «En vivo» si hay ≥50 buses con dato reciente; «En vivo · N buses a esta hora» si son pocos pero recientes; «Datos con retraso» si el último dato >5 min; «Sin datos en vivo» solo si no llega nada reciente.
- **Widget «Parada favorita»** (`targets/widget/Widget.swift`, `src/widgetSync.tsx`): pequeño/mediano y pantalla de bloqueo; muestra los próximos buses de la primera favorita con cuenta regresiva en vivo (`Text(date, style: .timer)`); un `entry` por cada llegada; abre `transmilive:///stop/ID`. Solo con `WIDGET=1`.
- **Capas del mapa** (`src/map/layers.ts`): semáforos (datos de `https://transmilive.com/semaforos.json`) y estaciones dibujadas (base, pasillo, vagones con puertas/número, nombre; tocar un vagón abre su parada). El tráfico en vivo aún **no** está en la app.
- **Enlaces**: esquema `transmilive://` (p. ej. `transmilive:///stop/ID`).

## APIs que consume (todas públicas, solo lectura)
- Función de Supabase `rapid-responder` (código en `supabase/functions/tm`): `/meta`, `/positions`, `/tripupdates`, `/alerts`, `/live?pos=&tu=&al=&wait=`.
- `raw.githubusercontent.com/itsandresortiz/transmi-live/live-data/` (`positions.pb`, `tripupdates.pb`, `alerts.pb`, `meta.json`, `gtfs-lite.zip`) y `…/schedule-data/` (horarios).
- OpenFreeMap (estilo `positron` y teselas), Photon/OSM (buscador de direcciones, `src/geocode.ts`), `transmilive.com/semaforos.json`.

- **Android (2026-11-11)**: las ventanas usan el encabezado propio `AppHeader` (título + X); «Mi tarjeta» muestra «Pronto en Android»; «Cerca de mí» avisa si la persona está lejos de Bogotá.

- **Web · anuncio de la app de iPhone**: tarjeta de una sola vez (`AppPromo.tsx`, enlace `APP_STORE_URL`) y grupo «App para iPhone» en Ajustes; oculto en Android hasta que la app esté en Google Play (entonces agregar su enlace ahí mismo).

- **Mensajes del dueño** (web y app desde 1.0.1): `mensajes.json` en la raíz del repo → línea de «En vivo» (deslizante) y primera tarjeta de Avisos, rotulado «Aviso de TransMi LIVE». Cómo escribirlos: clave `como_usarlo` y `ejemplo` dentro del mismo archivo.
