#!/usr/bin/env bash
# Compila la app de Android y la instala en el emulador (o en un celular conectado). Un solo comando, igual que el de iPhone.
# Necesita: Android Studio con un emulador creado (Device Manager) y Java 17 (viene con Android Studio). No sube nada a ninguna tienda.
set -euo pipefail
SELF="$(cd "$(dirname "$0")" && pwd)/$(basename "$0")"
cd "$(dirname "$0")/.."
ROOT="$(git rev-parse --show-toplevel)"
git -C "$ROOT" fetch -q origin main 2>/dev/null || true
BEHIND="$(git -C "$ROOT" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
if [ "${BEHIND:-0}" -gt 0 ] && [ -z "${TM_PULLED:-}" ]; then
  echo "Bajando $BEHIND cambios nuevos de GitHub…"
  git -C "$ROOT" restore apps/mobile/package-lock.json 2>/dev/null || true
  git -C "$ROOT" pull -q --ff-only origin main || { echo "No se pudo bajar lo nuevo. Corre  git status  y mándale el resultado a Claude."; exit 1; }
  TM_PULLED=1 exec bash "$SELF" "$@"
fi
echo "Probando la versión $(git -C "$ROOT" rev-parse --short HEAD) ($(git -C "$ROOT" log -1 --format=%s | cut -c1-70))"

# herramientas de Android: Android Studio las deja en esta carpeta
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export PATH="$PATH:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator"
command -v adb >/dev/null || { echo "No encuentro las herramientas de Android (adb). Abre Android Studio una vez y deja que termine de instalar el SDK."; exit 1; }
if [ -z "${JAVA_HOME:-}" ] && [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"; fi

# emulador: si no hay ninguno prendido, se prende el primero que exista
if ! adb devices | awk 'NR>1 && $2=="device"' | grep -q .; then
  AVD="$(emulator -list-avds 2>/dev/null | head -1 || true)"
  [ -n "$AVD" ] || { echo "No hay ningún emulador. En Android Studio: More Actions › Virtual Device Manager › Create Device (un Pixel con la imagen más nueva)."; exit 1; }
  echo "Prendiendo el emulador «${AVD}»…"
  (emulator -avd "$AVD" -no-snapshot-save >/dev/null 2>&1 &)
  adb wait-for-device
  until [ "$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]; do sleep 2; done
fi

npm install
# versión «release»: lleva todo el código dentro, no necesita que el computador esté sirviendo nada
npx expo run:android --variant release
