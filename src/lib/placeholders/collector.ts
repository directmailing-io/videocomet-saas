/**
 * Scant eine komplette Kampagne nach Platzhaltern.
 *
 * Quellen:
 *   - Text-Segmente            campaigns.segments[].text                {{key}}
 *   - Slide-Segmente           campaigns.segments[].layers[].contentHtml
 *                                                                       Tiptap-Span
 *                                                                       + {{key}}
 *   - Slug-Template            campaigns.slugTemplate                   {key}
 *   - Google-Docs (PDF-Brief)  campaigns.pdfGoogleDocsUrl               {{key}}
 *   - Google-Docs-Segment      campaigns.segments[].docsUrl             {{key}}
 *   - Block-LP                 landing_page_templates.content (JSONB)   {{key|fallback}}
 *   - Custom-LP                custom_lp_versions.* (HTML/CSS/JS Bunny) {{key|fallback}}
 *
 * Verhalten bei nicht-zugänglichen Quellen (z. B. Google-Doc offline):
 *   - Wir ENTFERNEN den Source-Eintrag nicht, sondern markieren ihn als
 *     `inaccessible: true`. Die UI zeigt das dann als "kann gerade nicht
 *     gelesen werden" — der User kann das Mapping trotzdem editieren.
 *
 * Diese Funktion ist HEAVY (mehrere Netzwerk-Calls): sie sollte vom
 * Endpoint `/api/runs/[id]/placeholders` aufgerufen werden, nicht aus dem
 * Worker.
 */

import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  campaigns,
  customLpVersions,
  landingPageTemplates,
} from "@/lib/db/schema";
import type { Segment, Layer } from "@/lib/segments/types";
import {
  isTextSegment,
  isSlideSegment,
  isGDocsSegment,
  isGSlideSegment,
} from "@/lib/segments/types";
import type {
  DetectedPlaceholder,
  PlaceholderSource,
  PlaceholderSourceKind,
} from "./types";
import { normalizePlaceholderKey } from "./substitute";

// ── interne Akkumulator-Struktur ────────────────────────────────────────────

interface Accumulator {
  /** key (original) → DetectedPlaceholder */
  byKey: Map<string, DetectedPlaceholder>;
}

function pushHit(
  acc: Accumulator,
  key: string,
  source: PlaceholderSource,
): void {
  const trimmed = key.trim();
  if (!trimmed) return;
  const existing = acc.byKey.get(trimmed);
  if (existing) {
    existing.occurrences += 1;
    // Quelle nur einmal pro (kind,label) pinnen — sonst quillt die UI über.
    const already = existing.sources.find(
      (s) => s.kind === source.kind && s.label === source.label,
    );
    if (!already) {
      existing.sources.push(source);
    } else if (source.inaccessible) {
      already.inaccessible = true;
    }
    return;
  }
  acc.byKey.set(trimmed, {
    key: trimmed,
    normalized: normalizePlaceholderKey(trimmed),
    sources: [source],
    occurrences: 1,
  });
}

// ── Regex-Scanner für die einzelnen Formate ─────────────────────────────────

/** Roh-`{{key}}` und `{{key|fallback}}` — Format aus Block-LP / Custom-LP / Text. */
const DOUBLE_BRACE_RE = /\{\{\s*([a-zA-Z0-9_.\-]+)\s*(?:\|[^}]*?)?\}\}/g;

/** Slug-`{key}` — single brace. */
const SINGLE_BRACE_RE = /\{\s*([a-zA-Z0-9_]+)\s*\}/g;

