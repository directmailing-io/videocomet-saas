/**
 * OG-Share-Bild (1200×630) für öffentliche Video-Seiten /v/<slug>.
 *
 * Wird von Messengern/Mail-Clients (WhatsApp, Teams, Slack, …) geladen,
 * wenn ein Empfänger-Link geteilt wird. Zeigt Markenlook der Landingpage
 * (Theme-Farben + Logo), Video-Thumbnail mit Play-Button und
 * "Ein Video für <Vorname>".
 *
 * Tenant-Safety wie in lp-block/page.tsx: mit ?host=<custom-domain> wird
 * der Lead NUR innerhalb der Domain aufgelöst, ohne host NUR Leads ohne
 * domain_id.
 */

import { ImageResponse } from "next/og";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { campaigns, landingPageTemplates, runs } from "@/lib/db/schema";
import {
  getLeadBySlugForDefaultDomain,
  getLeadBySlugAndDomain,
} from "@/lib/db/queries/leads";
import { getDomainByHostname } from "@/lib/db/queries/user-domains";
import { extractThemeAndBrand } from "@/lib/landing-theme/extract";
import { leadFirstName } from "@/lib/landing-og";
import { signStreamHlsUrl } from "@/lib/bunny/sign-url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/* ------------------------------------------------------------------ */
/* Fonts: Inter via Google-Fonts-CSS-API (ohne Browser-UA → TTF-URLs). */
/* Fallback bei Netzproblemen: eingebaute Default-Schrift von next/og. */
/* ------------------------------------------------------------------ */

const fontCache = new Map<number, Promise<ArrayBuffer | null>>();

function loadInter(weight: number): Promise<ArrayBuffer | null> {
  const cached = fontCache.get(weight);
  if (cached) return cached;
  const p = (async () => {
    try {
      const css = await fetch(
        `https://fonts.googleapis.com/css2?family=Inter:wght@${weight}`,
        { cache: "no-store" },
      ).then((r) => (r.ok ? r.text() : ""));
      const url = css.match(/src:\s*url\(([^)]+\.ttf)\)/)?.[1];
      if (!url) return null;
      const res = await fetch(url);
      if (!res.ok) return null;
      return await res.arrayBuffer();
    } catch {
      return null;
    }
  })();
  fontCache.set(weight, p);
  return p;
}

/** Thumbnail selbst laden (Timeout + Größenlimit) statt satori fetchen zu
 *  lassen — ein kaputtes Bunny-Bild darf das Share-Bild nie crashen. */
async function fetchThumbnail(url: string | null): Promise<string | null> {
  if (!url || !/^https:\/\//.test(url)) return null;
  try {
    // Stream-CDN hat Referer-Whitelist (app.videocomet.de) und ggf.
    // Token-Auth — ohne beides antwortet Bunny mit 403.
    const res = await fetch(signStreamHlsUrl(url), {
      signal: AbortSignal.timeout(4000),
      cache: "no-store",
      headers: { Referer: "https://app.videocomet.de/" },
    });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") ?? "image/jpeg";
    if (!type.startsWith("image/")) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength > 4_000_000) return null;
    return `data:${type};base64,${Buffer.from(buf).toString("base64")}`;
  } catch {
    return null;
  }
}

function isHexColor(c: string): boolean {
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim());
}

/** Weiß oder fast-schwarz auf der Primärfarbe — je nach Luminanz. */
function textOnColor(color: string): string {
  if (!isHexColor(color)) return "#ffffff";
  let hex = color.trim().slice(1);
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 168 ? "#111111" : "#ffffff";
}

