# 2026-11-17/18 · Semáforos medidos y buses aprendiendo unos de otros

## Objetivo
Que los semáforos medidos a mano por el dueño (cronómetro de la web, `?pruebas`) y los buses reales se validen mutuamente, como paso previo a usar los semáforos en los tiempos de llegada.

## Qué se hizo
- `packages/application/src/signal-learning.ts` (`learnFromBuses`): compara buses que se acercan a cada semáforo medido (detenidos/andando, rumbo, arranques) con el plan medido; texto para el cronómetro; sin falsas alarmas de «ciclo corrido» (mitades de los datos deben coincidir); prueba con buses detenidos vs azar; solo cuenta buses en el sentido del semáforo (`rumbo`).
- `signal-timing.ts`: un plan por hora del día (`signalSessions`, `signalPlans`, `signalModelAt`): se usa la medición de la hora del día más parecida (±3 h) y se juntan todas las del mismo plan (`mergePlan`); sin medición cerca no se pinta color.
- `tools/signal-near.ts` (recolector), `signalstats.ts` guarda 7 días en `cerca-medidos.json.gz` y publica `aprendizaje.json` (rama `signal-stats`); `live-data.yml` relanza `signal-stats.yml` de día (GitHub casi no lo corría).
- `tools/osm-calles.ts` + `osm-calles.yml`: calle y rumbo de cada semáforo según OpenStreetMap (3.984 de 5.148).
- `tools/semaforos.ts`: 155 semáforos de OpenStreetMap fuera de la lista oficial (filas «OSM», p. ej. el retorno en U frente al Portal Suba).
- `testflight-local.sh`: widget incluido por defecto (una compilación sin `WIDGET=1` dejó el widget gris y sin responder).

## Hallazgos
- Cra. 102B Bis × Calle 145: plan de madrugada 90 s (verde 53, rojo 33) que se repite cada día a la misma hora con el mismo arranque (0,3 s de error a 24 h); mediodía/1 p. m. 120 s con inicio del rojo fijo.
- Sentidos (confirmados por dibujo del dueño, recorridos y OpenStreetMap): medido = Calle 145 hacia el sur-oriente (127°); el «otro lado» = Calle 145 hacia el nor-occidente (306°); TM 1 = salida troncal del portal (178°); TM 2 = vía TM hacia el nor-occidente (308°), probablemente el giro de entrada al portal **(?)**.
- Buses: primer día sin señal clara; con el filtro de sentido, de 25 buses detenidos casi todos caían en el verde medido (0 de 6 junto al medido). Sin explicar **(?)**: fila tras el cambio a verde, reportes cada ~20 s o desfase de hora.

## Gotchas
- Overpass (OpenStreetMap) corta la conexión desde el contenedor: correr en GitHub. Con `out tags geom` no vienen los nodos de cada vía: usar `out body geom`.
- La prueba de `signal-timer.test.ts` lee el archivo real de mediciones: no fijar duraciones ni cantidad de semáforos.

## Pendiente
Medir con el cronómetro hacia las 7 a. m. y 6 p. m.; Av. Cra. 104 × Calle 145 (3 fases) con 2–3 vueltas y una de otro lado; revisar en unos días si los buses detenidos caen en el rojo antes de usar semáforos en las llegadas.
