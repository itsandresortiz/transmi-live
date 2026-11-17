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

- **«Cómo llegar», cambiar de destino** (2026-11-14): elegir un destino y, sin salir, borrar y buscar otro (iPhone y Android); tocar un campo y cerrar el teclado sin escribir (deben volver las opciones).
- **Revisión 1.0.3** (2026-11-14, sin ver en teléfono): Android «Salir a las…» (tocar la hora, elegir, que no se reabra); «Voy en este bus» que termine solo si se baja con la app cerrada; aviso «viene con retraso»; volver a «Cómo llegar» tras un rato (resultados nuevos); primera apertura sin señal (que carguen las rutas al volver la señal).
- Sin arreglar de la revisión (dudosos o menores): el mapa podría volver a encuadrar la parada al cerrar una hoja; `plan()` sin número de secuencia (un resultado viejo podría pisar al nuevo si la ubicación tarda); «Mi ubicación» puede salir de una posición vieja (`getLastKnownPositionAsync` sin edad máxima); barra de estado oscura sobre el mapa oscuro; en Android, el botón atrás en la bienvenida; avisos de TransMilenio vencidos que siguen si el archivo no cambia; llegadas de un mismo bus fuera de orden con reportes de >3 min; «Cómo llegar» con origen igual al destino da una opción «A pie» de 0 m.
- **Bus en espera en el portal** (2026-11-14): en una plataforma de portal, el bus que espera para salir debe salir primero como «Por salir». Limitación: si esperan varios, se muestra uno (no se sabe cuál sale primero); un bus estacionado mucho rato en la plataforma también saldría como «Por salir».
- **Rodillo de los segundos** (2026-11-14): ver en Inicio, favoritos, cerca y la ficha de parada que solo rueden las cifras que cambian, sin cortes arriba/abajo (letra grande del «Próximo bus») y sin calentar el teléfono.
- **Bus en el que vas, resaltado en el mapa** (2026-11-14): con «Voy en este bus» y parada de bajada marcada, salir al mapa y ver el anillo en tu bus; tocarlo debe abrir tu viaje.
- **«Voy en este bus» con GPS** (2026-11-14): en un viaje real, con la parada de bajada marcada: ¿el bus va contigo en el mapa (sin saltos), cuadran «próxima parada» y los tiempos, suena «Bájate aquí» a tiempo? Probar también marcar un bus que no es (otro de la misma ruta) y bajarse antes: debe preguntar a los ~30 s. Ajustar umbrales (150 m, 3 m/s, 30 s) si pregunta de más o de menos.
- **«Cómo llegar» y avisos** (2026-11-14): Portal Suba → Calle 85 debe mostrar «7 + B11» (sin caminar) y no «a pie 2,7 km» de primera; «Bájate aquí» debe sonar una sola vez. **Comparar con la app oficial de TransMilenio**: Claude no tiene acceso a ella ni a su sitio desde el contenedor; el dueño puede mandar capturas de 10–20 viajes para contrastar.
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
- **Lector TuLlave en Android** (2026-11-11; ✅ compila desde 2026-11-17, `.aab` 26111701): probar en un **teléfono Android real con NFC** (el emulador no lee tarjetas): saldo, movimientos, «Cancelar», NFC apagado.
- **Android, viaje en curso y widget** (2026-11-12; ✅ compilan desde 2026-11-17): probar seguir un viaje y ver la notificación fija con la cuenta regresiva; agregar el widget «Parada favorita» a la pantalla de inicio (claro y oscuro), con buses en vivo y de noche con horas programadas. Limitación: Android refresca los widgets cada 30 min como mínimo; se actualiza al instante solo al abrir la app.
- **Android, pendientes**: cuenta de Google Play (pago único; las cuentas personales nuevas deben hacer una prueba cerrada ~12 personas × 14 días **(?)** confirmar), ficha, formulario de seguridad de datos (misma declaración que en Apple), firma del paquete (AAB) y política (ya hay).

