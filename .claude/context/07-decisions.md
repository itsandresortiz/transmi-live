# 07 · Decisiones importantes

Formato: **Decisión** · contexto · alternativa descartada · por qué. (Más nuevas arriba.)

## 2026-11
- **Cómo llegar prefiere subir más cerca aunque se llegue hasta 3 min después** · el dueño estaba junto al Portal Suba y el plan lo mandaba a La Campiña. Descartado: dejar solo «la llegada más temprana» (diferencias de segundos, dentro del error del cálculo, decidían caminatas más largas) o penalizar la caminata dentro del buscador (cambiaba las horas mostradas).
- **«Seguir este viaje» sin ubicación en segundo plano** · los avisos de cada paso son notificaciones locales programadas a la hora estimada; con la app abierta se corrigen con la ubicación y el bus en vivo. Descartado: pedir ubicación «siempre» (permiso delicado, revisión de Apple, batería). Límite: con la app cerrada, si el bus se atrasa el aviso puede salir antes de tiempo. Mejora posible: Live Activity.
- **No unificar Inicio y Mapa (por ahora)** · se evaluó un inicio tipo Apple Maps (mapa a pantalla completa + hoja baja). El dueño decidió no hacerlo todavía: exige una hoja propia arrastrable (la nativa sale en negro), más consumo de batería y varias rondas de ajuste. En su lugar se mejoró Inicio y se llevó lo «vivo» allí (próximos buses de las favoritas, píldora en vivo).
- **Buses vistos desde arriba, con un solo dibujo para web y app** · el dueño los quería «como desde arriba». Se escribió `busTop.ts` (canvas 2D) y las imágenes de la app salen de ese mismo código con Playwright (`tools/bus-sprites.ts`). Descartado: sprites de lado espejados (se veían mal en curvas) y dibujar a mano dos versiones (se desalinean).
- **`lastStopId` se corrige con la posición del bus** · medido: 73 % de los buses estaban a >3 km de su «última parada». Se reemplaza en `applyPositions` solo cuando no concuerda, y solo si el bus trae una. Descartado: confiar en el feed (dejaba ~20 % de estaciones con «ningún bus viene») o inventar paradas para todos (rompía una prueba de movimiento).
- **Correcciones puntuales al GTFS en `patches.ts`, que se apagan solas** · el GTFS publicado va por detrás de la calle (H15 no trae Calle 57). Descartado: editar el zip a mano o aprender el orden de paradas desde el feed (queda como idea grande en `09-open-items.md`).
- **Nombres nuevos de estación vía paradas sin ruta** · «Calle 53 - Universidad Manuela Beltrán» no tiene rutas en el GTFS pero está sobre las paradas «Calle 53 A…C»; también «Marly» (estación temporal anterior) encuentra esa estación al buscar. Solo cuentan registros **sin código** y <80 m.
- **Widget opcional con `WIDGET=1`** · el Swift nunca se había compilado; para que una falla de la extensión no bloquee las pruebas del resto, se activa por variable de entorno (`app.config.js`). Descartado: incluirlo siempre.
- **El widget lee un snapshot que deja la app en el App Group** (no hace red propio) · evita un servidor por usuario; límite: los datos envejecen si no se abre la app (el widget lo dice tras 20 min). Siguiente paso posible: publicar llegadas por parada desde un workflow o refrescar en segundo plano.
- **Notificaciones del viaje = locales, sin push** · no requiere servidor ni el permiso de push de Apple (`plugins/sin-push.js` quita `aps-environment`). Límite: en segundo plano quedan con la última hora calculada.
- **Todas las ventanas de la app son `modal` con X nativa** · `formSheet` con listas salía en negro en iOS 27.2 y la X dibujada por la app fallaba (4–5 toques). Descartado: arreglar `formSheet` caso por caso.
- **Capas del mapa siempre montadas** · agregar/quitar capas en caliente tumbó la app (registro de caída). Descartado: renderizado condicional.
- **Menos buses calculados por tanda** (`useBuses`: prefiltro por último reporte, frecuencia por zoom, poda del motor) · el registro de uso de CPU mostró 51 % de CPU y +259 MB. Descartado: bajar a 2 Hz fijo (se veía a saltos).
- **Estado «en vivo» = hay buses**, no «el lote es reciente» · el retraso normal de TransMilenio (1–3 min) hacía decir «sin datos» con miles de buses.
- **Estaciones dibujadas y semáforos en la app como en la web** · `station-geometry.ts` se movió a `packages/application`. Semáforos desde `transmilive.com/semaforos.json` (no se empaquetan para no inflar la app).
- **Estado de capas, apodos y favoritos solo en el aparato** · sin cuentas, por privacidad y simplicidad.

