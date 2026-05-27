# VIDEOCOMET 2.0 — Vollständige Spezifikation

Stand: 2026-05-27. Diese Datei ist die **Single Source of Truth** für alle Agenten.

## Mission

Multi-Tenant SaaS für personalisierte Outreach-Videos plus PDF-Brief.
Ziel: 1.500 Kontakte pro Job (Video + Landingpage + PDF), parallel, unter 2 Stunden.

## Tech-Stack (final)

- Next.js 14 App Router, TypeScript, Tailwind, shadcn-Patterns
- PostgreSQL 16 self-hosted (auf Server, via Coolify)
- Drizzle ORM
- Lucia v3 Auth (Argon2id, getrennte Rollen admin/user)
- BullMQ + Redis (Job-Queue)
- Server-Sent Events + Redis Pub/Sub (Realtime ohne Page-Refresh)
- Puppeteer + FFmpeg (Video-Render)
- LibreOffice + Ghostscript + pizzip + node-qrcode (PDF-Pipeline)
- Bunny.net Stream (Videos) + Edge Storage (PDFs)
- Resend (Mail)
- Hetzner CPX42 + Coolify (Hosting)

## Domains

- App: `app.videocomet.de`
- Landingpages: `app.videocomet.de/v/<slug>`
- Bunny Stream CDN: `vz-9c44b476-07a.b-cdn.net`
- Bunny PDF CDN: `videocomet-pdf.b-cdn.net`

## Design-Tokens

- Hintergrund: `#FFFFFF`, Surface-Soft: `#FAFAFA`, Border: `#EBEBEB`
- Text-Primary: `#222222`, Text-Secondary: `#717171`
- Akzent: `#AA8CF5`, Akzent-Soft: `#F3EEFF`, Akzent-Deep: `#7C5CE8`
- Radius: Squircle (10/14/18/22/28 px Skala)
- Buttons: voll rund (`rounded-full`)
- Font: Inter (Google Fonts) + JetBrains Mono
- Schatten: `0 6px 16px -8px rgba(20,20,30,.10)` Hover-Lift +2px
- Spacing: 4-Pixel-Raster
- Motion: 200ms `cubic-bezier(.2,.8,.2,1)`
- KEINE Em-Dashes (`—`) in Texten

## Daten-Hierarchie

```
User (admin oder user)
└── Campaigns (User-eigen, änderbar, löschbar)
    ├── Webcam-Video (aus Mediathek)
    ├── Modus: "webcam-only" oder "with-presentation"
    ├── Segmente: Website, Bild, Video, Google Docs, Textfolie
    ├── PiP: Position (left/right), Form (square/rounded/circle)
    ├── Landingpage-Vorlage
    └── PDF-Brief-Settings: enabled? googleDocsUrl, qrEnabled, thumbEnabled, frameMs
└── Runs (Runden pro Campaign)
    ├── Lead-Liste (XLSX/CSV/Google Sheets)
    ├── Column-Mapping (Platzhalter → Spalten)
    ├── Status, Fortschritt
    ├── Leads (n)
    │   ├── Video → Bunny Stream
    │   ├── Landingpage → /v/<slug>
    │   └── PDF → Bunny Storage (7d TTL)
    └── Analytics
└── Mediathek (Webcam-Recs, Bilder, Logos, Videos)
└── LandingPageTemplates (Themes Noir/Clean/Gradient/Warm)
```

## Rollen & Auth

- 2 getrennte Login-URLs: `/login` (user), `/admin/login` (admin)
- Keine Selbst-Registrierung
- Admin CRUD auf User: anlegen, aktivieren/deaktivieren, löschen (3-stufiger Confirm), Passwort manuell setzen, Reset-Mail
- User-Felder: Email, Password, Vorname, Nachname, Rechnungsadresse, Firma, USt-ID, Telefon
- Deaktiviertes Konto: Login zeigt "Dein Konto ist deaktiviert. Bitte wende dich an den Administrator."
- Multi-Tenant-Isolation: jede Query enthält `userId`-Filter (App-Layer)

