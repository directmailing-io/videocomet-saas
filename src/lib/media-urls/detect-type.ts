/**
 * URL-Typ-Erkennung fuer die URL-Mediathek.
 *
 * Bei Save / Auto-Detect identifizieren wir den Typ aus URL-Pattern. User
 * kann das spaeter manuell ueberschreiben (Phase 2 — v1 vertraut der
 * Heuristik).
 *
 * Reihenfolge ist signifikant: spezifischer zuerst.
 */

import type { MediaUrl } from "@/lib/db/schema";

export type MediaUrlType = MediaUrl["type"];

interface Pattern {
  type: MediaUrlType;
  re: RegExp;
  /** Extrahiert externalResourceId aus dem Match (Doc-ID, Video-ID, etc.). */
  resourceId?: (m: RegExpMatchArray) => string | null;
}

const PATTERNS: Pattern[] = [
  {
    type: "gdoc",
    re: /docs\.google\.com\/document\/d\/([a-zA-Z0-9_-]+)/i,
    resourceId: (m) => m[1] ?? null,
  },
  {
    type: "gsheet",
    re: /docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/i,
    resourceId: (m) => m[1] ?? null,
  },
  {
    type: "gslides",
    re: /docs\.google\.com\/presentation\/d\/([a-zA-Z0-9_-]+)/i,
    resourceId: (m) => m[1] ?? null,
  },
  {
    type: "gform",
    re: /docs\.google\.com\/forms\/d\/([a-zA-Z0-9_-]+)/i,
    resourceId: (m) => m[1] ?? null,
  },
  {
    type: "gdrive_file",
    re: /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/i,
    resourceId: (m) => m[1] ?? null,
  },
  {
    type: "youtube",
    re: /(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/i,
    resourceId: (m) => m[1] ?? null,
  },
];

export interface DetectionResult {
  type: MediaUrlType;
  externalResourceId: string | null;
}

export function detectUrlType(rawUrl: string): DetectionResult {
  for (const p of PATTERNS) {
    const m = rawUrl.match(p.re);
    if (m) {
      return {
        type: p.type,
        externalResourceId: p.resourceId ? p.resourceId(m) : null,
      };
    }
  }
  return { type: "generic", externalResourceId: null };
}

/** UI-Label fuer den Typ. */
export const TYPE_LABEL: Record<MediaUrlType, string> = {
  gdoc: "Google Doc",
  gsheet: "Google Sheet",
  gslides: "Google Slides",
  gform: "Google Form",
  gdrive_file: "Google Drive",
  youtube: "YouTube",
  generic: "Link",
};

/** Tailwind-Klassen fuer den Typ-Badge — Brand-konsistent. */
export const TYPE_BADGE_CLASS: Record<MediaUrlType, string> = {
  gdoc: "bg-blue-100 text-blue-800",
  gsheet: "bg-emerald-100 text-emerald-800",
  gslides: "bg-amber-100 text-amber-800",
  gform: "bg-violet-100 text-violet-800",
  gdrive_file: "bg-slate-100 text-slate-800",
  youtube: "bg-red-100 text-red-800",
  generic: "bg-slate-100 text-slate-700",
};
