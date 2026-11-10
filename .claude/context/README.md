# Memoria del proyecto TransMi LIVE

Esta carpeta es la memoria persistente del proyecto: cualquier sesión nueva (humana o de Claude) puede arrancar leyendo esto sin haber visto nada de las conversaciones anteriores.
Se mantiene viva siguiendo el protocolo de `.claude/CLAUDE.md`. Lo incierto está marcado con **(?)**. Aquí **nunca** van llaves, tokens, contraseñas ni datos personales: solo nombres de variables.

| Archivo | Qué contiene | Cuándo leerlo |
| --- | --- | --- |
| `01-overview.md` | Qué es la app, para quién, stack, estructura del repo, entornos y roles | Siempre, al empezar |
| `02-architecture.md` | Capas (DDD), flujo de datos, motor de movimiento, ETA, caché, módulos nativos, seguridad | Antes de tocar lógica o añadir un módulo |
| `03-features.md` | Mapa de pantallas, rutas, enlaces y funciones de la web y de la app iPhone | Antes de cambiar o crear una función o pantalla |
| `04-database.md` | No hay base de datos propia: dónde vive cada dato (ramas, archivos, almacenamiento local) | Antes de tocar datos, formatos o persistencia |
| `05-integrations-and-ops.md` | Fuentes externas, proxy de Supabase, workflows, despliegue web, TestFlight, variables | Antes de desplegar, compilar o tocar datos en vivo |
| `06-conventions.md` | Reglas de código, diseño, idioma, git y las preferencias del dueño | Siempre, antes de escribir código o textos |
| `07-decisions.md` | Decisiones con contexto, alternativa descartada y por qué | Antes de reabrir una decisión |
| `08-changelog.md` | Historial cronológico de todos los cambios (más nuevo arriba) | Para saber qué cambió y cuándo |
| `09-open-items.md` | Pendientes, bugs conocidos, deuda técnica, ideas | Siempre, antes de proponer trabajo nuevo |
| `sessions/AAAA-MM-DD-tema.md` | Resumen por sesión grande (objetivo, qué se hizo, gotchas) | Para el detalle de una etapa concreta |

## Lo mínimo que hay que saber en 30 segundos
- Es un mapa en vivo del transporte de Bogotá (TransMilenio, duales, alimentadores y SITP), en **web** (`apps/web`) y en **app nativa de iPhone** (`apps/mobile`, Expo), con un núcleo TypeScript compartido (`packages/*`).
- El usuario final habla español colombiano: **todos los textos en español, sin jerga**.
- Los datos salen de los feeds públicos de TransMilenio, reenviados por una función de Supabase y por GitHub Actions (ramas `live-data`, `schedule-data`). No hay base de datos propia.
- El dueño compila y sube a TestFlight desde su Mac con un script; Claude trabaja en un contenedor Linux sin Xcode, así que el código nativo (Swift) **no** se puede compilar allí.
- Antes de dar algo por hecho: `npx vitest run`, `npx tsc --noEmit` (en la raíz, en `apps/web` y en `apps/mobile`) y `npx expo export --platform ios` en `apps/mobile`.
