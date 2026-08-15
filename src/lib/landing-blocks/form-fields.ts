/**
 * Feld-Modell für den Formular-Baukasten des CTA-Banners (Variante "form").
 *
 * Name + E-Mail sind IMMER fest (CRM-Zuordnung + Antwort-Mail brauchen
 * beide). Darunter frei konfigurierbare Zusatzfelder. Ohne `formFields`
 * in block.data gilt der bisherige Default (Telefon + Nachricht, beide
 * optional) — bestehende Seiten ändern sich nicht.
 *
 * `prefillKey` verweist auf eine Lead-Spalte (case-insensitiv), deren
 * Wert das Feld vorbefüllt.
 */

export type LpFormFieldType = "text" | "email" | "tel" | "textarea";

export interface LpFormFieldDef {
  id: string;
  label: string;
  type: LpFormFieldType;
  required: boolean;
  prefillKey?: string;
}

export const MAX_FORM_FIELDS = 12;

export const DEFAULT_FORM_FIELDS: LpFormFieldDef[] = [
  { id: "phone", label: "Telefon", type: "tel", required: false },
  { id: "message", label: "Nachricht", type: "textarea", required: false },
];

function asType(v: unknown): LpFormFieldType {
  return v === "email" || v === "tel" || v === "textarea" ? v : "text";
}

/** Defensive Narrowing von block.data.formFields; null = nicht gesetzt. */
export function asFormFields(value: unknown): LpFormFieldDef[] | null {
  if (!Array.isArray(value)) return null;
  const out: LpFormFieldDef[] = [];
  for (const entry of value.slice(0, MAX_FORM_FIELDS)) {
    if (!entry || typeof entry !== "object") continue;
    const r = entry as Record<string, unknown>;
    const id = typeof r.id === "string" && r.id ? r.id : String(out.length);
    out.push({
      id,
      label: typeof r.label === "string" ? r.label : "",
      type: asType(r.type),
      required: r.required === true,
      prefillKey:
        typeof r.prefillKey === "string" && r.prefillKey.trim()
          ? r.prefillKey.trim()
          : undefined,
    });
  }
  return out;
}

/** Case-insensitiver Lookup einer Lead-Spalte für die Vorbefüllung. */
export function prefillValue(
  leadData: Record<string, string | undefined> | undefined,
  key: string | undefined,
): string {
  if (!leadData || !key) return "";
  const wanted = key.trim().toLowerCase();
  if (!wanted) return "";
  for (const [k, v] of Object.entries(leadData)) {
    if (typeof v === "string" && k.trim().toLowerCase() === wanted) {
      return v;
    }
  }
  return "";
}
