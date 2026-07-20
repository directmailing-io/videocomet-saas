"use client";

import * as React from "react";
import {
  Clipboard,
  Trash2,
  Plus,
  ArrowLeft,
  Loader2,
  AlertTriangle,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

type Stage = "list" | "create" | "success" | "revoke";

interface ShareRow {
  id: string;
  token: string;
  label: string;
  createdAt: string;
  lastAccessedAt: string | null;
}

interface CreateShareResponse {
  id: string;
  token: string;
  url: string;
}

export interface ShareDialogProps {
  campaignId: string;
  campaignName: string;
  appUrl: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Build the public viewer URL for a share token. The POST endpoint returns
 * an absolute `url` already, but the GET list returns only `token`, so we
 * reconstruct from the app's public URL using the canonical `/s/<token>`
 * convention used by the public-viewer route.
 */
function buildShareUrl(appUrl: string, token: string): string {
  const base = appUrl.replace(/\/+$/, "");
  return `${base}/s/${token}`;
}

/**
 * Lightweight, German relative-time label. We avoid pulling in date-fns
 * just for this single string; precision beyond hours is not needed here.
 */
function formatRelativeDE(iso: string | null): string {
  if (!iso) return "noch nie geöffnet";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "noch nie geöffnet";
  const diffMs = Date.now() - d.getTime();
  const sec = Math.max(0, Math.round(diffMs / 1000));
  if (sec < 60) return "gerade eben";
  const min = Math.round(sec / 60);
  if (min < 60) return `vor ${min} Min`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `vor ${hr} h`;
  const day = Math.round(hr / 24);
  if (day < 30) return `vor ${day} ${day === 1 ? "Tag" : "Tagen"}`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `vor ${mo} Mon`;
  const yr = Math.round(mo / 12);
  return `vor ${yr} ${yr === 1 ? "Jahr" : "Jahren"}`;
}

function passwordStrength(pwd: string): {
  bucket: 0 | 1 | 2 | 3;
  pct: number;
  color: string;
} {
  const len = pwd.length;
  if (len === 0) {
    return { bucket: 0, pct: 0, color: "bg-line" };
  }
  if (len < 8) {
    return {
      bucket: 1,
      pct: Math.min(100, (len / 8) * 33),
      color: "bg-danger",
    };
  }
  if (len < 12) {
    return { bucket: 2, pct: 66, color: "bg-warn" };
  }
  return { bucket: 3, pct: 100, color: "bg-ok" };
}

export function ShareDialog({
  campaignId,
  campaignName,
  appUrl,
  open,
  onOpenChange,
}: ShareDialogProps) {
  const { toast } = useToast();
  const [stage, setStage] = React.useState<Stage>("list");

  // List
  const [shares, setShares] = React.useState<ShareRow[]>([]);
  const [loadingList, setLoadingList] = React.useState(false);
  const [listError, setListError] = React.useState<string | null>(null);

  // Create form
  const [label, setLabel] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // Success
  const [createdShare, setCreatedShare] =
    React.useState<CreateShareResponse | null>(null);

  // Revoke
  const [revokeTarget, setRevokeTarget] = React.useState<ShareRow | null>(null);
  const [revoking, setRevoking] = React.useState(false);

  const refetch = React.useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/shares`, {
        credentials: "same-origin",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { shares: ShareRow[] };
      setShares(Array.isArray(data.shares) ? data.shares : []);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Unbekannter Fehler";
      setListError(msg);
    } finally {
      setLoadingList(false);
    }
  }, [campaignId]);

  // Fetch when dialog opens
  React.useEffect(() => {
    if (open) {
      void refetch();
    } else {
      // Reset on close
      setStage("list");
      setLabel("");
      setPassword("");
      setCreating(false);
      setCreateError(null);
      setCreatedShare(null);
      setRevokeTarget(null);
      setRevoking(false);
    }
  }, [open, refetch]);

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({
        title: "Link kopiert",
        description: "In Zwischenablage kopiert.",
        variant: "success",
      });
    } catch {
      toast({
        title: "Konnte nicht kopieren",
        description: "Bitte den Link manuell auswählen und kopieren.",
        variant: "danger",
      });
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    // Whitespace clientseitig trimmen damit die Laengenpruefung das
    // tatsaechliche Eingabe-Material betrachtet (Mobile-Autocomplete
    // setzt gerne ein Leerzeichen ans Ende). Senden wir den getrimmten
    // Wert — Server trimmt zwar nochmal, aber so geht's konsistent.
    const trimmed = password.trim();
    if (trimmed.length < 4) {
      setCreateError("Das Passwort muss mindestens 4 Zeichen lang sein.");
      return;
    }
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/shares`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          password: trimmed,
          label: label.trim() ? label.trim() : undefined,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data = (await res.json()) as CreateShareResponse;
      setCreatedShare(data);
      setStage("success");
      // Clear password from memory immediately
      setPassword("");
      setLabel("");
      toast({
        title: "Share-Link erstellt",
        description: "Der neue Link ist sofort einsatzbereit.",
        variant: "success",
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Erstellen fehlgeschlagen.";
      setCreateError(msg);
      toast({
        title: "Erstellen fehlgeschlagen",
        description: msg,
        variant: "danger",
      });
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke() {
    if (!revokeTarget) return;
    setRevoking(true);
    try {
      const res = await fetch(
        `/api/campaigns/${campaignId}/shares/${revokeTarget.id}`,
        {
          method: "DELETE",
          credentials: "same-origin",
        },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      toast({
        title: "Share-Link gesperrt",
        description: "Die Ansicht ist nicht mehr aufrufbar.",
        variant: "success",
      });
      setRevokeTarget(null);
      setStage("list");
      await refetch();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Sperren fehlgeschlagen.";
      toast({
        title: "Sperren fehlgeschlagen",
        description: msg,
        variant: "danger",
      });
    } finally {
      setRevoking(false);
    }
  }

  const strength = passwordStrength(password);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg">
        {stage === "list" && (
          <>
            <DialogHeader>
              <DialogTitle>Geteilte Ansichten</DialogTitle>
              <DialogDescription>
                Erstellen Sie passwortgeschützte Links zu{" "}
                <span className="font-semibold text-ink">{campaignName}</span>,
                um die Kampagne mit Kunden oder Partnern zu teilen.
              </DialogDescription>
            </DialogHeader>

            <div className="max-h-[60vh] overflow-y-auto -mx-1 px-1">
              {loadingList ? (
                <div className="flex items-center justify-center py-10 text-ink-muted">
                  <Loader2 className="size-5 animate-spin" />
                </div>
              ) : listError ? (
                <div className="rounded-squircle-sm bg-danger-soft p-4 text-sm text-danger">
                  Laden fehlgeschlagen: {listError}
                </div>
              ) : shares.length === 0 ? (
                <div className="rounded-squircle-md bg-surface-soft py-10 px-6 text-center">
                  <p className="text-sm font-semibold text-ink">
                    Noch keine Share-Links vorhanden.
                  </p>
                  <p className="mt-1 text-xs text-ink-muted">
                    Erstellen Sie unten Ihren ersten passwortgeschützten Link.
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {shares.map((s) => {
                    const url = buildShareUrl(appUrl, s.token);
                    return (
                      <li
                        key={s.id}
                        className="rounded-squircle-md bg-surface-soft p-3.5 transition-colors hover:bg-canvas"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-ink truncate">
                              {s.label?.trim() || (
                                <span className="text-ink-muted font-normal">
                                  (ohne Label)
                                </span>
                              )}
                            </p>
                            <p className="mt-0.5 font-mono text-[11px] text-ink-muted truncate">
                              {url}
                            </p>
                            <div className="mt-1.5 inline-flex items-center gap-1.5 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] text-ink-muted">
                              <span className="size-1.5 rounded-full bg-ink-muted/50" />
                              Zuletzt geöffnet:{" "}
                              {formatRelativeDE(s.lastAccessedAt)}
                            </div>
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              type="button"
                              onClick={() => void copyToClipboard(url)}
                              className="inline-flex size-8 items-center justify-center rounded-full text-ink-muted hover:bg-surface-muted hover:text-ink transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                              title="Kopieren"
                              aria-label="Kopieren"
                            >
                              <Clipboard className="size-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setRevokeTarget(s);
                                setStage("revoke");
                              }}
                              className="inline-flex size-8 items-center justify-center rounded-full text-ink-muted hover:bg-danger/10 hover:text-danger transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-danger"
                              title="Zurückziehen"
                              aria-label="Zurückziehen"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <DialogFooter>
              <Button
                variant="brand"
                type="button"
                iconLeft={<Plus className="size-4" />}
                onClick={() => {
                  setCreateError(null);
                  setStage("create");
                }}
                className="w-full sm:w-auto"
              >
                Neuen Share-Link erstellen
              </Button>
            </DialogFooter>
          </>
        )}

        {stage === "create" && (
          <>
            <DialogHeader>
              <DialogTitle>Neuen Share-Link erstellen</DialogTitle>
              <DialogDescription>
                Vergeben Sie ein Passwort, das Empfänger zum Öffnen der
                geteilten Ansicht eingeben müssen.
              </DialogDescription>
            </DialogHeader>

            <form
              onSubmit={(e) => void handleCreate(e)}
              className="space-y-4"
            >
              <div>
                <Label htmlFor="share-label">Label (optional)</Label>
                <Input
                  id="share-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="z.B. Kunde Müller"
                  maxLength={120}
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <div>
                <Label htmlFor="share-password">Passwort</Label>
                <Input
                  id="share-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  minLength={4}
                  required
                  autoComplete="new-password"
                  placeholder="Mindestens 4 Zeichen"
                />
                <div className="mt-2">
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-line">
                    <div
                      className={cn(
                        "h-full rounded-full transition-all duration-200",
                        strength.color,
                      )}
                      style={{ width: `${strength.pct}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-ink-muted">
                    Mindestens 4 Zeichen.{" "}
                    {strength.bucket === 3
                      ? "Sehr stark."
                      : strength.bucket === 2
                        ? "Solide. 12+ Zeichen empfohlen."
                        : strength.bucket === 1
                          ? "Zu kurz."
                          : ""}
                  </p>
                </div>
              </div>
              {createError && (
                <div className="rounded-squircle-sm border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
                  {createError}
                </div>
              )}
              <DialogFooter>
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => setStage("list")}
                  disabled={creating}
                  iconLeft={<ArrowLeft className="size-4" />}
                >
                  Zurück
                </Button>
                <Button
                  variant="brand"
                  type="submit"
                  loading={creating}
                  disabled={creating || password.length < 8}
                >
                  Erstellen
                </Button>
              </DialogFooter>
            </form>
          </>
        )}

        {stage === "success" && createdShare && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="flex size-10 items-center justify-center rounded-squircle-sm bg-ok/10 text-ok shrink-0">
                  <Check className="size-5" />
                </div>
                <div className="flex-1">
                  <DialogTitle>Share-Link bereit</DialogTitle>
                  <DialogDescription className="mt-1">
                    Der Link ist sofort aufrufbar. Geben Sie ihn zusammen mit
                    dem Passwort an den Empfänger weiter.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="rounded-squircle-md bg-surface-soft p-4 space-y-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-1">
                  Link
                </p>
                <p className="font-mono text-xs text-ink break-all">
                  {createdShare.url}
                </p>
              </div>
              <Button
                type="button"
                variant="brand"
                size="lg"
                iconLeft={<Clipboard className="size-4" />}
                onClick={() => void copyToClipboard(createdShare.url)}
                className="w-full"
              >
                Kopieren
              </Button>
            </div>

            <div className="flex items-start gap-2 rounded-squircle-sm bg-warn-soft p-3 text-sm text-ink">
              <AlertTriangle className="size-4 shrink-0 text-warn mt-0.5" />
              <p>
                Das Passwort wird nicht erneut angezeigt. Bitte jetzt notieren
                oder direkt versenden.
              </p>
            </div>

            <DialogFooter>
              <Button
                variant="brand"
                type="button"
                onClick={() => {
                  setCreatedShare(null);
                  setStage("list");
                  void refetch();
                }}
              >
                Fertig
              </Button>
            </DialogFooter>
          </>
        )}

        {stage === "revoke" && revokeTarget && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <div className="flex size-10 items-center justify-center rounded-squircle-sm bg-danger/10 text-danger shrink-0">
                  <AlertTriangle className="size-5" />
                </div>
                <div className="flex-1">
                  <DialogTitle>Share-Link sperren?</DialogTitle>
                  <DialogDescription className="mt-1">
                    Diesen Link sofort sperren? Die Ansicht ist danach nicht
                    mehr aufrufbar.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="rounded-squircle-md bg-surface-soft p-3.5">
              <p className="text-sm font-semibold text-ink">
                {revokeTarget.label?.trim() || (
                  <span className="text-ink-muted font-normal">
                    (ohne Label)
                  </span>
                )}
              </p>
              <p className="mt-0.5 font-mono text-[11px] text-ink-muted truncate">
                {buildShareUrl(appUrl, revokeTarget.token)}
              </p>
            </div>

            <DialogFooter>
              <Button
                variant="ghost"
                type="button"
                onClick={() => {
                  setRevokeTarget(null);
                  setStage("list");
                }}
                disabled={revoking}
              >
                Abbrechen
              </Button>
              <Button
                variant="danger"
                type="button"
                onClick={() => void handleRevoke()}
                loading={revoking}
                disabled={revoking}
                iconLeft={<Trash2 className="size-4" />}
              >
                Sperren
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
