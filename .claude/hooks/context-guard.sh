#!/usr/bin/env bash
# Hook «Stop»: si hay cambios de código sin cambios en .claude/context/, pide documentarlos (una sola vez por turno).
# No bloquea si el cambio es trivial (un solo archivo y pocas líneas) o si solo cambian docs, imágenes, lockfiles o configuración suelta.
# Entrada (stdin): JSON del hook con `stop_hook_active`. Salida: nada (deja terminar) o {"decision":"block","reason":"…"}.
set -uo pipefail

input="$(cat 2>/dev/null || true)"
active="$(printf '%s' "$input" | python3 -c 'import sys,json
try: print(bool(json.load(sys.stdin).get("stop_hook_active", False)))
except Exception: print(False)' 2>/dev/null || echo False)"
[ "$active" = "True" ] && exit 0                      # ya se pidió una vez en este turno: no hacer bucle

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" 2>/dev/null || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

# archivos tocados: sin commitear (staged, sin stage, sin seguimiento) y commits aún no empujados
changed="$( { git status --porcelain 2>/dev/null | sed -E 's/^.{2} //; s/.* -> //; s/^"//; s/"$//'; git diff --name-only '@{upstream}..HEAD' 2>/dev/null; } | sort -u )"
[ -z "$changed" ] && exit 0

# «código»: lo que cambia el comportamiento del producto (no docs, imágenes ni lockfiles)
code="$(printf '%s\n' "$changed" | grep -E '^(apps|packages|supabase|scripts|tools|test|\.github)/' | grep -vE '(package-lock\.json|\.md$|\.(png|jpg|jpeg|svg|webp|ico|ipa)$|tsbuildinfo|^apps/web/public/|/assets/)' || true)"
[ -z "$code" ] && exit 0

printf '%s\n' "$changed" | grep -qE '^\.claude/context/' && exit 0     # ya se documentó

# trivial: un solo archivo y menos de 15 líneas tocadas
n="$(printf '%s\n' "$code" | wc -l | tr -d ' ')"
lines="$( { git diff --numstat HEAD -- $code 2>/dev/null; git diff --numstat '@{upstream}..HEAD' -- $code 2>/dev/null; } | awk '{a+=$1; d+=$2} END {print a+d+0}' )"
[ "$n" -le 1 ] && [ "${lines:-0}" -lt 15 ] && exit 0

python3 - <<'PY'
import json
print(json.dumps({"decision": "block", "reason": "Documenta el cambio en .claude/context según CLAUDE.md (changelog 08, archivo temático afectado, decisiones 07 y pendientes 09). Nunca guardes secretos."}))
PY
exit 0
