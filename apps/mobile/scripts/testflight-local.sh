#!/usr/bin/env bash
# Compila la app nativa en tu Mac y deja el .ipa listo para Transporter (o la sube directo con una llave de la API).
# Necesita: Mac con Xcode 26 o más nuevo, Node 22+, CocoaPods (brew install cocoapods) y tu Apple ID en Xcode → Settings → Accounts.
#   TEAM_ID                         obligatorio (developer.apple.com → Account → Membership details)
#   UPLOAD=transporter (por defecto) | api   (con api: ASC_KEY_ID, ASC_ISSUER, ASC_KEY=ruta al .p8)
#   BUNDLE_ID                       opcional (por defecto com.transmilive.app)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(git rev-parse --show-toplevel)"
git -C "$ROOT" fetch -q origin main 2>/dev/null || true
BEHIND="$(git -C "$ROOT" rev-list --count HEAD..origin/main 2>/dev/null || echo 0)"
if [ "${BEHIND:-0}" -gt 0 ] && [ -z "${SKIP_PULL_CHECK:-}" ]; then
  echo "Tu copia está $BEHIND cambios atrás de GitHub, así que compilarías una versión vieja."
  echo "Corre primero:  git pull   y vuelve a lanzar el script."
  exit 1
fi
echo "Compilando la versión $(git -C "$ROOT" rev-parse --short HEAD) ($(git -C "$ROOT" log -1 --format=%s | cut -c1-70))"
[ "$(uname)" = "Darwin" ] || { echo "Esto solo corre en un Mac con Xcode."; exit 1; }
: "${TEAM_ID:?falta TEAM_ID}"
UPLOAD="${UPLOAD:-transporter}"; BUNDLE_ID="${BUNDLE_ID:-com.transmilive.app}"
# con el widget (WIDGET=1) el identificador de cada parte ya viene del proyecto: forzar uno solo lo rompería
BUNDLE_OVERRIDE=(); if [ "${WIDGET:-}" != "1" ]; then BUNDLE_OVERRIDE=(PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID"); fi
if [ "$UPLOAD" = api ]; then
  : "${ASC_KEY_ID:?falta ASC_KEY_ID}" "${ASC_ISSUER:?falta ASC_ISSUER}" "${ASC_KEY:?falta ASC_KEY}"
  AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER"); DEST=upload
else
  AUTH=(-allowProvisioningUpdates); DEST=export
fi

npm install
npx expo prebuild --platform ios                      # genera ios/ (y corre pod install)
WS="$(ls -d ios/*.xcworkspace | head -1)"; SCHEME="$(basename "$WS" .xcworkspace)"
BUILD="$(date +%y%m%d%H%M)"; OUT="build/ios"; rm -rf "$OUT"; mkdir -p "$OUT"

# El registro completo queda en build/ios/archive.log; si falla, abajo salen solo los errores.
show_errors() { echo; echo "=== ERRORES ($1) ==="; grep -a "error:" "$OUT/$1.log" | sort -u | head -25; echo "Registro completo: $OUT/$1.log"; }
if ! xcodebuild -workspace "$WS" -scheme "$SCHEME" -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$OUT/App.xcarchive" "${AUTH[@]}" \
  DEVELOPMENT_TEAM="$TEAM_ID" ${BUNDLE_OVERRIDE[@]+"${BUNDLE_OVERRIDE[@]}"} CURRENT_PROJECT_VERSION="$BUILD" archive > "$OUT/archive.log" 2>&1; then
  show_errors archive; exit 1
fi
echo "Compilación lista."

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$DEST</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST
if ! xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" -exportOptionsPlist "$OUT/ExportOptions.plist" -exportPath "$OUT/export" "${AUTH[@]}" > "$OUT/export.log" 2>&1; then
  show_errors export; exit 1
fi

if [ "$UPLOAD" = api ]; then echo "Subida enviada (compilación $BUILD). Mira App Store Connect → TestFlight en 5–15 minutos."
else
  IPA="$(ls "$OUT"/export/*.ipa | head -1)"; echo "Archivo listo: $IPA"
  open -a Transporter "$IPA" || echo "Abre Transporter y arrastra ese archivo."
fi