/** Tiptap-Span — nur das Attribut, der Body wird vom Substitution genutzt. */
const TIPTAP_SPAN_RE = /data-placeholder=["']([\w-]+)["']/gi;

function scanDoubleBrace(
  text: string | null | undefined,
  acc: Accumulator,
  source: PlaceholderSource,
): void {
  if (!text) return;
  let m: RegExpExecArray | null;
  DOUBLE_BRACE_RE.lastIndex = 0;
  while ((m = DOUBLE_BRACE_RE.exec(text))) {
    pushHit(acc, m[1], source);
  }
}

function scanSingleBrace(
  text: string | null | undefined,
  acc: Accumulator,
  source: PlaceholderSource,
): void {
  if (!text) return;
  let m: RegExpExecArray | null;
  SINGLE_BRACE_RE.lastIndex = 0;
  while ((m = SINGLE_BRACE_RE.exec(text))) {
    pushHit(acc, m[1], source);
  }
}

function scanTiptapHtml(
  html: string | null | undefined,
  acc: Accumulator,
  source: PlaceholderSource,
): void {
  if (!html) return;
  let m: RegExpExecArray | null;
  TIPTAP_SPAN_RE.lastIndex = 0;
  while ((m = TIPTAP_SPAN_RE.exec(html))) {
    pushHit(acc, m[1], source);
  }
  // Auch rohe {{key}} im HTML (Backward-Compat-Texte).
  scanDoubleBrace(html, acc, source);
}

// ── Block-LP JSON-Walker ────────────────────────────────────────────────────

/**
 * Rekursiv: läuft durch ein JSON und scant JEDEN String-Wert nach
 * `{{key|fallback}}`. So sind wir robust gegen Block-Schema-Erweiterungen
 * von Agent B — neue Felder werden automatisch erkannt.
 */
function scanJsonStrings(
  value: unknown,
  acc: Accumulator,
  source: PlaceholderSource,
): void {
  if (typeof value === "string") {
    scanDoubleBrace(value, acc, source);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) scanJsonStrings(item, acc, source);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) scanJsonStrings(v, acc, source);
  }
}

// ── Segment-Walker ──────────────────────────────────────────────────────────

function scanSegments(
  segments: Segment[] | null | undefined,
  acc: Accumulator,
): void {
  if (!segments) return;
  segments.forEach((seg, idx) => {
    const ordinal = idx + 1;
    if (isTextSegment(seg)) {
      scanDoubleBrace(seg.text, acc, {
        kind: "text",
        label: seg.label?.trim() || `Text-Segment ${ordinal}`,
      });
      return;
    }
    if (isSlideSegment(seg)) {
      const label = seg.label?.trim() || `Folie ${ordinal}`;
      for (const layer of seg.layers) {
        scanLayer(layer, acc, label);
      }
      return;
    }
    if (isGDocsSegment(seg)) {
      // Doc-Inhalt wird NICHT hier gefetcht — der collectCampaignPlaceholders
      // erledigt das einmal pro eindeutiger docsUrl (s. u.).
      // Hier nur das Label vormerken, falls der Fetch fehlschlägt.
      // (Source wird beim Fetch-Versuch eingetragen.)
    }
    if (isGSlideSegment(seg)) {
      // Bei Google-Slides-Segmenten ist der Pubembed-DOM live in Google's
      // Hand — wir fetchen NICHT pro Collector-Run. Stattdessen ist der
      // Cache `detectedPlaceholders[]` (gefüllt beim Import + beim
      // manuellen "Aktualisieren") die Wahrheit. Das hält den Collector
      // schnell und vermeidet, dass ein flackerndes Google-Backend hier
      // den Wizard blockiert.
      const label =
        seg.label?.trim() ||
        `Google-Slide-Segment ${ordinal} (Folie ${seg.slideIndex + 1})`;
      const source: PlaceholderSource = { kind: "gslide", label };
      for (const key of seg.detectedPlaceholders ?? []) {
        pushHit(acc, key, source);
      }
    }
  });
}

function scanLayer(
  layer: Layer,
  acc: Accumulator,
  slideLabel: string,
): void {
  if (layer.kind === "text") {
    scanTiptapHtml(layer.contentHtml, acc, {
      kind: "slide",
      label: slideLabel,
    });
  }
}

// ── Google-Docs Fetcher (best-effort) ───────────────────────────────────────

/**
 * Holt eine Google-Doc-HTML-Repräsentation. Aus dem Web-Layer (Server-Side)
 * heraus aufrufbar, ohne Worker-Abhängigkeiten.
 *
 * Wir nutzen das Public-Export der Docs-App (`?format=html`), genau wie
 * `worker/lib/google-docs.ts`. Bewusst KEIN Cache hier — der Endpoint wird
 * pro Wizard-Schritt einmal aufgerufen.
 */
