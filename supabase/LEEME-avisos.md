# Avisos del viaje desde el servidor y buses compartidos: pasos para el dueño

Todo esto está **apagado** hasta que hagas estos pasos. Mientras tanto la app y la web funcionan igual que siempre (avisos solo del teléfono).
Nada de lo de aquí lleva llaves en el repositorio: las llaves se guardan como **secretos de Supabase** (solo se nombran aquí).

## Qué hace

1. **Avisos que se corrigen con la app cerrada.** Con «Voy en este bus» y la parada de bajada marcada, la app le cuenta a la función
   `viajes` qué bus es, dónde te bajas y a qué teléfono avisar. Cada 20 s el servidor recalcula con los datos en vivo (con el **mismo
   código** de llegadas de la app, empaquetado en `functions/_compartido/nucleo.js`) y manda «Faltan 3 paradas», «Prepárate para bajar»
   y «Bájate aquí» por el servicio de avisos de Apple (APNs) o de Google (FCM). En iPhone también actualiza la actividad en vivo
   (pantalla de bloqueo / isla dinámica). El viaje se borra al terminar, si el bus deja de reportar 10 min, o a las 3 h.
   - Mientras el servidor responde, la app **no** programa sus avisos locales (si no, sonarían dos veces). Si el servidor deja de
     responder 90 s, la app vuelve sola a sus avisos locales.
   - Mientras la app está abierta, ella misma actualiza la actividad en vivo (con tu GPS, que es más exacto); el servidor solo la
     actualiza cuando la app lleva 40 s sin dar señales.
   - Límites: un viaje solo con GPS (el bus no está en los datos) no se puede seguir desde el servidor; en Android el servidor manda los
     avisos, pero la **notificación fija** del viaje solo la corrige la app al abrirse.
2. **Buses compartidos (opcional y anónimo).** En Más aparece «Compartir por dónde va mi bus» (apagado por defecto). Si alguien lo
   enciende, mientras va en un bus con el GPS confirmando, la app manda cada 20 s: ruta, recorrido, metros, hora, velocidad y el número
   del bus solo si es uno de TransMilenio. **Sin coordenadas ni identificador de persona o teléfono.** El servidor publica cada 20 s
   las posiciones de los últimos 60 s en un archivo público (`compartidos/vivo.json`) que leen la app y la web, y lo borra todo a las 24 h.

## Pasos (una sola vez)

### 1. Supabase: extensiones y tablas
1. Supabase → tu proyecto → **Database → Extensions**: encender `pg_cron` y `pg_net`.
2. **SQL Editor** → pegar todo `supabase/migrations/20261127120000_viajes.sql` → **Run**. Crea las tablas `viajes_activos` y
   `posiciones_compartidas` (solo la función puede leerlas), el borrado automático y el almacenamiento público `compartidos`.

### 2. Apple (para iPhone)
1. developer.apple.com → Certificates, Identifiers & Profiles → Identifiers → `com.transmilive.app` → marcar **Push Notifications** → Save.
2. Keys → **+** → marcar **Apple Push Notifications service (APNs)** → Continue → Register → **Download** (el archivo `AuthKey_XXXX.p8`
   se baja una sola vez; guárdalo en tu Mac, p. ej. `~/.transmilive/`, **nunca** en el repositorio). Anota el **Key ID**.

### 3. Google (para Android)
1. console.firebase.google.com → crear un proyecto → agregar app **Android** con el paquete `com.transmilive.app` → bajar
   `google-services.json` y guardarlo en `~/.transmilive/google-services.json` (fuera del repositorio).
2. Configuración del proyecto → **Cuentas de servicio** → «Generar nueva clave privada» → se baja un `.json` (guárdalo también fuera del repositorio).

### 4. Secretos de la función (en tu Mac, desde la carpeta del repositorio)
Nombres de los secretos (los valores los pones tú; no los pegues en el chat):

| Secreto | Qué va |
| --- | --- |
| `AVISOS_ACTIVOS` | `1` para encender los avisos (`0` los apaga) |
| `COMPARTIR_ACTIVO` | `1` para encender los buses compartidos (`0` los apaga) |
| `VIAJES_TICK_KEY` | una clave larga inventada por ti (la usa el reloj del paso 6) |
| `APNS_KEY_P8` | el contenido del archivo `.p8` del paso 2 |
| `APNS_KEY_ID` | el Key ID del paso 2 |
| `APNS_TEAM_ID` | tu Team ID de Apple |
| `APNS_BUNDLE_ID` | opcional; por defecto `com.transmilive.app` |
| `FCM_SERVICE_ACCOUNT` | el contenido del `.json` de la cuenta de servicio del paso 3 |

```
supabase login
```
```
supabase link --project-ref TU_PROYECTO
```
```
supabase secrets set AVISOS_ACTIVOS=1 COMPARTIR_ACTIVO=1 APNS_KEY_ID=TU_KEY_ID APNS_TEAM_ID=TU_TEAM_ID
```
```
supabase secrets set APNS_KEY_P8="$(cat ~/.transmilive/AuthKey_XXXX.p8)" FCM_SERVICE_ACCOUNT="$(cat ~/.transmilive/cuenta-servicio.json)"
```
La `VIAJES_TICK_KEY` la necesitas también en el paso 6 y Supabase no deja leerla después: inventa una con el comando de abajo,
guárdala en el Llavero de tu Mac y pásala tú.
```
openssl rand -hex 24
```
```
supabase secrets set VIAJES_TICK_KEY=LA_CLAVE_QUE_SALIO
```

