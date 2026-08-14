# Konzept: Studio-Aufnahme (Live-Regie)

Stand 2026-08-14 — Konzeptphase, noch nicht umgesetzt. Erarbeitet im Team:
Code-Recherche → Technik-Architekt + UX-Designer parallel → Synthese.

## Die Idee

Heute: erst Webcam aufnehmen, danach Sequenzen nachbauen — erfordert
Vorstellungskraft. Neu: Sequenzen („Szenen") VOR der Aufnahme festlegen
(Website-URL, Google-Docs-Vorlage, PDF, Folie). Dann EINE Aufnahme: Webcam
läuft, der Nutzer springt live zwischen den Szenen und scrollt live — wie
echtes Screensharing. Daraus entstehen automatisch das Webcam-Video plus die
Segment-Timeline mit exakten Dauern und exaktem Scroll-Verhalten.

## Der zentrale Trick (macht alles machbar)

Während der Aufnahme werden KEINE echten Websites live geladen (iframes werden
von vielen Seiten blockiert). Stattdessen scrollt der Nutzer über den bereits
vorhandenen Vorschau-Assets: fullPage-Screenshot (Website), Seiten-Stapel
(GDocs mit sichtbaren {{platzhaltern}}, PDF), Folien-Bild. Diese Assets sind
exakt die Render-Quelle des Workers → **was der Nutzer im Studio sieht und
scrollt, ist 1:1 das spätere Video.** Null Netzabhängigkeit während der
Aufnahme (alle Bilder vorab per decode() geladen).

Das Ergebnis sind **ganz normale Segmente** (Standard-Typen aus
`src/lib/segments/types.ts`) — der bestehende Editor bleibt als
Nachbearbeitung voll nutzbar, der Worker braucht NULL Änderungen.

## Technik-Kern

- **Zeitbasis:** `MediaRecorder.onstart` = t=0 (nicht der start()-Aufruf —
  10–150 ms Browser-Latenz). Event-Log: `{t, type: tabSwitch|scroll, tabId, y}`,
  Scroll-Sampling 50 ms (wie bestehender Scroll-Recorder).
- **Segment-Ableitung:** durationMs = Zeit zwischen Tab-Wechseln; scrollFrames
  pro Segment auf Segment-Start renormiert (Format identisch zu heute →
  `buildScrollPlanFromFrames` im Worker unverändert). Tab zweimal besucht =
  zwei Segmente; Scroll-Position wird zwischen Besuchen gemerkt.
- **Dauerabgleich:** Server-ffprobe-Dauer ist maßgeblich; Delta (<300 ms
  typisch) wird auf das letzte Segment gebucht, bei >1 s proportional verteilt.
  Webcam wird nie geschnitten — nur Σ Segmentdauern == Webcam-Dauer muss gelten.
- **Kurzsegmente** (<~1 s, versehentliche Doppelklicks) werden beim Ableiten
  gemerged bzw. im Review als „Versehen?" markiert.
- **Wizard-Integration:** Studio als Alternative in Schritt 0 („Nur Webcam"
  vs. „Studio-Aufnahme"); setzt implizit mode=with-presentation, überspringt
  Schritt 2. Keine neuen persistierten Felder nötig (Tabs = Segment-Drafts im
  bestehenden segments[]), optional `recordingKind` fürs UI.
- **V1-Verzicht:** kein Pause (Safari-Bugs, Timing-Fehlerquellen), kein
  Teil-Retake (wäre Server-seitiger Audio/Video-Schnitt). Retake = Aufnahme
  wiederholen, Szenen/Prompter/PiP bleiben erhalten → billig.
- **Mobile:** Studio nicht anbieten, klassischer Flow als Fallback.

## UX-Kern (4 Phasen, ein Vollbild-Flow)

1. **Regie (Setup):** links Szenen-Liste (Drag-Sortierung), rechts große
   16:9-Vorschau. Szene anlegen über 4 Typ-Kacheln; Assets laden im
   Hintergrund (Spinner → „Bereit" → Fehler mit Retry). Weiter erst, wenn
   alles bereit. Teleprompter-Text hier schreibbar (bestehender Storage-Key).
2. **Bereit-Check:** Kamera-Vorschau, Mikro-Pegel, PiP-Position wählen, ein
   CTA „Aufnahme starten (3-2-1)". Daneben: **„Erst mal üben"**
   (Generalprobe — identischer Screen ohne REC).
3. **Live-Aufnahme („On Air"):** dunkler Vollbild-Screen. Die Bühne IST das
   spätere Video: 16:9-Stage mit aktiver Szene + **echte Live-Webcam an der
   echten PiP-Position** (= gleichzeitig Selbstkontrolle, kein zweites
   Fenster). Teleprompter 2-zeilig oben in der Bühne. Tab-Leiste UNTEN:
   große Pills mit Nummer/Icon/Thumbnail, aktiver Tab mit Lavendel-Glow +
   „Live"-Label; Tasten 1–9/Pfeile als Zusatz. Auf der Bühne ist NUR Scrollen
   möglich (Klicks tot). Zeitbudget-Füllbalken pro Tab-Pill. Folien = Badge
   „Standbild". „Beenden" mit Hold-Geste gegen Versehen. Fortschrittslinie
   glüht beim Scrollen („wird aufgezeichnet").
4. **Review:** Preview-Player (bestehend) spielt sofort mit PiP ab, darunter
   die Segment-Liste. Nur zwei Aktionen: „Versehen"-Chips löschen +
   „Übernehmen" → normaler Editor. Bewusst KEIN Trim/Grenzen-Verschieben im
   Review (kann der Editor schon; doppelte UI = Lernlast).

Onboarding: zwei gleichwertige Karten „Studio — in einem Rutsch" (Badge Neu,
Beispiel-GIF) vs. „Klassisch — Schritt für Schritt"; beim ersten Mal drei
Ein-Satz-Overlay-Hinweise (Tabs/Scrollen/Beenden).

## Aufwand (grob)

| Paket | Größe | Wiederverwendung |
|---|---|---|
| Szenen-Setup-UI (Segment-Drafts vor Aufnahme) | M | ~70 % |
| Preflight/Ready-Gate | S | ~80 % |
| Studio-Recorder (Webcam + Timeline + Bühne) | L | ~50 % |
| Segment-Ableitung + ffprobe-Abgleich | S | scroll-math fast 1:1 |
| Wizard-Integration + Draft | S–M | hoch |
| Review-Ansicht | M | preview-player |

Gesamt ~3–5 Entwicklerwochen; ~55–65 % der Bausteine existieren
(webcam-recorder, scroll-recorder-Sampling, use-segment-preview,
DocStackPreview, Screenshot-Queue, PDF-Upload, Teleprompter).

## Offene Entscheidungen (Diskussion mit Daniel)

1. **Platzhalter in der Studio-Vorschau:** V1 zeigt {{vorname}} als Text im
   GDocs-PNG (ehrlich, sofort machbar). V2-Option: Vorschau mit
   Beispieldatensatz serverseitig rendern („Max Mustermann").
2. **Review-Ansicht:** V1 mitbauen (empfohlen, Player existiert) oder direkt
   in den Editor springen?
3. **Klassischer Flow:** bleibt dauerhaft gleichwertig bestehen oder wird
   Studio langfristig der Default?
4. **Extras:** Generalprobe (empfohlen, fast gratis), Zeitbudget-Balken
   (empfohlen), Wechsel-Sound (optional, abschaltbar).

## Verworfene Alternative

`getDisplayMedia`-Screensharing (echter Bildschirm als zweiter Videotrack):
maximal authentisch, aber bricht das Segment-/Platzhalter-Modell — keine
Personalisierung pro Empfänger mehr möglich. Falls überhaupt, ein separates
Feature, kein Studio-Ersatz.