## 2026-11-09 · app nativa
- **Expo + React Native en vez de Capacitor** · el dueño quería «app real», no la web empaquetada; DDD ya separaba el dominio, así que se reutiliza `packages/*`. Descartado: Capacitor (quedó la guía antigua en `docs/TESTFLIGHT.md`), Flutter/Swift puro (rehacer el dominio).
- **MapLibre React Native (OpenFreeMap) en vez de Mapbox** · sin llave ni costo; mismo motor que la web.
- **`NativeTabs` + `expo-glass-effect`** · barra inferior de vidrio líquido nativa, pedida por el dueño.
- **Compilar en el Mac del dueño con Transporter, no EAS** · el dueño tiene Xcode y prefiere controlar firma y subida; `eas.json` queda como opción.
- **Lectura NFC con un módulo Swift propio (Core NFC)** · no había librería que devolviera las respuestas crudas de la TuLlave; el análisis queda en TS con pruebas.
- **No usar APIs privadas ni suplantar** · solo datos abiertos y la tarjeta leída por el propio usuario.

## Antes (web, 2026-11-04…08)
- **DDD en TypeScript, monorepo** · dominio sin dependencias reutilizable por web y móvil.
- **Proxy de Supabase + respaldo en rama `live-data`** · TransMilenio no tiene CORS; el respaldo evita depender de un solo servicio. Endpoint `live` que espera cambios (de ~34.000 a ~4.000 invocaciones/día por persona).
- **GTFS reducido (`gtfs-lite.zip`)** · el original pesa ~116 MB; la app solo necesita rutas, paradas y trazados.
- **Movimiento: ganancia 0,5** · óptimo medido con 10 lotes y ~6.000 buses (0,3 → 88 m, 0,5 → 87 m, 0,9 → 98 m).
- **ETA desde la posición del bus, no solo desde la última parada** · error mediano 34–37 s vs 44–57 s.
- **Sin tiempos aprendidos por aparato** (`TravelTimes.apply = false`) · dos aparatos mostraban tiempos distintos (mediana 125 s de diferencia) y erraba más que el valor típico.
- **Reloj del servidor, no del aparato** · todos los dispositivos muestran el mismo tiempo (`clock.ts`).
- **Quitar del mapa buses con >10 min sin reportar** · evita mostrar buses congelados cuando el feed se atasca.
- **Vagón = letra del nombre de la parada** · verificado con rutas conocidas (La Campiña: H15 vagón 3, la 7 vagón 1).
- **Copiar de otro repo de referencia solo ideas, sin escribir en él** · accesibilidad, contraste, estado del feed, bienvenida, apodos, reportes, política de privacidad.

## 2026-11-11 · Avisos de TransMilenio con periodo de segundos
- **Contexto**: el feed pasó a publicar los avisos con inicio y fin separados por segundos (la hora del reporte), todos ya «vencidos»; la app mostraba 0 de 431.
- **Decisión**: si el periodo dura menos de 5 min se trata como «reportado a esa hora» y se muestra durante 6 h con el texto «Reportado hoy a las …». Los avisos con periodo largo siguen la regla estricta.
- **Descartado**: mostrar todo lo que venga en el feed (431 novedades, algunas de la madrugada, parecerían de ahora) o no mostrar nada.
- **Por revisar**: si 6 h es mucho o poco (decisión de producto del dueño) y si el feed vuelve al formato anterior.

## 2026-11-11 · Adelanto de los buses con el dato un minuto atrasado
- **Contexto**: TransMilenio pasó de entregar la posición con ~4 s de edad a ~55–60 s, y cada bus cambia cada ~60 s. Con el tope de 90 s el bus quedaba quieto buena parte del tiempo y el error mediano subió de 87 m a ~172 m.
- **Decisión**: ganancia 0,4 y tope 150 s (166 m de mediana, mejor p90, y el bus no se congela).
- **Descartado**: mantener 0,5 con tope largo (178 m), subir la ganancia (peor en todo), 0,3 (algo menos de error mediano pero el bus queda 100 m atrás).
- **Por revisar**: solo se midió en hora pico; en valle los buses van más rápido y podría convenir más ganancia. Usar el perfil de `hop-stats` por ruta y franja cuando haya datos.

