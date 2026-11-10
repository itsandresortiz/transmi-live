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