async function fetchGoogleDocText(
  docsUrl: string,
): Promise<{ text: string; ok: true } | { ok: false; reason: string }> {
  try {
    const match = /\/document\/(?:u\/\d+\/)?d\/([a-zA-Z0-9_-]+)/.exec(docsUrl);
    if (!match || !match[1]) return { ok: false, reason: "kein Doc-Id" };
    const id = match[1];
    const exportUrl = `https://docs.google.com/document/d/${id}/export?format=html`;
    const res = await fetch(exportUrl, { redirect: "follow" });
    if (!res.ok) return { ok: false, reason: `http ${res.status}` };
    const ct = (res.headers.get("content-type") ?? "").toLowerCase();
    if (ct && !ct.startsWith("text/html")) {
      return { ok: false, reason: `content-type ${ct}` };
    }
    const text = await res.text();
    return { text, ok: true };
  } catch (err) {
    return {
      ok: false,
      reason: err instanceof Error ? err.message : "unbekannt",
    };
  }
}

// ── Custom-LP File-Scanner ──────────────────────────────────────────────────

const SCANNABLE_CUSTOM_LP_EXT = new Set(["html", "htm", "css", "js", "mjs"]);

async function scanCustomLpVersion(
  versionId: string,
  acc: Accumulator,
): Promise<void> {
  const [version] = await db
    .select()
    .from(customLpVersions)
    .where(eq(customLpVersions.id, versionId))
    .limit(1);
  if (!version) return;

  // Wir lesen NUR die kleinen Text-Dateien (HTML/CSS/JS). Binaries (Bilder,
  // Fonts, Video) sind nie Träger von Platzhaltern → überspringen.
  const candidates = version.fileManifest.filter((f) => {
    const ext = (f.path.split(".").pop() ?? "").toLowerCase();
    return SCANNABLE_CUSTOM_LP_EXT.has(ext);
  });

  // Storage-Reader dynamisch importieren, weil die Bunny-ENV nur im
  // Node-Runtime existiert; in Tests wird der Aufruf evtl. übersprungen.
  let readFile: (p: string) => Promise<{ buffer: Buffer }>;
  try {
    const mod = await import("@/lib/custom-lp/storage");
    readFile = mod.readFile;
  } catch {
    acc.byKey; // noop, just keeps `acc` referenced
    return;
  }

  const storageRoot = version.storagePath.replace(/\/+$/, "");
  for (const file of candidates) {
    const remote = `${storageRoot}/${file.path.replace(/^\/+/, "")}`;
    const label = `Custom-LP: ${file.path}`;
    try {
      const { buffer } = await readFile(remote);
      const text = buffer.toString("utf-8");
      scanDoubleBrace(text, acc, { kind: "lp-custom", label });
    } catch (err) {
      pushHit(acc, "__unreadable__", {
        kind: "lp-custom",
        label,
        inaccessible: true,
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[placeholders/collector] custom-lp file unreadable: ${remote}`,
        err instanceof Error ? err.message : err,
      );
      // Wieder rausnehmen — der `__unreadable__`-Key ist nur Tracking
      acc.byKey.delete("__unreadable__");
    }
  }
}

// ── Block-LP-Scanner ────────────────────────────────────────────────────────

async function scanBlockLpTemplate(
  templateId: string,
  acc: Accumulator,
): Promise<void> {
  const [tpl] = await db
    .select()
    .from(landingPageTemplates)
    .where(eq(landingPageTemplates.id, templateId))
    .limit(1);
  if (!tpl) return;
  scanJsonStrings(tpl.content, acc, {
    kind: "lp-block",
    label: `Block-LP: ${tpl.name}`,
  });
}

// ── Hauptfunktion ───────────────────────────────────────────────────────────

/**
 * Scant die Kampagne `campaignId` (mit Tenant-Guard via `userId`) komplett
 * und liefert eine deduplizierte Liste aller Platzhalter mit Quellen.
 */
export async function collectCampaignPlaceholders(
  campaignId: string,
  userId: string,
): Promise<DetectedPlaceholder[]> {
  const [campaign] = await db
    .select()
    .from(campaigns)
    .where(and(eq(campaigns.id, campaignId), eq(campaigns.userId, userId)))
    .limit(1);
  if (!campaign) return [];

  const acc: Accumulator = { byKey: new Map() };

  // 1. Slug-Template
  if (campaign.slugTemplate) {
    scanSingleBrace(campaign.slugTemplate, acc, {
      kind: "slug",
      label: "Slug-Template",
    });
  }

  // 2. Segments — sammelt Text + Slide; gdocs-Segmente werden unten gefetcht
  const segments = (campaign.segments ?? []) as Segment[];
  scanSegments(segments, acc);

  // 3. Google-Docs: Sammlung der zu fetchenden URLs (dedupliziert).
  const gdocsUrls: Array<{ url: string; kind: PlaceholderSourceKind; label: string }> = [];
  if (campaign.pdfEnabled && campaign.pdfGoogleDocsUrl) {
    gdocsUrls.push({
      url: campaign.pdfGoogleDocsUrl,
      kind: "pdf",
      label: "PDF-Brief (Google Docs)",
    });
  }
  segments.forEach((seg, idx) => {
    if (isGDocsSegment(seg) && seg.docsUrl?.trim()) {
      gdocsUrls.push({
        url: seg.docsUrl,
        kind: "gdocs",
        label: seg.label?.trim() || `Google-Doc-Segment ${idx + 1}`,
      });
    }
  });

  // De-Duplikation der URLs (zwei Segmente, die dasselbe Doc nutzen, brauchen
  // nur einen Fetch).
  const fetched = new Map<string, string | null>();
  for (const item of gdocsUrls) {
    if (!fetched.has(item.url)) {
      const r = await fetchGoogleDocText(item.url);
      fetched.set(item.url, r.ok ? r.text : null);
      if (!r.ok) {
        // eslint-disable-next-line no-console
        console.warn(
          `[placeholders/collector] gdoc unreadable ${item.url}: ${r.reason}`,
        );
      }
    }
    const text = fetched.get(item.url);
    if (text) {
      scanDoubleBrace(text, acc, { kind: item.kind, label: item.label });
    } else {
      // Source-Eintrag mit inaccessible-Flag setzen, ohne neuen Key zu erzeugen
      // → wir hängen einen einzelnen leeren Marker dran, der die UI informiert.
      // Damit der Marker einen Key bekommt, parken wir ihn unter dem URL-Hash.
      const synthKey = `__inaccessible__${item.url}`;
      pushHit(acc, synthKey, {
        kind: item.kind,
        label: item.label,
        inaccessible: true,
      });
      // Wieder entfernen — der Sentinel war nur Transport
      acc.byKey.delete(synthKey);
    }
  }

  // 4. Block-LP
  if (campaign.landingPageTemplateId) {
    await scanBlockLpTemplate(campaign.landingPageTemplateId, acc);
  }

  // 5. Custom-LP (nur die aktive Version der Kampagne).
  if (campaign.customLpTemplateId) {
    const [tpl] = await db
      .select({ activeVersionId: campaigns.id }) // dummy, ersetzt unten
      .from(campaigns)
      .where(eq(campaigns.id, campaign.id))
      .limit(1);
    void tpl;
    // Konkretes Lookup über customLpTemplates → activeVersionId:
    const { customLpTemplates } = await import("@/lib/db/schema");
    const [tplRow] = await db
      .select({ activeVersionId: customLpTemplates.activeVersionId })
      .from(customLpTemplates)
      .where(eq(customLpTemplates.id, campaign.customLpTemplateId))
      .limit(1);
    if (tplRow?.activeVersionId) {
      try {
        await scanCustomLpVersion(tplRow.activeVersionId, acc);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn(
          `[placeholders/collector] custom-lp scan failed:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  // Sortierung: nach Anzahl Vorkommen (heiße Keys zuerst), dann alphabetisch.
  return Array.from(acc.byKey.values()).sort((a, b) => {
    if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
    return a.key.localeCompare(b.key);
  });
}
