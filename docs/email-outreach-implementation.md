# VideoComet Outreach v2 — Implementierungs-Kontrakt (verbindlich)

Dieses Dokument ist der **verbindliche Vertrag** für alle Implementierungs-Schritte (Step 1–4).
Alle Tabellen-, Spalten-, Datei- und Routen-Namen sind FIX. Nicht umbenennen, nicht "verbessern".
Grundlage: Team-Beschluss 22.07.2026 (Pitch: docs/pitch-email-marketing.html).

## 0. Kernentscheidung

Kunden verschicken **Kaltakquise ohne Opt-in**. Deshalb: Versand ausschließlich über das
**eigene Postfach des Kunden** (Modell Instantly/Lemlist). VideoComet ist neutraler
Werkzeug-Anbieter. Resend bleibt NUR für Systemmails (src/lib/mail.ts) — niemals für Kunden-Outreach.

Zwei Anbindungswege:
1. **Microsoft 365** via Graph API OAuth (delegated `Mail.Send Mail.Read offline_access`)
2. **Alle anderen** via generisches **SMTP (Versand) + IMAP (Rückkanal)** mit DACH-Presets

Kein Gmail-OAuth (CASA-Kosten), kein Open-Tracking-Pixel (Deliverability), Freemail-Absender
(gmx.de/gmx.net/web.de/freenet.de/t-online-frei) werden **geblockt** (kein DKIM-Alignment).

## 1. Repo-Konventionen (für alle Agenten PFLICHT)

- Repo: `/Users/kurzeja/videocomet-new`. Shell-cwd resettet → **jeder Bash-Befehl mit `cd /Users/kurzeja/videocomet-new && …`**.
- Check: NUR `npx tsc --noEmit` (ESLint ist kaputt). Kein Dev-Server starten.
- Altes TS-Target: `Array.from(set)` statt `[...set]` bei Sets/Maps.
- App-Route-Group heißt `(app)` — NICHT `(dashboard)`.
- Design 2026: Lavendel-Canvas `#f3f0fa`, Akzent `#7C5CE8`, randlose schwebende weiße Karten
  (rounded-2xl/3xl, shadow), dunkle Ink-Pill-CTAs. Bestehende UI-Kit-Komponenten aus
  `src/components/ui/` verwenden (dialog, badge, tabs, select, tooltip, page-header, empty-state, table, progress …).
- DB: Drizzle. Schema in `src/lib/db/schema.ts`, Migrationen per Repo-Konvention
  (bestehende `drizzle/`-Migrationen ansehen und Muster exakt folgen; Migration als SQL-Datei
  mit fortlaufender Nummer). Queries in `src/lib/db/queries/`.
- Auth: Lucia; Server-seitig bestehende Session-Helper verwenden (siehe bestehende API-Routen).
- Platzhalter-Engine: `src/lib/substitute.ts` (`{{key}}`, `{{key|fallback}}`, Sentinel `@system:pageUrl`).
- leadEvents: `src/lib/db/queries/lead-events.ts` + `src/app/api/track/*` — `kind` ist Freitext.
  Neue Kinds: `email_click`, `email_unsubscribe`, `email_reply`.
- Worker: `src/worker/index.ts` (Boot + Recovery-Pässe), Loop-Job-Muster `src/worker/jobs/domain-monitor.ts`,
  Queue-Factory `src/worker/queue.ts`.
- Soft-Delete-/Template-Muster: `envelopeTemplates` (deletedAt + partial index) als Blaupause.
- `leads.normalizedEmail` ist eine Postgres **GENERATED column** aus festen Keys
  (`data->>'email'|'Email'|'E-Mail'|'eMail'`, Migration 0030). Mapping anderer Spalten ⇒ Backfill
  `jsonb_set(data, '{email}', data->'MappedColumn')`.
- `leads.videoContentHash` existiert (Migration 0037).
- Neue npm-Deps (Step 1 installiert): `nodemailer`, `imapflow`, `@types/nodemailer`.

## 2. Env-Variablen

