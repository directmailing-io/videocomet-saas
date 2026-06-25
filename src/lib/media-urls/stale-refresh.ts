/**
 * Stale-Refresh-Tick.
 *
 * Scannt nach Preview-Eintraegen, deren `preview_expires_at` ueberfaellig
 * ist (TTL 7d fuer Google* / 30d fuer YouTube/generic — vom Worker beim
 * Job-Done gesetzt), und enqueued Refresh-Jobs.
 *
 * Bewusst klein gehalten:
 *   - Max 50 Eintraege pro Tick (laeuft 1×/h → bei 5 Usern x 100 URLs
 *     komfortabel unterhalb realistischer Stale-Volumes).
 *   - Filtert `previewStatus = 'ready'` — `pending` heisst „Job laeuft
 *     gerade", `error/private` heisst „macht keinen Sinn zu refreshen
 *     ohne User-Hand" (User klickt manuell den Refresh-Button).
 *   - BullMQ-Job-ID `preview-stale-<mediaUrlId>` ermoeglicht Dedup:
 *     wenn der vorige Stale-Tick denselben Eintrag schon enqueued hat
 *     und der Job noch wartet, addiert BullMQ den zweiten nicht hinzu.
 */

import { and, eq, isNotNull, lt } from "drizzle-orm";
import { db } from "@/lib/db";
import { mediaUrls } from "@/lib/db/schema";
import { urlPreviewQueue } from "@/worker/url-preview-queue";

const MAX_PER_TICK = 50;

export async function refreshStalePreviews(): Promise<{
  scanned: number;
  enqueued: number;
}> {
  const stale = await db
    .select({
      id: mediaUrls.id,
      userId: mediaUrls.userId,
      url: mediaUrls.url,
      type: mediaUrls.type,
    })
    .from(mediaUrls)
    .where(
      and(
        eq(mediaUrls.previewStatus, "ready"),
        isNotNull(mediaUrls.previewExpiresAt),
        lt(mediaUrls.previewExpiresAt, new Date()),
      ),
    )
    .limit(MAX_PER_TICK);

  if (stale.length === 0) return { scanned: 0, enqueued: 0 };

  const q = urlPreviewQueue();
  let enqueued = 0;
  for (const item of stale) {
    try {
      await q.add(
        `preview-stale-${item.id}`,
        {
          mediaUrlId: item.id,
          userId: item.userId,
          url: item.url,
          type: item.type,
        },
        {
          // Bewusst niedrig — User-getriggerte Refreshes (Priority 1) und
          // Initial-Saves (Priority 5) muessen vorgehen.
          priority: 10,
          // Wenn ein Stale-Job zu diesem Eintrag schon waitend/active ist,
          // verwerfen — kein Doppel-Enqueue.
          jobId: `preview-stale-${item.id}`,
        },
      );
      enqueued += 1;
    } catch {
      // BullMQ wirft bei jobId-Kollisionen — wir wollen das hier still
      // schlucken.
    }
  }

  return { scanned: stale.length, enqueued };
}
