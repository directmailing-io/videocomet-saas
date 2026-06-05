"use client";

/**
 * MediaCard — Card-Render + Inline-Rename + Delete für ein Media-Item.
 *
 * Client-Component, weil Rename + Delete State + Toast + Router.refresh
 * brauchen. Die Server-Page reicht die rohen Daten als Props rein.
 *
 * UX:
 *   - Rename startet als Inline-Input (replace name in-place), Enter speichert,
 *     Esc verwirft. Während Submit: disabled + Spinner-Icon.
 *   - Delete fragt nach Confirmation (window.confirm). Optimistic ist nicht
 *     nötig — wir refreshen die Page nach success.
 *   - Optimistic: nach erfolgreichem Rename wird der lokale Name sofort
 *     gezeigt, plus router.refresh() für die Server-Wahrheit.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Eye,
  FileVideo,
  Film,
  Image as ImageIcon,
  Loader2,
  MoreHorizontal,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";
import { pickBunnyMp4Fallback } from "@/lib/bunny/mp4-fallback";

export interface MediaCardItem {
  id: string;
  type: "webcam" | "image" | "video" | "logo";
  name: string;
  publicUrl: string;
  durationSec: number | null;
  bytes: number | null;
  createdAt: string;
}

function formatBytes(bytes: number | null): string {
  if (!bytes) return "0 KB";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function formatDuration(sec: number | null): string | null {
  if (!sec || sec <= 0) return null;
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function typeIcon(type: string) {
  if (type === "image") return <ImageIcon className="size-6 text-ink-muted" />;
  if (type === "video") return <Film className="size-6 text-ink-muted" />;
  if (type === "logo") return <ImageIcon className="size-6 text-ink-muted" />;
  return <FileVideo className="size-6 text-ink-muted" />;
}

function isHlsUrl(url: string): boolean {
  return /\/playlist\.m3u8(\?|$)/i.test(url);
}

export function MediaCard({ item }: { item: MediaCardItem }) {
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = React.useState(item.name);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(item.name);
  const [submitting, setSubmitting] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Lazily-fetched playback URL für Videos/Webcams. Server entscheidet:
  //   - embed=true → Bunny iframe-Player-URL (Stream-Videos, Token-Auth-frei)
  //   - embed=false + url=signed → token-auth-signierte HLS-URL
  //   - embed=false + url=original → Bunny Storage URL (Webcam-Recording)
  const [playbackUrl, setPlaybackUrl] = React.useState<string | null>(null);
  const [isEmbed, setIsEmbed] = React.useState(false);
  const isPlayable = item.type === "video" || item.type === "webcam";
  React.useEffect(() => {
    if (!isPlayable) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/media/${encodeURIComponent(item.id)}/signed-url`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { url?: string; embed?: boolean };
        if (!cancelled && typeof body.url === "string" && body.url.length > 0) {
          setPlaybackUrl(body.url);
          setIsEmbed(Boolean(body.embed));
        }
      } catch {
        if (!cancelled) {
          setPlaybackUrl(item.publicUrl);
          setIsEmbed(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPlayable, item.id, item.publicUrl]);

  // Bei embed=false: <video> bekommt entweder MP4-Fallback (HLS) oder URL roh.
  // Bei embed=true: <iframe> mit Bunny-Player.
  // HLS-Playlist → progressive MP4-Fallback. Native <video> kann HLS nur in
  // Safari; alle anderen Browser brauchen den progressiven `play_<res>.mp4`.
  // Client-Side haben wir hier KEINE availableResolutions verfügbar — der
  // Helper fällt deshalb intern auf den safe-default `play_480p.mp4` zurück
  // (existiert für JEDES Bunny-Stream-Video, anders als 720p).
  const videoSrc =
    playbackUrl && !isEmbed
      ? isHlsUrl(playbackUrl)
        ? pickBunnyMp4Fallback(playbackUrl)
        : playbackUrl
      : null;

  // Wenn die Server-Wahrheit neu hereinkommt (z.B. nach router.refresh nach
  // Submit eines Gast-Videos), den lokalen State synchron halten.
  React.useEffect(() => {
    setName(item.name);
    setDraft(item.name);
  }, [item.name]);

  React.useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [editing]);

  async function saveRename() {
    const next = draft.trim();
    if (!next) {
      toast({ variant: "danger", title: "Name darf nicht leer sein." });
      return;
    }
    if (next === name) {
      setEditing(false);
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: next }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      setName(next);
      setEditing(false);
      toast({ variant: "success", title: "Umbenannt." });
      router.refresh();
    } catch (err) {
      toast({
        variant: "danger",
        title: "Umbenennen fehlgeschlagen",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSubmitting(false);
    }
  }

  function cancelRename() {
    setDraft(name);
    setEditing(false);
  }

  async function handleDelete() {
    if (!window.confirm(`„${name}" wirklich löschen?`)) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/media/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast({ variant: "success", title: "Gelöscht." });
      router.refresh();
    } catch (err) {
      toast({
        variant: "danger",
        title: "Löschen fehlgeschlagen",
        description: err instanceof Error ? err.message : undefined,
      });
      setDeleting(false);
    }
  }

  return (
    <Card hover className={cn(deleting && "opacity-50 pointer-events-none")}>
      <CardContent className="p-3">
        <div className="relative aspect-square rounded-squircle-sm bg-surface-muted mb-3 flex items-center justify-center overflow-hidden">
          {item.type === "image" || item.type === "logo" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.publicUrl}
              alt={name}
              className="w-full h-full object-cover"
            />
          ) : item.type === "video" || item.type === "webcam" ? (
            <>
              {isEmbed && playbackUrl ? (
                <iframe
                  src={playbackUrl}
                  allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture"
                  allowFullScreen
                  className="w-full h-full bg-black border-0"
                  title={name}
                />
              ) : videoSrc ? (
                <video
                  src={videoSrc}
                  controls
                  preload="metadata"
                  playsInline
                  className="w-full h-full object-cover bg-black"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center bg-black">
                  <Loader2 className="size-5 text-white/60 animate-spin" />
                </div>
              )}
              {formatDuration(item.durationSec) && (
                <span className="pointer-events-none absolute top-2 right-2 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-semibold text-white tabular-nums">
                  {formatDuration(item.durationSec)}
                </span>
              )}
            </>
          ) : (
            typeIcon(item.type)
          )}
        </div>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            {editing ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveRename();
                }}
              >
                <input
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.preventDefault();
                      cancelRename();
                    }
                  }}
                  onBlur={() => {
                    // Verzögert speichern, damit Klick auf Cancel-Button im
                    // Dropdown noch zugestellt wird — pragmatisch: blur = save.
                    void saveRename();
                  }}
                  disabled={submitting}
                  maxLength={200}
                  className="w-full rounded-squircle-sm border border-brand bg-surface px-2 py-1 text-sm font-semibold text-ink focus:outline-none focus:ring-2 focus:ring-brand/30"
                  aria-label="Neuer Name"
                />
                <p className="text-[11px] text-ink-muted mt-1">
                  Enter speichert, Esc verwirft.
                </p>
              </form>
            ) : (
              <>
                <p
                  className="text-sm font-semibold text-ink truncate"
                  title={name}
                >
                  {name}
                </p>
                <p className="text-xs text-ink-muted">
                  {formatBytes(item.bytes)} · {formatDate(item.createdAt)}
                </p>
              </>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="inline-flex size-7 items-center justify-center rounded-full hover:bg-line-soft transition-colors"
                aria-label="Aktionen"
                disabled={editing || submitting || deleting}
              >
                {submitting ? (
                  <Loader2 className="size-4 text-ink-muted animate-spin" />
                ) : (
                  <MoreHorizontal className="size-4 text-ink-muted" />
                )}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setEditing(true)}>
                <Pencil className="size-4 text-ink-muted" />
                Umbenennen
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a
                  href={playbackUrl ?? item.publicUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Eye className="size-4 text-ink-muted" />
                  Vorschau
                </a>
              </DropdownMenuItem>
              <DropdownMenuItem danger onSelect={() => void handleDelete()}>
                <Trash2 className="size-4" />
                Löschen
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardContent>
    </Card>
  );
}
