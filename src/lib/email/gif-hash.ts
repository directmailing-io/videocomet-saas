/**
 * Hash-Cache-Schlüssel für Outreach-GIFs (Kontrakt Kapitel 3/6).
 *
 * `leads.emailGifHash = sha1(videoContentHash + JSON(gifConfig))` —
 * identischer Hash beim Re-Enqueue ⇒ der Worker skippt den Encode.
 * Zentral, damit API-Status-Route und Worker-Job garantiert dieselbe
 * Ableitung verwenden.
 */

import { createHash } from "node:crypto";
import type { CampaignEmailGifConfig } from "@/lib/db/schema";

export function computeEmailGifHash(
  videoContentHash: string | null | undefined,
  config: CampaignEmailGifConfig,
): string {
  // Key-Reihenfolge fixieren — JSON.stringify ist insertion-ordered und
  // die Config kommt aus verschiedenen Quellen (API-Body vs. DB-JSONB).
  const normalized = JSON.stringify({
    startSec: config.startSec,
    durationSec: config.durationSec,
  });
  return createHash("sha1")
    .update(`${videoContentHash ?? ""}${normalized}`)
    .digest("hex");
}
