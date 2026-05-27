"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function PasswordForm() {
  const [current, setCurrent] = React.useState("");
  const [next, setNext] = React.useState("");
  const [confirm, setConfirm] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setError(false);

    if (next.length < 10) {
      setError(true);
      setMessage("Das neue Passwort muss mindestens 10 Zeichen lang sein.");
      return;
    }
    if (next !== confirm) {
      setError(true);
      setMessage("Die Passwörter stimmen nicht überein.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/auth/password-change", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(true);
        setMessage(data?.error ?? "Passwort konnte nicht geaendert werden.");
      } else {
        setMessage("Passwort aktualisiert.");
        setCurrent("");
        setNext("");
        setConfirm("");
      }
    } catch (err) {
      setError(true);
      setMessage(err instanceof Error ? err.message : "Fehler.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5 max-w-md">
      <div>
        <Label htmlFor="current">Aktuelles Passwort</Label>
        <Input
          id="current"
          type="password"
          autoComplete="current-password"
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="new">Neues Passwort</Label>
        <Input
          id="new"
          type="password"
          autoComplete="new-password"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
      </div>
      <div>
        <Label htmlFor="confirm">Neues Passwort wiederholen</Label>
        <Input
          id="confirm"
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
      </div>

      {message && (
        <p
          className={
            error ? "text-sm text-danger" : "text-sm text-ink-muted"
          }
        >
          {message}
        </p>
      )}

      <div className="flex justify-end">
        <Button type="submit" loading={submitting}>
          Passwort aktualisieren
        </Button>
      </div>
    </form>
  );
}
