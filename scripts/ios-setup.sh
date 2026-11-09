#!/usr/bin/env bash
# Prepara el proyecto de iPhone (solo en un Mac con Xcode). Se corre una vez; es seguro repetirlo.
# Uso: bash scripts/ios-setup.sh
set -euo pipefail
cd "$(dirname "$0")/.."

[ "$(uname)" = "Darwin" ] || { echo "Esto solo corre en un Mac con Xcode."; exit 1; }
command -v xcodebuild >/dev/null || { echo "Falta Xcode (instálalo desde la App Store y ábrelo una vez)."; exit 1; }

npm install
npm install -D @capacitor/core @capacitor/cli @capacitor/ios @capacitor/assets
npm run build
[ -d ios ] || npx cap add ios
npx @capacitor/assets generate --ios --assetPath assets
npx cap sync ios

# Info.plist: permiso de ubicación en español, sin pregunta de cifrado en cada envío, solo vertical en iPhone
PLIST="ios/App/App/Info.plist"
set_plist() { /usr/libexec/PlistBuddy -c "Set :$1 $2" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :$1 ${3:-string} $2" "$PLIST"; }
set_plist NSLocationWhenInUseUsageDescription "TransMi LIVE usa tu ubicación para mostrarte las paradas cercanas y cómo llegar. No se guarda ni se comparte." string
set_plist ITSAppUsesNonExemptEncryption false bool
set_plist CFBundleDisplayName "TransMi LIVE" string
echo "Listo. Siguiente: bash scripts/ios-testflight.sh"
