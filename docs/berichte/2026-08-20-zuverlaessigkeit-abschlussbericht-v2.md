# Abschlussbericht v2 — Zuverlässigkeit der Videogenerierung (2026-08-20)

Auftrag: Die Videogenerierung soll für **alle User, alle Kampagnen und alle
Szenen-Kombinationen dauerhaft zuverlässig** funktionieren. Kernregel:
Ein User darf **niemals** eine Runde als erfolgreich sehen, wenn auch nur bei
einem Lead etwas fehlt — aber ein einzelner kaputter Lead darf **niemals** die
ganze Runde zur Neugenerierung zwingen.

Dieser Bericht ergänzt den ersten Bericht
(`2026-08-20-rundengenerierung-abschlussbericht.md`) um das jetzt deployte
Zuverlässigkeits-Paket.

---

## Was neu eingebaut wurde (alles live seit 2026-08-20 abends)

### 1. Artefakt-Gate pro Lead (Stage 9d)
Bevor ein Lead auf „completed" gesetzt wird, prüft der Worker frisch aus der
Datenbank: Ist das Video da? Ist die Landingpage da? Ist der PDF-Brief da
(falls für die Kampagne konfiguriert)? Fehlt etwas, schlägt der Lead fehl —
mit klarer Fehlermeldung im Pipeline-Log, welche Bestandteile fehlen.
Der Fehler ist „normal" (kein Hard-Fail), damit die automatischen
Wiederholungsversuche von BullMQ vorübergehende Ursachen selbst heilen können.

**Wirkung:** Der Stephanie-Stirn-Fall (Video „fertig", aber Bestandteil fehlt)
kann nicht mehr still als Erfolg durchrutschen.

### 2. Videolängen-Prüfung (Render-Schritt)
Nach dem finalen Zusammenschnitt wird die tatsächliche Videolänge gemessen.
Ist das Video deutlich kürzer als erwartet (Toleranz: 2 % bzw. mind. 1,5 s),
schlägt der Render fehl — vermutlich fehlt ein Segment. Die Prüfung greift
nur, wenn die Erwartungslänge verlässlich bekannt ist (kein Fehlalarm bei
Fallback-Werten).

### 3. Runden-Completeness-Gate (Finalisierung)
Beim Abschluss einer Runde wird zusätzlich serverseitig geprüft:
- Leads, die „completed" sind, aber kein Video oder keine Landingpage haben,
  werden automatisch auf „failed" gekippt (mit Log-Event) — doppelter Boden
  unter dem Stage-9d-Gate.
- Eine Runde kann **atomar** nicht auf „completed" gehen, solange auch nur ein
  Lead noch nicht terminal (completed/failed) ist. Das schließt die
  Race-Condition „Runde fertig, während ein Retry noch läuft".

### 4. Automatischer Wiederholungsversuch pro Lead (genau 1×)
Bevor eine Runde mit fehlgeschlagenen Leads abgeschlossen wird, bekommt jeder
fehlgeschlagene Lead **genau einen** automatischen Neuversuch (idempotent über
einen Marker in pipeline_events — auch bei parallelen Aufrufen kein doppelter
Retry). Der Neuversuch nutzt dieselbe Job-Identität wie alle Recovery-Pfade
(jobId = Lead-ID, alter Job wird vorher entfernt) und die faire
Prioritäts-Reihenfolge. Schlägt auch der Neuversuch fehl, wird die Runde mit
Fehlern abgeschlossen — der User sieht ehrlich, welche Leads fehlgeschlagen
sind, und kann gezielt nur diese neu generieren (keine Komplett-Neugenerierung).

### 5. Ops-Alerts per E-Mail (an info@daniel-kurzeja.de)
- **Runde mit Fehlschlägen abgeschlossen:** Mail mit Runden-ID und Anzahl
  fehlgeschlagener Leads (einmal pro Runde, 30-Min-Drossel pro Thema).
- **Worker ohne Heartbeat:** Der Haupt-Worker prüft alle 2 Minuten, ob ein
  Worker seit über 3 Minuten keinen Heartbeat geschrieben hat (Fenster: max.
  24 h zurück). Bei sauberem Shutdown (Deploy) löscht ein Worker seine
  Heartbeat-Zeile selbst — nur echte Abstürze alarmieren.
- Alerts sind bewusst „best effort": Sie können nie die Pipeline mitreißen.
- Neue Env-Variable `ADMIN_ALERT_EMAIL` ist auf beiden Servern gesetzt.

---

## Unabhängiger Verifier (2. Runde)

Ein separater Prüf-Agent hat gezielt versucht, die neuen Mechanismen mit
realistischen Fehlerfällen zu brechen. Ergebnis: **7 Funde, alle behoben**,
darunter zwei kritische:

1. **Doppelte Pipeline möglich** — der Auto-Retry nutzte anfangs eine eigene
   Job-ID; die Stuck-Recovery hätte denselben Lead parallel nochmal einreihen
   können. Fix: einheitliche Job-ID (= Lead-ID) mit Purge vor dem Einreihen.
2. **Runde „completed" während Retry läuft** — Race zwischen Finalisierung und
   laufendem Neuversuch. Fix: atomarer NOT-EXISTS-Guard direkt im
   Runden-Update.

Weitere Fixes: werfender Marker-Insert (kein Endlos-Retry bei DB-Fehler),
keine Fehlalarme der Längenprüfung bei Fallback-Dauer, Abbruch-Guard für
stornierte Runden, PDF-Pflicht exakt an die echte PDF-Stage-Bedingung
gekoppelt, Heartbeat-Aufräumen beim Shutdown.

Bestätigt sauber: Credit-Abrechnung (kein Doppel-Abzug), Absturz-Fenster
schließen „fail closed", Zusammenspiel mit manueller Regeneration.

## Nachgelagerter Prod-Fund (sofort behoben)
Beim ersten Live-Tick warf der Heartbeat-Watchdog einen Treiber-Fehler
(Date-Parameter in rohem SQL-Fragment). Fix: SQL-Intervalle (`now() -
interval`) statt JS-Date-Parameter. Beide Worker laufen seitdem fehlerfrei
auf dem identischen Image.

---

## Tests & Deploy
- 1110 Tests grün, TypeScript sauber (inkl. 15 neuer Tests für
  Artefakt-Gate, Längenprüfung und Finalisierung/Auto-Retry).
- Commits: `41abe78` (Paket), `04cfa5c` (Watchdog-Fix).
- Deployt auf beiden Servern (Haupt-Worker CPX42 + render-1 CX53),
  Boot-Logs verifiziert, Heartbeat-Tabelle bereinigt (246 Alt-Zeilen
  seit Mai entfernt).

## Offen (wartet auf Freigabe/Entscheidung)
- Neugenerierung der 28 betroffenen Julius-Videos (nur mit expliziter
  Freigabe).
- Retro-Fix Umschlag-Run `4f521b24`, Aufräumen Run `775b7f16`.
- Bekannte Grenze: Stirbt der Haupt-Worker selbst, greift der
  Heartbeat-Watchdog nicht (er läuft dort). Externes Monitoring wäre der
  nächste Ausbauschritt.
