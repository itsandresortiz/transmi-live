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

- **«Seguir este viaje»** (nuevo): probar un viaje real con trasbordo; ¿los avisos llegan a tiempo?, ¿avanza de paso al llegar a la parada / subir / bajar?, ¿el aviso abre el viaje?
- Interruptores centrados (`Toggle`), tarjeta «Vas en este bus» en el mapa, aviso del viaje que abre el viaje: sin ver en teléfono.

- Nombres de estaciones/portales con color de línea en el mapa de la app: si **no aparecen los nombres**, el mapa base no tiene «Noto Sans Bold»: volver a «Noto Sans Regular» en `TransitMap.tsx`.

- Buses más fluidos (hasta 15 veces/s de cerca): revisar que el teléfono no se caliente; si vuelve el aviso de CPU, subir los valores de `cadenceMs`.
- Mapa oscuro y capa de tráfico en la app: revisar lectura de controles y textos sobre el mapa oscuro. Tráfico animado: revisar que no se cierre la app al encenderlo ni caliente el teléfono.

- **Actividad en vivo del viaje** (pantalla de bloqueo / isla dinámica): código nativo nuevo sin compilar. Si la compilación falla, mandar el bloque de errores; el módulo `modules/tripactivity` se compila siempre (también sin `WIDGET=1`).

- **Android (primer paso)**: probar en el emulador con `bash apps/mobile/scripts/android-emulador.sh`: ¿abre?, ¿se ven los iconos y la barra inferior?, ¿el mapa, el buscador y Cómo llegar?, ¿se cierran las ventanas con la flecha de atrás?, ¿llegan los avisos del viaje? Revisar sombras de las tarjetas (en Android hace falta `elevation`), el efecto de cristal (sin él) y el teclado.
- **Android, segunda prueba** (sin ver en emulador): vía de «Voy en este bus» bajo el bus, encabezado nuevo con X en todas las ventanas (¿queda bien con la barra de estado, en claro y oscuro?), «Cerca de mí» con la ubicación del emulador puesta en Bogotá, «Mi tarjeta» con «Pronto en Android».
- **Android, repaso de diseño** (sin ver): sombras de tarjetas, controles sobre el mapa (¿se leen?, ¿queda hueco de más entre los botones de abajo del mapa y la barra inferior? `mapa.tsx` usa `insets.bottom + 80` pensado para la barra flotante de iPhone), barra inferior, interruptores, teclado en «Personalizar parada» (`KeyboardAvoidingView` sin comportamiento en Android).
- **Google Play**: ✅ (2026-11-11) `playstore-local.sh` funcionó en el Mac del dueño (llave creada, «Firma correcta», `.aab` en el Escritorio). Falta: crear la app en Play Console, subir el `.aab` a prueba interna y llenar la ficha.
- **Lector TuLlave en Android** (2026-11-11, escrito sin compilar): compilar con `android-emulador.sh` (si falla Kotlin, mandar el bloque de errores) y probar en un **teléfono Android real con NFC** (el emulador no lee tarjetas): saldo, movimientos, «Cancelar», NFC apagado.
- **Android, pendientes**: widget (Glance), notificación fija para el viaje en lugar de la isla dinámica, cuenta de Google Play (pago único; las cuentas personales nuevas deben hacer una prueba cerrada ~12 personas × 14 días **(?)** confirmar), ficha, formulario de seguridad de datos (misma declaración que en Apple), firma del paquete (AAB) y política (ya hay).

## Bugs conocidos / limitaciones
- Sin conexión: el mapa base depende de internet (solo se ven las zonas que el teléfono ya tenía guardadas); rutas, paradas y horarios sí abren con la copia del teléfono. Idea: guardar un mapa base mínimo de Bogotá dentro de la app.
- ✅ (2026-11-11) Avisos con nombre de ruta y sin prefijo «TM_».
- ✅ (2026-11-12) Llegadas: el bus que ya debió pasar no se anuncia. **Pendiente**: la app anuncia la llegada ~40 s antes de lo real en hora pico (buses más lentos que el tiempo fijo por parada); repetir `eta-precision.yml` (ya corregido) en pico, valle y noche y decidir un factor por franja, o usar el perfil de `hop-stats`.
- Mensajes del dueño: tardan ~5 min (caché de GitHub); si hace falta inmediato, servirlos por la función de Supabase.
- **Apps publicadas (iOS 1.0.0 y el paquete Android 26111114)** no traen las correcciones del 2026-11-11: muestran 0 avisos y, si el intermediario falla, pueden tomar una copia de respaldo vieja y atrasar la hora. Mitigado del lado de los datos (respaldo fresco y vigilado); se corrige del todo con una versión nueva (1.0.1).
- ✅ (2026-11-11) `hop-stats` reactivado con posiciones y relanzamiento propio. Pendiente: tras unos días de datos, comparar el perfil por ruta/franja contra el valor fijo de segundos por parada y decidir si se usa en el ETA y en el adelanto del bus.
- La actividad en vivo del viaje no cambia de paso con la app cerrada (no hay push): muestra el último paso y su cuenta regresiva.
- «Seguir este viaje»: solo se conoce el bus real del primer tramo (los demás van por hora estimada); con la app cerrada no se corrige el atraso.
- ✅ (2026-11-10) Buses sin próxima parada: era un error de ubicación en rutas de ida y vuelta, no falta de rutas. Hoy ~3 % sin próxima parada (fuera de recorrido, final de ruta). Queda ~1,7 % con tramos absurdos entre paradas (>3 km) en rutas largas circulares (`projectAfter` no encuentra la primera pasada a ≤40 m). Solo ~5 % de los buses trae puntualidad.
- Otras rutas con orden de paradas desactualizado (como H15/Calle 57): agregar a `STOP_PATCHES` cuando el dueño lo confirme (H20, H27, A60… paran en Calle 53; **no verificado** si paran en Calle 57).
- ~80 vagones de 602 siguen con «ningún bus viene» aunque hay buses de sus rutas en la calle (sobre todo extremos norte: Toberín, Calle 187); no se confirmó uno por uno.
- Notificaciones del viaje en segundo plano: iOS suspende la app, quedan con la última hora calculada (idea: Live Activity / Dynamic Island).
- Widget: se actualiza solo desde la rama `widget-data`, pero iOS decide cada cuánto lo deja refrescar (se le pide cada 5 min; suele dar cada 15 min o más) y GitHub guarda copia unos minutos. La cuenta `widgetShard` está repetida en TS y Swift.
- Causa raíz de por qué `formSheet` con listas sale en negro en iOS 27.2: **no investigada** (se evitó usándolo).
- Avisos amarillos inofensivos en la terminal: «Image … is not present in style, cannot remove» (MapLibre) y `style` obsoleto en otras capas si se agregan nuevas (usar `sp()`).
- El mapa de la app mueve los buses por saltos (GeoJSON a 4 Hz); no hay interpolación nativa. Mejora grande posible: capa nativa o canvas propio.
- `README.md` raíz y `docs/TESTFLIGHT.md` describen el camino antiguo con Capacitor; actualizar.

