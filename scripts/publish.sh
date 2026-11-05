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
echo "Publicado en $BRANCH: $(ls "$SRC" | tr '\n' ' ')"