| Var | Zweck |
|---|---|
| `MAILBOX_KEY_SECRET` | AES-256-GCM Key für Postfach-Credentials (Boot-Assert im Worker + bei Nutzung) |
| `MS_CLIENT_ID` / `MS_CLIENT_SECRET` | Azure Multi-Tenant App (manuelle Registrierung durch Inhaber — UI muss fehlende Env sauber behandeln: M365-Button disabled + Hinweis) |
| `SPAMD_HOST` / `SPAMD_PORT` | optionaler SpamAssassin-Container; fehlt er ⇒ nur Heuristik |

Redirect-URI wird aus bestehender App-URL-Env abgeleitet (vorhandene Konstante/Env im Repo suchen, z. B. für share-Links genutzt): `{APP_URL}/api/auth/m365/callback`.

## 3. DB-Schema (FIX)

### `mailbox_connections`
- `id` uuid pk default random
- `userId` uuid notNull → users, cascade
- `provider` text notNull — `'m365' | 'smtp'`
- `emailAddress` text notNull (lowercase persistieren)
- `displayName` text
- `status` text notNull default `'connected'` — `'connected' | 'token_expired' | 'disabled'`
- `refreshTokenEncrypted` text (m365; MS rotiert Refresh-Tokens ⇒ nach JEDEM Refresh neu persistieren)
- `smtpHost` text, `smtpPort` integer, `smtpSecure` boolean (true=465 implizit TLS, false=587 STARTTLS)
- `imapHost` text, `imapPort` integer (default 993)
- `username` text, `passwordEncrypted` text (smtp)
- `allowInvalidTls` boolean notNull default false (explizites Opt-in; Versand/Sync müssen es respektieren)
- `dailyCap` integer notNull default 50 (Hard-Max 50, nicht vom User erhöhbar)
- `warmupStage` integer notNull default 0 — effektives Tageslimit: Stage 0 ⇒ 20, 1 ⇒ 35, ≥2 ⇒ min(dailyCap,50); Stage steigt nach je 5 aktiven Versandtagen
- `sentToday` integer notNull default 0, `sentTodayDate` date (Reset per Datumsvergleich in Kundenzeitzone)
- `nextEligibleAt` timestamptz
- `timezone` text notNull default `'Europe/Berlin'`
- `sendWindow` jsonb notNull default `{"days":[1,2,3,4,5],"startHour":8,"endHour":17}`
- `syncState` jsonb — m365: `{ deltaLink }`; smtp: `{ uidValidity, lastSeenUid }`
- `lastError` text, `lastSyncAt` timestamptz
- `createdAt`/`updatedAt`
- UNIQUE(`userId`,`emailAddress`)

### `email_templates`
- `id`, `userId` (cascade), `name` text notNull
- `subject` text notNull (mit Platzhaltern)
- `bodyJson` jsonb (TipTap), `bodyHtml` text notNull
- `ctaLabel` text notNull default `'Video ansehen'`
- `ctaUrl` text notNull default `'@system:pageUrl'`
- `signatureHtml` text
- `impressumHtml` text notNull — **Pflichtfeld**, ohne Impressum kein Speichern-als-fertig
- `deletedAt` timestamptz (Soft-Delete, Muster envelopeTemplates)
- `createdAt`/`updatedAt`

### `email_blasts`
- `id`, `userId`, `campaignId` notNull, `runId` (nullable), `mailboxConnectionId` notNull, `templateId` notNull
- `status` text notNull default `'draft'` — `'draft' | 'running' | 'paused' | 'completed' | 'cancelled' | 'failed'`
- `contentSnapshot` jsonb notNull — beim Start eingefrorene Vorlage `{subject, bodyHtml, ctaLabel, ctaUrl, signatureHtml, impressumHtml, gifConfig}`
- `totalCount` int notNull default 0, `sentCount` int default 0, `failedCount` int default 0, `skippedCount` int default 0, `bouncedCount` int default 0, `repliedCount` int default 0
- `creditsCharged` integer notNull default 0 (1 Credit = 10 Mails, aufgerundet, Charge beim Start)
- `confirmationLog` jsonb — protokollierter Selbstbestätigungs-Screen `{confirmedAt, textVersion, userId}`
- `startedAt`, `completedAt`, `createdAt`, `updatedAt`

