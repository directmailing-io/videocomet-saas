"use client";

/**
 * Passwort-Rückfrage für heikle Admin-Aktionen (Security-Härtung 2026-09-02).
 *
 * Verwendung:
 *   const reauth = useAdminReauth();
 *   const pw = await reauth.askPassword("Credits gutschreiben");
 *   if (!pw) return;                       // abgebrochen
 *   fetch(..., { body: JSON.stringify({ ...payload, adminPassword: pw }) });
 *   ...
 *   return (<>{reauth.dialog} ...</>);
 *
 * Das Passwort wird nie gespeichert, nur an den einen Request gehängt.
 */

import * as React from "react";
import { ShieldCheck } from "lucide-react";
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

interface PendingRequest {
  actionLabel: string;
  resolve: (value: string | null) => void;
}

export function useAdminReauth() {
  const [pending, setPending] = React.useState<PendingRequest | null>(null);
  const [password, setPassword] = React.useState("");

  const askPassword = React.useCallback((actionLabel: string) => {
    return new Promise<string | null>((resolve) => {
      setPassword("");
      setPending({ actionLabel, resolve });
    });
  }, []);

  function finish(value: string | null) {
    pending?.resolve(value);
    setPending(null);
    setPassword("");
  }

  const dialog = (
    <Dialog open={pending !== null} onOpenChange={(open) => !open && finish(null)}>
      <DialogContent size="sm">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (password.length > 0) finish(password);
          }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="size-5 text-brand-deep" />
              Kurz bestätigen
            </DialogTitle>
            <DialogDescription>
              {pending?.actionLabel ?? "Diese Aktion"} ist sicherheitsrelevant. Bitte gib zur
              Bestätigung dein Admin-Passwort ein.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2">
            <Label htmlFor="reauth-password">Dein Admin-Passwort</Label>
            <Input
              id="reauth-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={() => finish(null)}>
              Abbrechen
            </Button>
            <Button type="submit" disabled={password.length === 0}>
              Bestätigen
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );

  return { askPassword, dialog };
}