## 2026-11-12 · Cuándo dar un bus por pasado en una parada
- **Contexto**: con el dato un minuto atrasado, la mitad de los buses que decían «llegando» ya se habían ido.
- **Decisión**: si la cuenta a la parada venció hace más de 60 s, el bus no se anuncia en esa parada (77 % de probabilidad de que ya pasó).
- **Descartado**: quitarlo apenas vence (solo 34 % había pasado en los primeros 30 s: se esconderían buses que sí vienen) o dejarlo siempre (lo que había).
- **Costo conocido**: cerca de 1 de cada 4 buses que se quitan sí seguía viniendo (trancón); reaparece si su siguiente reporte lo muestra antes de la parada.

## 2026-11-13 · Duales fuera del modo «TransMilenio» en «Cómo llegar»
- **Contexto**: «TransMilenio» incluía troncales y duales; el dueño vio el MC84 (dual, para en paraderos) y lo tomó por un error. La app oficial no muestra duales al filtrar por TransMilenio.
- **Decisión**: cuarto modo «Dual», prendido por defecto con los demás; «TransMilenio» = solo troncales.
- **Descartado**: renombrar a «TransMilenio y duales» (no permitía excluirlos) o quitar los duales (son rutas reales y a veces la mejor opción).

## 2026-11-14 · El bus en el que vas se dibuja con el GPS del teléfono, solo en el teléfono
- **Contexto:** TransMilenio entrega cada posición con ~1 min de atraso; en «Voy en este bus» el bus se veía atrás (o adelantado por la predicción) y los avisos de bajada se corrían.
- **Decisión:** mientras la app está abierta y el GPS confirma que vas sobre la vía y cerca de donde puede ir el bus, el bus se dibuja donde vas tú y las paradas/tiempos se cuentan desde ahí; si no cuadra un rato estando en movimiento, se pregunta.
- **Descartado:** (1) seguir la ubicación con la app cerrada (pide el permiso «Siempre», más fricción y revisión de Apple); (2) enviar las ubicaciones a un servidor para aprender rutas y tiempos (exige consentimiento, cambiar las declaraciones de privacidad y un servidor; con pocos usuarios aporta poco: los tiempos ya se aprenden con `hop-stats` usando solo datos de TransMilenio).

## 2026-11-17 · No forzar el acceso al buscador de TransMilenio
- **Contexto**: el dueño pidió usar las paradas oficiales, horarios y mapas de estación del «Buscador de Servicios». Su servidor responde 403 a todo lo que no venga de su página.
- **Descartado**: mandar las consultas haciéndose pasar por su página (cambiando el origen de la consulta). Funcionaría, pero es saltarse un control de acceso y va contra la regla de no suplantar a TransMilenio.
- **Por qué**: se usa solo lo que es abierto (GTFS, datos en vivo). Para lo demás: pedir acceso a TransMilenio o capturas del dueño.

## 2026-11-17 · Los tiempos aprendidos se encienden desde los datos
- **Contexto**: el perfil por tramo (`hop-stats`) aún no se midió de día contra el valor fijo; en 2026-11-11 lo aprendido en cada teléfono erraba más que el fijo.
- **Descartado**: encenderlo de una vez en el código de la app (si empeora, hace falta una versión nueva para apagarlo).
- **Por qué**: el archivo publicado trae `use`; la app lo obedece. Se mide, y se enciende o apaga cambiando una línea en `tools/hopstats.ts`.

## 2026-11-17 · Cierres temporales en el código, aplicados a la red publicada
- **Contexto**: TransMilenio anuncia cierres de vagones solo en redes; ni el GTFS ni los avisos en vivo los traen.
- **Descartado**: solo un mensaje en `mensajes.json` (avisa, pero «Cómo llegar» seguiría mandando al vagón cerrado) o arreglarlo solo en el código de la app (las versiones publicadas no lo tendrían).
- **Por qué**: con fechas en `patches.ts`, el workflow diario rearma `network.json.gz` con el cambio (llega a todas las apps) y se deshace solo al vencer. El anuncio va en la red (`notices`) y, para apps viejas, en `mensajes.json`.

## 2026-11-17 · Avisos: deducir la ruta, nunca mostrar el número interno
- **Contexto**: los avisos traen números de ruta que no están en el GTFS.
- **Descartado**: mostrar el número (nadie lo entiende) o adivinar la ruta más probable cuando varias pasan por ahí.
- **Por qué**: solo se nombra una ruta si es la única que pasa por esas paradas en ese orden (cruzando los avisos del mismo número); si hay pocas posibles se dicen todas, y si no, «una ruta zonal».

