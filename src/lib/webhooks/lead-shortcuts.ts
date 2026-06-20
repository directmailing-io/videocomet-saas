/**
 * Helper zur case-insensitiven Extraktion bekannter Lead-Felder aus
 * `leads.data` (dem rohen CSV-Record).
 *
 * Webhook-Payloads liefern `firstName`/`lastName`/`email`/`phone`/`address`
 * als Top-Level-Convenience neben dem vollen `data`-Objekt. Dafür gleichen
 * wir CSV-Spaltennamen wie "Vorname", "first_name", "first-name" gegen
 * eine bekannte Alias-Liste case-insensitiv ab.
 *
 * STUB: identische Funktion existiert in der CRM-Schicht (`@/lib/crm/match`)
 * mit ähnlichem Mechanismus. Foundation kann diese Datei erweitern; das
 * Backend hängt nur am exportierten Funktions-Vertrag.
 */

function normalise(k: string): string {
  return k.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const ALIASES: Record<string, string[]> = {
  firstName: ["firstName", "Vorname", "first_name", "first-name", "fName", "givenName"],
  lastName: ["lastName", "Nachname", "last_name", "last-name", "lName", "familyName", "surname"],
  email: ["email", "EMail", "e-mail", "mail", "Email"],
  phone: ["phone", "Telefon", "phoneNumber", "Tel", "mobile", "Mobil"],
  /**
   * `address` ist ein Fallback: wenn der CSV eine vollständige Adresse als
   * einzige Spalte mitliefert, nehmen wir die unverändert. Sonst greifen
   * wir auf die strukturierte Komposition `Strasse, PLZ Stadt` (siehe
   * weiter unten) zurück.
   */
  address: ["address", "Adresse", "fullAddress"],
};

// Zusatz-Aliases für die strukturierte Adress-Komposition. Werden NUR
// genutzt, wenn keiner der `address`-Aliases einen Treffer liefert.
const STREET_ALIASES = ["street", "Strasse", "Straße", "strasse"];
const ZIP_ALIASES = ["zip", "zipcode", "zip_code", "plz", "PLZ", "postal", "postalcode", "postal_code"];
const CITY_ALIASES = ["city", "stadt", "Stadt", "ort", "Ort", "town"];

export interface LeadShortcuts {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
}

/**
 * Extrahiert die 5 Convenience-Felder aus dem rohen `leads.data`-Record.
 * Fehlende Felder sind als leere Strings repräsentiert — der Webhook-
 * Vertrag (siehe `WebhookLead`) verlangt String-Werte, nicht `null`.
 */
export function extractLeadShortcuts(
  data: Record<string, unknown> | null | undefined,
): LeadShortcuts {
  const out: LeadShortcuts = {
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    address: "",
  };
  if (!data) return out;

  // Build a normalised lookup map once.
  const normMap = new Map<string, string>();
  for (const [k, v] of Object.entries(data)) {
    if (typeof v === "string" && v.trim().length > 0) {
      normMap.set(normalise(k), v.trim());
    }
  }

  for (const target of Object.keys(out) as Array<keyof LeadShortcuts>) {
    // Direct exact-key match first (preserves cheaper-path).
    for (const alias of ALIASES[target]!) {
      const v = data[alias];
      if (typeof v === "string" && v.trim().length > 0) {
        out[target] = v.trim();
        break;
      }
    }
    if (out[target]) continue;
    // Normalised match.
    for (const alias of ALIASES[target]!) {
      const v = normMap.get(normalise(alias));
      if (v) {
        out[target] = v;
        break;
      }
    }
  }

  // Strukturierte Adress-Komposition (`Strasse, PLZ Stadt`) als Fallback,
  // wenn keiner der `address`-Aliases einen Treffer hatte. Fehlende Teile
  // werden weggelassen.
  if (!out.address) {
    const pickAlias = (aliases: string[]): string => {
      for (const a of aliases) {
        const v = data[a];
        if (typeof v === "string" && v.trim().length > 0) return v.trim();
      }
      for (const a of aliases) {
        const v = normMap.get(normalise(a));
        if (v) return v;
      }
      return "";
    };
    const street = pickAlias(STREET_ALIASES);
    const zip = pickAlias(ZIP_ALIASES);
    const city = pickAlias(CITY_ALIASES);
    const zipCity = [zip, city].filter((s) => s.length > 0).join(" ");
    out.address = [street, zipCity].filter((s) => s.length > 0).join(", ");
  }

  return out;
}
