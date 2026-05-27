# VIDEOCOMET 2.0 - Deployment Guide (Coolify)

Diese Anleitung beschreibt das Deployment von VIDEOCOMET auf einem Hetzner-Server
mit Coolify als Orchestrator. Stand: 2026-05-27.

## 1. Voraussetzungen

- Hetzner CPX42 (oder vergleichbar) mit installiertem Coolify
- Auf dem Server bereits installiert: Docker, FFmpeg, LibreOffice, Ghostscript, Chromium
- GitHub-Repo: `directmailing-io/videocomet-saas`
- Domain `videocomet.de` zeigt per A-Record auf den Server
- Subdomain `app.videocomet.de` wird in Coolify auf den App-Service gemappt

## 2. GitHub-Repo mit Coolify verbinden

1. Coolify-UI oeffnen, links auf "Sources" -> "+ New Source" -> GitHub App.
2. GitHub App installieren und Zugriff auf `directmailing-io/videocomet-saas` erlauben.
3. In Coolify: "+ New Resource" -> "Application" -> Source = soeben verbundenes GitHub.
4. Repository: `directmailing-io/videocomet-saas`, Branch: `main`.
5. **Build Pack: "Dockerfile"** (nicht Nixpacks). Das Repo enthaelt ein
   produktionsfertiges Multi-Stage-Dockerfile (Next.js standalone output).
6. Port: `3000` (das setzt das Dockerfile via `EXPOSE 3000`).
7. Health-Check-Pfad: `/api/health` (siehe `HEALTHCHECK` im Dockerfile).

## 3. Datenbank-Service (PostgreSQL) in Coolify anlegen

1. Coolify-UI: "+ New Resource" -> "Database" -> "PostgreSQL 16".
2. Name: `videocomet-db`, Username/Password/DB-Name vergeben.
3. "Save" -> "Deploy".
4. Connection-URL kopieren (Format: `postgres://<user>:<pass>@<host>:5432/<db>`).
5. In der App-Service Coolify-UI unter "Environment Variables" als `DATABASE_URL` eintragen.

## 4. Redis-Service in Coolify anlegen

1. Coolify-UI: "+ New Resource" -> "Database" -> "Redis 7".
2. Name: `videocomet-redis`, Passwort vergeben.
3. "Save" -> "Deploy".
4. Connection-URL kopieren (Format: `redis://default:<pass>@<host>:6379`).
5. In der App als `REDIS_URL` eintragen.

## 5. Environment-Variablen

Setze in Coolify unter "Environment Variables" der App folgende Werte (siehe `.env.example`):

- `DATABASE_URL` - Postgres-URL aus Schritt 3
- `REDIS_URL` - Redis-URL aus Schritt 4
- `COOKIE_SECRET` - 64-Byte zufaelliger Hex-String (`openssl rand -hex 32`)
- `NEXT_PUBLIC_APP_URL` - `https://app.videocomet.de`
- `RESEND_API_KEY` - aus dem Resend-Dashboard
- `RESEND_FROM` - z.B. `noreply@videocomet.de`
- `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`, `BUNNY_STREAM_CDN_HOSTNAME`
- `BUNNY_PDF_STORAGE_ZONE`, `BUNNY_PDF_API_KEY`, `BUNNY_PDF_CDN_HOSTNAME`
- weitere App-spezifische Keys siehe `.env.example`

Geheimnisse niemals ins Git! Coolify speichert sie verschluesselt.

## 6. Domain + SSL

1. App-Service in Coolify oeffnen -> Tab "Domains".
2. `https://app.videocomet.de` als Domain eintragen.
3. "Generate Let's Encrypt SSL" aktivieren -> "Save".
4. Coolify holt automatisch ein Zertifikat (HTTP-01-Challenge) und renewt es alle 60 Tage.

DNS-Voraussetzung: `app.videocomet.de` A-Record zeigt auf die Server-IP.

## 7. Erst-Deploy

1. App-Service -> "Deploy" Button klicken.
2. Coolify pullt den Code, baut das Docker-Image (Multi-Stage), startet den Container.
3. Healthcheck wartet bis `/api/health` HTTP 200 liefert.
4. Bei Fehlern: "Logs" Tab pruefen.

## 8. Datenbank-Migrations

Nach dem ersten Deploy:

```bash
# Per SSH auf dem Server in den App-Container
docker exec -it <coolify-app-container> sh
npm run db:push        # oder drizzle-kit migrate, je nach Setup
npm run db:seed        # legt den ersten Admin info@daniel-kurzeja.de an
```

(Hinweis: `db:push`/`db:seed` muessen in package.json existieren; aktuell sind diese
Scripts noch nicht definiert - siehe DATA-Agent-Auftrag.)

## 9. Worker-Service (spaeter, fuer RENDER)

Der Video-Render-Worker laeuft als **zweiter Coolify-Service** im gleichen Stack:

1. Coolify-UI: "+ New Resource" -> "Application" -> gleiche Source (`videocomet-saas`).
2. **Build Pack: Dockerfile** - dasselbe Repo, anderer Entrypoint.
3. In Coolify "Custom Start Command" auf `node worker.js` setzen
   (oder ein eigenes `Dockerfile.worker` einfuehren).
4. Gleiche `DATABASE_URL` + `REDIS_URL` envs setzen.
5. Keine Domain - der Worker hat keine HTTP-Surface.
6. Anzahl der Replicas je nach Last (Start: 1, bei 1.500-Lead-Jobs spaeter skalieren).

## 10. Lokale Entwicklung

Statt Coolify nutzt man lokal `docker-compose.yml` fuer Postgres + Redis:

```bash
docker compose up -d
cp .env.example .env.local
npm install
npm run dev
```

App lauscht auf http://localhost:3000.

## 11. CI

GitHub-Actions-Workflow `.github/workflows/ci.yml` laeuft bei jedem Push/PR auf `main`:

- Node 22, `npm ci`
- `npm run test:run` (Vitest, slugify-Tests)
- `npm run build` (Next.js production build mit stub DATABASE_URL)

Coolify ist so eingestellt, dass es bei jedem Push auf `main` automatisch deployed
(Webhook-Trigger im Coolify-Repo-Setup).

## 12. Troubleshooting

- **Healthcheck failed**: Logs des Containers pruefen. Meist DB nicht erreichbar
  -> `DATABASE_URL` falsch oder Postgres-Service nicht running.
- **Out-of-Memory beim Build**: Hetzner CPX42 hat 16 GB, das reicht. Falls
  doch: Build-Stage in Coolify -> "Resource Limits" erhoehen.
- **Let's Encrypt schlaegt fehl**: DNS-A-Record nochmal pruefen, Port 80 muss
  offen sein (HTTP-01-Challenge).
- **`output: 'standalone'`** muss in `next.config.mjs` gesetzt sein, sonst kopiert
  das Dockerfile leere Verzeichnisse.
