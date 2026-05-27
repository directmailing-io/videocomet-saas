import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Build initials from a first + last name, falling back to the first char
 * of an email or "?". Server-safe (no "use client" required).
 */
export function getInitials(
  firstName?: string | null,
  lastName?: string | null,
  fallback?: string | null,
): string {
  const f = (firstName ?? "").trim();
  const l = (lastName ?? "").trim();
  if (f || l) {
    return `${f.charAt(0)}${l.charAt(0)}`.toUpperCase() || "?";
  }
  const fb = (fallback ?? "").trim();
  if (fb) return fb.charAt(0).toUpperCase();
  return "?";
}

/**
 * Slugify für Landingpage-URLs. Umlaute werden transliteriert, Sonderzeichen entfernt,
 * 4-Hex-Zeichen Suffix für Eindeutigkeit. Anzeige (z.B. auf Landingpage) behält Umlaute.
 */
export function slugify(input: string, randomSuffix = true): string {
  const translit: Record<string, string> = {
    "ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss",
    "Ä": "Ae", "Ö": "Oe", "Ü": "Ue",
    "à": "a", "á": "a", "â": "a", "ã": "a", "å": "a",
    "è": "e", "é": "e", "ê": "e", "ë": "e",
    "ì": "i", "í": "i", "î": "i", "ï": "i",
    "ò": "o", "ó": "o", "ô": "o", "õ": "o",
    "ù": "u", "ú": "u", "û": "u",
    "ñ": "n", "ç": "c", "ý": "y", "ÿ": "y",
  };
  let s = input.trim();
  s = s.replace(/[äöüÄÖÜßàáâãåèéêëìíîïòóôõùúûñçýÿ]/g, (c) => translit[c] ?? c);
  s = s.toLowerCase();
  s = s.replace(/[^a-z0-9]+/g, "-");
  s = s.replace(/^-+|-+$/g, "");
  s = s.slice(0, 76);
  if (randomSuffix) {
    const suffix = Math.random().toString(16).slice(2, 6);
    s = `${s}-${suffix}`;
  }
  return s;
}
