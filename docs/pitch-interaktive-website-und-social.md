# Pitch: Interaktive Webseite + Social-Media-Profile im VIDEOCOMET Studio

## Team-Brainstorm

**Product/Founder (Daniel-Perspektive):**
Wow-Effekt für Verkaufsvideos. Vertriebler zeigt Prospect: „ich habe mir gerade dein LinkedIn / deinen Shop / deinen YouTube-Channel angeschaut" — nicht als Standbild, sondern LIVE bedient. Killer-Differenzierung gegen Loom.

**Frontend/UX:**
Der User braucht null Setup. „Aufnahme starten → Tab teilen → los" muss der ganze Flow sein. Alles was Cookie-Export oder Passwort-Eingabe braucht, wird bei einer Oma nicht funktionieren (siehe UX-Regel).

**Backend/Infra:**
Zwei Welten:
- Nutzers eigener Browser (Screen-Share via `getDisplayMedia`): 0 € Serverkosten, keine Login-Probleme, funktioniert JETZT.
- Server-Chromium mit Live-View (Browserbase/Steel/Hyperbrowser): ~10-25 Cent pro 5-min-Session, ~200 ms Tipp-Latenz, plus komplette Auth-Hölle.

**Legal:**
- Eigene Website / Shop des Kunden: unproblematisch.
- YouTube: offizielles iframe-Embed erlaubt.
- LinkedIn/X/Facebook-Pages: nur wenn der Kunde seinen eigenen Session-Cookie liefert („ich nehme meine eigene Timeline auf") → ToS-Risiko liegt beim Kunden. Sendspark macht das seit Jahren so.
- Instagram/TikTok/private FB: verlorene Sache. Meta hat 100-Personen-Team gegen Scraper, TLS-Fingerprinting + DataDome + Login-Wall nach 6-12 Posts. Selbst wenn's technisch geht, brechen wir monatlich zusammen und Meta hat Scraper reihenweise verklagt.

**Support:**
Server-Chromium bricht bei jedem Layout-Update von LinkedIn = Ticket-Regen. Screen-Share funktioniert immer (der Browser des Users macht die Arbeit) — Support-freundlich.

**Sales/Marketing:**
„Nimm einen echten Live-Browser auf" ist ein starker Hook. Aber das USP klingt auch mit Screen-Share überzeugend: „Zeig deine echte Website, klick durch dein LinkedIn — alles was du live siehst, ist im Video."

## Konflikte / kritische Fragen

- **Founder will Server-Browser** (kein Setup für Empfänger), **Infra warnt vor Kosten + Auth-Krampf**. → Auflösung: nicht der Empfänger nimmt auf, sondern der VERSENDER. Der ist Kunde, hat Chrome, ist eingeloggt — Screen-Share ist trivial für ihn.
- **Legal will Instagram/TikTok kappen**, **Marketing findet's sexy**. → Sexy Feature das monatlich crasht + Klage-Risiko ist kein Feature. Rausnehmen, ehrlich kommunizieren.
- **UX will nichts installieren**, **Backend will Cookie-Export für LinkedIn**. → Kompromiss: Screen-Share deckt 90% ab. LinkedIn-Cookie-Feature später als Power-User-Option, wenn Kunden explizit fragen.

## Empfehlung

**Baustein 1 — „Interaktiver Website-Modus" (Screen-Share):**
Zweiter Aufnahme-Modus im Studio neben dem heutigen Vorab-Scroll. User klickt „Tab freigeben", wählt seinen Browser-Tab (mit seiner echten, eingeloggten Session), redet dazu, klickt durch. Wir muxen Webcam-PiP drüber wie heute.
- **Umsetzung:** LiveKit Cloud (WebRTC + Egress-Composite → fertiges MP4), ~2-3 Wochen Frontend.
- **Kosten:** ~0,5-1 Cent pro Minute an LiveKit + Egress. Fast nichts.
- **Deckt ab:** eigene Website, Shop, LinkedIn (User ist eingeloggt), YouTube, jede Login-Session die der User schon offen hat.

**Baustein 2 — „YouTube-Kanal einbetten" (offizieller iframe):**
Ein-Klick-Auswahl im Studio: „YouTube-URL einfügen" → offizielles iframe-Embed als Szene. Rechtlich sauber, technisch stabil.

**Baustein 3 (später, nur wenn Nachfrage kommt) — „LinkedIn-Cookie-Import":**
Chrome-Extension oder Anleitung: Kunde exportiert eigenen `li_at`-Cookie, wir rendern damit die Timeline server-seitig. Nur für Power-User, mit ToS-Warnung.

**NICHT bauen:**
- Server-Chromium mit noVNC/Live-View für Endkunden (200ms Latenz + Auth-Hölle).
- Instagram / TikTok / private Facebook-Profile (lost cause 2026).

## Pitch in einem Satz

Wir geben dem Versender einen „Bühne teilen"-Button: sein echter Chrome-Tab ist die Bühne, er klickt live durch Website/Shop/LinkedIn/YouTube — technisch ist das ein Screen-Share statt Vorab-Render. 2-3 Wochen Arbeit, fast keine Zusatzkosten, kein Bot-Blocking-Problem, weil kein Bot dahinter steckt.

## Was das für die Zielgruppe heißt

Zielgruppe (Kleinunternehmer, Selbstständige) ist meistens im eigenen Chrome unterwegs mit LinkedIn eingeloggt. Die Umstellung ist für sie: statt „Website-URL eintragen, warten bis gerendert" jetzt „Tab teilen, aufnehmen, fertig". Für Instagram/TikTok würden wir ehrlich sagen: „Wir zeigen einzelne Posts als Embed. Ganze Profile filmen wir nicht, weil die Plattformen das nicht erlauben."
