#!/usr/bin/env bash
# Construye la app y la sube a TestFlight desde la terminal (Mac con Xcode 15 o más nuevo).
#
# Dos formas de subir:
#   UPLOAD=transporter  (por defecto) exporta el .ipa y lo abre en la app Transporter; ahí inicias sesión con tu Apple ID.
#                       Para firmar usa la cuenta que ya tienes en Xcode (Xcode → Settings → Accounts).
#   UPLOAD=api          sube directo desde la terminal con una llave de la API de App Store Connect.
#
# Variables:
#   TEAM_ID     (obligatoria) tu Team ID de Apple (developer.apple.com → Account → Membership details)
#   ASC_KEY_ID, ASC_ISSUER, ASC_KEY   solo con UPLOAD=api: Key ID, Issuer ID y ruta al AuthKey_XXXX.p8 (no lo subas al repositorio)
#   BUNDLE_ID   opcional (por defecto com.transmilive.app)
set -euo pipefail
cd "$(dirname "$0")/.."
UPLOAD="${UPLOAD:-transporter}"
: "${TEAM_ID:?falta TEAM_ID}"
BUNDLE_ID="${BUNDLE_ID:-com.transmilive.app}"
if [ "$UPLOAD" = api ]; then
  : "${ASC_KEY_ID:?falta ASC_KEY_ID}" "${ASC_ISSUER:?falta ASC_ISSUER}" "${ASC_KEY:?falta ASC_KEY}"
  [ -f "$ASC_KEY" ] || { echo "No encuentro $ASC_KEY"; exit 1; }
  AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER")
  DEST=upload
else
  AUTH=(-allowProvisioningUpdates)      # firma con la cuenta de Apple que ya está en Xcode
  DEST=export
fi
[ -d ios ] || { echo "Primero corre: bash scripts/ios-setup.sh"; exit 1; }

npm run build
npx cap sync ios

# Cada subida necesita un número de compilación mayor que el anterior: se usa la fecha y hora.
BUILD="$(date +%y%m%d%H%M)"
OUT="build/ios"; rm -rf "$OUT"; mkdir -p "$OUT"
if [ -d ios/App/App.xcworkspace ]; then TARGET=(-workspace ios/App/App.xcworkspace); else TARGET=(-project ios/App/App.xcodeproj); fi
xcodebuild "${TARGET[@]}" -scheme App -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$OUT/App.xcarchive" "${AUTH[@]}" \
  DEVELOPMENT_TEAM="$TEAM_ID" PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" CURRENT_PROJECT_VERSION="$BUILD" \
  archive

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

xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" "${AUTH[@]}"

if [ "$UPLOAD" = api ]; then
  echo "Subida enviada (compilación $BUILD). En App Store Connect → TestFlight aparece en unos 5–15 minutos."
else
  IPA="$(ls "$OUT"/export/*.ipa | head -1)"
  echo "Archivo listo: $IPA"
  open -a Transporter "$IPA" || echo "Abre Transporter y arrastra ese archivo."
  echo "En Transporter: inicia sesión con tu Apple ID, pulsa «Entregar» y espera a que diga «Entregado». Luego mira App Store Connect → TestFlight."
fi
