"use client";

import * as React from "react";
import { FileSpreadsheet, ListChecks, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";
import { cn } from "@/lib/utils";
import type { WizardState } from "./types";

interface ContactList {
  id: string;
  name: string;
  contactCount: number;
}

export function Step1Source({
  state,
  patch,
  campaignId: _campaignId,
  onNext,
}: {
  state: WizardState;
  patch: (u: Partial<WizardState>) => void;
  campaignId: string;
  onNext: () => void;
}) {
  const { toast } = useToast();
  const [lists, setLists] = React.useState<ContactList[]>([]);
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    if (state.source !== "existing-list") return;
    setLoading(true);
    fetch("/api/contact-lists")
      .then((r) => r.json())
      .then((b) => setLists(b.lists ?? []))
      .catch((err) => toastError(toast, err))
      .finally(() => setLoading(false));
  }, [state.source, toast]);

  return (
    <div className="max-w-3xl">
      <h2 className="text-2xl font-semibold text-ink mb-4">
        Woher kommen die Kontakte für diese Runde?
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => patch({ source: "existing-list", selectedListId: null })}
          className={cn(
            "text-left bg-surface rounded-2xl p-6 shadow-card hover:shadow-lg transition-all border-2",
            state.source === "existing-list" ? "border-brand" : "border-transparent",
          )}
        >
          <div className="size-12 rounded-xl bg-brand-soft flex items-center justify-center text-brand-deep mb-4">
            <ListChecks className="size-6" />
          </div>
          <h3 className="text-base font-semibold text-ink mb-1">Aus einer meiner Listen</h3>
          <p className="text-sm text-ink-muted leading-relaxed">
            Zum Beispiel "Zahnärzte Q4". Kein Upload, kein Mapping.
            Die Kontakte sind schon fertig zugeordnet.
          </p>
        </button>
        <button
          type="button"
          onClick={() => patch({ source: "new-upload", selectedListId: null })}
          className={cn(
            "text-left bg-surface rounded-2xl p-6 shadow-card hover:shadow-lg transition-all border-2",
            state.source === "new-upload" ? "border-brand" : "border-transparent",
          )}
        >
          <div className="size-12 rounded-xl bg-canvas-deep flex items-center justify-center text-ink mb-4">
            <FileSpreadsheet className="size-6" />
          </div>
          <h3 className="text-base font-semibold text-ink mb-1">Neue Kontakte hochladen</h3>
          <p className="text-sm text-ink-muted leading-relaxed">
            CSV, Excel oder Google-Sheet. Wir prüfen Duplikate und
            legen die Kontakte als Contacts an.
          </p>
        </button>
      </div>

      {state.source === "existing-list" && (
        <Card className="mt-4 max-w-2xl">
          <CardHeader>
            <CardTitle>Welche Liste?</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="text-sm text-ink-muted flex items-center gap-2">
                <Loader2 className="size-4 animate-spin" /> Lade deine Listen…
              </div>
            ) : lists.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Du hast noch keine Kontakt-Listen. Wähle „Neue Kontakte hochladen"
                oder leg im Kontakte-Bereich eine Liste an.
              </p>
            ) : (
              <div className="space-y-2">
                {lists.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => patch({ selectedListId: l.id })}
                    className={cn(
                      "w-full text-left px-3 py-2 rounded-lg border transition-colors",
                      state.selectedListId === l.id
                        ? "border-brand bg-brand-soft"
                        : "border-line hover:bg-canvas",
                    )}
                  >
                    <div className="text-sm font-semibold text-ink">{l.name}</div>
                    <div className="text-xs text-ink-muted">
                      {l.contactCount} Kontakt{l.contactCount === 1 ? "" : "e"}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex justify-end mt-6">
        <Button
          variant="brand"
          onClick={onNext}
          disabled={
            !state.source ||
            (state.source === "existing-list" && !state.selectedListId)
          }
        >
          Weiter →
        </Button>
      </div>
    </div>
  );
}
