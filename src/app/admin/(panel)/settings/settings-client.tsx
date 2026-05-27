"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Save } from "lucide-react";
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
}

export function AdminSettingsClient({ initialProfile }: Props) {
  const router = useRouter();
  const { toast } = useToast();
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
