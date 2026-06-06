/**
 * Public-Page-Dispatcher für /v/<slug>.
 *
 * Entscheidet pro Request:
 *  - Hat der Lead's Run eine Custom-LP-Version gepinnt? → render Custom-LP
 *    direkt (via /cv-Renderer-Helper). KEIN Redirect — die User-URL bleibt
 *    sauber.
 *  - Sonst: intern an /lp-block/<slug> weiterleiten (das ist die alte
 *    React-Page-Implementierung, jetzt unter einem internen Pfad). Wir
 *    streamen die Antwort transparent zurück.
 *
 * Warum so umgebaut: ein simpler 307-Redirect auf /cv/<slug> würde die
 * Custom-LP-Variante ausliefern, aber den `/cv/`-Pfad UND `?_host=…` in
 * der Adressleiste sichtbar machen. Das ist für End-Empfänger unschön.
 * Mit dem Dispatcher bleibt die URL `video.kunde.de/<slug>` exakt erhalten.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { leads, runs } from "@/lib/db/schema";
import { buildCustomLpCspHeader } from "@/lib/custom-lp/csp";
import { resolveCustomDomainHost } from "@/lib/custom-domain-host";
import { renderCustomLp } from "@/lib/custom-lp/renderer";
import { sanitizeIndexHtml } from "@/lib/custom-lp/sanitizer";
import {
  getCustomLpContextBySlugForDefaultDomain,
  getCustomLpContextBySlugAndDomain,
  type CustomLpPublicContext,
} from "@/lib/db/queries/custom-lp-public";
import { getDomainByHostname } from "@/lib/db/queries/user-domains";
import { getCustomLpStorageEnv } from "@/lib/custom-lp/storage";
import { bunnyFetch, BunnyApiError } from "@/lib/bunny/_fetch";
import { buildPageUrlShort } from "@/lib/placeholders/page-url";

// Siehe Begründung in /cv/[slug]/route.ts — absolute URL umgeht das
// Middleware-Rewrite auf lp/Custom-Domain.
const TRACKING_BRIDGE_URL =
  (process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ??
    "https://app.videocomet.de") + "/__videocomet-bridge.js";

/**
 * Hat die Run-Row, an der der Lead hängt, eine Custom-LP-Version gepinnt?
 * Single-Join über leads → runs für den Schnelltest BEVOR wir den
 * Custom-LP-Pfad nehmen.
 *
 * TENANT-SAFETY: muss tenant-aware lookups durchführen. Auf der Default-
 * Domain darf nur ein Lead mit `domain_id IS NULL` matchen; auf einer
 * Custom-Domain nur ein Lead mit exakt dieser `domain_id`. Sonst kann
 * der Schnelltest einen Custom-LP-Pin für einen fremden Tenant melden
 * und damit den Cross-Tenant-Leak triggern.
 */
async function hasCustomLpPin(
  slug: string,
  domainId: string | null,
): Promise<boolean> {
  const slugCondition = domainId
    ? and(eq(leads.slug, slug), eq(leads.domainId, domainId))
    : and(eq(leads.slug, slug), isNull(leads.domainId));
  const [row] = await db
    .select({ pinnedVersionId: runs.customLpVersionId })
    .from(leads)
    .innerJoin(runs, eq(runs.id, leads.runId))
    .where(slugCondition)
    .limit(1);
  return Boolean(row?.pinnedVersionId);
}

/**
 * Holt den vollen Custom-LP-Kontext (Lead-Daten + Storage-Pfad + Annotations)
 * — entweder default-domain-scoped oder via Custom-Domain-Scope falls
 * `_host` gesetzt.
 */
async function loadCustomLpContext(
  slug: string,
  hostParam: string | null,
): Promise<CustomLpPublicContext | null> {
  if (hostParam) {
    const domain = await getDomainByHostname(hostParam);
    if (!domain || domain.status !== "active") return null;
    return getCustomLpContextBySlugAndDomain(slug, domain.id);
  }
  return getCustomLpContextBySlugForDefaultDomain(slug);
}

