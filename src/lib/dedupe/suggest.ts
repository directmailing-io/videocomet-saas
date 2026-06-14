/**
 * Heuristische Regel-Vorschläge anhand CSV-Header.
 *
 * Use-Case: User lädt CSV hoch, UI ruft `suggestRules(headers)` auf und
 * zeigt 1-5 vorausgefüllte `DedupeRule`-Karten. User kann pro Regel
 * Toggle on/off + Spalten anpassen.
 *
 * Entscheidung "initial enabled": vorsichtig — nur "klassische Dublette"
 * (Vorname+Nachname+PLZ) und E-Mail sind by-default an. Adress-Haushalt
 * (matched ganze Familien!) und Person+Firma sind opt-in.
 */
import { randomBytes } from "node:crypto";
import type { DedupeRule } from "./types";

/** Eindeutige, kurze ID (8 hex chars). Genug Entropie für UI-Lifetime. */
function rid(): string {
  return randomBytes(4).toString("hex");
}

/**
 * Normalisiert Header-Namen für Pattern-Matching:
 * lowercase + Umlaut-Strip + Bindestrich/Underscore/Whitespace normalisiert.
 */
function normHeader(h: string): string {
  return h
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[\s_-]+/g, " ")
    .trim();
}

/**
 * Findet den ERSTEN Header, dessen normalisierte Form gegen einen der
 * Patterns matched. Patterns sind als bereits normalisierte Strings (oder
 * RegExp-Strings ohne Flags) angegeben.
 */
function findHeader(
  headers: string[],
  patterns: RegExp,
): string | null {
  for (const h of headers) {
    if (patterns.test(normHeader(h))) return h;
  }
  return null;
}

/**
 * Generiert bis zu 5 heuristische Dedupe-Regeln.
 *
 * Reihenfolge der Ausgabe entspricht der semantischen Priorität (E-Mail
 * gewinnt als Reason wenn mehrere Regeln matchen).
 */
export function suggestRules(headers: string[]): DedupeRule[] {
  const rules: DedupeRule[] = [];

  // 1. E-Mail (höchste Konfidenz — globally unique pro Person).
  const emailCol = findHeader(headers, /^(e ?mail|mail)$/);
  if (emailCol) {
    rules.push({
      id: rid(),
      label: "E-Mail",
      columns: [emailCol],
      normalizers: { [emailCol]: "email" },
      enabled: true,
    });
  }

  // Häufig gebrauchte Spalten — einmalig finden.
  const firstNameCol = findHeader(
    headers,
    /^(vorname|firstname|first name)$/,
  );
  const lastNameCol = findHeader(
    headers,
    /^(nachname|lastname|last name)$/,
  );
  const plzCol = findHeader(
    headers,
    /^(plz|postleitzahl|zip|postcode)$/,
  );
  const streetCol = findHeader(
    headers,
    /^(strasse|street|adresse)$/,
  );
  const dobCol = findHeader(
    headers,
    /^(geburtsdatum|geburtstag|dob|birthday)$/,
  );
  const companyCol = findHeader(
    headers,
    /^(firma|company|unternehmen)$/,
  );

  // 2. Klassische Dublette: Vorname + Nachname + PLZ — enabled by default.
  if (firstNameCol && lastNameCol && plzCol) {
    rules.push({
      id: rid(),
      label: "Vorname + Nachname + PLZ",
      columns: [firstNameCol, lastNameCol, plzCol],
      normalizers: { [plzCol]: "digits-only" },
      enabled: true,
    });
  }

  // 3. Adress-Haushalt — opt-in. Matched Familienmitglieder (Eheleute,
  //    Eltern+Kinder unter gleichem Nachnamen).
  if (lastNameCol && plzCol && streetCol) {
    rules.push({
      id: rid(),
      label: "Nachname + Straße + PLZ",
      columns: [lastNameCol, streetCol, plzCol],
      normalizers: { [plzCol]: "digits-only" },
      enabled: false,
    });
  }

  // 4. Person + Geburtsdatum — sehr hohe Konfidenz, aber DOB selten
  //    vollständig vorhanden. Default on wenn alle drei Spalten existieren.
  if (firstNameCol && lastNameCol && dobCol) {
    rules.push({
      id: rid(),
      label: "Vorname + Nachname + Geburtsdatum",
      columns: [firstNameCol, lastNameCol, dobCol],
      enabled: true,
    });
  }

  // 5. Person + Firma — opt-in. Mehrere Kontakte pro Firma sind ja
  //    legitim, aber bei Namensgleichheit lohnt Review.
  if (firstNameCol && lastNameCol && companyCol) {
    rules.push({
      id: rid(),
      label: "Vorname + Nachname + Firma",
      columns: [firstNameCol, lastNameCol, companyCol],
      enabled: false,
    });
  }

  return rules;
}
