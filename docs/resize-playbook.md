# Resize-Playbook: Hetzner-Server auf 16 Kerne / 32 GB (und wieder zurück)

Stand: 2026-08-08 (W4 Skalierungs-Paket). Zielgruppe: Daniel bzw. wer auch
immer den Resize am Kampagnen-Tag durchführt. Gesamtdauer: **~15 Minuten
Downtime**, alle Schritte einzeln kopierbar.

## Wann wird resized? (Auslöser)

- Erste **terminierte 1.000er-Kampagne** (Kunde kündigt Groß-Run an), ODER
- **zwei Groß-Runs im selben Monat**.

Nicht auf Vorrat upgraden — zwischen Runs ist der Server fast leer, das
Upgrade kostet nur dann etwas, wenn es gebraucht wird (~34 €/Monat mehr,
beim Downscale wieder weg; Hetzner rechnet stundenweise ab).

## Die eine kritische Regel

> **Beim Resize die Festplatte NIEMALS mitvergrößern.**
> Im Hetzner-Rescale-Dialog gibt es zwei Modi: „nur CPU/RAM" und
> „CPU/RAM + Festplatte". Immer **nur CPU/RAM** wählen. Eine einmal
> vergrößerte Festplatte kann Hetzner **nicht wieder verkleinern** — dann
> wäre der Weg zurück auf den günstigen Plan für immer versperrt.

## Vorab-Checks (einmalig bzw. am Vortag, keine Downtime)

1. **Disk-Status in der Hetzner-Console prüfen:** Server → Rescale.
   Dort muss der Ziel-Plan (16 vCPU / 32 GB) mit der Option „nur CPU/RAM"
   wählbar sein. Falls die Console anzeigt, dass die Disk bereits größer
   ist als der kleine Plan erlaubt → STOPP, nicht downgradefähig, vorher
   melden.
2. **Snapshot/Backup:** Hetzner-Auto-Backups sollten aktiv sein (Console →
   Backups aktivieren, kostet 20 % des Serverpreises). Zusätzlich läuft
   täglich 03:00 UTC das DB-Backup nach Bunny (verschlüsselt) — Log prüfen:
   ```bash
   ssh -i ~/.ssh/videocomet root@178.105.208.68 "tail -3 /var/log/videocomet-db-backup.log"
   ```
   Da muss „offsite ok" stehen.
3. **Reboot-Probelauf:** bereits erledigt (2026-08-08) — alle Container
   kommen mit `--restart unless-stopped` selbst hoch. Muss nicht wiederholt
   werden, solange sich am Container-Setup nichts ändert.
4. **Kein Run aktiv:** Dashboard prüfen, dass gerade keine Runde
   produziert. Falls doch: warten oder den Kunden kurz informieren —
   laufende Jobs überleben den Neustart (BullMQ-Watchdogs holen sie
   zurück), aber sauberer ist ein leerer Moment.

## Upscale (am Tag der Groß-Kampagne, ~15 min)

### 1. Server herunterfahren (~1 min)

```bash
ssh -i ~/.ssh/videocomet root@178.105.208.68 "shutdown -h now"
```

### 2. Rescale in der Hetzner-Console (~5–10 min)

Console → Server `videocomet-server` → **Rescale** →
Ziel-Plan **16 vCPU / 32 GB** wählen → Modus **„nur CPU/RAM"**
(Festplatte unverändert!) → bestätigen. Hetzner migriert, danach
**Power On** klicken (startet nicht immer automatisch).

### 3. Hochfahren abwarten + Basis-Check (~2 min)

```bash
ssh -i ~/.ssh/videocomet root@178.105.208.68 "nproc && free -h && docker ps --format '{{.Names}}\t{{.Status}}'"
```

Erwartung: `nproc` = 16, ~31 GB RAM, alle 5 Container „Up"
(videocomet-app, -worker, -postgres, -redis, coolify-proxy).

