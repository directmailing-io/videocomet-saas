import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import {
  campaigns,
  landingPageTemplates,
  runs,
} from "@/lib/db/schema";
import { getLeadBySlug } from "@/lib/db/queries/leads";
import { Logo } from "@/components/ui/logo";
import { VideoPlayer } from "./video-player";
import { LandingRender } from "./landing-render";
import { TrackerInit } from "./tracker-init";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PublicLandingProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Internal "preview" mode is enabled when EITHER:
 *   - the URL carries `?preview=1` (typical first hit from the admin UI), OR
 *   - the `vc_preview=1` cookie is set (subsequent same-browser navigations,
 *     written client-side by TrackerInit for 1h).
 *
 * In preview mode the no-JS fallback pixel is suppressed server-side, the
 * JS tracker becomes a no-op, and a visible badge is shown to the tester.
 */
async function detectPreviewMode(searchParams: PublicLandingProps["searchParams"]): Promise<boolean> {
  const sp = await searchParams;
  const param = sp?.preview;
  if (Array.isArray(param) ? param.includes("1") : param === "1") {
    return true;
  }
  try {
    const c = await cookies();
    return c.get("vc_preview")?.value === "1";
  } catch {
    return false;
  }
}

/**
 * Helper that walks lead → run → campaign → landingPageTemplate. We do
 * this with a single join rather than four query hops; the public page
 * is the hot path and we want one DB round-trip.
 */
async function loadCampaignAndTemplate(runId: string): Promise<{
  themeId: string | null;
  templateContent: unknown;
  campaignName: string | null;
} | null> {
  try {
    const [row] = await db
      .select({
        campaignName: campaigns.name,
        themeId: landingPageTemplates.themeId,
        templateContent: landingPageTemplates.content,
      })
      .from(runs)
      .innerJoin(campaigns, eq(campaigns.id, runs.campaignId))
      .leftJoin(
        landingPageTemplates,
        eq(landingPageTemplates.id, campaigns.landingPageTemplateId),
      )
      .where(eq(runs.id, runId))
      .limit(1);
    if (!row) return null;
    return {
      themeId: row.themeId ?? "clean",
      templateContent: row.templateContent ?? null,
      campaignName: row.campaignName ?? null,
    };
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: PublicLandingProps): Promise<Metadata> {
  const { slug } = await params;
  // We deliberately keep metadata minimal — no PII in the title.
  return {
    title: "VIDEOCOMET",
    description: "Personalisierte Videobotschaft.",
    robots: { index: false, follow: false },
    other: { "x-slug": slug },
  };
}

export default async function PublicLandingPage({
  params,
  searchParams,
}: PublicLandingProps) {
  const { slug } = await params;
  const isPreview = await detectPreviewMode(searchParams);

  const lead = await getLeadBySlug(slug);
  if (!lead) notFound();

  // If the lead is still being rendered (no slug-page artifacts yet), show
  // a calm "Wird erstellt" interstitial. We treat absence of videoUrl AND
  // status not-yet-completed as "pending".
  const isPending =
    lead.status !== "completed" && lead.status !== "failed" && !lead.videoUrl;

  const campaignInfo = await loadCampaignAndTemplate(lead.runId);

  if (isPending) {
    return (
      <main className="min-h-screen w-full bg-surface-soft flex flex-col">
        <PendingState leadId={lead.id} suppressPixel={isPreview} />
        <Footer />
      </main>
    );
  }

  // Build Bunny embed URL from the stored video ID (if we have one). The
  // worker stores `bunnyVideoId`; we recompose the embed URL here so we
  // never need to persist it separately.
  const libraryId = process.env.BUNNY_STREAM_LIBRARY_ID;
  const bunnyEmbedUrl =
    lead.bunnyVideoId && libraryId
      ? `https://iframe.mediadelivery.net/embed/${libraryId}/${lead.bunnyVideoId}`
      : null;

  const videoSlot = (
    <VideoPlayer
      leadId={lead.id}
      slug={slug}
      bunnyEmbedUrl={bunnyEmbedUrl}
      videoSrc={lead.videoUrl}
      thumbnailUrl={lead.thumbnailUrl}
      title={campaignInfo?.campaignName ?? "Video"}
    />
  );

  return (
    <>
      {/* Initialises the tracker module and fires the page_view event
          from the client. Server-side cannot read referrer/language. */}
      <TrackerInit slug={slug} initialPreview={isPreview} />
      <LandingRender
        themeId={campaignInfo?.themeId}
        templateContent={campaignInfo?.templateContent ?? null}
        leadData={lead.data}
        leadId={lead.id}
        slug={slug}
        videoSlot={videoSlot}
      />
      {/* Tracking pixel — fires page_view from the bare HTML even if
          JavaScript fails to load. Suppressed in preview-mode so internal
          test-visits do not count. */}
      {!isPreview && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`/api/track/page-view?leadId=${encodeURIComponent(lead.id)}`}
          alt=""
          aria-hidden="true"
          width={1}
          height={1}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
      )}
      <Footer />
    </>
  );
}

function PendingState({
  leadId,
  suppressPixel,
}: {
  leadId: string;
  suppressPixel: boolean;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-20 text-center">
      <div className="size-14 rounded-full border-2 border-brand/30 border-t-brand animate-spin mb-6" />
      <h1 className="text-2xl font-bold text-ink mb-2">Wird erstellt</h1>
      <p className="text-sm text-ink-muted max-w-md">
        Dein personalisiertes Video wird gerade vorbereitet. Bitte lade die
        Seite in wenigen Minuten erneut.
      </p>
      {/* Pixel-Tracking läuft auch im Pending-State, damit wir wissen,
          wann Empfänger zum ersten Mal geklickt haben — außer im
          internen Vorschau-Modus. */}
      {!suppressPixel && (
        /* eslint-disable-next-line @next/next/no-img-element */
        <img
          src={`/api/track/page-view?leadId=${encodeURIComponent(leadId)}`}
          alt=""
          aria-hidden="true"
          width={1}
          height={1}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            opacity: 0,
            pointerEvents: "none",
          }}
        />
      )}
    </div>
  );
}

function Footer() {
  return (
    <footer className="w-full py-8 flex items-center justify-center">
      <a
        href="https://videocomet.de"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-2 opacity-60 hover:opacity-100 transition-opacity"
      >
        <Logo variant="horizontal" height={20} />
      </a>
    </footer>
  );
}
