#!/usr/bin/env bash
# Mira cada ~7 s si TransMilenio publicó datos nuevos (ellos actualizan cada 21 s)
# y los sube a la rama "live-data" solo cuando cambian.
# Variables opcionales (para pruebas): REPO_URL, FEED_BASE, ITER, GAP.
set -uo pipefail
URL="${REPO_URL:-https://x-access-token:${GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git}"
BASE="${FEED_BASE:-https://gtfs.transmilenio.gov.co}"
N="${ITER:-40}"; GAP="${GAP:-7}"
W="$(mktemp -d)"; T="$(mktemp -d)"
git clone -q --depth 1 --branch live-data "$URL" "$W" 2>/dev/null || git init -q -b live-data "$W"
cd "$W"
git config user.name "transmi-live-bot"
git config user.email "actions@users.noreply.github.com"
for i in $(seq 1 "$N"); do
  changed=0
  for f in positions.pb tripupdates.pb alerts.pb; do
    if curl -fsSL --retry 2 --max-time 30 -A "Mozilla/5.0 (transmi-live)" -o "$T/$f" "$BASE/$f"; then
      if ! cmp -s "$T/$f" "$W/$f"; then cp "$T/$f" "$W/$f"; changed=1; fi
    else
      echo "no se pudo bajar $f"
    fi
  done
  if [ "$changed" = 1 ]; then
    git checkout -q --orphan "s$i"
    git add -A
    git commit -q -m "datos $(date -u +%Y-%m-%dT%H:%M:%SZ)"
    git push -q --force "$URL" "s$i":live-data && echo "[$i/$N] publicado $(date -u +%T)" || echo "[$i/$N] el push falló"
  fi
  [ "$i" -lt "$N" ] && sleep "$GAP"
done
exit 0
