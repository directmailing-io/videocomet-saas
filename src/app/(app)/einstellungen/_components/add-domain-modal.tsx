"use client";

/**
 * Add-Domain-Modal
 *
 * Zwei-stufiger Dialog:
 *   Stufe 1 — User gibt Hostname ein, Live-Validation via {@link validateHostname}.
 *             Submit → POST /api/domains
 *   Stufe 2 — Nach Erfolg: DNS-Instruktionen (CNAME/A + TXT-Verify) inline.
 *             Live-Polling alle 10s auf GET /api/domains/:id bis Status = active
 *             oder failed.
 *
 * Wird sowohl für "neu hinzufügen" als auch für "Anweisungen anzeigen" einer
 * existierenden Domain wiederverwendet (Prop `existingDomain`).
 */

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toaster";
import {
  Check,
  Copy,
  ExternalLink,
  Globe,
  Loader2,
  RefreshCw,
  TriangleAlert,
} from "lucide-react";
import { validateHostname } from "@/lib/domain-utils";
import { cn } from "@/lib/utils";
import {
  type DomainListItem,
  type DomainStatus,
  statusBadgeVariant,
  statusLabel,
} from "./domain-helpers";

export interface AddDomainModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Wenn gesetzt: Modal wird im "Instruktionen"-Modus geöffnet, für eine
   * bereits angelegte Domain. Sonst Eingabe-Modus.
   */
  existingDomain?: DomainListItem | null;
  /** Wird nach Erfolg / Statuswechsel aufgerufen damit die Tab-Liste sich aktualisiert. */
  onDomainChanged: () => void;
}

interface CreateResponse {
  domain?: DomainListItem;
  error?: string;
  code?: string;
}

interface FetchResponse {
  domain?: DomainListItem & {
    sslIssuedAt?: string | null;
  };
  error?: string;
}

const POLL_INTERVAL_MS = 10_000;

