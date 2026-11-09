# TransMi LIVE: app nativa (Expo + React Native)

La app nativa de iPhone y Android. Comparte con la web el dominio, la aplicación y la infraestructura (`packages/*`, TypeScript puro);
solo cambian la capa de pantallas y los adaptadores (sin Web Workers ni caché del navegador). Ver `src/composition-root.ts`.

- Expo SDK 58, React Native 0.88, Expo Router, Reanimated 4.
- No forma parte de los espacios de trabajo de la web (`package.json` de la raíz): tiene su propia instalación, para que React Native no frene el despliegue de la web.

```bash
cd apps/mobile
npm install
npm run typecheck      # tipos
npm run export         # empaqueta para iPhone (Hermes) sin abrir un simulador
npx expo run:ios       # en un Mac: compila y abre el simulador (hace falta Xcode)
```

## Estado

Hecho: arranque de datos (rutas, horarios y datos en vivo), lista y detalle de rutas, estructura de pestañas.
Falta: mapa nativo (MapLibre), paradas con horarios, buses, «Cómo llegar», panel inferior, lectura de la tarjeta TuLlave por NFC (módulo nativo; el analizador ya está en `@transmi/domain`), notificaciones y widgets.
Todo lo anterior se ha verificado solo con tipos y empaquetado; no se ha ejecutado en un teléfono ni en un simulador.
