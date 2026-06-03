"use client";

/**
 * Mediathek-Section "Aufnahme-Links" (Webcam-Share-Links).
 *
 * Drei Bereiche:
 *  1. Trigger-Button + Dialog mit Form (Titel, Max-Dauer, Ablauf)
 *  2. Success-Modal nach Erstellen: zeigt Link + Copy-Button + QR-Code
 *  3. Liste aller eigenen Links mit Status-Badge + Revoke-Button
 *
 * Datenfluss:
 *  - Initial-Liste kommt SSR-seitig aus der Mediathek-Page (Props).
 *  - Mutations (create/revoke) sprechen die API direkt an und triggern
 *    router.refresh() — die Page rendert neu mit aktuellen Daten.
 */

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Link as LinkIcon,
  Plus,
  Copy,
  Check,
  Trash2,
  ExternalLink,
} from "lucide-react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogHeader,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

export interface ShareLinkRow {
  id: string;
  slug: string;
  title: string | null;
  maxDurationSec: number;
  expiresAt: string | null;
  usedAt: string | null;
  mediaItemId: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: "open" | "used" | "expired" | "revoked";
  url: string;
}

interface ShareLinksProps {
  ownerDisplayName: string;
  appOrigin: string;
  initial: ShareLinkRow[];
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("de-DE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function statusBadge(status: ShareLinkRow["status"]) {
  switch (status) {
    case "open":
      return <Badge variant="success">Offen</Badge>;
    case "used":
      return <Badge variant="brand">Verwendet</Badge>;
    case "expired":
      return <Badge variant="neutral">Abgelaufen</Badge>;
    case "revoked":
      return <Badge variant="danger">Gesperrt</Badge>;
  }
}

export function ShareLinksSection({
  ownerDisplayName,
  appOrigin,
  initial,
}: ShareLinksProps) {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-ink">Aufnahme-Links</h2>
          <p className="text-sm text-ink-muted">
            Generiere einen Link, mit dem jemand für dich eine Webcam-Aufnahme
            machen kann. Pro Link genau eine Aufnahme.
          </p>
        </div>
        <CreateLinkDialog ownerDisplayName={ownerDisplayName} appOrigin={appOrigin} />
      </div>

      <ShareLinksList initial={initial} />
    </div>
  );
}

// ── Create-Dialog ──────────────────────────────────────────────────────────

