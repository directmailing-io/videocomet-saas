/**
 * Cloudflare Turnstile — DSGVO-freundlicher Bot-Schutz.
 *
 * Frontend rendert das Turnstile-Widget (siehe TurnstileWidget-Component),
 * bekommt einen Token, sendet ihn an den Server. Server verifiziert den
 * Token gegen Cloudflare — verifiziertes Token bedeutet: Cloudflare
 * halt den Requester fuer keinen Bot.
 *
 * Env:
 *   NEXT_PUBLIC_TURNSTILE_SITE_KEY (Frontend)
 *   TURNSTILE_SECRET_KEY (Server)
 *
 * Wenn Secret nicht gesetzt: fail-open (Dev-Mode) — Turnstile-Test-Keys
 * gibt es fuer lokales Testing (`1x00000000000000000000AA` = always pass).
 */

export async function verifyTurnstile(
  token: string,
  clientIp?: string,
): Promise<boolean> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    // Dev-Mode ohne Turnstile — durchlassen aber warnen
    if (process.env.NODE_ENV === "production") {
      console.warn(
        "[turnstile] TURNSTILE_SECRET_KEY not set in production — bot protection is bypassed",
      );
    }
    return true;
  }

  try {
    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (clientIp && clientIp !== "unknown") form.set("remoteip", clientIp);

    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as {
      success?: boolean;
      "error-codes"?: string[];
    };
    return Boolean(body.success);
  } catch (err) {
    console.warn("[turnstile] verify failed:", err);
    return false;
  }
}
