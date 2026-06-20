"use client";

/**
 * Secret-Reveal-Modal — wird sowohl nach dem Anlegen eines Webhooks als auch
 * nach `rotate-secret` einmalig angezeigt. Der Plaintext-Secret ist serverseitig
 * danach nicht mehr erreichbar (nur Hash + Last4 in DB), daher die deutliche
 * Warnung + Copy-to-Clipboard-CTA.
 */

import * as React from "react";
import { Copy, Check, TriangleAlert, KeyRound } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export interface WebhookSecretRevealProps {
  open: boolean;
  secret: string | null;
  onClose: () => void;
  /** Headline-Variante: nach `create` vs. nach `rotate`. */
  mode?: "create" | "rotate";
}

export function WebhookSecretReveal({
  open,
  secret,
  onClose,
  mode = "create",
}: WebhookSecretRevealProps) {
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

  async function handleCopy() {
    if (!secret) return;
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard-API kann in non-secure Contexts fehlschlagen — wir lassen
      // den Nutzer das Feld dann manuell kopieren.
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent size="lg" showClose={false}>
        <DialogHeader>
          <div className="flex items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-squircle-sm bg-brand-soft text-brand-deep">
              <KeyRound className="size-5" />
            </div>
            <div className="min-w-0">
              <DialogTitle>
                {mode === "rotate"
                  ? "Neues Webhook-Secret"
                  : "Webhook erstellt — Secret jetzt sichern"}
              </DialogTitle>
              <DialogDescription>
                Verwenden Sie dieses Secret, um eingehende Pushes auf Ihrer
                Seite zu verifizieren (HMAC-Signatur im{" "}
                <span className="font-mono text-[12px]">X-VC-Signature</span>
                -Header).
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="flex items-start gap-2.5 rounded-squircle-sm border border-warn/30 bg-warn-soft/40 px-3 py-2.5 text-sm text-ink">
          <TriangleAlert className="size-4 text-warn shrink-0 mt-0.5" />
          <p className="min-w-0">
            <span className="font-semibold">Nur einmal sichtbar.</span> Bitte
            sofort speichern (z. B. in einem Passwort-Manager oder Ihrem
            Make/Zapier-Setup). Verlorene Secrets können nur per
            &quot;Rotate&quot; ersetzt werden.
          </p>
        </div>

        <div className="rounded-squircle-sm border border-line bg-surface-muted/40 p-3">
          <code className="block text-xs font-mono text-ink break-all select-all">
            {secret ?? ""}
          </code>
        </div>

        <DialogFooter className="flex !flex-row !justify-between !gap-3">
          <Button
            variant="ghost"
            type="button"
            onClick={handleCopy}
            iconLeft={
              copied ? <Check className="size-4" /> : <Copy className="size-4" />
            }
          >
            {copied ? "Kopiert" : "In Zwischenablage kopieren"}
          </Button>
          <Button type="button" onClick={onClose}>
            Fertig
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
