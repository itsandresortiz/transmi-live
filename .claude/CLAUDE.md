# TransMi LIVE: instrucciones para Claude

Mapa en vivo del transporte de Bogotá (web + app nativa de iPhone) con un núcleo TypeScript compartido. La memoria persistente del proyecto está en `.claude/context/`: léela antes de actuar.

@context/README.md
@context/01-overview.md
@context/06-conventions.md
@context/09-open-items.md

## Lo esencial (resumen; el detalle está en `.claude/context/`)
- Habla y escribe **en español, sin jerga** (nombre: «TransMi LIVE»). Pasos de terminal en bloques cortos, de a uno.
- Lógica de tránsito → `packages/*` con prueba. Web en `apps/web`; app en `apps/mobile` (instalación propia, no es espacio de trabajo de la raíz).
- Verifica antes de afirmar: `npx vitest run`, `npx tsc --noEmit -p apps/web`, en `apps/mobile` `npx tsc --noEmit` y `npx expo export --platform ios --output-dir <temporal>`. El Swift y el iPhone **no** se pueden probar desde este entorno: dilo.
- Nunca escribas llaves, tokens, contraseñas ni datos personales (solo nombres de variables). No toques repos de terceros ni recursos de otros proyectos del dueño.
- Entrega en la rama `main` salvo que el dueño diga otra cosa; **no hagas commit/push si el dueño lo pide**. Commits en español, con el correo anónimo y los trailers de atribución del entorno.
- No despliegues la función de Supabase (lo hace el dueño) ni lances a mano el despliegue web tras un `push`.

## PROTOCOLO OBLIGATORIO de auto-actualización de la memoria
Tras cada cambio no trivial, antes de terminar el turno:
1. Añade una línea en `.claude/context/08-changelog.md`.
2. Actualiza el archivo temático afectado: `03-features.md` (funciones/pantallas), `04-database.md` (datos y persistencia), `05-integrations-and-ops.md` (integraciones, workflows, despliegue, variables), `02-architecture.md` (arquitectura), `06-conventions.md` (convenciones y preferencias del dueño).
3. Si hubo una decisión con trade-offs, regístrala en `07-decisions.md` (contexto, alternativa descartada, por qué).
4. Actualiza `09-open-items.md` (pendientes, bugs, deuda, ideas; marca ✅ lo resuelto).
5. Si el cambio contradice un doc, corrige el doc.

Al terminar una sesión con conocimiento valioso, guarda un resumen en `.claude/context/sessions/AAAA-MM-DD-tema.md` (objetivo, qué se hizo, archivos, decisiones, estado final, gotchas). Nunca guardes secretos. Marca con **(?)** lo que no hayas podido confirmar.

Un hook (`.claude/hooks/context-guard.sh`, registrado en `.claude/settings.json`) recuerda este protocolo una sola vez si hay cambios de código sin cambios en `.claude/context/`; no bloquea cambios triviales.
