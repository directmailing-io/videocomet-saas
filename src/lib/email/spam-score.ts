/**
 * Spam-Score-Heuristik für Outreach-Mails (Kontrakt Kapitel 4).
 *
 * Reine Heuristik ohne externe Abhängigkeiten; optional angereichert um
 * einen echten SpamAssassin-Check (spamd), wenn `SPAMD_HOST` gesetzt ist.
 * spamd-Fehler fallen STILL auf die Heuristik zurück (Timeout 3s).
 *
 * Ergebnis-Skala (Kontrakt): grün < 3, orange 3–5, rot ≥ 5.
 *
 * Server-only (spamd nutzt node:net) — der Editor spricht die API-Route
 * `POST /api/email/spam-score` an, nicht dieses Modul direkt.
 */

export interface SpamHint {
  label: string;
  points: number;
}

export type SpamLevel = "green" | "orange" | "red";

export interface SpamScoreResult {
  score: number;
  level: SpamLevel;
  hints: SpamHint[];
}

export interface SpamScoreInput {
  subject: string;
  html: string;
  /**
   * Optionale fertige .eml (aus mime.ts) für den spamd-Check. Fehlt sie,
   * wird bei gesetztem SPAMD_HOST eine minimale Nachricht aus
   * subject/html gebaut.
   */
  eml?: string;
}

// ── Spam-Wortlisten ────────────────────────────────────────────────────────
// Realistische Kaltakquise-Fallen — Begriffe, auf die Content-Filter
// (SpamAssassin, Outlook SmartScreen, GMX/web.de-Filter) anspringen.

const SPAM_WORDS_DE: string[] = [
  "100% kostenlos",
  "100% gratis",
  "100% sicher",
  "absolut kostenlos",
  "bargeld",
  "bestpreis",
  "bonus sichern",
  "doppeltes einkommen",
  "dringend handeln",
  "einmalige chance",
  "einmaliges angebot",
  "exklusiver deal",
  "garantierter gewinn",
  "geld verdienen",
  "geld zurück",
  "gewinnspiel",
  "gewinn",
  "gratis testen",
  "gratis",
  "günstigster preis",
  "heute noch bestellen",
  "jetzt kaufen",
  "jetzt zuschlagen",
  "jetzt zugreifen",
  "keine kosten",
  "kein risiko",
  "klicken sie hier",
  "kostenlose lieferung",
  "kredit ohne schufa",
  "krypto",
  "lebensversicherung",
  "limitiertes angebot",
  "millionen verdienen",
  "nebeneinkommen",
  "nur für kurze zeit",
  "nur heute",
  "ohne risiko",
  "passives einkommen",
  "potenzmittel",
  "preisknaller",
  "rabatt sichern",
  "reich werden",
  "risikofrei",
  "schnell geld",
  "schnäppchen",
  "sensationell",
  "sofort handeln",
  "sofortkredit",
  "traumgewinn",
  "unglaubliches angebot",
  "verpassen sie nicht",
  "viagra",
  "von zu hause arbeiten",
  "wow",
  "zeitlich begrenzt",
  "zinsfrei",
];

const SPAM_WORDS_EN: string[] = [
  "$$$",
  "100% free",
  "100% satisfied",
  "act now",
  "amazing deal",
  "apply now",
  "be your own boss",
  "best price",
  "billion",
  "buy direct",
  "buy now",
  "call now",
  "cash bonus",
  "casino",
  "cheap",
  "click below",
  "click here",
  "congratulations",
  "credit card offers",
  "double your income",
  "earn extra cash",
  "earn money",
  "eliminate debt",
  "exclusive deal",
  "extra income",
  "fast cash",
  "free access",
  "free gift",
  "free money",
  "free trial",
  "get paid",
  "get rich",
  "guarantee",
  "hidden charges",
  "instant profit",
  "investment opportunity",
  "limited time",
  "lowest price",
  "make money fast",
  "million dollars",
  "miracle",
  "no catch",
  "no cost",
  "no credit check",
  "no obligation",
  "no risk",
  "once in a lifetime",
  "order now",
  "prize",
  "pure profit",
  "risk free",
  "special promotion",
  "urgent",
  "viagra",
  "while supplies last",
  "winner",
  "work from home",
];

