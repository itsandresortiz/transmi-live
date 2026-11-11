#!/usr/bin/env bash
# Arma el paquete de Android para Google Play (un archivo .aab firmado) y lo deja en el Escritorio. Un solo comando.
# No sube nada: el archivo se arrastra a mano en Google Play Console.
# La llave de subida se crea la primera vez y se queda en este Mac (~/.transmilive); su clave se guarda en el Llavero de macOS. Nada de eso va al repositorio.
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
echo "Armando para Google Play la versión $(git -C "$ROOT" rev-parse --short HEAD) ($(git -C "$ROOT" log -1 --format=%s | cut -c1-70))"

export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
if [ -z "${JAVA_HOME:-}" ] && [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"; fi
[ -n "${JAVA_HOME:-}" ] && export PATH="$JAVA_HOME/bin:$PATH"
command -v keytool >/dev/null || { echo "No encuentro Java (keytool). Abre Android Studio una vez y vuelve a intentar."; exit 1; }

# la llave de subida: se crea una sola vez. Su clave se genera sola y se guarda en el Llavero de macOS (no hay que inventarla ni escribirla).
KEYDIR="$HOME/.transmilive"; STORE="$KEYDIR/transmilive-subida.jks"; ALIAS="subida"; ITEM="transmilive-llave-subida"
mkdir -p "$KEYDIR"; chmod 700 "$KEYDIR"
if [ ! -f "$STORE" ]; then
  echo "Creando la llave de subida (solo pasa la primera vez)…"
  NEW="$(openssl rand -hex 20)"
  security add-generic-password -U -a "$USER" -s "$ITEM" -w "$NEW"
  keytool -genkeypair -v -storetype JKS -keystore "$STORE" -alias "$ALIAS" -keyalg RSA -keysize 2048 -validity 10000 -storepass "$NEW" -keypass "$NEW" -dname "CN=TransMi LIVE, C=CO" >/dev/null 2>&1
  chmod 600 "$STORE"
  echo "Llave creada en $STORE. Guarda una copia de ese archivo en un lugar seguro (no en GitHub)."
fi
PASS="$(security find-generic-password -a "$USER" -s "$ITEM" -w 2>/dev/null || true)"
[ -n "$PASS" ] || { echo "No encuentro en el Llavero la clave de la llave de subida («$ITEM»). Avísale a Claude."; exit 1; }
export TM_UPLOAD_STORE="$STORE" TM_UPLOAD_ALIAS="$ALIAS" TM_UPLOAD_PASS="$PASS"
# número de compilación: año, mes, día y hora (siempre sube)
export TM_VERSION_CODE="$(date +%y%m%d%H)"

npm install
npx expo prebuild --platform android --clean --no-install
pkill -9 -f gradle 2>/dev/null || true
sleep 2
echo "Armando el paquete. Tarda entre 10 y 20 minutos; no cierres esta ventana."
(cd android && ./gradlew bundleRelease)
AAB="android/app/build/outputs/bundle/release/app-release.aab"
[ -f "$AAB" ] || { echo "No se generó el paquete. Mándale a Claude lo que salió arriba."; exit 1; }
# se comprueba que quedó firmado con la llave de subida y no con la de pruebas
if keytool -printcert -jarfile "$AAB" 2>/dev/null | grep -q "CN=TransMi LIVE"; then echo "Firma correcta (llave de subida)."; else echo "OJO: el paquete no quedó firmado con la llave de subida. No lo subas; avísale a Claude."; exit 1; fi
OUT="$HOME/Desktop/TransMiLIVE-$TM_VERSION_CODE.aab"
cp "$AAB" "$OUT"
echo
echo "Listo: $OUT  (versión 1.0.0, compilación $TM_VERSION_CODE)"
echo "Ese archivo es el que se arrastra en Google Play Console."
open -R "$OUT" 2>/dev/null || true
