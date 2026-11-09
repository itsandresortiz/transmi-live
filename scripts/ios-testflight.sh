#!/usr/bin/env bash
# Construye la app y la sube a TestFlight desde la terminal (Mac con Xcode 15 o más nuevo).
#
# Variables (obligatorias):
#   TEAM_ID     tu Team ID de Apple (developer.apple.com → Account → Membership details)
#   ASC_KEY_ID  Key ID de la llave de la API de App Store Connect
#   ASC_ISSUER  Issuer ID (arriba de la lista de llaves)
#   ASC_KEY     ruta al archivo AuthKey_XXXX.p8 (no lo subas al repositorio)
# Opcionales: BUNDLE_ID (por defecto com.transmilive.app)
set -euo pipefail
cd "$(dirname "$0")/.."
: "${TEAM_ID:?falta TEAM_ID}" "${ASC_KEY_ID:?falta ASC_KEY_ID}" "${ASC_ISSUER:?falta ASC_ISSUER}" "${ASC_KEY:?falta ASC_KEY}"
BUNDLE_ID="${BUNDLE_ID:-com.transmilive.app}"
[ -f "$ASC_KEY" ] || { echo "No encuentro $ASC_KEY"; exit 1; }
[ -d ios ] || { echo "Primero corre: bash scripts/ios-setup.sh"; exit 1; }

npm run build
npx cap sync ios

# Cada subida necesita un número de compilación mayor que el anterior: se usa la fecha y hora.
BUILD="$(date +%y%m%d%H%M)"
OUT="build/ios"; rm -rf "$OUT"; mkdir -p "$OUT"
if [ -d ios/App/App.xcworkspace ]; then TARGET=(-workspace ios/App/App.xcworkspace); else TARGET=(-project ios/App/App.xcodeproj); fi
AUTH=(-allowProvisioningUpdates -authenticationKeyPath "$ASC_KEY" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER")

xcodebuild "${TARGET[@]}" -scheme App -configuration Release -destination 'generic/platform=iOS' \
  -archivePath "$OUT/App.xcarchive" "${AUTH[@]}" \
  DEVELOPMENT_TEAM="$TEAM_ID" PRODUCT_BUNDLE_IDENTIFIER="$BUNDLE_ID" CURRENT_PROJECT_VERSION="$BUILD" \
  archive

cat > "$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM_ID</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
</dict></plist>
PLIST

# Con «destination = upload», la exportación sube el .ipa directo a App Store Connect.
xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" -exportOptionsPlist "$OUT/ExportOptions.plist" \
  -exportPath "$OUT/export" "${AUTH[@]}"
echo "Subida enviada (compilación $BUILD). En App Store Connect → TestFlight aparece en unos 5–15 minutos."
