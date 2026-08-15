/**
 * Validierung für den öffentlichen Formular-CTA auf personalisierten
 * Landingpages (Landingpage v3, Etappe 2, Konzept-Abschnitt 5.6).
 *
 * Als pure Funktion extrahiert, damit die Regeln ohne Next-Request-Kontext
 * per Vitest testbar sind. Die Route (`/api/lp/form`) mappt das Ergebnis
 * auf HTTP-Statuscodes:
 *
 *   { ok: true, honeypot: true }   → 200 {ok:true}, aber NICHTS speichern
 *   { ok: true, honeypot: false }  → weiterverarbeiten (speichern + Mail)
 *   { ok: false, error }           → 422 mit deutscher Fehlermeldung
 *
 * SICHERHEIT: Fehlermeldungen reflektieren NIE Nutzereingaben.
 */

export interface LpFormValues {
  leadId: string;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
}

export type LpFormParseResult =
  | { ok: true; honeypot: true }
  | { ok: true; honeypot: false; value: LpFormValues }
  | { ok: false; error: string };

export const LP_FORM_LIMITS = {
  name: 120,
  email: 200,
  phone: 50,
  message: 2000,
} as const;

// Kein /u-Flag (altes TS-Target).
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Bewusst simpel: ein @, kein Whitespace, mindestens ein Punkt in der Domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function asTrimmedString(v: unknown): string | null {
  return typeof v === "string" ? v.trim() : null;
}

export function parseLpFormSubmission(body: unknown): LpFormParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      ok: false,
      error:
        "Deine Anfrage konnte nicht verarbeitet werden. Bitte lade die Seite neu und versuche es noch einmal.",
    };
  }
  const obj = body as Record<string, unknown>;

  // Honeypot ZUERST: Bots füllen das unsichtbare Feld — wir tun so, als
  // wäre alles ok, speichern und senden aber nichts.
  const website = asTrimmedString(obj.website);
  if (website !== null && website.length > 0) {
    return { ok: true, honeypot: true };
  }

  const leadId = asTrimmedString(obj.leadId) ?? "";
  if (!UUID_RE.test(leadId)) {
    return {
      ok: false,
      error:
        "Deine Anfrage konnte keinem Empfänger zugeordnet werden. Bitte lade die Seite neu und versuche es noch einmal.",
    };
  }

  const name = asTrimmedString(obj.name) ?? "";
  if (name.length === 0) {
    return { ok: false, error: "Bitte gib deinen Namen an." };
  }
  if (name.length > LP_FORM_LIMITS.name) {
    return {
      ok: false,
      error: `Dein Name ist zu lang. Bitte kürze ihn auf maximal ${LP_FORM_LIMITS.name} Zeichen.`,
    };
  }

  const email = asTrimmedString(obj.email) ?? "";
  if (
    email.length === 0 ||
    email.length > LP_FORM_LIMITS.email ||
    !EMAIL_RE.test(email)
  ) {
    return {
      ok: false,
      error: "Bitte gib eine gültige E-Mail-Adresse an.",
    };
  }

  let phone: string | null = null;
  if (obj.phone != null) {
    const p = asTrimmedString(obj.phone);
    if (p === null) {
      return {
        ok: false,
        error: "Bitte gib deine Telefonnummer als Text an.",
      };
    }
    if (p.length > LP_FORM_LIMITS.phone) {
      return {
        ok: false,
        error: `Deine Telefonnummer ist zu lang. Bitte kürze sie auf maximal ${LP_FORM_LIMITS.phone} Zeichen.`,
      };
    }
    phone = p.length > 0 ? p : null;
  }

  let message: string | null = null;
  if (obj.message != null) {
    const m = asTrimmedString(obj.message);
    if (m === null) {
      return {
        ok: false,
        error: "Bitte gib deine Nachricht als Text an.",
      };
    }
    if (m.length > LP_FORM_LIMITS.message) {
      return {
        ok: false,
        error: `Deine Nachricht ist zu lang. Bitte kürze sie auf maximal ${LP_FORM_LIMITS.message} Zeichen.`,
      };
    }
    message = m.length > 0 ? m : null;
  }

  return {
    ok: true,
    honeypot: false,
    value: { leadId, name, email, phone, message },
  };
}
