export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import Link from "next/link";
import { CheckCircle2, ArrowRight } from "lucide-react";
import { getStripe } from "@/lib/billing/stripe-client";

/**
 * /signup/success?session_id=cs_...
 *
 * Wird nach erfolgreicher Stripe-Checkout-Zahlung angezeigt. Wir pollen
 * die Session-Info von Stripe (schneller als auf den Webhook zu warten)
 * und zeigen den Login-Link.
 */

export default async function SignupSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const params = await searchParams;
  const sessionId = params.session_id;

  let customerEmail: string | null = null;
  if (sessionId) {
    try {
      const stripe = getStripe();
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      customerEmail =
        session.customer_details?.email ??
        session.customer_email ??
        null;
    } catch {
      // still — Session-Retrieval nicht kritisch
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-brand-soft to-white flex items-center justify-center px-4 py-12">
      <div className="max-w-md w-full">
        <div className="bg-white rounded-squircle-lg border border-line shadow-xl p-8 text-center">
          <div className="mx-auto size-16 rounded-full bg-emerald-50 flex items-center justify-center mb-4">
            <CheckCircle2 className="size-8 text-emerald-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Willkommen!</h1>
          <p className="text-sm text-ink-muted mb-6 leading-relaxed">
            Deine Zahlung ist erfolgreich. Dein Zugang wird jetzt eingerichtet
            — das kann ein paar Sekunden dauern, während Stripe den Vorgang
            bestätigt.
          </p>
          {customerEmail && (
            <div className="bg-brand-soft rounded-md p-3 mb-6 text-xs">
              Deine Anmelde-Email: <strong>{customerEmail}</strong>
            </div>
          )}
          <Link
            href="/login"
            className="inline-flex items-center justify-center gap-1.5 rounded-full px-6 py-3 text-sm font-semibold bg-ink text-white hover:bg-ink/90 transition-all w-full"
          >
            Jetzt einloggen
            <ArrowRight className="size-4" />
          </Link>
          <p className="text-[11px] text-ink-muted mt-4">
            Falls du dich innerhalb 30 Sekunden nicht einloggen kannst,
            versuche es erneut — der Webhook braucht manchmal einen Moment.
          </p>
        </div>
      </div>
    </div>
  );
}
