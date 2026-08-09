"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, KeyRound, Mail, Save } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { getInitials } from "@/lib/utils";
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
import { runStatusLabel, runStatusVariant } from "@/lib/run-status";
import { DangerZone } from "./danger-zone";
import { RunLeadsPanel } from "./run-leads-panel";

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

export interface AdminRunSummary {
  id: string;
  name: string;
  status: string;
  totalLeads: number;
  completedLeads: number;
  failedLeads: number;
  createdAt: string;
}

export interface AdminCampaignSummary {
  id: string;
  name: string;
  createdAt: string;
  runs: AdminRunSummary[];
}

export interface AdminCreditTx {
  id: string;
  kind: string;
  delta: number;
  balanceAfter: number;
  reason: string | null;
  stripeRef: string | null;
  createdAt: string;
}

interface Props {
  initialUser: AdminUserDetail;
  stats: { campaigns: number; runs: number; media: number };
  campaigns: AdminCampaignSummary[];
  creditBalance: number;
  creditHistory: AdminCreditTx[];
  initialTab: string;
}

const CREDIT_KIND_LABELS: Record<string, string> = {
  topup: "Kauf (Stripe)",
  video_charge: "Video-Produktion",
  admin_adjust: "Manuelle Korrektur",
  promo_grant: "Promo-Gutschrift",
  email_charge: "E-Mail-Versand",
  email_refund: "E-Mail-Erstattung",
};

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

