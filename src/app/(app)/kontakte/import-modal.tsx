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

type Step = "upload" | "mapping" | "done";

const SLOT_OPTIONS: Array<{ value: ContactFieldSlot; label: string }> = [
  { value: "email", label: "E-Mail" },
  { value: "firstName", label: "Vorname" },
  { value: "lastName", label: "Nachname" },
  { value: "fullName", label: "Vollständiger Name" },
  { value: "company", label: "Firma" },
  { value: "phone", label: "Telefon" },
  { value: "linkedinUrl", label: "LinkedIn" },
  { value: "custom", label: "Eigenes Feld" },
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
      { slot: ContactFieldSlot; customLabel?: string; customType?: string }
    >
  >({});

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
      for (const s of body.suggested as SuggestedColumn[]) {
        initialMap[s.header] = {
          slot: s.slot,
          customLabel: s.slot === "custom" ? s.header : undefined,
          customType: s.detectedType,
        };
      }
      setMapping(initialMap);
      setStep("mapping");
    } catch (err) {
      toast({
        title: "Datei konnte nicht gelesen werden",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
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
      toast({
        title: "Import fehlgeschlagen",
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
            <div className="space-y-3">
              <div className="text-xs text-ink-muted mb-2">
                Die grüne Empfehlung stammt aus der Auto-Erkennung. Klick auf ein Feld,
                um es zu ändern. Spalten mit „Eigenes Feld" werden als Custom-Feld
                angelegt.
              </div>
              {headers.map((h, i) => (
                <div
                  key={h}
                  className="grid grid-cols-[1fr_180px_1fr] gap-3 items-center border-b border-line pb-2"
                >
                  <div>
                    <div className="text-sm font-semibold text-ink">{h}</div>
                    <div className="text-[11px] text-ink-muted truncate">
                      z. B.: {preview.slice(0, 3).map((r) => r[i]).filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <select
                    value={mapping[h]?.slot ?? "custom"}
                    onChange={(e) =>
                      setMapping((prev) => ({
                        ...prev,
                        [h]: { ...prev[h], slot: e.target.value as ContactFieldSlot },
                      }))
                    }
                    className="px-2 py-1.5 rounded-lg border border-line bg-canvas text-sm"
                  >
                    {SLOT_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  {mapping[h]?.slot === "custom" ? (
                    <input
                      type="text"
                      value={mapping[h]?.customLabel ?? h}
                      onChange={(e) =>
                        setMapping((prev) => ({
                          ...prev,
                          [h]: { ...prev[h], customLabel: e.target.value },
                        }))
                      }
                      placeholder="Anzeige-Name"
                      className="px-2 py-1.5 rounded-lg border border-line bg-canvas text-sm"
                    />
                  ) : (
                    <span className="text-xs text-ink-muted italic">
                      Basis-Feld
                    </span>
                  )}
                </div>
              ))}
            </div>
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
