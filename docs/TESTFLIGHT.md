# Subir TransMi LIVE a TestFlight (iPhone)

La app web se empaqueta con [Capacitor](https://capacitorjs.com) dentro de una app de iPhone. Todo se hace desde la terminal de un Mac con Xcode 15 o más nuevo.
Los scripts no se pudieron probar en un Mac desde donde se escribieron: el primer intento puede pedir ajustes pequeños.

## 0. Una sola vez, en la web de Apple

1. **Team ID**: developer.apple.com → Account → Membership details → *Team ID*.
2. **Llave de la API** de App Store Connect: appstoreconnect.apple.com → Users and Access → *Integrations* → *App Store Connect API* → generar con rol **App Manager** (o Admin). Descarga el `AuthKey_XXXX.p8` (solo se baja una vez) y guarda el *Key ID* y el *Issuer ID*. No subas el `.p8` al repositorio (ya está en `.gitignore`).
3. **Crear la app** en App Store Connect → My Apps → **+** → New App:
   - Plataforma iOS, nombre «TransMi LIVE» (si ya lo usa alguien, «TransMi LIVE Bogotá»), idioma Español (Colombia).
   - Bundle ID: `com.transmilive.app` (si no aparece en la lista, regístralo en developer.apple.com → Identifiers → **+** → App IDs).
   - SKU: lo que quieras, por ejemplo `transmilive-ios`.

## 1. Preparar el proyecto (una vez)

```bash
git clone https://github.com/itsandresortiz/transmi-live && cd transmi-live
bash scripts/ios-setup.sh
```

Instala Capacitor, construye la web, crea la carpeta `ios/`, genera los íconos desde `assets/icon-only.png` y pone el permiso de ubicación en español.

## 2. Compilar y subir (cada vez)

```bash
export TEAM_ID=ABCDE12345
export ASC_KEY_ID=XXXXXXXXXX
export ASC_ISSUER=00000000-0000-0000-0000-000000000000
export ASC_KEY=$HOME/claves/AuthKey_XXXXXXXXXX.p8
bash scripts/ios-testflight.sh
```

Construye la web, la sincroniza con el proyecto, firma automáticamente con tu llave de la API, genera el `.ipa` y lo sube a App Store Connect. El número de compilación sale de la fecha y la hora, así que nunca se repite.

## 3. En TestFlight

1. App Store Connect → tu app → **TestFlight**. La compilación aparece en 5–15 minutos como «Processing».
2. Si pregunta por cifrado: ya va declarado (`ITSAppUsesNonExemptEncryption = false`).
3. **Internal Testing** → crear grupo → agregar personas de tu equipo de App Store Connect (hasta 100; sin revisión de Apple).
4. Instalar la app **TestFlight** en el iPhone, aceptar la invitación y abrir TransMi LIVE.
5. Para probadores externos (hasta 10.000) hace falta enviar la primera compilación a *Beta App Review*, con política de privacidad pública y una nota de que la app no es oficial de TransMilenio. Cada compilación caduca a los 90 días.

## Si algo falla

- *No signing certificate / provisioning*: revisa que el rol de la llave sea App Manager o Admin y que `TEAM_ID` sea el correcto.
- *Bundle ID no existe*: regístralo en Identifiers (paso 0.3) y repite.
- *El número de compilación ya existe*: espera un minuto y repite; se genera con la hora.
- `npx cap open ios` abre el proyecto en Xcode para ver el detalle de un error.

## Después

- **Leer el saldo de la tarjeta TuLlave** (Ajustes → Mi tarjeta) necesita un plugin nativo de NFC y la capacidad *NFC Tag Reading* en el App ID. La página ya sabe usarlo: espera `window.TransmiNative.tullave` con `isAvailable()` y `read()` (ver `apps/web/src/ui/card.tsx`). Para validar el saldo, el botón «Copiar lectura técnica» entrega las respuestas de la tarjeta sin su número.
- Las notificaciones y los widgets son trabajo aparte.
