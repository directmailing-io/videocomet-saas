/**
 * Personalisierte Share-Vorschau (OG) für öffentliche Video-Seiten.
 *
 * Vorname kommt aus den freien Lead-Spalten (CSV-Import) — wir matchen
 * dieselben Alias-Schreibweisen wie die KI-Begrüßung und validieren streng:
 * lieber keine Personalisierung als "Ein Video für Gmbh&Co" im Messenger.
 */

import { formatPersonName } from "@/lib/format-name";
import { checkFirstName } from "@/lib/intro-name-check";

const FIRST_NAME_KEYS = ["vorname", "firstname", "first_name", "first name"];

export function leadFirstName(data: unknown): string | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const entries = Object.entries(data as Record<string, unknown>);
  for (const wanted of FIRST_NAME_KEYS) {
    const hit = entries.find(
      ([key]) => key.trim().toLowerCase() === wanted,
    );
    if (!hit || typeof hit[1] !== "string") continue;
    // Erst Anzeige-Casing ("anne-kathrin" → "Anne-Kathrin"), dann die
    // strenge Namens-Prüfung (Blocklist, Titel, Muster) der KI-Begrüßung.
    const check = checkFirstName(formatPersonName(hit[1]));
    if (!check.ok) continue;
    return check.name;
  }
  return null;
}

export function ogShareTitle(firstName: string | null): string {
  return firstName
    ? `Persönliches Video für ${firstName}`
    : "Persönliche Videobotschaft";
}

export function ogShareDescription(firstName: string | null): string {
  return firstName
    ? `${firstName}, dein persönliches Video wartet auf dich.`
    : "Dein persönliches Video wartet auf dich.";
}

export function appBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ?? "https://app.videocomet.de"
  ).replace(/\/+$/, "");
}
