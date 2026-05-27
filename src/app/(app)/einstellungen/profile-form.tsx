"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface ProfileFormValues {
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  companyName: string;
  vatId: string;
}

export interface ProfileFormProps {
  initialValues: ProfileFormValues;
}

export function ProfileForm({ initialValues }: ProfileFormProps) {
  const [values, setValues] = React.useState<ProfileFormValues>(initialValues);
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  function update<K extends keyof ProfileFormValues>(
    key: K,
    val: ProfileFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: values.firstName || null,
          lastName: values.lastName || null,
          phone: values.phone || null,
          companyName: values.companyName || null,
          vatId: values.vatId || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(data?.error ?? "Speichern fehlgeschlagen.");
      } else {
        setMessage("Aenderungen gespeichert.");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Fehler beim Speichern.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <div>
          <Label htmlFor="firstName">Vorname</Label>
          <Input
            id="firstName"
            value={values.firstName}
            onChange={(e) => update("firstName", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="lastName">Nachname</Label>
          <Input
            id="lastName"
            value={values.lastName}
            onChange={(e) => update("lastName", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="email">E-Mail</Label>
          <Input
            id="email"
            type="email"
            value={values.email}
            disabled
            readOnly
          />
        </div>
        <div>
          <Label htmlFor="phone">Telefon</Label>
          <Input
            id="phone"
            type="tel"
            value={values.phone}
            onChange={(e) => update("phone", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="companyName">Firma</Label>
          <Input
            id="companyName"
            value={values.companyName}
            onChange={(e) => update("companyName", e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="vatId">USt-ID</Label>
          <Input
            id="vatId"
            value={values.vatId}
            onChange={(e) => update("vatId", e.target.value)}
          />
        </div>
      </div>

      {message && (
        <p className="text-sm text-ink-muted">{message}</p>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={submitting}>
          Speichern
        </Button>
      </div>
    </form>
  );
}

export interface BillingFormValues {
  billingStreet: string;
  billingZip: string;
  billingCity: string;
  billingCountry: string;
}

export interface BillingFormProps {
  initialValues: BillingFormValues;
}

export function BillingForm({ initialValues }: BillingFormProps) {
  const [values, setValues] = React.useState<BillingFormValues>(initialValues);
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);

  function update<K extends keyof BillingFormValues>(
    key: K,
    val: BillingFormValues[K],
  ) {
    setValues((v) => ({ ...v, [key]: val }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/me", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          billingStreet: values.billingStreet || null,
          billingZip: values.billingZip || null,
          billingCity: values.billingCity || null,
          billingCountry: values.billingCountry || "DE",
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setMessage(data?.error ?? "Speichern fehlgeschlagen.");
      } else {
        setMessage("Rechnungsadresse gespeichert.");
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Fehler.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-2xl">
      <div>
        <Label htmlFor="billingStreet">Strasse</Label>
        <Input
          id="billingStreet"
          value={values.billingStreet}
          onChange={(e) => update("billingStreet", e.target.value)}
        />
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div>
          <Label htmlFor="billingZip">PLZ</Label>
          <Input
            id="billingZip"
            value={values.billingZip}
            onChange={(e) => update("billingZip", e.target.value)}
          />
        </div>
        <div className="col-span-2">
          <Label htmlFor="billingCity">Ort</Label>
          <Input
            id="billingCity"
            value={values.billingCity}
            onChange={(e) => update("billingCity", e.target.value)}
          />
        </div>
      </div>
      <div>
        <Label htmlFor="billingCountry">Land</Label>
        <Input
          id="billingCountry"
          value={values.billingCountry}
          onChange={(e) => update("billingCountry", e.target.value)}
          placeholder="DE"
        />
      </div>

      {message && (
        <p className="text-sm text-ink-muted">{message}</p>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={submitting}>
          Speichern
        </Button>
      </div>
    </form>
  );
}
