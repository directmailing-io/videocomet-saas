#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# preflight-cleanup-cron.sh
#
# Triggert den internal-Endpoint, der ältere Preflight-Screenshots aus Bunny
# Storage löscht (siehe src/lib/preflight/cleanup.ts). Soll täglich um 04:00
# laufen — die Uhrzeit ist gewählt, weil Bunny und der Worker da idle sind
# und gleichzeitige Preflight-Runs unwahrscheinlich.
#
# Crontab-Eintrag (auf dem Produktiv-VPS, root-crontab oder service-user):
#
#   0 4 * * * /opt/videocomet/scripts/preflight-cleanup-cron.sh \
#     >> /var/log/preflight-cleanup.log 2>&1
#
# Voraussetzungen
# ───────────────
#   - `curl` ist installiert (Default auf Debian/Ubuntu/Alpine).
#   - Die Env-Var `CRON_SECRET` ist gesetzt (gleicher Wert wie im App-
#     Container's `CRON_SECRET`). Wenn der Cron als systemd-Timer läuft:
#     Environment=CRON_SECRET=... in der .service-Datei. Klassischer Cron:
#     in /etc/cron.d/preflight-cleanup vorab `CRON_SECRET=...` exportieren
#     oder via /etc/default/preflight-cleanup einlesen.
#   - Optional: `PREFLIGHT_CLEANUP_URL` überschreibt das Default-Target
#     (z.B. für Staging-Server).
#
# Verhalten
# ─────────
#   - Exit-Code 0 → Cleanup ok (200 vom Endpoint).
#   - Exit-Code !=0 → curl-/Server-Fehler. systemd/cron schickt Mail an root.
#   - 30s connect-timeout + 5min max-time (Bunny-LIST kann pro Run mehrere
#     Sekunden brauchen; bei 200 Runs pro Lauf sind 5min Puffer ausreichend).
# ──────────────────────────────────────────────────────────────────────────────

set -euo pipefail

URL="${PREFLIGHT_CLEANUP_URL:-https://app.videocomet.de/api/internal/preflight-cleanup}"

if [[ -z "${CRON_SECRET:-}" ]]; then
  echo "[preflight-cleanup-cron] FATAL: CRON_SECRET env var is not set." >&2
  exit 2
fi

echo "[preflight-cleanup-cron] $(date -u +%FT%TZ) starting → ${URL}"

curl \
  --fail-with-body \
  --silent \
  --show-error \
  --connect-timeout 30 \
  --max-time 300 \
  -X POST "${URL}" \
  -H "X-Cleanup-Secret: ${CRON_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{}'

# Final newline so the JSON-Response und der Log-Tag auf separaten Zeilen sind.
echo
echo "[preflight-cleanup-cron] $(date -u +%FT%TZ) done."
