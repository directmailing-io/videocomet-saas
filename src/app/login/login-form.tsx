"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Mail, Lock, ArrowRight } from "lucide-react";

export function LoginForm({ role }: { role: "user" | "admin" }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Zwei-Faktor (nur Admin-Konten mit aktivem TOTP): nach korrektem
  // Passwort liefert /api/auth/login ein mfaToken, der Code kommt aus der
  // Authenticator-App.
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState("");

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
      if (data.mfaRequired && typeof data.mfaToken === "string") {
        setMfaToken(data.mfaToken);
        setMfaCode("");
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

  async function onSubmitMfa(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaToken) return;
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login/totp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mfaToken, code: mfaCode.replace(/\s+/g, "") }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Code konnte nicht geprüft werden.");
        setLoading(false);
        if (res.status === 401 && /abgelaufen/i.test(String(data.error ?? ""))) {
          setMfaToken(null);
        }
        return;
      }
      router.push(role === "admin" ? "/admin" : "/dashboard");
      router.refresh();
    } catch {
      setError("Verbindung zum Server fehlgeschlagen.");
      setLoading(false);
    }
  }

  if (mfaToken) {
    return (
      <form onSubmit={onSubmitMfa} className="space-y-5">
        <div>
          <label htmlFor="mfa-code" className="label">Code aus deiner Authenticator-App</label>
          <input
            id="mfa-code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            required
            autoFocus
            value={mfaCode}
            onChange={(e) => setMfaCode(e.target.value)}
            placeholder="123 456"
            className="input tracking-[0.3em] text-center text-lg"
            disabled={loading}
          />
          <p className="mt-2 text-xs text-ink-muted">
            Passwort war korrekt. Zur Sicherheit brauchen wir noch den 6-stelligen Code aus deiner App (Google Authenticator, 1Password, Apple Passwörter).
          </p>
        </div>

        {error && (
          <div className="bg-danger-soft border border-danger/20 text-danger rounded-squircle-sm px-4 py-3 text-sm animate-fade-in">
            {error}
          </div>
        )}

        <button type="submit" className="btn-brand w-full group" disabled={loading || mfaCode.replace(/\s+/g, "").length < 6}>
          {loading ? "Prüfen..." : (
            <>
              Anmelden
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </button>
        <button
          type="button"
          className="w-full text-xs text-ink-muted hover:text-ink underline-offset-2 hover:underline"
          onClick={() => { setMfaToken(null); setError(null); }}
        >
          Zurück zur Passwort-Eingabe
        </button>
      </form>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor="email" className="label">E-Mail-Adresse</label>
        <div className="relative">
          <Mail className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="du@firma.de"
            className="input pl-11"
            disabled={loading}
          />
        </div>
      </div>

      <div>
        <div className="flex justify-between items-center mb-1.5">
          <label htmlFor="password" className="label mb-0">Passwort</label>
          {role === "user" && (
            <a href="/passwort-vergessen" className="text-xs text-brand-deep hover:underline font-semibold">
              Vergessen?
            </a>
          )}
        </div>
        <div className="relative">
          <Lock className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-muted pointer-events-none" />
          <input
            id="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Dein Passwort"
            className="input pl-11 pr-11"
            disabled={loading}
          />
          <button
            type="button"
            onClick={() => setShowPassword(!showPassword)}
            className="absolute right-3 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full hover:bg-surface-muted text-ink-muted hover:text-ink flex items-center justify-center transition-colors"
            aria-label={showPassword ? "Passwort verbergen" : "Passwort anzeigen"}
          >
            {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-danger-soft border border-danger/20 text-danger rounded-squircle-sm px-4 py-3 text-sm animate-fade-in">
          {error}
        </div>
      )}

      <button type="submit" className="btn-brand w-full group" disabled={loading}>
        {loading ? (
          "Anmelden..."
        ) : (
          <>
            Anmelden
            <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
          </>
        )}
      </button>
    </form>
  );
}