## Kampagnen-Wizard (6 Schritte)

1. Webcam: aus Mediathek wählen oder neu aufnehmen
2. Modus: webcam-only ODER with-presentation
3. Editor (nur Modus 2): Segmente + PiP-Position + PiP-Form
4. Landingpage: Vorlage wählen
5. PDF-Brief: enabled? Google-Doc + QR + Thumb-Frame
6. Speichern

## Run-Workflow (8 Schritte)

1. Adressliste upload (XLSX/CSV/Google Sheets URL)
2. Übersichts-Tabelle der Daten (Umlaut-korrekt!)
3. Column-Mapping aller `{{...}}`-Platzhalter
4. Generierung starten (BullMQ-Jobs)
5. Live-Tabelle pro Lead mit Status (SSE)
6. Pro fertigem Lead: Landingpage-Link sofort sichtbar
7. Export XLSX/CSV mit URL-Spalten
8. PDF-Bundle-Download (25/50/100/150/200/250/500 pro ZIP)

## Pre-Mortem-Mitigations (kritisch)

- Puppeteer hängt → Timeout 60s, Job-Cancel, nächster Lead
- Tab geschlossen → Worker läuft weiter, State in DB persistiert
- Bunny-Upload fehl → exp. Backoff, max 3 Retries, dann DLQ
- Excel-Encoding (UTF-8/CP1252/Latin-1) → chardet, BOM-strip
- Slug-Eindeutigkeit → ä→ae usw. + 4-Hex-Suffix
- LP-Doc nicht öffentlich → Wizard-Validierung erzwingt Public
- LibreOffice-Crash → Retry mit reduzierter Stufe
- Video < Frame-Zeit → Clamp auf max. Dauer
- 500-PDF-Bundle → Streaming-ZIP, kein RAM-Spike
- SSE bricht ab → Reconnect + State aus DB nachladen

## Video-Kompression vor Bunny-Upload

H.264 (libx264), preset `veryfast`, CRF 26, 1280x720, 30fps, AAC 128kbps,
`yuv420p`, baseline-profile, `-movflags +faststart`.
Ziel-Größe: 3-5 MB für 30s.

## PDF-Pipeline (10 Stages pro Lead)

1. Video-Render (Puppeteer + FFmpeg)
2. Video-Upload Bunny Stream
3. Thumbnail-Frame (FFmpeg `-ss`)
4. QR-Code (node-qrcode)
5. Landingpage-Row erzeugen + Slug
6. DOCX modifizieren (Text + Bild-Tausch via pizzip)
7. DOCX → PDF (LibreOffice headless)
8. PDF komprimieren (Ghostscript `-dPDFSETTINGS=/ebook`)
9. PDF-Upload Bunny Storage (`expires_at = now + 7d`)
10. Lead-Status fertig → Realtime-Push

## Cascade-Löschung

- Run-Delete: alle Leads → Bunny-Video DELETE → PDF DELETE → DB-Cascade
- Campaign-Delete: Cascade auf Runs
- User-Delete (Admin): 3-Confirm → Cascade alles + Bunny-Cleanup
- 7d-Cron: PDFs mit `expires_at < now()` → Bunny DELETE

## Analytics

- Pro Lead: page_view, video_start, video_progress (25/50/75/100%), cta_click
- Aggregiert pro Run: Öffnungsquote, Ø Abspielquote, CTA-Quote, Heatmap
- Visualisierung: Recharts (Donut, Bar, Sparkline) in Brand-Lila
- Bot-Detection (Apple Mail / Gmail Pre-Fetch) separat markiert

## Aktueller Stand (was schon steht)

- ✅ Next.js + Tailwind + Logo + Design-System
- ✅ DB-Schema (alle Tabellen)
- ✅ Login-UI + Auth-Backend (Lucia)
- ✅ Slugify-Helper
- ✅ Hetzner-Server mit Coolify, Docker, Postgres-, Redis-, Chromium-, FFmpeg-, LibreOffice-, Ghostscript- vorinstalliert
- ✅ GitHub-Repo `directmailing-io/videocomet-saas`

