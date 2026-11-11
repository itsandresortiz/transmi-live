#!/usr/bin/env bash
# Publica los archivos de una carpeta en la rama "live-data" (un solo commit, sin historial).
# Uso: [BRANCH=otra-rama] bash scripts/publish.sh <carpeta>   (requiere GITHUB_TOKEN y GITHUB_REPOSITORY; rama por defecto: live-data)
set -euo pipefail
SRC="$(cd "${1:?carpeta con los archivos a publicar}" && pwd)"
BRANCH="${BRANCH:-live-data}"
URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
WORK="$(mktemp -d)"
# conserva lo que ya hay en la rama (p. ej. gtfs-lite.zip) y reemplaza solo los archivos nuevos
git clone -q --depth 1 --branch "$BRANCH" "$URL" "$WORK" 2>/dev/null || git init -q -b "$BRANCH" "$WORK"
cp -f "$SRC"/* "$WORK"/
cd "$WORK"
git config user.name "transmi-live-bot"
git config user.email "actions@users.noreply.github.com"
git checkout -q --orphan snap
git add -A
git commit -q -m "datos $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -q --force "$URL" "snap:$BRANCH"
# otro proceso (el bucle de datos en vivo) empuja a la misma rama cada pocos segundos y puede pisar lo recién publicado: se comprueba y se repite
for try in 1 2 3 4; do
  sleep 20
  git fetch -q --depth 1 "$URL" "$BRANCH" || continue
  ok=1
  for f in "$SRC"/*; do n="$(basename "$f")"; [ "$(git rev-parse "FETCH_HEAD:$n" 2>/dev/null)" = "$(git hash-object "$f")" ] || ok=0; done
  [ "$ok" = 1 ] && break
  echo "Lo publicado fue pisado por otro proceso; se publica de nuevo (intento $try)"
  git checkout -q FETCH_HEAD -- . 2>/dev/null || true
  cp -f "$SRC"/* "$WORK"/
  git checkout -q --orphan "snap$try"
  git add -A
  git commit -q -m "datos $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git push -q --force "$URL" "snap$try:$BRANCH"
done
echo "Publicado en $BRANCH: $(ls "$SRC" | tr '\n' ' ')"
