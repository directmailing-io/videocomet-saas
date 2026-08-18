"use client";

import * as React from "react";
import {
  Check,
  Clock,
  Loader2,
  MessageSquare,
  MoreHorizontal,
  Send,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";
import { cn } from "@/lib/utils";

// ── Types ───────────────────────────────────────────────────────────────────

export interface ReviewerComment {
  id: string;
  atSec: number | null;
  atEndSec: number | null;
  authorName: string;
  body: string;
  ownerReply: string | null;
  resolvedAt: string | Date | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface ReviewerVideo {
  campaignId: string;
  campaignName: string;
  videoUrl: string | null;
  posterUrl: string | null;
  durationSec: number | null;
  width: number | null;
  height: number | null;
}

interface ReviewerProps {
  /** Ohne Token wird das Kommentar-Feld ausgeblendet (Owner-Modus). */
  token: string | null;
  video: ReviewerVideo;
  initialComments: ReviewerComment[];
  /** Owner sieht Erledigen/Antworten/Löschen; Guest nicht. */
  mode: "guest" | "owner";
  /** Owner-Callback für resolve/reply/delete. */
  onResolvedChange?: (commentId: string, resolved: boolean) => Promise<void>;
  onReplyChange?: (commentId: string, reply: string | null) => Promise<void>;
  onDelete?: (commentId: string) => Promise<void>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const GUEST_NAME_KEY = "vc_review_name";

function fmtTime(sec: number | null): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "Allgemein";
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m.toString().padStart(2, "0")}:${r.toString().padStart(2, "0")}`;
}

function fmtRange(atSec: number | null, atEndSec: number | null): string {
  if (atSec == null) return "Allgemein";
  if (atEndSec == null) return fmtTime(atSec);
  return `${fmtTime(atSec)} – ${fmtTime(atEndSec)}`;
}

function fmtRelative(when: string | Date): string {
  const d = typeof when === "string" ? new Date(when) : when;
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 45) return "gerade eben";
  if (diff < 3600) return `vor ${Math.round(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.round(diff / 3600)} Std.`;
  return d.toLocaleDateString("de-DE");
}

// ── Component ───────────────────────────────────────────────────────────────

export function FeedbackReviewer({
  token,
  video,
  initialComments,
  mode,
  onResolvedChange,
  onReplyChange,
  onDelete,
}: ReviewerProps) {
  const { toast } = useToast();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [currentSec, setCurrentSec] = React.useState(0);
  const [duration, setDuration] = React.useState<number>(video.durationSec ?? 0);
  const [comments, setComments] = React.useState<ReviewerComment[]>(initialComments);

  // Kommentar-Eingabe
  const [body, setBody] = React.useState("");
  const [attachTime, setAttachTime] = React.useState(true);
  const [rangeMode, setRangeMode] = React.useState<"off" | "picking-end">("off");
  const [rangeStart, setRangeStart] = React.useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = React.useState<number | null>(null);
  const [sending, setSending] = React.useState(false);

  // Guest-Name (localStorage)
  const [guestName, setGuestName] = React.useState<string>("");
  const [askingName, setAskingName] = React.useState(false);
  React.useEffect(() => {
    if (mode !== "guest") return;
    try {
      const stored = window.localStorage.getItem(GUEST_NAME_KEY);
      if (stored) setGuestName(stored);
    } catch {
      /* ignore private-mode */
    }
  }, [mode]);

  // Player-Callbacks
  const onTimeUpdate = React.useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    setCurrentSec(el.currentTime);
  }, []);
  const onLoadedMeta = React.useCallback(() => {
    const el = videoRef.current;
    if (!el) return;
    setDuration(el.duration || video.durationSec || 0);
  }, [video.durationSec]);

  const seekTo = React.useCallback((sec: number) => {
    const el = videoRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(sec, el.duration || sec));
    // Play nicht auto-triggern — der Empfänger entscheidet selbst.
  }, []);

  // Fokus ins Kommentar-Feld → Video pausieren + Timestamp attachen
  const onFocusComment = React.useCallback(() => {
    const el = videoRef.current;
    if (el && !el.paused) el.pause();
  }, []);

  const totalSec = duration || video.durationSec || 0;

  // Timeline-Marker-Positionen (%)
  const positionedComments = React.useMemo(() => {
    if (!totalSec || totalSec <= 0) return [];
    return comments
      .filter((c) => c.atSec != null)
      .map((c) => ({
        c,
        startPct: Math.max(0, Math.min(100, ((c.atSec ?? 0) / totalSec) * 100)),
        widthPct:
          c.atEndSec != null
            ? Math.max(0.6, Math.min(100, (((c.atEndSec ?? 0) - (c.atSec ?? 0)) / totalSec) * 100))
            : null,
      }));
  }, [comments, totalSec]);

  // ── Range-Modus-Aktionen ──────────────────────────────────────────────
  const startRange = React.useCallback(() => {
    setRangeMode("picking-end");
    setRangeStart(currentSec);
    setRangeEnd(null);
    setAttachTime(true);
    toast({
      title: "Startzeit gesetzt",
      description: `Spiele bis zur Endstelle und klicke „Ende setzen".`,
    });
  }, [currentSec, toast]);
  const setRangeEndNow = React.useCallback(() => {
    if (rangeStart == null) return;
    const end = Math.max(rangeStart + 0.1, currentSec);
    setRangeEnd(end);
    setRangeMode("off");
  }, [currentSec, rangeStart]);
  const cancelRange = React.useCallback(() => {
    setRangeMode("off");
    setRangeStart(null);
    setRangeEnd(null);
  }, []);

  // ── Absenden ─────────────────────────────────────────────────────────
  const submit = React.useCallback(async () => {
    if (!token) return; // Owner-Modus
    if (mode === "guest" && !guestName.trim()) {
      setAskingName(true);
      return;
    }
    const text = body.trim();
    if (!text) {
      toast({ title: "Kommentar leer", variant: "danger" });
      return;
    }
    const atSec = attachTime && rangeStart != null ? rangeStart : attachTime ? currentSec : null;
    const atEndSec = attachTime && rangeStart != null ? rangeEnd : null;
    setSending(true);
    try {
      const res = await fetch(`/api/review/${encodeURIComponent(token)}/comments`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          atSec,
          atEndSec,
          authorName: guestName.trim() || "Gast",
          body: text,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Konnte nicht gesendet werden.");
      setComments((prev) => [payload.comment, ...prev]);
      setBody("");
      setRangeMode("off");
      setRangeStart(null);
      setRangeEnd(null);
      toast({ title: "Feedback gesendet", variant: "success" });
    } catch (err) {
      toastError(toast, err);
    } finally {
      setSending(false);
    }
  }, [attachTime, body, currentSec, guestName, mode, rangeEnd, rangeStart, toast, token]);

  const saveGuestName = React.useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setGuestName(trimmed);
      try {
        window.localStorage.setItem(GUEST_NAME_KEY, trimmed);
      } catch {
        /* ignore */
      }
      setAskingName(false);
      // Sende gleich nach Namenseingabe.
      setTimeout(() => void submit(), 0);
    },
    [submit],
  );

  const changeResolved = React.useCallback(
    async (commentId: string, resolved: boolean) => {
      if (!onResolvedChange) return;
      try {
        await onResolvedChange(commentId, resolved);
        setComments((prev) =>
          prev.map((c) =>
            c.id === commentId ? { ...c, resolvedAt: resolved ? new Date().toISOString() : null } : c,
          ),
        );
      } catch (err) {
        toastError(toast, err);
      }
    },
    [onResolvedChange, toast],
  );
  const changeReply = React.useCallback(
    async (commentId: string, reply: string) => {
      if (!onReplyChange) return;
      const clean = reply.trim();
      try {
        await onReplyChange(commentId, clean || null);
        setComments((prev) =>
          prev.map((c) => (c.id === commentId ? { ...c, ownerReply: clean || null } : c)),
        );
      } catch (err) {
        toastError(toast, err);
      }
    },
    [onReplyChange, toast],
  );
  const remove = React.useCallback(
    async (commentId: string) => {
      if (!onDelete) return;
      if (!window.confirm("Diesen Kommentar löschen?")) return;
      try {
        await onDelete(commentId);
        setComments((prev) => prev.filter((c) => c.id !== commentId));
      } catch (err) {
        toastError(toast, err);
      }
    },
    [onDelete, toast],
  );

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-5 sm:py-6">
      <div className="mb-3 sm:mb-4">
        <h1 className="text-xl font-semibold text-ink truncate">{video.campaignName || "Video"}</h1>
        <p className="text-xs text-ink-muted">
          {comments.length} {comments.length === 1 ? "Rückmeldung" : "Rückmeldungen"} bisher.
          {mode === "guest" ? " Klicke auf die Zeitleiste, um zu einer Stelle zu springen." : null}
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Player + Timeline + Kommentar-Feld ─────────────────────── */}
        <div className="space-y-3">
          <div className="relative overflow-hidden rounded-2xl bg-black shadow-sm">
            {video.videoUrl ? (
              <video
                ref={videoRef}
                src={video.videoUrl}
                poster={video.posterUrl ?? undefined}
                controls
                playsInline
                onTimeUpdate={onTimeUpdate}
                onLoadedMetadata={onLoadedMeta}
                className="block h-full w-full max-h-[70vh] object-contain bg-black"
              />
            ) : (
              <div className="aspect-video flex items-center justify-center text-white/60 text-sm">
                Für diese Kampagne wurde noch kein Video hinterlegt.
              </div>
            )}
          </div>

          {/* Timeline-Bar mit Marker */}
          <div className="relative h-8 rounded-full bg-canvas-deep">
            {totalSec > 0 && (
              <div
                className="absolute top-0 bottom-0 rounded-full bg-brand-soft"
                style={{ width: `${Math.min(100, (currentSec / totalSec) * 100)}%` }}
                aria-hidden
              />
            )}
            {positionedComments.map(({ c, startPct, widthPct }) => (
              <button
                key={c.id}
                type="button"
                onClick={() => c.atSec != null && seekTo(c.atSec)}
                title={`${fmtRange(c.atSec, c.atEndSec)} · ${c.authorName}`}
                className={cn(
                  "absolute top-1/2 -translate-y-1/2 rounded-full",
                  widthPct != null
                    ? "h-3 bg-brand/70 hover:bg-brand"
                    : "size-4 bg-brand hover:scale-125 transition-transform",
                  c.resolvedAt ? "opacity-40" : "opacity-100",
                )}
                style={{
                  left: `calc(${startPct}% - ${widthPct != null ? "0" : "0.5rem"})`,
                  width: widthPct != null ? `${widthPct}%` : undefined,
                }}
                aria-label={`Kommentar von ${c.authorName} bei ${fmtRange(c.atSec, c.atEndSec)}`}
              />
            ))}
          </div>

          {/* Kommentar-Eingabe (nur Guest-Mode) */}
          {mode === "guest" && token && (
            <div className="rounded-2xl border border-line bg-surface p-3 shadow-sm">
              {askingName ? (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <div className="flex-1">
                    <label className="text-xs font-semibold text-ink-muted">
                      Wie heißt du?
                    </label>
                    <Input
                      autoFocus
                      placeholder="Dein Name"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") saveGuestName((e.target as HTMLInputElement).value);
                        if (e.key === "Escape") setAskingName(false);
                      }}
                    />
                  </div>
                  <Button
                    variant="brand"
                    onClick={(e) => {
                      const inp = (e.currentTarget.parentElement?.parentElement?.querySelector("input") as HTMLInputElement | null);
                      if (inp) saveGuestName(inp.value);
                    }}
                  >
                    Speichern &amp; senden
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex flex-wrap items-center gap-2 mb-2 text-xs">
                    {attachTime ? (
                      <button
                        type="button"
                        onClick={() => setAttachTime(false)}
                        className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 font-semibold text-brand-deep"
                        title="Klick entfernt den Zeitstempel (Kommentar wird allgemein)"
                      >
                        <Clock className="size-3.5" />
                        {rangeMode === "picking-end"
                          ? `⏳ Bereich ab ${fmtTime(rangeStart)} …`
                          : rangeStart != null && rangeEnd != null
                          ? `⏱ ${fmtTime(rangeStart)} – ${fmtTime(rangeEnd)}`
                          : `⏱ Bei ${fmtTime(currentSec)}`}
                        <X className="size-3" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setAttachTime(true)}
                        className="inline-flex items-center gap-1 rounded-full bg-canvas-deep px-2.5 py-1 font-semibold text-ink-muted hover:text-ink"
                        title="Kommentar mit aktueller Zeit versehen"
                      >
                        <Clock className="size-3.5" />
                        Allgemein
                      </button>
                    )}
                    {attachTime && (rangeMode === "picking-end" ? (
                      <>
                        <Button variant="ghost" onClick={setRangeEndNow} className="h-7 text-xs">
                          Endzeit ({fmtTime(currentSec)}) setzen
                        </Button>
                        <Button variant="ghost" onClick={cancelRange} className="h-7 text-xs">
                          Abbrechen
                        </Button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={rangeStart != null && rangeEnd != null ? cancelRange : startRange}
                        className="inline-flex items-center gap-1 rounded-full bg-canvas-deep px-2.5 py-1 font-semibold text-ink-muted hover:text-ink"
                        title="Feedback zu einem Zeitbereich hinterlassen"
                      >
                        <Timer className="size-3.5" />
                        {rangeStart != null && rangeEnd != null ? "Bereich zurücksetzen" : "Bereich"}
                      </button>
                    ))}
                    {guestName && (
                      <span className="ml-auto text-ink-muted">
                        Als <b className="text-ink">{guestName}</b>
                      </span>
                    )}
                  </div>
                  <Textarea
                    value={body}
                    onFocus={onFocusComment}
                    onChange={(e) => setBody(e.target.value)}
                    onKeyDown={(e) => {
                      if ((e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
                        void submit();
                      }
                    }}
                    rows={3}
                    placeholder="Was möchtest du dem Absender sagen?"
                    className="resize-none"
                  />
                  <div className="mt-2 flex justify-end">
                    <Button
                      variant="brand"
                      disabled={sending || !body.trim()}
                      onClick={() => void submit()}
                      iconLeft={sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                    >
                      {sending ? "Wird gesendet…" : "Feedback senden"}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Kommentar-Liste ─────────────────────────────────────────── */}
        <aside className="space-y-2">
          <div className="flex items-center gap-2">
            <MessageSquare className="size-4 text-ink-muted" />
            <h2 className="text-sm font-semibold text-ink">Alle Rückmeldungen</h2>
            <span className="ml-auto text-[11px] text-ink-muted">{comments.length}</span>
          </div>
          {comments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-4 text-xs text-ink-muted">
              Noch keine Rückmeldungen. Klicke unten ins Kommentar-Feld, um loszulegen.
            </div>
          ) : (
            <ul className="space-y-2">
              {comments
                .slice()
                .sort((a, b) => (a.atSec ?? 1e9) - (b.atSec ?? 1e9))
                .map((c) => (
                  <li
                    key={c.id}
                    className={cn(
                      "rounded-2xl border border-line bg-surface p-3 shadow-sm",
                      c.resolvedAt ? "opacity-70" : "",
                    )}
                  >
                    <div className="flex items-center gap-2 text-xs mb-1">
                      {c.atSec != null ? (
                        <button
                          type="button"
                          onClick={() => seekTo(c.atSec!)}
                          className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-brand-deep hover:bg-brand/20"
                        >
                          <Clock className="size-3" />
                          {fmtRange(c.atSec, c.atEndSec)}
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full bg-canvas-deep px-2 py-0.5 font-semibold text-ink-muted">
                          Allgemein
                        </span>
                      )}
                      <b className="text-ink">{c.authorName}</b>
                      <span className="text-ink-muted">· {fmtRelative(c.createdAt)}</span>
                      {c.resolvedAt && (
                        <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          <Check className="size-3" /> Erledigt
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-ink whitespace-pre-wrap break-words">{c.body}</p>
                    {c.ownerReply && (
                      <div className="mt-2 rounded-xl bg-canvas-deep px-3 py-2 text-xs text-ink">
                        <b className="text-ink-muted">Antwort vom Absender: </b>
                        <span className="whitespace-pre-wrap break-words">{c.ownerReply}</span>
                      </div>
                    )}
                    {mode === "owner" && (
                      <OwnerRow
                        comment={c}
                        onResolve={(res) => void changeResolved(c.id, res)}
                        onReply={(r) => void changeReply(c.id, r)}
                        onDelete={() => void remove(c.id)}
                      />
                    )}
                  </li>
                ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}

function OwnerRow({
  comment,
  onResolve,
  onReply,
  onDelete,
}: {
  comment: ReviewerComment;
  onResolve: (resolved: boolean) => void;
  onReply: (reply: string) => void;
  onDelete: () => void;
}) {
  const [showReply, setShowReply] = React.useState(false);
  const [reply, setReply] = React.useState(comment.ownerReply ?? "");
  const resolved = !!comment.resolvedAt;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
      <Button
        variant={resolved ? "ghost" : "subtle"}
        onClick={() => onResolve(!resolved)}
        iconLeft={<Check className="size-3.5" />}
        className="h-7 text-xs"
      >
        {resolved ? "Wieder öffnen" : "Als erledigt markieren"}
      </Button>
      <Button
        variant="ghost"
        onClick={() => setShowReply((v) => !v)}
        iconLeft={<MoreHorizontal className="size-3.5" />}
        className="h-7 text-xs"
      >
        {comment.ownerReply ? "Antwort bearbeiten" : "Antworten"}
      </Button>
      <Button
        variant="ghost"
        onClick={onDelete}
        iconLeft={<Trash2 className="size-3.5" />}
        className="h-7 text-xs text-danger hover:text-danger"
      >
        Löschen
      </Button>
      {showReply && (
        <div className="mt-2 w-full">
          <Textarea
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={2}
            placeholder="Deine Antwort an den Empfänger…"
            className="resize-none text-sm"
          />
          <div className="mt-1 flex justify-end gap-1">
            <Button variant="ghost" onClick={() => setShowReply(false)} className="h-7 text-xs">
              Abbrechen
            </Button>
            <Button
              variant="brand"
              onClick={() => {
                onReply(reply);
                setShowReply(false);
              }}
              className="h-7 text-xs"
            >
              Speichern
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
