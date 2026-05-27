"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function LoginForm({ role }: { role: "user" | "admin" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password, expectedRole: role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Anmeldung fehlgeschlagen.");
        setLoading(false);
        return;
      }
      router.push(role === "admin" ? "/admin" : "/dashboard");
      router.refresh();
    } catch {
      setError("Verbindung zum Server fehlgeschlagen.");
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor="email" className="label">E-Mail-Adresse</label>
        <input
          id="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="du@firma.de"
          className="input"
          disabled={loading}
        />
      </div>

      <div>
        <label htmlFor="password" className="label">Passwort</label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Dein Passwort"
          className="input"
          disabled={loading}
        />
      </div>

      {error && (
        <div className="bg-danger-soft border border-danger/20 text-danger rounded-squircle-sm px-4 py-3 text-sm animate-fade-in">
          {error}
        </div>
      )}

      <button type="submit" className="btn-brand w-full" disabled={loading}>
        {loading ? "Anmelden …" : "Anmelden"}
      </button>
    </form>
  );
}
