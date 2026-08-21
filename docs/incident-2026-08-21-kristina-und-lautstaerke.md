# Abschlussbericht 2026-08-21: Kristina ohne KI-Begrüßung + Lautstärke-Bug

In einfachen Worten, 10 Punkte. Alle Fixes sind committed, getestet und auf
allen drei Produktions-Containern (App, Worker, Render-1) deployed.

## 1. Warum wurde Kristina nicht KI-personalisiert?

In Kristinas Datensatz stand noch ein **alter Vermerk aus einer früheren
Runde**: „Begrüßung deaktiviert" (`introStatus='disabled'`). Der stammte aus
der Zeit, als die Sprach-Kalibrierung noch fehlerhaft war. Beim manuellen
„Neu generieren" hat das System diesen alten Vermerk **ungeprüft übernommen**
und die KI-Begrüßung deshalb übersprungen — bei jedem weiteren Regenerieren
wieder. Ein klassischer „eingefrorener Zustand", kein Zufallsfehler.

## 2. Warum hat es bei Axel funktioniert?

Axel hatte diesen alten Vermerk nicht — bei ihm stand „Begrüßung erledigt"
mit gültigem Ergebnis. Sein Video wurde also mit dem vorhandenen (korrekten)
Intro neu gebaut. Der Unterschied lag ausschließlich in dem historischen
Datenbank-Vermerk, nicht in der Kampagne oder im Ablauf.

## 3. Betrifft das Problem speziell bestehende Kampagnen?

**Ja.** Nur Leads, die schon einmal durchgelaufen sind, können so einen
veralteten Vermerk tragen. Frische Runden treffen das Problem nie, weil dort
die Begrüßungs-Entscheidung immer neu fällt. Eine Daten-Migration war nicht
nötig: Der Fix nullt den Vermerk bei jedem videobezogenen „Neu generieren"
automatisch — die Entscheidung fällt jetzt immer frisch, an genau einer
Stelle (dem Intro-Prozessor), für neue wie alte Kampagnen gleich.

## 4. Warum wurde Lautstärke 0 ignoriert?

Der Lautstärke-Regler im Studio war **nur ein Vorschau-Regler**: Er hat das
Video im Browser leiser gestellt, den Wert aber **nirgendwo gespeichert**.
Das Szenen-Datenmodell kannte gar kein Lautstärke-Feld, und der Render-Worker
hat Videoton immer in voller Lautstärke gemischt. Vorschau und Endergebnis
waren also zwei getrennte Welten. Zusätzlich hat die Editor-Vorschau
Videoton generell stummgeschaltet — man konnte den Fehler dort nicht mal
hören.

## 5. Welche Szenentypen gibt es?

9 Typen: **text, image, video, website, gdocs (Google Docs), pdf, gslide
(Google Slides), canva, slide** (Studio-Folie). Dazu die Querschnitts-
Features KI-Begrüßung, Webcam-PiP, Browser-Rahmen, Trim/Playback-Fenster
und jetzt Lautstärke (nur video).

## 6. Welche Kombinationen wurden getestet?

- **Lautstärke end-to-end, zweifach:** lokal UND im echten Produktions-
  Worker-Container durch den echten Render-Code: 0 % → Stille (< −60 dB),
  25 % → −12,0 dB, 50 % → −6,0 dB, 75 % → −2,5 dB, 100 %/nicht gesetzt →
  bit-identisch zum Original. Alle Werte physikalisch exakt (±0,1 dB).
- **Szenen-Matrix (neuer Integrationstest):** image, video, slide, pdf
  werden real gerendert und der **Inhalt** geprüft (Dauer per ffprobe,
  Bild nicht schwarz per Helligkeitsmessung, Audio-Streams, Lautstärke-
  Regression). website/gdocs/gslide/canva: reine Logik-Tests (Scroll-
  Geometrie, URL-Parsing, Viewer-HTML) + begründet übersprungene
  Netz-Tests.
- **Kristina-Fix end-to-end auf Produktion:** Lead regeneriert → neues
  Video mit hörbarer Begrüßung („Hey, Kristina", per Whisper-Transkript
  verifiziert), Landingpage erreichbar.
