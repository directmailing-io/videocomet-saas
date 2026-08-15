import { requireUser } from "@/lib/auth-guard";
import { getUserById } from "@/lib/db/queries/users";
import { brandKitSchema, type BrandKit } from "@/lib/landing-theme/brand-kit";
import { NewLpWizard } from "./wizard";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Einstiegs-Wizard vor dem Builder (Landingpage v3, Konzept Abschnitt 2).
 *
 * Früher legte diese Route direkt eine leere Vorlage an und leitete in den
 * Editor um. Jetzt fragt sie zuerst nach dem Look (Website analysieren /
 * eigenen Look wählen / gespeicherten Look verwenden) und legt die Vorlage
 * mit vorbefüllter Starter-Seite im Markenlook an — der User landet nie in
 * einem leeren Editor.
 *
 * Server-seitig laden wir nur den Account-Standard (users.brand_kit_default),
 * damit der Wizard Weg C („Meinen gespeicherten Look verwenden") ohne
 * zusätzlichen Roundtrip anbieten kann.
 */
export default async function NewLandingpagePage() {
  const { user } = await requireUser();

  let savedKit: BrandKit | null = null;
  try {
    const row = await getUserById(user.id);
    const parsed = brandKitSchema.safeParse(row.brandKitDefault);
    if (parsed.success) savedKit = parsed.data;
  } catch {
    // Kein Standard vorhanden oder nicht lesbar — Wizard startet ohne Weg C.
  }

  return <NewLpWizard savedKit={savedKit} />;
}
