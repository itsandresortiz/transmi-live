# TransMi LIVE

Mapa en vivo de TransMilenio, duales, alimentadores y SITP en Bogotá: dónde está cada bus, qué tan
puntual va, próximas llegadas, avisos de servicio, calles, estaciones y localidades.

Diseñado primero para el celular (hoja inferior deslizable, instalable como app) y adaptado a escritorio.

## Estructura

| Archivo | Qué es |
| --- | --- |
| `index.html` | Marco de la página (liviano). |
| `style.css` | Sistema de diseño: colores, vidrio, hoja inferior, tarjetas, modo claro/oscuro. |
| `app.js` | Motor: lectura de datos, mapa, dibujo de buses y predicción entre reportes. |
| `ui.js` | Interfaz: pestañas, listas, detalle de ruta, avisos, ajustes. |
| `assets/` | Datos pesados con caché propia: vías y nombres de calles de OSM, localidades, troncales y estaciones. |
| `supabase/functions/tm` | Intermediario que lee TransMilenio con CORS (ver abajo). |
| `scripts/` y `.github/workflows/` | Copia de respaldo de los datos y GTFS reducido. |

## De dónde salen los datos

1. **Intermediario (principal).** Una función de Supabase lee `positions.pb`, `tripupdates.pb` y
   `alerts.pb` de TransMilenio y los entrega con CORS y una huella por archivo. La página consulta la
   huella cada ~3 s y descarga solo lo que cambió. Los datos llegan con 5–15 s de antigüedad.
2. **Copia de respaldo.** El workflow `Datos en vivo` guarda lo mismo en la rama `live-data`
   (GitHub la cachea ~5 min, por eso solo es respaldo).
3. **GTFS.** El workflow `GTFS diario` reduce el `GTFS.zip` (116 MB) a `gtfs-lite.zip` en `live-data`,
   con nombres de ruta, trazados y paradas.

## Movimiento de los buses

Predicción calibrada con datos reales: la velocidad se mide con ≥28 s de base y el bus avanza en línea
recta desde que su dato tiene 15 s y hasta 75 s. En 16 lotes reales redujo el error 5–17 % frente a
dejar cada bus quieto. Se puede cambiar a «Reportado» o «Acelerado» en los ajustes.

## Publicar

**Settings → Pages**: *Deploy from a branch*, rama `main`, carpeta `/ (root)`.

## Créditos

Tiempo real y GTFS: TransMilenio · Vías: © colaboradores de OpenStreetMap · Localidades:
[decolector/bta-geodata](https://github.com/decolector/bta-geodata) · Mapa: Leaflet y JSZip.
