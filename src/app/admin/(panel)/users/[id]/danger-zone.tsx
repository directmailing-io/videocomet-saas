"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";
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
import { useToast } from "@/components/ui/toaster";

interface Props {
  userId: string;
  email: string;
}

type Stage = "closed" | "stage1" | "stage2" | "stage3";

export function DangerZone({ userId, email }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [stage, setStage] = React.useState<Stage>("closed");
  const [confirmText, setConfirmText] = React.useState("");
  const [countdown, setCountdown] = React.useState(5);
  const [deleting, setDeleting] = React.useState(false);
  const [adminPassword, setAdminPassword] = React.useState("");

  const expectedConfirm = `DELETE ${email}`;
  const matchesConfirm = confirmText === expectedConfirm;

  React.useEffect(() => {
    if (stage !== "stage3") {
      setCountdown(5);
      return;
    }
    if (countdown <= 0) return;
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [stage, countdown]);

  function reset() {
    setStage("closed");
    setConfirmText("");
    setCountdown(5);
    setAdminPassword("");
  }

  async function confirmDelete() {
    setDeleting(true);
    try {
      const res = await fetch(
        `/api/admin/users/${userId}?confirm=DELETE-USER-${userId}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ adminPassword }),
        },
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error ?? "Löschen fehlgeschlagen.");
      }
      toast({ title: "User gelöscht.", variant: "success" });
      router.push("/admin/users");
      router.refresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Löschen fehlgeschlagen.";
      toast({ title: msg, variant: "danger" });
      reset();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div className="rounded-squircle-md border border-danger/30 bg-danger-soft p-6">
        <div className="flex items-start gap-4">
          <div className="flex size-10 items-center justify-center rounded-squircle-sm bg-danger/10 text-danger shrink-0">
            <AlertTriangle className="size-5" />
          </div>
          <div className="flex-1">
            <h3 className="text-base font-semibold text-ink">
              User unwiderruflich löschen
            </h3>
            <p className="text-sm text-ink-muted mt-1 leading-relaxed">
              Diese Aktion löscht den User und alle zugehörigen Daten
              unwiderruflich. Dazu gehören Kampagnen, Runs, Videos, PDFs und
              aktive Sessions. Eine Wiederherstellung ist nicht möglich.
            </p>
            <div className="mt-4">
              <Button
                variant="danger"
                iconLeft={<Trash2 className="size-4" />}
                onClick={() => setStage("stage1")}
                type="button"
              >
                User löschen
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Stage 1: Initial confirm */}
      <Dialog
        open={stage === "stage1"}
        onOpenChange={(open) => !open && reset()}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Bist du sicher?</DialogTitle>
            <DialogDescription>
              Wenn du fortfährst, werden die folgenden Daten unwiderruflich
              gelöscht:
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 text-sm text-ink space-y-1.5">
            <li>Alle Kampagnen dieses Users</li>
            <li>Alle Runden inkl. Lead-Daten</li>
            <li>Alle generierten Videos auf Bunny Stream</li>
            <li>Alle generierten PDFs auf Bunny Storage</li>
            <li>Mediathek-Inhalte (Webcam-Aufnahmen, Bilder, Logos)</li>
            <li>Alle aktiven Login-Sessions</li>
          </ul>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={reset}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              type="button"
              onClick={() => setStage("stage2")}
            >
              Weiter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stage 2: Type-confirm */}
      <Dialog
        open={stage === "stage2"}
        onOpenChange={(open) => !open && reset()}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Bestätigung erforderlich</DialogTitle>
            <DialogDescription>
              Tippe exakt <code className="font-mono text-ink font-semibold">
                {expectedConfirm}
              </code>{" "}
              in das Feld, um fortzufahren.
            </DialogDescription>
          </DialogHeader>
          <div>
            <Label htmlFor="confirm-text">Bestätigung</Label>
            <Input
              id="confirm-text"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={expectedConfirm}
              autoComplete="off"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" type="button" onClick={reset}>
              Abbrechen
            </Button>
            <Button
              variant="danger"
              type="button"
              disabled={!matchesConfirm}
              onClick={() => setStage("stage3")}
            >
              Endgültig löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Stage 3: Final countdown */}
      <Dialog
        open={stage === "stage3"}
        onOpenChange={(open) => {
          if (!open && !deleting) reset();
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Letzte Warnung</DialogTitle>
            <DialogDescription>
              Der User <span className="font-semibold text-ink">{email}</span>{" "}
              wird in Kürze unwiderruflich gelöscht.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col items-center justify-center py-6">
            <div className="flex size-20 items-center justify-center rounded-full bg-danger-soft text-danger">
              <span className="text-3xl font-bold">{countdown}</span>
            </div>
            <p className="text-sm text-ink-muted mt-4">
              {countdown > 0
                ? "Bitte warte, bis der Countdown abgelaufen ist."
                : "Du kannst jetzt löschen."}
            </p>
          </div>
          <div>
            <Label htmlFor="delete-admin-password">Dein Admin-Passwort zur Bestätigung</Label>
            <Input
              id="delete-admin-password"
              type="password"
              autoComplete="current-password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              type="button"
              onClick={reset}
              disabled={deleting}
            >
              Abbrechen
            </Button>
            <Button
              variant="danger"
              type="button"
              disabled={countdown > 0 || deleting || adminPassword.length === 0}
              loading={deleting}
              onClick={confirmDelete}
              iconLeft={<Trash2 className="size-4" />}
            >
              Jetzt löschen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