export function UserDetailClient({
  initialUser,
  stats,
  campaigns,
  creditBalance,
  creditHistory,
  initialTab,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();
  const [user, setUser] = React.useState<AdminUserDetail>(initialUser);
  const [tab, setTab] = React.useState(
    ["profile", "campaigns", "credits", "security", "activity", "danger"].includes(
      initialTab,
    )
      ? initialTab
      : "profile",
  );
  const [saving, setSaving] = React.useState(false);
  const [pwSetting, setPwSetting] = React.useState(false);
  const [newPassword, setNewPassword] = React.useState("");
  const [creditAmount, setCreditAmount] = React.useState("");
  const [creditDirection, setCreditDirection] = React.useState<"add" | "remove">(
    "add",
  );
  const [creditReason, setCreditReason] = React.useState("");
  const [creditSaving, setCreditSaving] = React.useState(false);
  const [expandedRunId, setExpandedRunId] = React.useState<string | null>(null);

  async function submitCreditAdjust(e: React.FormEvent) {
    e.preventDefault();
    const amount = Number(creditAmount);
    if (!Number.isInteger(amount) || amount <= 0) {
      toast({
        title: "Ungültige Menge",
        description: "Bitte eine positive ganze Zahl eingeben.",
        variant: "danger",
      });
      return;
    }
    if (creditReason.trim().length < 3) {
      toast({
        title: "Grund fehlt",
        description: "Bitte einen Grund angeben (mind. 3 Zeichen).",
        variant: "danger",
      });
      return;
    }
    setCreditSaving(true);
    try {
      const res = await fetch("/api/admin/billing/adjust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          delta: creditDirection === "add" ? amount : -amount,
          reason: creditReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({
          title: data.error ?? "Anpassung fehlgeschlagen.",
          variant: "danger",
        });
        return;
      }
      toast({
        title: `Credits ${creditDirection === "add" ? "gutgeschrieben" : "abgezogen"}.`,
        description: `Neuer Stand: ${data.balanceAfter} Credits`,
        variant: "success",
      });
      setCreditAmount("");
      setCreditReason("");
      router.refresh();
    } catch {
      toast({ title: "Verbindung fehlgeschlagen.", variant: "danger" });
    } finally {
      setCreditSaving(false);
    }
  }

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
            <TabsTrigger value="campaigns">Kampagnen</TabsTrigger>
            <TabsTrigger value="credits">Credits</TabsTrigger>
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

          <TabsContent value="campaigns">
            {campaigns.length === 0 ? (
              <Card>
                <CardContent className="pt-6">
                  <p className="text-sm text-ink-muted">
                    Dieser User hat noch keine Kampagnen.
                  </p>
                </CardContent>
              </Card>
            ) : (
              <div className="flex flex-col gap-4">
                {campaigns.map((c) => (
                  <Card key={c.id}>
                    <CardHeader>
                      <div className="flex items-baseline justify-between gap-3">
                        <CardTitle>{c.name}</CardTitle>
                        <span className="text-xs text-ink-muted shrink-0">
                          erstellt {formatDateTime(c.createdAt)}
                        </span>
                      </div>
                    </CardHeader>
                    <CardContent>
                      {c.runs.length === 0 ? (
                        <p className="text-sm text-ink-muted">
                          Noch keine Runden.
                        </p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs uppercase tracking-wider text-ink-muted border-b border-line">
                                <th className="py-2 pr-3 font-semibold">Runde</th>
                                <th className="py-2 pr-3 font-semibold">Status</th>
                                <th className="py-2 pr-3 font-semibold">Leads</th>
                                <th className="py-2 pr-3 font-semibold">Erstellt</th>
                                <th className="py-2 font-semibold">Details</th>
                              </tr>
                            </thead>
                            <tbody>
                              {c.runs.map((r) => (
                                <React.Fragment key={r.id}>
                                  <tr className="border-b border-line/60 last:border-0">
                                    <td className="py-2 pr-3 text-ink">
                                      <span className="font-medium">{r.name}</span>
                                      <span className="block text-[11px] text-ink-muted font-mono">
                                        {r.id}
                                      </span>
                                    </td>
                                    <td className="py-2 pr-3">
                                      <Badge variant={runStatusVariant(r.status)} dot>
                                        {runStatusLabel(r.status)}
                                      </Badge>
                                    </td>
                                    <td className="py-2 pr-3 text-ink whitespace-nowrap">
                                      {r.completedLeads}/{r.totalLeads}
                                      {r.failedLeads > 0 ? (
                                        <span className="text-danger">
                                          {" "}
                                          ({r.failedLeads} Fehler)
                                        </span>
                                      ) : null}
                                    </td>
                                    <td className="py-2 pr-3 text-ink-muted whitespace-nowrap">
                                      {formatDateTime(r.createdAt)}
                                    </td>
                                    <td className="py-2">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedRunId((cur) =>
                                            cur === r.id ? null : r.id,
                                          )
                                        }
                                        aria-expanded={expandedRunId === r.id}
                                        className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-3 py-1 text-xs font-semibold text-ink hover:bg-surface-muted transition-colors"
                                      >
                                        Leads
                                        <ChevronDown
                                          className={`size-3.5 text-brand-deep transition-transform ${
                                            expandedRunId === r.id
                                              ? "rotate-180"
                                              : ""
                                          }`}
                                        />
                                      </button>
                                    </td>
                                  </tr>
                                  {expandedRunId === r.id ? (
                                    <tr className="border-b border-line/60 last:border-0">
                                      <td colSpan={5} className="p-0">
                                        <RunLeadsPanel runId={r.id} />
                                      </td>
                                    </tr>
                                  ) : null}
                                </React.Fragment>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          <TabsContent value="credits">
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Card>
                  <CardContent className="pt-6">
                    <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
                      Aktueller Credit-Stand
                    </p>
                    <p className="text-3xl font-bold text-ink mt-2">
                      {creditBalance}
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">
                      Credits manuell anpassen
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <form
                      onSubmit={submitCreditAdjust}
                      className="flex flex-col gap-3"
                    >
                      <div className="flex gap-2">
                        <Select
                          value={creditDirection}
                          onValueChange={(v: "add" | "remove") =>
                            setCreditDirection(v)
                          }
                        >
                          <SelectTrigger className="w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="add">Gutschreiben</SelectItem>
                            <SelectItem value="remove">Abziehen</SelectItem>
                          </SelectContent>
                        </Select>
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          placeholder="Anzahl"
                          value={creditAmount}
                          onChange={(e) => setCreditAmount(e.target.value)}
                        />
                      </div>
                      <Input
                        placeholder="Grund (Pflicht, landet im Verlauf)"
                        value={creditReason}
                        onChange={(e) => setCreditReason(e.target.value)}
                        maxLength={500}
                      />
                      <div>
                        <Button type="submit" loading={creditSaving}>
                          Anpassen
                        </Button>
                      </div>
                    </form>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader>
                  <CardTitle>Credit-Verlauf (letzte 100)</CardTitle>
                </CardHeader>
                <CardContent>
                  {creditHistory.length === 0 ? (
                    <p className="text-sm text-ink-muted">
                      Noch keine Credit-Bewegungen.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wider text-ink-muted border-b border-line">
                            <th className="py-2 pr-3 font-semibold">Datum</th>
                            <th className="py-2 pr-3 font-semibold">Typ</th>
                            <th className="py-2 pr-3 font-semibold text-right">
                              Änderung
                            </th>
                            <th className="py-2 pr-3 font-semibold text-right">
                              Stand danach
                            </th>
                            <th className="py-2 font-semibold">Grund / Referenz</th>
                          </tr>
                        </thead>
                        <tbody>
                          {creditHistory.map((t) => (
                            <tr
                              key={t.id}
                              className="border-b border-line/60 last:border-0"
                            >
                              <td className="py-2 pr-3 text-ink-muted whitespace-nowrap">
                                {formatDateTime(t.createdAt)}
                              </td>
                              <td className="py-2 pr-3 text-ink">
                                {CREDIT_KIND_LABELS[t.kind] ?? t.kind}
                              </td>
                              <td
                                className={`py-2 pr-3 text-right font-medium whitespace-nowrap ${
                                  t.delta >= 0 ? "text-success" : "text-danger"
                                }`}
                              >
                                {t.delta >= 0 ? `+${t.delta}` : t.delta}
                              </td>
                              <td className="py-2 pr-3 text-right text-ink whitespace-nowrap">
                                {t.balanceAfter}
                              </td>
                              <td className="py-2 text-ink-muted max-w-[280px] truncate">
                                {t.reason ?? t.stripeRef ?? "–"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
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
