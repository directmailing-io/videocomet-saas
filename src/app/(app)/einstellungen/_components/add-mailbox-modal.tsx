"use client";

/**
 * Add-Mailbox-Modal (SMTP/IMAP-Wizard)
 *
 * Zwei-stufiger Dialog nach dem Muster des Add-Domain-Modals:
 *   Stufe 1 — E-Mail-Adresse + Anzeigename. Freemail-Domains werden sofort
 *             clientseitig geblockt (checkFreemailDomain ist pure), bekannte
 *             Domains füllen das Preset vor.
 *   Stufe 2 — Anbieter-Auswahl (Presets + „Manuell“), Server-Felder,
 *             Zugangsdaten, aufklappbares „Erweitert“ (allowInvalidTls).
 *             Submit → POST /api/mailboxes mit Live-Anzeige der drei
 *             Prüf-Schritte (SMTP → Testmail → IMAP).
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/toaster";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  Circle,
  Loader2,
  Mail,
  Server,
  TriangleAlert,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MAILBOX_PRESETS,
  checkFreemailDomain,
  detectPreset,
  getPresetById,
  type MailboxPreset,
} from "@/lib/mailbox/presets";

export interface AddMailboxModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Wird nach erfolgreicher Anlage aufgerufen, damit die Liste neu lädt. */
  onCreated: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

type VerifyStep = "smtp" | "testmail" | "imap";
const VERIFY_STEPS: { key: VerifyStep; label: string }[] = [
  { key: "smtp", label: "SMTP-Anmeldung" },
  { key: "testmail", label: "Testmail an die eigene Adresse" },
  { key: "imap", label: "IMAP-Posteingang" },
];

type VerifyState =
  | { phase: "idle" }
  | { phase: "running" }
  | { phase: "failed"; step: VerifyStep | null; message: string }
  | { phase: "done" };

interface CreateResponse {
  mailbox?: unknown;
  error?: string;
  step?: VerifyStep;
}

