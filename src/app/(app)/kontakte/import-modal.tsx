"use client";

/**
 * Import-Modal für Kontakte (Mini-CRM Etappe 5).
 *
 * 3 Schritte:
 *   1. Upload (CSV / XLSX / Google-Sheet-URL)
 *   2. Mapping (Auto-Suggest, User kann überschreiben)
 *   3. Fertig (Zusammenfassung: created/updated/skipped)
 *
 * Beim Öffnen wird die Ziel-Liste vorgegeben — wenn keine gewählt ist,
 * verlangen wir vom User eine (mit "+ Neue Liste"-Option im Dropdown).
 */

import * as React from "react";
import { CloudUpload, FileSpreadsheet, Loader2, Upload, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";
import type { ContactFieldSlot, CustomFieldType } from "@/lib/contacts/detect-field";

interface SuggestedColumn {
  header: string;
  slot: ContactFieldSlot;
  detectedType: CustomFieldType;
  sample: string[];
}

interface ContactList {
  id: string;
  name: string;
}

interface ImportModalProps {
  lists: ContactList[];
  initialListId: string | null;
  onClose: () => void;
  onDone: () => void;
  onCreateList: () => void;
}

interface CustomFieldDef {
  key: string;
  label: string;
  detectedType: string;
}

type Step = "upload" | "mapping" | "done";

const SLOT_OPTIONS: Array<{ value: ContactFieldSlot | "ignore"; label: string; group?: string }> = [
  { value: "email", label: "E-Mail", group: "Kontakt" },
  { value: "firstName", label: "Vorname", group: "Kontakt" },
  { value: "lastName", label: "Nachname", group: "Kontakt" },
  { value: "fullName", label: "Vollständiger Name", group: "Kontakt" },
  { value: "company", label: "Firma", group: "Kontakt" },
  { value: "phone", label: "Telefon", group: "Kontakt" },
  { value: "linkedinUrl", label: "LinkedIn", group: "Kontakt" },
  { value: "custom", label: "Eigenes Feld", group: "Anderes" },
  { value: "ignore", label: "Nicht importieren", group: "Anderes" },
];

export function ImportModal({
  lists,
  initialListId,
  onClose,
  onDone,
  onCreateList,
}: ImportModalProps) {
  const { toast } = useToast();
  const [step, setStep] = React.useState<Step>("upload");
  const [busy, setBusy] = React.useState(false);
  const [listId, setListId] = React.useState<string | null>(initialListId);

  // Upload-State
  const [file, setFile] = React.useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = React.useState("");

  // Mapping-State
  const [parseId, setParseId] = React.useState<string | null>(null);
  const [headers, setHeaders] = React.useState<string[]>([]);
  const [preview, setPreview] = React.useState<string[][]>([]);
  const [totalRows, setTotalRows] = React.useState(0);
  const [mapping, setMapping] = React.useState<
    Record<
      string,
      { slot: ContactFieldSlot | "ignore"; customKey?: string; customLabel?: string; customType?: string }
    >
  >({});
  // Bestehende globale Custom-Felder — beim Mapping als Ziele wählbar.
  const [customFields, setCustomFields] = React.useState<CustomFieldDef[]>([]);

  React.useEffect(() => {
    void fetch("/api/contact-fields")
      .then((r) => r.json())
      .then((b) => setCustomFields(b.fields ?? []))
      .catch(() => {});
  }, []);

  // Done-State
  const [result, setResult] = React.useState<{
    created: number;
    updated: number;
    skipped: number;
    totalAdded: number;
  } | null>(null);

  async function uploadPreview() {
    if (!listId) {
      toast({ title: "Bitte erst eine Liste wählen", variant: "danger" });
      return;
    }
    const form = new FormData();
    if (file) {
      const isXlsx = /\.xlsx?$/i.test(file.name);
      form.set("kind", isXlsx ? "xlsx" : "csv");
      form.set("file", file);
    } else if (sheetUrl) {
      form.set("kind", "google-sheets");
      form.set("url", sheetUrl);
    } else {
      toast({ title: "Bitte Datei wählen oder Google-Sheets-URL eintragen", variant: "danger" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/contact-lists/${listId}/import`, {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler beim Preview");
      setParseId(body.parseId);
      setHeaders(body.headers);
      setPreview(body.previewRows);
      setTotalRows(body.totalRows);
      const initialMap: typeof mapping = {};
      // Header -> lowercase Vergleich für existierende Custom-Fields
      const normHeader = (s: string) =>
        s.toLowerCase().replace(/[_\s-]+/g, "");
      for (const s of body.suggested as SuggestedColumn[]) {
        // Prio 1: existierendes Custom-Feld mit passendem Label
        const existing = customFields.find(
          (cf) => normHeader(cf.label) === normHeader(s.header),
        );
        if (existing && s.slot === "custom") {
          initialMap[s.header] = {
            slot: "custom",
            customKey: existing.key,
            customLabel: existing.label,
            customType: existing.detectedType,
          };
        } else {
          initialMap[s.header] = {
            slot: s.slot,
            customLabel: s.slot === "custom" ? s.header : undefined,
            customType: s.detectedType,
          };
        }
      }
      setMapping(initialMap);
      setStep("mapping");
    } catch (err) {
      toastError(toast, err);
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!parseId || !listId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/contact-lists/${listId}/import/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parseId, mapping }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Import fehlgeschlagen");
      setResult({
        created: body.created,
        updated: body.updated,
        skipped: body.skipped,
        totalAdded: body.totalAdded,
      });
      setStep("done");
    } catch (err) {
      toastError(toast, err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={step === "done" ? undefined : onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl shadow-2xl w-full max-w-3xl max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between p-5 border-b border-line">
          <div>
            <h3 className="text-lg font-semibold text-ink">Kontakte importieren</h3>
            <p className="text-xs text-ink-muted mt-0.5">
              {step === "upload" && "CSV, Excel oder Google-Sheets-URL — wir schlagen dir das Mapping vor."}
              {step === "mapping" && `${totalRows} Zeilen erkannt · Ordne die Spalten zu und starte den Import.`}
              {step === "done" && "Fertig! Die Kontakte sind in der Liste."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              if (step === "done") onDone();
              else onClose();
            }}
            className="p-1.5 rounded-lg hover:bg-canvas"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {step === "upload" && (
            <div className="space-y-5">
              {/* Ziel-Liste */}
              <div>
                <label className="block text-sm font-semibold text-ink mb-2">
                  In welche Liste sollen die Kontakte?
                </label>
                <div className="flex gap-2">
                  <select
                    value={listId ?? ""}
                    onChange={(e) => setListId(e.target.value || null)}
                    className="flex-1 px-3 py-2.5 rounded-xl border border-line bg-surface text-sm focus:outline-none focus:border-brand"
                  >
                    <option value="">— Bitte wählen —</option>
                    {lists.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={onCreateList}
                    className="px-4 py-2.5 rounded-xl text-sm font-semibold text-brand-deep border border-brand/30 bg-brand-soft hover:bg-brand-soft/70 whitespace-nowrap"
                  >
                    + Neue Liste
                  </button>
                </div>
                <p className="text-xs text-ink-muted mt-1.5">
                  Kontakte werden in diese Liste importiert und stehen dann für
                  neue Kampagnen-Runden zur Verfügung.
                </p>
              </div>

              {/* Drag & Drop Zone */}
              <div>
                <label className="block text-sm font-semibold text-ink mb-2">
                  Datei
                </label>
                <DropZone file={file} onFile={setFile} />
              </div>

              {/* Google-Sheets als Alternative */}
              <details className="group">
                <summary className="text-xs text-ink-muted cursor-pointer hover:text-ink flex items-center gap-1">
                  <FileSpreadsheet className="size-3.5" />
                  Alternativ: Google-Sheets-URL verwenden
                </summary>
                <div className="mt-3 pl-5">
                  <input
                    type="url"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                    className="w-full px-3 py-2.5 rounded-xl border border-line bg-canvas text-sm focus:outline-none focus:border-brand"
                  />
                  <p className="text-[11px] text-ink-muted mt-1">
                    Das Sheet muss auf „Jeder mit dem Link kann ansehen" freigegeben sein.
                  </p>
                </div>
              </details>
            </div>
          )}

          {step === "mapping" && (
            <MappingStep
              headers={headers}
              preview={preview}
              mapping={mapping}
              onChange={setMapping}
              customFields={customFields}
              onCustomFieldsChange={setCustomFields}
            />
          )}

          {step === "done" && result && (
            <div className="text-center py-8">
              <div className="text-4xl mb-2">✓</div>
              <div className="text-lg font-semibold text-ink mb-4">Import abgeschlossen</div>
              <div className="inline-grid grid-cols-3 gap-8 text-sm">
                <div>
                  <div className="text-2xl font-bold text-ok tabular-nums">
                    {result.created}
                  </div>
                  <div className="text-xs text-ink-muted">neu</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-info tabular-nums">
                    {result.updated}
                  </div>
                  <div className="text-xs text-ink-muted">aktualisiert</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-ink-muted tabular-nums">
                    {result.skipped}
                  </div>
                  <div className="text-xs text-ink-muted">übersprungen</div>
                </div>
              </div>
              <p className="text-xs text-ink-muted mt-4">
                Übersprungen: Zeilen ohne E-Mail, Name und Firma (nichts, wodurch
                wir sie eindeutig zuordnen könnten).
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-5 border-t border-line">
          {step === "upload" && (
            <>
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg text-sm text-ink-muted hover:bg-canvas"
              >
                Abbrechen
              </button>
              <button
                type="button"
                onClick={uploadPreview}
                disabled={busy || (!file && !sheetUrl)}
                className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold disabled:opacity-50 hover:bg-brand-deep flex items-center gap-2"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
                Vorschau anzeigen
              </button>
            </>
          )}
          {step === "mapping" && (
            <>
              <button
                type="button"
                onClick={() => setStep("upload")}
                className="px-4 py-2 rounded-lg text-sm text-ink-muted hover:bg-canvas"
              >
                Zurück
              </button>
              <button
                type="button"
                onClick={applyImport}
                disabled={busy}
                className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold disabled:opacity-50 hover:bg-brand-deep flex items-center gap-2"
              >
                {busy && <Loader2 className="size-3.5 animate-spin" />}
                {totalRows} Kontakte importieren
              </button>
            </>
          )}
          {step === "done" && (
            <button
              type="button"
              onClick={onDone}
              className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold hover:bg-brand-deep"
            >
              Zur Liste →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** Mapping-Schritt mit klarer 2-Spalten-Struktur.
 *
 *  Links: die Spalte aus der Datei (Header + Beispiele).
 *  Rechts: ein Dropdown mit ALLEN Optionen (Basis-Felder, existierende
 *  Custom-Felder, „+ Neues Feld anlegen", „Nicht importieren").
 *  Bei Auswahl „+ Neues Feld": öffnet Inline-Formular; das Feld wird
 *  sofort global registriert und steht dann auch bei anderen Spalten und
 *  in der Kontakt-Tabelle zur Verfügung. */
function MappingStep({
  headers,
  preview,
  mapping,
  onChange,
  customFields,
  onCustomFieldsChange,
}: {
  headers: string[];
  preview: string[][];
  mapping: Record<
    string,
    { slot: ContactFieldSlot | "ignore"; customKey?: string; customLabel?: string; customType?: string }
  >;
  onChange: React.Dispatch<React.SetStateAction<Record<
    string,
    { slot: ContactFieldSlot | "ignore"; customKey?: string; customLabel?: string; customType?: string }
  >>>;
  customFields: CustomFieldDef[];
  onCustomFieldsChange: React.Dispatch<React.SetStateAction<CustomFieldDef[]>>;
}) {
  const [autoSlots] = React.useState<Record<string, ContactFieldSlot | "ignore">>(() => {
    const m: Record<string, ContactFieldSlot | "ignore"> = {};
    for (const h of headers) m[h] = mapping[h]?.slot ?? "custom";
    return m;
  });

  return (
    <div>
      <div className="rounded-lg bg-canvas-deep px-3 py-2 text-xs text-ink-muted mb-4">
        Wir haben oben schon Vorschläge gemacht (grünes Häkchen). Für jede Spalte
        wählst du rechts, wohin die Werte sollen. Willst du eine Spalte nicht
        importieren, wähle „Nicht importieren".
      </div>
      <div className="rounded-xl border border-line overflow-hidden">
        {headers.map((h, i) => {
          const current = mapping[h] ?? { slot: "custom" as ContactFieldSlot };
          const isAuto =
            autoSlots[h] === current.slot && current.slot !== "custom" && current.slot !== "ignore";
          const samples = preview
            .slice(0, 3)
            .map((r) => r[i])
            .filter((v) => v && v.trim().length > 0)
            .slice(0, 3);
          // Wert für Select: entweder Basis-Slot oder "cf:<key>" für bestehendes
          // Custom-Feld oder "new" für neues Feld oder "ignore".
          const selectValue =
            current.slot === "custom" && current.customKey
              ? "cf:" + current.customKey
              : current.slot === "custom"
                ? "new"
                : current.slot;

          return (
            <div
              key={h}
              className={
                "grid grid-cols-[1fr_280px] gap-4 items-start px-4 py-3 border-b border-line last:border-b-0 " +
                (current.slot === "ignore" ? "bg-canvas opacity-70" : "")
              }
            >
              <div className="min-w-0">
                <div className="text-sm font-semibold text-ink truncate">{h}</div>
                <div className="text-[11px] text-ink-muted truncate">
                  {samples.length > 0 ? samples.join(" · ") : "(leere Spalte)"}
                </div>
              </div>
              <div>
                <div className="relative">
                  <select
                    value={selectValue}
                    onChange={(e) => {
                      const v = e.target.value;
                      onChange((prev) => {
                        if (v === "new") {
                          return {
                            ...prev,
                            [h]: {
                              slot: "custom",
                              customLabel: prev[h]?.customLabel ?? h,
                              customType: prev[h]?.customType,
                            },
                          };
                        }
                        if (v.startsWith("cf:")) {
                          const key = v.slice(3);
                          const cf = customFields.find((c) => c.key === key);
                          return {
                            ...prev,
                            [h]: {
                              slot: "custom",
                              customKey: key,
                              customLabel: cf?.label ?? key,
                              customType: cf?.detectedType,
                            },
                          };
                        }
                        return {
                          ...prev,
                          [h]: { slot: v as ContactFieldSlot | "ignore" },
                        };
                      });
                    }}
                    className="w-full px-3 py-2 rounded-lg border border-line bg-surface text-sm focus:outline-none focus:border-brand appearance-none pr-8"
                  >
                    <optgroup label="Basis-Felder">
                      {SLOT_OPTIONS.filter((s) => s.group === "Kontakt").map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </optgroup>
                    {customFields.length > 0 && (
                      <optgroup label="Deine eigenen Felder">
                        {customFields.map((cf) => (
                          <option key={cf.key} value={"cf:" + cf.key}>
                            {cf.label}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    <optgroup label="Anderes">
                      <option value="new">+ Neues eigenes Feld anlegen</option>
                      <option value="ignore">Nicht importieren</option>
                    </optgroup>
                  </select>
                  {isAuto && (
                    <span
                      className="absolute right-8 top-1/2 -translate-y-1/2 text-ok text-xs font-bold"
                      title="Automatisch erkannt"
                    >
                      ✓
                    </span>
                  )}
                </div>
                {current.slot === "custom" && !current.customKey && (
                  <NewFieldInline
                    initialLabel={current.customLabel ?? h}
                    onCreate={(label, type, key) => {
                      onCustomFieldsChange((prev) =>
                        prev.some((c) => c.key === key)
                          ? prev
                          : [...prev, { key, label, detectedType: type }],
                      );
                      onChange((prev) => ({
                        ...prev,
                        [h]: {
                          slot: "custom",
                          customKey: key,
                          customLabel: label,
                          customType: type,
                        },
                      }));
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Inline-Anlage eines neuen Custom-Feldes im Mapping-Schritt. */
function NewFieldInline({
  initialLabel,
  onCreate,
}: {
  initialLabel: string;
  onCreate: (label: string, type: string, key: string) => void;
}) {
  const { toast } = useToast();
  const [label, setLabel] = React.useState(initialLabel);
  const [type, setType] = React.useState("text");
  const [busy, setBusy] = React.useState(false);

  async function save() {
    if (!label.trim() || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/contact-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), type }),
      });
      const body = await res.json();
      if (res.status === 409 && body?.field) {
        // Feld existiert bereits — trotzdem an das Mapping übergeben.
        onCreate(body.field.label, body.field.detectedType, body.field.key);
        return;
      }
      if (!res.ok) throw new Error(body?.error ?? "Fehler");
      onCreate(body.field.label, body.field.detectedType, body.field.key);
    } catch (err) {
      toastError(toast, err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-lg bg-canvas-deep p-2">
      <div className="text-[10px] font-semibold text-brand-deep uppercase mb-1">
        Neues eigenes Feld
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name (z. B. Priorität)"
          className="flex-1 px-2 py-1 text-xs rounded border border-line bg-surface"
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
          }}
        />
        <select
          value={type}
          onChange={(e) => setType(e.target.value)}
          className="px-1 py-1 text-xs rounded border border-line bg-surface w-20"
        >
          <option value="text">Text</option>
          <option value="email">E-Mail</option>
          <option value="phone">Telefon</option>
          <option value="url">Link</option>
          <option value="number">Zahl</option>
          <option value="date">Datum</option>
        </select>
        <button
          type="button"
          onClick={save}
          disabled={!label.trim() || busy}
          className="px-2 py-1 rounded bg-ink text-white text-xs font-semibold disabled:opacity-50"
        >
          {busy ? "…" : "Anlegen"}
        </button>
      </div>
      <div className="text-[10px] text-ink-muted mt-1">
        Wird für alle Kontakte verfügbar (auch außerhalb dieses Imports).
      </div>
    </div>
  );
}

/** Drag-&-Drop-Zone für CSV/XLSX mit visueller Rückmeldung. */
function DropZone({
  file,
  onFile,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
}) {
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) onFile(f);
  }
  function handleChoose() {
    inputRef.current?.click();
  }

  if (file) {
    const kb = Math.round(file.size / 1024);
    return (
      <div className="flex items-center gap-3 bg-brand-soft rounded-xl p-4 border border-brand/30">
        <FileSpreadsheet className="size-10 text-brand-deep shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold text-ink truncate">{file.name}</div>
          <div className="text-xs text-ink-muted">
            {kb < 1024 ? `${kb} KB` : `${(kb / 1024).toFixed(1)} MB`}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onFile(null)}
          className="text-ink-muted hover:text-danger p-1"
          title="Andere Datei wählen"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={handleChoose}
        className={cn(
          "border-2 border-dashed rounded-xl px-6 py-10 text-center cursor-pointer transition-colors",
          dragOver
            ? "border-brand bg-brand-soft"
            : "border-line bg-canvas hover:border-brand/50 hover:bg-brand-soft/30",
        )}
      >
        <CloudUpload
          className={cn(
            "size-10 mx-auto mb-2",
            dragOver ? "text-brand-deep" : "text-ink-muted",
          )}
        />
        <div className="text-sm font-semibold text-ink">
          Datei hierher ziehen
        </div>
        <div className="text-xs text-ink-muted mt-1">
          oder klicken, um sie auszuwählen · CSV oder Excel (.csv, .xlsx)
        </div>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xlsx,.xls"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
        className="hidden"
      />
    </>
  );
}
