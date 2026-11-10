# Sesión · Calidad de datos, widget y pulido de la app (2026-11-09 noche → 2026-11-10)

## Objetivo
Que el usuario vea los datos más cercanos y buenos posible (por encima de lo que hacen otros repos), arreglar bugs de la app, agregar el widget y mejorar el aspecto, además de dejar memoria persistente del proyecto.

## Qué se hizo
- **Datos reales verificados** (rama `live-data` con `git fetch +live-data:…`): se midió que la «última parada» del feed está mal en la mayoría de buses; se creó `reconcileLastStops()` (posición manda), prueba nueva (`stale-stop.test.ts`), y los buses con próxima parada pasaron de ~1.200 a ~2.600–3.800. Estaciones con «algún bus viene» de 20 % a 81 %.
- **Estaciones nuevas**: alias de «Calle 53 - Universidad Manuela Beltrán» (reemplazó a la estación temporal «Marly», abierta el 2026-10-24) y parche `patches.ts` para la H15 (Calle 57). Para ver el GTFS completo se usó un workflow temporal de diagnóstico (creado y borrado).
- **Precisión medida**: 12 lotes reales, 12.800 predicciones → error absoluto mediano 32 s (C15: 27 s); el dueño lo validó viajando en un bus (~20 s).
- **Web**: la web llevaba varios despliegues fallando por una prueba que leía `apps/mobile` (arreglado con `esbuild.tsconfigRaw`); se relanzó una vez a mano.
- **App**: hoja de parada completa (todas las rutas, horarios), ficha de ruta como la web (mapa + buses + paradas + horario), «Voy en este bus» con notificaciones locales, Cómo llegar con tramos tocables, accesos rápidos reales (Cerca de mí, Favoritos, Guardar casa/trabajo), «Personalizar parada», pantalla de arranque animada con apertura de círculo, saldo de la tarjeta rediseñado, mapa en vidrio claro con brújula/capas/ubicación contextual, estaciones y semáforos como la web, seguir bus con tarjeta de próxima parada, X nativa de cerrar, enlaces directos con el inicio debajo.
- **Widget «Parada favorita»** (opcional `WIDGET=1`): ver `03-features.md`/`07-decisions.md`.
- **Buses desde arriba** en web y app con un único dibujo (`busTop.ts`).
- **Memoria del proyecto**: esta carpeta, `CLAUDE.md` y el hook `context-guard.sh` (sin commit a pedido del dueño).

## Decisiones
Ver `07-decisions.md` (sección 2026-11).

## Archivos clave
`packages/application/src/transit-state.ts` (reconcile + secuencias), `queries.ts` (alias, `upcomingAtStop`), `station-geometry.ts`, `packages/infrastructure/src/gtfs/patches.ts`, `apps/mobile/app/**`, `apps/mobile/src/map/**`, `apps/mobile/targets/widget/Widget.swift`, `apps/mobile/src/widgetSync.tsx`, `apps/web/src/map/busTop.ts`, `tools/bus-sprites.ts`.

## Gotchas
- El contenedor de Claude no alcanza `gtfs.transmilenio.gov.co` ni `transmilive.com`; para ver el GTFS completo hay que lanzar un workflow en GitHub. Los datos en vivo se bajan de la rama `live-data` (traer con `+` porque se reescribe).
- `expo install` falla en el contenedor (red): usar `node -e "require('expo/bundledNativeModules.json')"` para saber la versión compatible y `npm install paquete@versión`.
- Instalar `@bacons/apple-targets` agrega un módulo nativo a todas las compilaciones, aunque no se use el widget; el plugin solo se aplica con `WIDGET=1`.
- Con `WIDGET=1` el script de compilación **no** debe forzar `PRODUCT_BUNDLE_IDENTIFIER` (rompería el identificador del widget).
- Los `.ips` se leen con Python (`json` sobre la segunda parte del archivo): el hilo que falló y `lastExceptionBacktrace` dan la pista.

## Estado final de la sesión
Último commit de código: `5f6a0fa`. Compilación con widget subida por el dueño (resultado **(?)**: el dueño dijo que se estaba compilando). Pendiente: probar de día con servicio, revisar los buses desde arriba, y analizar los rediseños que propuso (ver `09-open-items.md` #1).