export function AddDomainModal({
  open,
  onOpenChange,
  existingDomain,
  onDomainChanged,
}: AddDomainModalProps) {
  const { toast } = useToast();

  // Stufe 1: Eingabe
  const [hostname, setHostname] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [createError, setCreateError] = React.useState<string | null>(null);

  // Stufe 2: angelegte Domain (mit DNS-Instruktionen)
  const [domain, setDomain] = React.useState<DomainListItem | null>(
    existingDomain ?? null,
  );

  // Beim Öffnen mit `existingDomain` setzen, beim Schließen zurück.
  React.useEffect(() => {
    if (!open) {
      // Reset nach Animation
      const t = setTimeout(() => {
        setHostname("");
        setCreateError(null);
        setSubmitting(false);
        setDomain(null);
      }, 200);
      return () => clearTimeout(t);
    }
    if (existingDomain) {
      setDomain(existingDomain);
    }
    return undefined;
  }, [open, existingDomain]);

  // Live-Validation in Eingabe-Modus
  const validation = React.useMemo(() => {
    const trimmed = hostname.trim();
    if (!trimmed) return null;
    return validateHostname(trimmed);
  }, [hostname]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!validation || !validation.ok) return;
    setSubmitting(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostname: validation.hostname }),
      });
      const body = (await res.json().catch(() => ({}))) as CreateResponse;
      if (!res.ok || !body.domain) {
        const msg =
          body.code === "limit"
            ? "Sie haben das Limit von 3 Domains pro Konto erreicht."
            : body.code === "duplicate"
              ? "Diese Domain ist bereits verbunden."
              : (body.error ?? "Domain konnte nicht angelegt werden.");
        setCreateError(msg);
        toast({
          title: "Hinzufügen fehlgeschlagen",
          description: msg,
          variant: "danger",
        });
        return;
      }
      setDomain(body.domain);
      onDomainChanged();
      toast({
        title: "Domain angelegt",
        description: "Bitte richten Sie nun die DNS-Einträge ein.",
        variant: "success",
      });
    } catch {
      const msg = "Verbindung zum Server fehlgeschlagen.";
      setCreateError(msg);
      toast({
        title: "Hinzufügen fehlgeschlagen",
        description: msg,
        variant: "danger",
      });
    } finally {
      setSubmitting(false);
    }
  }

  // Polling auf Statuswechsel
  React.useEffect(() => {
    if (!open || !domain) return;
    const status = domain.status as DomainStatus;
    if (status === "active" || status === "failed") return;

    let cancelled = false;
    const id = window.setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(`/api/domains/${domain.id}`, {
            cache: "no-store",
          });
          if (!res.ok) return;
          const body = (await res.json()) as FetchResponse;
          if (cancelled || !body.domain) return;
          // GET /api/domains/:id liefert kein dnsInstructions zurück — wir
          // mergen daher mit dem bisherigen domain-Objekt um Instruktionen zu
          // behalten.
          setDomain((prev) =>
            prev
              ? {
                  ...prev,
                  status: body.domain!.status,
                  verifiedAt: body.domain!.verifiedAt ?? null,
                  sslExpiresAt: body.domain!.sslExpiresAt ?? null,
                  lastCheckedAt: body.domain!.lastCheckedAt ?? null,
                  lastError: body.domain!.lastError ?? null,
                }
              : prev,
          );
          // Eltern-Liste live aktualisieren
          onDomainChanged();
        } catch {
          // Stille — nächster Tick versucht es wieder
        }
      })();
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [open, domain, onDomainChanged]);

  async function handleManualCheck() {
    if (!domain) return;
    try {
      const res = await fetch(`/api/domains/${domain.id}/verify`, {
        method: "POST",
      });
      const body = (await res.json().catch(() => ({}))) as FetchResponse;
      if (!res.ok || !body.domain) {
        toast({
          title: "Prüfung fehlgeschlagen",
          description: body.error ?? "Bitte erneut versuchen.",
          variant: "danger",
        });
        return;
      }
      setDomain((prev) =>
        prev
          ? {
              ...prev,
              status: body.domain!.status,
              verifiedAt: body.domain!.verifiedAt ?? null,
              sslExpiresAt: body.domain!.sslExpiresAt ?? null,
              lastCheckedAt: body.domain!.lastCheckedAt ?? null,
              lastError: body.domain!.lastError ?? null,
            }
          : prev,
      );
      onDomainChanged();
      const newStatus = body.domain.status as DomainStatus;
      const isReady = newStatus === "active";
      const isFail = newStatus === "failed";
      toast({
        title: isReady
          ? "Domain ist aktiv"
          : isFail
            ? "Konfiguration fehlgeschlagen"
            : "DNS-Prüfung abgeschlossen",
        description: isReady
          ? "Sie können die Domain ab sofort für Kampagnen auswählen."
          : body.domain.lastError ??
            `Status: ${statusLabel(newStatus)} — Diagnose siehe Modal.`,
        variant: isReady ? "success" : isFail ? "danger" : "default",
      });
    } catch {
      toast({
        title: "Prüfung fehlgeschlagen",
        description: "Verbindung zum Server fehlgeschlagen.",
        variant: "danger",
      });
    }
  }

  const inputState = !validation
    ? "neutral"
    : validation.ok
      ? "ok"
      : "error";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="lg" className="gap-5">
        <DialogHeader>
          <DialogTitle>
            {domain ? "DNS-Einträge einrichten" : "Custom-Domain hinzufügen"}
          </DialogTitle>
          <DialogDescription>
            {domain
              ? "Hinterlegen Sie folgende Einträge bei Ihrem DNS-Provider. Wir prüfen die Einträge automatisch."
              : "Verbinden Sie eine eigene (Sub-)Domain. Apex (z.B. ihr-name.de) und Subdomain (z.B. video.ihr-name.de) werden unterstützt."}
          </DialogDescription>
        </DialogHeader>

        {!domain && (
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <Label htmlFor="domain-hostname">Hostname</Label>
              <Input
                id="domain-hostname"
                placeholder="z.B. video.ihre-domain.de"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                error={inputState === "error"}
                autoComplete="off"
                autoFocus
                disabled={submitting}
                icon={<Globe />}
              />
              {validation && validation.ok && (
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-ok">
                  <Check className="size-3.5" />
                  Gueltig — erkannt als{" "}
                  <span className="font-semibold">
                    {validation.kind === "apex" ? "Apex-Domain" : "Subdomain"}
                  </span>
                </p>
              )}
              {validation && !validation.ok && (
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-xs text-danger">
                  <TriangleAlert className="size-3.5" />
                  {validation.error}
                </p>
              )}
              {!validation && (
                <p className="mt-1.5 text-xs text-ink-muted">
                  Wir erkennen automatisch, ob es sich um eine Apex- oder
                  Subdomain handelt.
                </p>
              )}
            </div>
            {createError && (
              <div className="rounded-squircle-sm border border-danger/30 bg-danger-soft/50 px-3 py-2 text-sm text-danger">
                {createError}
              </div>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={
                  submitting ||
                  !validation ||
                  !validation.ok
                }
                loading={submitting}
                iconLeft={!submitting ? <Globe className="size-4" /> : undefined}
              >
                Domain anlegen
              </Button>
            </DialogFooter>
          </form>
        )}

        {domain && (
          <DnsInstructions
            domain={domain}
            onManualCheck={handleManualCheck}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── DNS-Instruktionen + Status-Anzeige ───────────────────────────────────────

interface DnsInstructionsProps {
  domain: DomainListItem;
  onManualCheck: () => void;
  onClose: () => void;
}

function DnsInstructions({
  domain,
  onManualCheck,
  onClose,
}: DnsInstructionsProps) {
  const status = domain.status as DomainStatus;
  const dns = domain.dnsInstructions;
  const isActive = status === "active";
  const isFailed = status === "failed";

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 rounded-squircle-sm bg-surface-soft px-4 py-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Hostname
          </p>
          <p className="mt-0.5 text-sm font-semibold text-ink break-all">
            {domain.hostname}
          </p>
        </div>
        <Badge variant={statusBadgeVariant(status)} dot>
          {statusLabel(status)}
        </Badge>
      </div>

      {!isActive && !isFailed && (
        <div className="flex items-start gap-3 rounded-squircle-sm bg-warn-soft/50 px-4 py-3 text-sm text-ink">
          <Loader2 className="size-4 text-warn shrink-0 mt-0.5 animate-spin" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">Wartet auf DNS-Konfiguration</p>
            <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
              Wir prüfen alle 10 Sekunden automatisch. Die DNS-Änderungen
              können je nach Provider 5 Minuten bis 24 Stunden brauchen.
            </p>
            {domain.lastError && (
              <div className="mt-2 rounded-squircle-sm bg-surface px-2.5 py-1.5">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-warn">
                  Letzte Diagnose
                </p>
                <p className="text-xs text-ink-soft mt-0.5 leading-relaxed break-words">
                  {domain.lastError}
                </p>
                <DiagnosisHint message={domain.lastError} />
              </div>
            )}
          </div>
        </div>
      )}

      {isActive && (
        <div className="flex items-start gap-3 rounded-squircle-sm bg-ok-soft/60 px-4 py-3 text-sm text-ink">
          <Check className="size-4 text-ok shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">Domain ist aktiv</p>
            <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
              Sie können die Domain ab sofort für Kampagnen auswählen.
            </p>
            <a
              href={`https://${domain.hostname}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-deep hover:underline"
            >
              <ExternalLink className="size-3.5" />
              Test öffnen
            </a>
          </div>
        </div>
      )}

      {isFailed && (
        <div className="flex items-start gap-3 rounded-squircle-sm border border-danger/30 bg-danger-soft/40 px-4 py-3 text-sm text-ink">
          <TriangleAlert className="size-4 text-danger shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">Konfiguration fehlgeschlagen</p>
            {domain.lastError && (
              <p className="text-xs text-ink-muted mt-0.5 leading-relaxed">
                {domain.lastError}
              </p>
            )}
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">
              Prüfen Sie die DNS-Einträge unten und klicken Sie auf
              &ldquo;Erneut prüfen&rdquo;.
            </p>
          </div>
        </div>
      )}

      {dns && (
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            DNS-Einträge
          </p>
          <DnsRecord
            label={dns.pointing.type === "CNAME" ? "Pointing (CNAME)" : "Pointing (A)"}
            record={dns.pointing}
          />
          <DnsRecord label="Verifizierung (TXT)" record={dns.verifyRecord} />
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>
          Schließen
        </Button>
        {!isActive && (
          <Button
            variant="brand"
            onClick={onManualCheck}
            iconLeft={<RefreshCw className="size-4" />}
          >
            Jetzt prüfen
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

interface DnsRecordRow {
  type: string;
  name: string;
  value: string;
}

/**
 * Übersetzt die generische DNS-Fehlermeldung in eine konkrete Handlungs-
 * empfehlung. Triggert anhand von Schluesselwoertern in der Diagnose.
 *
 * Hintergrund: Die häufigsten Konfigurationsfehler beim ersten Setup sind
 *   - TXT-Record-Name in den Wert kopiert (statt vc-verify=<token>)
 *   - CNAME zeigt auf alte oder fremde Host-IP
 *   - TXT/CNAME noch nicht propagiert (TTL)
 * Statt den User raten zu lassen, geben wir eine passende One-Liner-Hilfe.
 */
function DiagnosisHint({ message }: { message: string }): React.JSX.Element | null {
  const m = message.toLowerCase();
  let hint: string | null = null;

  if (m.includes("txt") && (m.includes("kein vc-verify") || m.includes("vc-verify"))) {
    hint =
      "Ihr TXT-Record existiert, aber der WERT ist falsch. Prüfen Sie, ob Sie versehentlich den Namen ins Wert-Feld kopiert haben — der Wert muss mit \"vc-verify=\" beginnen.";
  } else if (m.includes("kein txt") || m.includes("txt-record fehlt") || m.includes("kein txt-record")) {
    hint =
      "Bitte den TXT-Record beim DNS-Provider eintragen (Name beginnt mit _videocomet). Bei manchen Providern muss der Name OHNE die Top-Domain eingetragen werden.";
  } else if (m.includes("cname zeigt auf") || m.includes("a-record zeigt auf")) {
    hint =
      "Der DNS-Record zeigt auf eine fremde IP. Bitte den Wert auf cname.videocomet.de (CNAME) bzw. 178.105.208.68 (A) setzen.";
  } else if (m.includes("nxdomain") || m.includes("dns-record fehlt")) {
    hint =
      "Es gibt noch keinen DNS-Eintrag für diesen Hostname. Bitte den CNAME (oder A-Record bei Root-Domain) beim DNS-Provider anlegen.";
  } else if (m.includes("timeout")) {
    hint =
      "Der DNS-Server hat innerhalb 3 Sekunden nicht geantwortet. Bitte in 1-2 Minuten erneut prüfen.";
  }

  if (!hint) return null;
  return (
    <p className="mt-1.5 text-[11px] text-brand-deep leading-relaxed">
      <strong>Tipp:</strong> {hint}
    </p>
  );
}

function DnsRecord({ label, record }: { label: string; record: DnsRecordRow }) {
  return (
    <div className="rounded-squircle-sm bg-surface-soft">
      <div className="border-b border-line-soft px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
        {label}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-[80px_1fr] divide-y sm:divide-y-0 sm:divide-x divide-line-soft">
        <div className="px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
            Typ
          </p>
          <p className="mt-0.5 text-sm font-mono text-ink">{record.type}</p>
        </div>
        <CopyField label="Name / Host" value={record.name} />
      </div>
      <div className="border-t border-line-soft">
        <CopyField label="Wert / Ziel" value={record.value} />
      </div>
    </div>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = React.useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      toast({
        title: "Kopiert",
        description: value,
        variant: "success",
        duration: 1500,
      });
    } catch {
      toast({
        title: "Kopieren fehlgeschlagen",
        description: "Bitte manuell markieren und kopieren.",
        variant: "danger",
      });
    }
  }

  return (
    <div className="flex items-center gap-2 px-4 py-3">
      <div className="flex-1 min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
          {label}
        </p>
        <p className="mt-0.5 text-sm font-mono text-ink break-all">{value}</p>
      </div>
      <button
        type="button"
        onClick={() => void copy()}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted shrink-0 transition-colors",
          "hover:text-ink",
          copied && "text-ok hover:text-ok",
        )}
        title="In Zwischenablage kopieren"
      >
        {copied ? (
          <>
            <Check className="size-3.5" />
            Kopiert
          </>
        ) : (
          <>
            <Copy className="size-3.5" />
            Kopieren
          </>
        )}
      </button>
    </div>
  );
}
