#!/usr/bin/env bash
# Revisa que lo que alimenta la app esté al día y escribe los problemas encontrados (uno por línea) en $1.
# Sin problemas el archivo queda vacío. Fuera del horario de servicio (Bogotá 05:00-22:00) no se exige frescura de buses.
# Variables: REPO (owner/repo), PROXY (URL de la función de Supabase), GH_TOKEN.
set -u
OUT="${1:-problems.txt}"; : > "$OUT"
REPO="${REPO:-itsandresortiz/transmi-live}"
PROXY="${PROXY:-https://kmefztxxhipjowgcfxds.supabase.co/functions/v1/rapid-responder}"
RAW="https://raw.githubusercontent.com/$REPO"
NOW=$(date +%s)
HOUR=$(TZ=America/Bogota date +%H); HOUR=$((10#$HOUR))
SERVICE=0; [ "$HOUR" -ge 5 ] && [ "$HOUR" -lt 22 ] && SERVICE=1
bad() { echo "$1" >> "$OUT"; echo "PROBLEMA: $1"; }

# 1) el intermediario (Supabase) responde y trae datos
META=$(curl -fsS -m 25 --retry 2 "$PROXY/meta" 2>/dev/null || true)
if [ -z "$META" ] || ! echo "$META" | grep -q '"pos"'; then
  bad "El intermediario de datos (Supabase) no responde o devuelve un error: $PROXY/meta"
else
  echo "intermediario OK"
  if [ "$SERVICE" = 1 ]; then
    SIZE=$(curl -fsS -m 25 -o /dev/null -w '%{size_download}' "$PROXY/positions" 2>/dev/null || echo 0)
    [ "${SIZE:-0}" -lt 2000 ] && bad "El intermediario responde pero las posiciones llegan vacías (${SIZE} bytes) en horario de servicio."
  fi
  # la nueva consulta larga debe seguir funcionando
  LIVE=$(curl -sS -m 30 -o /dev/null -w '%{http_code} %{content_type}' "$PROXY/live?wait=0" 2>/dev/null || true)
  case "$LIVE" in "200 application/x-transmi-live"*) echo "consulta larga OK";; *) bad "La consulta larga /live del intermediario no responde como se espera ($LIVE). Puede estar desplegada una versión antigua de la función.";; esac
fi

# 2) la copia de respaldo (rama live-data) se está actualizando
MJ=$(curl -fsS -m 25 "$RAW/live-data/meta.json?t=$NOW" 2>/dev/null || true)
AT=$(echo "$MJ" | sed -n 's/.*"at":\([0-9]*\).*/\1/p')
if [ -z "$AT" ]; then bad "No se pudo leer meta.json de la rama live-data."
else
  AGE=$((NOW - AT)); echo "live-data: ${AGE}s"
  [ "$SERVICE" = 1 ] && [ "$AGE" -gt 1500 ] && bad "La copia de respaldo (rama live-data) lleva $((AGE / 60)) minutos sin actualizarse."
fi

# 3) el GTFS reducido (rutas, paradas y recorridos) no está viejo
TMP=$(mktemp -d)
if curl -fsS -m 120 -o "$TMP/g.zip" "$RAW/live-data/gtfs-lite.zip" 2>/dev/null && unzip -tq "$TMP/g.zip" >/dev/null 2>&1; then
  D=$(unzip -l "$TMP/g.zip" | awk '/routes.txt/ {print $2" "$3}')
  TS=$(date -u -d "$D" +%s 2>/dev/null || echo 0)
  if [ "$TS" -gt 0 ]; then
    DAYS=$(( (NOW - TS) / 86400 )); echo "gtfs-lite: ${DAYS} días"
    [ "$DAYS" -gt 3 ] && bad "El GTFS de rutas y paradas (gtfs-lite.zip) tiene $DAYS días sin actualizarse (el flujo gtfs-daily debería correr cada día)."
  fi
else
  bad "No se pudo descargar o abrir gtfs-lite.zip de la rama live-data."
fi
rm -rf "$TMP"

# 4) horarios (rama schedule-data) y estadísticas (rama hop-stats)
for B in schedule-data hop-stats; do
  C=$(gh api "repos/$REPO/commits?sha=$B&per_page=1" --jq '.[0].commit.committer.date' 2>/dev/null || true)
  if ! echo "$C" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'; then
    # una rama todavía inexistente o una consulta fallida no es motivo de alarma: solo se informa
    echo "$B: no se pudo leer ($C)" | head -c 200; echo; continue
  fi
  CT=$(date -u -d "$C" +%s); DAYS=$(( (NOW - CT) / 86400 )); echo "$B: ${DAYS} días"
  LIM=3; [ "$B" = hop-stats ] && LIM=2
  [ "$DAYS" -gt "$LIM" ] && bad "La rama $B lleva $DAYS días sin actualizarse."
done
exit 0