async function fetchFromBunnyStorage(remotePath: string): Promise<Buffer> {
  const env = getCustomLpStorageEnv();
  const cleanedPath = remotePath.replace(/^\/+/, "");
  const url = `https://storage.bunnycdn.com/${env.zone}/${cleanedPath}`;
  const response = await bunnyFetch(
    url,
    { method: "GET", headers: { AccessKey: env.readonlyKey || env.accessKey } },
    { retries: 1 },
  );
  const arr = await response.arrayBuffer();
  return Buffer.from(arr);
}

function joinStoragePath(prefix: string, entry: string): string {
  return `${prefix.replace(/\/+$/, "")}/${entry.replace(/^\/+/, "")}`;
}

function errorPage(status: number, title: string): Response {
  const safe = title.replace(/[<>&"']/g, (c) => {
    return (
      { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" }[
        c
      ] ?? c
    );
  });
  const body = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safe}</title><style>html,body{margin:0;padding:0;background:#fff;color:#222;font:14px/1.5 system-ui,sans-serif}main{min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px;text-align:center}h1{font-size:22px;font-weight:600;margin:0 0 8px}p{color:#717171;margin:0;max-width:480px}</style></head><body><main><h1>${safe}</h1><p>Bitte prüfe den Link oder versuche es später erneut.</p></main></body></html>`;
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Frame-Options": "DENY",
    },
  });
}

/**
 * Pfad-A: Custom-LP direkt rendern und als HTML-Response zurückgeben.
 * Geklont aus /cv/[slug]/route.ts — Helper-Extraktion folgt in v2 wenn beide
 * Pfade stabil sind.
 */
