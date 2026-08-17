"use client";

/**
 * Step 4: Platzhalter → Kontakt-Eigenschaft.
 *
 * Lädt die Placeholder aus der Kampagne (aus dem bestehenden Endpunkt
 * /api/campaigns/[id]/placeholder-keys, wenn vorhanden — sonst nur die
 * Standard-5 (firstName, lastName, company, email, website)).
 *
 * Bietet für jeden Platzhalter ein Dropdown mit:
 *   - Basis-Feldern: email, firstName, lastName, company, phone, linkedinUrl
 *   - Custom-Feldern des Users
 *   - System-URLs (pageUrl)
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";
import {
  BASE_CONTACT_FIELDS,
  suggestContactMapping,
  type ContactMapping,
  type ContactMappingEntry,
} from "@/lib/contacts/mapping";
import type { WizardState } from "./types";

interface CustomFieldDef {
  key: string;
  label: string;
}

// Basis-Placeholders, die praktisch jede Kampagne kennt.
const BASE_PLACEHOLDERS = ["firstName", "lastName", "company", "email", "pageUrl"];

export function Step4Mapping({
  state,
  patch,
  campaignId: _campaignId,
  onBack,
  onNext,
}: {
  state: WizardState;
  patch: (u: Partial<WizardState>) => void;
  campaignId: string;
  onBack: () => void;
  onNext: () => void;
}) {
  const { toast } = useToast();
  const [placeholders, setPlaceholders] = React.useState<string[]>(BASE_PLACEHOLDERS);
  const [customFields, setCustomFields] = React.useState<CustomFieldDef[]>([]);

  React.useEffect(() => {
    void fetch("/api/contact-fields")
      .then((r) => r.json())
      .then((b) => setCustomFields(b.fields ?? []))
      .catch((err) => toastError(toast, err));
  }, [toast]);

  // Auto-Suggest beim ersten Rendern
  React.useEffect(() => {
    if (Object.keys(state.contactMapping).length > 0) return;
    const suggested = suggestContactMapping({
      placeholderKeys: placeholders,
      customFieldKeys: customFields.map((c) => c.key),
      systemPageUrl: true,
    });
    patch({ contactMapping: suggested });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeholders.join("|"), customFields.map((c) => c.key).join("|")]);

  function setEntry(key: string, entry: ContactMappingEntry | null) {
    const next = { ...state.contactMapping };
    if (entry) next[key] = entry;
    else delete next[key];
    patch({ contactMapping: next });
  }

  function selectValue(entry?: ContactMappingEntry): string {
    if (!entry) return "";
    if (entry.source === "contactField") return "cf:" + entry.field;
    if (entry.source === "customField") return "custom:" + entry.field;
    if (entry.source === "systemUrl") return "sys:" + entry.field;
    return "";
  }
  function parseValue(v: string): ContactMappingEntry | null {
    if (!v) return null;
    if (v.startsWith("cf:")) return { source: "contactField", field: v.slice(3) };
    if (v.startsWith("custom:")) return { source: "customField", field: v.slice(7) };
    if (v.startsWith("sys:")) return { source: "systemUrl", field: v.slice(4) };
    return null;
  }

  return (
    <div className="max-w-4xl">
      <h2 className="text-2xl font-semibold text-ink mb-2">
        Was füllen wir wo ein?
      </h2>
      <p className="text-sm text-ink-muted mb-5">
        Jeder Platzhalter in deinen Vorlagen wird aus einer Kontakt-Eigenschaft
        gefüllt. Vorschläge sind schon gemacht (grün).
      </p>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_260px] gap-6">
        <div className="rounded-xl border border-line overflow-hidden bg-surface">
          {placeholders.map((key) => {
            const entry = state.contactMapping[key];
            return (
              <div
                key={key}
                className="grid grid-cols-[1fr_24px_1fr] gap-3 items-center px-4 py-3 border-b border-line last:border-b-0"
              >
                <div>
                  <code className="bg-brand-soft text-brand-deep px-2 py-1 rounded text-xs font-mono">
                    {"{{"}{key}{"}}"}
                  </code>
                </div>
                <div className="text-ink-muted font-bold text-center">→</div>
                <div>
                  <select
                    value={selectValue(entry)}
                    onChange={(e) => setEntry(key, parseValue(e.target.value))}
                    className="w-full px-3 py-2 rounded-lg border border-line bg-surface text-sm"
                  >
                    <option value="">— wählen —</option>
                    <optgroup label="Aus Kontakt">
                      {BASE_CONTACT_FIELDS.map((f) => (
                        <option key={f} value={"cf:" + f}>{fieldLabel(f)}</option>
                      ))}
                    </optgroup>
                    {customFields.length > 0 && (
                      <optgroup label="Eigene Felder">
                        {customFields.map((cf) => (
                          <option key={cf.key} value={"custom:" + cf.key}>{cf.label}</option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Automatisch">
                      <option value="sys:pageUrl">🔗 Landingpage-URL</option>
                    </optgroup>
                  </select>
                  {entry && (
                    <input
                      type="text"
                      placeholder="Fallback wenn leer (optional)"
                      value={entry.fallback ?? ""}
                      onChange={(e) => setEntry(key, { ...entry, fallback: e.target.value || undefined })}
                      className="w-full mt-1 px-2 py-1 rounded border border-line bg-canvas text-xs"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <aside className="bg-brand-soft rounded-xl p-4 h-fit sticky top-4">
          <div className="text-xs font-bold text-brand-deep uppercase tracking-wide mb-3">
            Vorschau
          </div>
          <p className="text-xs text-ink-muted mb-3">
            So werden die Platzhalter beim ersten Kontakt gefüllt.
          </p>
          <div className="space-y-1.5 text-xs">
            {Object.entries(state.contactMapping).map(([k, entry]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-ink-muted font-mono">{"{{"}{k}{"}}"}</span>
                <span className="text-ink font-semibold truncate max-w-[140px]">
                  {previewValue(entry, customFields)}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-brand/20 text-[11px] text-ink-muted">
            Echte Vorschau siehst du im nächsten Schritt.
          </div>
        </aside>
      </div>

      <div className="flex justify-between mt-6">
        <Button variant="ghost" onClick={onBack}>← Zurück</Button>
        <Button variant="brand" onClick={onNext}>Weiter →</Button>
      </div>
    </div>
  );
}

function fieldLabel(field: string): string {
  const map: Record<string, string> = {
    email: "E-Mail",
    firstName: "Vorname",
    lastName: "Nachname",
    company: "Firma",
    phone: "Telefon",
    linkedinUrl: "LinkedIn",
  };
  return map[field] ?? field;
}

function previewValue(entry: ContactMappingEntry | undefined, customFields: CustomFieldDef[]): string {
  if (!entry) return "—";
  if (entry.source === "systemUrl") return "(wird beim Rendern gefüllt)";
  const demo: Record<string, string> = {
    email: "martin@ciecior.de",
    firstName: "Martin",
    lastName: "Ciecior",
    company: "Praxis Ciecior",
    phone: "+49 2232 43105",
    linkedinUrl: "linkedin.com/in/mciecior",
  };
  if (entry.source === "contactField") return demo[entry.field] ?? "—";
  if (entry.source === "customField") {
    const label = customFields.find((c) => c.key === entry.field)?.label ?? entry.field;
    return `(${label})`;
  }
  return "—";
}