export function AddMailboxModal({
  open,
  onOpenChange,
  onCreated,
}: AddMailboxModalProps) {
  const { toast } = useToast();

  const [stage, setStage] = React.useState<1 | 2>(1);

  // Stufe 1
  const [email, setEmail] = React.useState("");
  const [displayName, setDisplayName] = React.useState("");

  // Stufe 2
  const [presetId, setPresetId] = React.useState<string>("manual");
  const [smtpHost, setSmtpHost] = React.useState("");
  const [smtpPort, setSmtpPort] = React.useState("587");
  const [smtpSecure, setSmtpSecure] = React.useState(false);
  const [imapHost, setImapHost] = React.useState("");
  const [imapPort, setImapPort] = React.useState("993");
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [advancedOpen, setAdvancedOpen] = React.useState(false);
  const [allowInvalidTls, setAllowInvalidTls] = React.useState(false);

  const [verify, setVerify] = React.useState<VerifyState>({ phase: "idle" });

  React.useEffect(() => {
    if (open) return;
    const t = setTimeout(() => {
      setStage(1);
      setEmail("");
      setDisplayName("");
      setPresetId("manual");
      setSmtpHost("");
      setSmtpPort("587");
      setSmtpSecure(false);
      setImapHost("");
      setImapPort("993");
      setUsername("");
      setPassword("");
      setAdvancedOpen(false);
      setAllowInvalidTls(false);
      setVerify({ phase: "idle" });
    }, 200);
    return () => clearTimeout(t);
  }, [open]);

  const trimmedEmail = email.trim().toLowerCase();
  const emailValid = EMAIL_RE.test(trimmedEmail);
  const freemail = React.useMemo(
    () => (emailValid ? checkFreemailDomain(trimmedEmail) : { blocked: false as const }),
    [emailValid, trimmedEmail],
  );

  const activePreset: MailboxPreset | null =
    presetId === "manual" ? null : getPresetById(presetId);

  function applyPreset(preset: MailboxPreset | null) {
    if (!preset) {
      setPresetId("manual");
      return;
    }
    setPresetId(preset.id);
    setSmtpHost(preset.smtpHost ?? "");
    setSmtpPort(String(preset.smtpPort));
    setSmtpSecure(preset.smtpSecure);
    setImapHost(preset.imapHost ?? "");
    setImapPort(String(preset.imapPort));
  }

  function goToStage2(e: React.FormEvent) {
    e.preventDefault();
    if (!emailValid || freemail.blocked) return;
    const detected = detectPreset(trimmedEmail);
    if (detected) applyPreset(detected);
    setUsername((prev) => (prev.trim() === "" ? trimmedEmail : prev));
    setStage(2);
  }

  const stage2Valid =
    smtpHost.trim() !== "" &&
    imapHost.trim() !== "" &&
    /^\d+$/.test(smtpPort.trim()) &&
    /^\d+$/.test(imapPort.trim()) &&
    password !== "";

  const submitting = verify.phase === "running";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stage2Valid || submitting) return;
    setVerify({ phase: "running" });
    try {
      const res = await fetch("/api/mailboxes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailAddress: trimmedEmail,
          displayName: displayName.trim() || undefined,
          username: username.trim() || undefined,
          password,
          smtpHost: smtpHost.trim(),
          smtpPort: Number(smtpPort),
          smtpSecure,
          imapHost: imapHost.trim(),
          imapPort: Number(imapPort),
          allowInvalidTls: allowInvalidTls || undefined,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as CreateResponse;
      if (!res.ok || !body.mailbox) {
        const msg = body.error ?? "Das Postfach konnte nicht verbunden werden.";
        setVerify({ phase: "failed", step: body.step ?? null, message: msg });
        toast({
          title: "Verbindung fehlgeschlagen",
          description: msg,
          variant: "danger",
        });
        return;
      }
      setVerify({ phase: "done" });
      toast({
        title: "Postfach verbunden",
        description: `${trimmedEmail} ist einsatzbereit.`,
        variant: "success",
      });
      onCreated();
      setTimeout(() => onOpenChange(false), 900);
    } catch {
      const msg = "Verbindung zum Server fehlgeschlagen.";
      setVerify({ phase: "failed", step: null, message: msg });
      toast({
        title: "Verbindung fehlgeschlagen",
        description: msg,
        variant: "danger",
      });
    }
  }

  return (
    <Dialog open={open} onOpenChange={submitting ? () => undefined : onOpenChange}>
      <DialogContent size="lg" className="gap-5">
        <DialogHeader>
          <DialogTitle>
            {stage === 1 ? "Postfach verbinden (SMTP/IMAP)" : "Server & Zugangsdaten"}
          </DialogTitle>
          <DialogDescription>
            {stage === 1
              ? "Verbinde ein Postfach auf deiner eigenen Domain. VIDEOCOMET versendet später direkt über dieses Postfach."
              : `Zugangsdaten für ${trimmedEmail}. Wir prüfen die Verbindung mit einer echten Testmail an deine eigene Adresse.`}
          </DialogDescription>
        </DialogHeader>

        {stage === 1 && (
          <form onSubmit={goToStage2} className="space-y-4">
            <div>
              <Label htmlFor="mailbox-email">E-Mail-Adresse</Label>
              <Input
                id="mailbox-email"
                type="email"
                placeholder="z. B. max@ihre-firma.de"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={emailValid && freemail.blocked}
                autoComplete="off"
                autoFocus
                icon={<Mail />}
              />
              {emailValid && freemail.blocked && (
                <p className="mt-1.5 flex items-start gap-1.5 text-xs text-danger leading-relaxed">
                  <TriangleAlert className="size-3.5 shrink-0 mt-0.5" />
                  {freemail.message}
                </p>
              )}
              {(!emailValid || !freemail.blocked) && (
                <p className="mt-1.5 text-xs text-ink-muted">
                  Bitte ein Postfach auf Ihrer Firmen-Domain verwenden — Freemail-Adressen werden nicht unterstützt.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="mailbox-display-name">
                Absendername{" "}
                <span className="font-normal text-ink-muted">(optional)</span>
              </Label>
              <Input
                id="mailbox-display-name"
                placeholder="z. B. Max Mustermann"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={120}
                autoComplete="off"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Abbrechen
              </Button>
              <Button
                type="submit"
                disabled={!emailValid || freemail.blocked}
                iconLeft={<ArrowRight className="size-4" />}
              >
                Weiter
              </Button>
            </DialogFooter>
          </form>
        )}

        {stage === 2 && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label>Anbieter</Label>
              <Select
                value={presetId}
                onValueChange={(value) => {
                  if (value === "manual") {
                    setPresetId("manual");
                  } else {
                    applyPreset(getPresetById(value));
                  }
                }}
                disabled={submitting}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Anbieter wählen" />
                </SelectTrigger>
                <SelectContent>
                  {MAILBOX_PRESETS.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.label}
                    </SelectItem>
                  ))}
                  <SelectItem value="manual">Manuell / anderer Anbieter</SelectItem>
                </SelectContent>
              </Select>
              {activePreset?.hint && (
                <p className="mt-1.5 rounded-squircle-sm bg-surface-soft px-3 py-2 text-xs text-ink-soft leading-relaxed">
                  {activePreset.hint}
                </p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-3">
              <div>
                <Label htmlFor="mailbox-smtp-host">SMTP-Server</Label>
                <Input
                  id="mailbox-smtp-host"
                  placeholder={activePreset?.hostPlaceholder?.smtp ?? "smtp.ihre-domain.de"}
                  value={smtpHost}
                  onChange={(e) => setSmtpHost(e.target.value)}
                  disabled={submitting}
                  autoComplete="off"
                  icon={<Server />}
                />
              </div>
              <div>
                <Label htmlFor="mailbox-smtp-port">Port</Label>
                <Input
                  id="mailbox-smtp-port"
                  inputMode="numeric"
                  value={smtpPort}
                  onChange={(e) => {
                    setSmtpPort(e.target.value);
                    if (e.target.value.trim() === "587") setSmtpSecure(false);
                    if (e.target.value.trim() === "465") setSmtpSecure(true);
                  }}
                  disabled={submitting}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-[1fr_110px] gap-3">
              <div>
                <Label htmlFor="mailbox-imap-host">IMAP-Server</Label>
                <Input
                  id="mailbox-imap-host"
                  placeholder={activePreset?.hostPlaceholder?.imap ?? "imap.ihre-domain.de"}
                  value={imapHost}
                  onChange={(e) => setImapHost(e.target.value)}
                  disabled={submitting}
                  autoComplete="off"
                  icon={<Server />}
                />
              </div>
              <div>
                <Label htmlFor="mailbox-imap-port">Port</Label>
                <Input
                  id="mailbox-imap-port"
                  inputMode="numeric"
                  value={imapPort}
                  onChange={(e) => setImapPort(e.target.value)}
                  disabled={submitting}
                  autoComplete="off"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mailbox-username">Benutzername</Label>
                <Input
                  id="mailbox-username"
                  placeholder={trimmedEmail}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  disabled={submitting}
                  autoComplete="off"
                />
              </div>
              <div>
                <Label htmlFor="mailbox-password">
                  {activePreset?.requiresAppPassword ? "App-Passwort" : "Passwort"}
                </Label>
                <Input
                  id="mailbox-password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  autoComplete="new-password"
                />
              </div>
            </div>

            <div>
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="inline-flex items-center gap-1 text-xs font-semibold text-ink-muted hover:text-ink transition-colors"
              >
                <ChevronDown
                  className={cn("size-3.5 transition-transform", advancedOpen && "rotate-180")}
                />
                Erweitert
              </button>
              {advancedOpen && (
                <label className="mt-2 flex items-start gap-2.5 rounded-squircle-sm bg-surface-soft px-3 py-2.5 cursor-pointer">
                  <Checkbox
                    checked={allowInvalidTls}
                    onCheckedChange={(c) => setAllowInvalidTls(c === true)}
                    disabled={submitting}
                    className="mt-0.5"
                  />
                  <span className="text-xs text-ink-soft leading-relaxed">
                    <span className="font-semibold text-ink">
                      Ungültige TLS-Zertifikate akzeptieren
                    </span>
                    <br />
                    Nur aktivieren, wenn Ihr Mailserver ein selbst-signiertes
                    Zertifikat nutzt. Reduziert die Verbindungs-Sicherheit.
                  </span>
                </label>
              )}
            </div>

            {verify.phase !== "idle" && (
              <div className="space-y-2 rounded-squircle-sm bg-surface-soft px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">
                  Verbindungstest
                </p>
                {VERIFY_STEPS.map((s, idx) => {
                  const failedIdx =
                    verify.phase === "failed" && verify.step
                      ? VERIFY_STEPS.findIndex((v) => v.key === verify.step)
                      : -1;
                  let state: "pending" | "running" | "ok" | "failed" = "pending";
                  if (verify.phase === "done") state = "ok";
                  else if (verify.phase === "running") state = "running";
                  else if (verify.phase === "failed") {
                    if (failedIdx === -1) state = idx === 0 ? "failed" : "pending";
                    else if (idx < failedIdx) state = "ok";
                    else if (idx === failedIdx) state = "failed";
                    else state = "pending";
                  }
                  return (
                    <div key={s.key} className="flex items-center gap-2 text-sm">
                      {state === "ok" && <Check className="size-4 text-ok shrink-0" />}
                      {state === "running" && (
                        <Loader2 className="size-4 text-brand shrink-0 animate-spin" />
                      )}
                      {state === "failed" && <X className="size-4 text-danger shrink-0" />}
                      {state === "pending" && (
                        <Circle className="size-4 text-ink-muted/40 shrink-0" />
                      )}
                      <span
                        className={cn(
                          "text-ink-soft",
                          state === "failed" && "text-danger font-medium",
                          state === "ok" && "text-ink",
                        )}
                      >
                        {s.label}
                      </span>
                    </div>
                  );
                })}
                {verify.phase === "failed" && (
                  <p className="mt-1 text-xs text-danger leading-relaxed">{verify.message}</p>
                )}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setVerify({ phase: "idle" });
                  setStage(1);
                }}
                disabled={submitting}
                iconLeft={<ArrowLeft className="size-4" />}
              >
                Zurück
              </Button>
              <Button
                type="submit"
                disabled={!stage2Valid || submitting || verify.phase === "done"}
                loading={submitting}
              >
                {verify.phase === "failed" ? "Erneut versuchen" : "Verbinden & testen"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
