# Abschlussbericht: Rundengenerierung systemweit zuverlässig (2026-08-21)

## 1. Root Cause des heutigen KI-Begrüßungsfehlers

Die Runde des KI-Kampagnentests (max@daniel-kurzeja.de) wurde über den Listen-Import gestartet (`POST /api/campaigns/[id]/runs/from-list`). Dieser Startpfad lief **an allen Prüfungen vorbei**, die der normale Startpfad hat: keine Bereitschaftsprüfung, keine Abrechnung, keine A/B-Zuteilung, keine Freigabe-Logik. Die Stimm-Kalibrierung des Webcam-Videos war nicht bereit (`greeting_too_late`), also setzte das Intro-Staging jeden Lead still auf `introStatus='disabled'` — und die Pipeline produzierte klaglos Videos ohne Begrüßung. Für das System sah das wie Erfolg aus, weil "Erfolg" nur hieß: Video + Landingpage vorhanden.

## 2. Warum wurde das gestern nicht erkannt?

Gestern wurde das Completeness-Gate gebaut, das prüft: Video da? Landingpage da? Es kannte aber die **Konfiguration** der Runde nicht. Es gab im System keinerlei Stelle, die wusste: "Diese Runde MUSS eine KI-Begrüßung liefern." `introStatus='disabled'` ist zudem ein legitimer Zustand (User kann bewusst ohne Begrüßung starten) — ohne Zusatzinformation konnte kein Gate zwischen "bewusst ohne" und "kaputt" unterscheiden. Genau diese Information fehlte.

## 3. Konfigurationsdimensionen (aus Code/Schema abgeleitet)

Pro Kampagne/Runde real wählbar:
1. **Modus**: webcam-only / with-presentation (Szenen)
2. **PDF-Brief**: an/aus (+ Google-Docs-Vorlage)
3. **KI-Begrüßung**: an/aus (+ bereit/nicht bereit + explizites Opt-out bei der Freigabe)
4. **Umschlag**: Vorlage auf Kampagne oder Runden-Override / keine
5. **A/B-Test**: an/aus (+ random/sequential, Gewichtung)
6. **Startpfad**: /start (Wizard) vs. from-list (Listen-Import)
7. **Freigabe**: Preflight-Review vs. Direktstart
Dazu orthogonal: E-Mail-Versand, QR, Custom-Thumbnail (beeinflussen die Pflicht-Artefakte nicht bzw. sind separat abgesichert).

## 4. Gültige/relevante Kombinationen

Die Pflicht-Artefakt-Frage hängt an 4 booleschen Required-Dimensionen (PDF × Intro × Umschlag × A/B) = **16 Kombinationen**, jeweils × 2 Startpfade × Intro-3-Zustände (erwartet/bewusst-ohne/Legacy-NULL). Kern: 16er-Matrix vollständig, Intro-Zustände vollständig, Startpfade beide über dieselben geteilten Funktionen.

## 5. Was davon wird jetzt automatisiert getestet?

- **Alle 16 Kombinationen** der Required-Matrix, je 2× (vollständiger Lead → ok; alles fehlt → exakt die konfigurierten Pflichten werden gemeldet) — `artifact-completeness.test.ts`
- Alle Intro-Zustände (generated/fallback_name/fallback_error/disabled/queued/generating/NULL) × erwartet/nicht erwartet
- Finalize-Gate: config-abhängige SQL-Bedingungen für alle 3 Zusatzpflichten + Legacy-NULL + "Feature mid-run deaktiviert" — `runs.finalize.test.ts` (18 Tests)
- Readiness-Gate: alle 6 Blocker-Codes, Stimm-Fallback-Logik, Mehrfach-Blocker — `run-readiness.test.ts` (24 Tests)
- A/B-Zuteilung: Aktivierungsbedingungen, exakte Quote (sequential + random), Rundung, 0%/100%, Override, Snapshot — `run-ab-allocation.test.ts` (18 Tests)
- Gesamt-Suite: **1322 Tests, alle grün**; `tsc --noEmit` fehlerfrei.

## 6. Strukturelle Schwachstellen (gefunden)

1. **Zweiter Startpfad ohne Gates** (from-list) — die eigentliche Ursache. Zwei Pfade, eine Logik nur in einem.
2. **"Erfolg" war konfigurationsblind** — kein zentrales Modell "Was MUSS bei diesem Lead vorhanden sein?"
3. **Stille Degradierung als Designmuster**: Intro-Fallbacks, Umschlag-catch→warn, A/B-Fallback auf Variante A — alles lief als Erfolg durch.
4. **Konfigurationsfehler wurden erst pro Lead zur Laufzeit entdeckt** statt beim Start (fehlende Kalibrierung, gelöschte Umschlag-Vorlage, fehlende Docs-URL).
5. **Fehlende Unterscheidung** zwischen "User will ohne Begrüßung" und "Begrüßung kaputt".

## 7. Was wurde geändert?

