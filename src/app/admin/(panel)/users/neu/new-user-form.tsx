"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Save } from "lucide-react";
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
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/components/ui/toaster";

export function NewUserForm() {
  const router = useRouter();
  const { toast } = useToast();
  const [submitting, setSubmitting] = React.useState(false);
  const [autoPassword, setAutoPassword] = React.useState(true);
  const [sendInviteMail, setSendInviteMail] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [form, setForm] = React.useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    role: "user" as "admin" | "user",
    companyName: "",
    vatId: "",
    billingStreet: "",
    billingZip: "",
    billingCity: "",
    billingCountry: "DE",
    password: "",
  });

  function setField<K extends keyof typeof form>(key: K, value: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {
        email: form.email.trim(),
        role: form.role,
        sendInviteMail,
      };
      if (form.firstName.trim()) payload.firstName = form.firstName.trim();
      if (form.lastName.trim()) payload.lastName = form.lastName.trim();
      if (form.phone.trim()) payload.phone = form.phone.trim();
      if (form.companyName.trim()) payload.companyName = form.companyName.trim();
      if (form.vatId.trim()) payload.vatId = form.vatId.trim();
      if (form.billingStreet.trim()) payload.billingStreet = form.billingStreet.trim();
      if (form.billingZip.trim()) payload.billingZip = form.billingZip.trim();
      if (form.billingCity.trim()) payload.billingCity = form.billingCity.trim();
      if (form.billingCountry.trim()) payload.billingCountry = form.billingCountry.trim();
      if (!autoPassword && form.password.trim()) {
        payload.password = form.password;
      }

      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Anlegen fehlgeschlagen.");
        setSubmitting(false);
        return;
      }

      const newId = data.user?.id;
      const tempPw = data.tempPassword as string | undefined;
      toast({
        title: "User angelegt",
        description: tempPw
          ? `Temporäres Passwort: ${tempPw}`
          : "Account wurde erfolgreich erstellt.",
        variant: "success",
        duration: tempPw ? 15000 : 4000,
      });
      if (newId) {
        router.push(`/admin/users/${newId}`);
      } else {
        router.push("/admin/users");
      }
      router.refresh();
    } catch {
      setError("Verbindung zum Server fehlgeschlagen.");
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6 max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle>Persönliche Daten</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="firstName">Vorname</Label>
            <Input
              id="firstName"
              value={form.firstName}
              onChange={(e) => setField("firstName", e.target.value)}
              placeholder="Max"
            />
          </div>
          <div>
            <Label htmlFor="lastName">Nachname</Label>
            <Input
              id="lastName"
              value={form.lastName}
              onChange={(e) => setField("lastName", e.target.value)}
              placeholder="Mustermann"
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="email">E-Mail-Adresse *</Label>
            <Input
              id="email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setField("email", e.target.value)}
              placeholder="max@firma.de"
            />
          </div>
          <div>
            <Label htmlFor="phone">Telefon</Label>
            <Input
              id="phone"
              value={form.phone}
              onChange={(e) => setField("phone", e.target.value)}
              placeholder="+49 30 1234567"
            />
          </div>
          <div>
            <Label htmlFor="role">Rolle</Label>
            <Select
              value={form.role}
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
              value={form.companyName}
              onChange={(e) => setField("companyName", e.target.value)}
              placeholder="Musterfirma GmbH"
            />
          </div>
          <div>
            <Label htmlFor="vatId">USt-ID</Label>
            <Input
              id="vatId"
              value={form.vatId}
              onChange={(e) => setField("vatId", e.target.value)}
              placeholder="DE123456789"
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
              value={form.billingStreet}
              onChange={(e) => setField("billingStreet", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="billingZip">PLZ</Label>
            <Input
              id="billingZip"
              value={form.billingZip}
              onChange={(e) => setField("billingZip", e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="billingCity">Ort</Label>
            <Input
              id="billingCity"
              value={form.billingCity}
              onChange={(e) => setField("billingCity", e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="billingCountry">Land</Label>
            <Input
              id="billingCountry"
              value={form.billingCountry}
              onChange={(e) => setField("billingCountry", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Zugang</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-ink">
                Passwort automatisch erzeugen
              </p>
              <p className="text-xs text-ink-muted mt-0.5">
                Sicheres Zufallspasswort wird beim Anlegen erzeugt.
              </p>
            </div>
            <Switch
              checked={autoPassword}
              onCheckedChange={(v) => setAutoPassword(Boolean(v))}
            />
          </div>
          {!autoPassword && (
            <div>
              <Label htmlFor="password">Passwort (mind. 8 Zeichen)</Label>
              <Input
                id="password"
                type="text"
                value={form.password}
                onChange={(e) => setField("password", e.target.value)}
                placeholder="Mindestens 8 Zeichen"
                minLength={8}
              />
            </div>
          )}
          <div className="flex items-center justify-between gap-4 border-t border-line pt-5">
            <div>
              <p className="text-sm font-semibold text-ink">
                Setup-Mail mit Login-Daten senden
              </p>
              <p className="text-xs text-ink-muted mt-0.5">
                Schickt eine E-Mail mit Login-URL und temporärem Passwort.
              </p>
            </div>
            <Switch
              checked={sendInviteMail}
              onCheckedChange={(v) => setSendInviteMail(Boolean(v))}
            />
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-squircle-sm border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger">
          {error}
        </div>
      )}

      <div className="flex justify-end gap-3">
        <Button
          type="submit"
          loading={submitting}
          iconLeft={<Save className="size-4" />}
        >
          User anlegen
        </Button>
      </div>
    </form>
  );
}