async function loadThemeSource(runId: string): Promise<{
  themeId: string | null;
  templateContent: unknown;
} | null> {
  try {
    const [row] = await db
      .select({
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
    };
  } catch {
    return null;
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const hostParam = req.nextUrl.searchParams.get("host");

  let lead: Awaited<ReturnType<typeof getLeadBySlugForDefaultDomain>> = null;
  if (hostParam) {
    const domain = await getDomainByHostname(hostParam);
    if (domain && domain.status === "active") {
      lead = await getLeadBySlugAndDomain(slug, domain.id);
      if (lead && lead.domainId !== domain.id) lead = null;
    }
  } else {
    lead = await getLeadBySlugForDefaultDomain(slug);
  }
  if (!lead) return new Response("Not found", { status: 404 });

  const source = await loadThemeSource(lead.runId);
  const { theme, brand } = extractThemeAndBrand(
    source?.templateContent ?? null,
    source?.themeId,
  );
  const { primary, bg, surface, text, muted } = theme.colors;
  const onPrimary = textOnColor(primary);

  const firstName = leadFirstName(lead.data);
  const [thumb, inter, interBold] = await Promise.all([
    fetchThumbnail(lead.thumbnailUrl),
    loadInter(500),
    loadInter(700),
  ]);

  const fonts: NonNullable<
    ConstructorParameters<typeof ImageResponse>[1]
  >["fonts"] = [];
  if (inter) fonts.push({ name: "Inter", data: inter, weight: 500 });
  if (interBold) fonts.push({ name: "Inter", data: interBold, weight: 700 });

  // satori rendert den CSS-Border-Dreieck-Trick als Quadrat — daher SVG.
  const playTriangle = (size: number) => (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M8 5v14l11-7z" fill={onPrimary} />
    </svg>
  );

  const playCircle = (size: number) => (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: 9999,
        backgroundColor: primary,
      }}
    >
      {playTriangle(size * 0.5)}
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          backgroundColor: bg,
          fontFamily: fonts.length ? "Inter" : undefined,
        }}
      >
        {/* Linke Spalte: Marke + Botschaft */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "64px 24px 64px 72px",
          }}
        >
          {brand.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={brand.logoUrl}
              alt=""
              style={{
                height: 44,
                objectFit: "contain",
                objectPosition: "left",
                marginBottom: 40,
                alignSelf: "flex-start",
                maxWidth: 360,
              }}
            />
          ) : null}
          <div
            style={{
              display: "flex",
              color: primary,
              fontSize: 21,
              fontWeight: 700,
              letterSpacing: 4,
              marginBottom: 18,
            }}
          >
            PERSÖNLICHE VIDEOBOTSCHAFT
          </div>
          <div
            style={{
              display: "flex",
              color: text,
              fontSize: firstName && firstName.length > 12 ? 56 : 64,
              fontWeight: 700,
              lineHeight: 1.12,
              maxWidth: 560,
            }}
          >
            {firstName
              ? `Ein Video für ${firstName}`
              : "Ein Video, nur für dich"}
          </div>
          <div
            style={{
              display: "flex",
              color: muted,
              fontSize: 26,
              fontWeight: 500,
              marginTop: 18,
            }}
          >
            Jetzt ansehen, dauert nur ein paar Minuten.
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginTop: 36,
              alignSelf: "flex-start",
              backgroundColor: primary,
              color: onPrimary,
              borderRadius: 9999,
              padding: "16px 34px",
              fontSize: 26,
              fontWeight: 700,
            }}
          >
            {playTriangle(22)}
            Video abspielen
          </div>
        </div>

        {/* Rechte Spalte: Thumbnail-Karte mit Play-Button */}
        <div
          style={{
            width: 470,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "56px 56px 56px 12px",
          }}
        >
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "100%",
              height: 400,
              borderRadius: 28,
              overflow: "hidden",
              backgroundColor: surface,
              boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
            }}
          >
            {thumb ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={thumb}
                alt=""
                style={{
                  position: "absolute",
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                }}
              />
            ) : null}
            {thumb ? (
              <div
                style={{
                  position: "absolute",
                  width: "100%",
                  height: "100%",
                  backgroundColor: "rgba(0,0,0,0.18)",
                }}
              />
            ) : null}
            {playCircle(104)}
          </div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: fonts.length ? fonts : undefined,
      headers: {
        "Cache-Control": "public, max-age=3600, s-maxage=86400",
      },
    },
  );
}
