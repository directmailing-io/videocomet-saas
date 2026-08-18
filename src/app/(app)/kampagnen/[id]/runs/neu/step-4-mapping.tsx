"use client";

/**
 * Step 4: Platzhalter → Kontakt-Eigenschaft.
 *
 * Lädt die echten Placeholder aus der Kampagne per
 * GET /api/campaigns/:id/placeholders (Slides, Google-Docs, PDF, LP,
 * Umschlag, Slug-Template werden gescannt).
 *
 * Zeigt für jeden Placeholder:
 *  - Code-Tag {{key}}
 *  - "Verwendet in: Brief, Landingpage, Umschlag" als Chips
 *  - Dropdown zur Contact-Eigenschaft (Auto-Match, sonst manuell)
 *  - Optionaler Fallback wenn leer
 *
 * Rechts sticky: Vorschau-Karte mit Demo-Werten.
 */

import * as React from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";
import {
  BASE_CONTACT_FIELDS,
  COUNTRY_HIDE_PRESETS,
  suggestContactMapping,
  type ContactMapping,
  type ContactMappingEntry,
  type ContactMappingRule,
} from "@/lib/contacts/mapping";
import type { WizardState } from "./types";

interface CustomFieldDef {
  key: string;
  label: string;
}

interface PlaceholderSource {
  kind: string;
  label: string;
  inaccessible?: boolean;
}
interface DetectedPlaceholder {
  key: string;
  normalized: string;
  sources: PlaceholderSource[];
  occurrences: number;
}

/** Menschen-lesbare Gruppierung der SourceKinds für die UI-Chips. */
const SOURCE_GROUP_LABEL: Record<string, string> = {
  slide: "Video-Folie",
  text: "Video-Text",
  gdocs: "Google-Doc",
  gslide: "Google-Slides",
  canva: "Canva",
  pdf: "Brief",
  "lp-block": "Landingpage",
  "lp-custom": "Landingpage",
  envelope: "Umschlag",
  slug: "Link",
  website: "Website",
};

function groupSources(sources: PlaceholderSource[]): string[] {
  const set = new Set<string>();
  for (const s of sources) set.add(SOURCE_GROUP_LABEL[s.kind] ?? s.kind);
  return Array.from(set);
}