### `email_messages`
- `id`, `blastId` notNull cascade, `leadId` notNull, `mailboxConnectionId` notNull
- `toEmail` text notNull
- `status` text notNull default `'scheduled'` — `'scheduled' | 'sent' | 'failed' | 'skipped' | 'bounced'`
- `claimedAt` timestamptz, `sentAt` timestamptz
- `internetMessageId` text — **eigene** Message-ID, VOR Versand generiert (`<uuid@videocomet.de>`) für deterministische NDR-Korrelation
- `graphMessageId` text, `conversationId` text (m365 Reply-Match)
- `unsubscribeToken` text notNull UNIQUE (random 32 hex)
- `repliedAt` timestamptz, `unsubscribedAt` timestamptz
- `skipReason` text, `error` text
- `createdAt`
- UNIQUE(`blastId`,`leadId`)

### `email_suppressions`
- `id`, `userId` notNull, `email` text notNull (lowercase), `reason` text notNull — `'unsubscribe' | 'bounce' | 'manual'`
- `sourceMessageId` uuid nullable, `createdAt`
- UNIQUE(`userId`,`email`)

### Erweiterungen bestehender Tabellen
- `campaigns.emailGifConfig` jsonb — `{ startSec, durationSec }` (durationSec 2–4, default 3)
- `leads.emailGifUrl` text, `leads.emailGifHash` text — Hash = `sha1(videoContentHash + JSON(gifConfig))`
- Credit-Transaktionen: neue kinds `'email_charge'` / `'email_refund'` (bestehendes Credit-System ansehen und exakt dessen Muster nutzen)
- **WICHTIG (Bunny-Reconcile!)**: Falls GIFs in Bunny Storage landen, referenzieren sie KEINE Stream-GUIDs — kein Eintrag in `buildKnownGuidSet()` nötig. Es dürfen aber niemals Stream-Video-GUIDs neu referenziert werden, ohne dass die Tabelle im Known-Set von `bunny-library-reconcile.ts` ist.

## 4. Bibliotheken (FIX)