const ALL_SPAM_WORDS = SPAM_WORDS_DE.concat(SPAM_WORDS_EN);

// ── Helpers ────────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findSpamWords(text: string): string[] {
  const lower = text.toLowerCase();
  const hits: string[] = [];
  for (const w of ALL_SPAM_WORDS) {
    if (lower.includes(w)) hits.push(w);
  }
  return hits;
}

function capsRatio(s: string): number {
  const letters = s.replace(/[^A-Za-zÄÖÜäöüß]/g, "");
  if (letters.length === 0) return 0;
  const upper = letters.replace(/[^A-ZÄÖÜ]/g, "");
  return upper.length / letters.length;
}

function levelFor(score: number): SpamLevel {
  if (score < 3) return "green";
  if (score >= 5) return "red";
  return "orange";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Heuristik ──────────────────────────────────────────────────────────────

export function computeSpamHeuristics(input: {
  subject: string;
  html: string;
}): SpamScoreResult {
  const hints: SpamHint[] = [];
  const subject = input.subject.trim();
  const bodyText = stripHtml(input.html);

  // 1. Spam-Wörter im Betreff (schwer gewichtet)
  const subjectHits = findSpamWords(subject);
  if (subjectHits.length > 0) {
    hints.push({
      label: `Spam-Begriff${subjectHits.length > 1 ? "e" : ""} im Betreff: ${subjectHits
        .slice(0, 3)
        .map((w) => `„${w}“`)
        .join(", ")}`,
      points: Math.min(4, subjectHits.length * 2),
    });
  }

  // 2. Spam-Wörter im Text
  const bodyHits = findSpamWords(bodyText).filter(
    (w) => !subjectHits.includes(w),
  );
  if (bodyHits.length > 0) {
    hints.push({
      label: `Spam-Begriff${bodyHits.length > 1 ? "e" : ""} im Text: ${bodyHits
        .slice(0, 4)
        .map((w) => `„${w}“`)
        .join(", ")}${bodyHits.length > 4 ? " …" : ""}`,
      points: Math.min(3, round1(bodyHits.length * 0.75)),
    });
  }

  // 3. CAPS-Ratio im Betreff
  if (subject.length >= 8 && capsRatio(subject) > 0.5) {
    hints.push({
      label: "Betreff besteht überwiegend aus GROSSBUCHSTABEN",
      points: 2,
    });
  }

  // 4. Ausrufezeichen
  const subjectBangs = (subject.match(/!/g) ?? []).length;
  if (subjectBangs >= 2) {
    hints.push({ label: "Mehrere Ausrufezeichen im Betreff", points: 2 });
  } else if (subjectBangs === 1) {
    hints.push({ label: "Ausrufezeichen im Betreff", points: 1 });
  }
  const bodyBangs = (bodyText.match(/!/g) ?? []).length;
  if (bodyBangs > 3) {
    hints.push({
      label: `Viele Ausrufezeichen im Text (${bodyBangs})`,
      points: 1,
    });
  }

  // 5. Link/Text-Verhältnis
  const linkCount = (input.html.match(/<a\s/gi) ?? []).length;
  if (linkCount > 5) {
    hints.push({ label: `Sehr viele Links (${linkCount})`, points: 1.5 });
  } else if (linkCount > 0 && bodyText.length > 0 && bodyText.length / linkCount < 120) {
    hints.push({
      label: "Wenig Text im Verhältnis zur Link-Anzahl",
      points: 1,
    });
  }

  // 6. Bild ohne Text
  const hasImage = /<img\s/i.test(input.html);
  if (hasImage && bodyText.length < 100) {
    hints.push({
      label: "Bild/GIF mit sehr wenig begleitendem Text",
      points: 2,
    });
  }

  // 7. Betreff-Länge
  if (subject.length === 0) {
    hints.push({ label: "Betreff fehlt", points: 2 });
  } else if (subject.length < 4) {
    hints.push({ label: "Betreff sehr kurz (< 4 Zeichen)", points: 1 });
  } else if (subject.length > 70) {
    hints.push({
      label: `Betreff sehr lang (${subject.length} Zeichen — wird abgeschnitten)`,
      points: 1,
    });
  }

  // 8. Fehlendes Impressum (der Renderer fügt bei gepflegtem Impressum
  //    immer einen „Impressum“-Footer ein — fehlt der Marker, ist die
  //    Vorlage unvollständig).
  if (!/impressum|imprint/i.test(input.html)) {
    hints.push({
      label: "Impressum fehlt (Pflicht für gewerbliche E-Mails)",
      points: 3,
    });
  }

  // 9. GROSSGESCHRIEBENE Wörter im Text
  const capsWords = bodyText.match(/\b[A-ZÄÖÜ]{4,}\b/g) ?? [];
  if (capsWords.length >= 3) {
    hints.push({
      label: `Mehrere GROSSGESCHRIEBENE Wörter im Text (${capsWords.length})`,
      points: 1,
    });
  }

  const score = round1(hints.reduce((sum, h) => sum + h.points, 0));
  return { score, level: levelFor(score), hints };
}

// ── Optionaler spamd-Check (SpamAssassin, SPAMC-Protokoll) ─────────────────

const SPAMD_TIMEOUT_MS = 3_000;

interface SpamdResult {
  score: number;
  symbols: string[];
}

/**
 * SYMBOLS-Kommando gegen spamd (TCP). Liefert `null` bei jedem Fehler —
 * Caller fällt still auf die Heuristik zurück.
 */
async function querySpamd(eml: string): Promise<SpamdResult | null> {
  const host = process.env.SPAMD_HOST;
  if (!host) return null;
  const port = Number(process.env.SPAMD_PORT ?? "783");

  try {
    const net = await import("node:net");
    const payload = Buffer.from(eml.endsWith("\r\n") ? eml : `${eml}\r\n`, "utf-8");
    const header = Buffer.from(
      `SYMBOLS SPAMC/1.5\r\nContent-length: ${payload.length}\r\n\r\n`,
      "utf-8",
    );

    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection({ host, port });
      const chunks: Buffer[] = [];
      const timer = setTimeout(() => {
        socket.destroy();
        reject(new Error("spamd timeout"));
      }, SPAMD_TIMEOUT_MS);
      socket.on("connect", () => {
        socket.write(header);
        socket.write(payload);
        socket.end();
      });
      socket.on("data", (c: Buffer) => chunks.push(c));
      socket.on("end", () => {
        clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString("utf-8"));
      });
      socket.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    // Header: "SPAMD/1.1 0 EX_OK" + "Spam: True ; 7.5 / 5.0", Body: Symbole.
    const spamLine = response.match(/Spam:\s*\S+\s*;\s*(-?[\d.]+)\s*\/\s*[\d.]+/i);
    if (!spamLine) return null;
    const score = Number(spamLine[1]);
    if (!Number.isFinite(score)) return null;
    const bodyStart = response.indexOf("\r\n\r\n");
    const symbols =
      bodyStart >= 0
        ? response
            .slice(bodyStart + 4)
            .trim()
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    return { score, symbols };
  } catch {
    return null;
  }
}

