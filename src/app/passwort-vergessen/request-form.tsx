"use client";

import { useState } from "react";
import { Mail, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function RequestForm() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!res.ok) {
        // The endpoint always returns 200 for valid payload; treat anything else as error.
        const data = await res.json().catch(() => ({}));
        setError(data?.error ?? "Anfrage fehlgeschlagen. Bitte erneut versuchen.");
        setLoading(false);
        return;
      }
      setSent(true);
      setLoading(false);
    } catch {
      setError("Verbindung zum Server fehlgeschlagen.");
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col items-center gap-3 py-4 text-center">
        <div className="size-12 rounded-full bg-brand-soft text-brand-deep flex items-center justify-center">
          <CheckCircle2 className="size-6" />
        </div>
        <h2 className="text-base font-semibold text-ink">E-Mail unterwegs</h2>
        <p className="text-sm text-ink-muted leading-relaxed">
          Wenn das Konto existiert, ist eine E-Mail unterwegs. Schau in dein Postfach
          und klicke auf den Link, um ein neues Passwort zu vergeben. Der Link ist 60
          Minuten gültig.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <Label htmlFor="email">E-Mail-Adresse</Label>
        <Input
          id="email"
          type="email"
          autoComplete="email"
          required
          icon={<Mail />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="du@firma.de"
          disabled={loading}
        />
      </div>

      {error && (
        <div className="bg-danger-soft border border-danger/20 text-danger rounded-squircle-sm px-4 py-3 text-sm">
          {error}
        </div>
      )}

      <Button type="submit" className="w-full" loading={loading}>
        Reset-Link senden
      </Button>
    </form>
  );
}
