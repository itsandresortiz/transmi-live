#!/usr/bin/env bash
# Publica los archivos de una carpeta en la rama "live-data" (un solo commit, sin historial).
# Uso: bash scripts/publish.sh <carpeta>   (requiere GITHUB_TOKEN y GITHUB_REPOSITORY)
set -euo pipefail
SRC="${1:?carpeta con los archivos a publicar}"
URL="https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git"
WORK="$(mktemp -d)"
# conserva lo que ya hay en la rama (p. ej. gtfs-lite.zip) y reemplaza solo los archivos nuevos
git clone -q --depth 1 --branch live-data "$URL" "$WORK" 2>/dev/null || git init -q -b live-data "$WORK"
cp -f "$SRC"/* "$WORK"/
cd "$WORK"
git config user.name "transmi-live-bot"
git config user.email "actions@users.noreply.github.com"
git checkout -q --orphan snap
git add -A
git commit -q -m "datos $(date -u +%Y-%m-%dT%H:%M:%SZ)"
git push -q --force "$URL" snap:live-data
echo "Publicado en live-data: $(ls "$SRC" | tr '\n' ' ')"
