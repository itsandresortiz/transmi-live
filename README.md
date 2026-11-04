# Bogotá en Vivo

Mapa en vivo de TransMilenio, duales, alimentadores y SITP: buses en el mapa, retrasos,
próximas llegadas, alertas de servicio, calles, estaciones y localidades.

Es una sola página (`index.html`) sin servidor ni proceso de compilación.

## Cómo se actualizan los datos

1. La página intenta leer `positions.pb`, `tripupdates.pb` y `alerts.pb` **directo de
   `gtfs.transmilenio.gov.co`** cada 21 s (estado «EN VIVO»).
2. Si el navegador no puede (CORS), usa la **copia de la rama `live-data`**, que el workflow
   `live-data.yml` refresca cada ~5 min (estado «DATOS hh:mm»).
3. El workflow `gtfs-daily.yml` descarga cada día el `GTFS.zip` (116 MB), lo reduce con
   `scripts/slim_gtfs.py` a `gtfs-lite.zip` y lo publica también en `live-data`. Con eso la app
   muestra nombres de ruta, destinos, recorridos y paradas.

La rama `live-data` se reescribe con un solo commit en cada ejecución, así el historial no crece.

## Publicar

En **Settings → Pages**: *Source* = *Deploy from a branch*, rama `main`, carpeta `/ (root)`.
Después, en **Actions**, ejecuta una vez *Datos en vivo* y *GTFS diario* con *Run workflow*.

## Datos y créditos

- Tiempo real y GTFS: [TransMilenio](https://gtfs.transmilenio.gov.co/)
- Vías: © colaboradores de OpenStreetMap
- Localidades: [decolector/bta-geodata](https://github.com/decolector/bta-geodata)
- Troncales y estaciones: datos abiertos de TransMilenio
- Mapa: [Leaflet](https://leafletjs.com/) y [JSZip](https://stuk.github.io/jszip/)
