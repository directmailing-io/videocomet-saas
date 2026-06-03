/**
 * Public Recording-Page für Gast-Webcam-Aufnahmen.
 *
 * Route: /r/<slug> — auth-frei. Wir rendern die Seite serverseitig nur sehr
 * dünn (Owner-Header + Title) und lassen den Recorder als Client-Component
 * den Rest übernehmen (getUserMedia + MediaRecorder + XHR-Upload mit
 * Progress).
 *
 * Bewusst KEINE AppShell — Empfänger sollen nichts von der internen App
 * sehen. Eigener minimaler Layout (`layout.tsx`) ergänzt nur globale
 * Schriftarten + die Brand-Markierung.
 */

import { notFound } from "next/navigation";
import { getShareLinkBySlugPublic } from "@/lib/db/queries/webcam-share";
import { GuestRecorder } from "./guest-recorder";
import { Logo } from "@/components/ui/logo";

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
    <main className="min-h-screen flex flex-col">
      {/* Branding-Header */}
      <header className="border-b border-line/60 bg-surface/80 backdrop-blur-sm">
        <div className="mx-auto max-w-2xl w-full flex items-center justify-between px-5 py-4">
          <Logo />
          <span className="text-xs font-medium text-ink-muted">
            Sichere Webcam-Aufnahme
          </span>
        </div>
      </header>

      <section className="flex-1 mx-auto w-full max-w-2xl px-5 py-8 space-y-6">
        <div className="space-y-2 text-center sm:text-left">
          <p className="text-xs font-semibold uppercase tracking-wider text-ink-muted">
            Aufnahme für
          </p>
          <h1 className="text-2xl sm:text-3xl font-bold text-ink">
            {info.ownerName}
          </h1>
          {info.title && (
            <p className="text-sm text-ink-muted">
              {info.title}
            </p>
          )}
        </div>

        <GuestRecorder
          slug={info.slug}
          ownerName={info.ownerName}
          title={info.title}
          maxDurationSec={info.maxDurationSec}
          initialStatus={info.status}
        />

        <p className="text-center text-[11px] text-ink-muted mt-8 leading-relaxed">
          Deine Aufnahme wird direkt und ausschließlich an {info.ownerName}
          {" "}gesendet. Es wird kein Konto angelegt.
        </p>
      </section>
    </main>
  );
}