- **`runs.introExpected`** (Migration 0064, nullable): Snapshot beim Start/Freigabe, ob die Begrüßung verbindlich ist. true = Pflicht, false = bewusst ohne, NULL = Alt-Runden (Gates überspringen sicher).
- **Zentrales Requirements-Modell** `artifact-completeness.ts`: EINZIGE Quelle für "Was muss vorhanden sein" (`missingLeadArtifacts`), jetzt inkl. Intro, Umschlag, A/B-Variante.
- **3 Verteidigungslinien**: Stage-0-Fail-Fast (bricht ab, bevor teuer gerendert wird), Stage-9d-Gate pro Lead (frische DB-Row), Finalize-Gate pro Runde (kippt "completed ohne Pflichtteil" auf failed, 1× Auto-Retry).
- **`run-readiness.ts`**: zentrale Startprüfung (Webcam, Szenen, Docs-URL, Stimme+Kalibrierung, Umschlag-Vorlage) — von BEIDEN Startpfaden aufgerufen, klare deutsche Fehlermeldungen.
- **`run-ab-allocation.ts`**: A/B-Zuteilung als geteilte Funktion — from-list teilt jetzt genauso zu wie /start.
- **from-list-Route**: Readiness-Gate (422 + Blocker), Billing-Gate (2 Credits bei Intro), introExpected-Snapshot, A/B-Zuteilung vor dem Enqueue.
- **Resume-Opt-out** (Verifier-Fund): Pausierte Intro-Runden können jetzt explizit "ohne KI-Begrüßung fortsetzen" (setzt introExpected=false, auditierbar per Event + eigener Button).
- Meldungstexte in 9b/Finalize an die neue Härte angepasst (kein "Lead completes without envelope" mehr).

## 8. Regressionstests

- **Heutiger Fehler**: `introRequired + introStatus=disabled → fehlend (der Produktions-Bug)` in artifact-completeness.test.ts; `Regression 2026-08-21: introExpected=true → Gate verlangt intro_status` + End-to-End-Flip-Test in runs.finalize.test.ts; `Kalibrierung fehlt → intro_not_ready (der from-list-Bug)` in run-readiness.test.ts.
- **Gestriger Fehler**: Completeness-Gate-Flip (completed ohne Video → failed + Auto-Retry) bleibt getestet; Dauer-Shortfall-Tests (fehlendes Segment) bleiben bestehen.

## 9. Getestete Failure Modes

- Lead als completed markiert, aber Pflicht-Artefakt fehlt (jede der 16 Konfigurationen)
- Intro-Staging endet terminal ohne Ergebnis (disabled/fallback_error) bei verbindlicher Erwartung
- Autoretry-Marker-Insert schlägt fehl → kein Enqueue, Runde finalisiert korrekt
- Redis down beim Auto-Retry-Enqueue → Lead zurück auf failed, Runde finalisiert statt zu hängen
- Doppelte Finalize-Aufrufe / bereits terminale Runde → keine Doppel-Aktionen
- Feature mid-run deaktiviert / Alt-Runden ohne Snapshot → Gates bleiben sicher passiv
- ffprobe-Ausfall (null) → kein falscher Shortfall
- Nicht lokal simulierbar (ehrlich): echte sync.so-/Fish-Ausfälle, echte DB-Verbindungsabbrüche — dafür greifen die bestehenden Retry-/Watchdog-Mechanismen + die neuen Gates als Sicherheitsnetz.

## 10. Was hat der unabhängige Verifier zusätzlich gefunden?

Frischer Kontext, eigene Code-Lektüre, eigene Testläufe (tsc + 1322 Tests selbst ausgeführt). Ergebnis: Implementierung bestätigt, Invariante konsistent über alle 3 Gates, keine Endlos-Retry-Schleife möglich (Autoretry einmalig via Marker), Migration additiv-sicher, keine SQL-Injection. Zusätzlich gefunden und von mir behoben:
- **Resume-Sackgasse**: pausierte Intro-Runde mit introExpected=true hatte keinen Weg mehr, bewusst ohne Begrüßung fortzusetzen → Opt-out gebaut (API + UI-Button).
- **Widersprüchliche 9b-Texte**: "Lead completes without envelope" + stilles Skippen bei gelöschter Vorlage → laute Fehler-Events.
- Veralteter Finalize-Event-Text → angepasst.
- Als theoretisch/akzeptabel eingestuft: Flip-Race bei Intro-Reaktivierung mid-run (durch Autoretry begrenzt).

## 11. Restrisiken

1. **E-Mail-Versand** ist NICHT Teil des Pflicht-Artefakt-Modells (Feature v2 ungenutzt/uncommitted) — bewusst ausgeklammert.
2. **PDF-Pflicht am Finalize-Gate** wird nur von Stage 9d geprüft (die exakte Bedingung kennt nur der Job); ein Lead, der 9d nie erreicht UND als completed markiert würde, ist theoretisch denkbar, praktisch setzt nur 9d completed.
3. Externe Dienste (sync.so, Fish, Bunny) bleiben Fehlerquellen — aber sie können jetzt keinen stillen "Erfolg" mehr erzeugen, nur noch laute Fehlschläge mit Retry.
4. Alt-Runden (introExpected=NULL) werden bewusst nicht nachgeprüft.
5. In-Flight-Leads zum Deploy-Zeitpunkt können vom neuen Umschlag-/A/B-Gate einmal geflippt werden — der Auto-Retry rendert das fehlende Artefakt in der Regel nach.
6. Die 28 Julius-Videos (Fixed-Segment-Incident 2026-08-20) bleiben unverändert — Regeneration wartet weiter auf deine Freigabe.
