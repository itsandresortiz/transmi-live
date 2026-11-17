#!/usr/bin/env bash
# Capturas de TransMi LIVE en el simulador de iPhone, para revisar el diseño sin ir pantalla por pantalla.
# Uso (desde apps/mobile):  bash scripts/capturas.sh
#   - Compila la app para el simulador (sin la pantalla de bienvenida), la abre, pone la ubicación en Portal Suba,
#     recorre las pantallas principales en modo claro y oscuro y guarda las capturas en el Escritorio.
#   - No toca tu iPhone ni TestFlight. La primera vez tarda (compila); las siguientes, menos.
#   - Si ya compilaste antes y solo quieres repetir las capturas:  SOLO_CAPTURAS=1 bash scripts/capturas.sh
set -euo pipefail
cd "$(dirname "$0")/.."

command -v xcrun >/dev/null || { echo "Falta Xcode (xcrun). Este comando corre en el Mac."; exit 1; }

# un iPhone del simulador: el que ya esté encendido o, si no, el primero disponible
SIM="$(xcrun simctl list devices booted | grep -m1 -oE 'iPhone[^(]*\(([0-9A-F-]{36})\)' | grep -oE '[0-9A-F-]{36}' || true)"
if [ -z "$SIM" ]; then
  SIM="$(xcrun simctl list devices available | grep -m1 -oE 'iPhone 1[5-9][^(]*\(([0-9A-F-]{36})\)' | grep -oE '[0-9A-F-]{36}' || true)"
  [ -n "$SIM" ] || { echo "No encontré un iPhone en el simulador. Abre Xcode → Window → Devices and Simulators y crea uno."; exit 1; }
  xcrun simctl boot "$SIM" || true
fi
open -a Simulator
NAME="$(xcrun simctl list devices | grep "$SIM" | sed -E 's/^ *([^(]*[^ (]) *\(.*/\1/')"
echo "Simulador: $NAME"

if [ "${SOLO_CAPTURAS:-}" != "1" ]; then
  echo "Compilando para el simulador (varios minutos la primera vez)…"
  npm install --silent
  TM_CAPTURAS=1 npx expo run:ios --configuration Release --no-bundler --device "$SIM"
fi

OUT="$HOME/Desktop/TransMiLIVE-capturas-$(date +%Y%m%d-%H%M)"; mkdir -p "$OUT"
xcrun simctl location "$SIM" set 4.7481,-74.0943 || true          # Portal Suba
xcrun simctl privacy "$SIM" grant location com.transmilive.app || true
xcrun simctl status_bar "$SIM" override --time 9:41 --batteryState charged --batteryLevel 100 || true

# pantalla → enlace de la app (paradas y rutas reales: Portal Suba T2, Héroes, ruta 7)
SHOTS=(
  "01-inicio|transmilive:///"
  "02-mapa|transmilive:///mapa"
  "03-buscar|transmilive:///rutas"
  "04-como-llegar|transmilive:///viaje"
  "05-mas|transmilive:///mas"
  "06-parada-portal-suba|transmilive:///stop/74452"
  "07-parada-heroes|transmilive:///stop/61217"
  "08-ruta-7|transmilive:///route/14047"
  "09-en-que-bus-vas|transmilive:///enbus"
  "10-cerca|transmilive:///cerca"
  "11-avisos|transmilive:///avisos"
)

for MODE in light dark; do
  xcrun simctl ui "$SIM" appearance "$MODE"
  # se abre la app de cero en cada modo, para que las ventanas de la ronda anterior no queden encima
  xcrun simctl terminate "$SIM" com.transmilive.app >/dev/null 2>&1 || true
  xcrun simctl launch "$SIM" com.transmilive.app >/dev/null || true
  echo "Modo $MODE: esperando a que carguen rutas y buses…"; sleep 25
  for S in "${SHOTS[@]}"; do
    N="${S%%|*}"; URL="${S#*|}"
    xcrun simctl openurl "$SIM" "$URL" || true
    sleep 6
    xcrun simctl io "$SIM" screenshot "$OUT/$N-$MODE.png" >/dev/null
    echo "  ✓ $N ($MODE)"
  done
done
xcrun simctl status_bar "$SIM" clear || true
echo
echo "Listo: $OUT"
echo "Arrastra esa carpeta (o las imágenes) al chat."
open "$OUT"
