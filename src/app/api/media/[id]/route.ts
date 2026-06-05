export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUserApi } from "@/lib/auth-guard";
import {
  deleteMediaItem,
  getMediaItem,
  renameMediaItem,
} from "@/lib/db/queries/media";
import { removeBunnyAssetRefsForOwner } from "@/lib/db/queries/bunny-assets";
import { triggerBunnyPurgeTick } from "@/lib/bunny/purge-trigger";

const renameSchema = z.object({
  name: z.string().trim().min(1, "Name darf nicht leer sein.").max(200),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Ungültiger JSON-Body." }, { status: 400 });
  }
  const parsed = renameSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "Ungültige Eingabe.",
        details: parsed.error.issues.map((i) => i.message),
      },
      { status: 400 },
    );
  }

  try {
    const updated = await renameMediaItem(
      params.id,
      auth.user.id,
      parsed.data.name,
    );
    if (!updated) {
      return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, media: updated });
  } catch (err) {
    const code = err instanceof Error ? err.message : "internal";
    if (code === "name-empty") {
      return NextResponse.json(
        { error: "Name darf nicht leer sein." },
        { status: 400 },
      );
    }
    if (code === "name-too-long") {
      return NextResponse.json(
        { error: "Name ist zu lang (max. 200 Zeichen)." },
        { status: 400 },
      );
    }
    console.error("[api/media] rename failed:", err);
    return NextResponse.json(
      { error: "Umbenennen fehlgeschlagen." },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/media/[id] — Hard-Delete des Mediathek-Items + Bunny-Cleanup
 * via Ref-Counting-System (Paket B/G).
 *
 * Flow:
 *  1. Ownership-Check via `getMediaItem`.
 *  2. `bunny_asset_refs` für `owner_type='media_item'` entfernen. Wenn der
 *     Asset noch von einer Kampagne (`campaign_webcam`) referenziert wird,
 *     überlebt die Bunny-GUID — sonst markiert der Sweep sie als
 *     `purge_pending`.
 *  3. DB-Row löschen (Mediathek-Items haben kein Soft-Delete; User-Action
 *     ist explizit).
 *  4. Sofortige Purge anstossen.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } },
) {
  const auth = await requireUserApi();
  if (!auth.ok) return auth.response;

  try {
    // Ownership-Check.
    await getMediaItem(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  try {
    await removeBunnyAssetRefsForOwner("media_item", params.id);
  } catch (err) {
    // Refs nicht entfernt → DB-Delete würde dangling Refs hinterlassen, die
    // der Worker später als foreign-key-orphans wegrräumen muss. Wir
    // proceed trotzdem mit dem Hard-Delete, weil der `bunny_asset_refs.owner_id`
    // KEINE FK auf media_items hat (es ist `text`/UUID-Owner-Pattern), also
    // sind dangling Refs für die DB harmlos und der nächste Sweep findet sie.
    console.warn("[api/media] ref cleanup failed (continuing):", err);
  }

  try {
    await deleteMediaItem(params.id, auth.user.id);
  } catch {
    return NextResponse.json({ error: "Nicht gefunden." }, { status: 404 });
  }

  void triggerBunnyPurgeTick("media:delete");

  return NextResponse.json({ ok: true });
}
