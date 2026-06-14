import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import {
  getActiveShareByToken,
  listShareLeads,
  listShareEvents,
} from "@/lib/db/queries/campaign-shares";
import { getCampaign } from "@/lib/db/queries/campaigns";
import { cookieName, verifyShareCookie } from "@/lib/share-cookie";
import { PasswordPrompt } from "./password-prompt";
import { ShareDashboard } from "./share-dashboard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Entry-Page für `/share/<token>`.
 *
 *  1. Lookup des aktiven Shares — unbekannt / revoked → `notFound()`.
 *  2. Cookie-Prüfung — fehlt / abgelaufen / nicht signiert → Passwort-Prompt.
 *  3. Authentifiziert → parallel-fetch von Leads + Events + Render Dashboard.
 *
 * Der Auth-Schritt ist bewusst SSR — wir wollen keinen Flash des Prompts
 * bei jedem Tab-Wechsel, und die `cookies()`-Lesung ist trivial schnell.
 */
export default async function SharePage({
  params,
}: {
  params: { token: string };
}) {
  const share = await getActiveShareByToken(params.token);
  if (!share) notFound();

  const cookieStore = cookies();
  const raw = cookieStore.get(cookieName(params.token))?.value ?? null;
  const authenticated = verifyShareCookie(params.token, raw);

  // Campaign-Name nachladen — der Public-Share-Lookup gibt aus Sicherheits-
  // gründen keine Owner-Felder zurück, aber wir können `getCampaign` mit
  // dem im Share gebundenen `userId` als Tenant-Guard nutzen. Fällt graceful
  // auf "Kampagne" zurück, falls die Kampagne soft-deleted wurde.
  const campaignName = await getCampaign(share.campaignId, share.userId)
    .then((c) => c.name)
    .catch(() => "Kampagne");
  const appUrl = process.env.APP_URL ?? "https://app.videocomet.de";

  if (!authenticated) {
    return (
      <section className="mx-auto w-full max-w-md px-5 py-16">
        <PasswordPrompt token={params.token} campaignName={campaignName} />
      </section>
    );
  }

  const [leads, events] = await Promise.all([
    listShareLeads(share.campaignId),
    listShareEvents(share.campaignId, { limit: 200 }),
  ]);

  return (
    <section className="mx-auto w-full max-w-6xl px-5 py-8">
      <ShareDashboard
        token={params.token}
        campaignName={campaignName}
        initialLeads={leads}
        initialEvents={events}
        appUrl={appUrl}
      />
    </section>
  );
}
