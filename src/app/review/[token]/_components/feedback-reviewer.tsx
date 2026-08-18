"use client";

import * as React from "react";
import {
  Check,
  Clock,
  Loader2,
  Mail,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  Send,
  Timer,
  Trash2,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "@/components/ui/logo";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";
import { cn } from "@/lib/utils";
import { PreviewPlayer } from "@/components/editor/preview-player";
import type { Segment } from "@/lib/segments/types";

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
  mode: "webcam-only" | "with-presentation";
  segments: unknown | null;
  pipPosition: "bottom-left" | "bottom-right";
  pipShape: "square" | "rounded" | "circle";
}

interface ReviewerProps {
  /** Ohne Token wird das Kommentar-Feld ausgeblendet (Owner-Modus). */
  token: string | null;
  video: ReviewerVideo;
  initialComments: ReviewerComment[];
  /** Owner sieht Erledigen/Antworten/Löschen; Guest nur seine eigenen. */
  mode: "guest" | "owner";
  /** Owner-Name (für "Antwort von {name}") — nur im owner-Modus verwendet. */
  ownerName?: string;
  onResolvedChange?: (commentId: string, resolved: boolean) => Promise<void>;
  onReplyChange?: (commentId: string, reply: string | null) => Promise<void>;
  onDelete?: (commentId: string) => Promise<void>;
}

// ── LocalStorage-Keys ───────────────────────────────────────────────────────

const KEY_NAME = "vc_review_name";
const KEY_EMAIL = "vc_review_email";
const keySession = (token: string) => `vc_review_session_${token}`;
const keyOwn = (token: string) => `vc_review_own_${token}`;

