# 2026-11-10 · Viaje guiado, próxima parada y pulido

## Objetivo
Pedidos del dueño en una sola tanda: buses 3D en «Voy en este bus», memoria del proyecto subida, «Seguir este viaje» con avisos, y seis mejoras (actividad en vivo, buses en vivo en todo el viaje, widget con demostración, próxima parada, mapa oscuro y tráfico, movimiento fluido), más llevar a la web lo que aplique.

## Qué se hizo
- Buses de la escena del viaje como caja 3D proyectada con la cámara de la vía (`tools/bus-rear-draw.js`, `meta.json`).
- Memoria movida a `.claude/` y subida (limpia de nombres de terceros y de cuentas).
- `testflight-local.sh`: un solo comando (baja lo nuevo, limpia y compila). `TEAM_ID` vive en el `~/.zshrc` del Mac.
- `liveLevel()`: pocos buses con dato reciente = «En vivo · N buses a esta hora».
- `trip-guide.ts`: guía paso a paso, avisos, bus real de cada tramo. App: `/trip`, `TripWatcher`, `TripBanner`, actividad en vivo. Web: `TripBar`.
- Próxima parada: `projectAfter`/`projectAlong` y borrado de la parada informada no creíble (87,6 % → 97,1 % con próxima parada; próxima parada a >3 km: 653 → 50).
- Mapa: estaciones con color de línea (`trunk-data.ts`), mapa oscuro, tráfico, `BusLayer` con cadencia adaptable.
- Más: pruebas escondidas (8 toques), reporte por correo, `Toggle` centrado.

## Gotchas
- El GTFS trae un solo trazado por ruta; en alimentadores/zonales va y vuelve por la misma calle. Proyectar «al más cercano» rompe el orden de paradas.
- `echo "export $(…)" >> ~/.zshrc` con resultado vacío deja `export ` suelto, que imprime todo el entorno al abrir la terminal: validar antes de escribir.
- En zsh un comodín sin coincidencias cancela todo el comando: usar `find`.
- El script de compilación cambia de carpeta: para relanzarse necesita su ruta completa.
- MapLibre RN no soporta imágenes que se estiran: las etiquetas de estación son ficha de color + texto, no píldoras.
- No se puede comprobar desde el contenedor: Swift (widget, actividad en vivo), fuentes del mapa base, nada en teléfono.

## Estado final
Todo en `main`. 143 pruebas, tipos de web y app y exportación de la app en verde. Pendiente que el dueño compile y pruebe (lista en `09-open-items.md`).