/**
 * Kombinierter Score: Heuristik immer, spamd nur wenn SPAMD_HOST gesetzt
 * und erreichbar. Der spamd-Score nutzt dieselbe Skala (5.0 = Spam) und
 * wird als Maximum mit der Heuristik verrechnet.
 */
export async function scoreEmailSpam(
  input: SpamScoreInput,
): Promise<SpamScoreResult> {
  const heuristic = computeSpamHeuristics({
    subject: input.subject,
    html: input.html,
  });

  if (!process.env.SPAMD_HOST) return heuristic;

  const eml =
    input.eml ??
    [
      `Subject: ${input.subject}`,
      `Content-Type: text/html; charset=UTF-8`,
      "",
      input.html,
    ].join("\r\n");

  const spamd = await querySpamd(eml);
  if (!spamd) return heuristic;

  const hints = heuristic.hints.slice();
  hints.push({
    label:
      spamd.symbols.length > 0
        ? `SpamAssassin: ${spamd.score.toFixed(1)} Punkte (${spamd.symbols
            .slice(0, 6)
            .join(", ")}${spamd.symbols.length > 6 ? " …" : ""})`
        : `SpamAssassin: ${spamd.score.toFixed(1)} Punkte`,
    points: 0,
  });

  const score = round1(Math.max(heuristic.score, spamd.score));
  return { score, level: levelFor(score), hints };
}
