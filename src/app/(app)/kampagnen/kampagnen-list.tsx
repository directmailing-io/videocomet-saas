"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Copy, Trash2, AlertTriangle } from "lucide-react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
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

export interface KampagnenListItem {
  id: string;
  name: string;
  mode: string;
  createdAt: Date | string | null;
  runCount: number;
}

function modeLabel(mode: string): string {
  if (mode === "with-presentation") return "Mit Präsentation";
  return "Nur Webcam";
}

function formatDate(d: Date | string | null): string {
  if (!d) return "";
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(d));
  } catch {
    return "";
  }
}

type DeleteStage = "closed" | "stage1" | "stage2";

export function KampagnenList({ items }: { items: KampagnenListItem[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, setPending] = React.useState<string | null>(null);
  const [stage, setStage] = React.useState<DeleteStage>("closed");
  const [target, setTarget] = React.useState<KampagnenListItem | null>(null);
  const [confirmText, setConfirmText] = React.useState("");

  function openDelete(item: KampagnenListItem) {
    setTarget(item);
    setConfirmText("");
    setStage("stage1");
  }

  function closeDelete() {
    if (pending) return;
    setStage("closed");
    setConfirmText("");
    setTarget(null);
  }

  async function confirmDelete() {
    if (!target) return;
    if (confirmText !== target.name) return;
    setPending(target.id);
    try {
      const res = await fetch(`/api/campaigns/${target.id}`, {
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
        description: `${target.name} wurde entfernt.`,
        variant: "success",
      });
      setStage("closed");
      setConfirmText("");
      setTarget(null);
      router.refresh();
    } catch {
      toast({
        title: "Löschen fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {items.map((c) => {
          const isPending = pending === c.id;
          return (
            <Card
              key={c.id}
              hover
              className={
                "relative overflow-visible" +
                (isPending ? " opacity-60 pointer-events-none" : "")
              }
            >
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="truncate">{c.name}</CardTitle>
                    <CardDescription className="mt-1">
                      Erstellt am {formatDate(c.createdAt)}
                    </CardDescription>
                  </div>
                  <div className="relative z-20">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="inline-flex size-8 items-center justify-center rounded-full hover:bg-line-soft transition-colors"
                          aria-label="Kampagnen-Aktionen"
                        >
                          <MoreHorizontal className="size-4 text-ink-muted" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/kampagnen/${c.id}/bearbeiten`}>
                            <Pencil className="size-4 text-ink-muted" />
                            Bearbeiten
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem disabled>
                          <Copy className="size-4 text-ink-muted" />
                          Duplizieren
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          danger
                          onSelect={(e) => {
                            e.preventDefault();
                            openDelete(c);
                          }}
                        >
                          <Trash2 className="size-4" />
                          Löschen
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Link
                  href={`/kampagnen/${c.id}`}
                  className="absolute inset-0 z-0 rounded-squircle-md"
                  aria-label={`${c.name} öffnen`}
                />
                <div className="relative z-10 flex items-center gap-2 flex-wrap pointer-events-none">
                  <Badge variant="brand">{modeLabel(c.mode)}</Badge>
                  <Badge variant="neutral">
                    {c.runCount} {c.runCount === 1 ? "Runde" : "Runden"}
                  </Badge>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Stage 1: Warning */}
      <Dialog
        open={stage === "stage1"}
        onOpenChange={(open) => {
          if (!open) closeDelete();
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
                  <span className="font-semibold text-ink">{target?.name}</span>{" "}
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
            <Button variant="ghost" type="button" onClick={closeDelete}>
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

      {/* Stage 2: Type name */}
      <Dialog
        open={stage === "stage2"}
        onOpenChange={(open) => {
          if (!open) closeDelete();
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Bestätigung erforderlich</DialogTitle>
            <DialogDescription>
              Tippe den Kampagnen-Namen exakt ein, um zu bestätigen:{" "}
              <span className="font-semibold text-ink">{target?.name}</span>
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="campaign-confirm">Kampagnen-Name</Label>
            <Input
              id="campaign-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={target?.name ?? ""}
              autoComplete="off"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              onClick={closeDelete}
              disabled={Boolean(pending)}
            >
              Abbrechen
            </Button>
            <Button
              variant="danger"
              type="button"
              disabled={
                Boolean(pending) ||
                !target ||
                confirmText !== target.name
              }
              loading={Boolean(pending)}
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
