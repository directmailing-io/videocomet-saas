"use client";

/**
 * API-Key-Verwaltung + kurze Doku für Zapier/Make (Mini-CRM Etappe 6b).
 */

import * as React from "react";
import { Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { useToast } from "@/components/ui/toaster";

interface ApiKeyRow {
  id: string;
  name: string;
  keyPrefix: string;
  lastUsedAt: string | null;
  usageCount: number;
  createdAt: string;
  revokedAt: string | null;
}

export function ApiKeysPanel() {
  const { toast } = useToast();
  const [keys, setKeys] = React.useState<ApiKeyRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [creating, setCreating] = React.useState(false);
  const [newName, setNewName] = React.useState("");
  const [freshKey, setFreshKey] = React.useState<{ key: string; name: string } | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/api-keys");
      const body = await res.json();
      setKeys(body.keys ?? []);
    } catch (err) {
      toast({
        title: "Keys konnten nicht geladen werden",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  async function createKey() {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch("/api/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler");
      setFreshKey({ key: body.key.key, name: body.key.name });
      setNewName("");
      await load();
    } catch (err) {
      toast({
        title: "Key konnte nicht angelegt werden",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string, name: string) {
    if (!confirm(`Key "${name}" wirklich unwiderruflich sperren?`)) return;
    try {
      const res = await fetch(`/api/api-keys/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Fehler beim Löschen");
      toast({ title: "Key gesperrt" });
      await load();
    } catch (err) {
      toast({
        title: "Konnte nicht gesperrt werden",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
    }
  }

  const activeKeys = keys.filter((k) => !k.revokedAt);

  return (
    <div className="max-w-3xl space-y-6 mt-4">
      {/* Neuer Key */}
      <section className="bg-surface rounded-2xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-ink mb-2">Neuen Key anlegen</h3>
        <p className="text-xs text-ink-muted mb-3">
          Ein sprechender Name hilft dir zu erkennen, welcher Automation dieser Key gehört
          (z.B. „Zapier · Kontaktformular Website").
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            maxLength={60}
            placeholder="z.B. Zapier"
            className="flex-1 px-3 py-2 rounded-lg border border-line bg-canvas text-sm"
          />
          <button
            type="button"
            onClick={createKey}
            disabled={creating || !newName.trim()}
            className="px-4 py-2 rounded-lg bg-ink text-white text-sm font-semibold disabled:opacity-50 hover:bg-brand-deep flex items-center gap-2"
          >
            {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Key erstellen
          </button>
        </div>
      </section>

      {/* Aktive Keys */}
      <section className="bg-surface rounded-2xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-ink mb-3">Deine Keys ({activeKeys.length})</h3>
        {loading ? (
          <div className="text-xs text-ink-muted">
            <Loader2 className="inline size-3 animate-spin mr-1" />
            Lade…
          </div>
        ) : activeKeys.length === 0 ? (
          <p className="text-xs text-ink-muted italic">Noch kein Key angelegt.</p>
        ) : (
          <ul className="space-y-2">
            {activeKeys.map((k) => (
              <li
                key={k.id}
                className="flex items-center gap-3 border border-line rounded-lg px-3 py-2"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-ink">{k.name}</div>
                  <div className="text-[11px] text-ink-muted">
                    <code className="font-mono">{k.keyPrefix}…</code> · Angelegt{" "}
                    {new Date(k.createdAt).toLocaleDateString("de-DE")} ·{" "}
                    {k.lastUsedAt
                      ? `Zuletzt verwendet ${new Date(k.lastUsedAt).toLocaleDateString("de-DE")}`
                      : "Noch nie verwendet"}
                    {" · "}
                    {k.usageCount} Aufruf{k.usageCount === 1 ? "" : "e"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => revoke(k.id, k.name)}
                  className="p-1.5 rounded-lg text-ink-muted hover:text-danger hover:bg-danger-soft"
                  title="Key sperren"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Doku */}
      <section className="bg-surface rounded-2xl p-5 shadow-sm">
        <h3 className="text-sm font-semibold text-ink mb-2">So verwendest du den Key</h3>
        <p className="text-xs text-ink-muted mb-3">
          In Zapier, Make oder n8n legst du eine „Custom HTTP Request"-Aktion an. Als
          Aktion wählst du <strong>POST</strong>, als URL den Endpoint deiner Liste. Im
          Header setzt du <code className="font-mono bg-canvas-deep px-1 rounded">Authorization: Bearer …</code>{" "}
          mit deinem Key.
        </p>
        <pre className="bg-canvas-deep text-ink text-[11px] font-mono p-3 rounded-lg overflow-x-auto">{`POST https://app.videocomet.de/api/v1/lists/{LIST_ID}/contacts
Authorization: Bearer vc_live_...
Content-Type: application/json
Idempotency-Key: {UNIQUE_ID_PRO_LEAD}    // empfohlen, verhindert Doppel-Import

{
  "email": "max@example.de",
  "firstName": "Max",
  "lastName": "Muster",
  "company": "Muster GmbH",
  "phone": "+49...",
  "linkedinUrl": "https://linkedin.com/in/max",
  "customFields": { "quelle": "kontaktformular", "priorität": "A" }
}`}</pre>
        <p className="text-[11px] text-ink-muted mt-3">
          <strong className="text-ink">Rate-Limit:</strong> 60 Anfragen pro Minute pro Key.{" "}
          <strong className="text-ink">Idempotency-Key:</strong> derselbe Key innerhalb von
          24h liefert die gleiche Antwort zurück, statt einen zweiten Kontakt anzulegen.{" "}
          <strong className="text-ink">Auto-Kampagne:</strong> wenn du für die Liste eine
          Kampagne als „Auto-Start" hinterlegt hast, wird für jeden neuen Kontakt automatisch
          ein Video/PDF erzeugt.
        </p>
      </section>

      {/* Fresh-Key Modal */}
      {freshKey && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => setFreshKey(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-surface rounded-2xl p-6 w-full max-w-lg shadow-xl"
          >
            <h3 className="text-lg font-semibold text-ink mb-2">Dein neuer Key</h3>
            <p className="text-xs text-ink-muted mb-4">
              Kopiere den Key jetzt — <strong>er wird nie wieder angezeigt</strong>. Wenn du ihn
              verlierst, sperre ihn hier und leg einen neuen an.
            </p>
            <div className="bg-canvas-deep rounded-lg p-3 mb-4">
              <div className="text-[11px] text-ink-muted mb-1">Name: {freshKey.name}</div>
              <div className="flex items-center gap-2">
                <code className="text-xs font-mono flex-1 break-all">{freshKey.key}</code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(freshKey.key);
                    toast({ title: "In die Zwischenablage kopiert" });
                  }}
                  className="px-2 py-1.5 rounded-lg bg-ink text-white text-xs font-semibold flex items-center gap-1 shrink-0"
                >
                  <Copy className="size-3" />
                  Kopieren
                </button>
              </div>
            </div>
            <div className="text-right">
              <button
                type="button"
                onClick={() => setFreshKey(null)}
                className="px-4 py-2 rounded-lg bg-canvas text-ink text-sm font-semibold hover:bg-canvas-deep"
              >
                Habe ich mir gemerkt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
