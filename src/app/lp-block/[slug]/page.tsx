import { notFound } from "next/navigation";
import { headers } from "next/headers";
import { eq } from "drizzle-orm";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { resolveCustomDomainHostFromPage } from "@/lib/custom-domain-host";
import {
  campaigns,
  landingPageTemplates,
  runs,
} from "@/lib/db/schema";
import {
  getLeadBySlugForDefaultDomain,
  getLeadBySlugAndDomain,
} from "@/lib/db/queries/leads";
import { getDomainByHostname } from "@/lib/db/queries/user-domains";
import { LandingThemeProvider } from "@/components/landing-blocks/theme-provider";
import {
  DEFAULT_BRAND,
  DEFAULT_THEME,
  type BrandConfig,
  type ThemeConfig,
} from "@/lib/landing-theme/types";
import { themeFromPreset } from "@/lib/landing-theme/presets";
import { VideoPlayer } from "./video-player";
import { LandingRender } from "./landing-render";
import { TrackerInit } from "./tracker-init";

/**
 * Best-effort theme/brand extraction from the stored template JSON.
 *
 * The content column is JSONB and historically held v1 templates
 * (`{ headline, ctaText, … }`). v2 wraps that in
 * `{ version: 2, theme, brand, blocks, legacy }`. We accept both shapes:
 *   - v2 → use `theme` / `brand` directly (with defaults filling holes)
 *   - v1 → fall back to the stored `themeId` (preset) + default brand
 *
 * Tolerant of partial / hand-edited JSON: every missing key falls back
 * to the safe default so the page always renders something sensible.
 */
function extractThemeAndBrand(
  templateContent: unknown,
  themeId: string | null | undefined,
): { theme: ThemeConfig; brand: BrandConfig } {
  if (templateContent && typeof templateContent === "object") {
    const root = templateContent as Record<string, unknown>;
    const version = root.version;
    if (version === 2 || version === "2") {
      const theme = mergeTheme(root.theme);
      const brand = mergeBrand(root.brand);
      return { theme, brand };
    }
  }
  // Legacy v1: only the column-level themeId is meaningful.
  return {
    theme: themeFromPreset(themeId as Parameters<typeof themeFromPreset>[0]),
    brand: { ...DEFAULT_BRAND },
  };
}

