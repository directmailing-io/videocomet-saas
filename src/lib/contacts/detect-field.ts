/**
 * Heuristische Feld-Erkennung für Kontakt-Importe (Mini-CRM Etappe 5).
 *
 * Bekommt einen Spalten-Namen (Header) und ein paar Beispiel-Werte, gibt
 * zurück welcher Basis-Slot am besten passt (email / firstName / lastName
 * / phone / company / linkedinUrl) oder "custom" für Custom-Felder.
 *
 * Sehr defensiv: bei Zweideutigkeit "custom", niemals raten. Der User kann
 * das Mapping immer manuell überschreiben.
 */

export type ContactFieldSlot =
  | "email"
  | "firstName"
  | "lastName"
  | "fullName"
  | "phone"
  | "company"
  | "linkedinUrl"
  // Erweiterte Basis-Felder (Migration 0058)
  | "salutation"
  | "title"
  | "externalId"
  | "street"
  | "postalCode"
  | "city"
  | "country"
  | "position"
  | "website"
  | "gender"
  | "custom";

export type CustomFieldType = "email" | "phone" | "url" | "text" | "number" | "date";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const URL_RE = /^https?:\/\//i;
const LINKEDIN_RE = /linkedin\.com\/(in|company)\//i;
const PHONE_RE = /^[+()\d\s\-./]{6,}$/;
const NUMBER_RE = /^-?\d+([.,]\d+)?$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2})?/;

const HEADER_HINTS: Array<{ slot: ContactFieldSlot; keys: string[] }> = [
  { slot: "email", keys: ["email", "e-mail", "mail", "e_mail"] },
  { slot: "firstName", keys: ["firstname", "first_name", "vorname", "fname"] },
  { slot: "lastName", keys: ["lastname", "last_name", "nachname", "lname", "surname"] },
  { slot: "fullName", keys: ["name", "vollständiger name", "full name", "fullname"] },
  { slot: "phone", keys: ["phone", "telefon", "handy", "mobil", "tel"] },
  { slot: "company", keys: ["company", "firma", "unternehmen", "organisation", "companyname", "firmenname"] },
  { slot: "linkedinUrl", keys: ["linkedin", "linkedinurl", "linkedin url"] },
  // Erweiterte Basis-Felder (Migration 0058)
  { slot: "salutation", keys: ["anrede", "salutation"] },
  { slot: "title", keys: ["titel", "title", "akadtitel"] },
  { slot: "externalId", keys: ["id", "externalid", "external_id", "kunden_id", "kundennummer", "kdnr"] },
  { slot: "street", keys: ["strasse", "straße", "street", "adresse", "address", "strassenr", "straßenr"] },
  { slot: "postalCode", keys: ["plz", "postleitzahl", "zip", "zipcode", "postalcode", "postal_code"] },
  { slot: "city", keys: ["ort", "stadt", "city", "town"] },
  { slot: "country", keys: ["land", "country", "nation"] },
  { slot: "position", keys: ["position", "rolle", "role", "jobtitel", "jobtitle", "beruf"] },
  { slot: "website", keys: ["website", "webseite", "url", "web", "homepage", "websiteurl"] },
  { slot: "gender", keys: ["geschlecht", "geschl", "gender", "sex"] },
];

/**
 * Wenn der Header offensichtlich passt (z.B. "email", "Vorname") →
 * direkt der Basis-Slot. Sonst schauen wir uns die Beispiel-Werte an.
 */
export function detectFieldSlot(
  header: string,
  sampleValues: string[],
): { slot: ContactFieldSlot; detectedType: CustomFieldType } {
  const normHeader = header.trim().toLowerCase().replace(/[_\s-]+/g, "");
  const hint = HEADER_HINTS.find((h) =>
    h.keys.some((k) => k.replace(/[_\s-]+/g, "") === normHeader),
  );
  if (hint) return { slot: hint.slot, detectedType: hint.slot === "phone" ? "phone" : hint.slot === "email" ? "email" : hint.slot === "linkedinUrl" ? "url" : "text" };

  // Sonst per Sample-Values: mehr als 50% müssen dem Pattern folgen.
  const nonEmpty = sampleValues.map((v) => v.trim()).filter((v) => v.length > 0);
  if (nonEmpty.length === 0) return { slot: "custom", detectedType: "text" };

  const share = (pred: (v: string) => boolean) =>
    nonEmpty.filter(pred).length / nonEmpty.length;

  if (share((v) => EMAIL_RE.test(v)) >= 0.5)
    return { slot: "email", detectedType: "email" };
  if (share((v) => LINKEDIN_RE.test(v)) >= 0.5)
    return { slot: "linkedinUrl", detectedType: "url" };
  if (share((v) => URL_RE.test(v)) >= 0.5)
    return { slot: "custom", detectedType: "url" };
  if (share((v) => PHONE_RE.test(v)) >= 0.5)
    return { slot: "phone", detectedType: "phone" };
  if (share((v) => NUMBER_RE.test(v)) >= 0.8)
    return { slot: "custom", detectedType: "number" };
  if (share((v) => DATE_RE.test(v)) >= 0.5)
    return { slot: "custom", detectedType: "date" };
  return { slot: "custom", detectedType: "text" };
}

/**
 * Slug-Erzeuger für Custom-Feld-Keys. „Praxis-Größe" → „praxis_groesse".
 */
export function slugifyFieldKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
}
