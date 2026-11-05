# TransMi LIVE

Mapa en vivo de TransMilenio, duales, alimentadores y SITP en Bogotá: dónde está cada bus, qué tan puntual
va, en cuánto llega a tu parada, avisos de servicio y calles. Pensado primero para el celular (instalable,
funciona sin internet con lo último visto) y adaptado a escritorio.

**Sitio:** https://itsandresortiz.github.io/transmi-live/

## Qué puedes hacer
- Ver todos los buses moviéndose de forma fluida, por su ruta, con el color de su sistema o de su puntualidad.
- Tocar una **parada** y ver qué rutas vienen, de dónde viene el próximo bus y en cuánto llega.
- **Seguir** un bus: el mapa lo acompaña y te dice su próxima parada.
- Guardar **favoritos** (paradas y rutas) y ver **paradas cerca de ti**.
- Ver solo los **avisos** que te afectan (tus favoritos o tu zona).

## Estructura (TypeScript, DDD)

```
packages/
  domain/          Reglas del negocio, sin dependencias: buses, rutas, paradas, retrasos, avisos, predicción de movimiento.
  application/     Casos de uso: estado del tránsito, consultas (próximos buses, cerca de ti), tiempos aprendidos.
  infrastructure/  Adaptadores: lector GTFS-realtime, intermediario de datos, lector del GTFS reducido.
apps/
  web/             App React + Vite + MapLibre (composition-root.ts conecta todo).
supabase/functions/tm   Intermediario que lee TransMilenio con CORS.
scripts/ y .github/workflows/   Copia de respaldo de los datos y GTFS reducido diario.
```

El dominio no conoce React ni el navegador: la misma lógica servirá para la app móvil (Expo).

## Comandos

```bash
npm install
npm run dev        # servidor local
npm test           # pruebas (dominio, aplicación, infraestructura y flujo completo con lotes reales)
npm run build      # genera apps/web/dist
```

## De dónde salen los datos
1. **Intermediario (principal).** Una función de Supabase lee `positions.pb`, `tripupdates.pb` y `alerts.pb`
   de TransMilenio y los entrega con CORS. La app consulta una huella cada ~2,5 s y descarga solo lo que cambió.
2. **Respaldo.** El workflow `Datos en vivo` guarda lo mismo en la rama `live-data` (con unos minutos de retraso).
3. **GTFS.** El workflow `GTFS diario` reduce el `GTFS.zip` a `gtfs-lite.zip` (rutas, trazados, paradas) en `live-data`.
   Las rutas se clasifican por su color oficial: rojo troncal, azul zonal, verde alimentador o dual.

## Cómo se mueven los buses
- Cada bus se dibuja con la posición que informa TransMilenio; entre reportes avanza por el trazado de su ruta
  con la velocidad medida (de 15 s a 75 s después del dato), y se corrige al llegar el siguiente.
- Es una estimación: de 5.177 buses reales, la distancia media a su ruta pasó de 62 m (en línea recta) a 10,5 m.

## Cuánto tarda un bus en llegar
- El feed solo da la hora oficial hacia la **próxima** parada de cada bus. Para paradas más lejanas se calcula:
  hora oficial + tiempo por parada (≈ 50–62 s según el sistema, medido con 16 lotes reales; error medio ≈ 40–60 s).
- La app **aprende** el tiempo real de cada ruta por franja del día mientras está abierta y lo guarda en el dispositivo.

## Sin internet
Un service worker guarda la app y la última copia de rutas, paradas y buses: sin conexión abre con lo último visto
y lo dice en el estado superior.

## Publicación
`push` a `main` → el workflow **Publicar app web** prueba, compila y publica en GitHub Pages
(Settings → Pages → Source: *GitHub Actions*).

## Créditos
Tiempo real y GTFS: TransMilenio · Vías: © colaboradores de OpenStreetMap · Localidades:
[decolector/bta-geodata](https://github.com/decolector/bta-geodata) · Mapa: MapLibre GL.
