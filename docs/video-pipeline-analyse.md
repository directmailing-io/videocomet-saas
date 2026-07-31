# Videogenerierung: Prozess- und Architektur-Analyse

Stand: 2026-07-31. Analysiert aus vier Rollen: Backend-Architekt, SRE/Betrieb, Produkt/UX, Kaufmann (Credits/Kosten).

---

## 1. Was passiert konkret, in welcher Reihenfolge?

### Phase 0: Upload & Wizard
1. CSV-Upload → Parsing, Spalten-Mapping, Dedupe-Konfiguration (`runs.column_mapping`, Status `draft`/`mapping`).
2. **POST /api/runs/[id]/start** (`src/app/api/runs/[id]/start/route.ts`): validiert Mapping, legt Leads an, prüft Credits (reserviert aber nicht), setzt A/B-Zuteilung.

### Phase 1: Pre-Flight (optional, nur `with-presentation`)
3. Für jeden Lead wird ein Job in die BullMQ-Queue **`lead-preflight`** gelegt (`src/lib/jobs/job-enqueue.ts:185-258`).
   - Concurrency **24**, 2 Attempts, exponentielles Backoff ab 5 s, Lock 60 s.
4. Worker (`worker/processors/preflight.ts`): Puppeteer öffnet die Lead-Website, klassifiziert (`ok`, `url_dead`, `tls_error`, `bot_block`, `url_redirect`, `slow`, …), speichert Screenshot bei Bunny (Purge nach 7 Tagen).
5. UI streamt Fortschritt per SSE (`/api/runs/[id]/preflight/stream`) + 3-s-Polling-Fallback. Run-Status: `preflighting` → `awaiting_approval`.
6. User sortiert aus, dann **POST /approve** (`approve/route.ts:40-164`) → Status `approved`, Phase 2 wird enqueued.
   - **Skip-Pfad**: `webcam-only`-Kampagnen und (neu) der Wizard-Toggle "Webseiten vorab prüfen: aus" setzen alle Leads auf `preflightStatus='ok'` und springen direkt zu Phase 2.

### Phase 2: Vollproduktion
7. Queue **`lead-pipeline`** (Concurrency **16**, 3 Attempts, Lock 90 s, `queue.ts:77-92/159-213`). Pro Lead 10 Stages (`worker/processors/pipeline.ts:405-1883`) mit Hard-Timeouts (`pipeline.ts:93-116`):
   1. Lead-Daten laden + validieren
   2. Website-Live-Capture (Puppeteer scrollt die Lead-Seite ab — **unabhängig vom Preflight-Screenshot**, mit Fallback-Bild bei DNS/404/Timeout)
   3. Video-Komposition rendern (FFmpeg, Timeout 300 s)
   4. Upload zu Bunny Stream (Timeout 330 s, **inkl. Warten auf Bunny-Encoding**)
   5. Thumbnail
   6. Landingpage generieren
   7. Brief-PDF (falls aktiviert, inkl. QR)
   8. Kurz-URL/Share-Token
   9. **Credit-Charge** (`pipeline.ts:1771-1805`): 1 Credit, nur bei Erfolg, UNIQUE-Constraint verhindert Doppelabbuchung
   10. Lead auf `completed`
8. Run-Status `generating` → `completed` (oder `failed`, wenn alle Leads scheitern).

### Betriebs-Sicherheitsnetze
- **Worker-Recovery** (`worker/index.ts:69-220`): alle 2 min werden Leads, die > 21 min in `rendering`/`uploading` hängen, zurückgesetzt bzw. auf `failed` gestellt.
- Stage-Timeouts töten hängende Puppeteer/FFmpeg-Prozesse, damit Slots frei werden.

---

## 2. Regeln im Fehlerfall (heute)

