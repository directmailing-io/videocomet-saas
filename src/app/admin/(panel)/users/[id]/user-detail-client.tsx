"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { KeyRound, Mail, Save } from "lucide-react";
import { Avatar, AvatarFallback, getInitials } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/toaster";
import { DangerZone } from "./danger-zone";

export interface AdminUserDetail {
  id: string;
  email: string;
  role: "admin" | "user";
  isActive: boolean;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  companyName: string | null;
  vatId: string | null;
  billingStreet: string | null;
  billingZip: string | null;
  billingCity: string | null;
  billingCountry: string | null;
  createdAt: string | null;
  lastLoginAt: string | null;
}

interface Props {
  initialUser: AdminUserDetail;
  stats: { campaigns: number; runs: number; media: number };
  initialTab: string;
}

function formatDateTime(d: string | null): string {
  if (!d) return "nie";
  return new Date(d).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UserDetailClient({ initialUser, stats, initialTab }: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = React.useState<AdminUserDetail>(initialUser);
  const [tab, setTab] = React.useState(
    ["profile", "security", "activity", "danger"].includes(initialTab)
      ? initialTab
      : "profile",
  );
  const [saving, setSaving] = React.useState(false);
  const [pwSetting, setPwSetting] = React.useState(false);
  const [newPassword, setNewPassword] = React.useState("");

  const initials = getInitials(user.firstName, user.lastName, user.email);
  const displayName =
    [user.firstName, user.lastName].filter(Boolean).join(" ") || user.email;

  async function toggleActive(next: boolean) {
    const path = next
      ? `/api/admin/users/${user.id}/activate`
      : `/api/admin/users/${user.id}/deactivate`;
    try {
      const res = await fetch(path, { method: "POST" });
      if (!res.ok) throw new Error();
      setUser((u) => ({ ...u, isActive: next }));
      toast({
        title: next ? "User aktiviert" : "User deaktiviert",
        variant: "success",
      });
    } catch {
      toast({ title: "Aktion fehlgeschlagen.", variant: "danger" });
    }
  }

  async function sendResetMail() {
    try {
      const res = await fetch(`/api/admin/users/${user.id}/send-reset`, {
        method: "POST",
      });
      if (!res.ok) throw new Error();
      toast({ title: "Reset-Mail gesendet.", variant: "success" });
    } catch {
      toast({ title: "Mail-Versand fehlgeschlagen.", variant: "danger" });
    }
  }

  async function setPassword() {
    if (newPassword.length < 8) {
      toast({
        title: "Passwort zu kurz",
        description: "Mindestens 8 Zeichen erforderlich.",
        variant: "danger",
      });
      return;
    }
    setPwSetting(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/set-password`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "Passwort gesetzt.", variant: "success" });
      setNewPassword("");
    } catch {
      toast({ title: "Passwort konnte nicht gesetzt werden.", variant: "danger" });
    } finally {
      setPwSetting(false);
    }
  }

  async function saveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          phone: user.phone,
          companyName: user.companyName,
          vatId: user.vatId,
          billingStreet: user.billingStreet,
          billingZip: user.billingZip,
          billingCity: user.billingCity,
          billingCountry: user.billingCountry,
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
      setSaving(false);
    }
  }

  function setField<K extends keyof AdminUserDetail>(
    key: K,
    value: AdminUserDetail[K],
  ) {
    setUser((u) => ({ ...u, [key]: value }));
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-6">
      <div className="flex flex-col gap-4">
        <Card>
          <CardContent className="flex flex-col items-center gap-4 pt-6">
            <Avatar size="lg" className="size-16 text-lg">
              <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
            <div className="text-center min-w-0 w-full">
              <h2 className="text-base font-semibold text-ink truncate">
                {displayName}
              </h2>
              <p className="text-xs text-ink-muted truncate">{user.email}</p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Badge variant={user.role === "admin" ? "brand" : "neutral"}>
                {user.role === "admin" ? "Admin" : "User"}
              </Badge>
              <Badge variant={user.isActive ? "success" : "neutral"} dot>
                {user.isActive ? "Aktiv" : "Inaktiv"}
              </Badge>
            </div>
            <div className="w-full border-t border-line pt-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Account aktiv</p>
                  <p className="text-xs text-ink-muted mt-0.5">
                    {user.isActive
                      ? "Login möglich."
                      : "Login blockiert."}
                  </p>
                </div>
                <Switch
                  checked={user.isActive}
                  onCheckedChange={(v) => toggleActive(Boolean(v))}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Schnell-Aktionen</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            <Button
              variant="ghost"
              iconLeft={<Mail className="size-4" />}
              onClick={sendResetMail}
              type="button"
            >
              Reset-Mail senden
            </Button>
            <Button
              variant="ghost"
              iconLeft={<KeyRound className="size-4" />}
              type="button"
              onClick={() => setTab("security")}
            >
              Passwort setzen
            </Button>
          </CardContent>
        </Card>
      </div>

      <div>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="profile">Profil</TabsTrigger>
            <TabsTrigger value="security">Sicherheit</TabsTrigger>
            <TabsTrigger value="activity">Aktivität</TabsTrigger>
            <TabsTrigger value="danger">Gefahrenzone</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <form onSubmit={saveProfile} className="flex flex-col gap-6">
              <Card>
                <CardHeader>
                  <CardTitle>Persönliche Daten</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="firstName">Vorname</Label>
                    <Input
                      id="firstName"
                      value={user.firstName ?? ""}
                      onChange={(e) => setField("firstName", e.target.value || null)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="lastName">Nachname</Label>
                    <Input
                      id="lastName"
                      value={user.lastName ?? ""}
                      onChange={(e) => setField("lastName", e.target.value || null)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="email">E-Mail-Adresse *</Label>
                    <Input
                      id="email"
                      type="email"
                      required
                      value={user.email}
                      onChange={(e) => setField("email", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="phone">Telefon</Label>
                    <Input
                      id="phone"
                      value={user.phone ?? ""}
                      onChange={(e) => setField("phone", e.target.value || null)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="role">Rolle</Label>
                    <Select
                      value={user.role}
                      onValueChange={(v: "admin" | "user") => setField("role", v)}
                    >
                      <SelectTrigger id="role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="user">User</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Firma</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label htmlFor="companyName">Firmenname</Label>
                    <Input
                      id="companyName"
                      value={user.companyName ?? ""}
                      onChange={(e) =>
                        setField("companyName", e.target.value || null)
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="vatId">USt-ID</Label>
                    <Input
                      id="vatId"
                      value={user.vatId ?? ""}
                      onChange={(e) => setField("vatId", e.target.value || null)}
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Rechnungsadresse</CardTitle>
                </CardHeader>
                <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div className="sm:col-span-2">
                    <Label htmlFor="billingStreet">Straße &amp; Hausnummer</Label>
                    <Input
                      id="billingStreet"
                      value={user.billingStreet ?? ""}
                      onChange={(e) =>
                        setField("billingStreet", e.target.value || null)
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="billingZip">PLZ</Label>
                    <Input
                      id="billingZip"
                      value={user.billingZip ?? ""}
                      onChange={(e) =>
                        setField("billingZip", e.target.value || null)
                      }
                    />
                  </div>
                  <div>
                    <Label htmlFor="billingCity">Ort</Label>
                    <Input
                      id="billingCity"
                      value={user.billingCity ?? ""}
                      onChange={(e) =>
                        setField("billingCity", e.target.value || null)
                      }
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <Label htmlFor="billingCountry">Land</Label>
                    <Input
                      id="billingCountry"
                      value={user.billingCountry ?? ""}
                      onChange={(e) =>
                        setField("billingCountry", e.target.value || null)
                      }
                    />
                  </div>
                </CardContent>
              </Card>

              <div className="flex justify-end gap-3">
                <Button
                  type="submit"
                  loading={saving}
                  iconLeft={<Save className="size-4" />}
                >
                  Profil speichern
                </Button>
              </div>
            </form>
          </TabsContent>

          <TabsContent value="security">
            <Card>
              <CardHeader>
                <CardTitle>Passwort manuell setzen</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <p className="text-sm text-ink-muted">
                  Setzt das Passwort sofort. Der User wird nicht benachrichtigt.
                  Für eine Benachrichtigung nutze "Reset-Mail senden".
                </p>
                <div>
                  <Label htmlFor="newPassword">Neues Passwort (mind. 8 Zeichen)</Label>
                  <Input
                    id="newPassword"
                    type="text"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Mindestens 8 Zeichen"
                    minLength={8}
                  />
                </div>
                <div>
                  <Button
                    type="button"
                    onClick={setPassword}
                    loading={pwSetting}
                    iconLeft={<KeyRound className="size-4" />}
                  >
                    Passwort setzen
                  </Button>
                </div>
              </CardContent>
            </Card>

            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Letzte Anmeldung</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-ink-muted">
                  {formatDateTime(user.lastLoginAt)}
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="activity">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Kampagnen
                  </p>
                  <p className="text-3xl font-bold text-ink mt-2">
                    {stats.campaigns}
                  </p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Runden
                  </p>
                  <p className="text-3xl font-bold text-ink mt-2">{stats.runs}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="pt-6">
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                    Mediathek-Items
                  </p>
                  <p className="text-3xl font-bold text-ink mt-2">{stats.media}</p>
                </CardContent>
              </Card>
            </div>
            <Card className="mt-4">
              <CardHeader>
                <CardTitle>Konto-Info</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-ink-muted">Erstellt:</span>
                  <span className="text-ink">{formatDateTime(user.createdAt)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-ink-muted">Letzte Anmeldung:</span>
                  <span className="text-ink">{formatDateTime(user.lastLoginAt)}</span>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="danger">
            <DangerZone userId={user.id} email={user.email} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
