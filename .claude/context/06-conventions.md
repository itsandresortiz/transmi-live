# 06 · Convenciones y preferencias del dueño

## Idioma y tono
- **Todo texto de usuario en español colombiano, sin jerga**: nada de «feed», «batch», «fallback», «render», «token». Decir «datos en vivo», «lote», «copia de respaldo».
- Nombre del producto: **«TransMi LIVE»**.
- Con el dueño: responder en español, claro y breve; resumen de qué se hizo y qué probar. Los pasos de terminal van **en bloques de código separados, uno por comando o grupo corto**, sin prompt `$`. Preferir pocos pasos y decir qué debería verse al terminar.
- No pedir nunca llaves ni secretos en el chat (ver «Seguridad»). Si hace falta una credencial, decir dónde se guarda (en el Mac del dueño) y no pegarla.
- Ser honesto sobre lo no verificado: decir «no lo pude probar en un teléfono» cuando sea el caso; no afirmar que algo funciona sin haberlo comprobado.

## Reglas de datos mostrados (producto)
- **Nunca presentar un dato viejo como en vivo.** Si casi no hay buses: «Sin datos en vivo por ahora» sin sugerir que no hay servicio; si hay buses pero el dato tiene >5 min: «Datos con retraso» (`FeedStatus`).
- Cada tiempo de llegada indica si es en vivo o aproximado/programado; los tiempos en vivo llevan **segundos** (cuenta regresiva `3:05`) cuando el contexto lo permite.
- Los buses conservan el **color de su sistema**: troncal rojo, dual morado, alimentador verde, zonal azul, otro gris. Las troncales/duales llevan el color de su línea (A, B, C…) en recuadros y estaciones.
- Una parada debe listar **todas** las rutas que paran ahí aunque no tengan bus acercándose (con horario programado si existe), y el tiempo del bus más cercano.
- Los horarios programados se rotulan como programados, no como buses en vivo.

## Código
- TypeScript estricto. Dominio/aplicación puros y con pruebas (Vitest, `packages/*/test` y `test/`); toda lógica de tránsito nueva va a `packages/*`, no a las pantallas.
- Comentarios y mensajes de commit **en español**, explicando el porqué. El nombre del modelo aparece **solo** en los trailers de atribución (abajo), nunca en código, comentarios, títulos ni cuerpos de commit.
- No duplicar formatos ni reglas entre web y app: compartir en `packages/*` (hay deuda: `format.ts` y `stopname.ts` están duplicados; ver `09-open-items.md`).
- App: **no usar `formSheet`** (en iOS 27.2 con listas se ve en negro); todas las ventanas son `modal` con encabezado nativo y la X nativa (`CloseToolbar`). Un `card` empujado sobre un `modal` queda detrás: toda ventana que se abra desde otra debe ser `modal`.
- App/mapa: **no agregar ni quitar capas en caliente** (cierra la app): capas siempre montadas, cambiar `visibility`. No pasar un solo punto a `fitBounds` (cierra la app): usar `flyTo`.
- App: efectos de cristal solo sobre contenido (mapa); sobre el mapa usar `Glass scheme="light"` con texto oscuro. Botones principales: `PrimaryButton`. Cerrar = **X** (icono), no la palabra «Cerrar».
- App: las filas que se deslizan de lado deben llegar a los bordes de la pantalla (`marginHorizontal` negativo + `paddingHorizontal` en el contenido); si no, las fichas se recortan en seco en el margen.
- App: pantallas ocultas no deben repintarse (`useTransitVersion`/`useNow` ya dependen de `useIsFocused`); no calcular cosas pesadas en cada segundo.
- No tocar el motor de movimiento para «inventar» paradas cuando el bus no trae ninguna.
- Pruebas deben pasar **sin** `apps/mobile/node_modules` (así corre CI).

## Diseño / UI
- Apariencia tipo app de Apple: tipografía del sistema, Liquid Glass, esquinas continuas, hápticos suaves, animaciones con muelles, cuidado con el margen superior bajo el encabezado nativo (`contentInsetAdjustmentBehavior="automatic"`).
- **Curvas concéntricas**: cuando una forma redondeada contiene otra pegada a su borde, radio exterior = radio interior + margen (p. ej. pista 28 con margen 8 y burbuja 20). No meter una píldora dentro de una tarjeta de esquinas distintas con poco margen.
- Sin emojis en la interfaz: usar símbolos del sistema (`SymbolView`) con el color que corresponda.
- Respetar accesibilidad: «Reducir movimiento» (sin animaciones largas), contraste, texto grande, etiquetas para VoiceOver. Hay una prueba de contraste (`test/mobile-contrast.test.ts`).
- Estaciones y buses se dibujan igual en web y app (código compartido: `station-geometry.ts`, `busTop.ts`).
- Ideas de rediseño que el dueño quiere explorar (referencias de otra app de trenes): ver `09-open-items.md`.

## Git y entrega
- Rama de trabajo/entrega: **`main`** (se empuja a `main`; no se abren PR a menos que el dueño lo pida). Antes: tests, tipos y `expo export` en verde.
- **Correo de git anónimo** (no el personal del dueño). Cada commit termina con:
  `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` y `Claude-Session: https://claude.ai/code/session_…` (la URL de la sesión actual).
- La memoria (`.claude/`) **sí se sube** a `main` junto con el código (decisión del dueño, 2026-11-10). El repo es público: nunca nombrar ahí repos de terceros, otros proyectos del dueño ni detalles de sus cuentas.
- No lanzar `deploy-web` a mano justo tras un `push` (el `push` ya lo dispara).
- La función de Supabase **no se despliega desde aquí**: el dueño la despliega a mano.
- Las ramas de datos se reescriben a la fuerza; no mezclarlas con `main`.

## Seguridad
- **Nunca** escribir en el repo ni en el chat: llaves de API (`.p8`, `ASC_*` valores), tokens, contraseñas, UDID, correos, números de tarjeta TuLlave ni datos de personas. Solo nombres de variables.
- La lectura de la tarjeta enmascara el número (`maskedReading`) y no se registra.
- No escribir nada en repos de terceros (cualquier repo de referencia es solo lectura; borrar clones locales tras revisarlos). No usar recursos de otros proyectos del dueño.
- No usar APIs privadas ni suplantar a TransMilenio: solo datos abiertos.

## Cómo verificar y cómo reportar
- Mostrar evidencia (salida de tests, conteos con datos reales) en vez de afirmar. Si se mide algo, decir con cuántos lotes/buses.
- Si algo no se pudo comprobar (Swift, iPhone, red bloqueada), decirlo y dejar la instrucción exacta para que el dueño lo compruebe.
