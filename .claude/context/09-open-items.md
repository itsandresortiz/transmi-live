# 09 · Pendientes, bugs conocidos, deuda e ideas

Estado al 2026-11-10 (último commit de código: `5f6a0fa`). Marcar con ✅ y mover a `08-changelog.md` cuando se resuelva.

## Por probar con el dueño (no verificado en dispositivo)
- **Modo demostración**: activarlo de noche y revisar mapa (buses de arriba moviéndose), paradas con llegadas, «Seguir bus», «Voy en este bus» (escena y avisos). Al terminar el ciclo de 8 lotes los buses saltan atrás ~10 min (esperado).
- Vidrio «clear» sobre el mapa: ¿se lee el texto oscuro sobre zonas oscuras del mapa (líneas rojas, buses)? Si no, volver a «regular» o añadir un velo muy leve.
- **Escena de «Voy en este bus»** (`RideScene`): se prototipó en el navegador (CSS) y se pasó a React Native con `perspective`/`rotateX`/`transformOrigin`; **no se ha visto en el simulador**: revisar posición del bus sobre su carril, velocidad del suelo y fundidos, en claro y oscuro.
- Buses sin borde blanco: ¿se distinguen bien sobre el mapa claro y sobre las líneas rojas de las troncales?
- Compilación con widget (`WIDGET=1`): el Swift compiló en Xcode (simulador), falta TestFlight y el App Group/ID del widget en la cuenta de Apple (puede pedir pasos manuales en developer.apple.com).
- **Buses vistos desde arriba** en la app (nuevas imágenes) y en la web: comprobar tamaño (¿más grandes?) y orientación sobre el mapa real.
- Mapa de la app tras migrar capas a `paint`/`layout`: colores, textos, estaciones y semáforos (si no aparecen los semáforos, revisar que `transmilive.com/semaforos.json` exista; desde el contenedor no se puede abrir).
- «Seguir en el mapa» / «Seguir este bus» tras la corrección del `fitBounds` con un punto (era la causa probable de la caída del 2026-11-09 23:29).
- Rendimiento: ¿baja el calor/CPU tras el prefiltro de buses? Si vuelve un aviso de uso de CPU, mandar el `.ips`.
- Mapa: cristal que «se iba» (se refresca al volver del segundo plano) — confirmar.
- Cierre de ventanas con la X nativa y enlaces directos (`transmilive:///stop/ID`) con el inicio debajo.
- Probar todo lo que depende de buses **de día** (de noche el servicio termina): llegadas, «Seguir bus», «Voy en este bus» (avisos), widget con tiempos.

## Bugs conocidos / limitaciones
- ~1.000 buses (≈20 %) sin próxima parada: su ruta no existe en el GTFS publicado (el GTFS va por detrás del feed). Solo ~5 % de los buses trae puntualidad.
- Otras rutas con orden de paradas desactualizado (como H15/Calle 57): agregar a `STOP_PATCHES` cuando el dueño lo confirme (H20, H27, A60… paran en Calle 53; **no verificado** si paran en Calle 57).
- ~80 vagones de 602 siguen con «ningún bus viene» aunque hay buses de sus rutas en la calle (sobre todo extremos norte: Toberín, Calle 187); no se confirmó uno por uno.
- Notificaciones del viaje en segundo plano: iOS suspende la app, quedan con la última hora calculada (idea: Live Activity / Dynamic Island).
- El widget envejece si no se abre la app (rotula «Datos de hace X min»).
- Causa raíz de por qué `formSheet` con listas sale en negro en iOS 27.2: **no investigada** (se evitó usándolo).
- Avisos amarillos inofensivos en la terminal: «Image … is not present in style, cannot remove» (MapLibre) y `style` obsoleto en otras capas si se agregan nuevas (usar `sp()`).
- El mapa de la app mueve los buses por saltos (GeoJSON a 4 Hz); no hay interpolación nativa. Mejora grande posible: capa nativa o canvas propio.
- `README.md` raíz y `docs/TESTFLIGHT.md` describen el camino antiguo con Capacitor; actualizar.

## Deuda técnica
- Duplicados: `apps/mobile/src/format.ts`, `stopname.ts`, `lastService.ts`, `planner/format.ts` vs sus equivalentes en `apps/web/src/ui/` → mover a `packages/application`.
- La app no tiene caché propia de red (la web sí).
- `apps/web/src/map/sprites.ts` conserva `busSprite` (bus de lado, ya sin uso) y `MapController.ts` lo importa sin llamarlo: limpiar.
- Se necesita revisar `apps/web/public/privacidad.html` (escrita por Claude; el dueño debe revisarla; menciona NFC/ubicación).
- `app.json` + `app.config.js` conviven (el segundo extiende al primero).
- Corrección de rutas: la función `reconcileLastStops` cuesta ~350 ms con 5.000 buses en el primer lote (Node); medir en teléfono.

## Ideas / próximos pasos
1. **Rediseño «más pro» (en curso: hecha la pantalla «Voy en este bus»; faltan bienvenida ilustrada, cabeceras ilustradas de ruta/estación y hojas de consejo)**: referencia de otra app de trenes con (a) pantalla de bienvenida con ilustración e imagen grande, (b) cabecera ilustrada en la ficha del viaje, (c) hoja «Llegando a …» con **fondo que se mueve como si el vehículo avanzara** y **bordes desvanecidos**, barra de progreso en segmentos, recordatorio «avísame a 5 min», (d) hoja de consejo con ilustración y «Entendido». Aplicar a: pantalla de arranque, «Voy en este bus» (fondo animado + progreso por paradas), ficha de ruta/estación, avisos. Pedir al dueño capturas o descripciones (Claude no ve video).
2. Widget: más tamaños (varias paradas), configuración por parada, y datos frescos (publicar llegadas por parada desde un workflow, o refresco en segundo plano).
3. Live Activity / Dynamic Island para «Voy en este bus».
4. Aprender el orden de paradas de cada ruta desde el feed (arregla el desfase del GTFS sin parches).
5. Capa de tráfico en vivo en la app (la web la tiene), modo oscuro del mapa base, modo «seguir mi ubicación».
6. Android (NFC, widgets) y publicación en App Store.
7. Medición larga (horas, hora pico) de la precisión del ETA; hoy mediana ~26–32 s con 12 lotes.
8. Optimizar el mapa de la app con una capa nativa para movimiento fluido.

## Pasos que dependen del dueño
- Desplegar a mano cualquier cambio en `supabase/functions/tm`.
- Compilar/subir a TestFlight, agregar testers, dar el sí a cada publicación.
- Revisar `privacidad.html` y confirmar el dominio `transmilive.com` (CNAME).