## 2026-11-17 · El último bus se muestra en la app, no como notificación
- **Contexto**: se hizo un aviso diario 20 min antes del último bus de las paradas guardadas.
- **Descartado**: la notificación diaria (el dueño: «decirle todos los días se vuelve cansón»).
- **Por qué**: la tarjeta de la parada en Inicio dice «Último … a las …» solo en la última hora; quien lo necesita lo ve sin que le llegue nada.

## 2026-11-17 · El color «en vivo» de un semáforo no se muestra a los usuarios
- **Contexto**: con el ciclo medido a mano se puede predecir el color de un semáforo de tiempo fijo (la prueba del dueño coincidió con la calle).
- **Descartado**: mostrarlo a todos en el mapa. Alguien podría cruzar o arrancar guiándose por la app; el plan cambia según la hora y Movilidad puede ajustarlo sin aviso.
- **Por qué**: queda como herramienta del dueño (modo de pruebas) para validar, y lo medido se usa por dentro (p. ej. tiempo de espera del bus en ese rojo para las llegadas).


## 2026-11-17 · Los buses validan los semáforos medidos, pero no los corrigen solos
Contexto: el dueño quiere que semáforos y buses «aprendan unos de otros». Se decidió que los buses **digan** si el ciclo medido encaja, si parece corrido o a qué horas no encaja, pero sin mover el ciclo solos: los reportes llegan cada ~20 s, el corrimiento que sugieren es aproximado y un ajuste automático equivocado se vería como un semáforo mal en las pruebas. Alternativa descartada: corregir el ancla con el mejor corrimiento de los buses. Las llegadas tampoco usan aún el semáforo: primero hay que ver con días de datos que los arranques caen tras el verde.

## 2026-11-18 · Un plan de semáforo por hora del día, sin color si no hay medida cerca
Contexto: el semáforo de Cra. 102B Bis × Calle 145 tiene 90 s de madrugada y 120 s al mediodía, y cada plan vuelve al día siguiente a la misma hora con el mismo arranque (0,3 s). Antes se usaba solo la última medición, así que de día se mostraba el plan de madrugada. Ahora se usa la medición de la hora del día más parecida (±3 h) y, si no hay ninguna cerca, no se pinta color. Alternativa descartada: usar siempre la más cercana aunque sea de otra franja (mostraría colores equivocados con seguridad aparente).

## 2026-11-18 · La web usa el mapa base de la app (OpenFreeMap)
Contexto: las calles de la web salían de un archivo propio simplificado sin retornos en U ni giros; la app ya usaba OpenFreeMap (OSM completo) y al dueño le parece perfecto. Se descartó (a) sumar los enlaces de OpenStreetMap al archivo propio (se veían escalonados con su precisión y seguirían faltando otras cosas) y (b) los mapas de CARTO (límites de uso y licencia comercial **(?)**). Costo: la web depende del servidor de OpenFreeMap para el fondo (sin conexión solo se ve lo ya guardado), igual que la app.

## 2026-11-24 · Tiempos de «Voy en este bus» por distancia real y ritmo del viaje
Contexto: con tu ubicación confirmando el viaje, la siguiente parada se contaba por distancia (a 8 m/s) pero las demás con el modelo de llegadas (≈ «N paradas × ~1 min», distancia en línea recta a 18 m/s), así que tramos de 200 m y de 2 km salían casi iguales y se desfasaban frente a lo que la persona ve. Se descartó (a) usar solo la velocidad del momento (salta con cada semáforo) y (b) dejar el modelo de llegadas (está calibrado para el promedio, no para cada tramo). Se eligió: tiempo por parada + distancia real del tramo a velocidad de marcha, calibrado para dar los mismos promedios por sistema (tramos medidos en la red: zonal 390 m, troncal 1.060 m, alimentador 470 m), y un factor del ritmo del propio bus en 10 min (limitado 0,6–1,8). Los tiempos de las paradas (sin viaje) no cambian.

## 2026-11-24 · Un viaje con GPS se pasa solo al bus de los datos que coincide
Contexto: si tu bus no reportaba al subir y elegiste «¿En qué bus vas?», cuando el bus vuelve a reportar quedaba como otro bus. Se enlaza si un bus de la misma ruta y sentido cuadra contigo (≤300 m contando ~7 m/s desde su reporte, reporte ≤2,5 min, no más de 150 m por delante) en **dos reportes distintos** y vas en movimiento. Se descartó preguntar a la persona (molesta en el bus) y enlazar con un solo reporte (en troncales con buses en fila podría tomar el de atrás). Riesgo aceptado: dos buses de la misma ruta pegados pueden confundirse.

