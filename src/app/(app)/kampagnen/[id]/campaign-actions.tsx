"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Pencil,
  Trash2,
  AlertTriangle,
  Share2,
  MoreVertical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { ShareDialog } from "./share-dialog";

type DeleteStage = "closed" | "stage1" | "stage2";

export interface CampaignActionsProps {
  campaignId: string;
  campaignName: string;
  appUrl: string;
}

export function CampaignActions({
  campaignId,
  campaignName,
  appUrl,
}: CampaignActionsProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [stage, setStage] = React.useState<DeleteStage>("closed");
  const [confirmText, setConfirmText] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const [shareOpen, setShareOpen] = React.useState(false);

  function openDelete() {
    setConfirmText("");
    setStage("stage1");
  }

  function reset() {
    if (deleting) return;
    setStage("closed");
    setConfirmText("");
  }

  async function confirmDelete() {
    if (confirmText !== campaignName) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({
          title: "Löschen fehlgeschlagen",
          description:
            (data as { error?: string }).error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      toast({
        title: "Kampagne gelöscht",
        description: `${campaignName} wurde entfernt.`,
        variant: "success",
      });
      router.push("/kampagnen");
      router.refresh();
    } catch {
      toast({
        title: "Löschen fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <Button
        variant="ghost"
        iconLeft={<Share2 className="size-4" />}
        onClick={() => setShareOpen(true)}
        type="button"
      >
        Teilen
      </Button>
      <Button
        variant="ghost"
        iconLeft={<Pencil className="size-4" />}
        asChild
      >
        <Link href={`/kampagnen/${campaignId}/bearbeiten`}>Bearbeiten</Link>
      </Button>
      {/* Kampagne-Löschen bewusst NICHT als prominenter roter Button:
          direkt neben den Run-Tabs wirkte er wie „Auswahl löschen" und
          hat User erschreckt. Destruktive Kampagnen-Aktion lebt jetzt
          im Overflow-Menü; die zweistufige Bestätigung bleibt. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Weitere Aktionen"
            className="inline-flex size-9 items-center justify-center rounded-full text-ink-muted hover:text-ink hover:bg-line-soft transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/30"
          >
            <MoreVertical className="size-4" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            danger
            onSelect={(e) => {
              e.preventDefault();
              openDelete();
            }}
          >
            <Trash2 className="size-4" />
            Kampagne löschen
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ShareDialog
        campaignId={campaignId}
        campaignName={campaignName}
        appUrl={appUrl}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />

      {/* Stage 1: Warning */}
      <Dialog
        open={stage === "stage1"}
        onOpenChange={(open) => {
          if (!open) reset();
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <div className="flex items-start gap-3">
              <div className="flex size-10 items-center justify-center rounded-squircle-sm bg-danger/10 text-danger shrink-0">
                <AlertTriangle className="size-5" />
              </div>
              <div className="flex-1">
                <DialogTitle>Kampagne löschen?</DialogTitle>
                <DialogDescription className="mt-1">
                  Beim Löschen von{" "}
                  <span className="font-semibold text-ink">{campaignName}</span>{" "}
                  werden alle zugehörigen Daten unwiderruflich entfernt.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <ul className="list-disc pl-5 text-sm text-ink space-y-1.5">
            <li>Alle Runden dieser Kampagne</li>
            <li>Alle Leads dieser Runden</li>
            <li>Alle generierten Videos auf Bunny Stream</li>
            <li>Alle generierten PDFs auf Bunny Storage</li>
          </ul>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={reset}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              type="button"
              onClick={() => setStage("stage2")}
            >
              Weiter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stage 2: Type-confirm */}
      <Dialog
        open={stage === "stage2"}
        onOpenChange={(open) => {
          if (!open) reset();
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Bestätigung erforderlich</DialogTitle>
            <DialogDescription>
              Tippe den Kampagnen-Namen exakt ein, um zu bestätigen:{" "}
              <span className="font-semibold text-ink">{campaignName}</span>
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="campaign-detail-confirm">Kampagnen-Name</Label>
            <Input
              id="campaign-detail-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={campaignName}
              autoComplete="off"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              onClick={reset}
              disabled={deleting}
            >
              Abbrechen
            </Button>
            <Button
              variant="danger"
              type="button"
              disabled={deleting || confirmText !== campaignName}
              loading={deleting}
              onClick={() => {
                void confirmDelete();
              }}
              iconLeft={<Trash2 className="size-4" />}
            >
              Endgültig löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
