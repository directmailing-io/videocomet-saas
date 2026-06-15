"use client";

import * as React from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";

interface ResetTrackingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runId: string | null;
  runName: string | null;
  onSuccess?: () => void;
}

/**
 * Bestätigungs-Dialog für das harte Zurücksetzen aller Tracking-Daten einer
 * Runde. Sendet `POST /api/runs/[id]/reset-tracking`.
 *
 * `runId` / `runName` sind nullable, damit der Parent den Dialog auch ohne
 * gerade ausgewählte Runde montieren kann (z.B. während einer
 * router.refresh()-Reseed-Tick).
 */
export function ResetTrackingDialog({
  open,
  onOpenChange,
  runId,
  runName,
  onSuccess,
}: ResetTrackingDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);

  async function handleConfirm() {
    if (!runId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/runs/${runId}/reset-tracking`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        toast({
          title: "Zurücksetzen fehlgeschlagen",
          description: data.error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      const data = (await res.json().catch(() => ({}))) as {
        leadsReset?: number;
      };
      const leadsReset = data.leadsReset ?? 0;
      toast({
        title: "Tracking zurückgesetzt",
        description: `${leadsReset} Lead${leadsReset === 1 ? "" : "s"} geleert`,
        variant: "success",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch {
      toast({
        title: "Zurücksetzen fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (loading) return;
        onOpenChange(next);
      }}
    >
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Tracking zurücksetzen?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-3 text-sm text-ink-muted">
              <p>
                Diese Aktion löscht alle erfassten Tracking-Daten für die Runde{" "}
                <span className="font-semibold text-ink">
                  &bdquo;{runName ?? ""}&ldquo;
                </span>
                :
              </p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Aufrufe, Plays, Watch-Zeit, CTA-Klicks zurück auf 0</li>
                <li>Lead-Events und Analytics-Events werden gelöscht</li>
                <li>In Share-Links wird Live-Tracking + Engagement geleert</li>
              </ul>
              <p>
                Pipeline-Ergebnisse (PDFs, Videos, Landingpages) bleiben
                unverändert. Aktion kann nicht rückgängig gemacht werden.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Abbrechen
          </Button>
          <Button
            variant="danger"
            type="button"
            onClick={() => void handleConfirm()}
            loading={loading}
            iconLeft={<RotateCcw className="size-4" />}
          >
            Zurücksetzen
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
