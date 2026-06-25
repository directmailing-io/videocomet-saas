"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ExternalLink,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Trash2,
  ImageOff,
  Lock,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import {
  TYPE_BADGE_CLASS,
  TYPE_LABEL,
  type MediaUrlType,
} from "@/lib/media-urls/detect-type";
import { truncateUrlMiddle } from "@/lib/media-urls/normalize";

export interface UrlCardItem {
  id: string;
  url: string;
  type: MediaUrlType;
  title: string;
  description: string | null;
  previewUrl: string | null;
  previewStatus: "pending" | "ready" | "error" | "private";
  previewGeneratedAt: string | null;
  previewExpiresAt: string | null;
  lastError: string | null;
  createdAt: string;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return "gerade eben";
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} h`;
  const d = Math.floor(h / 24);
  return `vor ${d} Tagen`;
}

function isStale(item: UrlCardItem): boolean {
  if (!item.previewExpiresAt) return false;
  return new Date(item.previewExpiresAt).getTime() < Date.now();
}

export function UrlCard({ item }: { item: UrlCardItem }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);

  // Auto-Refresh wenn Preview noch pending — alle 4s pollen bis ready/error.
  React.useEffect(() => {
    if (item.previewStatus !== "pending") return;
    const timer = setInterval(() => {
      router.refresh();
    }, 4_000);
    return () => clearInterval(timer);
  }, [item.previewStatus, router]);

  async function handleRefresh() {
    setBusy(true);
    try {
      const res = await fetch(`/api/media-urls/${item.id}/refresh-preview`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast({ variant: "success", title: "Vorschau wird aktualisiert" });
      router.refresh();
    } catch (err) {
      toast({
        variant: "danger",
        title: "Refresh fehlgeschlagen",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`Link „${item.title}" wirklich löschen?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/media-urls/${item.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast({ variant: "success", title: "Link gelöscht" });
      router.refresh();
    } catch (err) {
      toast({
        variant: "danger",
        title: "Löschen fehlgeschlagen",
        description: err instanceof Error ? err.message : undefined,
      });
      setBusy(false);
    }
  }

  function handleCopy() {
    void navigator.clipboard.writeText(item.url);
    toast({ variant: "success", title: "URL kopiert" });
  }

  const stale = isStale(item);

  return (
    <Card hover className={cn(busy && "opacity-50 pointer-events-none")}>
      <CardContent className="p-3">
        {/* Preview */}
        <a
          href={item.url}
          target="_blank"
          rel="noopener noreferrer"
          className="block relative aspect-video rounded-squircle-sm bg-surface-muted mb-3 overflow-hidden border border-line group"
          title="In neuem Tab öffnen"
        >
          {item.previewStatus === "ready" && item.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.previewUrl}
              alt={item.title}
              className="w-full h-full object-cover"
            />
          ) : item.previewStatus === "pending" ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-ink-muted text-xs">
              <Loader2 className="size-6 animate-spin" />
              <span>Vorschau wird erstellt …</span>
            </div>
          ) : item.previewStatus === "private" ? (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-ink-muted text-xs px-4 text-center">
              <Lock className="size-6" />
              <span>Privater Link — keine Vorschau möglich</span>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-ink-muted text-xs px-4 text-center">
              <ImageOff className="size-6" />
              <span>Vorschau nicht verfügbar</span>
              {item.lastError ? (
                <span className="text-red-500 text-[10px] line-clamp-2">
                  {item.lastError}
                </span>
              ) : null}
            </div>
          )}
          {/* Hover-Overlay */}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <ExternalLink className="size-6 text-white drop-shadow" />
          </div>
        </a>

        {/* Badge + Title */}
        <div className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={cn(
                "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium",
                TYPE_BADGE_CLASS[item.type],
              )}
            >
              {TYPE_LABEL[item.type]}
            </span>
            {stale && item.previewStatus === "ready" ? (
              <Badge variant="warn" className="text-[10px]">
                Vorschau veraltet
              </Badge>
            ) : null}
          </div>
          <div className="font-medium text-sm truncate" title={item.title}>
            {item.title}
          </div>
          <div className="text-xs text-ink-muted truncate" title={item.url}>
            {truncateUrlMiddle(item.url, 50)}
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-ink-muted">
              {item.previewStatus === "ready"
                ? `Vorschau ${relativeTime(item.previewGeneratedAt)}`
                : item.previewStatus === "pending"
                  ? "wird erstellt …"
                  : ""}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleRefresh}
                className="rounded-md p-1 hover:bg-surface-muted transition-colors"
                title="Vorschau aktualisieren"
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="size-3.5 text-ink-muted" />
                )}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="rounded-md p-1 hover:bg-surface-muted transition-colors"
                    title="Aktionen"
                  >
                    <MoreHorizontal className="size-3.5 text-ink-muted" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={handleCopy}>
                    URL kopieren
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={handleDelete}
                    className="text-red-600"
                  >
                    <Trash2 className="size-3.5 mr-2" />
                    Löschen
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
