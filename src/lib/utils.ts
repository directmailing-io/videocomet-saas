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
 * Slugify für Landingpage-URLs. Re-exportiert aus `@/lib/slug` aus
 * Backward-Compat-Gruenden — die Engine liegt jetzt zentral in `slug.ts`,
 * weil Templates / Reserved-Liste / Kollisions-Handling dort gebuendelt sind.
 *
 * Neue Aufrufer sollten direkt `generateSlug()` aus `@/lib/slug` nutzen.
 */
export { slugify } from "./slug";
