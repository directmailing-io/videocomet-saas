/**
 * Public Recording-Page für Gast-Webcam-Aufnahmen.
 *
 * Route: /r/<slug> — auth-frei. Wir rendern die Seite serverseitig nur sehr
 * dünn (Owner-Header + Title) und lassen den Recorder als Client-Component
 * den Rest übernehmen (getUserMedia + MediaRecorder + XHR-Upload mit
 * Progress).
 *
 * Layout-Reihenfolge (bewusst):
 *  1. Headline „Aufnahme für <Owner>"
 *  2. GuestRecorder (Video oben — die Haupthandlung)
 *  3. TipsCard (klein, dezent, sekundär)
 *  4. Privacy-Hinweis
 *
 * Bewusst KEINE AppShell — Empfänger sollen nichts von der internen App
 * sehen. Eigener minimaler Layout (`layout.tsx`) ergänzt nur globale
 * Schriftarten + die Brand-Markierung.
 */

import { notFound } from "next/navigation";
import { getShareLinkBySlugPublic } from "@/lib/db/queries/webcam-share";
import { GuestRecorder } from "./guest-recorder";
import { TipsCard } from "./tips-card";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function GuestRecordingPage({
  params,
}: {
  params: { slug: string };
}) {
  const info = await getShareLinkBySlugPublic(params.slug);
  if (!info) notFound();

  return (
    <main className="min-h-screen flex flex-col bg-surface-soft">
      <section className="flex-1 mx-auto w-full max-w-2xl px-5 py-10 sm:py-14 space-y-6">
        {/* Headline — zentriert, schlicht. #ID dezent darunter, damit Owner
            beim Debuggen die Korrelation zur Mediathek hat. */}
        <header className="text-center space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
            Aufnahme für
          </p>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight text-ink">
            {info.ownerName}
          </h1>
          {info.title && (
            <p className="text-sm text-ink-muted pt-1">{info.title}</p>
          )}
          <p className="text-[11px] text-ink-muted tabular-nums pt-1">
            Link-ID: #{String(info.numericId).padStart(3, "0")}
          </p>
        </header>

        {/* Video oben — die Haupthandlung */}
        <GuestRecorder
          slug={info.slug}
          ownerName={info.ownerName}
          title={info.title}
          maxDurationSec={info.maxDurationSec}
          initialStatus={info.status}
        />

        {/* Tips: klein + dezent — nur wenn der Link aktiv ist (sonst zeigt
            der Recorder bereits einen Fehlerzustand und Tips sind irreführend). */}
        {info.status === "open" && <TipsCard />}

        <p className="text-center text-[11px] text-ink-muted leading-relaxed">
          Deine Aufnahme wird direkt und ausschließlich an {info.ownerName}
          {" "}gesendet. Es wird kein Konto angelegt.
        </p>
      </section>
    </main>
  );
}