### 5. Desplegar la función
Si el cálculo de llegadas cambió desde la última vez, primero regenera el núcleo (no hace daño hacerlo siempre):
```
npx tsx tools/edge-core.ts
```
```
supabase functions deploy viajes --no-verify-jwt
```
(`--no-verify-jwt` porque la app no tiene cuentas, igual que `tm`). Debería terminar con «Deployed Function viajes».

### 6. El reloj cada 20 s (SQL Editor)
Cambia `TU_PROYECTO` y `TU_CLAVE` (la misma `VIAJES_TICK_KEY`). La clave queda en la bóveda cifrada de Supabase, no en el código.
```sql
select vault.create_secret('https://TU_PROYECTO.supabase.co/functions/v1/viajes/tick', 'viajes_tick_url');
select vault.create_secret('TU_CLAVE', 'viajes_tick_key');
select cron.schedule('viajes-tick', '20 seconds', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'viajes_tick_url'),
    headers := jsonb_build_object('content-type', 'application/json',
      'x-tick-key', (select decrypted_secret from vault.decrypted_secrets where name = 'viajes_tick_key')),
    body := '{}'::jsonb, timeout_milliseconds := 25000)
  -- solo si hay algo que hacer: sin viajes ni posiciones recientes no se gasta ninguna invocación
  where exists (select 1 from public.viajes_activos)
     or exists (select 1 from public.posiciones_compartidas where hora > now() - interval '2 minutes');
$$);
```
Costo: con viajes activos todo el día serían ~4.300 invocaciones diarias (~130.000 al mes); sin viajes, ninguna.
Cada viaje registrado suma ~1 invocación cada 25 s **solo mientras la app está abierta**, y cada persona que comparte, 1 cada 20 s.
Las apps leen `vivo.json` del almacenamiento (no gasta invocaciones, sí un poco de «Egress»: revisa el uso del mes la primera semana).

### 7. Encender en las apps (Claude lo puede hacer si se lo pides)
- `apps/mobile/src/config.ts`: `ridesUrl: "https://TU_PROYECTO.supabase.co/functions/v1/viajes"` y
  `sharedRidesUrl: "https://TU_PROYECTO.supabase.co/storage/v1/object/public/compartidos/vivo.json"`.
- `apps/web/src/config.ts`: `sharedRidesUrl` con la misma dirección de `vivo.json`.
(Son direcciones públicas, no secretos.)

### 8. Compilar con avisos remotos
- iPhone (el permiso de push se agrega solo con `TM_PUSH=1`; sin él la app compila como siempre):
```
TM_PUSH=1 bash apps/mobile/scripts/testflight-local.sh
```
- Android:
```
TM_FCM_FILE=~/.transmilive/google-services.json bash apps/mobile/scripts/playstore-local.sh
```
- Actualizar las declaraciones de privacidad en App Store Connect y en Google Play: «Identificadores del dispositivo» (código de
  avisos, para funcionalidad de la app, no vinculado a la persona) y, si se enciende compartir, «Ubicación precisa» opcional, no vinculada.
  La política (`apps/web/public/privacidad.html`) ya lo explica.

## Cómo probar
1. De día, «Voy en este bus» con un bus real y la parada de bajada a 4–5 paradas. Cerrar la app del todo (deslizar hacia arriba).
2. Deberían llegar «Faltan 3 paradas», «Prepárate para bajar» y «Bájate aquí» a tiempo, y la pantalla de bloqueo cambiar de paso.
3. Supabase → Table Editor → `viajes_activos`: el viaje aparece mientras dura y desaparece al terminar.
4. Edge Functions → `viajes` → Logs: cada 20 s una llamada a `tick` con `{"avisos":{"rides":1,"sent":…}}`.
5. Compartir: encender en Más, ir en un bus con la app abierta; en otro teléfono o en la web, ver ese bus más adelantado que antes.

## Apagar en caso de problema
```
supabase secrets set AVISOS_ACTIVOS=0 COMPARTIR_ACTIVO=0
```
Las apps vuelven solas a los avisos locales en ~90 s. Para parar el reloj: `select cron.unschedule('viajes-tick');` en el SQL Editor.

## Sin verificar (?)
- El código Swift nuevo (token de la actividad en vivo) no se compiló aquí. Si falla, mandar el bloque de errores.
- La función corre en Deno y no se pudo ejecutar en el contenedor de Claude (sí se probaron en Node las firmas, los mensajes y el núcleo).
- Que APNs acepte la conexión desde Supabase (pide HTTP/2; Deno lo hace) y los límites de Apple para actualizar actividades en vivo.
- En Android, que el aviso del servidor reemplace al local con el mismo nombre (`tag`) si ambos llegaran a salir.