## Deuda técnica
- Abrir la app procesa `network.json.gz` (leer ~18 MB de JSON + armar la red) en el hilo principal: en teléfonos lentos puede congelar la app unos segundos. Si se nota, mover a un hilo aparte o guardar un formato más compacto/binario.
- La web sigue leyendo `gtfs-lite.zip` (17 MB, en un Web Worker); podría usar `network.json.gz` como la app.
- Rendimiento: lo que queda más caro por lote es `applyPositions` (~38 ms en Node; en un teléfono lento puede notarse como un tirón cada ~20 s) y «Cómo llegar» (190–350 ms en Node). No se ha medido en un teléfono lento real.
- `packages/application/src/trunk-data.ts` copia `apps/web/src/data/troncales.json` y los portales de `estaciones.json`: hacer que la web lea del mismo sitio.
- Duplicados: `apps/mobile/src/format.ts`, `stopname.ts`, `lastService.ts`, `planner/format.ts` vs sus equivalentes en `apps/web/src/ui/` → mover a `packages/application`.
- `apps/web/src/map/sprites.ts` conserva `busSprite` (bus de lado, ya sin uso) y `MapController.ts` lo importa sin llamarlo: limpiar.
- Se necesita revisar `apps/web/public/privacidad.html` (escrita por Claude; el dueño debe revisarla; menciona NFC/ubicación).
- `app.json` + `app.config.js` conviven (el segundo extiende al primero).
- Corrección de rutas: la función `reconcileLastStops` cuesta ~350 ms con 5.000 buses en el primer lote (Node); medir en teléfono.

## Ideas / próximos pasos
1. **Rediseño «más pro» (en curso: hecha la pantalla «Voy en este bus»; faltan bienvenida ilustrada, cabeceras ilustradas de ruta/estación y hojas de consejo)**: referencia de otra app de trenes con (a) pantalla de bienvenida con ilustración e imagen grande, (b) cabecera ilustrada en la ficha del viaje, (c) hoja «Llegando a …» con **fondo que se mueve como si el vehículo avanzara** y **bordes desvanecidos**, barra de progreso en segmentos, recordatorio «avísame a 5 min», (d) hoja de consejo con ilustración y «Entendido». Aplicar a: pantalla de arranque, «Voy en este bus» (fondo animado + progreso por paradas), ficha de ruta/estación, avisos. Pedir al dueño capturas o descripciones (Claude no ve video).
2. Widget: más tamaños (varias paradas), configuración por parada, y datos frescos (publicar llegadas por parada desde un workflow, o refresco en segundo plano).
3. Live Activity también para «Voy en este bus» (hoy solo para «Seguir este viaje») y actualizarla con la app cerrada (requiere push y servidor).
4. Aprender el orden de paradas de cada ruta desde el feed (arregla el desfase del GTFS sin parches).
5. Capa de tráfico en vivo en la app (la web la tiene), modo oscuro del mapa base, modo «seguir mi ubicación».
6. Android (NFC, widgets) y publicación en App Store.
7. Medición larga (horas, hora pico) de la precisión del ETA; hoy mediana ~26–32 s con 12 lotes.
8. Optimizar el mapa de la app con una capa nativa para movimiento fluido.

## Pasos que dependen del dueño
- App Store: aprobada el 2026-11-11; falta que el dueño la libere (liberación manual). Antes de promocionarla, resolver la capacidad del proxy de Supabase (ver deuda).
- Google Play: enviar la versión de producción a revisión («Resumen de publicación»).
- Desplegar a mano cualquier cambio en `supabase/functions/tm`.
- Compilar/subir a TestFlight, agregar testers, dar el sí a cada publicación.
- Revisar `privacidad.html` y confirmar el dominio `transmilive.com` (CNAME).
