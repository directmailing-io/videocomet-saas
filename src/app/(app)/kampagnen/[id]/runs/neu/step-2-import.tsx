"use client";

/**
 * Step 2: Kontakte importieren (Upload + Column-Mapping + Duplikat-Check).
 *
 * Ablauf innerhalb dieses Screens:
 *   a) Datei hochladen (Drag&Drop) → parseId + Header + Preview
 *   b) Column-Mapping: für jede CSV-Spalte wähle ich Kontakt-Feld oder
 *      "+ Neues Feld anlegen" oder "Nicht importieren"
 *   c) "In Liste speichern"-Toggle (Default an)
 *   d) "Import + Duplikat-Check starten" → Server macht bulkImportContacts
 *      und liefert Dedupe-Ergebnis für die neu angelegten Kontakte
 *   e) Duplikat-Panel: Kacheln + Detail-Tabelle für previously-contacted
 */

import * as React from "react";
import { CloudUpload, FileSpreadsheet, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";
import { cn } from "@/lib/utils";
import type { ContactFieldSlot } from "@/lib/contacts/detect-field";
import type { WizardState, PerRowDecision } from "./types";

type Phase = "upload" | "mapping" | "importing" | "dedupe";

interface CustomFieldDef {
  key: string;
  label: string;
  detectedType: string;
}

const SLOT_OPTIONS: Array<{ value: ContactFieldSlot | "ignore"; label: string; group: "Person" | "Kontakt" | "Firma" | "Adresse" | "Anderes" }> = [
  // Person
  { value: "salutation", label: "Anrede", group: "Person" },
  { value: "title", label: "Titel", group: "Person" },
  { value: "firstName", label: "Vorname", group: "Person" },
  { value: "lastName", label: "Nachname", group: "Person" },
  { value: "fullName", label: "Vollständiger Name", group: "Person" },
  { value: "gender", label: "Geschlecht", group: "Person" },
  { value: "externalId", label: "ID (externe Kunden-Nr.)", group: "Person" },
  // Kontakt
  { value: "email", label: "E-Mail", group: "Kontakt" },
  { value: "phone", label: "Telefon", group: "Kontakt" },
  { value: "website", label: "Website", group: "Kontakt" },
  { value: "linkedinUrl", label: "LinkedIn", group: "Kontakt" },
  // Firma
  { value: "company", label: "Firma", group: "Firma" },
  { value: "position", label: "Position", group: "Firma" },
  // Adresse
  { value: "street", label: "Straße", group: "Adresse" },
  { value: "postalCode", label: "PLZ", group: "Adresse" },
  { value: "city", label: "Ort", group: "Adresse" },
  { value: "country", label: "Land", group: "Adresse" },
  // Anderes
  { value: "custom", label: "+ Neues eigenes Feld", group: "Anderes" },
  { value: "ignore", label: "Nicht importieren", group: "Anderes" },
];

export function Step2Import({
  state,
  patch,
  onBack,
  onNext,
}: {
  state: WizardState;
  patch: (u: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const { toast } = useToast();
  const [phase, setPhase] = React.useState<Phase>(state.parseId ? "mapping" : "upload");
  const [file, setFile] = React.useState<File | null>(null);
  const [sheetUrl, setSheetUrl] = React.useState("");
  const [dragOver, setDragOver] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [customFields, setCustomFields] = React.useState<CustomFieldDef[]>([]);

  React.useEffect(() => {
    void fetch("/api/contact-fields")
      .then((r) => r.json())
      .then((b) => setCustomFields(b.fields ?? []))
      .catch(() => {});
  }, []);

  async function upload() {
    // Wir brauchen erst eine Ziel-Liste (auto anlegen wenn nicht vorhanden)
    let listId = state.targetListId;
    if (state.saveToListEnabled && !listId) {
      const listName = state.targetListName.trim() ||
        `Import ${new Date().toLocaleDateString("de-DE")}`;
      try {
        const res = await fetch("/api/contact-lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: listName }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error);
        listId = body.list.id;
        patch({ targetListId: listId, targetListName: listName });
      } catch (err) {
        toastError(toast, err);
        return;
      }
    }
    if (!listId) {
      // Fallback: temp-Liste damit der Import-Endpoint einen Zielrahmen hat.
      try {
        const listName = `Runden-Import ${Date.now()}`;
        const res = await fetch("/api/contact-lists", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: listName }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error);
        listId = body.list.id;
        patch({ targetListId: listId, targetListName: listName });
      } catch (err) {
        toastError(toast, err);
        return;
      }
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
      toast({ title: "Bitte Datei wählen oder Google-Sheets-Link angeben.", variant: "danger" });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch(`/api/contact-lists/${listId}/import`, {
        method: "POST",
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error);
      // Auto-Mapping vorschlagen
      const columnMapping: WizardState["columnMapping"] = {};
      for (const s of (body.suggested ?? []) as Array<{
        header: string;
        slot: ContactFieldSlot;
        detectedType: string;
      }>) {
        // Bestehende Custom-Felder auto-matchen
        const norm = (v: string) => v.toLowerCase().replace(/[_\s-]+/g, "");
        const existing = customFields.find(
          (cf) => norm(cf.label) === norm(s.header),
        );
        if (existing && s.slot === "custom") {
          columnMapping[s.header] = {
            slot: "custom",
            customKey: existing.key,
            customLabel: existing.label,
            customType: existing.detectedType,
          };
        } else {
          columnMapping[s.header] = {
            slot: s.slot,
            customLabel: s.slot === "custom" ? s.header : undefined,
            customType: s.detectedType,
          };
        }
      }
      patch({
        parseId: body.parseId,
        headers: body.headers,
        previewRows: body.previewRows ?? [],
        totalRows: body.totalRows ?? 0,
        columnMapping,
      });
      setPhase("mapping");
    } catch (err) {
      toastError(toast, err);
    } finally {
      setBusy(false);
    }
  }

  async function applyImport() {
    if (!state.parseId || !state.targetListId) return;
    setBusy(true);
    setPhase("importing");
    try {
      // 1. Import ausführen (Contacts anlegen + Liste befüllen)
      const applyRes = await fetch(
        `/api/contact-lists/${state.targetListId}/import/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            parseId: state.parseId,
            mapping: state.columnMapping,
          }),
        },
      );
      const applyBody = await applyRes.json();
      if (!applyRes.ok) throw new Error(applyBody?.error);

      // 2. Duplikat-Check über die parsed Rows (aus der Preview)
      // Hierfür brauchen wir die vollständigen Rows — wir nutzen die
      // headers + mapping, um Rows in Contact-Objekte zu übersetzen.
      const rowsForDedupe = state.previewRows.map((row, idx) => {
        const contact: {
          email?: string;
          firstName?: string;
          lastName?: string;
          phone?: string;
        } = {};
        state.headers.forEach((h, i) => {
          const m = state.columnMapping[h];
          if (!m || m.slot === "ignore") return;
          const val = (row[i] ?? "").trim();
          if (!val) return;
          if (m.slot === "email") contact.email = val;
          else if (m.slot === "firstName") contact.firstName = val;
          else if (m.slot === "lastName") contact.lastName = val;
          else if (m.slot === "phone") contact.phone = val;
          else if (m.slot === "fullName") {
            const parts = val.split(/\s+/);
            contact.firstName = parts[0];
            if (parts.length > 1) contact.lastName = parts.slice(1).join(" ");
          }
        });
        return { ...contact, _idx: idx };
      });

      const dedupeRes = await fetch("/api/contacts/dedupe-check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rowsForDedupe,
          primaryKey: state.primaryKey,
          contactedWithinDays: state.contactedWithinDays,
        }),
      });
      const dedupeBody = await dedupeRes.json();
      if (!dedupeRes.ok) throw new Error(dedupeBody?.error);

      patch({ dedupeResults: dedupeBody.results });
      toast({
        title: `${applyBody.created} neu · ${applyBody.updated} ergänzt`,
      });
      setPhase("dedupe");
    } catch (err) {
      toastError(toast, err);
      setPhase("mapping");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-4xl">
      {phase === "upload" && (
        <>
          <h2 className="text-2xl font-semibold text-ink mb-2">Wo sind deine Kontakte?</h2>
          <p className="text-sm text-ink-muted mb-5">
            CSV, Excel oder Google-Sheet. Wir lesen die Datei, du sagst uns im nächsten Schritt,
            welche Spalten wohin gehören.
          </p>
          <DropZone
            file={file}
            onFile={setFile}
            dragOver={dragOver}
            setDragOver={setDragOver}
          />
          <details className="mt-4 group">
            <summary className="text-xs text-ink-muted cursor-pointer hover:text-ink flex items-center gap-1">
              <FileSpreadsheet className="size-3.5" />
              Alternativ: Google-Sheets-Link verwenden
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

          <div className="mt-6 p-4 bg-canvas rounded-xl">
            <label className="flex items-center gap-2 text-sm text-ink mb-2">
              <input
                type="checkbox"
                checked={state.saveToListEnabled}
                onChange={(e) => patch({ saveToListEnabled: e.target.checked })}
              />
              Kontakte auch in einer Liste speichern (für spätere Runden)
            </label>
            {state.saveToListEnabled && (
              <input
                type="text"
                placeholder="z. B. Zahnärzte Q4 2026"
                value={state.targetListName}
                onChange={(e) => patch({ targetListName: e.target.value })}
                className="mt-2 w-full px-3 py-2 rounded-lg border border-line bg-white text-sm"
              />
            )}
          </div>

          <div className="flex justify-between mt-6">
            <Button variant="ghost" onClick={onBack}>← Zurück</Button>
            <Button
              variant="brand"
              onClick={upload}
              disabled={busy || (!file && !sheetUrl)}
              iconLeft={busy ? <Loader2 className="size-3.5 animate-spin" /> : undefined}
            >
              Datei einlesen
            </Button>
          </div>
        </>
      )}

      {phase === "mapping" && (
        <>
          <h2 className="text-2xl font-semibold text-ink mb-2">
            Was steckt in deiner Datei? · {state.totalRows} Zeilen
          </h2>
          <p className="text-sm text-ink-muted mb-5">
            Für jede Spalte wähle rechts, wohin sie soll. Neue Felder werden global angelegt.
          </p>
          <div className="rounded-xl border border-line overflow-hidden bg-surface">
            {state.headers.map((h, i) => {
              const current = state.columnMapping[h] ?? { slot: "custom" as const };
              const samples = state.previewRows
                .slice(0, 3)
                .map((r) => r[i])
                .filter((v) => v && v.trim().length > 0);
              const selectValue =
                current.slot === "custom" && current.customKey
                  ? "cf:" + current.customKey
                  : current.slot;
              return (
                <div
                  key={h}
                  className={cn(
                    "grid grid-cols-[1fr_280px] gap-4 items-start px-4 py-3 border-b border-line last:border-b-0",
                    current.slot === "ignore" && "opacity-60 bg-canvas",
                  )}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-ink truncate">{h}</div>
                    <div className="text-[11px] text-ink-muted truncate">
                      {samples.length > 0 ? samples.join(" · ") : "(leere Spalte)"}
                    </div>
                  </div>
                  <div>
                    <select
                      value={selectValue}
                      onChange={(e) => {
                        const v = e.target.value;
                        const next = { ...state.columnMapping };
                        if (v.startsWith("cf:")) {
                          const key = v.slice(3);
                          const cf = customFields.find((c) => c.key === key);
                          next[h] = {
                            slot: "custom",
                            customKey: key,
                            customLabel: cf?.label ?? key,
                            customType: cf?.detectedType,
                          };
                        } else if (v === "custom") {
                          next[h] = {
                            slot: "custom",
                            customLabel: h,
                            customType: "text",
                          };
                        } else {
                          next[h] = { slot: v as never };
                        }
                        patch({ columnMapping: next });
                      }}
                      className="w-full px-3 py-2 rounded-lg border border-line bg-surface text-sm"
                    >
                      {(["Person", "Kontakt", "Firma", "Adresse"] as const).map((g) => (
                        <optgroup key={g} label={g}>
                          {SLOT_OPTIONS.filter((s) => s.group === g).map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </optgroup>
                      ))}
                      {customFields.length > 0 && (
                        <optgroup label="Deine eigenen Felder">
                          {customFields.map((cf) => (
                            <option key={cf.key} value={"cf:" + cf.key}>{cf.label}</option>
                          ))}
                        </optgroup>
                      )}
                      <optgroup label="Anderes">
                        <option value="custom">+ Neues eigenes Feld anlegen</option>
                        <option value="ignore">Nicht importieren</option>
                      </optgroup>
                    </select>
                    {current.slot === "custom" && !current.customKey && (
                      <input
                        type="text"
                        value={current.customLabel ?? h}
                        onChange={(e) => {
                          const next = { ...state.columnMapping };
                          next[h] = { ...current, customLabel: e.target.value };
                          patch({ columnMapping: next });
                        }}
                        placeholder="Name des neuen Feldes"
                        className="w-full mt-1.5 px-3 py-1.5 rounded-lg border border-line bg-canvas text-xs"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="flex justify-between mt-6">
            <Button variant="ghost" onClick={() => setPhase("upload")}>← Andere Datei</Button>
            <Button
              variant="brand"
              onClick={applyImport}
              disabled={busy}
              iconLeft={busy ? <Loader2 className="size-3.5 animate-spin" /> : undefined}
            >
              Kontakte anlegen und Duplikate prüfen
            </Button>
          </div>
        </>
      )}

      {phase === "dedupe" && state.dedupeResults && (
        <DedupeReview state={state} patch={patch} onBack={() => setPhase("mapping")} onNext={onNext} />
      )}
    </div>
  );
}

/* ── Sub-Komponenten ─────────────────────────────────────────────────── */

function DropZone({
  file,
  onFile,
  dragOver,
  setDragOver,
}: {
  file: File | null;
  onFile: (f: File | null) => void;
  dragOver: boolean;
  setDragOver: (v: boolean) => void;
}) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);
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
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "border-2 border-dashed rounded-xl px-6 py-14 text-center cursor-pointer transition-colors",
          dragOver
            ? "border-brand bg-brand-soft"
            : "border-line bg-canvas hover:border-brand/50 hover:bg-brand-soft/30",
        )}
      >
        <CloudUpload
          className={cn(
            "size-12 mx-auto mb-3",
            dragOver ? "text-brand-deep" : "text-ink-muted",
          )}
        />
        <div className="text-sm font-semibold text-ink">Datei hierher ziehen</div>
        <div className="text-xs text-ink-muted mt-1">
          oder klicken · CSV oder Excel (.csv, .xlsx)
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

function DedupeReview({
  state,
  patch,
  onBack,
  onNext,
}: {
  state: WizardState;
  patch: (u: Partial<WizardState>) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const results = state.dedupeResults!;
  const inBatch = results.filter((r) => r.status === "in-batch").length;
  const existing = results.filter((r) => r.status === "existing-contact").length;
  const previous = results.filter((r) => r.status === "previously-contacted");
  const previousCount = previous.length;
  const fresh = results.filter((r) => r.status === "fresh").length;

  function setDecision(contactId: string, decision: PerRowDecision) {
    patch({ dedupeDecisions: { ...state.dedupeDecisions, [contactId]: decision } });
  }
  function setAllDecisions(decision: PerRowDecision) {
    const decisions = { ...state.dedupeDecisions };
    for (const r of previous) {
      if (r.matchedContactId) decisions[r.matchedContactId] = decision;
    }
    patch({ dedupeDecisions: decisions });
  }

  const skipCount = previous.filter((r) => r.matchedContactId && state.dedupeDecisions[r.matchedContactId] === "skip").length;
  const undecidedCount = previous.filter((r) => r.matchedContactId && !state.dedupeDecisions[r.matchedContactId]).length;

  return (
    <>
      <h2 className="text-2xl font-semibold text-ink mb-2">Deine Kontakte sind da.</h2>
      <p className="text-sm text-ink-muted mb-5">
        Wir haben {results.length} Zeilen geprüft. Ergebnis:
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <StatCard label="Frisch" n={fresh} tone="ok" />
        <StatCard label="Doppelt in Datei" n={inBatch} tone="muted" hint="Automatisch zusammengeführt" />
        <StatCard label="Schon bei dir" n={existing} tone="info" hint="Daten ergänzt, nicht doppelt" />
        <StatCard label="Kürzlich angeschrieben" n={previousCount} tone="warn" hint="Du entscheidest unten" />
      </div>

      {previousCount > 0 && (
        <div className="bg-warn-soft rounded-xl p-4 border border-warn/20">
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <h3 className="text-sm font-semibold text-warn">Diese {previousCount} Kontakte hatten schon was von dir bekommen</h3>
            <div className="ml-auto flex gap-2">
              <button
                type="button"
                onClick={() => setAllDecisions("skip")}
                className="text-xs font-semibold px-3 py-1 bg-white text-warn border border-warn rounded-md hover:bg-warn-soft"
              >
                Alle überspringen
              </button>
              <button
                type="button"
                onClick={() => setAllDecisions("keep")}
                className="text-xs font-semibold px-3 py-1 bg-white text-ok border border-ok rounded-md hover:bg-ok-soft"
              >
                Alle übernehmen
              </button>
            </div>
          </div>
          <table className="w-full text-xs bg-white rounded-lg overflow-hidden">
            <thead>
              <tr className="text-[10px] text-ink-muted uppercase tracking-wide">
                <th className="text-left px-3 py-2">Kontakt</th>
                <th className="text-left px-3 py-2">Wo</th>
                <th className="text-left px-3 py-2">Wann</th>
                <th className="text-right px-3 py-2">Was tun?</th>
              </tr>
            </thead>
            <tbody>
              {previous.map((r) => {
                const decision = r.matchedContactId
                  ? state.dedupeDecisions[r.matchedContactId]
                  : undefined;
                const activity = r.previousActivities?.[0];
                const daysAgo = activity
                  ? Math.round(
                      (Date.now() - new Date(activity.sentAt).getTime()) / 86400_000,
                    )
                  : 0;
                return (
                  <tr key={r.rowIndex} className="border-t border-line">
                    <td className="px-3 py-2 font-semibold text-ink">
                      {r.existingSnippet?.firstName} {r.existingSnippet?.lastName}
                      <br />
                      <span className="text-[10px] text-ink-muted font-normal">
                        {r.existingSnippet?.email}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      {activity ? `${activity.campaignName} · ${activity.runName}` : ""}
                    </td>
                    <td className="px-3 py-2 text-ink-muted">
                      {activity && `vor ${daysAgo} Tagen`}
                      {activity && (
                        <>
                          <br />
                          <span className="text-[10px]">
                            ({new Date(activity.sentAt).toLocaleDateString("de-DE")})
                          </span>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => r.matchedContactId && setDecision(r.matchedContactId, "skip")}
                        className={cn(
                          "text-[10px] font-semibold px-2 py-1 rounded border mr-1",
                          decision === "skip"
                            ? "bg-warn text-white border-warn"
                            : "border-line text-ink-muted hover:border-warn hover:text-warn",
                        )}
                      >
                        Skip
                      </button>
                      <button
                        type="button"
                        onClick={() => r.matchedContactId && setDecision(r.matchedContactId, "keep")}
                        className={cn(
                          "text-[10px] font-semibold px-2 py-1 rounded border",
                          decision === "keep"
                            ? "bg-ok text-white border-ok"
                            : "border-line text-ink-muted hover:border-ok hover:text-ok",
                        )}
                      >
                        Übernehmen
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {undecidedCount > 0 && (
            <p className="text-xs text-warn mt-2 font-semibold">
              {undecidedCount} Kontakt{undecidedCount === 1 ? "" : "e"} noch ohne Entscheidung. Wähle „Skip" oder „Übernehmen" oben.
            </p>
          )}
        </div>
      )}

      <div className="mt-4 text-xs text-ink-muted">
        Wir prüfen Duplikate anhand:{" "}
        <select
          value={state.primaryKey}
          onChange={(e) => patch({ primaryKey: e.target.value as WizardState["primaryKey"] })}
          className="text-brand-deep font-semibold bg-transparent border-b border-line outline-none"
        >
          <option value="email">E-Mail</option>
          <option value="email_name">E-Mail + Name</option>
          <option value="phone">Telefon</option>
        </select>
      </div>

      <div className="flex justify-between mt-6">
        <Button variant="ghost" onClick={onBack}>← Andere Datei</Button>
        <Button
          variant="brand"
          onClick={onNext}
          disabled={undecidedCount > 0}
        >
          Weiter zu den Optionen →
        </Button>
      </div>
    </>
  );
}

function StatCard({
  label,
  n,
  tone,
  hint,
}: {
  label: string;
  n: number;
  tone: "ok" | "muted" | "info" | "warn";
  hint?: string;
}) {
  const toneClass =
    tone === "ok" ? "bg-ok-soft text-ok" :
    tone === "info" ? "bg-info-soft text-info" :
    tone === "warn" ? "bg-warn-soft text-warn" :
    "bg-canvas text-ink-muted";
  return (
    <div className={cn("rounded-xl p-3", toneClass)}>
      <div className="text-2xl font-bold tabular-nums">{n}</div>
      <div className="text-[11px] font-semibold uppercase tracking-wide mt-1">{label}</div>
      {hint && <div className="text-[10px] mt-1 opacity-80">{hint}</div>}
    </div>
  );
}
