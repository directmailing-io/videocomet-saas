"use client";

/**
 * Globale Custom-Feld-Verwaltung (Mini-CRM).
 *
 * Der User pflegt hier zentrale Feld-Definitionen (z.B. "Priorität",
 * "Praxis-Größe"), die für ALLE Kontakte gelten. Neue Felder erscheinen
 * sofort als Spalte in der Tabelle und als Filter-Option.
 */

import * as React from "react";
import { Loader2, Plus, Trash2, X, Pencil } from "lucide-react";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";

interface Field {
  id: string;
  key: string;
  label: string;
  detectedType: string;
  usageCount: number;
}

const TYPE_LABELS: Record<string, string> = {
  text: "Text",
  email: "E-Mail",
  phone: "Telefon",
  url: "Link",
  number: "Zahl",
  date: "Datum",
};

export function FieldsModal({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [fields, setFields] = React.useState<Field[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [newLabel, setNewLabel] = React.useState("");
  const [newType, setNewType] = React.useState("text");
  const [creating, setCreating] = React.useState(false);
  const [editingKey, setEditingKey] = React.useState<string | null>(null);
  const [editLabel, setEditLabel] = React.useState("");

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/contact-fields");
      const body = await res.json();
      setFields(body.fields ?? []);
    } catch (err) {
      toastError(toast, err);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function createField(e: React.FormEvent) {
    e.preventDefault();
    if (!newLabel.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/contact-fields", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim(), type: newType }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler");
      setNewLabel("");
      setNewType("text");
      await load();
      toast({ title: "Feld angelegt" });
    } catch (err) {
      toastError(toast, err);
    } finally {
      setCreating(false);
    }
  }

  async function saveEdit(key: string) {
    if (!editLabel.trim()) {
      setEditingKey(null);
      return;
    }
    try {
      const res = await fetch(`/api/contact-fields/${key}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: editLabel.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler");
      setEditingKey(null);
      await load();
    } catch (err) {
      toastError(toast, err);
    }
  }

  async function deleteField(key: string, label: string) {
    if (
      !confirm(
        `Feld "${label}" löschen? Die Werte in deinen Kontakten bleiben erhalten, aber das Feld verschwindet aus der Tabelle und den Filtern.`,
      )
    )
      return;
    try {
      const res = await fetch(`/api/contact-fields/${key}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Fehler beim Löschen");
      await load();
      toast({ title: "Feld gelöscht" });
    } catch (err) {
      toastError(toast, err);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-surface rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
      >
        <div className="flex items-center justify-between p-5 border-b border-line">
          <div>
            <h3 className="text-lg font-semibold text-ink">Eigene Felder verwalten</h3>
            <p className="text-xs text-ink-muted mt-0.5">
              Diese Felder gelten für alle deine Kontakte. Sie erscheinen als
              Spalte in der Tabelle und stehen im Filter zur Auswahl.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-canvas"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Neues Feld anlegen */}
          <form
            onSubmit={createField}
            className="bg-canvas rounded-xl p-4 border border-line"
          >
            <div className="text-xs font-semibold text-ink mb-2">Neues Feld anlegen</div>
            <div className="flex gap-2 items-end">
              <div className="flex-1">
                <label className="text-[11px] text-ink-muted block mb-1">
                  Name (z. B. Priorität, Praxis-Größe, Quelle)
                </label>
                <input
                  type="text"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  maxLength={60}
                  placeholder="Name des Feldes"
                  className="w-full px-3 py-2 rounded-lg border border-line bg-surface text-sm focus:outline-none focus:border-brand"
                />
              </div>
              <div className="w-28">
                <label className="text-[11px] text-ink-muted block mb-1">Typ</label>
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="w-full px-2 py-2 rounded-lg border border-line bg-surface text-sm"
                >
                  {Object.entries(TYPE_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <button
                type="submit"
                disabled={creating || !newLabel.trim()}
                className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold disabled:opacity-50 hover:bg-brand-deep flex items-center gap-1.5"
              >
                {creating ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Plus className="size-3.5" />
                )}
                Anlegen
              </button>
            </div>
          </form>

          {/* Bestehende Felder */}
          <div>
            <div className="text-xs font-semibold text-ink mb-2">
              Deine Felder ({fields.length})
            </div>
            {loading ? (
              <div className="text-xs text-ink-muted">
                <Loader2 className="size-3 animate-spin inline mr-1" />
                Lade…
              </div>
            ) : fields.length === 0 ? (
              <p className="text-xs text-ink-muted italic">
                Noch keine eigenen Felder. Leg oben eins an oder importiere eine
                Datei, dann werden Custom-Felder automatisch erkannt.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {fields.map((f) => (
                  <li
                    key={f.key}
                    className="flex items-center gap-3 border border-line rounded-lg px-3 py-2"
                  >
                    <div className="flex-1 min-w-0">
                      {editingKey === f.key ? (
                        <input
                          type="text"
                          value={editLabel}
                          onChange={(e) => setEditLabel(e.target.value)}
                          onBlur={() => saveEdit(f.key)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveEdit(f.key);
                            if (e.key === "Escape") setEditingKey(null);
                          }}
                          autoFocus
                          className="text-sm font-semibold text-ink w-full px-1 py-0.5 border border-brand rounded outline-none"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingKey(f.key);
                            setEditLabel(f.label);
                          }}
                          className="text-sm font-semibold text-ink hover:bg-canvas rounded px-1 py-0.5"
                          title="Klicken zum Umbenennen"
                        >
                          {f.label}
                        </button>
                      )}
                      <div className="text-[11px] text-ink-muted">
                        Typ: {TYPE_LABELS[f.detectedType] ?? f.detectedType} · Verwendet in {f.usageCount}{" "}
                        Import{f.usageCount === 1 ? "" : "en"}
                      </div>
                    </div>
                    {editingKey !== f.key && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingKey(f.key);
                          setEditLabel(f.label);
                        }}
                        className="p-1.5 rounded-lg text-ink-muted hover:text-ink hover:bg-canvas"
                        title="Umbenennen"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteField(f.key, f.label)}
                      className="p-1.5 rounded-lg text-ink-muted hover:text-danger hover:bg-danger-soft"
                      title="Löschen"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
