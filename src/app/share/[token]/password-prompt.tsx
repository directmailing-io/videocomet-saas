"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface PasswordPromptProps {
  token: string;
  campaignName: string;
}

/**
 * Passwort-Prompt für `/share/<token>`. Postet an
 * `POST /api/share/<token>/auth` — bei 200 setzt der Endpoint das signierte
 * Cookie und wir triggern einen `router.refresh()`. Bei Fehlern: inline
 * Statusmeldung, Button bleibt klickbar (kein blockierender Toast).
 */
export function PasswordPrompt({ token, campaignName }: PasswordPromptProps) {
  const router = useRouter();
  const [password, setPassword] = React.useState("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const onSubmit = React.useCallback(
    async (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      if (pending) return;
      // Whitespace clientseitig trimmen damit Mobile-Auto-Suggest oder
      // Copy-Paste mit Trailing-Space nicht zu Mismatches fuehren. Der
      // Server trimmt zwar nochmal (Defense-in-Depth), aber das fixed
      // die UX hier sofort und sendet einheitlich.
      const trimmed = password.trim();
      if (!trimmed) {
        setError("Bitte Passwort eingeben.");
        return;
      }
      setPending(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/share/${encodeURIComponent(token)}/auth`,
          {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password: trimmed }),
          },
        );
        if (res.ok) {
          // Cookie ist gesetzt — `refresh()` triggert den SSR-Rerender, der
          // den Prompt durch das Dashboard ersetzt.
          router.refresh();
          return;
        }
        if (res.status === 401) {
          setError("Passwort falsch.");
        } else if (res.status === 429) {
          setError("Zu viele Versuche. Bitte später erneut.");
        } else if (res.status === 404) {
          setError("Link nicht mehr gültig.");
        } else {
          setError("Anmeldung fehlgeschlagen. Bitte erneut versuchen.");
        }
      } catch {
        setError("Netzwerkfehler. Bitte erneut versuchen.");
      } finally {
        setPending(false);
      }
    },
    [password, pending, router, token],
  );

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2.5">
          <span className="inline-flex size-9 items-center justify-center rounded-full bg-brand-soft text-brand-deep">
            <Lock className="size-4" />
          </span>
          <div>
            <CardTitle>Geteilte Ansicht: {campaignName}</CardTitle>
            <CardDescription>
              Bitte Passwort eingeben um fortzufahren.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          <div>
            <Label htmlFor="share-password">Passwort</Label>
            <Input
              id="share-password"
              type="password"
              autoFocus
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                if (error) setError(null);
              }}
              error={Boolean(error)}
              disabled={pending}
            />
          </div>
          {error && (
            <p
              role="alert"
              aria-live="polite"
              className="text-sm text-danger leading-relaxed"
            >
              {error}
            </p>
          )}
          <Button
            type="submit"
            variant="brand"
            disabled={pending}
            iconLeft={
              pending ? <Loader2 className="size-4 animate-spin" /> : undefined
            }
            className="w-full"
          >
            {pending ? "Wird geprüft…" : "Ansicht öffnen"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
