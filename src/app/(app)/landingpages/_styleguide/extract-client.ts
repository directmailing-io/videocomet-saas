"use client";

/**
 * Client-Helfer für die Brand-Extraktion (Konzept 3.1/3.2).
 *
 * Konsumiert NUR den festen API-Vertrag — die Endpoints selbst werden
 * parallel gebaut:
 *   POST /api/brand/extract {url}        → {jobId} | {error}
 *   GET  /api/brand/extract/[jobId]      → {status, phase?, result?, error?}
 *
 * Polling alle 1,5 s, hartes Timeout nach 30 s. Fehler werden als Error
 * mit einem freundlichen deutschen Text geworfen — der Aufrufer zeigt
 * den Text an und bietet den manuellen Weg an (kein Dead-End).
 */

import type { BrandKit } from "@/lib/landing-theme/brand-kit";

export interface LogoCandidate {
  url: string;
  width?: number;
  height?: number;
  kind: string;
}

export interface BrandExtractionResult {
  kit: BrandKit;
  logoCandidates: LogoCandidate[];
}

export type ExtractionPhase = "loading" | "analyzing";

const POLL_MS = 1500;
const TIMEOUT_MS = 30_000;

const FRIENDLY_FAIL =
  "Wir konnten deine Website leider nicht auslesen. Das passiert z. B. bei sehr strengen Sicherheits-Einstellungen. Wähle deinen Look einfach selbst — das dauert nur eine Minute.";

export async function runBrandExtraction(
  url: string,
  opts?: { onPhase?: (phase: ExtractionPhase) => void },
): Promise<BrandExtractionResult> {
  let jobId: string;
  try {
    const res = await fetch("/api/brand/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as { jobId?: string; error?: string };
    if (!res.ok || !data.jobId) {
      throw new Error(data.error || FRIENDLY_FAIL);
    }
    jobId = data.jobId;
  } catch (err) {
    throw new Error(err instanceof Error && err.message ? err.message : FRIENDLY_FAIL);
  }

  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_MS);
    let data: {
      status?: string;
      phase?: ExtractionPhase;
      result?: BrandExtractionResult;
      error?: string;
    };
    try {
      const res = await fetch(`/api/brand/extract/${jobId}`, {
        cache: "no-store",
      });
      data = (await res.json()) as typeof data;
    } catch {
      // Netz-Hickser beim Polling sind kein Abbruchgrund — weiter warten.
      continue;
    }
    if (data.status === "done" && data.result) {
      return {
        kit: data.result.kit,
        logoCandidates: (data.result.logoCandidates ?? []).slice(0, 6),
      };
    }
    if (data.status === "failed") {
      throw new Error(data.error || FRIENDLY_FAIL);
    }
    if (data.phase && opts?.onPhase) opts.onPhase(data.phase);
  }
  throw new Error(
    "Die Analyse dauert gerade zu lange. Wähle deinen Look einfach selbst — du kannst die Website später jederzeit erneut einlesen.",
  );
}

/**
 * Kopiert ein extern gefundenes Logo auf unser CDN. Fällt bei Fehlern
 * auf die Original-URL zurück — ein geklautes Hotlink-Logo ist besser
 * als gar kein Logo, und der User kann jederzeit ein eigenes hochladen.
 */
export async function importLogo(url: string): Promise<string> {
  try {
    const res = await fetch("/api/brand/logo-import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = (await res.json()) as { url?: string };
    if (res.ok && data.url) return data.url;
  } catch {
    // fall through
  }
  return url;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