function CreateLinkDialog({
  ownerDisplayName,
  appOrigin,
}: {
  ownerDisplayName: string;
  appOrigin: string;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState("");
  const [maxDuration, setMaxDuration] = React.useState(120);
  const [expiresAt, setExpiresAt] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [createdLink, setCreatedLink] = React.useState<{
    slug: string;
    url: string;
  } | null>(null);

  function reset() {
    setTitle("");
    setMaxDuration(120);
    setExpiresAt("");
    setCreatedLink(null);
    setSubmitting(false);
  }

  async function handleCreate() {
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim() || undefined,
        maxDurationSec: maxDuration,
      };
      if (expiresAt) {
        // <input type="datetime-local"> liefert lokale Zeit ohne TZ → zu ISO ergänzen.
        const d = new Date(expiresAt);
        if (!Number.isNaN(d.getTime())) {
          payload.expiresAt = d.toISOString();
        }
      }
      const res = await fetch("/api/share/webcam", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      const body = (await res.json()) as { slug: string; url: string };
      setCreatedLink({ slug: body.slug, url: body.url });
      router.refresh();
    } catch (err) {
      toast({
        variant: "danger",
        title: "Link konnte nicht erstellt werden",
        description: err instanceof Error ? err.message : "Unbekannter Fehler.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button iconLeft={<Plus className="size-4" />}>
          Aufnahmelink generieren
        </Button>
      </DialogTrigger>
      <DialogContent size="lg">
        {createdLink ? (
          <CreatedLinkPanel
            url={createdLink.url}
            onClose={() => {
              setOpen(false);
              reset();
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Aufnahmelink generieren</DialogTitle>
              <DialogDescription>
                Wer den Link öffnet, kann eine Webcam-Aufnahme machen. Sie
                landet danach automatisch in deiner Mediathek.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="link-title">Notiz (optional)</Label>
                <Input
                  id="link-title"
                  placeholder="z.B. Testimonial Müller GmbH"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={140}
                />
                <p className="text-xs text-ink-muted">
                  Nur du siehst diese Notiz — sie hilft beim Wiederfinden.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="link-duration">Max-Dauer (Sek.)</Label>
                  <Input
                    id="link-duration"
                    type="number"
                    min={10}
                    max={900}
                    value={maxDuration}
                    onChange={(e) =>
                      setMaxDuration(Number(e.target.value) || 120)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="link-expires">Ablauf (optional)</Label>
                  <Input
                    id="link-expires"
                    type="datetime-local"
                    value={expiresAt}
                    onChange={(e) => setExpiresAt(e.target.value)}
                  />
                </div>
              </div>

              <div className="rounded-squircle-md border border-line bg-surface-soft px-4 py-3">
                <p className="text-xs text-ink-muted">
                  Der Empfänger sieht beim Öffnen:
                </p>
                <p className="text-sm font-semibold text-ink mt-1">
                  Aufnahme für {ownerDisplayName}
                </p>
                {title && (
                  <p className="text-sm text-ink-muted">{title}</p>
                )}
                <p className="text-[11px] text-ink-muted mt-2">
                  URL-Muster: {appOrigin}/r/&lt;slug&gt;
                </p>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={submitting}
              >
                Abbrechen
              </Button>
              <Button onClick={handleCreate} loading={submitting}>
                Link erstellen
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Created-Link Panel (Link + QR-Code) ────────────────────────────────────

function CreatedLinkPanel({
  url,
  onClose,
}: {
  url: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);
  const [qrDataUrl, setQrDataUrl] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(url, {
      errorCorrectionLevel: "M",
      width: 320,
      margin: 2,
      color: { dark: "#0F1116", light: "#FFFFFF" },
    })
      .then((data) => {
        if (!cancelled) setQrDataUrl(data);
      })
      .catch((err) => {
        console.warn("[share-links] QR generation failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast({ variant: "success", title: "Link kopiert." });
    } catch {
      toast({ variant: "danger", title: "Kopieren fehlgeschlagen." });
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Aufnahmelink ist bereit</DialogTitle>
        <DialogDescription>
          Teile den Link oder den QR-Code mit der Person, die für dich
          aufnehmen soll.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div className="flex items-center gap-2 rounded-squircle-md border border-line bg-surface px-3 py-2">
          <code className="flex-1 truncate text-sm text-ink">{url}</code>
          <Button size="sm" variant="ghost" onClick={copy}
            iconLeft={copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}>
            {copied ? "Kopiert" : "Kopieren"}
          </Button>
        </div>

        <div className="flex flex-col items-center justify-center gap-2 rounded-squircle-md border border-line bg-surface-soft p-6">
          {qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={qrDataUrl}
              alt="QR-Code für den Aufnahmelink"
              className="size-56 rounded-squircle-sm bg-white shadow-sm"
            />
          ) : (
            <div className="size-56 animate-pulse rounded-squircle-sm bg-line" />
          )}
          <p className="text-xs text-ink-muted text-center">
            Mit dem Handy scannen, um direkt die Aufnahme-Seite zu öffnen.
          </p>
        </div>
      </div>

      <div className="flex justify-end pt-2">
        <Button onClick={onClose}>Fertig</Button>
      </div>
    </>
  );
}

// ── List ────────────────────────────────────────────────────────────────────

function ShareLinksList({ initial }: { initial: ShareLinkRow[] }) {
  const router = useRouter();
  const { toast } = useToast();
  const [revoking, setRevoking] = React.useState<string | null>(null);
  const [copyTarget, setCopyTarget] = React.useState<string | null>(null);

  if (initial.length === 0) {
    return (
      <div className="rounded-squircle-md border border-dashed border-line bg-surface-soft px-6 py-8 text-center">
        <LinkIcon className="size-6 text-ink-muted mx-auto mb-2" />
        <p className="text-sm font-medium text-ink">Noch keine Aufnahme-Links</p>
        <p className="text-xs text-ink-muted">
          Klicke oben auf „Aufnahmelink generieren", um den ersten zu erstellen.
        </p>
      </div>
    );
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopyTarget(url);
      setTimeout(() => setCopyTarget(null), 1500);
    } catch {
      toast({ variant: "danger", title: "Kopieren fehlgeschlagen." });
    }
  }

  async function revoke(slug: string) {
    if (!window.confirm("Diesen Link wirklich sperren? Das lässt sich nicht rückgängig machen.")) return;
    setRevoking(slug);
    try {
      const res = await fetch(`/api/share/webcam/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? `HTTP ${res.status}`);
      }
      toast({ variant: "success", title: "Link gesperrt." });
      router.refresh();
    } catch (err) {
      toast({
        variant: "danger",
        title: "Sperren fehlgeschlagen",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setRevoking(null);
    }
  }

  return (
    <ul className="space-y-2">
      {initial.map((l) => (
        <li
          key={l.id}
          className={cn(
            "rounded-squircle-md border bg-surface px-4 py-3 flex items-center gap-3",
            l.status === "open" ? "border-line" : "border-line-soft",
          )}
        >
          <LinkIcon className={cn(
            "size-5 shrink-0",
            l.status === "open" ? "text-brand" : "text-ink-muted",
          )} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-ink truncate">
                {l.title ?? "Ohne Titel"}
              </p>
              {statusBadge(l.status)}
            </div>
            <p className="text-xs text-ink-muted truncate">
              Erstellt: {formatDateTime(l.createdAt)} ·
              {l.expiresAt ? ` läuft ab: ${formatDateTime(l.expiresAt)}` : " kein Ablauf"} ·
              {" max. "}{l.maxDurationSec}s
            </p>
            {l.status === "used" && (
              <p className="text-xs text-ink-muted">
                Verwendet: {formatDateTime(l.usedAt)}
              </p>
            )}
            <p className="text-[11px] text-ink-muted truncate font-mono mt-1">
              {l.url}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {l.status === "open" && (
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copy(l.url)}
                  iconLeft={copyTarget === l.url ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
                >
                  {copyTarget === l.url ? "Kopiert" : "Kopieren"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => revoke(l.slug)}
                  loading={revoking === l.slug}
                  iconLeft={<Trash2 className="size-4" />}
                >
                  Sperren
                </Button>
              </>
            )}
            {l.status === "used" && l.mediaItemId && (
              <a
                href={`/mediathek`}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand hover:text-brand-deep"
              >
                <ExternalLink className="size-3.5" />
                In Mediathek
              </a>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