function mergeTheme(raw: unknown): ThemeConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_THEME };
  const t = raw as Record<string, unknown>;
  const colors = (t.colors && typeof t.colors === "object"
    ? (t.colors as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const fonts = (t.fonts && typeof t.fonts === "object"
    ? (t.fonts as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const preset =
    typeof t.preset === "string"
      ? (t.preset as ThemeConfig["preset"])
      : DEFAULT_THEME.preset;
  return {
    preset,
    colors: {
      primary: pickStr(colors.primary, DEFAULT_THEME.colors.primary),
      accent: pickStr(colors.accent, DEFAULT_THEME.colors.accent),
      bg: pickStr(colors.bg, DEFAULT_THEME.colors.bg),
      surface: pickStr(colors.surface, DEFAULT_THEME.colors.surface),
      text: pickStr(colors.text, DEFAULT_THEME.colors.text),
      muted: pickStr(colors.muted, DEFAULT_THEME.colors.muted),
    },
    fonts: {
      heading: pickStr(fonts.heading, DEFAULT_THEME.fonts.heading),
      body: pickStr(fonts.body, DEFAULT_THEME.fonts.body),
    },
    spacing:
      t.spacing === "compact" || t.spacing === "spacious" || t.spacing === "cozy"
        ? t.spacing
        : DEFAULT_THEME.spacing,
    radius:
      t.radius === "sharp" || t.radius === "rounded" || t.radius === "pill"
        ? t.radius
        : DEFAULT_THEME.radius,
  };
}

function mergeBrand(raw: unknown): BrandConfig {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_BRAND };
  const b = raw as Record<string, unknown>;
  return {
    logoUrl:
      typeof b.logoUrl === "string" && b.logoUrl.length > 0
        ? b.logoUrl
        : null,
    logoAlign: b.logoAlign === "center" ? "center" : "left",
    showFooter:
      typeof b.showFooter === "boolean" ? b.showFooter : undefined,
    footerText: typeof b.footerText === "string" ? b.footerText : "",
  };
}

function pickStr(value: unknown, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface PublicLandingProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Internal "preview" mode is enabled ONLY when `?preview=1` ist im URL.
 *
 * Früher persistierten wir das via Cookie (vc_preview, 1h gültig). Das war
 * ein UX-Footgun: ein einmaliger Test-Klick mit ?preview=1 hat das
 * Tracking für eine Stunde IN DIESEM Browser komplett ausgeschaltet —
 * auch für die "echten" Tests. Wir akzeptieren jetzt lieber, dass der
 * Tester sich beim Wechsel zwischen Leads den Param zweimal in die URL
 * tippt.
 *
 * In preview mode wird das no-JS-Fallback-Pixel serverseitig unterdrückt,
 * der JS-Tracker wird no-op und es erscheint eine sichtbare Badge.
 */
async function detectPreviewMode(searchParams: PublicLandingProps["searchParams"]): Promise<boolean> {
  const sp = await searchParams;
  const param = sp?.preview;
  return Array.isArray(param) ? param.includes("1") : param === "1";
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
  campaignMode: "webcam-only" | "with-presentation" | null;
} | null> {
  try {
    const [row] = await db
      .select({
        campaignName: campaigns.name,
        campaignMode: campaigns.mode,
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
    // Mode kommt als raw text aus der DB; auf das bekannte Tupel verengen.
    const mode =
      row.campaignMode === "webcam-only" || row.campaignMode === "with-presentation"
        ? row.campaignMode
        : null;
    return {
      themeId: row.themeId ?? "clean",
      templateContent: row.templateContent ?? null,
      campaignName: row.campaignName ?? null,
      campaignMode: mode,
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
  const sp = await searchParams;
  const isPreview = await detectPreviewMode(searchParams);

  // Custom-Domain-Routing: die Middleware setzt `_host` wenn der Request
  // ueber einen Kunden-Host kam. Dann müssen wir den Lead innerhalb der
  // Domain aufloesen, NICHT global — sonst kann ein gleichnamiger Slug auf
  // einer anderen Custom-Domain (oder app.videocomet.de) falsch matchen.
  //
  // TENANT-SAFETY: ohne _host (Default-Domain) dürfen NUR Leads mit
  // `domain_id IS NULL` aufgelöst werden. Ein Lead, der einer Custom-Domain
  // zugewiesen ist, darf NICHT über `app.videocomet.de/v/<slug>` erreichbar
  // sein — sonst kann der Slug eines Kundens fremde Lead-Daten ausliefern.
  //
  // Defensive: der Query-Param kann unter Next.js-14-Edge→Node-Rewrites
  // verloren gehen. `resolveCustomDomainHostFromPage` faellt dann auf den
  // `host`-Header zurueck und filtert App-eigene Hosts (siehe
  // src/lib/custom-domain-host.ts).
  const hostParam = resolveCustomDomainHostFromPage(sp, await headers());
  let isCustomDomain = false;
  let lead: Awaited<ReturnType<typeof getLeadBySlugForDefaultDomain>> = null;
  if (hostParam) {
    const domain = await getDomainByHostname(hostParam);
    if (!domain || domain.status !== "active") notFound();
    isCustomDomain = true;
    lead = await getLeadBySlugAndDomain(slug, domain.id);
    // Defensive Konsistenz-Prüfung: getLeadBySlugAndDomain filtert bereits
    // auf domainId, aber wir loggen falls ein Drift erkannt wird.
    if (lead && lead.domainId !== domain.id) {
      // eslint-disable-next-line no-console
      console.warn(
        "[lp-block] lead found but wrong domain context",
        { slug, expectedDomainId: domain.id, leadDomainId: lead.domainId },
      );
      notFound();
    }
  } else {
    lead = await getLeadBySlugForDefaultDomain(slug);
  }
  if (!lead) notFound();

  // Custom-LP-Auswahl wird im /v/<slug>-Dispatcher VOR dem Block-LP-Render
  // entschieden. Diese Page ist jetzt der interne Block-LP-Pfad — der
  // Dispatcher proxied uns nur an wenn KEIN Custom-LP gepinnt ist.

  // If the lead is still being rendered (no slug-page artifacts yet), show
  // a calm "Wird erstellt" interstitial. We treat absence of videoUrl AND
  // status not-yet-completed as "pending".
  const isPending =
    lead.status !== "completed" && lead.status !== "failed" && !lead.videoUrl;

  const campaignInfo = await loadCampaignAndTemplate(lead.runId);

  // Theme + brand are extracted defensively — partial JSON / legacy v1
  // templates all collapse to safe defaults. See `extractThemeAndBrand`.
  const { theme, brand } = extractThemeAndBrand(
    campaignInfo?.templateContent ?? null,
    campaignInfo?.themeId,
  );

  // Footer visibility:
  //   - user-set boolean wins (true → always show, false → always hide),
  //   - otherwise default ON for the platform default domain and OFF for
  //     white-label custom domains.
  const wantsFooter =
    brand.showFooter ?? (isCustomDomain ? false : true);

  if (isPending) {
    return (
      <LandingThemeProvider
        theme={theme}
        brand={brand}
        showFooter={wantsFooter}
        isDefaultDomain={!isCustomDomain}
      >
        <main className="min-h-screen w-full flex flex-col">
          <PendingState leadId={lead.id} suppressPixel={isPreview} />
        </main>
      </LandingThemeProvider>
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

  // Aspect-ratio-Hinweis aus Paket A. Lead-Query projiziert die Spalte
  // bereits defensiv (null wenn die DB-Migration noch nicht gelaufen ist),
  // wir reichen sie 1:1 in den Player + Hero durch.
  const videoOrientation = lead.videoOrientation ?? null;

  const videoSlot = (
    <VideoPlayer
      leadId={lead.id}
      slug={slug}
      bunnyEmbedUrl={bunnyEmbedUrl}
      videoSrc={lead.videoUrl}
      thumbnailUrl={lead.thumbnailUrl}
      title={campaignInfo?.campaignName ?? "Video"}
      videoOrientation={videoOrientation}
    />
  );

  return (
    <>
      {/* Initialises the tracker module and fires the page_view event
          from the client. Server-side cannot read referrer/language. */}
      <TrackerInit slug={slug} initialPreview={isPreview} />
      <LandingThemeProvider
        theme={theme}
        brand={brand}
        showFooter={wantsFooter}
        isDefaultDomain={!isCustomDomain}
      >
        <LandingRender
          themeId={campaignInfo?.themeId}
          templateContent={campaignInfo?.templateContent ?? null}
          leadData={lead.data}
          leadId={lead.id}
          slug={slug}
          videoSlot={videoSlot}
          videoOrientation={videoOrientation}
          campaignMode={campaignInfo?.campaignMode ?? null}
        />
      </LandingThemeProvider>
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

// The legacy `<Footer />` (VIDEOCOMET logo) has moved into
// `src/components/landing-blocks/brand-footer.tsx`. It now renders
// automatically as part of `<LandingThemeProvider>` when:
//   - the user supplied no custom `footerText`, AND
//   - the page is on the platform default domain, AND
//   - the resolved `wantsFooter` flag is true.