## 2026-11-27 · En la cabecera de una ruta se anuncian los buses que vienen por la ruta de regreso
Contexto: en la primera parada de una ruta casi nunca hay buses «antes» de ella, y TransMilenio publica el regreso como otra ruta con otra letra y el mismo número. Se eligió sumar los buses de esa ruta de regreso (mismo sistema y número, termina a ≤400 m) con 2 min de vuelta supuestos. Alternativa descartada: mostrar solo el horario programado (no dice si de verdad viene un bus). Riesgo: el bus puede quedarse en el portal o salir como otra ruta; por eso no se anuncia a más de 40 min y falta medir la vuelta.

## 2026-11-27 · Las correcciones aprendidas del orden de paradas se aplican al armar la red, no en las apps
Contexto: se podían aplicar en cada app (como `STOP_PATCHES`) o al publicar la red diaria. Se eligió lo segundo: llega a todas las versiones sin actualizar, y cada corrección exige que las paradas vecinas sigan igual (se apaga sola si TransMilenio corrige el GTFS). Límite: quien arme la red desde `gtfs-lite.zip` (respaldo) no las recibe.

## 2026-11-27 · Con el servidor de avisos a cargo, la app quita sus avisos locales
Contexto: con la app cerrada los avisos locales quedan con la última hora calculada; el servidor (`viajes`) recalcula y manda push. Para no sonar dos veces, cuando el servidor confirma el viaje la app quita sus avisos locales pendientes (`holdRideAlerts`) y los retoma si el servidor no responde en 90 s. Alternativa descartada: dejar los dos (avisos dobles). Riesgo aceptado: si el servidor falla con la app cerrada, ese viaje queda sin avisos.

## 2026-11-27 · Compartir por dónde va el bus: sin coordenadas; encendido por defecto (cambiado el mismo día por el dueño)
Contexto: la ubicación del teléfono de quien va en el bus es más exacta y reciente que el dato de TransMilenio (~1 min). Se envía solo la posición sobre el recorrido (ruta, sentido, metros, hora, velocidad, número del bus si existe), sin coordenadas ni identificador de persona o teléfono, 24 h de retención, vigente 60 s para dibujar. Primero se dejó apagado por defecto; el dueño pidió **encendido por defecto** (más buses exactos para todos; lo enviado no identifica a nadie). Se compensa con: interruptor visible en Más, una línea discreta con «Apagar» en «Voy en este bus» (el dueño descartó una hoja de consejo: una ventana menos) y la política de privacidad. Pendiente: declararlo en App Store Connect y Google Play antes de encender el servidor.

## 2026-11-27 · Vista 3D con volúmenes simples, no modelos
Contexto: el dueño quiere un 3D «como Apple Maps». No hay modelos abiertos de Bogotá y MapLibre nativo (la app) no admite capas propias ni terreno levantado. Se eligió `fill-extrusion` para todo (edificios de OpenStreetMap, buses, estaciones y semáforos armados como polígonos en `map-volumes.ts`), que funciona igual en la web y en la app; de lejos sigue el dibujo plano. Descartado: modelos 3D con una capa propia (solo web). El color en vivo de los semáforos sigue sin mostrarse al público, también en 3D.

## 2026-11-27 · Buses y árboles modelados en la app: mapa web dentro de la app solo para el 3D
Contexto: la app dibuja el mapa con MapLibre Native y `@maplibre/maplibre-react-native`, que no deja meter un motor 3D propio (solo capas de estilo: `fill-extrusion` con paredes rectas). Opciones evaluadas con el dueño: (1) cambiar a Mapbox (modelos glTF y estilo con árboles; con costo desde ~25.000 usuarios/mes y llave); (2) capa propia nativa en Swift/Kotlin (sin poder compilar aquí; riesgo de cierres); (3) al encender el 3D, mostrar dentro de la app el mapa de la web (buses y árboles con three.js) en una vista web; (4) un motor 3D flotando encima del mapa (se desfasa; descartado). Elegido **(3)** por ahora: reusa lo de la web, sin costo ni código nativo nuevo salvo la vista web. A futuro, si la app crece, evaluar (1).