async function renderCustomLpResponseInline(
  slug: string,
  context: CustomLpPublicContext,
  pageUrl: string | null,
): Promise<Response> {
  let htmlBuffer: Buffer;
  try {
    htmlBuffer = await fetchFromBunnyStorage(
      joinStoragePath(context.storagePath, context.entryHtml),
    );
  } catch (err) {
    if (err instanceof BunnyApiError && err.status === 404) {
      return errorPage(404, "Seite nicht gefunden");
    }
    // eslint-disable-next-line no-console
    console.error("[v-dispatch] failed to fetch index.html:", err);
    return errorPage(502, "Vorübergehend nicht erreichbar");
  }

  let rewritten: string;
  try {
    const html = htmlBuffer.toString("utf-8");
    const sanitised = sanitizeIndexHtml(html);
    rewritten = renderCustomLp({
      html: sanitised,
      leadData: context.leadData,
      slug,
      trackingBridgeUrl: TRACKING_BRIDGE_URL,
      annotations: context.annotations,
      videoUrl: context.videoUrl,
      videoMp4Url: context.videoMp4Url,
      thumbnailUrl: context.thumbnailUrl,
      videoOrientation: context.videoOrientation,
      pageUrl,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[v-dispatch] failed to render Custom-LP:", err);
    return errorPage(500, "Interner Fehler");
  }

  return new NextResponse(rewritten, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Content-Security-Policy": buildCustomLpCspHeader(),
      "Cache-Control": "private, no-store, max-age=0",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * Pfad-B: an die alte Block-LP-Seite weiterleiten (intern, ohne URL-Change).
 * Wir fetchen die /lp-block/<slug>-React-Seite und streamen die Bytes
 * verbatim zurück. Cookies werden weitergereicht damit die Preview-
 * Erkennung in der Page funktioniert.
 */
async function proxyBlockLp(
  req: NextRequest,
  slug: string,
): Promise<Response> {
  // Direkt-Fetch über localhost:3000 — die public URL hochzuziehen funktioniert
  // im Container nicht (Traefik-Loop produziert "wrong version number" TLS-
  // Fehler). Innerhalb des Containers ist der Next.js-Server unter
  // http://127.0.0.1:3000 erreichbar.
  //
  // WICHTIG: req.nextUrl.searchParams (NICHT new URL(req.url)!) enthaelt
  // die von der Middleware gesetzten Query-Params — insbesondere `_host`,
  // den die Middleware bei Custom-Domain-Requests einsetzt. `req.url`
  // zeigt auf die unveraenderte Client-URL und wuerde `_host` verlieren.
  // Folgen: lp-block-Page macht Default-Domain-Lookup und findet evtl.
  // einen gleichnamigen Lead aus einer fremden Kampagne (Tenant-Leak +
  // falsches Video).
  const target = new URL(`http://127.0.0.1:3000/lp-block/${slug}`);
  req.nextUrl.searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });
  // Public-Host als Header durchreichen, damit die LP-Page den richtigen
  // Origin-Kontext kennt (für Tracking-Bridge, etc.).
  const upstream = await fetch(target.toString(), {
    method: "GET",
    headers: {
      cookie: req.headers.get("cookie") ?? "",
      "user-agent": req.headers.get("user-agent") ?? "",
      accept: "text/html",
      host: req.headers.get("host") ?? "app.videocomet.de",
      "x-forwarded-host": req.headers.get("host") ?? "app.videocomet.de",
      "x-forwarded-proto": "https",
    },
    redirect: "manual",
    cache: "no-store",
  });
  const body = await upstream.text();
  const headers = new Headers();
  const ct = upstream.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  const sc = upstream.headers.get("set-cookie");
  if (sc) headers.set("set-cookie", sc);
  headers.set("cache-control", "private, no-store, max-age=0");
  return new NextResponse(body, { status: upstream.status, headers });
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  const { slug } = await ctx.params;
  const hostParam = resolveCustomDomainHost(req);

  // Resolve the domain ONCE — both the pin-check and the context load need
  // the same tenant-scope. Without hostParam wir bleiben auf der Default-
  // Domain (domain_id IS NULL).
  let domainId: string | null = null;
  if (hostParam) {
    const domain = await getDomainByHostname(hostParam);
    if (!domain || domain.status !== "active") {
      // Wenn _host gesetzt ist, der aber zu keiner aktiven Custom-Domain
      // gehört, lehnen wir ab — kein silenter Fallback auf die Default-
      // Domain (das wäre genau der Tenant-Leak, den wir verhindern wollen).
      // eslint-disable-next-line no-console
      console.warn("[v] unknown or inactive _host param", { hostParam, slug });
      return errorPage(404, "Seite nicht gefunden");
    }
    domainId = domain.id;
  }

  if (await hasCustomLpPin(slug, domainId)) {
    const context = await loadCustomLpContext(slug, hostParam);
    if (context) {
      // pageUrl-Short für den globalen `{{pageUrl}}`-Placeholder.
      // `hostParam` ist vom Middleware bereits gesetzt, wenn der Request
      // über eine Custom-Domain reinkam (→ `video.kunde.de/<slug>`).
      // Ohne hostParam läuft der Request auf der Default-Domain
      // (`app.videocomet.de/v/<slug>`).
      const appUrl =
        process.env.NEXT_PUBLIC_APP_URL ??
        process.env.APP_URL ??
        "https://app.videocomet.de";
      const pageUrl = buildPageUrlShort(hostParam, slug, appUrl);
      return renderCustomLpResponseInline(slug, context, pageUrl);
    }
    // hasCustomLpPin sagte ja, der Context-Load liefert aber nichts → der
    // Lead existiert, hat aber kein bzw. ein anderes Custom-LP-Template
    // gebunden. Defensiv weiter zum Block-LP-Pfad, der den gleichen
    // tenant-aware Lookup nochmal macht.
  }

  return proxyBlockLp(req, slug);
}
