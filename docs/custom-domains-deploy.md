# Custom-Domains — Deploy-Anleitung

Diese Datei beschreibt die zusaetzlichen Server-Schritte fuer den Rollout der
Custom-Domain-Funktion (Migration 0004 + Worker-Jobs `domain-verifier` +
`domain-monitor`).

## 1. Datenbank-Migration

```bash
docker exec -i videocomet-postgres psql -U videocomet -d videocomet \
  < /opt/videocomet/build/app/drizzle/0004_custom_domains.sql
```

Idempotent ist sie nicht — bei erneutem Lauf wirft sie `relation already exists`.

## 2. Worker-Container neu starten mit Custom-Domain-Mounts + ENVs

Der Worker schreibt Traefik-YAMLs in den Dynamic-Folder des Coolify-Proxy
und liest dessen `acme.json` (read-only). Plus: tägliches Backup nach
`/opt/videocomet/backups/acme/`.

**Drei neue Bind-Mounts** und **fünf neue ENVs**:

```bash
docker rm -f videocomet-worker

docker run -d --name videocomet-worker --restart unless-stopped \
  --network videocomet-net \
  --env-file /opt/videocomet/.env \
  --shm-size=1g \
  -e TRAEFIK_DYNAMIC_DIR=/traefik-dynamic \
  -e TRAEFIK_ACME_PATH=/traefik-acme/acme.json \
  -e ACME_BACKUP_DIR=/acme-backup \
  -e SERVER_IP=178.105.208.68 \
  -e CNAME_TARGET=cname.videocomet.de \
  -v /data/coolify/proxy/dynamic:/traefik-dynamic:rw \
  -v /data/coolify/proxy/acme.json:/traefik-acme/acme.json:ro \
  -v /opt/videocomet/backups/acme:/acme-backup:rw \
  videocomet-worker:latest
```

**Vorbedingung:** Backup-Ordner anlegen, weil Docker sonst eine Datei statt
Ordner erzeugen koennte:

```bash
mkdir -p /opt/videocomet/backups/acme
chown 1001:1001 /opt/videocomet/backups/acme  # falls Worker als nicht-root laeuft
```

Verifizieren:

```bash
docker exec videocomet-worker ls -la /traefik-dynamic /traefik-acme /acme-backup
docker logs --tail 20 videocomet-worker 2>&1 | grep -E "verifier|monitor|boot sync"
```

Erwartete Log-Zeilen beim Boot:
```
[domain-verifier] boot sync: wrote 0 active config(s), removed 0 orphan(s), kept 0
```

## 3. App-Container — KEINE Aenderung noetig

Die App liest `user_domains` nur ueber Drizzle aus der DB — keine Filesystem-
Operationen. Der bestehende `docker run`-Befehl bleibt unveraendert.

## 4. End-to-End-Test mit `video.videocomet.de`

1. Im Browser: `https://app.videocomet.de/einstellungen` → Tab "Domains" →
   "Domain hinzufügen" → `video.videocomet.de`
2. Modal zeigt CNAME + TXT-Records. Da `video.videocomet.de` schon auf
   `cname.videocomet.de` zeigt, brauchen wir nur den TXT zu setzen:
   ```
   _videocomet.video.videocomet.de  TXT  vc-verify=<token aus UI>
   ```
3. Cloudflare/Hostinger TXT-Record setzen
4. Im UI auf "Pruefen" klicken oder 30s warten
5. Status sollte durch `verifying → issuing_cert → active` laufen
6. Test-Lead auf `https://video.videocomet.de/<slug>` aufrufen — kein
   VIDEOCOMET-Footer mehr sichtbar (White-Label)

## 5. Rollback-Plan

Falls etwas schiefgeht:

```bash
# 1. Worker mit alten Settings (ohne Mounts) zurueck
docker rm -f videocomet-worker
docker run -d --name videocomet-worker --restart unless-stopped \
  --network videocomet-net --env-file /opt/videocomet/.env --shm-size=1g \
  videocomet-worker:latest

# 2. Manuell alle vc-customdomain-*.yml entfernen (falls Traefik daran haengt)
rm -f /data/coolify/proxy/dynamic/vc-customdomain-*.yml

# 3. App auf vorigen Commit zurueck:
cd /opt/videocomet/build/app && git checkout <prev-sha> && docker build -t videocomet-app:latest .
# (App-Container recreate wie ueblich)

# 4. DB-Migration ist NICHT rueckwaertskompatibel:
#    - leads.domain_id ist nullable, behindert nichts
#    - leads_slug_uq Constraint ist weg, die zwei partial-indexes ersetzen ihn
#    Notfall-Restore: aus dem letzten Backup vor Migration.
```

## 6. Was Traefik dabei tut

Coolify-Proxy ist Traefik v3.6 mit dieser fixen Config (aus `docker inspect`):
```
--providers.file.directory=/traefik/dynamic/
--providers.file.watch=true
--certificatesresolvers.letsencrypt.acme.httpchallenge=true
--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=http
--certificatesresolvers.letsencrypt.acme.storage=/traefik/acme.json
```

Sobald unsere `vc-customdomain-video-videocomet-de.yml` im Dynamic-Folder
landet, registriert Traefik einen Router fuer `Host(video.videocomet.de)`
und triggert eine HTTP-01-ACME-Challenge. Das Cert wird in `acme.json`
hinterlegt. Beim naechsten HTTPS-Request liefert Traefik es aus.

Reload-Latenz: ~1-2s nach File-Write.
