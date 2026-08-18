"use client";

import * as React from "react";
import {
  Check,
  Copy,
  Info,
  KeyRound,
  Loader2,
  Lock,
  MessageSquare,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/components/ui/toaster";
import { toastError } from "@/lib/toast-error";
import {
  FeedbackReviewer,
  type ReviewerComment,
  type ReviewerVideo,
} from "@/app/review/[token]/_components/feedback-reviewer";

interface OwnerLinkView {
  id: string;
  token: string;
  hasPassword: boolean;
  expiresAt: string;
  lastAccessedAt: string | null;
  createdAt: string;
  unresolvedCount: number;
  video: ReviewerVideo;
  comments: ReviewerComment[];
}

interface Props {
  campaignId: string;
  hasVideo: boolean;
  /** Name des Kampagnen-Owners für die "Antwort von {name}"-Zeile im Reviewer. */
  ownerName?: string;
}

function currentHost(): string {
  if (typeof window === "undefined") return "app.videocomet.de";
  return window.location.host || "app.videocomet.de";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function FeedbackPanel({ campaignId, hasVideo, ownerName }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(true);
  const [link, setLink] = React.useState<OwnerLinkView | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/feedback-link`, {
        method: "GET",
        credentials: "same-origin",
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) throw new Error(payload?.error ?? "Konnte Link nicht laden.");
      setLink(
        payload.link
          ? normalize(payload.link)
          : null,
      );
    } catch (err) {
      toastError(toast, err);
    } finally {
      setLoading(false);
    }
  }, [campaignId, toast]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const create = React.useCallback(
    async (opts: { ttlDays?: number; password?: string | null }) => {
      setBusy("create");
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/feedback-link`, {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ttlDays: opts.ttlDays ?? 7, password: opts.password ?? null }),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error(payload?.error ?? "Konnte Link nicht erstellen.");
        setLink(payload.link ? normalize(payload.link) : null);
        toast({ title: "Feedback-Link ist aktiv.", variant: "success" });
      } catch (err) {
        toastError(toast, err);
      } finally {
        setBusy(null);
      }
    },
    [campaignId, toast],
  );

  const patch = React.useCallback(
    async (body: { ttlDays?: number; password?: string | null }) => {
      setBusy("patch");
      try {
        const res = await fetch(`/api/campaigns/${campaignId}/feedback-link`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        const payload = await res.json().catch(() => null);
        if (!res.ok) throw new Error(payload?.error ?? "Konnte nicht speichern.");
        setLink(payload.link ? normalize(payload.link) : null);
        toast({ title: "Aktualisiert.", variant: "success" });
      } catch (err) {
        toastError(toast, err);
      } finally {
        setBusy(null);
      }
    },
    [campaignId, toast],
  );

  const revoke = React.useCallback(async () => {
    if (!window.confirm("Feedback-Link jetzt deaktivieren? Bestehende Rückmeldungen bleiben erhalten.")) return;
    setBusy("revoke");
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/feedback-link`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error("Konnte Link nicht deaktivieren.");
      setLink(null);
      toast({ title: "Feedback-Link deaktiviert.", variant: "success" });
    } catch (err) {
      toastError(toast, err);
    } finally {
      setBusy(null);
    }
  }, [campaignId, toast]);

  const commentPatch = React.useCallback(
    async (
      commentId: string,
      body: { resolved?: boolean; ownerReply?: string | null },
    ) => {
      const res = await fetch(
        `/api/campaigns/${campaignId}/feedback-comments/${commentId}`,
        {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      if (!res.ok) {
        const p = await res.json().catch(() => null);
        throw new Error(p?.error ?? "Fehler.");
      }
    },
    [campaignId],
  );

  const commentDelete = React.useCallback(
    async (commentId: string) => {
      const res = await fetch(
        `/api/campaigns/${campaignId}/feedback-comments/${commentId}`,
        { method: "DELETE", credentials: "same-origin" },
      );
      if (!res.ok) {
        const p = await res.json().catch(() => null);
        throw new Error(p?.error ?? "Fehler.");
      }
    },
    [campaignId],
  );

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-5 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" /> Lädt…
        </CardContent>
      </Card>
    );
  }

  if (!hasVideo) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-5 text-sm">
          <Info className="mt-0.5 size-4 shrink-0 text-brand-deep" />
          <div>
            <b>Noch kein Master-Video hinterlegt.</b>
            <p className="text-ink-muted">
              Nimm zuerst im Studio ein Video auf oder wähle im Video-Tab ein Video aus der Mediathek — dann kannst du hier einen Feedback-Link erstellen.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      {!link ? (
        <CreateCard onCreate={(o) => void create(o)} busy={busy === "create"} />
      ) : (
        <>
          <ActiveLinkCard
            link={link}
            busy={busy}
            onRotate={() => {
              const warn = link.hasPassword
                ? "Neuen Link erzeugen? Der bisherige Link wird sofort ungültig. Ein eventuell gesetztes Passwort musst du danach neu vergeben."
                : "Neuen Link erzeugen? Der bisherige Link wird sofort ungültig.";
              if (!window.confirm(warn)) return;
              void create({ ttlDays: 7, password: null });
            }}
            onRevoke={() => void revoke()}
            onSetPassword={(pw) => void patch({ password: pw })}
            onClearPassword={() => void patch({ password: null })}
            onExtend={(days) => void patch({ ttlDays: days })}
          />
          <div>
            <div className="mb-3 flex items-center gap-2 text-sm">
              <MessageSquare className="size-4 text-brand-deep" />
              <b className="text-ink">Rückmeldungen</b>
              {link.unresolvedCount > 0 && (
                <span className="inline-flex items-center rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-deep">
                  {link.unresolvedCount} offen
                </span>
              )}
            </div>
            <FeedbackReviewer
              token={null}
              video={link.video}
              initialComments={link.comments}
              mode="owner"
              ownerName={ownerName}
              onResolvedChange={(id, res) => commentPatch(id, { resolved: res })}
              onReplyChange={(id, reply) => commentPatch(id, { ownerReply: reply })}
              onDelete={commentDelete}
            />
          </div>
        </>
      )}
    </div>
  );
}

function normalize(l: {
  id: string;
  token: string;
  hasPassword: boolean;
  expiresAt: string | Date;
  lastAccessedAt: string | Date | null;
  createdAt: string | Date;
  unresolvedCount: number;
  video: ReviewerVideo;
  comments: Array<ReviewerComment & { createdAt: string | Date; updatedAt: string | Date; resolvedAt: string | Date | null }>;
}): OwnerLinkView {
  return {
    id: l.id,
    token: l.token,
    hasPassword: l.hasPassword,
    expiresAt: typeof l.expiresAt === "string" ? l.expiresAt : l.expiresAt.toISOString(),
    lastAccessedAt: l.lastAccessedAt
      ? typeof l.lastAccessedAt === "string"
        ? l.lastAccessedAt
        : l.lastAccessedAt.toISOString()
      : null,
    createdAt: typeof l.createdAt === "string" ? l.createdAt : l.createdAt.toISOString(),
    unresolvedCount: l.unresolvedCount,
    video: l.video,
    comments: l.comments.map((c) => ({
      ...c,
      createdAt: typeof c.createdAt === "string" ? c.createdAt : c.createdAt.toISOString(),
      updatedAt: typeof c.updatedAt === "string" ? c.updatedAt : c.updatedAt.toISOString(),
      resolvedAt: c.resolvedAt
        ? typeof c.resolvedAt === "string"
          ? c.resolvedAt
          : c.resolvedAt.toISOString()
        : null,
    })),
  };
}

// ── Kein Link vorhanden → erstellen ──────────────────────────────────────

function CreateCard({
  onCreate,
  busy,
}: {
  onCreate: (opts: { ttlDays?: number; password?: string | null }) => void;
  busy: boolean;
}) {
  const [ttlDays, setTtlDays] = React.useState(7);
  const [password, setPassword] = React.useState("");
  return (
    <Card>
      <CardHeader>
        <CardTitle>Feedback-Link erstellen</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-ink-muted">
          Erzeuge einen Link zum Master-Video (mit Platzhaltern). Der Empfänger kann bei jedem Zeitstempel Kommentare hinterlassen — ganz ohne Login.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="ttl">Gültig für</Label>
            <select
              id="ttl"
              value={ttlDays}
              onChange={(e) => setTtlDays(Number(e.target.value))}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            >
              <option value={3}>3 Tage</option>
              <option value={7}>7 Tage</option>
              <option value={14}>14 Tage</option>
              <option value={30}>30 Tage</option>
            </select>
          </div>
          <div>
            <Label htmlFor="pw">Passwort (optional)</Label>
            <Input
              id="pw"
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="leer lassen = ohne Passwort"
            />
          </div>
        </div>
        <div className="flex justify-end">
          <Button
            variant="brand"
            onClick={() => onCreate({ ttlDays, password: password.trim() || null })}
            disabled={busy}
            iconLeft={busy ? <Loader2 className="size-4 animate-spin" /> : undefined}
          >
            {busy ? "Wird erstellt…" : "Feedback-Link erstellen"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Aktiver Link ─────────────────────────────────────────────────────────

function ActiveLinkCard({
  link,
  busy,
  onRotate,
  onRevoke,
  onSetPassword,
  onClearPassword,
  onExtend,
}: {
  link: OwnerLinkView;
  busy: string | null;
  onRotate: () => void;
  onRevoke: () => void;
  onSetPassword: (pw: string) => void;
  onClearPassword: () => void;
  onExtend: (days: number) => void;
}) {
  const { toast } = useToast();
  const url = `https://${currentHost()}/review/${link.token}`;
  const [showPwForm, setShowPwForm] = React.useState(false);
  const [pw, setPw] = React.useState("");

  const copy = React.useCallback(async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link kopiert.", variant: "success" });
    } catch {
      toast({ title: "Link kopieren fehlgeschlagen.", variant: "danger" });
    }
  }, [toast, url]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Check className="size-4 text-emerald-600" />
          Feedback-Link ist aktiv
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-2 rounded-2xl border border-line bg-canvas-deep/40 p-3 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 truncate rounded-lg bg-surface px-3 py-2 text-sm text-ink">
            {url}
          </code>
          <div className="flex gap-2">
            <Button variant="brand" onClick={copy} iconLeft={<Copy className="size-4" />}>
              Kopieren
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
          <span>Läuft ab am <b className="text-ink">{fmtDate(link.expiresAt)}</b></span>
          <span>·</span>
          <span>
            {link.hasPassword ? (
              <span className="inline-flex items-center gap-1 text-brand-deep">
                <Lock className="size-3" /> Passwortgeschützt
              </span>
            ) : (
              "Kein Passwort"
            )}
          </span>
          {link.lastAccessedAt && (
            <>
              <span>·</span>
              <span>Zuletzt geöffnet: {fmtDate(link.lastAccessedAt)}</span>
            </>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="subtle"
            onClick={() => setShowPwForm((v) => !v)}
            iconLeft={<KeyRound className="size-3.5" />}
          >
            {link.hasPassword ? "Passwort ändern" : "Passwort setzen"}
          </Button>
          {link.hasPassword && (
            <Button
              variant="ghost"
              onClick={onClearPassword}
              disabled={busy === "patch"}
            >
              Passwort entfernen
            </Button>
          )}
          <select
            defaultValue=""
            onChange={(e) => {
              const v = Number(e.target.value);
              if (v > 0) onExtend(v);
              e.currentTarget.value = "";
            }}
            className="rounded-lg border border-line bg-surface px-3 py-2 text-sm"
          >
            <option value="">Gültigkeit verlängern…</option>
            <option value={3}>+3 Tage</option>
            <option value={7}>+7 Tage</option>
            <option value={14}>+14 Tage</option>
            <option value={30}>+30 Tage</option>
          </select>
          <Button
            variant="ghost"
            onClick={onRotate}
            disabled={busy === "create"}
            iconLeft={<RefreshCw className="size-3.5" />}
          >
            Neuen Link erzeugen
          </Button>
          <Button
            variant="ghost"
            onClick={onRevoke}
            disabled={busy === "revoke"}
            iconLeft={<Trash2 className="size-3.5" />}
            className="text-danger hover:text-danger"
          >
            Deaktivieren
          </Button>
        </div>

        {showPwForm && (
          <div className="rounded-xl border border-line bg-surface p-3 space-y-2">
            <Label htmlFor="new-pw">Neues Passwort</Label>
            <Input
              id="new-pw"
              type="text"
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="mind. 4 Zeichen"
            />
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowPwForm(false)}>
                Abbrechen
              </Button>
              <Button
                variant="brand"
                onClick={() => {
                  if (pw.length < 4) {
                    toast({ title: "Bitte mind. 4 Zeichen.", variant: "danger" });
                    return;
                  }
                  onSetPassword(pw);
                  setPw("");
                  setShowPwForm(false);
                }}
                disabled={busy === "patch"}
              >
                Speichern
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
