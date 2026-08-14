# Konzept: Landingpage v3 — Brand-Builder

Stand: 2026-08-15 · Status: Konzept, noch nicht gebaut
Baut auf dem Block-System v2 auf (`blocks[]` + `theme` + `brand`, `--lp-*` CSS-Vars).

---

## 1. Leitidee

Der User soll in unter einer Minute eine Landingpage haben, die aussieht, als hätte
sie seine eigene Agentur gebaut. Der Weg dahin:

1. **Website-URL eingeben** → wir erkennen Logo, Farben, Schrift, Rundungen, Schatten.
2. **Fertige Seite ansehen** → der Builder öffnet mit einer bereits gestalteten Seite
   in seinem Markenlook (nicht mit einer leeren Fläche!).
3. **Anpassen mit wenigen Klicks** → Texte direkt auf der Seite tippen, Sektionen
   tauschen/verschieben, fertig.

Die ersten Sekunden entscheiden: Der User sieht zuerst **seine Marke auf einer
fertigen Seite** — das erzeugt den „Wow, das bin ja ich"-Moment und nimmt die
Unsicherheit. Kein leerer Editor, keine 30 Regler.

---

## 2. Der Einstieg (Wizard vor dem Builder)

Beim Anlegen einer Landingpage kommt EIN Schritt vor dem Builder:

```
┌──────────────────────────────────────────────┐
│   Wie soll deine Landingpage aussehen?       │
│                                              │
│   ○ Wie meine Website        [deine-url.de ] │
│     Wir übernehmen Logo, Farben & Schrift.   │
│                                              │
│   ○ Eigenen Look wählen                      │
│     Farben, Schrift & Form selbst bestimmen. │
└──────────────────────────────────────────────┘
```