- `src/lib/mailbox/crypto.ts` — verallgemeinertes AES-256-GCM-Util (Format `base64(iv):base64(tag):base64(ct)`, identisch zu `src/lib/crm/crypto.ts`, aber Key aus `MAILBOX_KEY_SECRET`). `src/lib/crm/crypto.ts` NICHT anfassen.
- `src/lib/mailbox/presets.ts` — DACH-Presets mit Domain-Erkennung:
  - IONOS: smtp.ionos.de:465 / imap.ionos.de:993
  - Strato: smtp.strato.de:465 / imap.strato.de:993 (Hinweis: 100 Mails/h Limit)
  - all-inkl: `[login].kasserver.com` (User trägt Login-Host selbst ein; Hinweistext)
  - Hetzner: mail.your-server.de:465/993
  - T-Online Business: securesmtp.t-online.de:465 / secureimap.t-online.de:993 (Hinweis: „Passwort für E-Mail-Programme" nötig)
  - mailbox.org: smtp.mailbox.org:465 / imap.mailbox.org:993
  - Zoho: smtp.zoho.eu:465 / imap.zoho.eu:993
  - Gmail/Workspace: smtp.gmail.com:465 / imap.gmail.com:993 (geführter App-Passwort-Wizard: 2FA-Pflicht, Warnhinweis 500/Tag privat bzw. 2.000/Tag Workspace, Workspace-Admin kann App-Passwörter sperren)
  - Freemail-Blockliste: gmx.de, gmx.net, web.de, freenet.de, t-online.de(privat), aol.com, outlook.com/hotmail(privat als SMTP — M365-Weg empfehlen)
- `src/lib/mailbox/smtp.ts` — nodemailer: `verifyConnection()` (transporter.verify + echte Testmail an sich selbst + ImapFlow `mailboxOpen('INBOX')`), `sendViaSmtp()` mit eigener Message-ID. `rejectUnauthorized:false` NUR als expliziter Opt-in-Parameter (default strikt).
- `src/lib/mailbox/imap.ts` — ImapFlow-Polling, UID-basiert (`uidValidity`-Wechsel behandeln = Reset lastSeenUid), 1 Session pro Postfach, keine IDLE-Verbindungen.
- `src/lib/msgraph/client.ts` — Token-Refresh (Rotation! immer neu persistieren; `invalid_grant`/`AADSTS70000` ⇒ status `token_expired` + laufende Blasts pausieren + Systemmail via `src/lib/mail.ts`), `sendMail` als **base64-MIME** (damit eigene Message-ID gesetzt werden kann), Inbox-Delta-Query.
- `src/lib/email/mime.ts` — RFC-konformer MIME-Builder: multipart/alternative (plain + html), Header `List-Unsubscribe: <mailto:…>, <{APP_URL}/abmelden/{token}>` + `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058), eigene Message-ID.
- `src/lib/email/render.ts` — HTML-Renderer: table-basiertes 600px-Layout, Inline-Styles, substitute.ts für Platzhalter, GIF-Bild verlinkt auf pageUrl, CTA-Button, Signatur, Pflicht-Impressum-Footer + Abmeldelink `{APP_URL}/abmelden/{token}`. CTA-/GIF-Links laufen über `{APP_URL}/api/email/r/{token}` (Click-Redirect). Plain-Text-Ableitung.
- `src/lib/email/spam-score.ts` — Heuristik (DE+EN Spam-Wortlisten, CAPS-Ratio, Ausrufezeichen, Link/Text-Verhältnis, Bild-ohne-Text, fehlendes Impressum, Betreff-Länge). Score: grün <3 / orange 3–5 / rot ≥5 mit konkreten Hinweisen. Optional spamd-Anreicherung wenn `SPAMD_HOST` gesetzt.

## 5. API-Routen (FIX)

- `GET /api/auth/m365/connect` — Redirect zu MS authorize; `state` = HMAC-signiert (Muster `src/lib/share-token.ts`)
- `GET /api/auth/m365/callback` — Code-Exchange, `/me` lesen, upsert mailbox_connection; Fehler `AADSTS65001` ⇒ Redirect auf Einstellungen mit Admin-Consent-Hinweis (`?m365Error=admin_consent` + fertiger Admin-Consent-Link)
- `GET/POST /api/mailboxes` — Liste / SMTP-Postfach anlegen (verify-Pipeline; Fehler mit verständlicher deutscher Meldung); Freemail-Domains ablehnen
- `PATCH/DELETE /api/mailboxes/[id]` — sendWindow/timezone/status(disable)/reconnect; Delete nur wenn kein laufender Blast
- `POST /api/mailboxes/[id]/test` — erneuter Verbindungstest
- `GET/POST /api/email-templates`, `GET/PATCH/DELETE /api/email-templates/[id]`
- `POST /api/email/spam-score` — `{subject, html}` ⇒ `{score, level, hints[]}`
- `POST /api/campaigns/[id]/email-blasts` — Blast anlegen (draft)
- `GET /api/email-blasts/[id]`, `POST /api/email-blasts/[id]/start` (Confirmation-Log + Credits chargen + Messages materialisieren + Suppression/fehlende-Mail/ungültige-Mail skippen mit Refund-Verrechnung), `POST .../pause`, `POST .../resume`, `POST .../cancel` (Refund unversendeter)
- `GET /api/email/r/[token]` — Click-Redirect: leadEvent `email_click` + 302 auf Ziel (pageUrl aus Message/Lead)
- `/abmelden/[token]` — Page (Bestätigung, ohne Login) + `POST /api/email/unsubscribe/[token]` (auch One-Click-POST direkt): suppression + `unsubscribedAt` + leadEvent `email_unsubscribe`
- GIF: `POST /api/campaigns/[id]/email-gif` — Config speichern + Job(s) enqueuen; `GET` Status

## 6. Worker-Jobs (FIX)

- `src/worker/jobs/email-drip.ts` — **repeatable Tick 60s** (Muster domain-monitor): je aktivem Postfach: Fensterprüfung (Mo–Fr 8–17 Kundenzeitzone via sendWindow), Tageslimit (warmup-effektiv), `nextEligibleAt` fällig? ⇒ genau EINE `email_messages`-Zeile atomar claimen (`FOR UPDATE SKIP LOCKED`, status scheduled, Blast running), rendern (contentSnapshot), senden (Graph oder SMTP), `sentAt`+IDs persistieren, `sentToday++`, `nextEligibleAt = now + rand(60–180s)`. Warmup-Stage-Fortschritt (5 aktive Versandtage je Stage) hier mitführen. **Kein Retry**: `claimedAt` >10min ohne `sentAt` ⇒ status failed (Doppelversand-Schutz), Recovery-Pass beim Worker-Boot analog `src/worker/index.ts`-Muster. Blast completed, wenn keine scheduled-Messages mehr.
- `src/worker/jobs/mailbox-sync.ts` — Loop 5min: je Postfach Rückkanal:
  - m365: Graph Inbox-Delta (`syncState.deltaLink`); smtp: ImapFlow UID-Fetch ab `lastSeenUid`
  - **NDR-Erkennung**: From postmaster@/mailer-daemon@/MAILER-DAEMON, multipart/report content-type; Korrelation via `internetMessageId` im Body/Headern ⇒ Message `bounced` + suppression(bounce) + Credit-Refund anteilig + Blast-Counter
  - **Reply-Erkennung**: In-Reply-To/References auf unsere Message-ID bzw. m365 `conversationId` ⇒ `repliedAt` + leadEvent `email_reply` + alle weiteren scheduled-Messages an diesen Lead skippen
- `src/worker/jobs/email-gif.ts` — BullMQ-Job je Lead: ffmpeg aus Lead-Video (Ausschnitt startSec/durationSec, 600px breit, 10fps, palettegen/paletteuse, Play-Button-Overlay), Hash-Cache via `emailGifHash` (identischer Hash ⇒ skip), Upload in Bunny Storage (Muster bestehender Thumbnail/PDF-Uploads), `leads.emailGifUrl` setzen. **Encode-Limiter beachten**: läuft ffmpeg über die bestehenden `runFfmpeg`-Wrapper (ffmpeg.ts / video-compress.ts), ist die Semaphore automatisch aktiv — diese Wrapper verwenden.
- Registrierung aller Jobs in `src/worker/index.ts` (Boot-Tick sofort + Recovery).

## 7. UI (FIX — Design 2026 beachten)

1. **Einstellungen → Tab „E-Mail-Postfächer"** (bestehende Einstellungen-Seite erweitern): Karte je Postfach (Provider-Icon, Adresse, Status-Badge, heute X/Limit, Warmup-Stufe, Sendefenster), Buttons „Microsoft-Postfach verbinden" (disabled + Tooltip wenn MS-Env fehlt) und „Anderes Postfach (SMTP/IMAP)" ⇒ Modal-Wizard (Muster `add-domain-modal.tsx`): E-Mail eingeben ⇒ Preset-Erkennung ⇒ Felder vorbefüllt ⇒ Passwort ⇒ Live-Verbindungstest mit Schritt-Anzeige (SMTP ✓ / Testmail ✓ / IMAP ✓); Gmail-Sonderweg mit App-Passwort-Anleitung; Freemail ⇒ Fehlermeldung mit Begründung.
2. **E-Mail-Vorlagen**: `/(app)/email-vorlagen` (Liste, Muster umschlaege/) + `/(app)/email-vorlagen/[id]` Editor: Zonen (Betreff, Text via TipTap mit Platzhalter-Insert wie LP-Editor, CTA-Label, Signatur, Pflicht-Impressum), rechts Live-Vorschau (gerenderte Mail mit Beispiel-Lead) + **Spam-Ampel** (debounced /api/email/spam-score, Badge + aufklappbare Hinweise).
3. **Blast-Wizard** `/(app)/kampagnen/[id]/email/neu` — 6 Schritte: ① Empfänger (Run/Kampagne wählen, Zähler: sendbar / ohne E-Mail / Suppression) ② Postfach wählen ③ Inhalt (Vorlage wählen/bearbeiten, Platzhalter-Kompatibilitätscheck gegen Lead-Daten) ④ GIF-Ausschnitt (Mini-Editor: Video-Preview, Range-Slider startSec + Dauer 2–4s, Live-Frame-Vorschau) ⑤ Zeitplan-Vorschau („~X Wochen bei Y/Tag", Fenster-Anzeige, Credits: Z) ⑥ Prüfen & Bestätigen (**Selbstbestätigungs-Screen**: Checkboxen „Ich versichere, dass ich die rechtlichen Anforderungen … erfülle", „Abmeldelink & Impressum sind enthalten (automatisch)", Volltext geloggt in confirmationLog) ⇒ Start.
4. **Kampagne → Tab „E-Mail"**: Blast-Liste + Detail `/(app)/kampagnen/[id]/email/[blastId]`: Progress („X von Y versendet, noch ~Z Tage"), Stat-Cards (Versendet/Klicks/Antworten/Bounces/Abmeldungen), Pause/Fortsetzen/Abbrechen, Message-Tabelle (Lead, Status, Zeitpunkt).
5. **Lead-Tabelle**: E-Mail-Status-Zelle (Icon: versendet/geklickt/geantwortet/Bounce/abgemeldet) wo Leads angezeigt werden (Run-Detail).
6. **Run-Wizard Mapping-Schritt**: optionales Feld „E-Mail-Spalte" mit Auto-Suggest (Spaltennamen ~ email/mail); gemappt ⇒ Backfill-Update `jsonb_set(data,'{email}',…)` beim Speichern, damit `normalizedEmail` greift. Ohne Mapping/Spalte: E-Mail-Feature für den Run einfach leer (kein Fehler).
7. **Admin-Konsole** (bestehenden Admin-Bereich erweitern): alle Blasts (User, Volumen, Status, Bounce-Quote), Kill-Switch je Blast/User, Suppression-Suche, Alarm-Anzeige bei Bounce-Quote >5%.
8. **Unsubscribe-Page** `/abmelden/[token]`: öffentlich, minimal, „Sie wurden abgemeldet", ohne Branding-Overkill, ohne Login.

## 8. Rechts-/Schutzpaket (in UI verankert, nicht optional)

- Caps/Ramp/Sendefenster NICHT vom User abschaltbar (nur Fenster/Zeitzone einstellbar, Cap nur ≤50).
- Abmeldelink + Impressum werden IMMER automatisch gerendert — Template ohne Impressum nicht aktivierbar.
- Selbstbestätigungs-Screen (Schritt 6) mit Protokollierung ist Pflicht vor jedem Start.
- Neutrales Wording überall: „E-Mail-Versand über Ihr Postfach" — KEINE Formulierungen wie „Spam-Filter umgehen", „Kaltakquise-Turbo".
- AGB/AVV kommt vom Anwalt (nicht Teil dieser Implementierung).

## 9. Step-Aufteilung

- **Step 1 — Fundament**: Deps, Schema+Migration, crypto, presets, msgraph-Client, smtp/imap-Libs, M365-OAuth-Routen, /api/mailboxes*, Einstellungen-UI Tab inkl. SMTP-Wizard-Modal.
- **Step 2 — Content**: email_templates CRUD (API+Pages+Editor), render.ts, mime.ts, spam-score (lib+API+UI-Ampel), GIF (Config-API, Worker-Job, Range-Editor-Komponente).
- **Step 3 — Versand**: Run-Wizard-Mapping, Blast-APIs (create/start/pause/resume/cancel, Credits), Blast-Wizard-UI (6 Schritte), email-drip.ts, mailbox-sync.ts, Suppression+Refunds, /abmelden/[token], /api/email/r/[token], leadEvent-Kinds.
- **Step 4 — Reporting & Polish**: Kampagnen-E-Mail-Tab, Blast-Detail, Lead-Status-Zellen, Admin-Konsole, Systemmail-Benachrichtigungen (token_expired, Blast fertig), Recovery-Pässe verifizieren, Gesamt-`tsc`, Konsistenz-Review.

Jeder Step endet mit `npx tsc --noEmit` fehlerfrei. Spätere Steps dürfen frühere Dateien erweitern, aber keine Kontrakt-Namen ändern.
