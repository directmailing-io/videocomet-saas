"use client";

/**
 * Quelle-Wähler für den Runden-Wizard.
 *
 * Wird VOR Schritt 1 (Adressliste hochladen) gezeigt. Zwei Karten:
 *   (a) "Neue Adressliste hochladen" → weiter im bestehenden Wizard
 *   (b) "Aus bestehender Kontakt-Liste"  → List-Picker + Direktstart
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, ListChecks, Loader2, Users2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";

interface ContactList {
  id: string;
  name: string;
  contactCount: number;
}

export function SourcePicker({
  campaignId,
  onUseUpload,
}: {
  campaignId: string;
  onUseUpload: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();

  const [pickList, setPickList] = React.useState(false);
  const [lists, setLists] = React.useState<ContactList[]>([]);
  const [selectedListId, setSelectedListId] = React.useState<string>("");
  const [runName, setRunName] = React.useState(
    `Runde ${new Date().toLocaleDateString("de-DE")}`,
  );
  const [loading, setLoading] = React.useState(false);
  const [starting, setStarting] = React.useState(false);

  React.useEffect(() => {
    if (!pickList) return;
    setLoading(true);
    fetch("/api/contact-lists")
      .then((r) => r.json())
      .then((b) => {
        const items = (b.lists ?? []) as ContactList[];
        setLists(items);
        if (items[0]) setSelectedListId(items[0].id);
      })
      .catch(() => {
        toast({ title: "Listen konnten nicht geladen werden", variant: "danger" });
      })
      .finally(() => setLoading(false));
  }, [pickList, toast]);

  async function startFromList() {
    if (!selectedListId) return;
    setStarting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/runs/from-list`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ listId: selectedListId, name: runName.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? "Fehler beim Starten");
      toast({ title: `Runde gestartet — ${body.leadCount} Kontakte in Arbeit` });
      router.push(`/kampagnen/${campaignId}/runs/${body.runId}`);
    } catch (err) {
      toast({
        title: "Runde konnte nicht gestartet werden",
        description: err instanceof Error ? err.message : String(err),
        variant: "danger",
      });
      setStarting(false);
    }
  }

  if (!pickList) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
        <button
          type="button"
          onClick={() => setPickList(true)}
          className="text-left bg-surface rounded-2xl p-6 shadow-card hover:shadow-lg hover:border-brand border-2 border-transparent transition-all"
        >
          <div className="size-12 rounded-xl bg-brand-soft flex items-center justify-center text-brand-deep mb-4">
            <ListChecks className="size-6" />
          </div>
          <h3 className="text-base font-semibold text-ink mb-1">
            Aus bestehender Liste
          </h3>
          <p className="text-sm text-ink-muted leading-relaxed">
            Nutze eine deiner Kontakt-Listen (z. B. „Zahnärzte Q4"). Kein
            Datei-Upload — die Kontakte sind schon fertig zugeordnet und mit
            allen Feldern versehen.
          </p>
        </button>
        <button
          type="button"
          onClick={onUseUpload}
          className="text-left bg-surface rounded-2xl p-6 shadow-card hover:shadow-lg hover:border-brand border-2 border-transparent transition-all"
        >
          <div className="size-12 rounded-xl bg-canvas-deep flex items-center justify-center text-ink mb-4">
            <FileSpreadsheet className="size-6" />
          </div>
          <h3 className="text-base font-semibold text-ink mb-1">
            Neue Adressliste hochladen
          </h3>
          <p className="text-sm text-ink-muted leading-relaxed">
            CSV, Excel oder Google-Sheet. Wir konsolidieren die Kontakte
            automatisch und du kannst sie später als Liste speichern.
          </p>
        </button>
      </div>
    );
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle>Aus bestehender Kontakt-Liste starten</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Loader2 className="size-4 animate-spin" />
            Lade deine Listen…
          </div>
        ) : lists.length === 0 ? (
          <div>
            <p className="text-sm text-ink-muted mb-3">
              Du hast noch keine Kontakt-Listen. Leg im{" "}
              <a href="/kontakte" className="text-brand-deep font-semibold">
                Kontakte-Bereich
              </a>{" "}
              eine Liste an oder wähle „Neue Adressliste hochladen".
            </p>
            <Button variant="ghost" onClick={() => setPickList(false)}>
              Zurück
            </Button>
          </div>
        ) : (
          <>
            <div>
              <label className="text-xs font-semibold text-ink mb-1 block">
                Kontakt-Liste
              </label>
              <select
                value={selectedListId}
                onChange={(e) => setSelectedListId(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-line bg-canvas text-sm focus:outline-none focus:border-brand"
              >
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} · {l.contactCount} Kontakt
                    {l.contactCount === 1 ? "" : "e"}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-semibold text-ink mb-1 block">
                Name der Runde
              </label>
              <input
                type="text"
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                maxLength={120}
                className="w-full px-3 py-2.5 rounded-xl border border-line bg-canvas text-sm"
              />
            </div>
            <div className="rounded-xl bg-canvas-deep p-3 text-xs text-ink-muted flex gap-2 items-start">
              <Users2 className="size-4 text-brand-deep shrink-0 mt-0.5" />
              <div>
                Für jeden Kontakt in der Liste wird ein Video (und, falls in
                der Kampagne aktiviert, ein PDF-Brief) erstellt. Fortschritt
                siehst du live in der Runde.
              </div>
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="ghost" onClick={() => setPickList(false)}>
                Zurück
              </Button>
              <Button
                variant="brand"
                onClick={startFromList}
                disabled={starting || !selectedListId}
                iconLeft={starting ? <Loader2 className="size-3.5 animate-spin" /> : undefined}
              >
                {starting ? "Startet…" : "Runde starten"}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
