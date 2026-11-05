# TransMi LIVE

Mapa en vivo de TransMilenio, duales, alimentadores y SITP en Bogotá: dónde está cada bus, qué tan puntual
va, en cuánto llega a tu parada, avisos de servicio y calles. Pensado primero para el celular (instalable,
funciona sin internet con lo último visto) y adaptado a escritorio.

**Sitio:** https://itsandresortiz.github.io/transmi-live/

## Qué puedes hacer
- Ver todos los buses moviéndose de forma fluida, por su ruta, con el color de su sistema o de su puntualidad.
- Tocar una **parada** y ver qué rutas vienen, de dónde viene el próximo bus y en cuánto llega.
- **Seguir** un bus: el mapa lo acompaña y te dice su próxima parada.
- Ver en qué **vagón** de la estación (o plataforma del portal) para cada ruta: en el GTFS la **letra** del nombre es el vagón (A = 1, B = 2…) y los números cambian entre sentidos; se comprobó con rutas conocidas (La Campiña: H15 vagón 3, 7 vagón 1).
- Las **estaciones de la troncal** se dibujan completas: una base alargada con sus vagones adentro (cápsulas con puertas y número), el nombre sobre ella y las paradas encima; al elegir una ruta se iluminan los vagones donde para. Tamaño típico (30 × 10 m por vagón): el GTFS solo trae un punto por parada.
- Mapa con jerarquía de vías (autopistas y avenidas anchas, con borde) construido con datos de OpenStreetMap incluidos en la app; las líneas de todas las rutas están apagadas por defecto (Ajustes → «Líneas de rutas»).
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
TransMilenio informa la posición de cada bus cada 9–78 s (y llega con 5–15 s de retraso). Para que el movimiento sea continuo:

1. **Por su ruta:** cada bus se pega al trazado de su ruta (en su sentido) y avanza *por la calle*, curvas incluidas. Si cambia de variante o el dato salta, se desliza a su sitio en ~2 s, sin teletransportarse.
2. **Estimación calibrada:** entre reportes avanza `velocidad medida × tiempo × 0,5` desde el primer segundo. La velocidad medida sobrestima (los buses frenan y esperan), y con 0,5 el error de posición baja 10–25 % frente a dejarlo quieto (medido con 16 lotes reales y unos 5.000 buses en movimiento).
3. **Corrección suave, sin retroceder:** cuando llega un reporte, el bus acelera o frena poco a poco para ponerse al día (hasta 3× su ritmo), nunca se devuelve y nunca queda congelado por completo mientras debería ir andando.
4. **Desde el primer cuadro:** recién abierta la página no hay historial para medir velocidad; entonces se deduce de la ruta y la parada que sigue (81 % de los buses ya se mueven con un solo lote).
5. **Dibujo cuadro a cuadro** en un canvas (≈60 fps), solo de los buses que se ven.

Medido en simulación con los 16 lotes reales (1.200 buses, 229 s), frente al método anterior (suavizado exponencial):

| | Anterior | Actual |
| --- | --- | --- |
| Error de posición (medio / p90) | 82 m / 202 m | 86 m / 197 m |
| Retroceso | 41 m/min | ≈ 0 (14 m/min es el piso de la medición) |
| Tirones de velocidad | 1,10 m/s² | 0,39 m/s² |
| Saltos al llegar un reporte (p99) | 14 m | 19 m |

Los datos en vivo se descargan y decodifican en un Web Worker: al llegar un lote no se pierde ningún cuadro (peor cuadro 17 ms; antes hasta 133 ms).

El error de posición no baja mucho porque los buses son impredecibles (semáforos, paradas): el objetivo es que *se vean* naturales, no adivinar más.

## Cuánto tarda un bus en llegar
- Comprobado con datos reales: la parada que TransMilenio informa de cada bus (en posiciones y en el viaje) es la **última a la que ya llegó**, con su hora real (en el 99,7 % de los casos queda atrás del bus, a una mediana de 188 m), no la que sigue. La app calcula la siguiente a partir del recorrido de la ruta.
- No hay hora oficial para las paradas que faltan; se estima así: se ubica el bus sobre el trazado de su ruta, se calcula **cuánto del tramo hacia la siguiente parada ya recorrió**, y se suma lo que falta de ese tramo más el tiempo típico de cada tramo restante (≈ 50–62 s por parada según el sistema, medido con 16 lotes reales), todo contado desde el momento del reporte de posición.
- Medido con lotes reales (1–3 paradas de distancia): error mediano **34–37 s** usando la posición, frente a 44–57 s contando solo desde la hora a la que llegó a su última parada (que queda como respaldo si el bus no se ubica sobre su trazado). Por eso todos los tiempos dicen «aprox.».
- **Todos los dispositivos muestran el mismo tiempo.** Se probó una versión que aprendía el tiempo por ruta en cada aparato y se descartó: dos aparatos daban tiempos distintos (mediana 125 s, p90 312 s de diferencia) y, comparado con lo que de verdad ocurrió, erraba más que el valor típico (71 s contra 31 s a una parada). El código quedó apagado (`TravelTimes.apply = false`).
- **Hora del servidor, no del aparato:** cada consulta mide cuánto se adelanta o atrasa el reloj del dispositivo respecto al del servidor de datos (±1 s) y todos los tiempos («llega en…», «hace … s») usan esa hora corregida.
- Si el bus va más lento de lo esperado y el cálculo ya quedó en el pasado, no se muestra «ya»: se supone que le falta una parte del tramo.

## Sin internet
Un service worker guarda la app y la última copia de rutas, paradas y buses: sin conexión abre con lo último visto
y lo dice en el estado superior.

## Publicación
`push` a `main` → el workflow **Publicar app web** prueba, compila y publica en GitHub Pages
(Settings → Pages → Source: *GitHub Actions*).

## Créditos
Tiempo real y GTFS: TransMilenio · Vías: © colaboradores de OpenStreetMap · Localidades:
[decolector/bta-geodata](https://github.com/decolector/bta-geodata) · Mapa: MapLibre GL.