**Weg A (URL):** 5–10 s Analyse mit Fortschritts-Feedback („Wir schauen uns
deine-url.de an…"), danach Brand-Kit-Bestätigung (Abschnitt 3.3).

**Weg B (manuell):** Kompakter Styleguide-Schritt (Abschnitt 3.4).

In beiden Fällen landet der User danach im Builder mit einer **vorbefüllten
Standardseite**: Hero (Video zentriert) → Content → Rezensionen → FAQ → CTA.
Texte sind sinnvolle Beispieltexte mit Platzhaltern („Hallo {{vorname|,}} …").

---

## 3. Brand-Kit (der Styleguide)

### 3.1 Was erkannt wird

| Merkmal | Quelle |
|---|---|
| Logo | `<link rel="icon">`-Varianten, `og:image`, größtes `<img>`/`<svg>` im Header |
| Primärfarbe | Buttons/Links: häufigste gesättigte Farbe aus computed styles |
| Sekundär-/Akzentfarbe | zweithäufigste Akzentfarbe, Hover-Farben |
| Hintergrund/Fläche | `body`-/Section-Hintergründe (hell/dunkel-Erkennung) |
| Schrift Headline + Fließtext | computed `font-family` von `h1`/`p`, Google-Fonts-`<link>`s |
| Rundungen | `border-radius` von Buttons/Cards → gemappt auf unsere 4 Stufen |
| Schatten | `box-shadow` vorhanden ja/nein + Intensität → 3 Stufen |

### 3.2 Wie (Technik)

- Neuer Endpoint `POST /api/brand/extract` (`{url}` → BrandKit-JSON).
- Puppeteer haben wir schon (Screenshot-Pipeline): Seite laden, `getComputedStyle`
  über Buttons/Headlines/Sections auswerten, Logo-Kandidaten einsammeln.
- Farb-Logik: Kandidaten clustern, Grau-/Weißtöne aussortieren, Kontrast prüfen.
  Wenn die erkannte Primärfarbe auf Weiß nicht lesbar wäre → automatisch
  abdunkeln (wir speichern beides: Original + nutzbare Variante).
- Schrift-Logik: erkannte Fonts gegen unsere kuratierten Google-Fonts matchen
  (exakter Treffer → nehmen; sonst nächstähnliche Kategorie: Serif → Serif-Paar,
  Geometric Sans → Geometric Sans). Niemals beliebige Fremd-Fonts laden.
- Logo: Kandidaten dem User zur Auswahl zeigen (3.3) statt blind raten;
  Upload als Fallback. SVG bevorzugt, sonst PNG auf unseren Storage kopieren.
- Timeout/Fehler (Seite lädt nicht, Cloudflare, …): freundlicher Text + direkter
  Absprung in Weg B. Kein Dead-End.

### 3.3 Bestätigungs-Screen („Passt das so?")

Nach der Analyse EINE Karte, keine Regler-Wand:

```
┌────────────────────────────────────────────┐
│  [Logo]   Deine Marke                      │
│  ●●●○  Farben     Inter / Inter   Schrift  │
│  ▢ Rundungen: Sanft   ☁ Schatten: Weich    │
│                                            │
│  Mini-Vorschau: Hero-Sektion im Look       │
│                                            │
│  [Anpassen]              [Sieht gut aus →] │
└────────────────────────────────────────────┘
```

„Sieht gut aus" ist der schnelle Weg. „Anpassen" öffnet den Styleguide (3.4).

### 3.4 Styleguide-Panel (manuell, auch später jederzeit erreichbar)

Ein Panel, 5 Gruppen, bewusst wenige Entscheidungen:

1. **Logo** — Upload oder URL, Schalter „im Kopfbereich zeigen".
2. **Farben** — Primärfarbe wählen (Picker + 8 schöne Vorschläge). Daraus leiten
   wir automatisch Abstufungen ab (Soft-Ton, Hover, Text-auf-Farbe). Optional
   aufklappbar: Akzentfarbe, Hintergrund hell/dunkel.
3. **Schrift** — kuratierte Paare (Headline + Text) als visuelle Kacheln,
   keine freie Font-Liste. Bestehende 11 Google-Fonts als Basis, zu ~8 Paaren
   gebündelt.
4. **Form** — Rundungen als 4 visuelle Stufen (Eckig / Dezent / Sanft / Rund),
   angezeigt als Button-Vorschau, kein Pixel-Input.
5. **Tiefe** — Schatten: Flach / Weich / Ausgeprägt.

Jede Änderung wirkt live auf die ganze Seite (Token-System, Abschnitt 4).

### 3.5 Datenmodell

```ts
interface BrandKit {
  logo?: { url: string; height?: number };
  colors: { primary: string; accent?: string; bg: "light" | "dark" };
  fontPairId: string;          // kuratiertes Paar
  radius: "none" | "subtle" | "soft" | "round";
  shadow: "flat" | "soft" | "bold";
  sourceUrl?: string;          // woher extrahiert (für „Neu einlesen")
}
```

Gespeichert **pro Landingpage-Vorlage**, mit „Als Standard für neue Seiten
übernehmen"-Häkchen (Account-Default). So können Agentur-User mehrere Marken
fahren, normale User müssen es nur einmal machen.

---

## 4. „Sieht immer gut aus"-Garantie

Der Grund, warum v2-Seiten schnell generisch/kaputt aussehen können: zu viel
Freiheit. v3 dreht das um — **Sektionen konsumieren nur Tokens**, nie freie Werte:

- **Farben:** Sektionen kennen nur Rollen (`bg`, `surface`, `primary`, `text`,
  `muted`). Text-auf-Primärfarbe wird automatisch berechnet (Kontrast ≥ 4.5:1,
  sonst weiß/schwarz-Flip). Abwechselnde Sektions-Hintergründe (weiß / soft)
  kommen aus dem System, nicht vom User.
- **Rundungen:** eine Skala (Karte/Button/Bild/Input je Stufe vordefiniert).
  „Rund" macht Buttons zur Pille UND Karten weicher — konsistent überall.
- **Schrift:** nur kuratierte Paare mit definierten Größen/Zeilenhöhen.
- **Abstände:** festes Spacing-Raster pro Sektion, nicht einstellbar.
- **Schatten:** 3 definierte Stile, auf Karten/Video/CTA konsistent angewandt.

Jede Sektions-Variante wird beim Bauen gegen alle 4 Radius-Stufen, hell/dunkel
und extreme Markenfarben (Gelb! Neon!) getestet. Was nicht mit jeder Kombination
funktioniert, kommt nicht in den Katalog.

**Dunkle Seiten sind gleichwertig ab Etappe 1:** `bg: dark` ist kein Sonderfall,
sondern Teil jeder Varianten-Abnahme. Die Brand-Erkennung erkennt dunkle
Websites automatisch; im Styleguide ist Hell/Dunkel ein einfacher Schalter mit
sofortiger Live-Wirkung (abgeleitete Flächen-, Linien- und Textfarben kommen
aus dem Token-System, keine Sektion definiert eigene Grautöne).

### Responsive-Garantie (Desktop, Tablet, Smartphone, Landscape)

Jede Variante definiert ihr Verhalten für **vier Geräteklassen** — nicht der
User, sondern wir entscheiden, wie sie umbricht:

- **Desktop:** volle Layouts (geteilter Hero, zweispaltige Sektionen).
- **Tablet:** engere Spalten, geteilte Layouts bleiben zweispaltig, wo lesbar.
- **Smartphone (hoch):** alles einspaltig in definierter Reihenfolge (beim
  geteilten Hero: Headline → Video → CTA), Schriftgrößen-Stufe kleiner,
  **Sticky-CTA-Leiste unten** (Button bzw. „Termin buchen", einblendbar nach
  dem Hero, im Styleguide abschaltbar).
- **Smartphone (quer):** Video-first — das Video nutzt die Breite, Texte
  kompakt; Akkordeons statt offener Listen; keine abgeschnittenen Embeds
  (Kalender-Embeds wechseln quer automatisch auf Popup).

Im Builder: Geräte-Umschalter mit allen vier Ansichten (6.1). Abnahme-Kriterium
pro Variante: kein horizontales Scrollen, Tap-Ziele ≥ 44 px, Video und Kalender
in jeder Klasse voll sichtbar.

---

## 5. Sektionen & Varianten

Notation: Sektion → Varianten. Alle Varianten sind reine Layout-Entscheidungen,
Inhalte bleiben beim Wechsel erhalten (Variante wechseln = 1 Klick, nichts geht
verloren).

### 5.1 Hero (immer mit dem Kampagnen-Video)
- **Zentriert:** Badge/Logo, Headline, Subline, Video groß mittig, CTA darunter.
- **Geteilt:** Text links (Headline, Subline, CTA), Video rechts — und gespiegelt.
- Optionen: Begrüßungs-Badge („Persönlich für {{vorname}}"), CTA an/aus.

### 5.2 Fallstudie
Medium: **Video ODER Bild** (links, rechts oder oben).
Textstufe (kombinierbar mit jedem Medium):
- **Nur Zitat** — großes Kundenzitat + Name/Firma/Foto.
- **Freitext** — kurzer eigener Text.
- **Strukturiert** — drei beschriftete Abschnitte: *Ausgangslage* → *Was wir
  gemacht haben* → *Ergebnis* (Ergebnis optional als große Kennzahl, z. B. „+43 %").
- **Ohne Text** — nur Medium + Kundenname/Logo.

### 5.3 Kundenstimmen (Text)
- **Karten-Raster** — 2–6 Zitate als Karten (mit Sternen optional).
- **Einzeln groß** — ein Zitat prominent, Pfeile zum Durchblättern.
- **Kompakte Liste** — schmale Zeilen mit Avatar, gut für viele Stimmen.

### 5.4 Content (Text + Grafik)
- **Grafik links / Text rechts** — und gespiegelt (pro Sektion umschaltbar).
- **Nur Text** — Headline + Fließtext, mittig, schmale Lesebreite.
- Text unterstützt Aufzählungen mit Häkchen-Icons (aus Markdown-Lite).

### 5.5 FAQ
- **Akkordeon einspaltig** — Klassiker, schmale Lesebreite.
- **Zweispaltig** — Headline/Intro links, Akkordeon rechts.
- **Offene Liste** — alle Fragen ausgeklappt (für 3–4 kurze FAQs).

### 5.6 CTA / Handlungsaufforderung
- **Button-CTA** — farbige Fläche, Headline, Subline, Button (Link frei wählbar).
- **Kalender inline** — Headline links, eingebetteter Buchungskalender rechts.
- **Kalender-Popup** — wie Button-CTA, Klick öffnet den Kalender als Overlay.
- **Formular-CTA** — kurzes Formular (Name, E-Mail/Telefon, Nachricht optional):
  für alle ohne Buchungstool. Antworten landen im CRM am Lead + Mail an den User.

**Buchungskalender universell:** EIN Feld „Buchungslink". Wir erkennen den
Anbieter automatisch an der URL und betten korrekt ein: **Calendly, Cal.com,
Microsoft Bookings, Google Terminplan (Kalender), HubSpot Meetings, TidyCal**.
Unbekannter Anbieter → sauberer Fallback (Button öffnet Link). Vorbefüllung von
Name/E-Mail per Platzhalter, wo der Anbieter es unterstützt (Calendly, Cal.com).

### 5.7 Bestand aus v2 (bleiben als einfache Sektionen)
Logo-Leiste, Zahlen/Stats, Über-mich, Bild, Abstand. Sie bekommen das neue
Token-Styling automatisch.

---

## 6. Der Builder

### 6.1 Grundprinzip: Die Seite IST der Editor

Kein 3-Panel-Layout mehr. Der User sieht seine Landingpage bildschirmfüllend,
so wie der Lead sie sehen wird. Bearbeitet wird **direkt auf der Seite**:

```
┌───────────────────────────────────────────────────┐
│ ← Zurück   Meine Seite     ⬜ 💻/📱   [Styleguide] │  ← eine schlanke Topbar
├───────────────────────────────────────────────────┤
│                                                   │
│              ┌  L I V E   S E I T E  ┐            │
│                                                   │
│   Hover auf Sektion → schwebende Mini-Leiste:     │
│   [Layout ▾] [↑] [↓] [⧉] [🗑]                      │
│                                                   │
│   Zwischen Sektionen → dezente „+"-Linie          │
│                                                   │
└───────────────────────────────────────────────────┘
```

- **Topbar:** Zurück, Seitenname, Geräte-Umschalter (Desktop / Tablet /
  Smartphone / Smartphone quer), Styleguide-Button, Status „Gespeichert"
  (Auto-Save wie überall bei uns, kein Speichern-Button).
- **Text bearbeiten:** Klick auf Headline/Absatz → direkt tippen (inline,
  contentEditable). Kleine schwebende Textleiste: Fett, Aufzählung, Platzhalter.
- **Sektion anpassen:** Klick auf Sektion → rechts gleitet EIN schmales Panel
  ein, nur mit dem, was diese Sektion braucht: Varianten als **visuelle
  Miniaturen** (nicht als Dropdown-Text), dann die Inhaltsfelder (Bild, Zitate
  als Liste mit + / –, Calendly-Link, …). Klick daneben → Panel weg.
- **Sektion hinzufügen:** „+" zwischen Sektionen → Galerie-Overlay mit
  Vorschaubildern **im eigenen Markenlook gerendert** (nicht generisch), gruppiert
  nach Zweck: Überzeugen (Fallstudie, Stimmen), Erklären (Content, FAQ),
  Abschluss (CTA).
- **Verschieben:** Pfeile in der Hover-Leiste + Drag am Griff (Sektion wird als
  Karte angehoben, Rest rückt zusammen). Beides, weil Laien Pfeile lieben.
- **Bilder:** Klick auf Bildfläche → Overlay „Hochladen / URL einfügen / aus
  Mediathek", mit automatischem Zuschnitt auf das Sektions-Format.

### 6.2 Platzhalter „super easy"

- In jeder Textbearbeitung: Button `{{ }}` in der Mini-Leiste **und** Auslöser
  beim Tippen von `{{` → Menü mit den Spalten der Kampagne (Vorname, Firma, …)
  in Klartext („Vorname des Leads").
- Eingefügte Platzhalter erscheinen als **farbige Chips** im Text (nicht als
  Code), mit Klick → Fallback-Text einstellen („falls leer: ‚Hallo'").
- Vorschau-Schalter in der Topbar: „Mit Beispiel-Lead ansehen" → Chips werden
  durch echte Beispieldaten ersetzt.

### 6.3 Nicht überladen — was wir bewusst NICHT anbieten

- Keine freien Abstände/Paddings, keine Pixel-Werte, keine Farb-Overrides pro
  Sektion (nur global via Styleguide, plus pro Sektion max. „Hintergrund:
  Hell/Soft/Farbig").
- Kein freies Verschachteln/Spalten-Bauen. Sektionen sind fertige Bausteine.
- Keine 20 Sektionstypen im ersten Wurf — lieber 6 Typen mit je 2–4 sehr guten
  Varianten.

---

## 7. Technik & Migration

- **Wiederverwendung:** v2-Block-System bleibt das Fundament (`blocks[]`,
  Registry, Placeholder-Renderer, Theme-Provider). v3 = neue/überarbeitete
  Block-Komponenten mit `variant`-Feld + erweitertes Token-Set
  (`--lp-radius-*`, `--lp-shadow-*`, abgeleitete Farbtöne) + neuer Editor.
- **Neuer Editor ersetzt den 3-Panel-Editor komplett** (entschieden) unter
  `/landingpages/[id]` (gleiche Route, gleiche Speicherlogik/Undo aus
  `useLpEditorState`, neues UI, alter Editor-Code wird gelöscht). Bestehende
  Seiten öffnen sich im neuen Builder; `migrateLegacyContent()` bleibt.
- **Brand-Extraktion:** eigener Endpoint, nutzt bestehende Puppeteer-Infra.
  Wichtig: Same-Origin-Schutz/SSRF-Guards wie bei der Screenshot-Pipeline
  (nur http/https, keine internen IPs).
- **Calendly:** reines Embed/Popup über die öffentliche Calendly-URL, kein
  API-Key nötig. Platzhalter in der Calendly-URL erlauben (Name/E-Mail vorfüllen:
  `?name={{vorname}}%20{{nachname}}&email={{email}}`).
- **Öffentlicher Renderer** (`/v/[slug]`) bekommt nur die neuen
  Varianten-Komponenten — kein Umbau der Auslieferung, Custom Domains und
  `?preview=1` funktionieren unverändert.

---

## 8. Etappen

**Etappe 1 — Brand & Look (der Wow-Moment):**
Brand-Extraktion + Bestätigungs-Screen + Styleguide-Panel + Token-Erweiterung
(Radius/Schatten/abgeleitete Farben, Hell/Dunkel) + bestehende Blöcke auf
Tokens umstellen. Ergebnis: schon der v2-Editor liefert Seiten im Markenlook.

**Etappe 2 — Sektionen & Varianten:**
Hero (3), Fallstudie (Medium × Textstufen), Kundenstimmen (3), Content (3),
FAQ (3), CTA (4 inkl. universellem Buchungskalender + Formular-CTA). Jede
Variante gegen alle Token-Kombis (hell + dunkel) und alle 4 Geräteklassen
testen. Sticky-Mobile-CTA.

**Etappe 3 — Der neue Builder:**
Canvas-Editing, Hover-Leisten, Kontext-Panel, „+"-Galerie mit Marken-Vorschau,
Platzhalter-Chips, Drag-Reorder, Beispiel-Lead-Vorschau, Geräte-Umschalter
(4 Ansichten). Alter 3-Panel-Editor wird gelöscht.

**Etappe 4 — Komfort & Conversion (aus Abschnitt 9):**
Seiten-Rezepte, KI-Text-Hilfe, Rezensionen-Import, personalisiertes
Share-Bild, Engagement-Daten im CRM.

Jede Etappe ist einzeln auslieferbar; nach Etappe 1 profitieren sofort alle
Bestandsseiten.

---

## 9. Weitere Ideen (über Daniels Anforderungen hinaus)

### Für die Etappen eingeplant (Etappe 4)

- **Seiten-Rezepte:** fertige Seiten-Vorlagen nach Ziel/Branche (Recruiting,
  Agentur, Sales, Handwerk, Beratung): sinnvolle Sektions-Reihenfolge + passende
  Beispieltexte, sofort im eigenen Markenlook gerendert. Der schnellste Weg zu
  „mit 3 Klicks fertig".
- **KI-Text-Hilfe:** in jeder Textbearbeitung „Vorschlagen / Kürzen / Lockerer
  formulieren". Die KI kennt die analysierte Website und das Kampagnenziel,
  schreibt also in der Sprache des Users (nutzt unsere bestehende
  Claude-Anbindung). Kein Zwang, nur ein Stift-Icon.
- **Rezensionen-Schnell-Import:** Google-/Trustpilot-Bewertungen als Text
  einfügen → wir zerlegen automatisch in Zitat-Karten (Name, Sterne, Text).
  Spart das mühsame Abtippen in Einzelfelder.
- **Personalisiertes Share-Bild (OG-Image):** Wenn der Video-Link in WhatsApp,
  Teams oder Mail-Vorschau landet, zeigt die Vorschau Marken-Look +
  Video-Thumbnail + „Persönliches Video für {{vorname}}". Deutlich mehr Klicks
  auf den Link, null Aufwand für den User.
- **Engagement pro Lead im CRM:** Scroll-Tiefe, Video-Sehdauer und
  CTA-/Buchungs-Klick landen am Lead (Run-Detail + Kontakt-Drawer). Der User
  sieht: „Marcel hat 80 % geschaut und auf Termin buchen geklickt" → perfekte
  Priorisierung für die Nachfassliste.
- **Performance-Budget:** Landingpages laden in < 2 s auf dem Smartphone:
  Video-Poster statt Vorab-Laden, Sektionen unterhalb des sichtbaren Bereichs
  lazy, Fonts subsetted. Schnelligkeit ist Teil von „sieht hochwertig aus".

### Später (bewusst nicht im ersten Wurf)

- **A/B-Varianten:** zwei Seiten-Versionen pro Kampagne, Leads automatisch
  aufgeteilt, Auswertung nach Views/Klicks/Buchungen.
- **Mehrsprachige Seiten:** EN-Variante pro Vorlage, Sprache per Lead-Spalte.
- **Abschnitts-Anker + Mini-Navigation:** für lange Seiten eine dezente
  Sprungleiste („Video · Fallstudie · Termin").

---

## 10. Entscheidungen (Daniel, 2026-08-15)

1. **Buchungskalender:** Calendly, Cal.com und weitere gängige Anbieter
   (Microsoft Bookings, Google Terminplan, HubSpot, TidyCal) über EIN
   universelles Buchungslink-Feld.
2. **Alter 3-Panel-Editor:** wird komplett ersetzt und gelöscht.
3. **Dunkle Seiten:** von Anfang an gleichwertig (Teil jeder Varianten-Abnahme).
4. **Responsive:** Desktop, Tablet, Smartphone hoch UND quer sind
   Abnahme-Kriterium für jede Variante; Geräte-Umschalter im Builder.

Noch offen: Brand-Kit „pro Vorlage + optional als Account-Standard" — ok so?
