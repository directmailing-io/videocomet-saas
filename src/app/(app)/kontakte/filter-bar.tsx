"use client";

/**
 * Filter-Bar für die Kontakte-Zentrale (Mini-CRM Etappe 4).
 *
 *   - Chip-Style: aktive Bedingungen sichtbar, per × entfernbar.
 *   - "+ Bedingung" öffnet Kategorien-Menü. UND-verknüpft auf Root-Ebene.
 *   - Presets-Button: 6 fertige Filter aus dem Pitch (nicht-öffner, warm etc.).
 *   - "Als Liste speichern" öffnet Modal (static | smart).
 *
 * Aktuell simpel: nur UND-Verknüpfung. ODER-Gruppen (Ellens Vorschlag) kommen
 * als Ausbau, wenn User es explizit anfragt — heute wäre die UI-Komplexität
 * die Investition nicht wert.
 */

import * as React from "react";
import { ChevronDown, Filter as FilterIcon, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";
import type {
  FilterCondition,
  FilterDefinition,
  FilterField,
  FilterOp,
} from "@/lib/contacts/filter";
import { EMPTY_FILTER, FILTER_PRESETS } from "@/lib/contacts/filter";

interface FilterBarProps {
  value: FilterDefinition;
  onChange: (next: FilterDefinition) => void;
  matched: number;
  onSaveAsList: (name: string, type: "static" | "smart") => Promise<void>;
  onStartCampaign?: () => void;
}

/** Human-Label + erlaubte Operatoren + Value-Renderer für jedes Filter-Feld. */
interface FieldMeta {
  key: FilterField;
  category: string;
  label: string;
  ops: Array<{ op: FilterOp; label: string; value?: "number" | "text" | "date-days" | "none" }>;
}

const FIELDS: FieldMeta[] = [
  // Kampagne & Runde
  { key: "campaign_id", category: "Kampagnen & Runden", label: "Kampagne", ops: [
    { op: "in", label: "ist eine von", value: "text" },
    { op: "not_in", label: "ist keine von", value: "text" },
  ]},
  { key: "run_id", category: "Kampagnen & Runden", label: "Runde", ops: [
    { op: "in", label: "ist eine von", value: "text" },
    { op: "not_in", label: "ist keine von", value: "text" },
  ]},
  { key: "campaign_count", category: "Kampagnen & Runden", label: "Anzahl Kampagnen", ops: [
    { op: "gte", label: "≥", value: "number" },
    { op: "eq", label: "=", value: "number" },
    { op: "lte", label: "≤", value: "number" },
  ]},
  { key: "created_at", category: "Kampagnen & Runden", label: "Kontakt angelegt", ops: [
    { op: "within_days", label: "in den letzten … Tagen", value: "date-days" },
    { op: "before", label: "vor Datum", value: "date-days" },
  ]},
  { key: "last_seen_at", category: "Kampagnen & Runden", label: "Letzte Aktivität", ops: [
    { op: "within_days", label: "in den letzten … Tagen", value: "date-days" },
    { op: "before", label: "vor mehr als … Tagen", value: "date-days" },
    { op: "is_false", label: "noch nie aktiv", value: "none" },
  ]},

  // Aktivität
  { key: "activity.opens", category: "Aktivität", label: "Landingpage-Öffnungen", ops: [
    { op: "gte", label: "≥", value: "number" },
    { op: "eq", label: "=", value: "number" },
    { op: "lte", label: "≤", value: "number" },
  ]},
  { key: "activity.plays", category: "Aktivität", label: "Video-Plays", ops: [
    { op: "gte", label: "≥", value: "number" },
    { op: "eq", label: "=", value: "number" },
  ]},
  { key: "activity.cta", category: "Aktivität", label: "CTA-Klicks", ops: [
    { op: "gte", label: "≥", value: "number" },
    { op: "eq", label: "=", value: "number" },
  ]},
  { key: "activity.watch_time_sec", category: "Aktivität", label: "Watch-Time (Sek.)", ops: [
    { op: "gte", label: "≥", value: "number" },
  ]},

  // Kontakt-Daten
  { key: "email", category: "Kontakt-Daten", label: "E-Mail", ops: [
    { op: "is_true", label: "vorhanden", value: "none" },
    { op: "is_false", label: "leer", value: "none" },
    { op: "contains", label: "enthält", value: "text" },
  ]},
  { key: "email_domain", category: "Kontakt-Daten", label: "E-Mail-Domain", ops: [
    { op: "eq", label: "= (z. B. praxis-ciecior.de)", value: "text" },
    { op: "ne", label: "≠", value: "text" },
  ]},
  { key: "company", category: "Kontakt-Daten", label: "Firma", ops: [
    { op: "contains", label: "enthält", value: "text" },
    { op: "not_contains", label: "enthält nicht", value: "text" },
  ]},
  { key: "phone_present", category: "Kontakt-Daten", label: "Telefon", ops: [
    { op: "is_true", label: "vorhanden", value: "none" },
    { op: "is_false", label: "fehlt", value: "none" },
  ]},
  { key: "linkedin_present", category: "Kontakt-Daten", label: "LinkedIn", ops: [
    { op: "is_true", label: "vorhanden", value: "none" },
    { op: "is_false", label: "fehlt", value: "none" },
  ]},

  // Meta
  { key: "in_list", category: "Listen & Meta", label: "Ist in Liste", ops: [
    { op: "in", label: "eine von", value: "text" }, // Value = comma-separated IDs, im UI mit Multi-Select
  ]},
  { key: "not_in_list", category: "Listen & Meta", label: "Ist nicht in Liste", ops: [
    { op: "in", label: "keine von", value: "text" },
  ]},
  { key: "is_duplicate", category: "Listen & Meta", label: "Duplikat-Verdacht", ops: [
    { op: "is_true", label: "ja", value: "none" },
    { op: "is_false", label: "nein", value: "none" },
  ]},
];

const CATS = ["Kampagnen & Runden", "Aktivität", "Kontakt-Daten", "Listen & Meta"];

interface ContactList {
  id: string;
  name: string;
}

interface FilterOption {
  id: string;
  name: string;
}
interface RunOption extends FilterOption {
  campaignId: string;
  campaignName: string;
}
interface CustomFieldOption {
  key: string;
  label: string;
  type: string;
}

export function FilterBar({
  value,
  onChange,
  matched,
  onSaveAsList,
  onStartCampaign,
}: FilterBarProps) {
  const [addMenuOpen, setAddMenuOpen] = React.useState(false);
  const [presetsOpen, setPresetsOpen] = React.useState(false);
  const [saveModalOpen, setSaveModalOpen] = React.useState(false);
  const [availableLists, setAvailableLists] = React.useState<ContactList[]>([]);
  const [availableCampaigns, setAvailableCampaigns] = React.useState<FilterOption[]>([]);
  const [availableRuns, setAvailableRuns] = React.useState<RunOption[]>([]);
  const [availableCustomFields, setAvailableCustomFields] = React.useState<CustomFieldOption[]>([]);

  React.useEffect(() => {
    void fetch("/api/contact-lists")
      .then((r) => r.json())
      .then((b) => setAvailableLists((b.lists ?? []).map((l: { id: string; name: string }) => ({ id: l.id, name: l.name }))))
      .catch(() => {});
    void fetch("/api/contacts/v2/filter-options")
      .then((r) => r.json())
      .then((b) => {
        setAvailableCampaigns(b.campaigns ?? []);
        setAvailableRuns(b.runs ?? []);
        setAvailableCustomFields(b.customFields ?? []);
      })
      .catch(() => {});
  }, []);

  const hasFilter = value.conditions.length > 0;

  function addCondition(field: FilterField) {
    const meta = FIELDS.find((f) => f.key === field);
    if (!meta) return;
    const firstOp = meta.ops[0];
    const initialValue =
      firstOp.value === "number"
        ? 1
        : firstOp.value === "date-days"
          ? 14
          : firstOp.value === "text"
            ? ""
            : null;
    const cond: FilterCondition = {
      type: "condition",
      field,
      op: firstOp.op,
      value: initialValue,
    };
    onChange({
      logic: "and",
      conditions: [...value.conditions, cond],
    });
    setAddMenuOpen(false);
  }

  function updateCondition(index: number, patch: Partial<FilterCondition>) {
    const next = value.conditions.map((c, i) =>
      i === index && c.type === "condition" ? { ...c, ...patch } : c,
    );
    onChange({ logic: "and", conditions: next });
  }
  function removeCondition(index: number) {
    onChange({
      logic: "and",
      conditions: value.conditions.filter((_, i) => i !== index),
    });
  }
  function clearAll() {
    onChange(EMPTY_FILTER);
  }
  function applyPreset(defn: FilterDefinition) {
    onChange(defn);
    setPresetsOpen(false);
  }

  return (
    <div className="border-b border-line bg-canvas/50">
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        <FilterIcon className="size-3.5 text-ink-muted mr-1" />

        {value.conditions.map((c, i) => {
          if (c.type !== "condition") return null;
          return (
            <ConditionChip
              key={i}
              condition={c}
              onChange={(patch) => updateCondition(i, patch)}
              onRemove={() => removeCondition(i)}
              availableLists={availableLists}
              availableCampaigns={availableCampaigns}
              availableRuns={availableRuns}
            />
          );
        })}

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setAddMenuOpen((v) => !v);
              setPresetsOpen(false);
            }}
            className="px-2.5 py-1 rounded-md text-xs font-semibold text-brand-deep hover:bg-brand-soft"
          >
            + Bedingung
          </button>
          {addMenuOpen && (
            <div
              className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-line py-2 min-w-[280px] z-20 max-h-96 overflow-y-auto"
              onMouseLeave={() => setAddMenuOpen(false)}
            >
              {CATS.map((cat) => (
                <div key={cat}>
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-ink-muted font-semibold">
                    {cat}
                  </div>
                  {FIELDS.filter((f) => f.category === cat).map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => addCondition(f.key)}
                      className="w-full text-left px-3 py-1.5 text-xs hover:bg-canvas"
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => {
              setPresetsOpen((v) => !v);
              setAddMenuOpen(false);
            }}
            className="px-2.5 py-1 rounded-md text-xs font-semibold text-ink-muted hover:bg-canvas-deep flex items-center gap-1"
          >
            Vorlagen
            <ChevronDown className="size-3" />
          </button>
          {presetsOpen && (
            <div
              className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-line py-1 min-w-[320px] z-20"
              onMouseLeave={() => setPresetsOpen(false)}
            >
              {FILTER_PRESETS.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => applyPreset(p.definition)}
                  className="w-full text-left px-3 py-2 hover:bg-canvas"
                >
                  <div className="text-xs font-semibold text-ink">{p.label}</div>
                  <div className="text-[11px] text-ink-muted">{p.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {hasFilter && (
          <>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-ink-muted">
                <strong className="text-ink">{matched}</strong> Treffer
              </span>
              <button
                type="button"
                onClick={clearAll}
                className="text-xs text-ink-muted hover:text-ink px-2 py-1"
              >
                Filter leeren
              </button>
              <button
                type="button"
                onClick={() => setSaveModalOpen(true)}
                className="px-2.5 py-1 rounded-md bg-white text-ink text-xs font-semibold shadow-sm hover:bg-canvas border border-line"
              >
                Als neue Liste speichern
              </button>
              {onStartCampaign && (
                <button
                  type="button"
                  onClick={onStartCampaign}
                  className="px-2.5 py-1 rounded-md bg-ink text-white text-xs font-semibold hover:bg-brand-deep"
                >
                  In Kampagne starten →
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {saveModalOpen && (
        <SaveAsListModal
          matched={matched}
          onClose={() => setSaveModalOpen(false)}
          onSave={async (name, type) => {
            await onSaveAsList(name, type);
            setSaveModalOpen(false);
          }}
        />
      )}
    </div>
  );
}

/** Chip für eine einzelne Bedingung — Klick öffnet Op/Value-Popover. */
function ConditionChip({
  condition,
  onChange,
  onRemove,
  availableLists,
  availableCampaigns,
  availableRuns,
}: {
  condition: FilterCondition;
  onChange: (patch: Partial<FilterCondition>) => void;
  onRemove: () => void;
  availableLists: ContactList[];
  availableCampaigns: FilterOption[];
  availableRuns: RunOption[];
}) {
  const meta = FIELDS.find((f) => f.key === condition.field);
  if (!meta) return null;
  const op = meta.ops.find((o) => o.op === condition.op) ?? meta.ops[0];

  // Value-Anzeige
  let valueLabel = "";
  if (op.value === "text") valueLabel = String(condition.value ?? "");
  else if (op.value === "number") valueLabel = String(condition.value ?? "");
  else if (op.value === "date-days") valueLabel = `${condition.value ?? ""} Tagen`;

  const isListPicker = condition.field === "in_list" || condition.field === "not_in_list";
  const isCampaignPicker = condition.field === "campaign_id";
  const isRunPicker = condition.field === "run_id";
  const isMultiPicker = isListPicker || isCampaignPicker || isRunPicker;

  const pickerOptions: Array<{ id: string; label: string }> = isListPicker
    ? availableLists.map((l) => ({ id: l.id, label: l.name }))
    : isCampaignPicker
      ? availableCampaigns.map((c) => ({ id: c.id, label: c.name }))
      : isRunPicker
        ? availableRuns.map((r) => ({
            id: r.id,
            label: `${r.campaignName} · ${r.name}`,
          }))
        : [];

  if (isMultiPicker) {
    const ids = Array.isArray(condition.value) ? (condition.value as string[]) : [];
    const names = ids
      .map((id) => pickerOptions.find((o) => o.id === id)?.label)
      .filter(Boolean)
      .join(", ");
    valueLabel = names || "wählen…";
  }

  return (
    <span className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded-md border border-line text-xs shadow-sm">
      <span className="text-ink-muted">{meta.label}</span>
      <select
        value={condition.op}
        onChange={(e) => onChange({ op: e.target.value as FilterOp })}
        className="bg-transparent text-brand-deep font-semibold border-none outline-none text-xs cursor-pointer"
      >
        {meta.ops.map((o) => (
          <option key={o.op} value={o.op}>
            {o.label}
          </option>
        ))}
      </select>
      {op.value !== "none" && !isMultiPicker && (
        <input
          type={op.value === "number" || op.value === "date-days" ? "number" : "text"}
          value={String(condition.value ?? "")}
          onChange={(e) =>
            onChange({
              value:
                op.value === "number" || op.value === "date-days"
                  ? Number(e.target.value)
                  : e.target.value,
            })
          }
          className="w-16 px-1 border-b border-line text-xs bg-transparent outline-none focus:border-brand"
          placeholder={op.value === "text" ? "…" : ""}
        />
      )}
      {isMultiPicker && (
        <MultiSelectValue
          value={(Array.isArray(condition.value) ? condition.value : []) as string[]}
          options={pickerOptions}
          onChange={(v) => onChange({ value: v })}
          label={valueLabel}
        />
      )}
      {valueLabel && !isMultiPicker && op.value !== "text" && op.value !== "number" && op.value !== "date-days" && (
        <span className="text-ink font-semibold">{valueLabel}</span>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="text-ink-muted hover:text-danger ml-1"
        title="Bedingung entfernen"
      >
        <X className="size-3" />
      </button>
    </span>
  );
}

/** Kleines Popover mit Suchfeld + Checkbox-Liste zum Auswählen mehrerer
 *  Optionen (Kampagnen, Runden, Listen im Filter-Chip). */
function MultiSelectValue({
  value,
  options,
  onChange,
  label,
}: {
  value: string[];
  options: Array<{ id: string; label: string }>;
  onChange: (next: string[]) => void;
  label: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");
  const ref = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const filtered = search
    ? options.filter((o) => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-xs text-ink font-semibold bg-transparent border-b border-line hover:border-brand outline-none px-1 min-w-[80px] text-left truncate max-w-[200px]"
      >
        {label}
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white rounded-lg shadow-xl border border-line z-30 min-w-[280px] max-h-64 overflow-hidden flex flex-col">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suchen…"
            autoFocus
            className="text-xs px-3 py-2 border-b border-line outline-none"
          />
          <div className="flex-1 overflow-y-auto">
            {filtered.length === 0 && (
              <div className="text-xs text-ink-muted px-3 py-2 italic">
                Keine Treffer.
              </div>
            )}
            {filtered.map((o) => {
              const checked = value.includes(o.id);
              return (
                <label
                  key={o.id}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-canvas cursor-pointer text-xs"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(o.id)}
                  />
                  <span className="truncate">{o.label}</span>
                </label>
              );
            })}
          </div>
          <div className="px-3 py-1.5 border-t border-line text-[11px] text-ink-muted flex justify-between">
            <span>{value.length} ausgewählt</span>
            {value.length > 0 && (
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-brand-deep font-semibold"
              >
                Leeren
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SaveAsListModal({
  matched,
  onClose,
  onSave,
}: {
  matched: number;
  onClose: () => void;
  onSave: (name: string, type: "static" | "smart") => Promise<void>;
}) {
  const { toast } = useToast();
  const [name, setName] = React.useState("");
  const [type, setType] = React.useState<"static" | "smart">("static");
  const [busy, setBusy] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await onSave(name.trim(), type);
      toast({ title: "Liste angelegt" });
    } catch (err) {
      toast({
        title: "Liste konnte nicht angelegt werden",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl p-6 w-full max-w-md shadow-xl"
      >
        <h3 className="text-lg font-semibold text-ink mb-1">Filter als Liste speichern</h3>
        <p className="text-xs text-ink-muted mb-4">
          {matched} Kontakt{matched === 1 ? "" : "e"} passen auf den aktuellen Filter.
        </p>
        <label className="block text-xs font-semibold text-ink mb-1">Listen-Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={80}
          autoFocus
          placeholder="z. B. Follow-up Nicht-Öffner"
          className="w-full px-3 py-2 rounded-lg border border-line bg-canvas text-sm mb-4 focus:outline-none focus:border-brand"
        />
        <fieldset className="mb-4">
          <legend className="text-xs font-semibold text-ink mb-2">Art der Liste</legend>
          <label className="flex gap-2 items-start p-2 rounded-lg border border-line mb-2 cursor-pointer hover:bg-canvas">
            <input
              type="radio"
              checked={type === "static"}
              onChange={() => setType("static")}
              className="mt-0.5"
            />
            <div>
              <div className="text-xs font-semibold text-ink">Fest (Standard)</div>
              <div className="text-[11px] text-ink-muted">
                Genau diese {matched} Kontakte werden in die Liste eingefroren. Neue passende Kontakte kommen NICHT automatisch dazu.
              </div>
            </div>
          </label>
          <label className="flex gap-2 items-start p-2 rounded-lg border border-line cursor-pointer hover:bg-canvas">
            <input
              type="radio"
              checked={type === "smart"}
              onChange={() => setType("smart")}
              className="mt-0.5"
            />
            <div>
              <div className="text-xs font-semibold text-ink">Automatisch (Smart)</div>
              <div className="text-[11px] text-ink-muted">
                Filter wird gespeichert. Jeder neue Kontakt, der auf die Bedingungen passt, landet automatisch in der Liste.
              </div>
            </div>
          </label>
        </fieldset>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-ink-muted hover:bg-canvas"
          >
            Abbrechen
          </button>
          <button
            type="submit"
            disabled={!name.trim() || busy}
            className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold disabled:opacity-50 hover:bg-brand-deep"
          >
            {busy ? "Speichern…" : "Liste anlegen"}
          </button>
        </div>
      </form>
    </div>
  );
}