function readOwnIds(token: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(keyOwn(token));
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch {
    return new Set();
  }
}
function writeOwnIds(token: string, ids: Set<string>): void {
  try {
    window.localStorage.setItem(keyOwn(token), JSON.stringify(Array.from(ids)));
  } catch {
    /* ignore */
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function safeUuid(): string {
  try {
    const c = (globalThis as unknown as { crypto?: { randomUUID?: () => string } }).crypto;
    if (c?.randomUUID) return c.randomUUID();
  } catch {
    /* ignore */
  }
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}-${Math.random().toString(16).slice(2, 10)}`;
}

// ── Component ───────────────────────────────────────────────────────────────

export function FeedbackReviewer({
  token,
  video,
  initialComments,
  mode,
  ownerName,
  onResolvedChange,
  onReplyChange,
  onDelete,
}: ReviewerProps) {
  const { toast } = useToast();
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const [currentSec, setCurrentSec] = React.useState(0);
  const [duration, setDuration] = React.useState<number>(video.durationSec ?? 0);
  const [comments, setComments] = React.useState<ReviewerComment[]>(initialComments);

  // Seek/Pause an den PreviewPlayer.
  const [seekRequest, setSeekRequest] = React.useState<{ ms: number; nonce: number } | null>(null);
  const [pauseRequest, setPauseRequest] = React.useState<{ nonce: number } | null>(null);
  const seekNonceRef = React.useRef(0);
  const pauseNonceRef = React.useRef(0);

  const usePresentation =
    video.mode === "with-presentation" &&
    Array.isArray(video.segments) &&
    (video.segments as unknown[]).length > 0;
  const segmentList = usePresentation ? ((video.segments as Segment[]) ?? []) : [];

  // Guest-Identität aus LocalStorage.
  const [guestName, setGuestName] = React.useState<string>("");
  const [guestEmail, setGuestEmail] = React.useState<string>("");
  const [sessionId, setSessionId] = React.useState<string>("");
  const [identityReady, setIdentityReady] = React.useState(mode === "owner");
  const [ownIds, setOwnIds] = React.useState<Set<string>>(new Set());
  React.useEffect(() => {
    if (mode !== "guest") return;
    try {
      const n = window.localStorage.getItem(KEY_NAME) ?? "";
      const e = window.localStorage.getItem(KEY_EMAIL) ?? "";
      setGuestName(n);
      setGuestEmail(e);
      if (n) setIdentityReady(true);
      if (token) {
        const sk = keySession(token);
        let s = window.localStorage.getItem(sk);
        if (!s) {
          s = safeUuid();
          window.localStorage.setItem(sk, s);
        }
        setSessionId(s);
        setOwnIds(readOwnIds(token));
      }
    } catch {
      /* private mode */
    }
  }, [mode, token]);

  // Player-Callbacks (nur für native-video-Modus).
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

  const seekTo = React.useCallback(
    (sec: number) => {
      if (usePresentation) {
        seekNonceRef.current += 1;
        setSeekRequest({ ms: Math.max(0, sec) * 1000, nonce: seekNonceRef.current });
        return;
      }
      const el = videoRef.current;
      if (!el) return;
      el.currentTime = Math.max(0, Math.min(sec, el.duration || sec));
    },
    [usePresentation],
  );

  const onFocusComment = React.useCallback(() => {
    if (usePresentation) {
      pauseNonceRef.current += 1;
      setPauseRequest({ nonce: pauseNonceRef.current });
      return;
    }
    const el = videoRef.current;
    if (el && !el.paused) el.pause();
  }, [usePresentation]);

  // Kommentar-Formular
  const [body, setBody] = React.useState("");
  const [attachTime, setAttachTime] = React.useState(true);
  const [rangeMode, setRangeMode] = React.useState<"off" | "picking-end">("off");
  const [rangeStart, setRangeStart] = React.useState<number | null>(null);
  const [rangeEnd, setRangeEnd] = React.useState<number | null>(null);
  const [sending, setSending] = React.useState(false);

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

  const submit = React.useCallback(async () => {
    if (!token) return;
    const name = guestName.trim() || "Gast";
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
        body: JSON.stringify({ atSec, atEndSec, authorName: name, body: text, sessionId }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Konnte nicht gesendet werden.");
      setComments((prev) => [payload.comment, ...prev]);
      if (token && payload?.comment?.id) {
        const next = new Set(ownIds);
        next.add(payload.comment.id as string);
        setOwnIds(next);
        writeOwnIds(token, next);
      }
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
  }, [attachTime, body, currentSec, guestName, rangeEnd, rangeStart, sessionId, toast, token]);

  // Owner-Actions weiterreichen
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
  const removeByOwner = React.useCallback(
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

  // Guest-Actions: eigene Kommentare bearbeiten/löschen
  const guestUpdate = React.useCallback(
    async (commentId: string, newBody: string) => {
      if (!token || !sessionId) return;
      const clean = newBody.trim();
      if (!clean) {
        toast({ title: "Kommentar leer", variant: "danger" });
        return;
      }
      const res = await fetch(
        `/api/review/${encodeURIComponent(token)}/comments/${encodeURIComponent(commentId)}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: clean, sessionId }),
        },
      );
      const p = await res.json().catch(() => null);
      if (!res.ok) throw new Error(p?.error ?? "Konnte nicht speichern.");
      setComments((prev) =>
        prev.map((c) => (c.id === commentId ? { ...c, body: clean } : c)),
      );
    },
    [sessionId, toast, token],
  );
  const guestDelete = React.useCallback(
    async (commentId: string) => {
      if (!token || !sessionId) return;
      if (!window.confirm("Diesen Kommentar löschen?")) return;
      const res = await fetch(
        `/api/review/${encodeURIComponent(token)}/comments/${encodeURIComponent(commentId)}`,
        {
          method: "DELETE",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sessionId }),
        },
      );
      if (!res.ok) {
        const p = await res.json().catch(() => null);
        toast({ title: p?.error ?? "Konnte nicht löschen.", variant: "danger" });
        return;
      }
      setComments((prev) => prev.filter((c) => c.id !== commentId));
      if (token) {
        const next = new Set(ownIds);
        next.delete(commentId);
        setOwnIds(next);
        writeOwnIds(token, next);
      }
    },
    [ownIds, sessionId, toast, token],
  );

  // ── Vollbild-Namens-Prompt (Guest, vor Betreten) ────────────────────────
  if (mode === "guest" && !identityReady) {
    return (
      <IdentityScreen
        campaignName={video.campaignName}
        onSubmit={(name, email) => {
          try {
            window.localStorage.setItem(KEY_NAME, name);
            if (email) window.localStorage.setItem(KEY_EMAIL, email);
            else window.localStorage.removeItem(KEY_EMAIL);
          } catch {
            /* ignore */
          }
          setGuestName(name);
          setGuestEmail(email);
          setIdentityReady(true);
        }}
      />
    );
  }

  // ── Haupt-Reviewer ──────────────────────────────────────────────────────
  const isGuest = mode === "guest";
  return (
    <div className={cn("mx-auto w-full max-w-5xl", isGuest ? "px-4 pt-8 pb-12 sm:px-6" : "px-0")}>
      {/* Zentrierter Kopf — nur im Guest-Modus (Owner sieht den Reviewer im Tab). */}
      {isGuest && (
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="scale-[1.6] origin-top mb-2">
            <Logo />
          </div>
          <span className="mt-3 text-[13px] font-semibold uppercase tracking-[0.22em] text-brand-deep">
            Feedback-Session
          </span>
          <div className="mt-4 h-px w-16 bg-line/80" aria-hidden />
          <h1 className="mt-6 text-3xl sm:text-4xl font-semibold text-ink truncate max-w-full">
            {video.campaignName || "Video"}
          </h1>
          {guestName && (
            <p className="mt-1 text-sm text-ink-muted">
              <b className="text-ink">{guestEmail || guestName}</b>
              {guestEmail && (
                <>
                  {" "}
                  <span className="text-ink-muted">({guestName})</span>
                </>
              )}
            </p>
          )}
        </div>
      )}

      {/* Player groß mittig */}
      <div className="mx-auto w-full">
        <div className="relative overflow-hidden rounded-2xl bg-surface shadow-[0_20px_60px_rgba(30,25,60,0.10),0_4px_16px_rgba(30,25,60,0.06)]">
          {usePresentation ? (
            <PreviewPlayer
              segments={segmentList}
              webcamUrl={video.videoUrl}
              webcamDurationSec={video.durationSec}
              pipPosition={video.pipPosition}
              pipShape={video.pipShape}
              onTimeChange={(ms) => setCurrentSec(ms / 1000)}
              seekRequest={seekRequest}
              pauseRequest={pauseRequest}
              stageBgClassName="bg-canvas-deep"
              maxStageWidthClassName="max-w-none"
            />
          ) : video.videoUrl ? (
            <video
              ref={videoRef}
              src={video.videoUrl}
              poster={video.posterUrl ?? undefined}
              controls
              playsInline
              onTimeUpdate={onTimeUpdate}
              onLoadedMetadata={onLoadedMeta}
              className="block h-full w-full max-h-[68vh] object-contain bg-black"
            />
          ) : (
            <div className="aspect-video flex items-center justify-center text-ink-muted text-sm">
              Für diese Kampagne wurde noch kein Video hinterlegt.
            </div>
          )}
        </div>
      </div>

      {/* Stacked: Eingabe volle Breite (nur Guest), Liste darunter. */}
      <div className="mt-6 grid gap-4 grid-cols-1">
        {/* Eingabe (nur Guest) */}
        {mode === "guest" && token ? (
          <div className="rounded-2xl bg-surface p-4 shadow-[0_4px_20px_rgba(30,25,60,0.06),0_1px_3px_rgba(30,25,60,0.04)]">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              {attachTime ? (
                <button
                  type="button"
                  onClick={() => setAttachTime(false)}
                  className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2.5 py-1 font-semibold text-brand-deep"
                  title="Klick entfernt den Zeitstempel (Kommentar wird allgemein)"
                >
                  <Clock className="size-3.5" />
                  {rangeMode === "picking-end"
                    ? `Bereich ab ${fmtTime(rangeStart)} …`
                    : rangeStart != null && rangeEnd != null
                    ? `${fmtTime(rangeStart)} – ${fmtTime(rangeEnd)}`
                    : `Bei ${fmtTime(currentSec)}`}
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
              {attachTime &&
                (rangeMode === "picking-end" ? (
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
            </div>
            <Textarea
              value={body}
              onFocus={onFocusComment}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
              }}
              rows={4}
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
          </div>
        ) : null}

        {/* Kommentar-Liste */}
        <div>
          <div className="mb-2 flex items-center gap-2">
            <MessageSquare className="size-4 text-ink-muted" />
            <h2 className="text-sm font-semibold text-ink">Alle Rückmeldungen</h2>
            <span className="ml-auto text-[11px] text-ink-muted">{comments.length}</span>
          </div>
          {comments.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-line bg-surface p-4 text-xs text-ink-muted">
              Noch keine Rückmeldungen. Klicke links ins Kommentar-Feld, um loszulegen.
            </div>
          ) : (
            <ul className="space-y-3">
              {comments
                .slice()
                .sort((a, b) => (a.atSec ?? 1e9) - (b.atSec ?? 1e9))
                .map((c) => (
                  <CommentCard
                    key={c.id}
                    comment={c}
                    ownerName={ownerName}
                    mode={mode}
                    isOwnedByGuest={mode === "guest" && !!sessionId && ownIds.has(c.id)}
                    onSeek={c.atSec != null ? () => seekTo(c.atSec!) : undefined}
                    onOwnerResolve={
                      mode === "owner"
                        ? (r) => void changeResolved(c.id, r)
                        : undefined
                    }
                    onOwnerReply={
                      mode === "owner" ? (r) => void changeReply(c.id, r) : undefined
                    }
                    onOwnerDelete={
                      mode === "owner" ? () => void removeByOwner(c.id) : undefined
                    }
                    onGuestEdit={
                      mode === "guest"
                        ? async (newBody) => {
                            try {
                              await guestUpdate(c.id, newBody);
                            } catch (err) {
                              toastError(toast, err);
                              throw err;
                            }
                          }
                        : undefined
                    }
                    onGuestDelete={
                      mode === "guest" ? () => void guestDelete(c.id) : undefined
                    }
                  />
                ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Vollbild-Namens-Prompt ──────────────────────────────────────────────────

function IdentityScreen({
  campaignName,
  onSubmit,
}: {
  campaignName: string;
  onSubmit: (name: string, email: string) => void;
}) {
  const [name, setName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const submit = () => {
    const n = name.trim();
    if (!n) {
      setError("Bitte einen Namen eingeben.");
      return;
    }
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) {
      setError("E-Mail sieht nicht gültig aus.");
      return;
    }
    onSubmit(n, email.trim());
  };
  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md rounded-3xl border border-line bg-surface p-6 shadow-lg">
        <div className="flex flex-col items-center text-center gap-2 mb-4">
          <Logo />
          <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-3 py-1 text-[11px] font-semibold uppercase tracking-wider text-brand-deep">
            Feedback-Session
          </span>
          <h1 className="mt-2 text-xl font-semibold text-ink">
            {campaignName || "Video"}
          </h1>
          <p className="text-sm text-ink-muted">
            Damit der Absender weiß, von wem das Feedback kommt.
          </p>
        </div>
        <div className="space-y-3">
          <div>
            <Label htmlFor="rev-name">Dein Name</Label>
            <Input
              id="rev-name"
              autoFocus
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError(null);
              }}
              placeholder="Vor- und Nachname"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>
          <div>
            <Label htmlFor="rev-email">E-Mail (optional)</Label>
            <Input
              id="rev-email"
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError(null);
              }}
              placeholder="damit dich der Absender bei Rückfragen erreicht"
              onKeyDown={(e) => {
                if (e.key === "Enter") submit();
              }}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <Button variant="brand" onClick={submit} className="w-full">
            Weiter zum Video
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Einzelne Kommentar-Karte (Guest + Owner) ────────────────────────────────

function CommentCard({
  comment,
  ownerName,
  mode,
  isOwnedByGuest,
  onSeek,
  onOwnerResolve,
  onOwnerReply,
  onOwnerDelete,
  onGuestEdit,
  onGuestDelete,
}: {
  comment: ReviewerComment;
  ownerName?: string;
  mode: "guest" | "owner";
  isOwnedByGuest: boolean;
  onSeek?: () => void;
  onOwnerResolve?: (resolved: boolean) => void;
  onOwnerReply?: (reply: string) => void;
  onOwnerDelete?: () => void;
  onGuestEdit?: (newBody: string) => Promise<void>;
  onGuestDelete?: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(comment.body);
  const [saving, setSaving] = React.useState(false);
  const [showReply, setShowReply] = React.useState(false);
  const [reply, setReply] = React.useState(comment.ownerReply ?? "");
  const resolved = !!comment.resolvedAt;

  React.useEffect(() => setDraft(comment.body), [comment.body]);

  const replyLabel =
    ownerName && ownerName.trim().length > 0
      ? `Antwort von ${ownerName}`
      : "Antwort";

  return (
    <li
      className={cn(
        "rounded-2xl bg-surface p-4 transition",
        "shadow-[0_2px_12px_rgba(30,25,60,0.05),0_1px_3px_rgba(30,25,60,0.03)]",
        resolved ? "opacity-40 saturate-50" : "",
      )}
    >
      <div className="flex items-center gap-2 text-xs mb-1 flex-wrap">
        {comment.atSec != null ? (
          <button
            type="button"
            onClick={onSeek}
            className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 font-semibold text-brand-deep hover:bg-brand/20"
          >
            <Clock className="size-3" />
            {fmtRange(comment.atSec, comment.atEndSec)}
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-canvas-deep px-2 py-0.5 font-semibold text-ink-muted">
            Allgemein
          </span>
        )}
        <b className="text-ink">{comment.authorName}</b>
        <span className="text-ink-muted">· {fmtRelative(comment.createdAt)}</span>
        {resolved && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
            <Check className="size-3" /> Erledigt
          </span>
        )}
      </div>

      {editing ? (
        <div className="space-y-2">
          <Textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            className="resize-none text-sm"
          />
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                setDraft(comment.body);
                setEditing(false);
              }}
            >
              Abbrechen
            </Button>
            <Button
              variant="brand"
              className="h-7 text-xs"
              disabled={saving || !draft.trim()}
              onClick={async () => {
                if (!onGuestEdit) return;
                setSaving(true);
                try {
                  await onGuestEdit(draft);
                  setEditing(false);
                } catch {
                  /* toastError im Callback */
                } finally {
                  setSaving(false);
                }
              }}
            >
              Speichern
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-ink whitespace-pre-wrap break-words">{comment.body}</p>
      )}

      {comment.ownerReply && (
        <div className="mt-3 border-l-2 border-brand/40 pl-3 text-xs text-ink">
          <b className="text-ink-muted">{replyLabel}: </b>
          <span className="whitespace-pre-wrap break-words">{comment.ownerReply}</span>
        </div>
      )}

      {/* Guest-Actions: nur eigene Kommentare */}
      {mode === "guest" && isOwnedByGuest && !editing && (onGuestEdit || onGuestDelete) && (
        <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
          {onGuestEdit && (
            <Button
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setEditing(true)}
              iconLeft={<Pencil className="size-3.5" />}
            >
              Bearbeiten
            </Button>
          )}
          {onGuestDelete && (
            <Button
              variant="ghost"
              className="h-7 text-xs text-danger hover:text-danger"
              onClick={onGuestDelete}
              iconLeft={<Trash2 className="size-3.5" />}
            >
              Löschen
            </Button>
          )}
        </div>
      )}

      {/* Owner-Actions */}
      {mode === "owner" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <Button
            variant={resolved ? "ghost" : "subtle"}
            onClick={() => onOwnerResolve?.(!resolved)}
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
            onClick={onOwnerDelete}
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
                    onOwnerReply?.(reply);
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
      )}
    </li>
  );
}
