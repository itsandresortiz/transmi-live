# Sesión · App nativa de iPhone (2026-11-09)

## Objetivo
Pasar de «web empaquetada con Capacitor» a una **app real de iPhone** con el estilo y funciones de la web (mapa con buses en vivo, barra inferior de vidrio líquido, ventanas fluidas, lectura del saldo TuLlave por NFC), distribuida por TestFlight.

## Qué se hizo
- Dudas de arquitectura resueltas: Expo/React Native sobre el mismo dominio (`packages/*`), no Capacitor (ver `07-decisions.md`).
- App creada en `apps/mobile` (Expo SDK 58, expo-router, `NativeTabs`, Reanimated, `expo-glass-effect`): Inicio, Mapa, Rutas, Cómo llegar, Más; hojas de parada y bus, ficha de ruta, Avisos, Mi tarjeta, bienvenida, favoritos y casa/trabajo, reportes a GitHub, accesibilidad (reducir movimiento/transparencia, contraste, texto grande), estado de datos honesto.
- **Mapa nativo** (MapLibre RN + OpenFreeMap): buses con sprites (articulados en troncales, giro con rumbo), red de troncales, estaciones, semáforos más tarde.
- **NFC**: módulo Swift `modules/tullave` (Core NFC) + análisis en `packages/domain/src/card/tullave.ts`. En el iPhone real funcionó a la primera una vez que el módulo quedó en el repo.
- **TestFlight local**: `apps/mobile/scripts/testflight-local.sh` (prebuild → xcodebuild → `.ipa` → Transporter), con detección de copia desactualizada.
- Revisión de un repositorio de terceros como referencia (solo lectura): se adoptaron accesibilidad, prueba de contraste, estado del feed, bienvenida, apodos de paradas, reportes y privacidad.

## Problemas que aparecieron y cómo se resolvieron
- Compilación «vieja»: el `git pull` abortaba por `package-lock.json` modificado → `git restore` antes de `git pull`; el script avisa si está atrás.
- Firma: «no hay dispositivos» → registrar el iPhone por **UDID** (no ICCID) en developer.apple.com.
- **Hojas en negro / X que no cierra** con `formSheet` → todo a `modal` con X nativa.
- **El lector NFC no existía en la compilación**: el `.gitignore` tenía `ios/` y excluía `modules/tullave/ios/` → cambiado a `/ios/`.
- **Caída al «Seguir en el mapa»** (`.ips`: excepción nativa en un método de TurboModule): `fitBounds` con un solo punto → ahora `flyTo`; capas del mapa siempre montadas.
- **Uso de CPU alto** (`.ips cpu_resource`: 51 %, +259 MB): el motor calculaba todos los buses → prefiltro por viewport, frecuencia por zoom, poda de memoria.

## Archivos clave
`apps/mobile/app/**`, `apps/mobile/src/**`, `apps/mobile/modules/tullave/**`, `apps/mobile/scripts/testflight-local.sh`, `packages/domain/src/card/tullave.ts`.

## Estado al cierre de la etapa
Compilaciones de prueba en TestFlight (builds hasta ~14 el 2026-11-09 23:xx). El dueño probó mapa, hojas, tarjeta (funciona), «Voy en este bus».

## Gotchas
- Claude no puede compilar Swift ni abrir un iPhone: toda verificación nativa depende de capturas, de `.ips` y de la terminal del dueño.
- Pegar varios comandos de golpe en la terminal del dueño hizo que uno fallara y el siguiente corriera igual; darle bloques cortos.