## Was noch zu bauen ist (Agenten-Aufträge)

### DESIGN
- Komponenten: Button, Input, Label, Card, Modal, Toast, Table, Badge, Avatar, Progress, Dropdown, Tabs, Tooltip
- Layout-Shells: AuthLayout, AppLayout (mit Sidebar), AdminLayout
- Pages: Dashboard, Mediathek, Kampagnen-Liste, Kampagnen-Wizard (alle 6 Schritte),
  Runden-Liste, Run-Detail mit Live-Tabelle, Run-Analytics, Landingpage-Builder,
  Settings (User), Admin-Dashboard, Admin-User-Liste, Admin-User-Detail
- Public Landingpage `/v/[slug]` mit Video-Player + CTAs + Tracking
- Password-Reset-Pages

### AUTH
- POST /api/auth/password-reset/request (Resend mail)
- POST /api/auth/password-reset/confirm
- POST /api/auth/password-change (mit altem PW)
- POST /api/auth/logout
- /api/admin/users (CRUD)
- /api/admin/users/[id]/activate
- /api/admin/users/[id]/deactivate
- /api/admin/users/[id]/reset-password
- /api/admin/users/[id]/delete (3-stage confirm token)
- Middleware: protect /admin/* (admin role), /dashboard/* /app/* (user role)

### DATA
- Drizzle Migrations generieren + auf Server ausführen
- Seed-Script: ersten Admin `info@daniel-kurzeja.de` anlegen (mit zufällig generiertem PW, per Mail zugeschickt)
- DB-Helper für: campaigns CRUD, runs CRUD, leads CRUD, media items CRUD,
  landing page templates CRUD, analytics events
- Multi-Tenant-Guards (jede Query filtert userId)

### MEDIA
- Bunny.net Stream-Client (Upload, Delete, Get-Embed)
- Bunny.net Edge Storage-Client (Upload, Delete, signed URLs)
- Webcam-Recorder (MediaRecorder API im Browser)
- Mediathek API + UI
- File-Upload-Handler (formidable, max-size 500MB)
- Markerplatzhalter-PNGs generieren (qr-placeholder, thumb-placeholder)

### RENDER
- Worker-Service (Node + BullMQ Worker)
- Render-Pipeline pro Lead (10 Stages siehe oben)
- Puppeteer-Browser-Pool (1 Chrome, N Contexts)
- FFmpeg-Wrapper (Komprimierung-Preset, Frame-Extraktion, PiP-Composition)
- LibreOffice-Wrapper (DOCX → PDF via `soffice --headless`)
- Ghostscript-Wrapper (PDF-Komprimierung)
- DOCX-Manipulator (pizzip-basiert: Text-Replace + Media-Replace)
- QR-Code-Generator
- ZIP-Bundler (archiver streaming)
- Heartbeat-Service (DB-Eintrag alle 30s)
- 7d-PDF-Cleanup-Cron

### QA
- Vitest setup für Unit-Tests
- Playwright setup für E2E
- Test-Suite für Slugify + Umlaut-Cases
- Test-Suite für CSV-Encoding-Detection
- Test-Suite für Auth-Flows
- Coolify-Deployment-Config (Dockerfile, docker-compose)
- SSL via Coolify (Let's Encrypt automatisch)
- GitHub-Action: build-check on PR
- Health-Endpoint `/api/health` (DB + Redis + Bunny check)
- Monitoring-Endpoint für Worker-Status

## Reihenfolge

Parallel arbeitsfähig: DESIGN, DATA, AUTH (mit kleineren Abhängigkeiten)
Sequenziell: MEDIA → RENDER (RENDER braucht MEDIA's Bunny-Clients)
QA läuft mit, schreibt Tests parallel zu jeder Komponente.
