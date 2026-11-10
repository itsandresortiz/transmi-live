# Sesión · Web, datos en vivo y precisión (2026-11-04 → 2026-11-08)

> Resumen reconstruido de `git log` (≈105 commits en esos días) y del README raíz; el detalle de las conversaciones de esa etapa ya no está disponible. Lo incierto va con **(?)**.

## Objetivo
Construir «Bogotá en Vivo / TransMi LIVE»: mapa web en vivo de TransMilenio, duales, alimentadores y SITP, con la mejor precisión posible de posición y llegada.

## Qué se hizo
- **Núcleo DDD** en TypeScript (`packages/*`), pruebas con lotes reales y raíz de composición web.
- **Datos**: proxy de Supabase (`supabase/functions/tm`) con sondeo largo `/live`; respaldo en la rama `live-data` (workflow «Datos en vivo»); GTFS reducido diario; horarios en `schedule-data` (primer/último viaje por ruta y día, salidas por parada); vigilancia de datos que abre/cierra un issue; estadísticas por tramo y cerca de semáforos.
- **Movimiento y ETA**: motor que pega cada bus a su trazado (ganancia 0,5, corrección sin retroceder), predicción calibrada, ETA desde la posición (error mediano 34–37 s), reloj del servidor, quitar buses con >10 min sin reportar.
- **Paradas y estaciones**: nombres limpios (vagón = letra, plataforma de portal), estaciones agrupadas con sus vagones y dibujadas completas (base, pasillo, vagones, puertas), color de línea por corredor, «último/primer servicio», horarios programados cuando no hay datos en vivo, nombre/texto de «sin datos» que no sugiere ausencia de servicio.
- **Producto**: favoritos, cerca de ti, casa/trabajo, «Cómo llegar» con hora, «voy en el bus», compartir enlaces, páginas SEO estáticas (671 rutas, 143 estaciones), instalable y sin conexión, Mi tarjeta (solo dentro de una app nativa), política de privacidad (`privacidad.html`).
- **Calidad**: pruebas de precisión con datos reales (`tools/precision.ts`), `TravelTimes.apply=false` tras probar tiempos aprendidos por aparato.

## Decisiones
Ver `07-decisions.md` → sección «Antes (web)».

## Estado final
Web en producción en GitHub Pages, publicándose con cada `push` a `main`.

## Gotchas
- TransMilenio informa la «última parada» de cada bus (no la siguiente) y a menudo mal (se descubrió después; ver `02-architecture.md`).
- El workflow de despliegue cancela ejecuciones previas por concurrencia; lanzarlo a mano justo después de un `push` lo hizo fallar una vez.
- Las ramas de datos se reescriben con `--force`: al traerlas con `git fetch` usar `+rama:refs/remotes/origin/rama`.
