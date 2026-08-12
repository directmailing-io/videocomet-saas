"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MoreHorizontal, Pencil, Copy, Trash2, AlertTriangle } from "lucide-react";
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
  introEnabled: boolean;
  pdfEnabled: boolean;
}

const BG_COUNT = 13;

/**
 * Deterministischer Background pro Kampagne — gleicher Wert für dieselbe
 * ID über alle Reloads/Devices, sodass User ihre Kampagnen visuell wiedererkennen.
 * Kleiner FNV-1a-artiger Hash reicht.
 */
function pickBackground(id: string): string {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = (h * 16777619) >>> 0;
  }
  const idx = (h % BG_COUNT) + 1;
  return `/campaign-bgs/bg${idx}.jpg`;
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

  const [renameTarget, setRenameTarget] = React.useState<KampagnenListItem | null>(null);
  const [renameValue, setRenameValue] = React.useState("");
  const [renameSaving, setRenameSaving] = React.useState(false);

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

  function openRename(item: KampagnenListItem) {
    setRenameTarget(item);
    setRenameValue(item.name);
  }

  function closeRename() {
    if (renameSaving) return;
    setRenameTarget(null);
    setRenameValue("");
  }

  async function confirmRename() {
    if (!renameTarget) return;
    const next = renameValue.trim();
    if (next.length === 0 || next.length > 120 || next === renameTarget.name) return;
    setRenameSaving(true);
    try {
      const res = await fetch(`/api/campaigns/${renameTarget.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast({
          title: "Umbenennen fehlgeschlagen",
          description: (data as { error?: string }).error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      toast({ title: "Kampagne umbenannt.", variant: "success" });
      setRenameTarget(null);
      setRenameValue("");
      router.refresh();
    } catch {
      toast({
        title: "Umbenennen fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    } finally {
      setRenameSaving(false);
    }
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
        {items.map((c) => (
          <CampaignCard
            key={c.id}
            item={c}
            pending={pending === c.id}
            onRename={() => openRename(c)}
            onDelete={() => openDelete(c)}
          />
        ))}
      </div>

      {/* Rename Dialog */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeRename();
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Kampagne umbenennen</DialogTitle>
            <DialogDescription>
              Gib der Kampagne einen neuen Namen. Runden, Leads und Videos
              bleiben unverändert.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="campaign-rename">Kampagnen-Name</Label>
            <Input
              id="campaign-rename"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={120}
              autoComplete="off"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void confirmRename();
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              onClick={closeRename}
              disabled={renameSaving}
            >
              Abbrechen
            </Button>
            <Button
              type="button"
              disabled={
                renameSaving ||
                !renameTarget ||
                renameValue.trim().length === 0 ||
                renameValue.trim().length > 120 ||
                renameValue.trim() === renameTarget?.name
              }
              loading={renameSaving}
              onClick={() => {
                void confirmRename();
              }}
            >
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function PlusIcon() {
  // Perfekt zentriertes „+" via SVG — Font-Baseline würde hier immer leicht daneben sitzen.
  return (
    <span className="inline-flex size-[15px] shrink-0 items-center justify-center rounded-full bg-white ring-1 ring-ink/[0.08]">
      <svg viewBox="0 0 12 12" width="8" height="8" fill="none" aria-hidden>
        <path
          d="M6 1v10M1 6h10"
          stroke="#1c1633"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

function CampaignCard({
  item,
  pending,
  onRename,
  onDelete,
}: {
  item: KampagnenListItem;
  pending: boolean;
  onRename: () => void;
  onDelete: () => void;
}) {
  const bg = React.useMemo(() => pickBackground(item.id), [item.id]);
  const hasPresentation = item.mode === "with-presentation";
  const hasIntro = item.introEnabled;
  const hasBrief = item.pdfEnabled;

  return (
    <div
      className={
        "relative rounded-[28px] bg-[#f8f7fd] p-[18px_18px_20px] shadow-[0_6px_24px_-12px_rgba(60,40,130,0.12)] transition-[transform,box-shadow] duration-200 hover:-translate-y-[3px] hover:shadow-[0_12px_32px_-12px_rgba(60,40,130,0.18)]" +
        (pending ? " opacity-60 pointer-events-none" : "")
      }
    >
      {/* Klickfläche für's Öffnen */}
      <Link
        href={`/kampagnen/${item.id}`}
        className="absolute inset-0 z-0 rounded-[28px]"
        aria-label={`${item.name} öffnen`}
      />

      {/* Dropdown-Menü */}
      <div className="absolute right-2.5 top-2.5 z-20">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="inline-flex size-[30px] items-center justify-center rounded-[10px] bg-white/85 text-ink backdrop-blur-md hover:bg-white"
              aria-label="Kampagnen-Aktionen"
            >
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                onRename();
              }}
            >
              <Pencil className="size-4 text-ink-muted" />
              Umbenennen
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href={`/kampagnen/${item.id}/bearbeiten`}>
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
                onDelete();
              }}
            >
              <Trash2 className="size-4" />
              Löschen
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Farbiger Cover mit Namens-Tile */}
      <div
        className="relative flex aspect-[16/10] items-center justify-center overflow-hidden rounded-[18px] bg-cover bg-center p-4"
        style={{ backgroundImage: `url('${bg}')` }}
      >
        <div className="absolute inset-0 bg-gradient-to-b from-transparent to-black/10" />
        <div className="relative z-10 max-w-[90%] rounded-[14px] bg-white/95 px-[18px] py-[10px] text-center shadow-[0_6px_20px_-6px_rgba(0,0,0,0.18)] backdrop-blur-md">
          <div className="line-clamp-2 text-[15px] font-bold leading-tight tracking-[-0.015em] text-ink">
            {item.name}
          </div>
        </div>
      </div>

      {/* Metadaten */}
      <div className="pointer-events-none relative z-10 mt-[14px] px-1 text-center">
        <div className="mb-3 flex items-center justify-center gap-2.5">
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold uppercase tracking-[0.08em] text-ink-muted">
            <span
              className="size-2 rounded-full bg-emerald-500 ring-[3px] ring-emerald-500/20"
              aria-hidden
            />
            Aktiv
          </span>
          <span className="text-[12px] font-medium text-ink-muted">
            <span className="mr-2 text-ink-muted">·</span>
            {item.runCount} {item.runCount === 1 ? "Runde" : "Runden"}
          </span>
        </div>
        <div className="flex flex-nowrap items-center justify-center gap-[5px] overflow-hidden">
          <span className="inline-flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full bg-brand-soft px-2.5 py-[3px] text-[10.5px] font-semibold leading-[1.3] text-brand-deep">
            <span>Video</span>
            {hasIntro ? (
              <>
                <PlusIcon />
                <span
                  style={{
                    backgroundImage:
                      "linear-gradient(92deg, #7C5CE8 0%, #B14AE0 45%, #EC4899 100%)",
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    color: "transparent",
                  }}
                  className="font-bold"
                >
                  KI-Begrüßung
                </span>
              </>
            ) : null}
            {hasPresentation ? (
              <>
                <PlusIcon />
                <span>Präsentation</span>
              </>
            ) : null}
          </span>
          {hasBrief ? (
            <span className="inline-flex flex-shrink-0 items-center rounded-full bg-ink/[0.06] px-2.5 py-[3px] text-[10.5px] font-semibold text-ink-soft">
              Brief
            </span>
          ) : null}
        </div>
        <div className="mt-2 text-[11px] text-ink-muted">
          Erstellt am {formatDate(item.createdAt)}
        </div>
      </div>
    </div>
  );
}
