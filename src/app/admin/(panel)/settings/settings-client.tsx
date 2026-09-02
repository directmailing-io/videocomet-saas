"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Save, ShieldCheck, ShieldOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toaster";

interface AdminProfile {
  id: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
}

interface Props {
  initialProfile: AdminProfile;
  totpEnabled: boolean;
}

export function AdminSettingsClient({ initialProfile, totpEnabled }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  // ── Zwei-Faktor (TOTP) ────────────────────────────────────────────────
  const [tfaEnabled, setTfaEnabled] = React.useState(totpEnabled);
  const [tfaSetup, setTfaSetup] = React.useState<{ qrDataUrl: string; manualKey: string; setupToken: string } | null>(null);
  const [tfaCode, setTfaCode] = React.useState("");
  const [tfaPw, setTfaPw] = React.useState("");
  const [tfaBusy, setTfaBusy] = React.useState(false);

  async function startTfaSetup() {
    setTfaBusy(true);
    try {
      const res = await fetch("/api/admin/totp", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Einrichtung konnte nicht gestartet werden.");
      setTfaSetup(data);
      setTfaCode("");
      setTfaPw("");
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Fehler", variant: "danger" });
    } finally {
      setTfaBusy(false);
    }
  }

  async function confirmTfaSetup(e: React.FormEvent) {
    e.preventDefault();
    if (!tfaSetup) return;
    setTfaBusy(true);
    try {
      const res = await fetch("/api/admin/totp", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ setupToken: tfaSetup.setupToken, code: tfaCode, adminPassword: tfaPw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Aktivierung fehlgeschlagen.");
      setTfaEnabled(true);
      setTfaSetup(null);
      setTfaCode("");
      setTfaPw("");
      toast({ title: "Zwei-Faktor-Anmeldung ist aktiv.", description: "Beim nächsten Login wird zusätzlich der Code aus deiner App abgefragt.", variant: "success" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Fehler", variant: "danger" });
    } finally {
      setTfaBusy(false);
    }
  }

  async function disableTfa(e: React.FormEvent) {
    e.preventDefault();
    setTfaBusy(true);
    try {
      const res = await fetch("/api/admin/totp", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: tfaCode, adminPassword: tfaPw }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Deaktivierung fehlgeschlagen.");
      setTfaEnabled(false);
      setTfaCode("");
      setTfaPw("");
      toast({ title: "Zwei-Faktor-Anmeldung ist aus.", variant: "success" });
    } catch (err) {
      toast({ title: err instanceof Error ? err.message : "Fehler", variant: "danger" });
    } finally {
      setTfaBusy(false);
    }
  }
  const [profile, setProfile] = React.useState(initialProfile);
  const [savingProfile, setSavingProfile] = React.useState(false);
  const [savingPassword, setSavingPassword] = React.useState(false);
  const [currentPw, setCurrentPw] = React.useState("");
  const [newPw, setNewPw] = React.useState("");
  const [newPw2, setNewPw2] = React.useState("");

  function setField<K extends keyof AdminProfile>(
    key: K,
    value: AdminProfile[K],
  ) {
    setProfile((p) => ({ ...p, [key]: value }));
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    try {
      const res = await fetch(`/api/admin/users/${profile.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: profile.email,
          firstName: profile.firstName,
          lastName: profile.lastName,
          phone: profile.phone,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: data.error ?? "Speichern fehlgeschlagen.",
          variant: "danger",
        });
        return;
      }
      toast({ title: "Profil gespeichert.", variant: "success" });
      router.refresh();
    } catch {
      toast({ title: "Verbindung fehlgeschlagen.", variant: "danger" });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== newPw2) {
      toast({
        title: "Passwörter stimmen nicht überein.",
        variant: "danger",
      });
      return;
    }
    if (newPw.length < 8) {
      toast({
        title: "Passwort zu kurz",
        description: "Mindestens 8 Zeichen erforderlich.",
        variant: "danger",
      });
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch("/api/auth/password-change", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: currentPw,
          newPassword: newPw,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({
          title: data.error ?? "Passwortwechsel fehlgeschlagen.",
          variant: "danger",
        });
        return;
      }
      toast({ title: "Passwort geändert.", variant: "success" });
      setCurrentPw("");
      setNewPw("");
      setNewPw2("");
    } catch {
      toast({ title: "Verbindung fehlgeschlagen.", variant: "danger" });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <form onSubmit={saveProfile}>
        <Card>
          <CardHeader>
            <CardTitle>Profil</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="firstName">Vorname</Label>
              <Input
                id="firstName"
                value={profile.firstName ?? ""}
                onChange={(e) =>
                  setField("firstName", e.target.value || null)
                }
              />
            </div>
            <div>
              <Label htmlFor="lastName">Nachname</Label>
              <Input
                id="lastName"
                value={profile.lastName ?? ""}
                onChange={(e) => setField("lastName", e.target.value || null)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="email">E-Mail-Adresse</Label>
              <Input
                id="email"
                type="email"
                required
                value={profile.email}
                onChange={(e) => setField("email", e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="phone">Telefon</Label>
              <Input
                id="phone"
                value={profile.phone ?? ""}
                onChange={(e) => setField("phone", e.target.value || null)}
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 mt-4">
          <Button
            type="submit"
            loading={savingProfile}
            iconLeft={<Save className="size-4" />}
          >
            Profil speichern
          </Button>
        </div>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {tfaEnabled ? <ShieldCheck className="size-4 text-success" /> : <ShieldOff className="size-4 text-ink-muted" />}
            Zwei-Faktor-Anmeldung
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4">
          <p className="text-sm text-ink-muted">
            {tfaEnabled
              ? "Aktiv. Beim Login wird zusätzlich zum Passwort ein 6-stelliger Code aus deiner Authenticator-App abgefragt. Ohne dein Handy kommt niemand in den Admin-Bereich, auch nicht mit deinem Passwort."
              : "Aus. Empfohlen: Mit einer Authenticator-App (Google Authenticator, 1Password, Apple Passwörter) wird der Admin-Login zusätzlich zum Passwort mit einem Code geschützt."}
          </p>

          {!tfaEnabled && !tfaSetup && (
            <div>
              <Button type="button" onClick={startTfaSetup} loading={tfaBusy} iconLeft={<ShieldCheck className="size-4" />}>
                Zwei-Faktor einrichten
              </Button>
            </div>
          )}

          {!tfaEnabled && tfaSetup && (
            <form onSubmit={confirmTfaSetup} className="grid grid-cols-1 gap-4 sm:grid-cols-[220px_1fr]">
              <div className="flex flex-col items-center gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={tfaSetup.qrDataUrl} alt="QR-Code für die Authenticator-App" width={220} height={220} className="rounded-squircle-sm border border-line" />
                <p className="text-[11px] text-ink-muted text-center break-all">
                  Manuell: <span className="font-mono">{tfaSetup.manualKey}</span>
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3">
                <p className="text-sm text-ink">
                  1. QR-Code mit deiner Authenticator-App scannen.<br />
                  2. Den angezeigten 6-stelligen Code und dein Passwort eingeben.
                </p>
                <div>
                  <Label htmlFor="tfa-code">Code aus der App</Label>
                  <Input id="tfa-code" inputMode="numeric" autoComplete="one-time-code" value={tfaCode} onChange={(e) => setTfaCode(e.target.value)} placeholder="123456" required />
                </div>
                <div>
                  <Label htmlFor="tfa-pw">Dein Admin-Passwort</Label>
                  <Input id="tfa-pw" type="password" autoComplete="current-password" value={tfaPw} onChange={(e) => setTfaPw(e.target.value)} required />
                </div>
                <div className="flex gap-3">
                  <Button type="submit" loading={tfaBusy}>Aktivieren</Button>
                  <Button type="button" variant="ghost" onClick={() => setTfaSetup(null)} disabled={tfaBusy}>Abbrechen</Button>
                </div>
              </div>
            </form>
          )}

          {tfaEnabled && (
            <form onSubmit={disableTfa} className="grid grid-cols-1 gap-3 sm:grid-cols-3 sm:items-end">
              <div>
                <Label htmlFor="tfa-off-code">Aktueller Code</Label>
                <Input id="tfa-off-code" inputMode="numeric" autoComplete="one-time-code" value={tfaCode} onChange={(e) => setTfaCode(e.target.value)} placeholder="123456" required />
              </div>
              <div>
                <Label htmlFor="tfa-off-pw">Dein Admin-Passwort</Label>
                <Input id="tfa-off-pw" type="password" autoComplete="current-password" value={tfaPw} onChange={(e) => setTfaPw(e.target.value)} required />
              </div>
              <div>
                <Button type="submit" variant="ghost" loading={tfaBusy} iconLeft={<ShieldOff className="size-4" />}>
                  Zwei-Faktor ausschalten
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>

      <form onSubmit={changePassword}>
        <Card>
          <CardHeader>
            <CardTitle>Passwort ändern</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4">
            <div>
              <Label htmlFor="currentPw">Aktuelles Passwort</Label>
              <Input
                id="currentPw"
                type="password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                required
                autoComplete="current-password"
              />
            </div>
            <div>
              <Label htmlFor="newPw">Neues Passwort</Label>
              <Input
                id="newPw"
                type="password"
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
            <div>
              <Label htmlFor="newPw2">Neues Passwort bestätigen</Label>
              <Input
                id="newPw2"
                type="password"
                value={newPw2}
                onChange={(e) => setNewPw2(e.target.value)}
                required
                minLength={8}
                autoComplete="new-password"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3 mt-4">
          <Button
            type="submit"
            loading={savingPassword}
            iconLeft={<KeyRound className="size-4" />}
          >
            Passwort ändern
          </Button>
        </div>
      </form>
    </div>
  );
}
