# Abschlussbericht: Rundengenerierung härten + beschleunigen (2026-08-20)

Auftrag: Runde „2. Runde 20.8.2026" (Kampagne „Zahnärzte Aug Kampagne", julius@juliusthiesen.de) meldete 77/77 erfolgreich, obwohl bei Lead `stephanie-stirn` Webseiten-Inhalte im Video fehlten. Grundlegende Analyse + Härtung der gesamten Rundengenerierung.

## Die 11 Abschlussfragen

### 1. Was war die konkrete Ursache bei stephanie-stirn?
Ihre Video-Szenen mit Webseiten wurden live im Browser aufgenommen. Jede Aufnahme hatte ein Zeitbudget von 90 Sekunden — aber in diesem Budget steckte auch die Wartezeit auf einen freien „Lade-Slot" (max. 2 gleichzeitige Ladevorgänge pro Ziel-Website). Bei 77 Leads gleichzeitig, die alle dieselbe fixe Website (juliusthiesen.de) aufnehmen wollten, wurde die Warteschlange so lang, dass das Budget schon vor der eigentlichen Aufnahme aufgebraucht war. Der Code hat den Fehler dann **stillschweigend verschluckt** und stattdessen eine „Website nicht erreichbar"-Platzhalterseite ins Video gerendert — ohne Event, ohne Fehlerstatus. Der Lead galt als Erfolg.

### 2. Warum nur bei bestimmten Leads?
Reines Timing/Glück: Wer früh einen Slot bekam, bekam die echte Aufnahme; wer lange warten musste, lief ins Timeout. Deshalb waren 26 von 77 Videos betroffen, die übrigen nicht. Leads, deren Pipeline-Job aus anderem Grund neu anlief, bekamen manchmal im 2. Anlauf eine echte Aufnahme (weniger Last).

### 3. Welche weiteren Schwachstellen wurden gefunden?
- **Stille Platzhalter überall:** Auch Google-Docs-Szenen und Webseiten-Szenen mit Konfigurationsfehlern (z. B. keine URL für den Lead auflösbar) liefen still als Platzhalter oder schwarzer Clip durch.
- **Fixe Szenen wurden pro Lead neu aufgenommen:** identischer Inhalt 77× parallel gerendert — Ursache der Überlast UND massive Verschwendung.
- **Preflight-Lücke:** Für Runden aus Kontaktlisten (Status `generating` statt `preflighting`) wurde der Webseiten-Vorabcheck für ALLE Leads still übersprungen (75/77 hatten preflight_status `pending`).
- **Capture-Timeout zu knapp:** 90 s fix, unabhängig von Szenenlänge und Last.
- **Render-Limits zu hoch** für die Serverkapazität (6 auf dem Hauptserver, 12 auf render-1).