- **Avisos legibles** (2026-11-17, sin ver en teléfono): abrir Avisos en la app y la web y ver que los títulos digan la ruta («Desvío de la ruta 539») y no números como «10194»; ver los dos cierres (De La Sabana, Zona Industrial) arriba y en las fichas de esas paradas y rutas. Comprobar en la app vieja (1.0.3/1.0.4) que salen como «Aviso de TransMi LIVE».
- **Cierres de De La Sabana y Zona Industrial** (17–23 nov): «Cómo llegar» con A60/C19 hacia el centro debe proponer bajarse en San Facón, y la E32 en CDS Cra. 32. La red de las apps se rearma a las 4:30 a. m.; el 24 vuelve sola a lo normal (la copia del teléfono puede tardar hasta 12 h).
- **Tiempos aprendidos en las llegadas**: medir de día (pico y valle) con `NODE_USE_ENV_PROXY=1 npx tsx tools/etaprecision.ts 720 8` (o el workflow «Medir precisión de los tiempos de llegada») y, si «aprendido» erra menos que «valor fijo», poner `PROFILE_USE = true` en `tools/hopstats.ts` (se enciende en web y apps sin versión nueva). Luego, usar el perfil también en «Cómo llegar» (`RIDE_MODEL` en `planner.ts`) y en el avance del bus.
- **Avisos en la ruta y el bus** (2026-11-17, sin ver en teléfono): ¿se ve bien el tramo ámbar punteado en el mapa de una ruta con desvío (y su texto «Desvío»)? ¿La marca «!» en los buses es clara y no estorba (¿demasiados buses marcados?)? Tarjeta ámbar en claro y oscuro. En la web (2026-11-17): tramo en el mapa de la ruta y marca «!» en los buses de cerca.
- **Widget de madrugada** (2026-11-17, sin ver): con la app abierta de noche y cerrada después, de madrugada el widget debe decir «Primer bus» y la hora (no «Sin datos ahora»), en iPhone y Android.
- **«Avísame cuando venga» y último bus** (2026-11-17, sin ver): en una parada, tocar una ruta → «Avisarme 5 min antes» → que suene una vez a tiempo (app abierta y cerrada) y abra la parada; cancelar. En Inicio, de noche, la tarjeta de una parada guardada debe decir «Último … a las …» en la última hora. «Voy en este bus» sin parada de bajada: ver la pantalla de bloqueo / isla dinámica (iPhone) y la notificación fija (Android) con la próxima parada. Ficha de vagón: tarjeta «¿En qué vagón para cada ruta?».
- **Semáforos** (`signal-stats`): datos acumulados sin uso en la app; idea: sumar segundos en cruces conocidos o explicar demoras. Desde 2026-11-17 se aprende por dirección del bus y el mapa explica cada cruce al tocarlo. **El dueño propondrá una validación con 2–3 cruces que ve en la calle.** Desde 2026-11-17 el mapa pone cada semáforo en su sitio (OpenStreetMap) donde se sabe (70 %); faltan ~2.000 semáforos en cruces donde OpenStreetMap tiene menos que el dato oficial (se podrían inferir por los brazos del cruce) y aprender por semáforo (línea de pare) en vez de por cruce.