```bash
curl -s https://app.videocomet.de/api/healthz
```

Muss `"redis":"ok"` und `"db":"ok"` liefern.

### 4. Limits auf 16 Kerne stellen (~3 min)

Die Encode-Limits sind seit W1 per Env steuerbar
(`src/worker/lib/encode-limiter.ts`). Auf dem Server in
`/opt/videocomet/.env` setzen bzw. ändern:

```
MAX_CONCURRENT_ENCODES=8
LIBX264_THREADS=3
```

(8 Encodes × 3 Threads ≈ 16 Kerne + Headroom. Default ohne diese
Zeilen: 4/3 für 8 Kerne.)

Env-Änderungen greifen **erst nach Container-Recreate** — Worker neu
erstellen (Standard-Kommando, ALLE Flags sind Pflicht):

```bash
docker rm -f videocomet-worker
docker run -d --name videocomet-worker --restart unless-stopped --shm-size=1g \
  --memory=16g --memory-swap=24g \
  --network videocomet-net \
  --env-file /opt/videocomet/.env \
  -u 0:0 \
  -v /data/coolify/proxy/dynamic:/traefik-dynamic:rw \
  -v /data/coolify/proxy/acme.json:/traefik-acme/acme.json:ro \
  -v /opt/videocomet/backups/acme:/acme-backup:rw \
  videocomet-worker:latest
```

Hinweis: `--memory=16g --memory-swap=24g` ist die 32-GB-Variante des
Worker-Limits (auf dem kleinen Server: 8g/12g).

### 5. Funktionscheck (~2 min)

```bash
docker logs videocomet-worker --tail 30
```

Erwartung: Worker-Startzeile ohne Fehler, Queues verbunden. Optional im
Dashboard eine Mini-Testrunde (2–3 Leads) starten.

**Fertig — Kampagne kann laufen.**

## Downscale (nach der Kampagne, ~15 min)

Gleiches Spiel rückwärts, sobald keine Runde mehr läuft:

1. In `/opt/videocomet/.env` zurück auf `MAX_CONCURRENT_ENCODES=4`
   (Zeile ändern oder entfernen — 4/3 ist der Default).
2. `shutdown -h now` → Console → Rescale auf den ursprünglichen Plan
   (geht nur, wenn die Disk nie vergrößert wurde — siehe kritische Regel)
   → Power On.
3. Worker-Recreate wie oben, aber mit `--memory=8g --memory-swap=12g`.
4. Healthz + `docker ps` prüfen wie in Schritt 3 des Upscales.

## Troubleshooting

| Symptom | Ursache / Fix |
|---|---|
| App erreichbar, aber `redis: fail` in healthz | App-Container hängt nur im `coolify`-Netz → `docker network connect videocomet-net videocomet-app` |
| Worker crasht mit „Traefik-dynamic-Ordner fehlt" | Recreate ohne die 3 `-v`-Mounts bzw. ohne `-u 0:0` — Kommando oben vollständig verwenden |
| Signup zeigt „Bot-Schutz-Prüfung fehlgeschlagen" | Nur nach App-Rebuild relevant (Build-Arg vergessen) — beim reinen Resize wird die App NICHT neu gebaut, sollte also nicht auftreten |
| Rescale-Dialog bietet nur „inkl. Festplatte" | Ziel-Plan hat kleinere Basis-Disk als aktuell belegt → anderen Plan wählen oder abbrechen und melden |
| Server startet nach Rescale nicht | Console → Power On manuell; danach `ssh` + `docker ps` |

## Warum nicht dauerhaft 16 Kerne?

Gemessen: Während eines Voll-Renders sind alle 8 Kerne am Anschlag,
zwischen Runs ist der Server fast leer. Mehr Kerne bringen nur an
Kampagnen-Tagen etwas — und der Resize dauert 15 Minuten. Deshalb:
Upgrade am Tag der Groß-Kampagne, Downgrade danach.