| Situation | Verhalten |
|---|---|
| Preflight-Job wirft | 2 Versuche (exp. Backoff), danach `preflightStatus` = Fehlerklasse; Lead bleibt reviewbar |
| Pipeline-Stage wirft | 3 Versuche gesamt (BullMQ-Retry), Fehlerbehandlung `pipeline.ts:1836-1879` |
| Lead final gescheitert | `leads.status='failed'` + Fehlermeldung; **kein Credit wird abgebucht** (Charge kommt erst in Stage 9) |
| Lead hängt (Worker-Crash) | Recovery-Sweep nach max. 21 min: Re-Enqueue oder `failed` |
| Website nicht erreichbar (Phase 2) | Kein Abbruch: Fallback-Visual, Video wird trotzdem produziert |
| Credit-Race | UNIQUE-Constraint auf Charge → nie doppelt bezahlt |
| Run ohne Credits gestartet | Start-Route blockt vorab; während des Runs kein Nachprüfen pro Lead |

**Wichtig fürs Geschäftsmodell:** Credits werden nur für erfolgreiche Videos abgebucht. Ein gescheiterter Lead kostet den Kunden nichts (uns aber Rechenzeit).

---

## 3. Optimierungspotenzial (priorisiert)

### Hoch
1. **Bunny-Encoding-Wait blockiert Worker-Slots** (Stage 4, bis 330 s): Der Worker wartet synchron, bis Bunny fertig encodiert. Bei 16 Slots können so viele Slots minutenlang nur "warten". Besser: Upload abschließen, Encoding-Status per separatem Poll-Job/Webhook prüfen → effektiver Durchsatz steigt deutlich ohne mehr Hardware.
2. **Keine Dead-Letter-Queue**: Nach 3 fehlgeschlagenen Versuchen ist der Job weg; Diagnose nur über `leads.preflight_error_message`/Logs. Eine DLQ (BullMQ `failed`-Jobs aufheben + Admin-Ansicht) würde systematische Fehler (z. B. Bunny-Ausfall) sichtbar machen.
3. **Kein Retry-Knopf für gescheiterte Leads in Phase 2**: Wenn 5 von 200 Leads failen, muss aktuell ein neuer Run her. Ein "Fehlgeschlagene erneut versuchen"-Button auf der Run-Seite wäre der größte UX-Gewinn.

### Mittel
4. **`autoApproveAfter` ist im Schema angelegt, aber ungenutzt**: Entweder Feature fertig bauen (Auto-Start nach X Stunden, wenn der User nicht reviewt) oder Spalte entfernen.
5. **Kein Circuit-Breaker bei externen Ausfällen**: Fällt Bunny aus, laufen alle Leads in den 3-fach-Retry und enden `failed`. Ein einfacher Health-Check vor dem Enqueue (oder Pause der Queue bei N Fehlern in Folge) spart Fehlläufe.
6. **Credits-Restprüfung während des Runs**: Start prüft das Guthaben einmal. Laufen zwei große Runs parallel, kann das Guthaben theoretisch ins Minus rutschen (Charge schlägt dann fehl → Lead failed spät). Frühe Reservierung ("hold") wäre sauberer.

### Niedrig
7. Preflight-Concurrency 24 vs. Pipeline 16: bei reinen Preflight-Phasen bleibt Renderkapazität ungenutzt; dynamische Gewichtung möglich, aber erst relevant bei mehr Last.
8. Recovery-Fenster 21 min ist konservativ; mit Stage-Timeouts (max. 330 s) könnte man auf ~12 min runter, damit hängende Leads schneller wieder anlaufen.

---

## 4. Umgesetzt in diesem Zuge (UX)

- **Wizard-Toggle "Webseiten vorab prüfen"** (Step 3, Standard: an; nur bei `with-presentation` sichtbar). Aus = alle Leads direkt in die Produktion (`skipPreflight`-Flag an der Start-Route, nutzt den vorhandenen webcam-only-Auto-Approve-Pfad, keine Migration). Gefahrlos, weil das Video die Website ohnehin live neu aufnimmt (`video-render.ts`) — der Preflight-Screenshot ist rein fürs Review.
- **Review-Ansicht minimalisiert**: 12 Multi-Select-Filterchips + Sortier-Dropdown ersetzt durch einen Segment-Schalter mit drei Sichten (Auffällig / OK / Alle, Standard: Auffällig, Counts inline), Suche daneben. "Aktualisieren"-Button entfernt (SSE + Tab-Fokus laden automatisch nach), Tastatur-Hinweiszeile auf das Wesentliche gekürzt (Pfeile, Enter, R, /). Sortierung fest "Probleme zuerst".