### 4. Welche Änderungen wurden tatsächlich vorgenommen? (Commits 602b416 + 84e26c8, deployed)
- **Fail-Loud:** Szenen-Fehler werfen jetzt. Kein Platzhalter, kein schwarzer Clip. Der Lead schlägt sichtbar fehl, mit Klartext-Event („Szene N (website) konnte nicht gerendert werden. Grund: …").
- **1 Sofort-Retry** pro Website-/GDocs-Aufnahme (5 s Pause, frisches Verzeichnis), erst danach Fehler.
- **Konfigurationsfehler = `SegmentConfigError`** (UnrecoverableError): kein sinnloses BullMQ-Retry, sofort sichtbarer Fehlschlag.
- **Fixed-Segment-Cache** (`src/worker/lib/website-segment-cache.ts`): Szenen mit `personalized: false` werden **einmal pro Prozess** gerendert, alle Leads bekommen Kopien. Parallele Anfragen teilen einen Render (kein Thundering Herd, auch nicht nach Fehlschlag), Disk-Cache in /tmp mit ffprobe-Validierung + 2 h TTL. Intro-Trim-Fälle werden aus der Voll-Version pro Lead geschnitten (kein Cache-Splitting).
- **Capture-Timeout dynamisch:** `Szenendauer × 2 + 120 s`, min. 150 s, max. 540 s.
- **Preflight-Gate** akzeptiert jetzt auch Runden im Status `generating`.
- **Render-Limits:** Hauptserver 6→4, render-1 12→8.

### 5. Wie verhindert das System vergleichbare Fehler zukünftig?
Ein fehlender Bestandteil kann nicht mehr still als Erfolg durchlaufen: Jeder Szenen-Fehler wirft, der Lead wird nach 3 Pipeline-Versuchen als `failed` markiert und taucht in der Runde als Fehlschlag auf. Fixe Szenen laufen zusätzlich gar nicht mehr durch den Last-Engpass, weil sie nur noch 1× gerendert werden.

### 6. Wie erkennt das System unvollständige Generierungen?
Während der Generierung: Fail-Loud + Events pro Szene. Rückwirkend/extern: Für den Incident habe ich zusätzlich einen Frame-Scan gebaut (PSNR-Vergleich gegen den bekannten Platzhalter-Frame), der fertige Videos auf Platzhalter prüft — Skript auf dem Server unter `/tmp/segcheck/scan.sh`.

### 7. Wie funktioniert Retry/Recovery?
3 Ebenen: (a) 1 Sofort-Retry der Aufnahme im Job, (b) 3 BullMQ-Versuche der ganzen Lead-Pipeline (exponentieller Backoff), außer bei Konfigurationsfehlern (Unrecoverable), (c) manuelle Regenerierung pro Lead/Runde (`lib/regenerate.ts`, Slug und Links bleiben stabil). Credits: Fehlgeschlagene Leads werden nicht belastet; Regen berechnet nicht doppelt (idempotente Charge).

### 8. Welche Tests wurden durchgeführt, mit welchem Ergebnis?
- **12 neue Unit-Tests** (video-render.segments.test.ts: 9, website-segment-cache.test.ts: 3): Fail-Loud-Pfade, Retry, UnrecoverableError, Cache-Sharing, Thundering-Herd-Schutz, Intro-Trim, Erfolgspfad. Gesamt-Suite: **1080 Tests grün**, `tsc` fehlerfrei.
- **Unabhängiger Verifier-Subagent** (frischer Kontext) fand 4 echte Probleme (Thundering Herd nach Cache-Fehler, Cache-Key-Fragmentierung durch Intro-Trim, ungeschütztes Cache-Delete, Timeout > Stage-Limit) — alle behoben (84e26c8), Nachprüfung bestanden.
- **Produktions-Verifikation:** Beide Worker nach Deploy sauber gebootet (Logs geprüft); Video-Scan über 88 fertige Videos lief fehlerfrei und trennt eindeutig (echte Aufnahme ≤ 3,3 dB vs. Platzhalter ≥ 52,9 dB).

### 9. Welche Performance-Bottlenecks wurden gefunden?
- Fixe Szenen N× statt 1× gerendert (größter Hebel, jetzt behoben: bei 77 Leads ~150 Browser-Aufnahmen gespart pro Runde).
- Host-Slot-Serialisierung (2/Host) multipliziert Wartezeit bei gleicher Ziel-URL — durch den Cache praktisch entschärft.
- Bekannt aus 08-18-Analyse: Google-Docs-Rendering bleibt der größte per-Lead-Kostenblock (separates Thema, Doc-Cache offen).

### 10. Zuverlässigkeit/Geschwindigkeit vorher vs. nachher?
- **Vorher:** Runde konnte „erfolgreich" sein mit kaputten Videos (26/77 im Incident-Run); kein Event, kein Hinweis. Fixe Szenen kosteten pro Lead eine Echtzeit-Browseraufnahme.
- **Nachher:** Defektes Video ⇒ Lead failed + Klartext-Event; fixe Szenen 1 Render pro Runde statt 77 (im Incident-Szenario ×2 Szenen = 152 gesparte Aufnahmen à 10–22 s Echtzeit + Browserlast). Messbarer Vorher/Nachher-Laufzeitvergleich einer echten 77er-Runde steht aus (bewusst kein Testlauf auf Julius' Account ohne Freigabe).

### 11. Welche Restrisiken bestehen?
- **Alt-Kampagnen ohne Szenen-Editor** (Legacy-Pfad `renderPresentationBase`) haben weiterhin stille Platzhalter — bewusste Scope-Entscheidung, betrifft keine neuen Kampagnen.
- Leads mit **wirklich toter Website** schlagen jetzt sichtbar fehl statt Platzhalter zu bekommen — gewollt, aber neuer Support-Fall (URL korrigieren + regenerieren).
- Der Prozess-Cache ist pro Worker-Prozess; bei 2 Servern wird eine fixe Szene max. 2× gerendert (ok).
- Bunny-MP4-Backfill (`video_mp4_url` bleibt NULL) ist weiterhin nicht funktional — HLS spielt, aber MP4-Downloads fehlen (separates Thema).

## Betroffene Videos (Scan-Ergebnis, warten auf Freigabe zur Regenerierung)

**Run „2. Runde 20.8.2026" (35d82a0a, 77 Leads): 26 betroffen.**
Beide juliusthiesen-Szenen defekt (15): benjamin-schulte-3b29, berthold-kappek-a674, borwin-wolter-a068, burkhardt-lenz-f3b1, christiana-walter-d1ec, daniela-radon-a963, daniel-tandon-16eb, joerg-noecker-709f, martin-hoppe-0efa, moritz-finkeldey-e2e9, negin-nazer-9963, pasha-javadi-fd88, robert-berdik-975b, stephanie-stirn-8a8d, thorben-soer-8ad2.
Nur Schluss-Szene defekt (11): christiane-hirschfelder-f4ba, daniel-tandon-86b0, dominik-arnold-cdd2, eva-schmitt-2e7d, gesine-tormaehlen-da7a, james-paterno-92d4, nicola-rosarius-6622, olaf-lottner-9ded, sandra-stolz-0b5a, sebastian-bernads-82b7, yuriy-uruskyy-1393.

**Run „Runde 20.8.2026" (da2763f0, 10 Leads): 2 betroffen:** axel-roschker-ae2c, christian-empt-1110.

Alle übrigen 60 gescannten Videos beider Runden + Test-Run: sauber.

Regenerierungs-Plan (nach Freigabe): Scope „video" pro Lead — Video wird neu gerendert, Slug/Landingpage-Links/PDF/Umschlag bleiben unangetastet, keine doppelte Credit-Belastung. Mit dem neuen Code kommen die fixen Szenen aus dem Cache; schlägt etwas fehl, wird es sichtbar gemeldet statt versteckt.