## Bugs conocidos / limitaciones
- Rutas con un código por sentido (261 de 668 nombres): el mapa ya junta los dos sentidos (`routeFamily`), y el buscador de la app muestra una sola fila por nombre (2026-11-13). Falta: una sola ficha con selector de sentido (hoy es un enlace «Ver el sentido contrario») y lo mismo en la web y en favoritos.
- Sin conexión: el mapa base depende de internet (solo se ven las zonas que el teléfono ya tenía guardadas); rutas, paradas y horarios sí abren con la copia del teléfono. Idea: guardar un mapa base mínimo de Bogotá dentro de la app.
- ✅ (2026-11-11) Avisos con nombre de ruta y sin prefijo «TM_».
- ✅ (2026-11-12) Llegadas: el bus que ya debió pasar no se anuncia. **Pendiente**: la app anuncia la llegada ~40 s antes de lo real en hora pico (buses más lentos que el tiempo fijo por parada); repetir `eta-precision.yml` (ya corregido) en pico, valle y noche y decidir un factor por franja, o usar el perfil de `hop-stats`.
- Mensajes del dueño: tardan ~5 min (caché de GitHub); si hace falta inmediato, servirlos por la función de Supabase.
- **Apps publicadas (iOS 1.0.0 y el paquete Android 26111114)** no traen las correcciones del 2026-11-11: muestran 0 avisos y, si el intermediario falla, pueden tomar una copia de respaldo vieja y atrasar la hora. Mitigado del lado de los datos (respaldo fresco y vigilado); se corrige del todo con una versión nueva (iOS: la 1.0.1 fue aprobada por Apple; la 1.0.2, enviada a revisión el 2026-11-14, trae además lo del 2026-11-13; el arreglo de «Cómo llegar» del 2026-11-14 va en la 1.0.3).
- ✅ (2026-11-11) `hop-stats` reactivado con posiciones y relanzamiento propio. Pendiente: tras unos días de datos, comparar el perfil por ruta/franja contra el valor fijo de segundos por parada y decidir si se usa en el ETA y en el adelanto del bus.
- La actividad en vivo del viaje no cambia de paso con la app cerrada (no hay push): muestra el último paso y su cuenta regresiva.
- «Seguir este viaje»: solo se conoce el bus real del primer tramo (los demás van por hora estimada); con la app cerrada no se corrige el atraso.
- ✅ (2026-11-10) Buses sin próxima parada: era un error de ubicación en rutas de ida y vuelta, no falta de rutas. Hoy ~3 % sin próxima parada (fuera de recorrido, final de ruta). Queda ~1,7 % con tramos absurdos entre paradas (>3 km) en rutas largas circulares (`projectAfter` no encuentra la primera pasada a ≤40 m). Solo ~5 % de los buses trae puntualidad.
- Otras rutas con orden de paradas desactualizado (como H15/Calle 57): agregar a `STOP_PATCHES` cuando el dueño lo confirme (H20, H27, A60… paran en Calle 53; **no verificado** si paran en Calle 57).
- Buses que van en servicio pero no vienen en los datos de TransMilenio (casos GUV978 y el B11 «A1438»=GUV956 del 2026-11-14, confirmados con tres lotes): no hay cómo dibujarlos para los demás; ✅ (2026-11-14, sin probar) el tuyo sí, con «¿En qué bus vas?» y el viaje con GPS. Probar: lista de candidatos con el bus en marcha (¿sale el tuyo primero?), elegir una ruta, marcar parada, avisos y que el bus vaya contigo en el mapa. Las rutas troncales vienen sin «hacia» (el GTFS no trae headsign): se ve el nombre de la ruta.
- ~80 vagones de 602 siguen con «ningún bus viene» aunque hay buses de sus rutas en la calle (sobre todo extremos norte: Toberín, Calle 187); no se confirmó uno por uno.
- Notificaciones del viaje en segundo plano: iOS suspende la app, quedan con la última hora calculada (idea: Live Activity / Dynamic Island).
- Widget: se actualiza solo desde la rama `widget-data`, pero iOS decide cada cuánto lo deja refrescar (se le pide cada 5 min; suele dar cada 15 min o más) y GitHub guarda copia unos minutos. La cuenta `widgetShard` está repetida en TS y Swift.
- Causa raíz de por qué `formSheet` con listas sale en negro en iOS 27.2: **no investigada** (se evitó usándolo).
- Avisos amarillos inofensivos en la terminal: «Image … is not present in style, cannot remove» (MapLibre) y `style` obsoleto en otras capas si se agregan nuevas (usar `sp()`).
- El mapa de la app mueve los buses por saltos (GeoJSON a 4 Hz); no hay interpolación nativa. Mejora grande posible: capa nativa o canvas propio.
- `README.md` raíz y `docs/TESTFLIGHT.md` describen el camino antiguo con Capacitor; actualizar.

- **Comparar con datos oficiales de TransMilenio** (2026-11-14; actualizado 2026-11-17: el dueño dio permiso, pero su servidor de datos responde «Acceso denegado» fuera de su página; ver `05`): su web no planea viajes; su «Buscador de Servicios» (buscador-rutas.transmilenio.gov.co) tiene paradas, horarios y mapa de cada estación. Haría falta que TransMilenio dé acceso; con eso se puede revisar el orden de paradas del GTFS (p. ej. H15/Calle 57) y los horarios. Para «Cómo llegar» la referencia es la app oficial (capturas del dueño).

## Deuda técnica
- ✅ (2026-11-14, **sin probar en el Mac**) iOS: el número de compilación ya sale de la fecha para la app y el widget (`TM_BUILD_NUMBER`). Comprobar en la próxima entrega que Transporter muestre un número con la fecha y no «3» o «4».
- Abrir la app procesa la red en el hilo principal. ✅ (2026-11-17) Formato compacto `network2.json.gz` (la mitad de peso, ~2× más rápido de leer). Queda armar la red (`buildNetwork`, ~56 ms en Node) y las formas de estaciones (~32 ms); medir en un teléfono lento antes de seguir.
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