- **Verifier-Agent (adversarial):** 13 Lautstärke-Grenzwerte (negativ,
  >1, NaN, Strings), 19 Playback-Fenster-Pathologien (überlappend,
  jenseits der Quelldauer, Start>Stop), Trim jenseits der Quelle,
  12 echte Renders mit pathologischen Werten. Ergebnis: hält stand.

## 7. Welche weiteren Bugs wurden gefunden?

1. **Einzel-Lead-Regen resettete den Fehlversuchs-Zähler nicht** (Run-Regen
   schon): Ein 3× gefailter Lead galt nach manueller Regeneration sofort
   wieder als „ausgeschöpft" und wurde bei einem Hänger terminal auf failed
   gesetzt statt erneut versucht. → **Gefixt (29688d3).**
2. **`trimEndMs` wird im Rendering komplett ignoriert** — der Editor bietet
   das Feld an, Wirkung: keine (Vorschau und Endvideo immerhin konsistent).
   Vorbestand, offen (implementieren oder aus der UI nehmen).
3. Editor-Vorschau spielte Videoton grundsätzlich stumm → mit dem
   Lautstärke-Fix behoben (Vorschau klingt jetzt wie das Endvideo).
4. Dokument-Szenen (pdf/website/gdocs) erzeugen MP4s ohne Audiospur —
   Stille wird erst beim Zusammenfügen ergänzt. Funktioniert, ist aber eine
   versteckte Abhängigkeit (dokumentiert, kein akuter Fehler).
5. `fetchToFile` behandelt `file://`-URLs, ohne die Datei zu schreiben —
   latente Falle für künftige Aufrufer (aktuell unerreichbar).

## 8. Was wurde geändert?

- **5c6303e** — Regenerate nullt den Intro-Vermerk und schickt Leads durch
  denselben Staging-Weg wie frische Runden (Kristina-Fix).
- **4bf9fd9** — Lautstärke-Feld am Video-Segment, EINE Auslege-Funktion
  (`videoSegmentVolume`) für Editor-Vorschau, Studio und Worker; FFmpeg
  bekommt den Volume-Filter nur bei ≠ 100 %; Render-Cache bleibt für alle
  Alt-Videos gültig; Studio-Regler speichert jetzt wirklich.
- **32957f5** — neue Szenen-Render-Matrix mit echten Output-Inhalts-Checks.
- **29688d3** — Fehlversuchs-Zähler-Reset beim Einzel-Lead-Regen.

## 9. Welche automatischen Tests verhindern eine Wiederholung?

- `src/lib/regenerate.test.ts` (20 Tests): Intro-Vermerk wird genullt,
  richtiger Queue-Weg, 409 bei laufender Runde, Zähler-Reset, PDF-Scope
  fasst Intro nicht an.
- `src/worker/lib/media-segment-render.test.ts`: FFmpeg-Filter pro
  Lautstärke-Wert, 100 % = kein Filter (bit-identisch), Cache-Key-Regeln.
- `src/worker/lib/segment-render-matrix.integration.test.ts` (25 Tests):
  rendert echte Videos und prüft den **Inhalt** — genau die Testklasse, die
  vorher fehlte. Warum die Bugs unentdeckt blieben: Alle bisherigen Tests
  prüften Status/Exit-Codes, nie das tatsächliche Bild/Ton-Ergebnis, und
  der Studio-Regler war reine UI ohne Persistenz-Test.
- Gesamt-Suite: 119 Dateien, 1457 Tests grün.

## 10. Welche Risiken bleiben?

- `trimEndMs` ohne Wirkung (Punkt 7.2) — kein Datenverlust, aber
  irreführende UI.
- text-Szenen sind auf Entwickler-Macs nicht testbar (Homebrew-ffmpeg ohne
  drawtext, feste Debian-Font-Pfade) — Matrix überspringt sie dort sauber,
  im Container-Build laufen sie.
- website/gdocs brauchen echtes Netz/Google — nicht offline testbar,
  nur Logik-Tests.
- Beim Aneinanderfügen mehrerer Video-Stücke entsteht konstant ~23 ms
  Überlänge (AAC-Kodierungs-Eigenheit) — unhörbar, aber dokumentiert.
- Manipulierte Lautstärke-Werte aus der DB (Strings, NaN, >1) werden
  geklemmt bzw. wie 100 % behandelt — konsistent in Vorschau und Render,
  kein Absturz möglich (adversarial verifiziert).