export function Step4Mapping({
  state,
  patch,
  campaignId,
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
  const [placeholders, setPlaceholders] = React.useState<DetectedPlaceholder[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [customFields, setCustomFields] = React.useState<CustomFieldDef[]>([]);

  React.useEffect(() => {
    setLoading(true);
    const envParam = state.options.envelopeTemplateId
      ? `?envelopeTemplateId=${encodeURIComponent(state.options.envelopeTemplateId)}`
      : "";
    Promise.all([
      fetch(`/api/campaigns/${campaignId}/placeholders${envParam}`).then((r) => r.json()),
      fetch("/api/contact-fields").then((r) => r.json()),
    ])
      .then(([phRes, cfRes]) => {
        setPlaceholders(phRes.placeholders ?? []);
        setCustomFields(cfRes.fields ?? []);
      })
      .catch((err) => toastError(toast, err))
      .finally(() => setLoading(false));
  }, [campaignId, state.options.envelopeTemplateId, toast]);

  // Auto-Suggest wenn noch kein Mapping vorhanden
  React.useEffect(() => {
    if (Object.keys(state.contactMapping).length > 0) return;
    if (placeholders.length === 0) return;
    const suggested = suggestContactMapping({
      placeholderKeys: placeholders.map((p) => p.key),
      customFieldKeys: customFields.map((c) => c.key),
      systemPageUrl: true,
    });
    patch({ contactMapping: suggested });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeholders.length, customFields.length]);

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
    <div className="max-w-5xl">
      <h2 className="text-2xl font-semibold text-ink mb-2">Was füllen wir wo ein?</h2>
      <p className="text-sm text-ink-muted mb-5">
        Wir haben deine Kampagne durchsucht und alle Platzhalter in Briefen,
        Landingpages, Umschlägen und Video-Folien gefunden. Jeden Platzhalter
        füllen wir aus einer Kontakt-Eigenschaft.
      </p>

      {loading ? (
        <div className="text-sm text-ink-muted flex items-center gap-2 py-10 justify-center">
          <Loader2 className="size-4 animate-spin" />
          Suche Platzhalter in deiner Kampagne…
        </div>
      ) : placeholders.length === 0 ? (
        <div className="rounded-xl bg-canvas p-8 text-center text-sm text-ink-muted">
          Wir haben keine Platzhalter in deiner Kampagne gefunden. Wenn du keine
          Personalisierung möchtest, geht das trotzdem weiter — wir setzen einfach
          nichts ein.
          <div className="mt-4">
            <Button variant="brand" onClick={onNext}>Weiter →</Button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
          <div className="rounded-2xl border border-line overflow-hidden bg-surface">
            {placeholders.map((p) => {
              const entry = state.contactMapping[p.key];
              const groups = groupSources(p.sources);
              return (
                <div
                  key={p.key}
                  className="grid grid-cols-[minmax(0,1fr)_1fr] gap-4 items-start px-4 py-3 border-b border-line last:border-b-0"
                >
                  <div className="min-w-0">
                    <code className="bg-brand-soft text-brand-deep px-2 py-1 rounded text-xs font-mono">
                      {"{{"}{p.key}{"}}"}
                    </code>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <span className="text-[10px] text-ink-muted">Verwendet in:</span>
                      {groups.map((g) => (
                        <span
                          key={g}
                          className="text-[10px] font-semibold bg-canvas-deep text-ink px-1.5 py-0.5 rounded"
                        >
                          {g}
                        </span>
                      ))}
                    </div>
                    {p.sources.some((s) => s.inaccessible) && (
                      <div className="text-[10px] text-warn mt-1">
                        Ein Doc konnten wir nicht lesen. Prüfe die Freigabe.
                      </div>
                    )}
                  </div>
                  <div>
                    <select
                      value={selectValue(entry)}
                      onChange={(e) => setEntry(p.key, parseValue(e.target.value))}
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
                        <option value="sys:pageUrl">🔗 Landingpage-URL (automatisch pro Empfänger)</option>
                      </optgroup>
                    </select>
                    {entry?.source === "systemUrl" && entry.field === "pageUrl" && (
                      <div className="mt-2 rounded-lg bg-brand-soft/60 px-3 py-2 text-[11px] leading-relaxed text-ink">
                        <b>Automatisch pro Empfänger.</b> Dieser Platzhalter wird
                        beim Versand mit der personalisierten Landingpage-URL
                        ersetzt — z.&nbsp;B.{" "}
                        <code className="rounded bg-white/70 px-1 font-mono">
                          https://video.deine-domain.de/vorname-nachname-abc
                        </code>
                        . Kein Fallback nötig, funktioniert immer.
                      </div>
                    )}
                    {entry && !(entry.source === "systemUrl" && entry.field === "pageUrl") && (
                      <>
                        <input
                          type="text"
                          placeholder="Fallback wenn leer (optional)"
                          value={entry.fallback ?? ""}
                          onChange={(e) =>
                            setEntry(p.key, { ...entry, fallback: e.target.value || undefined })
                          }
                          className="w-full mt-1 px-2 py-1 rounded border border-line bg-canvas text-xs"
                        />
                        <RulesEditor
                          entry={entry}
                          onChange={(e) => setEntry(p.key, e)}
                          placeholderKey={p.key}
                        />
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <aside className="bg-brand-soft rounded-2xl p-4 h-fit sticky top-4">
            <div className="text-xs font-bold text-brand-deep uppercase tracking-wide mb-3">
              Vorschau
            </div>
            <p className="text-xs text-ink-muted mb-3">
              So werden die Platzhalter beim ersten Kontakt gefüllt.
            </p>
            <div className="space-y-1.5 text-xs">
              {placeholders.map((p) => {
                const entry = state.contactMapping[p.key];
                return (
                  <div key={p.key} className="flex justify-between gap-2 items-start">
                    <span className="text-ink-muted font-mono truncate">{"{{"}{p.key}{"}}"}</span>
                    <span className="text-ink font-semibold text-right truncate max-w-[140px]">
                      {previewValue(entry, customFields)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 pt-3 border-t border-brand/20 text-[11px] text-ink-muted">
              Echte Vorschau siehst du im nächsten Schritt.
            </div>
          </aside>
        </div>
      )}

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
    salutation: "Anrede",
    title: "Titel",
    externalId: "ID (externe Kunden-Nr.)",
    street: "Straße",
    postalCode: "PLZ",
    city: "Ort",
    country: "Land",
    position: "Position",
    website: "Website des Kunden",
    gender: "Geschlecht",
  };
  return map[field] ?? field;
}

/**
 * Wenn-Dann-Regeln pro Placeholder: „Wenn Wert = X, Y, Z → leer".
 * Häufigster Use-Case: eigenes Land ausblenden. Preset-Buttons für DE/AT/CH
 * legen die passenden Werte in einem Klick an — für alle anderen Fälle
 * kann der User frei tippen.
 */
function RulesEditor({
  entry,
  onChange,
  placeholderKey,
}: {
  entry: ContactMappingEntry;
  onChange: (e: ContactMappingEntry) => void;
  placeholderKey: string;
}) {
  const [open, setOpen] = React.useState((entry.rules ?? []).length > 0);
  const rules = entry.rules ?? [];

  function updateRules(next: ContactMappingRule[]) {
    onChange({ ...entry, rules: next.length > 0 ? next : undefined });
  }
  function addRule(rule: ContactMappingRule) {
    updateRules([...rules, rule]);
  }
  function removeRule(idx: number) {
    updateRules(rules.filter((_, i) => i !== idx));
  }
  function setRule(idx: number, patch: Partial<ContactMappingRule>) {
    updateRules(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  // Heuristik: sieht das Feld nach "Land" aus? Dann Preset-Buttons anbieten.
  const looksLikeCountry = /land|country/i.test(placeholderKey) ||
    (entry.source === "customField" && /land|country/i.test(entry.field));

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 text-[10px] text-brand-deep font-semibold hover:underline"
      >
        + Wenn-Dann-Regel
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-lg bg-canvas-deep p-2 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-bold text-ink uppercase tracking-wide">
          Wenn-Dann-Regeln
        </span>
        <button
          type="button"
          onClick={() => {
            updateRules([]);
            setOpen(false);
          }}
          className="text-[10px] text-ink-muted hover:text-danger"
        >
          entfernen
        </button>
      </div>

      {looksLikeCountry && rules.length === 0 && (
        <div className="text-[10px] text-ink-muted">
          Häufig genutzt: Land ausblenden, wenn du im selben Land verschickst.
          <div className="flex flex-wrap gap-1 mt-1">
            {COUNTRY_HIDE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() =>
                  addRule({ equalsAnyOf: p.values, then: "empty" })
                }
                className="px-2 py-1 rounded bg-white border border-line text-[10px] text-ink font-semibold hover:border-brand hover:text-brand-deep"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {rules.map((r, i) => (
        <div key={i} className="bg-white rounded p-2 text-[11px]">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-ink-muted">Wenn Wert einer von:</span>
            <button
              type="button"
              onClick={() => removeRule(i)}
              className="ml-auto text-ink-muted hover:text-danger"
              title="Regel entfernen"
            >
              ×
            </button>
          </div>
          <input
            type="text"
            value={r.equalsAnyOf.join(", ")}
            onChange={(e) => {
              const values = e.target.value
                .split(",")
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
              setRule(i, { equalsAnyOf: values });
            }}
            placeholder="z. B. Deutschland, DE, D"
            className="w-full px-2 py-1 rounded border border-line bg-canvas text-[11px] mb-1"
          />
          <div className="flex items-center gap-1">
            <span className="text-ink-muted">→</span>
            <select
              value={r.then}
              onChange={(e) => setRule(i, { then: e.target.value as "empty" | "replace" })}
              className="text-[11px] px-1 py-0.5 rounded border border-line bg-canvas"
            >
              <option value="empty">leer lassen</option>
              <option value="replace">ersetzen durch</option>
            </select>
            {r.then === "replace" && (
              <input
                type="text"
                value={r.replaceWith ?? ""}
                onChange={(e) => setRule(i, { replaceWith: e.target.value })}
                placeholder="Ersatzwert"
                className="flex-1 px-2 py-0.5 rounded border border-line bg-canvas text-[11px]"
              />
            )}
          </div>
        </div>
      ))}

      <button
        type="button"
        onClick={() => addRule({ equalsAnyOf: [], then: "empty" })}
        className="text-[10px] text-brand-deep font-semibold hover:underline"
      >
        + Regel
      </button>
    </div>
  );
}

function previewValue(
  entry: ContactMappingEntry | undefined,
  customFields: CustomFieldDef[],
): string {
  if (!entry) return "—";
  if (entry.source === "systemUrl") return "(beim Rendern gefüllt)";
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
